"""Read-only Windows freeze recorder. Python standard library; no settings changes."""
import argparse
import ctypes as C
from ctypes import wintypes as W
import datetime as dt
import json
import math
import os
from pathlib import Path
import time


class MEMORY(C.Structure):
    _fields_ = [('length', W.DWORD), ('load', W.DWORD)] + [(n, C.c_ulonglong) for n in
                ('total_phys', 'avail_phys', 'total_page', 'avail_page', 'total_virtual', 'avail_virtual', 'avail_extended')]


class PERFORMANCE(C.Structure):
    _fields_ = [('cb', W.DWORD)] + [(n, C.c_size_t) for n in
                ('commit', 'limit', 'peak', 'physical_total', 'physical_available', 'cache',
                 'kernel_total', 'kernel_paged', 'kernel_nonpaged', 'page_size')] + [
                ('handles', W.DWORD), ('processes', W.DWORD), ('threads', W.DWORD)]


class PROCESS_MEMORY(C.Structure):
    _fields_ = [('cb', W.DWORD), ('faults', W.DWORD)] + [(n, C.c_size_t) for n in
                ('peak_ws', 'ws', 'peak_paged', 'paged', 'peak_nonpaged', 'nonpaged', 'pagefile', 'peak_pagefile', 'private')]


class PROCESS_ENTRY(C.Structure):
    _fields_ = [('size', W.DWORD), ('usage', W.DWORD), ('pid', W.DWORD), ('heap', C.c_size_t),
                ('module', W.DWORD), ('threads', W.DWORD), ('parent', W.DWORD), ('priority', W.LONG),
                ('flags', W.DWORD), ('exe', W.WCHAR*260)]


class PDH_VALUE(C.Structure):
    _fields_ = [('status', W.DWORD), ('value', C.c_double)]


class PDH_ITEM(C.Structure):
    _fields_ = [('name', W.LPWSTR), ('value', PDH_VALUE)]


