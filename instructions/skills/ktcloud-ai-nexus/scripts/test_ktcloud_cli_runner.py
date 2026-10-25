from __future__ import annotations

import contextlib
import importlib.util
import os
import signal
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


RUNNER_PATH = Path(__file__).with_name("ktcloud_cli_runner.py")
SPEC = importlib.util.spec_from_file_location("ktcloud_cli_runner", RUNNER_PATH)
assert SPEC is not None and SPEC.loader is not None
RUNNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNNER)


class DownloadQueryCompatibilityTests(unittest.TestCase):
    def make_request_class(self):
        class Request:
            def __init__(self, method="POST", path="/session/session-a/download", params=None):
                self.method, self.path, self.params = method, path, params

            def set_json(self, value):
                self.body = value

        module = mock.Mock(Request=Request)
        with mock.patch.object(RUNNER.importlib, "import_module", return_value=module):
            RUNNER.patch_session_download_request()
            patched = Request.set_json
            RUNNER.patch_session_download_request()
            self.assertIs(Request.set_json, patched)
        return Request

    def test_files_are_repeated_query_keys_and_legacy_body_is_preserved(self):
        request = self.make_request_class()(params={"owner_access_key": "test-only"})
        body = {"files": ["id_container", "folder/한 글.txt"]}
        request.set_json(body)
        self.assertEqual(request.params, [
            ("owner_access_key", "test-only"),
            ("files", "id_container"), ("files", "folder/한 글.txt"),
        ])
        self.assertIs(request.body, body)
        request.set_json(body)
        self.assertEqual(len(request.params), 3)

    def test_legacy_kernel_path_is_supported(self):
        request = self.make_request_class()(path="kernel/a/download")
        request.set_json({"files": [Path("id_container")]})
        self.assertEqual(request.params, [("files", "id_container")])

    def test_other_endpoints_and_methods_are_unchanged(self):
        Request = self.make_request_class()
        for method, path in [("POST", "/session/a/upload"), ("GET", "/session/a/download"),
                             ("POST", "/vfolders/a/download"), ("POST", "/session/a/download_single")]:
            request = Request(method=method, path=path, params={"existing": "value"})
            request.set_json({"files": ["a"]})
            self.assertEqual(request.params, {"existing": "value"})


class IsolatedContainerSshContextTests(unittest.TestCase):
    def test_staging_directory_is_private_and_caller_cwd_is_restored(self) -> None:
        caller_cwd = Path.cwd()
        observations: dict[str, Path | bool] = {}

        @contextlib.contextmanager
        def fake_context(session_ref: str, port: int):
            self.assertEqual(session_ref, "session-a")
            self.assertEqual(port, 10001)
            staging_cwd = Path.cwd()
            observations["staging_cwd"] = staging_cwd
            Path("id_container").write_text("test-key", encoding="utf-8")
            try:
                yield staging_cwd / "id_container"
            finally:
                observations["cleanup_cwd"] = Path.cwd()
                observations["key_existed_during_cleanup"] = (
                    staging_cwd / "id_container"
                ).exists()

        with RUNNER.isolated_container_ssh_context(
            fake_context,
            "session-a",
            10001,
        ) as key_path:
            self.assertEqual(Path.cwd(), caller_cwd)
            self.assertTrue(key_path.exists())
            self.assertNotEqual(key_path.parent, caller_cwd)
            self.assertTrue(key_path.parent.name.startswith("ktcloud-backendai-ssh-"))

        staging_cwd = observations["staging_cwd"]
        self.assertIsInstance(staging_cwd, Path)
        self.assertEqual(observations["cleanup_cwd"], caller_cwd)
        self.assertTrue(observations["key_existed_during_cleanup"])
        self.assertFalse(staging_cwd.exists())
        self.assertEqual(Path.cwd(), caller_cwd)

    def test_two_calls_use_different_staging_directories(self) -> None:
        staging_directories: list[Path] = []

        @contextlib.contextmanager
        def fake_context(_session_ref: str, _port: int):
            staging_directories.append(Path.cwd())
            Path("id_container").write_text("test-key", encoding="utf-8")
            yield Path.cwd() / "id_container"

        for port in (10001, 10002):
            with RUNNER.isolated_container_ssh_context(
                fake_context,
                "session-a",
                port,
            ):
                pass

        self.assertEqual(len(staging_directories), 2)
        self.assertNotEqual(staging_directories[0], staging_directories[1])


