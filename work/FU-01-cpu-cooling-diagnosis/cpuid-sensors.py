"""Direct, read-only CPU telemetry for this PC's verified CPUID 165 driver.

The IOCTL and buffer contract were recovered from the installed, unmodified driver.
No driver installation, service changes, MSR writes, or arbitrary register API.
"""
import argparse
import ctypes as C
from ctypes import wintypes as W
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import time
import winreg

DRIVER = Path(r'C:\ProgramData\CPUID Software\hwmonitor\GqDY411JCgKAzW')
DRIVER_SHA256 = '981c06bb03cc01ec0f85e8c4bb53f5c89d24c93af3f927290f24f149ee438385'
READ_MSR_IOCTL = 0x9C402440
READ_REGISTERS = frozenset((0x19C, 0x1A2, 0x1B1, 0x606, 0x611))


class LUID(C.Structure):
    _fields_ = [('LowPart', W.DWORD), ('HighPart', W.LONG)]


class TOKEN_PRIVILEGES(C.Structure):
    _fields_ = [('PrivilegeCount', W.DWORD), ('Luid', LUID), ('Attributes', W.DWORD)]


def open_device(kernel):
    """Use an already granted privilege for this driver's create check; restore it.

    AdjustTokenPrivileges cannot grant a missing privilege. No account policy,
    device ACL, driver or system security configuration is changed.
    """
    advapi = C.WinDLL('advapi32', use_last_error=True)
    advapi.OpenProcessToken.argtypes = [W.HANDLE, W.DWORD, C.POINTER(W.HANDLE)]
    advapi.LookupPrivilegeValueW.argtypes = [W.LPCWSTR, W.LPCWSTR, C.POINTER(LUID)]
    advapi.AdjustTokenPrivileges.argtypes = [W.HANDLE, W.BOOL, C.POINTER(TOKEN_PRIVILEGES),
                                            W.DWORD, C.POINTER(TOKEN_PRIVILEGES), C.POINTER(W.DWORD)]
    kernel.GetCurrentProcess.restype = W.HANDLE
    token, desired, previous, size = W.HANDLE(), TOKEN_PRIVILEGES(), TOKEN_PRIVILEGES(), W.DWORD()
    if not advapi.OpenProcessToken(kernel.GetCurrentProcess(), 0x28, C.byref(token)):
        raise C.WinError(C.get_last_error())
    changed = False
    handle = None
    try:
        desired.PrivilegeCount, desired.Attributes = 1, 2
        if not advapi.LookupPrivilegeValueW(None, 'SeLoadDriverPrivilege', C.byref(desired.Luid)):
            raise C.WinError(C.get_last_error())
        if desired.Luid.LowPart != 10 or desired.Luid.HighPart != 0:
            raise ValueError('Driver privilege LUID does not match Windows lookup')
        C.set_last_error(0)
        if not advapi.AdjustTokenPrivileges(token, False, C.byref(desired), C.sizeof(previous), C.byref(previous), C.byref(size)):
            raise C.WinError(C.get_last_error())
        error = C.get_last_error()
        if error:
            raise C.WinError(error)
        changed = True
        handle = kernel.CreateFileW(r'\\.\CPUZ165', 0xC0000000, 3, None, 3, 0x80, None)
        if handle == C.c_void_p(-1).value:
            handle = None
            raise C.WinError(C.get_last_error())
        return handle
    finally:
        try:
            if changed and not advapi.AdjustTokenPrivileges(token, False, C.byref(previous), 0, None, None):
                if handle: kernel.CloseHandle(handle)
                raise C.WinError(C.get_last_error())
        finally:
            kernel.CloseHandle(token)


def temperature(target_register, status_register):
    target = (target_register >> 16) & 0xFF
    if not 50 <= target <= 125 or not status_register & (1 << 31):
        return None
    value = target - ((status_register >> 16) & 0x7F)
    return value if -20 <= value <= 125 else None


