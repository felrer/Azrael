"""Run Backend.AI CLI with a process-local account-specific state directory."""

from __future__ import annotations

import contextlib
import ctypes
import importlib
import os
import re
import shutil
import signal
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any, Iterator, Sequence


SENSITIVE_LEGACY_COMMAND = ("admin", "keypair", "info")
MANAGED_KEY_PATTERN = re.compile(r"^ktcloud-ai-nexus-id_[0-9a-f]{32}$")
LEGACY_MANAGED_KEY_PATTERN = re.compile(r"^id_[0-9a-f]{32}$")
MANAGED_TEMP_PREFIX = "ktcloud-backendai-ssh-"
STALE_ARTIFACT_MINIMUM_AGE_SECONDS = 300


def reject_sensitive_cli_arguments(arguments: Sequence[str]) -> None:
    """Block a legacy command that may print access-key credentials."""
    normalized = [
        token.casefold()
        for argument in arguments
        if argument != "--"
        for token in str(argument).strip().split()
    ]
    cursor = 0
    for token in normalized:
        if token == SENSITIVE_LEGACY_COMMAND[cursor]:
            cursor += 1
            if cursor == len(SENSITIVE_LEGACY_COMMAND):
                raise SystemExit(
                    "Refusing legacy 'admin keypair info': it may expose sensitive keypair "
                    "material. Use 'v2 my resource-allocation keypair-usage' instead."
                )


def is_backend_proxy_command(command: Any) -> bool:
    if not isinstance(command, (list, tuple)):
        return False
    tokens = [str(token).casefold() for token in command]
    return "app" in tokens and "sshd" in tokens and "-b" in tokens


def is_connection_process_command(command: Any) -> bool:
    if is_backend_proxy_command(command):
        return True
    if not isinstance(command, (list, tuple)) or not command:
        return False
    executable = Path(str(command[0])).name.casefold()
    return executable in {"ssh", "ssh.exe", "scp", "scp.exe"}


def requires_connection_cli_patch(arguments: Sequence[str]) -> bool:
    """Return whether the requested Backend.AI command opens SSH or SCP."""
    normalized = [
        token.casefold()
        for argument in arguments
        if argument != "--"
        for token in str(argument).strip().split()
    ]
    if not normalized:
        return False
    if normalized[0] in {"ssh", "scp"}:
        return True
    return len(normalized) >= 2 and normalized[0] == "session" and normalized[1] in {
        "ssh",
        "scp",
    }


if os.name == "nt":
    from ctypes import wintypes

    class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_longlong),
            ("PerJobUserTimeLimit", ctypes.c_longlong),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class JOBOBJECT_BASIC_ACCOUNTING_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("TotalUserTime", ctypes.c_longlong),
            ("TotalKernelTime", ctypes.c_longlong),
            ("ThisPeriodTotalUserTime", ctypes.c_longlong),
            ("ThisPeriodTotalKernelTime", ctypes.c_longlong),
            ("TotalPageFaultCount", wintypes.DWORD),
            ("TotalProcesses", wintypes.DWORD),
            ("ActiveProcesses", wintypes.DWORD),
            ("TotalTerminatedProcesses", wintypes.DWORD),
        ]

    class IO_COUNTERS(ctypes.Structure):
        _fields_ = [
            ("ReadOperationCount", ctypes.c_ulonglong),
            ("WriteOperationCount", ctypes.c_ulonglong),
            ("OtherOperationCount", ctypes.c_ulonglong),
            ("ReadTransferCount", ctypes.c_ulonglong),
            ("WriteTransferCount", ctypes.c_ulonglong),
            ("OtherTransferCount", ctypes.c_ulonglong),
        ]

    class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
            ("IoInfo", IO_COUNTERS),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]