class Windows:
    def __init__(self, sensor_file=None):
        self.sensor_file = Path(sensor_file) if sensor_file else None
        self.k = C.WinDLL('kernel32', use_last_error=True)
        self.ps = C.WinDLL('psapi', use_last_error=True)
        for name in ('OpenProcess', 'CreateToolhelp32Snapshot'):
            getattr(self.k, name).restype = W.HANDLE
        self.k.OpenProcess.argtypes = [W.DWORD, W.BOOL, W.DWORD]
        self.k.CreateToolhelp32Snapshot.argtypes = [W.DWORD, W.DWORD]
        self.k.CloseHandle.argtypes = [W.HANDLE]
        self.k.GetProcessTimes.argtypes = [W.HANDLE] + [C.POINTER(C.c_ulonglong)]*4
        self.k.Process32FirstW.argtypes = [W.HANDLE, C.POINTER(PROCESS_ENTRY)]
        self.k.Process32NextW.argtypes = [W.HANDLE, C.POINTER(PROCESS_ENTRY)]
        self.ps.GetProcessMemoryInfo.argtypes = [W.HANDLE, C.POINTER(PROCESS_MEMORY), W.DWORD]
        self.ps.GetPerformanceInfo.argtypes = [C.POINTER(PERFORMANCE), W.DWORD]
        self.previous_cpu = None
        self.previous_process = {}
        self.pdh = C.WinDLL('pdh')
        self.query = W.HANDLE()
        self.counters = {}
        self.disk_error = None
        rc = self.pdh.PdhOpenQueryW(None, 0, C.byref(self.query))
        if rc:
            self.disk_error = f'PdhOpenQuery:{rc & 0xffffffff:x}'
        else:
            self.pdh.PdhAddEnglishCounterW.argtypes = [W.HANDLE, W.LPCWSTR, C.c_size_t, C.POINTER(W.HANDLE)]
            self.pdh.PdhCollectQueryData.argtypes = [W.HANDLE]
            self.pdh.PdhCloseQuery.argtypes = [W.HANDLE]
            self.pdh.PdhGetFormattedCounterArrayW.argtypes = [W.HANDLE, W.DWORD, C.POINTER(W.DWORD), C.POINTER(W.DWORD), C.c_void_p]
            for key, counter in [('queue', 'Current Disk Queue Length'), ('read_seconds', 'Avg. Disk sec/Read'),
                                 ('write_seconds', 'Avg. Disk sec/Write'), ('bytes_per_second', 'Disk Bytes/sec')]:
                handle = W.HANDLE()
                rc = self.pdh.PdhAddEnglishCounterW(self.query, '\\PhysicalDisk(*)\\'+counter, 0, C.byref(handle))
                if rc:
                    self.disk_error = f'PdhAddEnglishCounter:{rc & 0xffffffff:x}'
                else:
                    self.counters[key] = handle
            self.pdh.PdhCollectQueryData(self.query)

    def cpu_memory(self):
        idle, kernel, user = C.c_ulonglong(), C.c_ulonglong(), C.c_ulonglong()
        if not self.k.GetSystemTimes(C.byref(idle), C.byref(kernel), C.byref(user)):
            raise C.WinError(C.get_last_error())
        current = (idle.value, kernel.value + user.value)
        cpu = None
        if self.previous_cpu:
            di, total = (current[i]-self.previous_cpu[i] for i in (0, 1))
            if total > 0:
                cpu = max(0.0, min(100.0, (total-di)*100.0/total))
        self.previous_cpu = current
        mem = MEMORY(); mem.length = C.sizeof(mem)
        perf = PERFORMANCE(); perf.cb = C.sizeof(perf)
        if not self.k.GlobalMemoryStatusEx(C.byref(mem)) or not self.ps.GetPerformanceInfo(C.byref(perf), perf.cb):
            raise C.WinError(C.get_last_error())
        return dict(cpu_percent=cpu, memory_percent=mem.load, available_bytes=mem.avail_phys,
                    total_bytes=mem.total_phys, commit_bytes=perf.commit*perf.page_size,
                    commit_limit_bytes=perf.limit*perf.page_size,
                    commit_percent=(perf.commit*100.0/perf.limit if perf.limit else None),
                    kernel_nonpaged_bytes=perf.kernel_nonpaged*perf.page_size, processes=perf.processes)

    def processes(self, now):
        snapshot = self.k.CreateToolhelp32Snapshot(2, 0)
        if snapshot == C.c_void_p(-1).value:
            return dict(status='unavailable', winerror=C.get_last_error())
        entry = PROCESS_ENTRY(); entry.size = C.sizeof(entry)
        rows, denied, current = [], 0, {}
        try:
            more = self.k.Process32FirstW(snapshot, C.byref(entry))
            while more:
                handle = self.k.OpenProcess(0x410, False, entry.pid)
                if handle:
                    try:
                        mem = PROCESS_MEMORY(); mem.cb = C.sizeof(mem)
                        created, exited, kernel, user = (C.c_ulonglong() for _ in range(4))
                        if self.ps.GetProcessMemoryInfo(handle, C.byref(mem), mem.cb) and self.k.GetProcessTimes(
                                handle, C.byref(created), C.byref(exited), C.byref(kernel), C.byref(user)):
                            key = (entry.pid, created.value)
                            ticks = kernel.value + user.value
                            previous = self.previous_process.get(key)
                            cpu = ((ticks-previous[0])/1e7/(now-previous[1])*100/(os.cpu_count() or 1)
                                   if previous and now > previous[1] else None)
                            current[key] = (ticks, now)
                            rows.append(dict(pid=entry.pid, parent=entry.parent, name=entry.exe,
                                             private_bytes=mem.private, working_set_bytes=mem.ws,
                                             cpu_percent=cpu))
                    finally:
                        self.k.CloseHandle(handle)
                else:
                    denied += 1
                more = self.k.Process32NextW(snapshot, C.byref(entry))
        finally:
            self.k.CloseHandle(snapshot)
        self.previous_process = current
        selected = {r['pid']: r for r in sorted(rows, key=lambda r:r['private_bytes'], reverse=True)[:10]}
        selected.update({r['pid']:r for r in sorted(rows, key=lambda r:r['cpu_percent'] or 0, reverse=True)[:5]})
        return dict(status='ok', inaccessible_count=denied, top=list(selected.values()))

    def disks(self):
        if not self.query:
            return dict(status='unavailable', error=self.disk_error)
        rc = self.pdh.PdhCollectQueryData(self.query)
        if rc:
            return dict(status='unavailable', error=f'PdhCollect:{rc & 0xffffffff:x}')
        values, errors = {}, []
        for key, handle in self.counters.items():
            size, count = W.DWORD(), W.DWORD()
            rc = self.pdh.PdhGetFormattedCounterArrayW(handle, 0x200, C.byref(size), C.byref(count), None)
            if (rc & 0xffffffff) != 0x800007d2 or size.value > 4*1024*1024:
                errors.append(f'{key}:{rc & 0xffffffff:x}'); continue
            buf = C.create_string_buffer(size.value)
            rc = self.pdh.PdhGetFormattedCounterArrayW(handle, 0x200, C.byref(size), C.byref(count), buf)
            if rc:
                errors.append(f'{key}:{rc & 0xffffffff:x}'); continue
            for item in C.cast(buf, C.POINTER(PDH_ITEM*count.value)).contents:
                if item.value.status in (0, 1) and math.isfinite(item.value.value):
                    values.setdefault(item.name, {})[key] = item.value.value
        return dict(status='ok' if values else 'unavailable', values=values, errors=errors)

    def sensors(self):
        if not self.sensor_file:
            return dict(status='unavailable', source='direct_hardware', reason='sensor_worker_not_configured')
        try:
            if self.sensor_file.stat().st_size > 256*1024:
                raise ValueError('Oversized sensor snapshot')
            result = json.loads(self.sensor_file.read_text(encoding='utf-8-sig'))
            if result.get('source') not in ('LibreHardwareMonitorLib', 'CPUID165_direct') or result.get('status') not in ('ok', 'unavailable'):
                raise ValueError('Invalid sensor snapshot')
            for reading in result.get('readings', []):
                if not isinstance(reading.get('value'), (int, float)) or not math.isfinite(reading['value']):
                    raise ValueError('Invalid sensor number')
                if not isinstance(reading.get('sensor'), str) or not isinstance(reading.get('name'), str) or not isinstance(reading.get('kind'), int):
                    raise ValueError('Invalid sensor identity')
            age = (dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(result['utc'])).total_seconds()
            result['age_seconds'] = age
            if result['status'] == 'ok' and (age >= 10 or age < -5):
                result['status'] = 'stale'
                result['readings'] = []
            return result
        except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
            return dict(status='unavailable', source='direct_hardware', error=str(error))

    def close(self):
        if self.query: self.pdh.PdhCloseQuery(self.query)


