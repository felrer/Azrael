"""Bounded, metadata-only supervision of explicitly read-only Backend.AI commands."""
from __future__ import annotations
import argparse
import contextlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import threading
import time

READ_PATHS = {
    'session list': 60, 'session info': 30, 'session status-history': 30,
    'image list': 60, 'vfolder list': 60, 'vfolder info': 30,
    'v2 my session search': 60, 'v2 session get': 30,
    'v2 my resource-allocation keypair-usage': 30, 'v2 config show': 30,
    'v2 resource-allocation resource-group-usage': 30,
    'v2 runtime-variant-preset search': 60,
    'v2 vfolder my-search': 60, 'v2 vfolder project-search': 60,
}

def read_policy(arguments):
    tokens = [a.lower() for a in arguments if a != '--']
    for label, timeout in READ_PATHS.items():
        path = label.split()
        if tokens[:len(path)] == path:
            return label, timeout
    return None


def classify(code, tail, timed_out=False):
    if timed_out:
        return 'timeout', True
    if code == 0:
        return 'success', False
    s = tail.decode('utf-8', 'replace').lower()
    if 'status_history' in s and ('nonetype' in s or 'none' in s):
        return 'missing-history', False
    if any(x in s for x in ('validationerror', 'field required', 'missing field', 'missing required', 'schema')):
        return 'schema-incompatible', False
    if re.search(r'(?:http[^\n]{0,30}|status(?:[_ -]code)?\s*[:=]?\s*)(?:401|403)\b', s) or any(x in s for x in ('unauthorized', 'unauthenticated', 'authentication', 'login required')):
        return 'authentication', False
    if re.search(r'(?:http[^\n]{0,30}|status(?:[_ -]code)?\s*[:=]?\s*)4\d\d\b|\b4\d\d,\s*message=', s):
        return 'http-client', False
    if any(x in s for x in ('no such option', 'there is no such format option', 'invalid value', 'missing argument', 'usage:', 'unrecognized arguments')):
        return 'invalid-arguments', False
    if re.search(r'(?:http[^\n]{0,30}|status(?:[_ -]code)?\s*[:=]?\s*)5\d\d\b|\b5\d\d(?:,\s*message=|\s+(?:internal server error|bad gateway|service unavailable|gateway timeout))', s):
        return 'http-server', True
    if any(x in s for x in ('connectionreseterror', 'connection reset', 'connection refused', 'temporarily unavailable', 'temporary failure in name resolution', 'connecttimeout', 'readtimeout', 'server disconnected', 'network is unreachable', 'connection timed out', 'timeouterror', "the server didn't respond in time.")):
        return 'transient-network', True
    return 'unknown', False

# Runs inside WSL. Own process group only; stdin cancellation/EOF also cleans up.
# The command and identifiers never enter a persistent file or diagnostic record.
LINUX_GUARD = r'''
import os, signal, subprocess, sys, threading, time
p = subprocess.Popen(sys.argv[2:], start_new_session=True, stdin=subprocess.DEVNULL)
stop = threading.Event()
def watch():
    os.read(0, 1)
    stop.set()
threading.Thread(target=watch, daemon=True).start()
def cancel(*unused): stop.set()
signal.signal(signal.SIGTERM, cancel)
signal.signal(signal.SIGINT, cancel)
deadline = time.monotonic() + float(sys.argv[1])
while p.poll() is None and not stop.is_set() and time.monotonic() < deadline:
    stop.wait(.05)
code = p.poll()
# Reap any surviving descendants even if the direct child exited.
try: os.killpg(p.pid, signal.SIGKILL)
except ProcessLookupError: pass
p.wait()
sys.exit(code if code is not None else (130 if stop.is_set() else 124))
'''


def guarded_argv(command, timeout, runtime):
    if runtime != 'Linux':
        return command
    boundary = command.index('--')
    return command[:boundary+1] + ['python3', '-c', LINUX_GUARD, str(timeout)] + command[boundary+1:]


def _drain(pipe, spool, tail):
    try:
        while chunk := pipe.read(65536):
            spool.write(chunk)
            tail.extend(chunk)
            del tail[:-65536]
    finally:
        pipe.close()


def _emit(spool, target):
    spool.seek(0)
    while chunk := spool.read(65536):
        target.write(chunk)
    target.flush()


