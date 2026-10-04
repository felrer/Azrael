"""Correlate content-free native and host input-delivery records (read-only)."""

from __future__ import annotations

import argparse
from contextlib import closing
import datetime as dt
import hashlib
import json
import re
import sqlite3
from pathlib import Path

UTC = dt.timezone.utc
HOST_TIMEZONE = dt.timezone(dt.timedelta(hours=9))
METHODS = frozenset(("turn/start", "turn/steer", "thread/resume", "thread/turns/list", "thread/read"))
HOST_EVENTS = frozenset((
    "recovery.rpc_dispatch", "recovery.rpc_result", "recovery.rpc_timeout",
    "recovery.rpc_send_failed", "recovery.rpc_late_result", "host.rpc_response_received",
))
NATIVE_EVENTS = frozenset((
    "input.request_received", "input.handler_started", "input.handler_completed",
    "input.handler_abandoned", "input.handler_panicked", "input.native_call_started", "input.native_call_returned",
    "input.response_enqueue_started", "input.response_enqueued", "input.response_enqueue_failed",
    "input.response_route", "response_route",
))
LABELS = frozenset((
    "success", "error", "rpc_error", "pending", "expired", "untracked",
    "ignored_after_timeout", "started", "steered", "not_submitted", "completed",
    "enqueued", "queued", "connection_missing", "write_failed", "closed", "cancelled",
    "panicked", "response", "connection_closed", "channel_closed", "writer_queue", "handler_abandoned", "handler_started",
))
HASH_FIELDS = {"requestRef": 16, "threadRef": 16, "clientMessageHash": 64}
NUMBER_FIELDS = frozenset(("hostPid", "connectionId", "elapsedMs", "lateByMs", "timeoutMs", "rpcCode", "pendingRequests"))
LABEL_FIELDS = frozenset(("outcome", "tracking", "disposition", "boundary", "messageKind"))
ALIASES = {
    "request_ref": "requestRef", "thread_ref": "threadRef", "client_message_hash": "clientMessageHash",
    "connection_id": "connectionId", "connection": "connectionId", "elapsed_ms": "elapsedMs", "rpc_code": "rpcCode",
    "message_kind": "messageKind", "panicking": "panicking",
}


def safe_fields(record: dict) -> dict:
    """Allowlist each value; never export arbitrary event/field text."""
    safe = {}
    for original, value in record.items():
        field = ALIASES.get(original, original)
        if field in HASH_FIELDS and isinstance(value, str) and re.fullmatch(rf"[0-9a-f]{{{HASH_FIELDS[field]}}}", value):
            safe[field] = value
        elif field == "method" and isinstance(value, str) and value in METHODS:
            safe[field] = value
        elif field in LABEL_FIELDS and isinstance(value, str) and value in LABELS:
            safe[field] = value
        elif field in NUMBER_FIELDS and type(value) is int and abs(value) <= 2**53 - 1:
            safe[field] = value
        elif field == "panicking" and type(value) is bool:
            safe[field] = value
    return safe


def native_fields(body: str) -> dict:
    # Parse only small tracing primitive fields, never Debug representations.
    fields = {}
    for match in re.finditer(r'(?<![\w])([a-zA-Z_]+)=("[^"\r\n]{0,128}"|[a-zA-Z0-9_/.-]{1,128})(?=\s|$)', body):
        try:
            name, raw = match[1], match[2]
            canonical = ALIASES.get(name, name)
            if raw.startswith('"') or raw in {"true", "false"}:
                value = json.loads(raw)
            elif canonical in NUMBER_FIELDS and re.fullmatch(r'-?\d{1,16}', raw):
                value = int(raw)
            else:
                value = raw
            fields[name] = value
        except ValueError:
            pass
    event = fields.pop("event", None) or fields.pop("stage", None)
    if not isinstance(event, str) or event not in NATIVE_EVENTS:
        return {}
    return {"event": event, **safe_fields(fields)}