class OwnedCleanupContractTests(unittest.TestCase):
    """Targeted contracts: Windows teardown, exact key ownership and isolation."""

    def test_proxy_uses_caller_cwd_while_download_retains_staging_cwd(self):
        process = mock.Mock()
        job = mock.Mock(processes=[])
        caller_cwd = Path.cwd()
        with mock.patch.object(RUNNER.subprocess, "Popen", return_value=process) as popen:
            with RUNNER.assign_connection_processes_to_job(job, proxy_cwd=caller_cwd):
                RUNNER.subprocess.Popen(["python", "runner", "app", "test", "sshd", "-b", "test"])
                RUNNER.subprocess.Popen(["python", "runner", "session", "download", "test", "id_container"])
            self.assertEqual(popen.call_args_list[0].kwargs["cwd"], caller_cwd)
            self.assertNotIn("cwd", popen.call_args_list[1].kwargs)
        self.assertEqual(job.processes, [process])

    @unittest.skipUnless(os.name == "nt", "Windows scratch cwd lock on failed connection")
    def test_failed_connection_drains_proxy_tree_and_removes_scratch(self):
        import psutil

        caller_cwd = Path.cwd()
        observations = {}
        script = (
            "import subprocess,sys,time,os; "
            "child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)']); "
            "open(sys.argv[1],'w').write(str(child.pid)); "
            "open(sys.argv[2],'w').write(os.getcwd()); time.sleep(30)"
        )

        @contextlib.contextmanager
        def context(_session_ref, _port):
            scratch = Path.cwd()
            observations["scratch"] = scratch
            key = scratch / "id_container"
            key.write_text("local fixture", encoding="utf-8")
            process = RUNNER.subprocess.Popen(
                [sys.executable, "-c", script, str(scratch / "child.pid"),
                 str(scratch / "proxy.cwd"), "app", "local-fixture", "sshd", "-b"]
            )
            observations["process"] = process
            deadline = RUNNER.time.monotonic() + 5
            while not (scratch / "proxy.cwd").exists():
                if RUNNER.time.monotonic() >= deadline:
                    self.fail("Local failure fixture did not start")
                RUNNER.time.sleep(0.01)
            observations["child"] = psutil.Process(int((scratch / "child.pid").read_text()))
            self.assertEqual(Path((scratch / "proxy.cwd").read_text()), caller_cwd)
            try:
                yield key
            finally:
                RUNNER.stop_connection_process(process)
                key.unlink()

        with mock.patch.object(RUNNER, "harden_windows_private_key"):
            with self.assertRaises(SystemExit) as raised:
                with RUNNER.isolated_container_ssh_context(context, "local-fixture", 10001):
                    raise SystemExit(143)
        self.assertEqual(raised.exception.code, 143)
        self.assertEqual(Path.cwd(), caller_cwd)
        self.assertFalse(observations["scratch"].exists())
        self.assertIsNotNone(observations["process"].returncode)
        # psutil may return None when Windows already removed the process
        # handle. Completion without TimeoutExpired plus identity-aware liveness
        # proves teardown; an exit-code value is not guaranteed for descendants.
        observations["child"].wait(timeout=1)
        self.assertFalse(observations["child"].is_running())

    def test_windows_proxy_sigint_uses_bounded_termination_and_wait(self) -> None:
        process = mock.Mock()
        process.poll.return_value = None
        job = mock.Mock(processes=[])
        with mock.patch.object(RUNNER.subprocess, "Popen", return_value=process):
            with RUNNER.assign_connection_processes_to_job(job):
                created = RUNNER.subprocess.Popen(["backend.ai", "app", "test", "sshd", "-b", "test"])
                created.send_signal(signal.SIGINT)
        process.terminate.assert_called_once_with()
        process.wait.assert_called_once_with(timeout=5)
        self.assertEqual(job.processes, [process])

    @unittest.skipUnless(os.name == "nt", "Windows Job Object tree cleanup")
    def test_job_drains_proxy_descendant_before_removing_scratch(self) -> None:
        import psutil

        with tempfile.TemporaryDirectory(prefix="ktcloud-cleanup-test-") as scratch:
            pid_file = Path(scratch) / "child.pid"
            script = (
                "import subprocess,sys,time; "
                "child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)']); "
                "open(sys.argv[1],'w').write(str(child.pid)); time.sleep(30)"
            )
            child = None
            process = None
            try:
                with RUNNER.WindowsKillOnCloseJob() as job:
                    with RUNNER.assign_connection_processes_to_job(job):
                        process = RUNNER.subprocess.Popen(
                            [sys.executable, "-c", script, str(pid_file), "app", "test", "sshd", "-b"],
                            cwd=scratch,
                        )
                    deadline = RUNNER.time.monotonic() + 5
                    while not pid_file.exists() or not pid_file.stat().st_size:
                        if RUNNER.time.monotonic() >= deadline:
                            self.fail("Local fixture did not start")
                        RUNNER.time.sleep(0.01)
                    child = psutil.Process(int(pid_file.read_text()))
                    self.assertTrue(child.is_running())
                self.assertIsNotNone(process.returncode)
                child.wait(timeout=1)
                self.assertFalse(child.is_running())
            finally:
                if process is not None and process.poll() is None:
                    RUNNER.stop_connection_process(process)
                if child is not None and child.is_running():
                    child.kill()
                    child.wait(timeout=5)
        self.assertFalse(Path(scratch).exists())

    def test_termination_timeout_falls_back_to_kill_and_wait(self) -> None:
        process = mock.Mock()
        process.poll.return_value = None
        process.wait.side_effect = [subprocess.TimeoutExpired("owned", 5), 1]
        RUNNER.stop_connection_process(process)
        process.kill.assert_called_once_with()
        self.assertEqual(process.wait.call_args_list, [mock.call(timeout=5), mock.call(timeout=5)])

    def test_entry_failure_removes_exact_key_and_restores_cwd(self) -> None:
        caller_cwd = Path.cwd()
        staging = []
        with tempfile.TemporaryDirectory() as home:
            home_path = Path(home)
            (home_path / ".ssh").mkdir()
            owned = home_path / ".ssh" / ("id_" + "a" * 32)
            unrelated = home_path / ".ssh" / ("id_" + "b" * 32)
            unrelated.write_text("unrelated fixture", encoding="utf-8")

            @contextlib.contextmanager
            def failed_context(_session_ref, _port):
                staging.append(Path.cwd())
                Path("id_container").write_text("owned fixture", encoding="utf-8")
                os.rename("id_container", owned)
                raise SystemExit(37)
                yield owned

            with mock.patch.object(RUNNER.Path, "home", return_value=home_path):
                with self.assertRaises(SystemExit) as raised:
                    with RUNNER.isolated_container_ssh_context(failed_context, "test", 10001):
                        self.fail("Failed entry must not yield")
            self.assertEqual(raised.exception.code, 37)
            self.assertFalse(owned.exists())
            self.assertTrue(unrelated.exists())
            self.assertFalse(staging[0].exists())
        self.assertEqual(Path.cwd(), caller_cwd)

    def test_acl_failure_removes_keys_and_retains_exception(self) -> None:
        paths = []

        @contextlib.contextmanager
        def context(_session_ref, _port):
            key = Path.cwd() / "id_container"
            key.write_text("owned fixture", encoding="utf-8")
            paths.append(key)
            yield key

        with mock.patch.object(RUNNER, "harden_windows_private_key", side_effect=ValueError("acl")):
            with self.assertRaisesRegex(ValueError, "acl"):
                with RUNNER.isolated_container_ssh_context(context, "test", 10001):
                    self.fail("Failed ACL must not yield")
        self.assertFalse(paths[0].exists())
        self.assertFalse(paths[0].parent.exists())

    def test_cleanup_completes_without_replacing_ssh_exit_status(self) -> None:
        caller_cwd = Path.cwd()
        paths = []

        @contextlib.contextmanager
        def context(_session_ref, _port):
            key = Path.cwd() / "id_container"
            key.write_text("owned fixture", encoding="utf-8")
            paths.append(key)
            try:
                yield key
            finally:
                key.unlink()

        with mock.patch.object(RUNNER, "harden_windows_private_key"):
            with self.assertRaises(SystemExit) as raised:
                with RUNNER.isolated_container_ssh_context(context, "test", 10001):
                    raise SystemExit(23)
        self.assertEqual(raised.exception.code, 23)
        self.assertFalse(paths[0].parent.exists())
        self.assertEqual(Path.cwd(), caller_cwd)


