"""Summarize recent native Azrael log errors without printing log bodies.

The log database can contain prompts, provider responses, and local paths.
This command reads it in SQLite read-only mode and emits only bounded metadata.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import sqlite3
from collections import Counter
from pathlib import Path


PATTERNS = (
    ("rate_limit", re.compile(r"rate.?limit|too many requests", re.I)),
    ("usage_limit", re.compile(r"usage limit|quota|budget exceeded", re.I)),
    ("authentication", re.compile(r"unauthori[sz]ed|auth(?:entication)? expired|invalid token|401\b|403\b", re.I)),
    ("connection", re.compile(r"disconnect|connection (?:closed|reset|failed)|broken pipe|network error", re.I)),
    ("timeout", re.compile(r"timed? out|deadline exceeded|idle timeout", re.I)),
    ("provider_protocol", re.compile(r"protocol error|invalid (?:json|response|stream)|malformed", re.I)),
    ("unsupported", re.compile(r"not supported|unsupported|bad request", re.I)),
    ("tool_failure", re.compile(r"tool (?:failed|error)|sandbox error|command failed", re.I)),
)
SAFE_TARGET = re.compile(r"^[A-Za-z0-9_:.-]{1,120}$")
PROVIDER_CODES = frozenset((
    "cancelled", "unknown", "invalid_argument", "deadline_exceeded", "not_found",
    "already_exists", "permission_denied", "resource_exhausted", "failed_precondition",
    "aborted", "out_of_range", "unimplemented", "internal", "unavailable", "data_loss",
    "unauthenticated", "usage_limit_reached", "quota_exceeded", "insufficient_quota",
    "rate_limit_exceeded", "rate_limited", "too_many_requests", "invalid_request_error",
))
PROVIDER_REASONS = frozenset((
    "internal_error", "context_limit", "invalid_thinking_signature", "missing_tool_result",
    "missing_tool_use", "usage_limit", "rate_limit", "invalid_request", "message_missing",
    "unrecognized_message",
))
UTC = dt.timezone.utc
CONNECTION_CATEGORIES = {"dns", "tls", "reset", "refused", "timeout", "unreachable", "proxy"}
CONNECTION_OUTCOMES = {"provider_connection_" + value for value in CONNECTION_CATEGORIES} | {"provider_headers_failed"}


def timestamp(value: int) -> str:
    return dt.datetime.fromtimestamp(value, UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def category(body: str) -> str | None:
    for name, pattern in PATTERNS:
        if pattern.search(body):
            return name
    return None


def provider_error(body: str, target: str) -> dict[str, str]:
    """Export only validated structural evidence from the provider failure event."""
    if target != "devin_native_progress":
        return {}
    marker = 'event="native_inference_helper_failed"'
    if marker not in body:
        return {}
    fields = body.rsplit(marker, 1)[1]
    result = {}
    for name, output, allowed in (
        ("provider_error_code", "code", PROVIDER_CODES),
        ("provider_error_source", "source", {"http_response", "connect_trailer"}),
        ("provider_reason", "reason", PROVIDER_REASONS),
    ):
        match = re.search(rf'(?<!\w){name}=Some\("([a-z_]+)"\)(?=\s|$)', fields)
        if match and match[1] in allowed:
            result[output] = match[1]
    trace = re.search(r'(?<!\w)provider_trace_id=Some\("([0-9a-f]{16,64})"\)(?=\s|$)', fields)
    if trace:
        result["traceId"] = trace[1]
    return result


def tool_diagnostics(body: str, target: str) -> dict:
    """Export structural hashes/counts, never tool labels or schema content."""
    if target != "devin_native_progress":
        return {}
    marker = re.search(r'event="(native_tool_catalog|native_tool_schema)"', body)
    if not marker:
        return {}
    fields = body[marker.end():]
    result: dict = {"event": marker[1]}
    for field in ("catalog_sha256", "schema_sha256", "description_sha256", "format_sha256"):
        match = re.search(rf'(?<!\w){field}="?([0-9a-f]{{64}})"?(?=\s|$)', fields)
        if match:
            result[field] = match[1]
    for field in ("tool_count", "catalog_bytes", "tool_index", "schema_bytes", "description_bytes",
                  "omitted_tools", "issue_count", "omitted_issues", "format_bytes", "visited_nodes",
                  "top_level_count", "records"):
        match = re.search(rf'(?<!\w){field}=(\d{{1,10}})(?=\s|$)', fields)
        if match:
            result[field] = int(match[1])
    for field in ("records_truncated", "traversal_truncated", "issues_truncated", "catalog_fingerprint_unavailable"):
        match = re.search(rf'(?<!\w){field}=(true|false)(?=\s|$)', fields)
        if match:
            result[field] = match[1] == "true"
    issue_field = re.search(r'(?<!\w)issues=(\[)', fields)
    if issue_field:
        try:
            issues, _ = json.JSONDecoder().raw_decode(fields[issue_field.start(1):])
        except (ValueError, TypeError):
            issues = []
        reasons = {"schema_not_object_or_boolean", "invalid_type", "invalid_required",
                   "schema_map_not_object", "combinator_not_array"}
        safe_path = re.compile(r'^\$(?:/(?:type|required|properties|\$defs|definitions|items|additionalProperties|anyOf|oneOf|allOf|[0-9]{1,3}|sha256:[0-9a-f]{64})){0,40}$')
        if isinstance(issues, list):
            validated = [{"reason": item["reason"], "path": item["path"]} for item in issues[:8]
                         if isinstance(item, dict) and item.get("reason") in reasons
                         and isinstance(item.get("path"), str) and safe_path.fullmatch(item["path"])]
            if validated:
                result["issues"] = validated
    return result


def inference_diagnostics(body: str, target: str) -> dict:
    """Export bounded inactivity evidence without provider content."""
    if target != "devin_native_progress":
        return {}
    marker = re.search(r'event="(native_inference_progress|native_inference_finished|native_inference_attempt_finished|native_inference_recovery_finished)"', body)
    if not marker:
        return {}
    fields = body[marker.end():]
    outcome = re.search(r'(?<!\w)outcome="([a-z_]+)"(?=\s|$)', fields)
    if marker[1] in {"native_inference_progress", "native_inference_finished"} and (
        not outcome or outcome[1] not in {"inference_output_idle", "provider_stream_idle", "provider_request_deadline", "provider_failure", "engine_deadline"} | CONNECTION_OUTCOMES
    ):
        return {}
    result: dict = {"event": marker[1]}
    if outcome and outcome[1] in {"inference_output_idle", "provider_stream_idle", "provider_request_deadline", "provider_failure", "engine_deadline", "retry_scheduled", "retry_exhausted", "failed", "completed"} | CONNECTION_OUTCOMES:
        result["outcome"] = outcome[1]
    for field in ("elapsed_ms", "network_idle_ms", "event_idle_ms", "bytes_received", "event_count",
                  "frames_received", "output_bytes", "attempt"):
        match = re.search(rf'(?<!\w){field}=(\d{{1,16}})(?=\s|$)', fields)
        if match:
            result[field] = int(match[1])
    retry = re.search(r'(?<!\w)retry_used=(true|false)(?=\s|$)', fields)
    if retry:
        result["retry_used"] = retry[1] == "true"
    last = re.search(r'(?<!\w)last_event="?([A-Za-z_]+)"?(?=\s|$)', fields)
    labels = {"None": "none", "Text": "text", "Reasoning": "reasoning",
              "ReasoningSignature": "reasoning_signature", "ToolCallStart": "tool_call_start",
              "ToolCallArgs": "tool_call_args", "Usage": "usage", "Finish": "finish"}
    if last:
        label = labels.get(last[1], last[1])
        if label in labels.values():
            result["last_event"] = label
    return result


TRANSPORT_ENUMS = {
    "connection_error": CONNECTION_CATEGORIES,
    "connection_error_code": {"ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "EPIPE", "UND_ERR_SOCKET", "ECONNREFUSED",
                              "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "ENETUNREACH", "EHOSTUNREACH", "ENETDOWN",
                              "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT",
                              "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
                              "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "ERR_SSL_WRONG_VERSION_NUMBER", "ERR_PROXY_CONNECTION_FAILED"},
    "read_state": {"idle", "pending", "received", "eof", "error", "cancelled"},
    "parser_state": {"idle", "pending", "yielded", "done", "error"},
    "last_sse_event": {"none", "message_start", "content_block_start", "content_block_delta",
                       "content_block_stop", "message_delta", "message_stop", "ping", "error", "google_data", "unknown"},
    "last_parser_event": {"none", "text_delta", "thinking_delta", "reasoning_raw_delta", "thinking_signature",
                          "tool_call_start", "tool_call_delta", "tool_call_end", "heartbeat", "usage", "done", "error", "unknown"},
    "content_block_kind": {"none", "text", "thinking", "redacted_thinking", "tool_use", "unknown"},
    "abort_source": {"none", "deadline", "transport", "cancelled", "unknown"},
    "error_stage": {"none", "build", "headers", "body_read", "sse_decode", "adapter_parse", "translate", "map", "unknown"},
    "error_name": {"none", "abort", "timeout", "type_error", "adapter_error", "unknown"},
}
TRANSPORT_NUMBERS = {"headers_status", "headers_ms", "read_wait_ms", "read_count", "chunk_count",
                     "last_chunk_bytes", "sse_event_count", "heartbeat_count", "unknown_sse_count",
                     "sse_idle_ms", "sse_pending_bytes", "parser_wait_ms", "parser_event_count"}


def transport_diagnostics(body: str, target: str) -> dict:
    """Temporary, removable export of validated transport boundary observations."""
    if target != "devin_native_progress":
        return {}
    marker = re.search(r'event="native_inference_transport"', body)
    if not marker:
        return {}
    fields = body[marker.end():]
    payload = re.search(r'(?<!\w)transport=', fields)
    if not payload:
        return {}
    try:
        data, _ = json.JSONDecoder().raw_decode(fields[payload.end():])
    except (ValueError, RecursionError):
        return {}
    if not isinstance(data, dict):
        return {}
    safe = {}
    for field, value in data.items():
        if field in TRANSPORT_ENUMS and isinstance(value, str) and value in TRANSPORT_ENUMS[field]:
            safe[field] = value
        elif field in TRANSPORT_NUMBERS and type(value) is int and 0 <= value <= 2**53 - 1:
            if field != "headers_status" or 100 <= value <= 599:
                safe[field] = value
        elif field in {"content_block_open", "finish_seen"} and type(value) is bool:
            safe[field] = value
        elif field in {"request_id_sha256", "server_sha256", "via_sha256"} and isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value):
            safe[field] = value
    if not safe:
        return {}
    result = {"transport": safe}
    outcome = re.search(r'(?<!\w)outcome="([a-z_]+)"(?=\s|$)', fields)
    if outcome and outcome[1] in {"running", "completed", "inference_output_idle", "engine_deadline",
                                "provider_request_deadline", "provider_failure", "provider_stream_idle",
                                "provider_headers_timeout", "cancelled", "helper_error"} | CONNECTION_OUTCOMES:
        result["outcome"] = outcome[1]
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, default=Path.home() / ".azrael-ex")
    parser.add_argument("--minutes", type=int, default=60)
    parser.add_argument("--limit", type=int, default=5000)
    parser.add_argument("--events", type=int, default=80)
    args = parser.parse_args()
    if not 1 <= args.minutes <= 7 * 24 * 60 or not 1 <= args.limit <= 20000 or not 0 <= args.events <= 200:
        parser.error("minutes, limit, or events is outside the allowed range")
    state = args.state.resolve(strict=True)
    ordinary = (Path.home() / ".codex").resolve()
    if not state.is_dir() or state == ordinary or ordinary in state.parents:
        parser.error("state must be an Azrael directory")
    database = state / "logs_2.sqlite"
    if not database.is_file():
        parser.error("Azrael log database is missing")
    since = int((dt.datetime.now(UTC) - dt.timedelta(minutes=args.minutes)).timestamp())
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=5) as conn:
        conn.execute("PRAGMA query_only=ON")
        total = conn.execute("SELECT COUNT(*) FROM logs WHERE ts >= ?", (since,)).fetchone()[0]
        latest = conn.execute("SELECT MAX(ts) FROM logs").fetchone()[0]
        rows = conn.execute(
            "SELECT ts, level, target, substr(feedback_log_body, -4096), thread_id "
            "FROM logs WHERE ts >= ? ORDER BY id DESC LIMIT ?",
            (since, args.limit),
        ).fetchall()
    counts: Counter[str] = Counter()
    events = []
    for ts, level, target, body, thread_id in rows:
        if level not in ("WARN", "ERROR") and target == "feedback_tags":
            continue
        detail = provider_error(body or "", target)
        schema = tool_diagnostics(body or "", target)
        inference = inference_diagnostics(body or "", target)
        transport = transport_diagnostics(body or "", target)
        kind = category(body or "")
        if schema:
            kind = "tool_schema"
        if inference:
            kind = "inference_recovery" if inference["event"] in {
                "native_inference_attempt_finished", "native_inference_recovery_finished"
            } else "inference_idle" if inference.get("outcome") in {
                "inference_output_idle", "provider_stream_idle"
            } else "inference_failure"
        if transport:
            kind = "inference_transport"
        if detail.get("code") in {"invalid_argument", "failed_precondition", "out_of_range", "invalid_request_error"}:
            kind = "provider_request"
        if level not in ("WARN", "ERROR") and kind is None:
            continue
        kind = kind or "other"
        counts[kind] += 1
        if len(events) < args.events:
            event = {
                "time": timestamp(ts),
                "level": level if level in ("WARN", "ERROR", "INFO", "DEBUG", "TRACE") else "unknown",
                "category": kind,
                "target": target if isinstance(target, str) and SAFE_TARGET.fullmatch(target) else "unknown",
                "threadRef": hashlib.sha256(thread_id.encode()).hexdigest()[:10] if isinstance(thread_id, str) else None,
            }
            if detail:
                event["providerError"] = detail
            if schema:
                event["toolDiagnostics"] = schema
            if inference:
                event["inferenceDiagnostics"] = inference
            if transport:
                event["transportDiagnostics"] = transport
            if schema or detail or inference or transport:
                request = re.search(r'(?<!\w)request_id="?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"?(?=\s|$)', body or "")
                if request:
                    event["requestRef"] = hashlib.sha256(request[1].encode()).hexdigest()[:10]
            events.append(event)
    print(json.dumps({
        "state": "azrael",
        "since": timestamp(since),
        "latestRecorded": timestamp(latest) if latest is not None else None,
        "rowsInPeriod": total,
        "rowsInspected": len(rows),
        "truncated": total > len(rows),
        "categories": dict(counts),
        "eventsNewestFirst": events,
        "rawMessagesIncluded": False,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