class WindowsKillOnCloseJob:
    """Kill an assigned proxy process tree when this wrapper exits."""

    def __init__(self) -> None:
        self.handle: Any = None
        self.processes: list[subprocess.Popen[Any]] = []

    def __enter__(self) -> "WindowsKillOnCloseJob":
        if os.name != "nt":
            return self
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateJobObjectW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p]
        kernel32.CreateJobObjectW.restype = wintypes.HANDLE
        kernel32.SetInformationJobObject.argtypes = [
            wintypes.HANDLE,
            ctypes.c_int,
            ctypes.c_void_p,
            wintypes.DWORD,
        ]
        kernel32.SetInformationJobObject.restype = wintypes.BOOL
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel32.CloseHandle.restype = wintypes.BOOL
        self.kernel32 = kernel32
        self.handle = kernel32.CreateJobObjectW(None, None)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        information = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
        information.BasicLimitInformation.LimitFlags = 0x00002000
        if not kernel32.SetInformationJobObject(
            self.handle,
            9,
            ctypes.byref(information),
            ctypes.sizeof(information),
        ):
            error = ctypes.get_last_error()
            self._close_handle()
            raise ctypes.WinError(error)
        return self

    def assign(self, process: subprocess.Popen[Any]) -> None:
        if os.name != "nt":
            return
        if not self.handle:
            raise RuntimeError("Windows job is not open")
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        kernel32.AssignProcessToJobObject.restype = wintypes.BOOL
        if not kernel32.AssignProcessToJobObject(self.handle, wintypes.HANDLE(process._handle)):
            raise ctypes.WinError(ctypes.get_last_error())

    def _close_handle(self) -> None:
        if self.handle:
            if not self.kernel32.CloseHandle(self.handle):
                raise ctypes.WinError(ctypes.get_last_error())
            self.handle = None

    def __exit__(self, _exc_type: Any, _exc: Any, _traceback: Any) -> None:
        if os.name == "nt" and self.handle:
            kernel32 = self.kernel32
            kernel32.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
            kernel32.TerminateJobObject.restype = wintypes.BOOL
            kernel32.QueryInformationJobObject.argtypes = [
                wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p,
                wintypes.DWORD, ctypes.c_void_p,
            ]
            kernel32.QueryInformationJobObject.restype = wintypes.BOOL
            try:
                if not kernel32.TerminateJobObject(self.handle, 1):
                    raise ctypes.WinError(ctypes.get_last_error())
                deadline = time.monotonic() + 10
                while True:
                    information = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION()
                    if not kernel32.QueryInformationJobObject(
                        self.handle, 1, ctypes.byref(information),
                        ctypes.sizeof(information), None,
                    ):
                        raise ctypes.WinError(ctypes.get_last_error())
                    if information.ActiveProcesses == 0:
                        break
                    if time.monotonic() >= deadline:
                        raise TimeoutError("Owned SSH job processes did not exit")
                    time.sleep(0.01)
            finally:
                self._close_handle()
        for process in self.processes:
            stop_connection_process(process)


def stop_connection_process(process: subprocess.Popen[Any]) -> None:
    """Bound teardown of an invocation-owned process, including Windows proxies."""
    if process.poll() is None:
        process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


@contextlib.contextmanager
def assign_connection_processes_to_job(
    job: WindowsKillOnCloseJob,
    *,
    proxy_cwd: Path | None = None,
) -> Iterator[None]:
    """Assign Backend.AI's proxy and its SSH/SCP client to the wrapper job."""
    original_popen = subprocess.Popen

    def assigned_popen(*args: Any, **kwargs: Any) -> subprocess.Popen[Any]:
        command = args[0] if args else kwargs.get("args")
        # The SDK starts its long-lived proxy while staging the downloaded key.
        # A Windows child inheriting that scratch cwd keeps the directory open.
        # The proxy needs no staging-relative files, so use the caller's cwd;
        # retain the staging cwd for the synchronous key download only.
        if proxy_cwd is not None and is_backend_proxy_command(command):
            kwargs["cwd"] = proxy_cwd
        process = original_popen(*args, **kwargs)
        if is_connection_process_command(command):
            try:
                job.assign(process)
                job.processes.append(process)
                if os.name == "nt" and is_backend_proxy_command(command):
                    original_send_signal = process.send_signal

                    def send_signal(sig: int) -> None:
                        if sig == signal.SIGINT:
                            stop_connection_process(process)
                        else:
                            original_send_signal(sig)

                    process.send_signal = send_signal  # type: ignore[method-assign]
            except Exception:
                stop_connection_process(process)
                raise
        return process

    subprocess.Popen = assigned_popen  # type: ignore[assignment]
    try:
        yield
    finally:
        subprocess.Popen = original_popen  # type: ignore[assignment]