class StaleRuntimeCleanupTests(unittest.TestCase):
    """Baseline contracts: cleanup must preserve live connections and parents."""

    @staticmethod
    def process(pid, name, arguments, created=100, parent_pid=0):
        process = mock.Mock(pid=pid)
        process.info = {
            "pid": pid, "name": name, "cmdline": arguments, "create_time": created,
        }
        process.create_time.return_value = created
        process.ppid.return_value = parent_pid
        process.children.return_value = []
        return process

    def cleanup(self, processes, connections=()):
        import psutil

        def snapshot(attrs):
            # Requiring ppid here regresses startup on Windows even when no
            # managed proxy exists. Ordinary processes must not be inspected.
            self.assertNotIn("ppid", attrs)
            return iter(processes)

        with tempfile.TemporaryDirectory(prefix="ktcloud-cleanup-test-") as scratch:
            with contextlib.ExitStack() as stack:
                stack.enter_context(mock.patch.object(psutil, "process_iter", side_effect=snapshot))
                stack.enter_context(mock.patch.object(psutil, "net_connections", return_value=connections))
                stack.enter_context(mock.patch.object(psutil, "wait_procs", return_value=([], [])))
                stack.enter_context(mock.patch.object(RUNNER.time, "time", return_value=1000))
                stack.enter_context(mock.patch.object(RUNNER.Path, "home", return_value=Path(scratch)))
                stack.enter_context(mock.patch.object(RUNNER.tempfile, "gettempdir", return_value=scratch))
                return RUNNER.cleanup_stale_runtime_artifacts(minimum_age_seconds=60)

    def test_unrelated_processes_need_no_parent_or_repeat_command_lookup(self):
        ordinary = self.process(1, "python.exe", ["python.exe", "unrelated.py"])
        ordinary.ppid.side_effect = AssertionError("Unrelated parent lookup")
        ordinary.cmdline.side_effect = AssertionError("Snapshot command line was ignored")
        self.assertEqual(self.cleanup([ordinary])["proxy_processes"], 0)
        ordinary.terminate.assert_not_called()

    def test_proxy_parent_lifetime_and_age_protect_active_invocations(self):
        import psutil

        for parent_created, proxy_created, parent_error, removed in (
            (50, 100, None, 0),     # The original parent is still alive.
            (200, 100, None, 1),    # The parent PID has been reused.
            (None, 100, None, 1),   # The parent exited.
            (None, 980, None, 0),   # A recent proxy is inside the safety threshold.
            (None, 100, psutil.AccessDenied(2), 0),
        ):
            with self.subTest(parent_created=parent_created, proxy_created=proxy_created, parent_error=parent_error):
                proxy = self.process(2, "python.exe", ["backend.ai.exe", "app", "test", "sshd", "-b", "127.0.0.1:10001"], proxy_created, 1)
                proxy.cmdline.side_effect = AssertionError("Snapshot command line was ignored")
                processes = [proxy]
                if parent_created is not None:
                    parent = self.process(1, "python.exe", ["python.exe", "wrapper.py"], parent_created)
                    processes.append(parent)
                if parent_error is not None:
                    proxy.ppid.side_effect = parent_error
                self.assertEqual(self.cleanup(processes)["proxy_processes"], removed)
                proxy.ppid.assert_called_once_with()
                self.assertEqual(proxy.terminate.call_count, removed)

    def test_clients_and_established_tcp_connections_protect_orphan_proxy(self):
        import psutil

        for client_name in ("ssh.exe", "scp.exe", None):
            with self.subTest(client_name=client_name):
                proxy = self.process(2, "python.exe", ["backend.ai.exe", "app", "test", "sshd", "-b", "127.0.0.1:10001"])
                processes = [proxy]
                connections = []
                if client_name:
                    client = self.process(3, client_name, [client_name, "-p", "10001"])
                    client.cmdline.side_effect = AssertionError("Client snapshot was ignored")
                    client.ppid.side_effect = AssertionError("Client parent lookup")
                    processes.append(client)
                else:
                    connections = [mock.Mock(status=psutil.CONN_ESTABLISHED, laddr=mock.Mock(port=10001), raddr=mock.Mock(port=22))]
                self.assertEqual(self.cleanup(processes, connections)["proxy_processes"], 0)
                proxy.terminate.assert_not_called()

    def test_proxy_child_is_not_cleaned_separately_from_live_proxy_parent(self):
        parent = self.process(1, "python.exe", ["backend.ai.exe", "app", "test", "sshd", "-b", "127.0.0.1:10001"], parent_pid=3)
        child = self.process(2, "python.exe", parent.info["cmdline"], parent_pid=1)
        wrapper = self.process(3, "python.exe", ["python.exe", "wrapper.py"], created=50)
        self.assertEqual(self.cleanup([parent, child, wrapper])["proxy_processes"], 0)
        parent.terminate.assert_not_called()
        child.terminate.assert_not_called()
        wrapper.ppid.assert_not_called()


