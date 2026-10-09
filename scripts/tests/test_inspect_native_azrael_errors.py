"""Exercise the read-only inspector against isolated diagnostic SQLite logs."""

import datetime as dt
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "inspect-native-azrael-errors.py"


class InspectorTests(unittest.TestCase):
    def test_thinking_wait_evidence_is_separate_bounded_and_private(self):
        records = [
            ("devin_native_progress", 'event="native_inference_thinking_wait" outcome="inference_output_idle" '
             'open=true heartbeat_count=3 heartbeat_idle_ms=7345 generation_idle_ms=100020 generation_event_count=0 '
             'thinking="SECRET"', "INFO"),
            ("devin_native_progress", 'event="native_inference_wait_extended" reason="anthropic_thinking_heartbeat" '
             'generation_idle_ms=110000 generation_event_count=0', "INFO"),
            ("devin_native_progress", 'event="native_inference_wait_extended" reason="SECRET" '
             'heartbeat_count=9999999999999999', "INFO"),
        ]
        report, stdout = self.inspect(records)
        self.assertEqual(report["categories"], {"inference_wait": 3})
        events = report["eventsNewestFirst"]
        self.assertEqual(events[0]["inferenceDiagnostics"], {"event": "native_inference_wait_extended"})
        self.assertEqual(events[1]["inferenceDiagnostics"], {
            "event": "native_inference_wait_extended", "reason": "anthropic_thinking_heartbeat",
            "generation_idle_ms": 110000, "generation_event_count": 0,
        })
        self.assertEqual(events[2]["inferenceDiagnostics"], {
            "event": "native_inference_thinking_wait", "outcome": "inference_output_idle", "open": True,
            "heartbeat_count": 3, "heartbeat_idle_ms": 7345, "generation_idle_ms": 100020, "generation_event_count": 0,
        })
        self.assertNotIn("SECRET", stdout)

    def test_connection_evidence_and_outcomes_are_allowlisted(self):
        outcomes = ["provider_connection_" + category for category in
                    ("dns", "tls", "reset", "refused", "timeout", "unreachable", "proxy")] + ["provider_headers_failed"]
        records = [("devin_native_progress", f'event="native_inference_finished" outcome="{outcome}"', "INFO") for outcome in outcomes]
        records += [("devin_native_progress", 'event="native_inference_transport" outcome="provider_connection_dns" '
                     'transport={"connection_error":"dns","connection_error_code":"ENOTFOUND","host":"SECRET"}', "INFO"),
                    ("devin_native_progress", 'event="native_inference_transport" outcome="provider_connection_SECRET" '
                     'transport={"error_stage":"headers","connection_error":"SECRET","connection_error_code":"SECRET"}', "INFO")]
        report, stdout = self.inspect(records)
        events = report["eventsNewestFirst"]
        self.assertEqual(events[0]["transportDiagnostics"], {"transport": {"error_stage": "headers"}})
        self.assertEqual(events[1]["transportDiagnostics"], {"transport": {"connection_error": "dns", "connection_error_code": "ENOTFOUND"}, "outcome": "provider_connection_dns"})
        self.assertEqual({event["inferenceDiagnostics"]["outcome"] for event in events[2:]}, set(outcomes))
        self.assertNotIn("SECRET", stdout)

    def inspect(self, records):
        with tempfile.TemporaryDirectory(prefix="azrael-reason-test-") as root:
            database = Path(root) / "logs_2.sqlite"
            with closing(sqlite3.connect(database)) as conn, conn:
                conn.execute("CREATE TABLE logs (id INTEGER PRIMARY KEY, ts INTEGER, level TEXT, target TEXT, feedback_log_body TEXT, thread_id TEXT)")
                now = int(dt.datetime.now(dt.timezone.utc).timestamp())
                for index, record in enumerate(records):
                    target, message = record[:2]
                    level = record[2] if len(record) > 2 else "WARN"
                    conn.execute("INSERT INTO logs VALUES (?, ?, ?, ?, ?, 'private-thread')",
                                 (index, now, level, target, message))
            before = database.read_bytes()
            result = subprocess.run([sys.executable, "-B", str(SCRIPT), "--state", root],
                                    capture_output=True, text=True, check=True)
            self.assertEqual(database.read_bytes(), before, "inspector must not write to state")
            return json.loads(result.stdout), result.stdout

    def test_failure_reason_after_long_span_prefix_and_legacy_record(self):
        report, stdout = self.inspect([
            ("devin_native_progress", 'event="native_inference_helper_failed" code="provider_http_400" http_status=Some(400)'),
            ("devin_native_progress", "private-span=" + "x" * 5000 + ' event="native_inference_helper_failed" '
             'code="provider_http_400" provider_error_code=Some("invalid_argument") '
             'provider_error_source=Some("connect_trailer") provider_reason=Some("internal_error") '
             'provider_trace_id=Some("0123456789abcdef0123456789abcdef")'),
        ])
        events = report["eventsNewestFirst"]
        self.assertEqual(events[0]["providerError"], {
            "code": "invalid_argument", "source": "connect_trailer", "reason": "internal_error",
            "traceId": "0123456789abcdef0123456789abcdef",
        })
        self.assertEqual(events[0]["category"], "provider_request")
        self.assertNotIn("providerError", events[1])
        self.assertNotIn("private-span", stdout)
        self.assertNotIn("private-thread", stdout)
        self.assertFalse(report["rawMessagesIncluded"])

    def test_untrusted_diagnostics_are_not_exported(self):
        report, stdout = self.inspect([
            ("devin_native_progress", 'event="native_inference_helper_failed" '
             'provider_error_code=Some("SECRET_code") provider_error_source=Some("SECRET_source") '
             'provider_reason=Some("SECRET_reason") provider_trace_id=Some("' + "a" * 65 + '")'),
            ("different_target", 'event="native_inference_helper_failed" '
             'provider_error_code=Some("invalid_argument") provider_reason=Some("internal_error")'),
        ])
        self.assertTrue(all("providerError" not in event for event in report["eventsNewestFirst"]))
        self.assertNotIn("SECRET", stdout)

    def test_info_tool_diagnostics_export_only_validated_structure(self):
        digest = "a" * 64
        report, stdout = self.inspect([
            ("devin_native_progress", 'private-span=SECRET event="native_tool_catalog" '
             f'tool_count=2 catalog_bytes=123 catalog_sha256={digest} omitted_tools=0 '
             'request_id=01234567-0123-4567-89ab-0123456789ab', "INFO"),
            ("devin_native_progress", 'event="native_tool_schema" tool_index=1 schema_bytes=60 '
             f'schema_sha256="{digest}" description_sha256="SECRET" tool_name="SECRET" schema="SECRET"', "INFO"),
        ])
        self.assertEqual(report["categories"], {"tool_schema": 2})
        self.assertEqual(report["eventsNewestFirst"][0]["toolDiagnostics"], {
            "event": "native_tool_schema", "schema_sha256": digest, "tool_index": 1, "schema_bytes": 60,
        })
        self.assertNotIn("SECRET", stdout)
        self.assertNotIn("private-thread", stdout)
        self.assertRegex(report["eventsNewestFirst"][1]["requestRef"], r"^[0-9a-f]{10}$")
        self.assertEqual(report["eventsNewestFirst"][1]["toolDiagnostics"]["catalog_sha256"], digest)

    def test_idle_progress_surfaces_safe_evidence_at_info_level(self):
        report, stdout = self.inspect([
            ("devin_native_progress", 'private-span=SECRET event="native_inference_progress" '
             'outcome="inference_output_idle" elapsed_ms=120012 network_idle_ms=6513 '
             'event_idle_ms=96505 bytes_received=3297 event_count=5 last_event=ToolCallArgs '
             'request_id="01234567-0123-4567-89ab-0123456789ab"', "INFO"),
            ("devin_native_progress", 'event="native_inference_progress" outcome="running" '
             'event_count=6 last_event=Reasoning', "INFO"),
        ])
        self.assertEqual(report["categories"], {"inference_idle": 1})
        self.assertEqual(report["eventsNewestFirst"][0]["inferenceDiagnostics"], {
            "event": "native_inference_progress", "outcome": "inference_output_idle",
            "elapsed_ms": 120012, "network_idle_ms": 6513, "event_idle_ms": 96505,
            "bytes_received": 3297, "event_count": 5, "last_event": "tool_call_args",
        })
        self.assertRegex(report["eventsNewestFirst"][0]["requestRef"], r"^[0-9a-f]{10}$")
        self.assertNotIn("SECRET", stdout)

    def test_retry_evidence_withholds_unknown_labels(self):
        report, stdout = self.inspect([
            ("different_target", 'event="native_inference_attempt_finished" outcome="retry_scheduled" attempt=1', "INFO"),
            ("devin_native_progress", 'event="native_inference_recovery_finished" outcome="SECRET" '
             'last_event="SECRET" attempt=2 retry_count=1 delay_ms=1000 reason="SECRET"', "INFO"),
        ])
        self.assertEqual(report["eventsNewestFirst"][0]["inferenceDiagnostics"], {
            "event": "native_inference_recovery_finished", "attempt": 2,
        })
        self.assertEqual(len(report["eventsNewestFirst"]), 1)
        self.assertNotIn("SECRET", stdout)

    def test_retry_attempt_and_final_outcome_are_correlated(self):
        report, _ = self.inspect([
            ("devin_native_progress", 'event="native_inference_attempt_finished" '
             'attempt=1 outcome="retry_scheduled"', "INFO"),
            ("devin_native_progress", 'event="native_inference_recovery_finished" '
             'attempt=2 retry_used=true outcome="completed"', "INFO"),
        ])
        self.assertEqual(report["categories"], {"inference_recovery": 2})
        self.assertEqual([event["inferenceDiagnostics"] for event in report["eventsNewestFirst"]], [
            {"event": "native_inference_recovery_finished", "outcome": "completed", "attempt": 2, "retry_used": True},
            {"event": "native_inference_attempt_finished", "outcome": "retry_scheduled", "attempt": 1},
        ])

    def test_schema_issue_paths_are_revalidated(self):
        safe = {"reason": "invalid_type", "path": "$/properties/sha256:" + "a" * 64 + "/type"}
        issues = [safe, {"reason": "SECRET", "path": "$"},
                  {"reason": "invalid_type", "path": "$/properties/SECRET/type"}]
        report, stdout = self.inspect([("devin_native_progress", 'event="native_tool_schema" '
                                      'issues=' + json.dumps(issues, separators=(",", ":")) + ' issues_truncated=false', "INFO")])
        self.assertEqual(report["eventsNewestFirst"][0]["toolDiagnostics"]["issues"], [safe])
        self.assertFalse(report["eventsNewestFirst"][0]["toolDiagnostics"]["issues_truncated"])

    def test_transport_boundaries_are_exported_without_raw_content(self):
        transport = {"read_state": "pending", "read_wait_ms": 80000, "headers_status": 200,
                     "heartbeat_count": 3, "sse_event_count": 4, "parser_state": "pending",
                     "content_block_kind": "thinking", "content_block_open": True,
                     "request_id_sha256": "a" * 64, "abort_source": "none"}
        report, stdout = self.inspect([("devin_native_progress", 'event="native_inference_transport" '
            'request_id=01234567-0123-4567-89ab-0123456789ab transport=' + json.dumps(transport), "INFO")])
        event = report["eventsNewestFirst"][0]
        self.assertEqual(event["transportDiagnostics"], {"transport": transport})
        self.assertEqual(event["category"], "inference_transport")
        self.assertRegex(event["requestRef"], r"^[0-9a-f]{10}$")
        self.assertNotIn("private-thread", stdout)

    def test_deadline_transport_and_failure_are_correlated(self):
        request = 'request_id=01234567-0123-4567-89ab-0123456789ab '
        report, stdout = self.inspect([
            ("devin_native_progress", 'event="native_inference_progress" ' + request
             + 'outcome="provider_request_deadline" elapsed_ms=900000 event_count=13', "INFO"),
            ("devin_native_progress", 'event="native_inference_transport" ' + request
             + 'outcome="provider_request_deadline" transport={"abort_source":"deadline","error_name":"timeout"}', "INFO"),
        ])
        events = report["eventsNewestFirst"]
        self.assertEqual(events[0]["requestRef"], events[1]["requestRef"])
        self.assertEqual(events[0]["transportDiagnostics"]["outcome"], "provider_request_deadline")
        self.assertEqual(events[1]["category"], "inference_failure")
        self.assertNotIn("private-thread", stdout)

    def test_transport_field_validation_drops_secrets_and_invalid_values(self):
        data = {"error_stage": "adapter_parse", "error_name": "SECRET", "headers_status": 700,
                "chunk_count": True, "read_wait_ms": -1, "parser_event_count": 2**54,
                "content_block_open": "SECRET", "request_id_sha256": "SECRET",
                "url": "SECRET", "text": "SECRET", "args": "SECRET"}
        report, stdout = self.inspect([("devin_native_progress", 'event="native_inference_transport" '
            'transport=' + json.dumps(data), "INFO")])
        self.assertEqual(report["eventsNewestFirst"][0]["transportDiagnostics"], {
            "transport": {"error_stage": "adapter_parse"},
        })
        self.assertNotIn("SECRET", stdout)
        self.assertNotIn("SECRET", stdout)


if __name__ == "__main__":
    unittest.main()