def _command_line(process: Any) -> list[str]:
    try:
        if "cmdline" in process.info:
            return [str(token) for token in (process.info["cmdline"] or [])]
        return [str(token) for token in process.cmdline()]
    except Exception:
        return []


def _proxy_bind_port(arguments: Sequence[str]) -> int | None:
    for index, token in enumerate(arguments[:-1]):
        if token == "-b":
            try:
                return int(arguments[index + 1].rsplit(":", 1)[1])
            except (IndexError, ValueError):
                return None
    return None


def cleanup_stale_runtime_artifacts(
    minimum_age_seconds: int = STALE_ARTIFACT_MINIMUM_AGE_SECONDS,
) -> dict[str, int]:
    """Remove only abandoned artifacts created by this wrapper."""
    import psutil

    now = time.time()
    # On Windows each ppid lookup takes a system-wide snapshot. Do this only
    # for positively identified proxies, not once for every running process.
    processes = list(psutil.process_iter(["pid", "name", "create_time", "cmdline"]))
    process_by_pid = {process.pid: process for process in processes}
    clients = [
        process
        for process in processes
        if str(process.info.get("name") or "").casefold() in {"ssh.exe", "scp.exe", "ssh", "scp"}
    ]
    client_command_lines = [" ".join(_command_line(process)).casefold() for process in clients]

    active_tcp_ports: set[int] = set()
    try:
        for connection in psutil.net_connections(kind="tcp"):
            if connection.status != psutil.CONN_ESTABLISHED:
                continue
            if connection.laddr:
                active_tcp_ports.add(connection.laddr.port)
            if connection.raddr:
                active_tcp_ports.add(connection.raddr.port)
    except (psutil.AccessDenied, OSError):
        active_tcp_ports = set()

    orphan_roots: list[Any] = []
    proxy_processes = []
    for process in processes:
        arguments = _command_line(process)
        if is_backend_proxy_command(arguments):
            proxy_processes.append(process)
    proxy_pids = {process.pid for process in proxy_processes}
    for process in proxy_processes:
        try:
            parent_pid = process.ppid()
        except (psutil.Error, OSError):
            continue
        if parent_pid in proxy_pids:
            continue
        parent = process_by_pid.get(parent_pid)
        parent_is_live = False
        if parent is not None:
            try:
                parent_is_live = parent.create_time() <= process.create_time()
            except (psutil.Error, OSError):
                parent_is_live = True
        try:
            age = now - process.create_time()
        except (psutil.Error, OSError):
            continue
        bind_port = _proxy_bind_port(_command_line(process))
        client_uses_port = bind_port is not None and (
            bind_port in active_tcp_ports
            or any(str(bind_port) in command_line for command_line in client_command_lines)
        )
        if not parent_is_live and not client_uses_port and age >= minimum_age_seconds:
            orphan_roots.append(process)

    removed_proxies = 0
    for root in orphan_roots:
        try:
            tree = root.children(recursive=True)
            for process in reversed(tree):
                process.terminate()
            root.terminate()
            _, alive = psutil.wait_procs([*tree, root], timeout=5)
            for process in alive:
                process.kill()
            psutil.wait_procs(alive, timeout=5)
            removed_proxies += 1 + len(tree)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    removed_keys = 0
    ssh_root = Path.home() / ".ssh"
    if ssh_root.is_dir():
        for key_path in ssh_root.iterdir():
            if (
                key_path.is_symlink()
                or not key_path.is_file()
                or not (
                    MANAGED_KEY_PATTERN.fullmatch(key_path.name)
                    or LEGACY_MANAGED_KEY_PATTERN.fullmatch(key_path.name)
                )
            ):
                continue
            try:
                age = now - key_path.stat().st_ctime
            except OSError:
                continue
            referenced = any(str(key_path).casefold() in command_line for command_line in client_command_lines)
            if age >= minimum_age_seconds and not referenced:
                try:
                    key_path.unlink()
                    removed_keys += 1
                except OSError:
                    continue

    removed_temp_directories = 0
    temp_root = Path(tempfile.gettempdir())
    for directory in temp_root.glob(f"{MANAGED_TEMP_PREFIX}*"):
        if directory.is_symlink() or not directory.is_dir():
            continue
        try:
            age = now - directory.stat().st_ctime
            children = list(directory.iterdir())
        except OSError:
            continue
        if age < minimum_age_seconds or any(
            child.is_symlink() or child.is_dir() or child.name != "id_container" for child in children
        ):
            continue
        try:
            for child in children:
                child.unlink()
            directory.rmdir()
            removed_temp_directories += 1
        except OSError:
            continue

    return {
        "proxy_processes": removed_proxies,
        "private_keys": removed_keys,
        "temp_directories": removed_temp_directories,
    }


