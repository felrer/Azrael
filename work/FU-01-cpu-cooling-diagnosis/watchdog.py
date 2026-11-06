"""Independent Windows scheduling heartbeat; gaps are evidence, not a freeze diagnosis."""
import argparse
import ctypes as C
from ctypes import wintypes as W
import datetime as dt
import json
import os
from pathlib import Path
import time


def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def run(output, duration, monitor_log):
    output = Path(output).resolve()
    if not output.is_dir(): raise ValueError('Existing owner-registered directory required')
    kernel = C.WinDLL('kernel32', use_last_error=True)
    kernel.GetTickCount64.restype = C.c_ulonglong
    kernel.QueryUnbiasedInterruptTime.argtypes = [C.POINTER(C.c_ulonglong)]
    started = previous = time.monotonic()
    previous_utc = utc()
    previous_unbiased = None
    previous_flush = 0.0
    last_heartbeat = -1.0
    sequence = 0
    with (output/'heartbeat.jsonl').open('x', encoding='utf-8') as log:
        def write(value):
            before = time.monotonic()
            log.write(json.dumps(value, ensure_ascii=False, allow_nan=False)+'\n')
            log.flush(); os.fsync(log.fileno())
            return time.monotonic()-before
        write(dict(event='start', utc=utc(), pid=os.getpid(), duration_seconds=duration,
                   monitored_log=str(Path(monitor_log).resolve()), check_interval_seconds=0.25,
                   heartbeat_interval_seconds=1, gap_threshold_seconds=1))
        while time.monotonic()-started < duration and not (output/'STOP').exists():
            now = time.monotonic(); stamp = utc(); elapsed = now-started
            unbiased = C.c_ulonglong()
            unbiased_ok = bool(kernel.QueryUnbiasedInterruptTime(C.byref(unbiased)))
            active_gap = ((unbiased.value-previous_unbiased)/1e7
                          if unbiased_ok and previous_unbiased is not None else None)
            gap = now-previous
            if gap >= 1 or elapsed-last_heartbeat >= 1:
                sequence += 1
                record = dict(event='watchdog_gap' if gap >= 1 else 'heartbeat', utc=stamp,
                              sequence=sequence, elapsed_seconds=elapsed, uptime_ms=kernel.GetTickCount64(),
                              interval_seconds=gap, active_interval_seconds=active_gap,
                              previous_flush_seconds=previous_flush)
                if gap >= 1:
                    record.update(from_utc=previous_utc, to_utc=stamp,
                                  possible_sleep=active_gap is not None and gap-active_gap >= 0.75,
                                  previous_write_could_explain_gap=previous_flush >= 0.75)
                previous_flush = write(record)
                last_heartbeat = elapsed
            else:
                previous_flush = 0.0
            previous = now; previous_utc = stamp
            if unbiased_ok: previous_unbiased = unbiased.value
            time.sleep(max(0, min(0.25-(time.monotonic()-now), duration-(time.monotonic()-started))))
        write(dict(event='stop', utc=utc(), sequence=sequence,
                   reason='stop_file' if (output/'STOP').exists() else 'duration'))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    parser.add_argument('--monitor-log', required=True)
    parser.add_argument('--duration', type=float, default=1800)
    args = parser.parse_args()
    if not 0 < args.duration <= 43200: parser.error('Invalid duration')
    run(args.output, args.duration, args.monitor_log)