def attempt(command, timeout, runtime):
    out = tempfile.SpooledTemporaryFile(max_size=1024*1024)
    err = tempfile.SpooledTemporaryFile(max_size=1024*1024)
    tails = [bytearray(), bytearray()]
    started = time.monotonic()
    try:
        # Reuse the existing stdlib Job Object implementation; no connection behavior changes.
        if os.name == 'nt':
            from ktcloud_cli_runner import WindowsKillOnCloseJob
            job = WindowsKillOnCloseJob()
        else:
            job = contextlib.nullcontext()
        with job:
            p = subprocess.Popen(guarded_argv(command, timeout, runtime), shell=False,
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 start_new_session=os.name != 'nt')
            try:
                if os.name == 'nt':
                    job.assign(p)
                threads = [threading.Thread(target=_drain, args=(pipe, spool, tail), daemon=True)
                           for pipe, spool, tail in zip((p.stdout, p.stderr), (out, err), tails)]
                for thread in threads: thread.start()
                try:
                    code = p.wait(timeout=timeout + (5 if runtime == 'Linux' else 0))
                    timed_out = runtime == 'Linux' and code == 124
                except subprocess.TimeoutExpired:
                    timed_out = True
                    if runtime == 'Linux':
                        p.stdin.write(b'!'); p.stdin.flush()
                        try: p.wait(timeout=5)
                        except subprocess.TimeoutExpired: p.kill()
                    elif os.name != 'nt':
                        os.killpg(p.pid, signal.SIGKILL)
                    else:
                        job.__exit__(None, None, None)
                    p.wait()
                    code = p.returncode
                except KeyboardInterrupt:
                    if runtime == 'Linux':
                        p.stdin.write(b'!'); p.stdin.flush()
                        try: p.wait(timeout=5)
                        except subprocess.TimeoutExpired: p.kill()
                    elif os.name != 'nt': os.killpg(p.pid, signal.SIGKILL)
                    else: job.__exit__(None, None, None)
                    p.wait()
                    raise
            finally:
                if p.poll() is None:
                    p.kill(); p.wait()
                p.stdin.close()
            # Closing the job also reaps descendants which inherited output handles.
        for thread in threads: thread.join(timeout=5)
        if any(t.is_alive() for t in threads):
            raise RuntimeError('Read output did not close after supervised cleanup')
        classification, retry = classify(code, bytes(tails[0]+tails[1]), timed_out)
        return out, err, code, classification, retry, time.monotonic()-started, timed_out
    except BaseException:
        out.close(); err.close()
        raise


def supervise(command, arguments, account, runtime, version, timeout=None, retries=2, log_path=None,
              stdout=None, stderr=None):
    policy = read_policy(arguments)
    if policy is None:
        raise ValueError('Supervision is restricted to explicit read-only command paths')
    label, default_timeout = policy
    timeout = default_timeout if timeout is None else timeout
    if timeout <= 0 or not 0 <= retries <= 2:
        raise ValueError('Invalid supervision bounds')
    stdout = stdout or sys.stdout.buffer
    stderr = stderr or sys.stderr.buffer
    for number in range(1, retries+2):
        out, err, code, classification, retry, elapsed, timed_out = attempt(command, timeout, runtime)
        try:
            if log_path:
                metadata = dict(account=account, runtime=runtime, client_version=version,
                                command=label, attempt=number, elapsed_seconds=round(elapsed, 3),
                                exit_code=code, classification=classification, timeout=timed_out)
                try:
                    log_path.parent.mkdir(parents=True, exist_ok=True)
                    with log_path.open('a', encoding='utf-8') as log:
                        log.write(json.dumps(metadata, separators=(',', ':'))+'\n')
                except OSError:
                    stderr.write(b'Query diagnostic metadata could not be saved.\n')
            if retry and number <= retries:
                time.sleep(min(.25 * number, 1))
                continue
            _emit(out, stdout); _emit(err, stderr)
            hints = {
                'schema-incompatible': b'Query schema is incompatible with this client. Use an explicitly selected compatible query; do not patch SDK DTOs or infer image defaults from presets.\n',
                'missing-history': b'Server returned no status_history. Inspect session info explicitly; missing history is not an empty verified history.\n',
                'timeout': b'Read query timed out; its supervised process tree was stopped.\n',
            }
            if classification == 'schema-incompatible' and label == 'v2 runtime-variant-preset search':
                hints[classification] = b'Runtime preset DTO may require a missing required field. Verify server/client compatibility; preserve preset semantics and do not substitute image defaults.\n'
            elif classification == 'schema-incompatible' and label.startswith('v2 vfolder '):
                hints[classification] = b'Vfolder DTO may require a missing quota field. Explicitly query legacy vfolder list/info if those fields meet your requirement; no automatic fallback was performed.\n'
            if classification in hints:
                stderr.write(hints[classification]); stderr.flush()
            return 124 if timed_out else code
        finally:
            out.close(); err.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--account', required=True)
    parser.add_argument('--runtime', required=True, choices=['Windows', 'Linux'])
    parser.add_argument('--timeout', type=float)
    parser.add_argument('--retries', type=int, default=2)
    parser.add_argument('--cli-count', type=int, required=True)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    opts = parser.parse_args()
    command = opts.command[1:] if opts.command[:1] == ['--'] else opts.command
    if not 0 < opts.cli_count < len(command): parser.error('Invalid CLI argument count')
    if not re.fullmatch(r'(trinity|abydos|arius[1-9][0-9]*)', opts.account): parser.error('Invalid account')
    log = Path(os.environ['LOCALAPPDATA'])/'ktcloud-ai-nexus'/'diagnostics'/'query-attempts.jsonl'
    try:
        return supervise(command, command[-opts.cli_count:], opts.account, opts.runtime,
                         '26.7.0' if opts.runtime == 'Linux' else '25.5.2', opts.timeout, opts.retries, log)
    except KeyboardInterrupt:
        return 130

if __name__ == '__main__':
    sys.exit(main())