def harden_windows_private_key(key_path: Path) -> None:
    """Remove OWNER RIGHTS left explicit by Backend.AI's icacls sequence."""
    current_user = f"{os.environ.get('USERDOMAIN', '')}\\{os.environ.get('USERNAME', '')}"
    subprocess.run(
        ["icacls", str(key_path), "/remove", "*S-1-3-4"],
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["icacls", str(key_path), "/grant:r", f"{current_user}:(R)"],
        check=True,
        capture_output=True,
    )


@contextlib.contextmanager
def isolated_container_ssh_context(
    original_context: Any,
    session_ref: str,
    port: int,
) -> Iterator[Path]:
    """Stage Backend.AI's fixed id_container name in a private directory."""
    original_cwd = Path.cwd()
    owned_keys: set[Path] = set()
    original_rename = os.rename
    with tempfile.TemporaryDirectory(prefix=MANAGED_TEMP_PREFIX) as scratch_dir:
        scratch_path = Path(scratch_dir)

        def capture_key_rename(source: Any, destination: Any, *args: Any, **kwargs: Any) -> None:
            # Capture only the SDK's exact staging-to-random-key move, even if
            # its context fails before returning the generated path.
            source_path = Path(source).absolute()
            destination_path = Path(destination).absolute()
            if (
                source_path == scratch_path / "id_container"
                and destination_path.parent == Path.home() / ".ssh"
                and LEGACY_MANAGED_KEY_PATTERN.fullmatch(destination_path.name)
            ):
                owned_keys.add(destination_path)
            original_rename(source, destination, *args, **kwargs)

        try:
            with WindowsKillOnCloseJob() as job:
                with contextlib.ExitStack() as stack:
                    with assign_connection_processes_to_job(job, proxy_cwd=original_cwd):
                        os.chdir(scratch_dir)
                        os.rename = capture_key_rename
                        try:
                            key_path = stack.enter_context(original_context(session_ref, port))
                        finally:
                            os.rename = original_rename
                            os.chdir(original_cwd)
                        owned_keys.add(key_path)
                        managed_key_path = key_path.with_name(f"ktcloud-ai-nexus-{key_path.name}")
                        owned_keys.add(managed_key_path)
                        os.replace(key_path, managed_key_path)
                        try:
                            if os.name == "nt":
                                harden_windows_private_key(managed_key_path)
                            yield managed_key_path
                        finally:
                            if managed_key_path.exists() and not key_path.exists():
                                os.replace(managed_key_path, key_path)
        finally:
            for owned_key in owned_keys:
                owned_key.unlink(missing_ok=True)


def patch_container_ssh_context() -> None:
    """Allow concurrent SSH/SCP calls without sharing ./id_container."""
    ssh_module = importlib.import_module("ai.backend.client.cli.session.ssh")
    lifecycle_module = importlib.import_module("ai.backend.client.cli.session.lifecycle")
    original_context = ssh_module.container_ssh_ctx

    def isolated_context(session_ref: str, port: int):
        return isolated_container_ssh_context(original_context, session_ref, port)

    ssh_module.container_ssh_ctx = isolated_context
    lifecycle_module.container_ssh_ctx = isolated_context