class Reader:
    def __init__(self):
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r'HARDWARE\DESCRIPTION\System\CentralProcessor\0') as key:
            model = winreg.QueryValueEx(key, 'ProcessorNameString')[0]
        if 'i7-10700K' not in model:
            raise ValueError('This reader is verified only for Intel Core i7-10700K')
        if hashlib.sha256(DRIVER.read_bytes()).hexdigest() != DRIVER_SHA256:
            raise ValueError('Installed driver differs from the analyzed binary')
        self.k = C.WinDLL('kernel32', use_last_error=True)
        self.k.CreateFileW.argtypes = [W.LPCWSTR, W.DWORD, W.DWORD, C.c_void_p, W.DWORD, W.DWORD, W.HANDLE]
        self.k.CreateFileW.restype = W.HANDLE
        self.k.DeviceIoControl.argtypes = [W.HANDLE, W.DWORD, C.c_void_p, W.DWORD,
                                          C.c_void_p, W.DWORD, C.POINTER(W.DWORD), C.c_void_p]
        self.k.CloseHandle.argtypes = [W.HANDLE]
        self.k.GetCurrentThread.restype = W.HANDLE
        self.k.SetThreadAffinityMask.argtypes = [W.HANDLE, C.c_size_t]
        self.k.SetThreadAffinityMask.restype = C.c_size_t
        self.handle = open_device(self.k)
        self.energy = None

    def read_msr(self, index):
        if index not in READ_REGISTERS:
            raise ValueError('Register is outside the diagnostic read allowlist')
        request, value, returned = W.DWORD(index), C.c_ulonglong(), W.DWORD()
        if not self.k.DeviceIoControl(self.handle, READ_MSR_IOCTL, C.byref(request), 4,
                                      C.byref(value), 8, C.byref(returned), None):
            raise C.WinError(C.get_last_error())
        if returned.value != 8:
            raise ValueError('Unexpected MSR reply size')
        return value.value

    def sample(self):
        readings, errors, raw = [], [], {}
        def add(name, value, kind, unit):
            if value is not None:
                readings.append(dict(sensor='Intel Core i7-10700K CPU', name=name, value=value, kind=kind, unit=unit))
        target = self.read_msr(0x1A2)
        package = self.read_msr(0x1B1)
        raw.update(temperature_target=target, package_thermal_status=package)
        add('CPU Package', temperature(target, package), 1, 'C')
        # Affinity affects this worker thread only and is restored after each read.
        thread = self.k.GetCurrentThread()
        for logical_cpu in range(min(os.cpu_count() or 1, 64)):
            previous = self.k.SetThreadAffinityMask(thread, 1 << logical_cpu)
            if not previous:
                errors.append(dict(logical_cpu=logical_cpu, operation='thread_affinity', winerror=C.get_last_error()))
                continue
            try:
                status = self.read_msr(0x19C)
                add('CPU Logical Processor '+str(logical_cpu), temperature(target, status), 1, 'C')
            except (OSError, ValueError) as error:
                errors.append(dict(logical_cpu=logical_cpu, error=str(error)))
            finally:
                if not self.k.SetThreadAffinityMask(thread, previous):
                    raise C.WinError(C.get_last_error())
        try:
            energy_units = 2.0 ** (-((self.read_msr(0x606) >> 8) & 0x1F))
            energy = self.read_msr(0x611) & 0xFFFFFFFF
            now = time.monotonic()
            if self.energy and now > self.energy[1]:
                watts = ((energy-self.energy[0]) & 0xFFFFFFFF)*energy_units/(now-self.energy[1])
                if 0 <= watts < 1000: add('CPU Package Power', watts, 6, 'W')
            self.energy = (energy, now)
        except (OSError, ValueError) as error:
            errors.append(dict(operation='package_energy', error=str(error)))
        return dict(source='CPUID165_direct', status='ok' if readings else 'unavailable',
                    readings=readings, errors=errors, raw=raw, driver_sha256=DRIVER_SHA256,
                    fan_pump_status='not_implemented_in_this_cpu_reader')

    def close(self):
        if self.handle:
            self.k.CloseHandle(self.handle)
            self.handle = None


def publish_snapshot(output, row):
    snapshot = output/'sensors.json.tmp'
    snapshot.write_text(json.dumps(row, allow_nan=False), encoding='utf-8')
    # Windows readers may briefly hold a handle without FILE_SHARE_DELETE.
    # Retry the ordinary rename, without changing attributes or permissions.
    for attempt in range(10):
        try:
            os.replace(snapshot, output/'sensors.json')
            return
        except PermissionError:
            if attempt == 9:
                raise
            time.sleep(0.02)


def run(output, duration):
    output = Path(output).resolve()
    if not output.is_dir(): raise ValueError('Existing owner-registered directory required')
    reader = None
    def utc(): return dt.datetime.now(dt.timezone.utc).isoformat()
    with (output/'hardware.jsonl').open('x', encoding='utf-8') as log:
        def write(row):
            log.write(json.dumps(row, allow_nan=False)+'\n'); log.flush(); os.fsync(log.fileno())
        write(dict(event='start', utc=utc(), pid=os.getpid(), duration_seconds=duration, source='CPUID165_direct'))
        try:
            reader = Reader()
            started = time.monotonic()
            while time.monotonic()-started < duration and not (output/'STOP').exists():
                now = time.monotonic()
                row = reader.sample(); row.update(event='sample', utc=utc(), elapsed_seconds=now-started)
                write(row)
                try:
                    publish_snapshot(output, row)
                except OSError as error:
                    # Preserve independent hardware JSONL even if the UI-free
                    # collector snapshot cannot be refreshed.
                    write(dict(event='snapshot_unavailable', utc=utc(), error=str(error),
                               winerror=getattr(error, 'winerror', None)))
                time.sleep(max(0, min(2-(time.monotonic()-now), duration-(time.monotonic()-started))))
            write(dict(event='stop', utc=utc(), reason='stop_file' if (output/'STOP').exists() else 'duration'))
            return 0
        except (OSError, ValueError) as error:
            write(dict(event='sensor_unavailable', utc=utc(), source='CPUID165_direct',
                       error=str(error), winerror=getattr(error, 'winerror', None)))
            return 2
        finally:
            if reader: reader.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    parser.add_argument('--duration', type=float, default=1800)
    args = parser.parse_args()
    if not 0 < args.duration <= 43200: parser.error('Invalid duration')
    raise SystemExit(run(args.output, args.duration))