class SensitiveCommandGuardTests(unittest.TestCase):
    def test_legacy_admin_keypair_info_is_rejected(self) -> None:
        with self.assertRaises(SystemExit) as raised:
            RUNNER.reject_sensitive_cli_arguments(
                ["--", "admin", "keypair", "info", "example"]
            )

        self.assertIn("Refusing legacy", str(raised.exception))

    def test_safe_keypair_usage_query_is_allowed(self) -> None:
        RUNNER.reject_sensitive_cli_arguments(
            ["v2", "my", "resource-allocation", "keypair-usage"]
        )

    def test_legacy_command_with_interleaved_options_is_rejected(self) -> None:
        with self.assertRaises(SystemExit):
            RUNNER.reject_sensitive_cli_arguments(
                ["admin", "--output=json", "keypair", "--show", "info"]
            )


class ProxyCommandTests(unittest.TestCase):
    def test_backend_proxy_command_is_detected(self) -> None:
        self.assertTrue(
            RUNNER.is_backend_proxy_command(
                ["backend.ai.exe", "app", "session-a", "sshd", "-b", "127.0.0.1:10001"]
            )
        )

    def test_regular_cli_command_is_not_detected(self) -> None:
        self.assertFalse(
            RUNNER.is_backend_proxy_command(["backend.ai.exe", "session", "list"])
        )

    def test_ssh_and_scp_clients_are_job_managed(self) -> None:
        self.assertTrue(
            RUNNER.is_connection_process_command(
                [r"C:\Windows\System32\OpenSSH\ssh.exe", "localhost"]
            )
        )
        self.assertTrue(
            RUNNER.is_connection_process_command(["scp", "source", "destination"])
        )

    def test_unrelated_process_is_not_job_managed(self) -> None:
        self.assertFalse(
            RUNNER.is_connection_process_command([sys.executable, "script.py"])
        )

    def test_connection_cli_commands_request_ssh_context_patch(self) -> None:
        for arguments in (
            ["ssh", "kei-example"],
            ["scp", "kei-example:/tmp/a", "."],
            ["session", "ssh", "kei-example"],
            ["session", "scp", "kei-example:/tmp/a", "."],
        ):
            with self.subTest(arguments=arguments):
                self.assertTrue(RUNNER.requires_connection_cli_patch(arguments))

    def test_non_connection_cli_commands_skip_ssh_context_patch(self) -> None:
        for arguments in (
            ["v2", "my", "session", "search"],
            ["session", "list"],
            ["v2", "session", "get", "example"],
            ["--", "v2", "config", "show"],
        ):
            with self.subTest(arguments=arguments):
                self.assertFalse(RUNNER.requires_connection_cli_patch(arguments))

    @unittest.skipUnless(os.name == "nt", "Windows Job Object test")
    def test_closing_proxy_job_terminates_child_process(self) -> None:
        process = subprocess.Popen(
            [sys.executable, "-c", "import time; time.sleep(30)"],
        )
        try:
            with RUNNER.WindowsKillOnCloseJob() as job:
                job.assign(process)
                self.assertIsNone(process.poll())
            process.wait(timeout=10)
            self.assertIsNotNone(process.returncode)
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=10)


class WindowsPrivateKeyAclTests(unittest.TestCase):
    @mock.patch.object(RUNNER.subprocess, "run")
    @mock.patch.dict(
        RUNNER.os.environ,
        {"USERDOMAIN": "DOMAIN", "USERNAME": "user"},
        clear=False,
    )
    def test_owner_rights_is_removed_before_granting_user_read(
        self,
        run: mock.Mock,
    ) -> None:
        key_path = Path(r"C:\Users\user\.ssh\id_test")

        RUNNER.harden_windows_private_key(key_path)

        self.assertEqual(run.call_count, 2)
        self.assertEqual(
            run.call_args_list[0].args[0],
            ["icacls", str(key_path), "/remove", "*S-1-3-4"],
        )
        self.assertEqual(
            run.call_args_list[1].args[0],
            ["icacls", str(key_path), "/grant:r", r"DOMAIN\user:(R)"],
        )
        for call in run.call_args_list:
            self.assertTrue(call.kwargs["check"])
            self.assertTrue(call.kwargs["capture_output"])


if __name__ == "__main__":
    unittest.main()
