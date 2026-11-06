"""Align observed recording gaps with actual before/after samples; never fill missing data."""
import argparse
import datetime as dt
import json
from pathlib import Path


def read_records(path):
    records, invalid = [], 0
    with Path(path).open(encoding='utf-8-sig', errors='replace') as file:
        for line in file:
            try:
                row = json.loads(line)
                if not isinstance(row, dict): raise ValueError('Not an object')
                records.append(row)
            except (ValueError, TypeError):
                invalid += 1
    return records, invalid


def stamp(value):
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00'))


def compact(row):
    if not row: return None
    sensors = row.get('sensors', {})
    return dict(utc=row['utc'], sequence=row['sequence'], system=row.get('system'),
                collection_ended_utc=row.get('collection_ended_utc'), phase_seconds=row.get('phase_seconds'),
                previous_write_seconds=row.get('previous_write_seconds'),
                disks=row.get('disks'), sensors=sensors,
                top_processes=sorted(row.get('processes', {}).get('top', []),
                                     key=lambda p:p.get('private_bytes', 0), reverse=True)[:5],
                alerts=row.get('alerts', []))


def analyze(system_path, heartbeat_path=None, hardware_path=None):
    records, invalid = read_records(system_path)
    samples = [r for r in records if r.get('event') == 'sample']
    windows = []
    for previous, current in zip(samples, samples[1:]):
        seconds = (stamp(current['utc'])-stamp(previous['utc'])).total_seconds()
        if seconds >= 6 or current.get('gap_seconds', 0) >= 6:
            windows.append(dict(source='system_recorder_gap', from_utc=previous['utc'],
                                to_utc=current['utc'], seconds=seconds))
    heartbeat, bad_heartbeats = [], 0
    if heartbeat_path:
        heartbeat, bad_heartbeats = read_records(heartbeat_path)
        for row in heartbeat:
            if row.get('event') == 'watchdog_gap':
                windows.append(dict(source='independent_watchdog_gap', from_utc=row['from_utc'],
                                    to_utc=row['to_utc'], seconds=row['interval_seconds'],
                                    possible_sleep=row.get('possible_sleep'),
                                    previous_write_could_explain_gap=row.get('previous_write_could_explain_gap')))
    hardware, bad_hardware = [], 0
    if hardware_path:
        hardware, bad_hardware = read_records(hardware_path)
    hardware_samples = [r for r in hardware if r.get('event') == 'sample']
    for window in windows:
        before = [s for s in samples if stamp(s['utc']) <= stamp(window['from_utc'])]
        after = [s for s in samples if stamp(s['utc']) >= stamp(window['to_utc'])]
        window['before'] = compact(before[-1] if before else None)
        window['after'] = compact(after[0] if after else None)
        window['observed_nearby'] = [compact(s) for s in samples
            if stamp(window['from_utc'])-dt.timedelta(seconds=10) <= stamp(s['utc']) <= stamp(window['to_utc'])+dt.timedelta(seconds=10)]
        observed_before = [s for s in hardware_samples if stamp(s['utc']) <= stamp(window['from_utc'])]
        observed_after = [s for s in hardware_samples if stamp(s['utc']) >= stamp(window['to_utc'])]
        window['hardware_before'] = observed_before[-1] if observed_before else None
        window['hardware_after'] = observed_after[0] if observed_after else None
        window['hardware_nearby'] = [s for s in hardware_samples
            if stamp(window['from_utc'])-dt.timedelta(seconds=10) <= stamp(s['utc']) <= stamp(window['to_utc'])+dt.timedelta(seconds=10)]
    checkpoints = [r for r in heartbeat if r.get('event') in ('heartbeat', 'watchdog_gap')]
    return dict(samples=len(samples), invalid_system_lines=invalid, invalid_heartbeat_lines=bad_heartbeats,
                hardware_samples=len(hardware_samples), invalid_hardware_lines=bad_hardware,
                recorder_clean_stop=any(r.get('event') == 'stop' for r in records),
                watchdog_clean_stop=any(r.get('event') == 'stop' for r in heartbeat) if heartbeat_path else None,
                last_recorded_sample=compact(samples[-1] if samples else None),
                last_alive_checkpoint=checkpoints[-1] if checkpoints else None,
                last_hardware_sample=hardware_samples[-1] if hardware_samples else None,
                last_hardware_error=next((r for r in reversed(hardware) if r.get('event') == 'sensor_unavailable'), None),
                gaps=windows,
                interpretation='Recording gaps can reflect process, scheduler, storage, sleep or system stalls. '
                               'An absent stop while recording is active is normal; after a confirmed reboot it means interrupted recording. '
                               'No values inside a missing interval are inferred.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('system_log')
    parser.add_argument('--heartbeat-log')
    parser.add_argument('--hardware-log')
    args = parser.parse_args()
    print(json.dumps(analyze(args.system_log, args.heartbeat_log, args.hardware_log), ensure_ascii=False, indent=2))