def patch_session_download_request() -> None:
    """Keep legacy JSON and supply files to the manager's new query parser.

    The manager's POST session download now accepts QueryParam rather than
    BodyParam. Repeated files keys preserve its list contract. Patch only this
    process's request serialization; the installed SDK remains unchanged.
    """
    request_class = importlib.import_module("ai.backend.client.request").Request
    original_set_json = request_class.set_json
    if getattr(original_set_json, "_ktcloud_download_query", False):
        return

    def set_json_with_download_query(request: Any, value: Any) -> None:
        original_set_json(request, value)
        if (
            request.method == "POST"
            and re.fullmatch(r"/?(?:session|kernel)/[^/]+/download", request.path or "")
            and isinstance(value, dict)
            and isinstance(value.get("files"), (list, tuple))
        ):
            params = request.params or {}
            pairs = list(params.items()) if hasattr(params, "items") else list(params)
            request.params = [pair for pair in pairs if pair[0] != "files"] + [
                ("files", str(file)) for file in value["files"]
            ]

    set_json_with_download_query._ktcloud_download_query = True
    request_class.set_json = set_json_with_download_query


def main() -> None:
    if os.name == "nt":
        import aiohttp.connector
        from aiohttp.resolver import ThreadedResolver
        aiohttp.connector.DefaultResolver = ThreadedResolver
    reject_sensitive_cli_arguments(os.sys.argv[1:])
    cleanup_result = cleanup_stale_runtime_artifacts()
    if any(cleanup_result.values()):
        print(
            "Cleaned abandoned kt cloud runtime artifacts: "
            f"proxy-processes={cleanup_result['proxy_processes']}, "
            f"private-keys={cleanup_result['private_keys']}, "
            f"temp-directories={cleanup_result['temp_directories']}.",
            file=os.sys.stderr,
        )
    account = os.environ.get("KTCLOUD_ACCOUNT")
    if not account or re.fullmatch(r"(?:trinity|abydos|arius[1-9][0-9]*)", account) is None:
        raise SystemExit("KTCLOUD_ACCOUNT is invalid")
    raw_state_path = os.environ.get("KTCLOUD_BACKEND_STATE_PATH")
    if not raw_state_path:
        raise SystemExit("KTCLOUD_BACKEND_STATE_PATH is required")
    state_path = Path(raw_state_path).resolve()
    expected_state_path = (
        Path(os.environ["LOCALAPPDATA"])
        / "ktcloud-ai-nexus"
        / "backend-state"
        / account
        / "Lablup"
        / "backend.ai"
    ).resolve()
    if state_path != expected_state_path:
        raise SystemExit("invalid isolated Backend.AI state path")

    import appdirs

    original_user_state_dir = appdirs.user_state_dir

    def isolated_user_state_dir(
        appname: str | None = None,
        appauthor: str | None = None,
        version: str | None = None,
        roaming: bool = False,
    ) -> str:
        if appname == "backend.ai" and appauthor == "Lablup":
            return str(state_path)
        return original_user_state_dir(appname, appauthor, version, roaming)

    appdirs.user_state_dir = isolated_user_state_dir

    # Backend.AI's SSH/SCP helper launches nested CLI processes. Point its
    # executable hook back to this runner so those children inherit the same
    # account-specific state-path patch instead of reading the global cookie.
    os.environ["PEX"] = str(Path(__file__).resolve())

    from ai.backend.cli.__main__ import main as backend_main

    # Includes nested `session download` invoked by the SSH/SCP helper.
    patch_session_download_request()
    if requires_connection_cli_patch(os.sys.argv[1:]):
        patch_container_ssh_context()

    backend_main(max_content_width=max(20, shutil.get_terminal_size().columns - 2))


if __name__ == "__main__":
    main()
