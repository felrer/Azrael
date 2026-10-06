"""Content exclusion and read-only correlation checks for delivery inspection."""

import datetime as dt
from contextlib import closing
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("inspect-input-delivery.py")
spec = importlib.util.spec_from_file_location("input_delivery_inspection", SCRIPT)
inspection = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inspection)


class InputInspectionTests(unittest.TestCase):
    def test_ui_disappearance_record_hashes_ids_and_omits_payload(self):
        thread = "01a10677-33be-7521-badb-e3f96abd7577"
        client = "01a109ca-898c-7601-8cf9-31169588603c"
        record = inspection.ui_fields("2026-10-05 15:00:00.000 [warning] [azrael-ui-input] " + json.dumps({
            "event": "state_removed", "threadId": thread, "clientId": client,
            "beforeRepresentationCount": 1, "afterRepresentationCount": 0,
            "beforeKinds": ["params", "user"], "afterKinds": [], "mutationKind": "optimized_history",
            "historyInvalidationType": "entityKeys", "shouldHideCallback": None,
            "inputClassifier": False, "linkedOpeningSteering": True,
            "input": "PRIVATE_INPUT_CANARY", "receiptAccepted": "PRIVATE_INPUT_CANARY",
        }))
        self.assertEqual(record["threadRef"], hashlib.sha256(thread.encode()).hexdigest()[:16])
        self.assertEqual(record["clientMessageHash"], hashlib.sha256(client.encode()).hexdigest())
        self.assertEqual(record["beforeRepresentationCount"], 1)
        self.assertEqual(record["beforeKinds"], ["params", "user"])
        self.assertEqual(record["mutationKind"], "optimized_history")
        self.assertIsNone(record["shouldHideCallback"])
        self.assertTrue(record["linkedOpeningSteering"])
        self.assertNotIn(thread, json.dumps(record))
        self.assertNotIn(client, json.dumps(record))
        self.assertNotIn("PRIVATE_INPUT_CANARY", json.dumps(record))
        self.assertEqual(inspection.ui_fields('[azrael-ui-input] {"event":[]}'), {})

    def test_host_record_omits_payload_and_unrecognized_values(self):
        private = "sk-private-diagnostic-sentinel"
        fields = inspection.host_fields("2026-10-04 20:00:00.000 [info] " + json.dumps({
            "event": "host.rpc_response_received", "requestRef": "a" * 16,
            "method": {"secret": private}, "outcome": private,
            "result": {"message": private}, "rpcCode": -32001,
        }))
        self.assertEqual(fields, {"event": "host.rpc_response_received", "requestRef": "a" * 16, "rpcCode": -32001})
        self.assertNotIn(private, json.dumps(fields))
        self.assertEqual(inspection.host_fields(json.dumps({"event": [private]})), {})

    def test_native_allowlist_does_not_export_span_or_payload_text(self):
        body = ('prompt="private prompt" event="input.handler_abandoned" request_ref="' + 'a' * 16
                + '" thread_ref="' + 'b' * 16 + '" panicking=true elapsed_ms=30 outcome="private value"')
        self.assertEqual(inspection.native_fields(body), {
            "event": "input.handler_abandoned", "requestRef": "a" * 16, "threadRef": "b" * 16,
            "panicking": True, "elapsedMs": 30,
        })
        self.assertEqual(inspection.native_fields(
            'stage="response_route" requestRef=' + '1' * 16 + ' connection=7 outcome="queued" boundary="writer_queue"'
        ), {"event": "response_route", "requestRef": "1" * 16, "connectionId": 7,
            "outcome": "queued", "boundary": "writer_queue"})

    def test_cli_correlates_response_route_and_bounds_output_without_writes(self):
        thread = "01a10677-33be-7521-badb-e3f96abd7577"
        thread_ref = hashlib.sha256(thread.encode()).hexdigest()[:16]
        request_ref = "c" * 16
        now = dt.datetime.now(dt.timezone.utc)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "logs_2.sqlite"
            with closing(sqlite3.connect(database)) as conn, conn:
                conn.execute("CREATE TABLE logs (id INTEGER PRIMARY KEY, ts INTEGER, ts_nanos INTEGER, level TEXT, feedback_log_body TEXT, target TEXT)")
                conn.executemany("INSERT INTO logs VALUES (?, ?, ?, ?, ?, ?)", [
                    (1, int(now.timestamp()), 10, "INFO", f'stage="input.handler_started" requestRef={request_ref} threadRef="{thread_ref}"', "azrael_input_delivery"),
                    (2, int(now.timestamp()), 20, "DEBUG", f'stage="response_route" requestRef="{request_ref}" connection=7 outcome="queued" boundary="writer_queue"', "azrael_input_delivery"),
                    (3, int(now.timestamp()), 30, "INFO", 'event="input.handler_started" request_ref="dddddddddddddddd" prompt="private-native-body"', "azrael_input_delivery"),
                ])
            before = database.read_bytes()
            host = root / "host.log"
            local = now.astimezone(inspection.HOST_TIMEZONE).strftime("%Y-%m-%d %H:%M:%S.%f")[:23]
            host.write_text(local + " [info] " + json.dumps({"event": "host.rpc_response_received", "threadId": thread,
                "requestRef": request_ref, "tracking": "pending", "result": "private-host-body"}) + "\n", encoding="utf-8")
            result = subprocess.run([sys.executable, "-B", str(SCRIPT), "--state", str(root), "--thread", thread,
                "--host-log", str(host), "--events", "2"], capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(result.returncode, 0, result.stderr)
            output = json.loads(result.stdout)
            self.assertEqual(output["matchedEvents"], 3)
            self.assertEqual(output["omittedEvents"], 1)
            self.assertEqual(len(output["events"]), 2)
            self.assertEqual(output["events"][0]["event"], "response_route")
            self.assertNotIn("private", result.stdout)
            self.assertNotIn(thread, result.stdout)
            self.assertEqual(database.read_bytes(), before)
            ui = root / "Azrael.log"
            ui.write_text(local + " [warning] [azrael-ui-input] " + json.dumps({
                "event": "opening_suppressed", "threadId": thread,
                "clientId": "01a109ca-898c-7601-8cf9-31169588603c", "inputHidden": True,
                "input": "private-ui-body", "beforeKinds": ["params", "private-kind"],
            }) + "\n", encoding="utf-8")
            combined = subprocess.run([sys.executable, "-B", str(SCRIPT), "--state", str(root), "--thread", thread,
                "--host-log", str(host), "--ui-log", str(ui), "--events", "10"],
                capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(combined.returncode, 0, combined.stderr)
            combined_output = json.loads(combined.stdout)
            self.assertEqual(combined_output["matchedEvents"], 4)
            ui_event = next(event for event in combined_output["events"] if event["source"] == "ui")
            self.assertTrue(ui_event["inputHidden"])
            self.assertNotIn("beforeKinds", ui_event)
            self.assertNotIn("private", combined.stdout)
            self.assertNotIn(thread, combined.stdout)
            self.assertEqual(database.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
