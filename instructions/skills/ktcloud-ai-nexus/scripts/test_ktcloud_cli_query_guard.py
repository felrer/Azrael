"""Offline subprocess tests: never authenticates or contacts Backend.AI."""
import io
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import ktcloud_cli_query_guard as guard


def powershell_command():
    shell = shutil.which('pwsh')
    if shell is None and os.name == 'nt':
        shell = shutil.which('powershell.exe')
    if shell is None:
        raise RuntimeError('PowerShell is required for wrapper contract tests.')
    command = [shell, '-NoProfile']
    if os.name == 'nt':
        command += ['-ExecutionPolicy', 'Bypass']
    return command + ['-Command']


class QueryGuardTests(unittest.TestCase):
    def run_query(self, source, arguments=('session', 'list'), retries=2, timeout=2, log=None):
        out, err = io.BytesIO(), io.BytesIO()
        code = guard.supervise([sys.executable, '-c', source], arguments, 'abydos', 'Windows',
                               '25.5.2', timeout, retries, log, out, err)
        return code, out.getvalue(), err.getvalue()

    def test_streams_and_exit_preserved(self):
        code, out, err = self.run_query("import sys;sys.stdout.buffer.write(b'{\"ok\":true}\\n');sys.stderr.buffer.write(b'warning\\n')")
        self.assertEqual((code, out, err), (0, b'{"ok":true}\n', b'warning\n'))
        code, out, err = self.run_query("import sys;print('causal failure',file=sys.stderr);sys.exit(7)")
        self.assertEqual(code, 7)
        self.assertEqual(err, b'causal failure\r\n' if os.name == 'nt' else b'causal failure\n')

    def test_retry_isolates_json_and_private_log(self):
        with tempfile.TemporaryDirectory() as temp:
            counter = Path(temp)/'counter'
            log = Path(temp)/'metadata.jsonl'
            source = (f"from pathlib import Path;import sys;p=Path({str(counter)!r});n=int(p.read_text()) if p.exists() else 0;"
                      "p.write_text(str(n+1));print('{\"attempt\":'+str(n)+'}');"
                      "print('HTTP 503 SECRET session-uuid https://private/url' if n==0 else '',file=sys.stderr);sys.exit(1 if n==0 else 0)")
            code, out, err = self.run_query(source, ('session', 'info', 'session-uuid'), log=log)
            self.assertEqual(code, 0)
            self.assertEqual(json.loads(out), {'attempt': 1})
            self.assertNotIn(b'503', err)
            rows = [json.loads(line) for line in log.read_text().splitlines()]
            self.assertEqual([r['classification'] for r in rows], ['http-server', 'success'])
            self.assertEqual(rows[0]['command'], 'session info')
            for sensitive in ('SECRET', 'session-uuid', 'https://', '503', str(counter)):
                self.assertNotIn(sensitive, log.read_text())
            self.assertEqual(set(rows[0]), {'account','runtime','client_version','command','attempt','elapsed_seconds','exit_code','classification','timeout'})

    def test_no_retry_for_causal_failures(self):
        errors = [('HTTP 401 authentication failed', 'authentication'),
                  ('HTTP 400 bad request', 'http-client'),
                  ('ValidationError quota Field required', 'schema-incompatible'),
                  ("status_history TypeError NoneType is not iterable", 'missing-history'),
                  ('Usage: invalid value', 'invalid-arguments'), ('There is no such format option', 'invalid-arguments'), ('unknown failure', 'unknown')]
        for error, classification in errors:
            with self.subTest(error=error), tempfile.TemporaryDirectory() as temp:
                log = Path(temp)/'log'
                code, out, err = self.run_query(f'import sys;print({error!r},file=sys.stderr);sys.exit(3)', log=log)
                self.assertEqual(code, 3)
                rows = [json.loads(x) for x in log.read_text().splitlines()]
                self.assertEqual(len(rows), 1)
                self.assertEqual(rows[0]['classification'], classification)
                self.assertIn(error.encode(), err)

    def test_allowlist_rejects_mutations_and_connections(self):
        for args in [('session','create'),('session','ssh','uuid'),('session','scp','uuid'),
                     ('v2','session','destroy'),('v2','vfolder','create'),('admin','keypair','info'),
                     ('--help','session','list'),('session list',),('v2','my','session','get','uuid')]:
            with self.subTest(args=args), patch.object(guard, 'attempt') as attempt:
                with self.assertRaises(ValueError):
                    guard.supervise([], args, 'abydos','Windows','25.5.2')
                attempt.assert_not_called()
        self.assertEqual(guard.read_policy(['v2','session','get','uuid']), ('v2 session get',30))
        self.assertEqual(guard.read_policy(['v2','resource-allocation','resource-group-usage','mock-group']),
                         ('v2 resource-allocation resource-group-usage',30))

    def test_legacy_server_timeout_retries(self):
        with tempfile.TemporaryDirectory() as temp:
            log=Path(temp)/'log'
            code,out,err=self.run_query('import sys;print("The server didn\'t respond in time.",file=sys.stderr);sys.exit(4)',log=log)
            self.assertEqual(code,4)
            rows=[json.loads(line) for line in log.read_text().splitlines()]
            self.assertEqual(len(rows),3)
            self.assertTrue(all(row['classification']=='transient-network' for row in rows))
            self.assertEqual(err.count(b"The server didn't respond in time."),1)

    def test_retry_cap_rejects_three(self):
        with patch.object(guard,'attempt') as attempt:
            with self.assertRaises(ValueError):
                self.run_query('print("must not run")',retries=3)
            attempt.assert_not_called()
        wrapper=Path(__file__).with_name('ktcloud_cli.ps1')
        result=subprocess.run(powershell_command()+[
            f"try {{ & '{wrapper}' -Account abydos -MaxRetries 3 -- session list }} catch {{ if ($_.FullyQualifiedErrorId -eq 'ParameterArgumentValidationError,ktcloud_cli.ps1') {{ exit 0 }}; exit 2 }}; exit 3"],capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr.decode(errors='replace'))

    def test_timeout_cleans_windows_descendants(self):
        with tempfile.TemporaryDirectory() as temp:
            marker = Path(temp)/'escaped'
            source = ("import subprocess,sys,time;subprocess.Popen([sys.executable,'-c',"
                      f"{('import time;from pathlib import Path;time.sleep(1.5);Path('+repr(str(marker))+').touch()')!r}]);time.sleep(20)")
            code, out, err = self.run_query(source, retries=0, timeout=.25)
            self.assertEqual(code,124)
            self.assertIn(b'timed out',err)
            time.sleep(1.7)
            self.assertFalse(marker.exists(), 'descendant survived timeout')

    def test_large_output_drains_both_streams(self):
        code,out,err = self.run_query("import sys;sys.stdout.buffer.write(b'x'*1500000);sys.stderr.buffer.write(b'y'*1500000)")
        self.assertEqual(code,0)
        self.assertEqual((len(out),len(err)),(1500000,1500000))

    def test_wsl_timeout_cleans_linux_descendants(self):
        if os.name != 'nt': self.skipTest('WSL verification runs on Windows')
        distro = 'ktcloud-ubuntu-24.04'
        source = "import subprocess,time;subprocess.Popen(['python3','-c','import time;time.sleep(30)']);print('STARTED',flush=True);time.sleep(30)"
        command = ['wsl.exe','-d',distro,'--','python3','-c',source]
        out,err=io.BytesIO(),io.BytesIO()
        code = guard.supervise(command, ['v2','session','get','mock'], 'abydos','Linux','26.7.0', .3,0,None,out,err)
        self.assertEqual(code,124)
        # Match only this test's distinctive harmless child, not another distro or process.
        probe = subprocess.run(['wsl.exe','-d',distro,'--','python3','-c',
            "from pathlib import Path;import sys;matches=[p for p in Path('/proc').iterdir() if p.name.isdigit() and p.name!=str(__import__('os').getpid()) and (p/'cmdline').exists() and (p/'cmdline').read_bytes().split(bytes([0]))==[b'python3',b'-c',b'import time;time.sleep(30)',b'']];sys.exit(bool(matches))"],capture_output=True)
        self.assertEqual(probe.returncode,0,probe.stderr.decode(errors='replace'))

    def test_interrupt_cleans_supervised_child(self):
        original = subprocess.Popen
        def interrupted(*args, **kwargs):
            p = original(*args, **kwargs)
            original_wait = p.wait
            first = True
            def wait(*args, **kwargs):
                nonlocal first
                if first:
                    first = False
                    time.sleep(.15)
                    raise KeyboardInterrupt()
                return original_wait(*args, **kwargs)
            p.wait = wait
            return p
        with patch.object(guard.subprocess, 'Popen', side_effect=interrupted):
            with self.assertRaises(KeyboardInterrupt):
                self.run_query('import time;time.sleep(30)', retries=0)
            if os.name == 'nt':
                with self.assertRaises(KeyboardInterrupt):
                    guard.supervise(['wsl.exe','-d','ktcloud-ubuntu-24.04','--','python3','-c',
                        'import time;time.sleep(35)'], ['v2','session','get','mock'],
                        'abydos','Linux','26.7.0', 10,0,None,io.BytesIO(),io.BytesIO())
        if os.name == 'nt':
            result = subprocess.run(['wsl.exe','-d','ktcloud-ubuntu-24.04','--','python3','-c',
                "from pathlib import Path;import sys;matches=[p for p in Path('/proc').iterdir() if p.name.isdigit() and (p/'cmdline').exists() and (p/'cmdline').read_bytes().split(bytes([0]))==[b'python3',b'-c',b'import time;time.sleep(35)',b'']];sys.exit(bool(matches))"],capture_output=True)
            self.assertEqual(result.returncode,0,result.stderr.decode(errors='replace'))

    def test_wrapper_supervised_fixture_and_error_exit(self):
        import shutil
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            wrapper = root/'ktcloud_cli.ps1'
            source = Path(__file__).parent
            for name in ('ktcloud_cli.ps1', 'ktcloud_cli_query_guard.py', 'ktcloud_cli_runner.py'):
                shutil.copyfile(source/name, root/name)
            # This fixture uses no real credentials or client queries.
            (root/'resolve_backendai_windows_python.ps1').write_text("'"+sys.executable.replace("'","''")+"'",encoding='utf-8')
            # Keep the real job class available and replace the fixture CLI entry point only.
            runner = root/'fixture.py'
            runner.write_text("import sys,json;print(json.dumps(sys.argv[1:]));sys.exit(9 if 'fail' in sys.argv else 0)")
            # Preserve a BOM after changing the fixture entry point: Windows
            # PowerShell 5.1 otherwise parses the Korean wrapper text as ANSI.
            wrapper.write_text(wrapper.read_text(encoding='utf-8-sig').replace("'ktcloud_cli_runner.py'", "'fixture.py'"),encoding='utf-8-sig')
            cookie = root/'ktcloud-ai-nexus'/'backend-state'/'abydos'/'Lablup'/'backend.ai'/'cookie.dat'
            cookie.parent.mkdir(parents=True); cookie.touch()
            env = os.environ.copy(); env['LOCALAPPDATA']=temp; env.pop('KTCLOUD_BACKEND_RUNTIME',None)
            for identifier, expected in [('fixture-id',0),('fail',9)]:
                cmd=powershell_command()+[f"$ErrorActionPreference='Stop'; & '{wrapper}' -Account abydos -TimeoutSeconds 2 -MaxRetries 0 -- session info {identifier}; exit $LASTEXITCODE"]
                result = subprocess.run(cmd,env=env,capture_output=True)
                self.assertEqual(result.returncode,expected,result.stderr.decode(errors='replace'))
                self.assertTrue(result.stdout, result.stderr.decode(errors='replace'))
                self.assertIn(identifier,json.loads(result.stdout))
            metadata = (root/'ktcloud-ai-nexus'/'diagnostics'/'query-attempts.jsonl').read_text()
            self.assertNotIn('fixture-id',metadata)
    def test_wrapper_contract_and_option_rejection(self):
        wrapper = Path(__file__).with_name('ktcloud_cli.ps1')
        text = wrapper.read_text(encoding='utf-8-sig')
        for label in guard.READ_PATHS: self.assertIn("'"+label+"'",text)
        for args in [('session','create'),('session','ssh'),('session','scp')]:
            cmd = powershell_command()+[f"try {{ & '{wrapper}' -Account abydos -TimeoutSeconds 1 -- {' '.join(args)} }} catch {{ if ($_.Exception.Message -match 'explicitly allowlisted') {{ exit 0 }}; exit 2 }}; exit 3"]
            result = subprocess.run(cmd,capture_output=True)
            self.assertEqual(result.returncode,0,result.stderr.decode(errors='replace'))

if __name__ == '__main__': unittest.main(verbosity=2)