def alerts(sample):
    out = []
    system = sample.get('system', {})
    if system.get('available_bytes', 2**64) < 2*1024**3: out.append('available_ram_below_2GiB')
    if (system.get('commit_percent') or 0) >= 90: out.append('commit_at_least_90_percent')
    if sample.get('gap_seconds', 0) >= 6: out.append('sampling_gap_at_least_6_seconds')
    if sample.get('sensors', {}).get('status') == 'stale': out.append('hardware_sensor_data_stale')
    for sensor in sample.get('sensors', {}).get('readings', []):
        if sensor['kind'] == 1 and 'cpu' in (sensor['sensor']+' '+sensor['name']).lower() and sensor['value'] > 85:
            out.append('cpu_temperature_above_85C'); break
    for name, disk in sample.get('disks', {}).get('values', {}).items():
        if max(disk.get('read_seconds', 0), disk.get('write_seconds', 0)) >= 1:
            out.append('disk_latency_at_least_1_second:'+name)
    return out


def append_durable(file, value):
    started = time.monotonic()
    file.write(json.dumps(value, ensure_ascii=False, allow_nan=False)+'\n')
    file.flush()
    os.fsync(file.fileno())
    return time.monotonic()-started


def run(output, duration, interval, sensor_file=None):
    output = Path(output).resolve()
    if not output.is_dir(): raise ValueError('Existing owner-registered output directory required')
    win = Windows(sensor_file)
    started = time.monotonic(); previous = started; index = 0; previous_write = None
    def timestamp(): return dt.datetime.now(dt.timezone.utc).isoformat()
    status = dict(schema=1, state='running', pid=os.getpid(), started_utc=timestamp(),
                  duration_seconds=duration, interval_seconds=interval, output=str(output))
    status_path = output/'status.json'
    if status_path.exists(): raise FileExistsError(status_path)
    status_path.write_text(json.dumps(status, indent=2), encoding='utf-8')
    try:
        with (output/'system.jsonl').open('x', encoding='utf-8') as log, (output/'alerts.jsonl').open('x', encoding='utf-8') as alarm:
            append_durable(log, dict(event='start', **status))
            while time.monotonic()-started < duration and not (output/'STOP').exists():
                now = time.monotonic(); index += 1
                sample = dict(event='sample', utc=timestamp(), sequence=index, elapsed_seconds=now-started,
                              gap_seconds=now-previous, previous_write_seconds=previous_write, phase_seconds={})
                for name, collect in [('system', win.cpu_memory), ('processes', lambda:win.processes(now)),
                                      ('disks', win.disks), ('sensors', win.sensors)]:
                    phase_started = time.monotonic()
                    sample[name] = collect()
                    sample['phase_seconds'][name] = time.monotonic()-phase_started
                sample['collection_ended_utc'] = timestamp()
                sample['collection_seconds'] = time.monotonic()-now
                sample['alerts'] = alerts(sample)
                previous_write = append_durable(log, sample)
                if sample['alerts']: append_durable(alarm, sample)
                previous = now
                time.sleep(max(0, min(interval-(time.monotonic()-now), duration-(time.monotonic()-started))))
            append_durable(log, dict(event='stop', utc=timestamp(), samples=index,
                                    reason='stop_file' if (output/'STOP').exists() else 'duration'))
        status.update(state='stopped', ended_utc=timestamp(), samples=index)
    except BaseException as error:
        status.update(state='failed', ended_utc=timestamp(), error=repr(error), samples=index)
        raise
    finally:
        win.close()
        status_path.write_text(json.dumps(status, indent=2), encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    parser.add_argument('--sensor-file')
    parser.add_argument('--duration', type=float, default=1800)
    parser.add_argument('--interval', type=float, default=2)
    args = parser.parse_args()
    if not (0 < args.duration <= 43200 and 1 <= args.interval <= 60): parser.error('Invalid duration/interval')
    run(args.output, args.duration, args.interval, args.sensor_file)