def host_fields(line: str) -> dict:
    position = line.find("{")
    if position < 0:
        return {}
    try:
        record = json.loads(line[position:])
    except (ValueError, RecursionError):
        return {}
    if not isinstance(record, dict) or not isinstance(record.get("event"), str) or record["event"] not in HOST_EVENTS:
        return {}
    safe = {"event": record["event"], **safe_fields(record)}
    thread = record.get("threadId")
    if isinstance(thread, str) and re.fullmatch(r"[0-9a-f-]{36}", thread):
        safe.setdefault("threadRef", hashlib.sha256(thread.encode()).hexdigest()[:16])
    return safe


def iso(value: dt.datetime) -> str:
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, default=Path.home() / ".azrael-ex")
    parser.add_argument("--thread", required=True)
    parser.add_argument("--host-log", type=Path, required=True)
    parser.add_argument("--minutes", type=int, default=60)
    parser.add_argument("--limit", type=int, default=5000)
    parser.add_argument("--events", type=int, default=200)
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f-]{36}", args.thread):
        parser.error("thread must be a lowercase UUID")
    if not 1 <= args.minutes <= 10080 or not 1 <= args.limit <= 20000 or not 1 <= args.events <= 2000:
        parser.error("minutes, limit, or events is outside allowed bounds")
    state = args.state.resolve(strict=True)
    ordinary = (Path.home() / ".codex").resolve()
    if state == ordinary or ordinary in state.parents:
        parser.error("state must be an Azrael directory")
    database = state / "logs_2.sqlite"
    if not database.is_file() or not args.host_log.is_file():
        parser.error("native database or exact host log is missing")
    since = dt.datetime.now(UTC) - dt.timedelta(minutes=args.minutes)
    thread_ref = hashlib.sha256(args.thread.encode()).hexdigest()[:16]
    records = []
    with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=5)) as conn:
        conn.execute("PRAGMA query_only=ON")
        rows = conn.execute(
            "SELECT ts, ts_nanos, level, feedback_log_body FROM logs WHERE ts >= ? "
            "AND target = 'azrael_input_delivery' ORDER BY ts DESC, ts_nanos DESC, id DESC LIMIT ?",
            (int(since.timestamp()), args.limit + 1),
        ).fetchall()
    native_truncated = len(rows) > args.limit
    # Restore arrival order before the stable cross-source timestamp sort.
    for ts, nanos, level, body in reversed(rows[:args.limit]):
        fields = native_fields(body or "")
        if fields:
            native_time = dt.datetime.fromtimestamp(ts, UTC) + dt.timedelta(microseconds=nanos // 1000)
            records.append({"source": "native", "time": iso(native_time),
                            "level": level if level in {"INFO", "WARN", "ERROR", "DEBUG"} else "unknown", **fields})
    with args.host_log.open(encoding="utf-8-sig", errors="replace") as stream:
        for line in stream:
            try:
                time = dt.datetime.strptime(line[:23], "%Y-%m-%d %H:%M:%S.%f").replace(tzinfo=HOST_TIMEZONE)
            except ValueError:
                continue
            if time < since:
                continue
            fields = host_fields(line)
            if fields and fields.get("threadRef") == thread_ref:
                records.append({"source": "host", "time": iso(time), **fields})
    request_refs = {r["requestRef"] for r in records if r.get("threadRef") == thread_ref and "requestRef" in r}
    selected = [r for r in records if r.get("threadRef") == thread_ref or r.get("requestRef") in request_refs]
    selected.sort(key=lambda r: r["time"])
    print(json.dumps({"threadRef": thread_ref, "since": iso(since), "nativeScanTruncated": native_truncated,
                      "hostTimezone": "+09:00", "matchedEvents": len(selected),
                      "omittedEvents": max(0, len(selected) - args.events), "events": selected[-args.events:],
                      "coverage": "Retained logs only; missing events do not establish non-delivery."}, ensure_ascii=False))


if __name__ == "__main__":
    main()
