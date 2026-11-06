"""Windows x64 CPU-only staged test; stop only its own workers above 85 C."""
import argparse
import datetime as dt
import importlib.util
import json
import math
import multiprocessing as mp
import os
from pathlib import Path
import struct
import time

spec = importlib.util.spec_from_file_location('cpuid_reader', Path(__file__).with_name('cpuid-sensors.py'))
sensor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sensor)
STOP_ABOVE_C = 85.0
LEASE_SECONDS = 1.0
STAGES = [('baseline', 60, 0), ('pulse_1', 10, 1), ('rest_1', 20, 0),
          ('pulse_2', 10, 1), ('rest_2', 20, 0), ('pulse_3', 10, 1), ('rest_3', 20, 0),
          ('quarter', 60, .25), ('half', 60, .5), ('full', 180, 1), ('cooldown', 120, 0)]


def stop_reason(row, sample_seconds):
    if not math.isfinite(sample_seconds) or sample_seconds >= LEASE_SECONDS:
        return 'sensor_read_too_slow'
    if row.get('source') != 'CPUID165_direct' or row.get('status') != 'ok' or row.get('errors'):
        return 'sensor_unavailable'
    readings = row.get('readings', [])
    temps = [r.get('value') for r in readings if r.get('kind') == 1]
    if not temps or not any(r.get('name') == 'CPU Package' and r.get('kind') == 1 for r in readings):
        return 'sensor_temperature_missing'
    if any(not isinstance(v, (int, float)) or not math.isfinite(v) or not -20 <= v <= 125 for v in temps):
        return 'sensor_temperature_invalid'
    if max(temps) > STOP_ABOVE_C:
        return 'cpu_temperature_above_85C'
    return None


def cpu_worker(index, active, lease, stop, hard_end):
    # RawValue avoids an orphaned lock if the supervisor terminates abruptly.
    # Windows x64 is the only supported execution target for these shared values.
    while time.monotonic() < hard_end and not stop.is_set():
        now = time.monotonic()
        if lease.value and now >= lease.value:
            return
        if index >= active.value:
            stop.wait(.02)
            continue
        deadline = now + .02
        value = .5
        while time.monotonic() < deadline:
            value = math.sqrt(value + 1.234567)


def stop_workers(workers, active, lease, stop):
    active.value = 0
    lease.value = time.monotonic() - 1
    stop.set()
    deadline = time.monotonic() + 1
    for worker in workers:
        worker.join(max(0, deadline-time.monotonic()))
    # Only Process objects created by this supervisor can be terminated here.
    for worker in workers:
        if worker.is_alive():
            worker.terminate()
    for worker in workers:
        worker.join(1)
    return all(not worker.is_alive() for worker in workers)


def stage_at(elapsed):
    for name, seconds, fraction in STAGES:
        if elapsed < seconds:
            return name, fraction
        elapsed -= seconds
    return None, 0


def run(output, duration):
    if os.name != 'nt' or struct.calcsize('P') != 8 or os.cpu_count() != 16:
        raise ValueError('This test is scoped to the current Windows x64 i7-10700K host')
    output = Path(output).resolve()
    if not output.is_dir():
        raise ValueError('Existing owner-registered output directory required')
    ctx = mp.get_context('spawn')
    active, lease, stop = ctx.RawValue('i', 0), ctx.RawValue('d', 0), ctx.Event()
    workers, reader, reason = [], None, 'duration'
    log = (output/'hardware.jsonl').open('x', encoding='utf-8')
    def write(row):
        log.write(json.dumps(row, allow_nan=False)+'\n')
        log.flush()
        os.fsync(log.fileno())
    def utc():
        return dt.datetime.now(dt.timezone.utc).isoformat()
    try:
        write(dict(event='start', utc=utc(), source='CPUID165_direct', threshold_c=STOP_ABOVE_C,
                   comparison='strictly_greater', max_duration_seconds=duration))
        reader = sensor.Reader()
        # Validate fresh temperature before creating any load worker.
        started_read = time.monotonic()
        initial = reader.sample()
        reason = stop_reason(initial, time.monotonic()-started_read)
        if reason:
            return 3
        hard_end = time.monotonic()+duration+30
        for index in range(16):
            worker = ctx.Process(target=cpu_worker, args=(index, active, lease, stop, hard_end), daemon=True)
            worker.start()
            workers.append(worker)
        started = time.monotonic()
        while time.monotonic()-started < duration:
            cycle = time.monotonic()
            if (output/'STOP').exists():
                reason = 'stop_file'; break
            if any(not worker.is_alive() for worker in workers):
                reason = 'load_worker_exited'; break
            row = reader.sample()
            now = time.monotonic()
            reason = stop_reason(row, now-cycle)
            name, fraction = stage_at(now-started)
            row.update(event='sample', utc=utc(), stage=name, elapsed_seconds=now-started)
            if reason:
                # Stop before writing or flushing evidence, which can itself stall.
                stop_workers(workers, active, lease, stop)
                write(row)
                break
            if name is None:
                reason = 'stages_complete'; break
            lease.value = now+LEASE_SECONDS
            active.value = round(16*fraction)
            row['load_workers'] = active.value
            write(row)
            try:
                sensor.publish_snapshot(output, row)
            except OSError as error:
                reason = 'snapshot_unavailable'
                stop_workers(workers, active, lease, stop)
                write(dict(event=reason, utc=utc(), error=str(error)))
                break
            stop.wait(max(0, .25-(time.monotonic()-cycle)))
        else:
            reason = 'duration'
        return 0 if reason in ('duration', 'stages_complete', 'stop_file') else 3
    except (OSError, ValueError) as error:
        reason = 'sensor_or_log_error'
        stop_workers(workers, active, lease, stop)
        write(dict(event='sensor_unavailable', utc=utc(), source='CPUID165_direct', error=str(error)))
        return 2
    finally:
        stopped = stop_workers(workers, active, lease, stop)
        if reader:
            reader.close()
        try:
            write(dict(event='stop', utc=utc(), reason=reason, workers_stopped=stopped,
                       worker_exit_codes=[w.exitcode for w in workers]))
        finally:
            log.close()
        if not stopped:
            raise RuntimeError('Owned worker termination is unverified')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    parser.add_argument('--duration', type=int, default=570)
    args = parser.parse_args()
    if not 1 <= args.duration <= 600:
        parser.error('Duration must be 1..600 seconds')
    raise SystemExit(run(args.output, args.duration))
