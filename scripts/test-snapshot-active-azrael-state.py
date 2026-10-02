import json
import sqlite3
import subprocess
import sys
import tempfile
from contextlib import closing
from pathlib import Path


def main():
    with tempfile.TemporaryDirectory(prefix="az01-online-snapshot-") as temporary:
        root = Path(temporary)
        source = root / "active"
        target = root / "copy"
        (source / "sessions").mkdir(parents=True)
        (source / "sessions" / "thread.jsonl").write_text('{"id":"saved"}\n', encoding="utf-8")
        (source / "auth.json").write_text('{"fixture":true}', encoding="utf-8")
        connection = sqlite3.connect(source / "state_5.sqlite")
        try:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("CREATE TABLE thread (id TEXT)")
            connection.execute("INSERT INTO thread VALUES ('saved')")
            connection.commit()
            result = subprocess.run(
                [sys.executable, str(Path(__file__).with_name("snapshot-active-azrael-state.py")), str(source), str(target)],
                capture_output=True, text=True, check=True,
            )
            report = json.loads(result.stdout)
            assert report["status"] == "individual-files-consistent"
            assert (source / "state_5.sqlite-wal").exists()
            assert not (target / "state_5.sqlite-wal").exists()
            with closing(sqlite3.connect(target / "state_5.sqlite")) as copied:
                assert copied.execute("SELECT id FROM thread").fetchone() == ("saved",)
            assert (target / "sessions" / "thread.jsonl").read_text(encoding="utf-8") == '{"id":"saved"}\n'
            receipt = json.loads(Path(report["receipt"]).read_text(encoding="utf-8"))
            assert receipt["atomicAcrossDatabases"] is False
            print(json.dumps({"status": "passed", "scope": "live WAL backup and stable session file"}))
        finally:
            connection.close()


if __name__ == "__main__":
    main()
