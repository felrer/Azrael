"""Synthetic portable package checks; never access real profiles or remote services."""
import hashlib
import importlib.util
import io
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

PROJECT = Path(__file__).resolve().parents[2]
SCRIPTS = PROJECT / 'scripts'
spec = importlib.util.spec_from_file_location('app_release', SCRIPTS / 'package-app-release.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def sha(data):
    return hashlib.sha256(data).hexdigest()


class AppReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='azrael-app-release-test-')
        self.addCleanup(self.cleanup_fixture)
        self.root = Path(self.temp.name)
        self.release = self.root / 'source'
        self.host = self.root / 'host.vsix'
        self.output = self.root / 'output'
        self.node = self.root / 'external-node' / 'node.exe'
        self.write(self.node, b'fake node')
        self.write(self.node.parent / 'LICENSE', b'node fixture license')
        hashes = {}
        for name in ('codex.exe', 'azrael-bridge.exe', 'codex-code-mode-host.exe'):
            data = ('fixture ' + name).encode()
            self.write(self.release / 'engine' / name, data)
            hashes[name] = sha(data)
        self.write_json(self.release / 'build-info.json', {'sha256': {}, 'engineProvenance': {'source': {'sourceSha256': 'b' * 64}, 'binaries': hashes}})
        closure = {}
        for name in ('scripts/devin-catalog.json', 'scripts/prepare-devin.ps1', 'scripts/start-devin-native.ps1'):
            data = ('fixture ' + name).encode()
            self.write(self.release / name, data)
            closure[name] = sha(data)
        self.write_json(self.release / 'devin-native-build.json', {'files': closure, 'node': {'path': str(self.node), 'sha256': sha(self.node.read_bytes())}})
        self.write_json(self.release / 'opencodex-accounts-build.json', {'files': {}})
        config = {'schema': 1, 'engineVersion': 'fixture', 'engine': str(self.release / 'engine/codex.exe'), 'bridge': str(self.release / 'engine/azrael-bridge.exe'), 'devinNative': {}, 'providerAccounts': {}}
        for owner, key in (('computer-use', 'computerUse'), ('window-control', 'windowControl')):
            self.write_json(self.release / owner / 'manifest.json', {'files': []})
            config[key] = {'manifestSha256': sha((self.release / owner / 'manifest.json').read_bytes())}
        self.write(self.release / 'window-control/azrael-window-control.exe', b'window exe')
        self.write(self.release / 'window-control/window-control-mcp.cjs', b'window mcp')
        for owner in ('devin', 'opencodex'):
            self.write(self.release / 'providers' / owner / 'LICENSE.opencodex', b'provider fixture license')
        self.write(self.release / 'host/runtime.cjs', b'host fixture')
        self.host_entries = {'extension/package.json': json.dumps({'version': '2026.0.0'}).encode(), 'extension/out/azrael-runtime.json': json.dumps(config).encode(), 'extension/LICENSE.md': b'host fixture license'}
        self.write_host()

    def write(self, path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def cleanup_fixture(self):
        self.temp.cleanup()
        self.assertFalse(self.root.exists(), 'Synthetic fixture cleanup incomplete')

    def write_json(self, path, value):
        self.write(path, json.dumps(value).encode())

    def write_host(self):
        with zipfile.ZipFile(self.host, 'w') as archive:
            for name, data in self.host_entries.items():
                archive.writestr(name, data)

    def run_process(self, command, env=None):
        # Never inherit a developer's recipient overrides or touch their state.
        isolated = {key: value for key, value in os.environ.items()
                    if not key.upper().startswith('AZRAEL_')}
        isolated.update(USERPROFILE=str(self.root / 'recipient'),
                        LOCALAPPDATA=str(self.root / 'recipient-local'))
        isolated.update(env or {})
        return subprocess.run(command, env=isolated, capture_output=True, text=True,
                              encoding='utf-8', errors='replace')

    def run_installer(self, extracted, options=(), env=None, expected=0, prepare=True):
        command = ['pwsh', '-NoProfile', '-File', str(extracted / 'install.ps1')]
        if prepare:
            command.append('-PrepareOnly')
        command.extend(str(option) for option in options)
        result = self.run_process(command, env)
        self.assertEqual(result.returncode, expected, result.stderr)
        return result

    def installed_config(self, destination):
        receipt = json.loads((destination / 'installer-receipt.json').read_bytes())
        with zipfile.ZipFile(receipt['customizedVsix']) as archive:
            config = json.loads(archive.read('extension/out/azrael-runtime.json'))
        self.assertEqual(config, receipt['runtimeConfig'])
        self.assertEqual(config, json.loads((destination / 'runtime-config.json').read_bytes()))
        return receipt, config

    def fake_code(self, name, exit_code=0):
        cli = self.root / 'fake-code' / name
        self.write(cli, ("ConvertTo-Json -InputObject @($args) -Compress | "
                         "Set-Content -LiteralPath (Join-Path $PSScriptRoot '" + name + ".calls.json')\n"
                         "$global:LASTEXITCODE = " + str(exit_code) + "\n").encode())
        return cli

    def package(self, expected=0, version='2026.0.0'):
        result = self.run_process([sys.executable, '-B', str(SCRIPTS / 'package-app-release.py'), '--release-directory', str(self.release), '--host-vsix', str(self.host), '--version', version, '--output', str(self.output)])
        self.assertEqual(result.returncode, expected, result.stderr)
        return result

    def extract(self):
        self.package()
        extracted = self.root / 'relocated-package'
        with zipfile.ZipFile(self.output / 'Azrael-2026.0.0-windows-x64.zip') as archive:
            archive.extractall(extracted)
        return extracted

    def install(self, extracted, destination, expected=0):
        state = self.root / 'isolated-state'
        state.mkdir(exist_ok=True)
        self.write(state / 'auth-sentinel', b'preserve')
        result = self.run_process(['pwsh', '-NoProfile', '-File', str(extracted / 'install.ps1'), '-PrepareOnly', '-InstallRoot', str(destination), '-StateRoot', str(state), '-CodePath', str(self.root / 'missing-code.cmd')])
        self.assertEqual(result.returncode, expected, result.stderr)
        self.assertEqual((state / 'auth-sentinel').read_bytes(), b'preserve')
        return result

    def test_package_portable_closure_and_checksum_contract(self):
        self.package()
        manifest = json.loads((self.output / 'release-manifest.json').read_bytes())
        self.assertEqual(manifest['hostVersion'], '2026.0.0')
        self.assertEqual(len(manifest['assets']), 1)
        asset = manifest['assets'][0]
        self.assertEqual(asset['sha256'], sha((self.output / asset['name']).read_bytes()))
        self.assertEqual((self.output / 'SHA256SUMS.txt').read_text().splitlines(), [asset['sha256'] + '  ' + asset['name'], sha((self.output / 'release-manifest.json').read_bytes()) + '  release-manifest.json'])
        with zipfile.ZipFile(self.output / asset['name']) as archive:
            for name in ('devin-catalog.json', 'prepare-devin.ps1', 'start-devin-native.ps1'):
                self.assertIn('runtime/scripts/' + name, archive.namelist())
            devin = json.loads(archive.read('runtime/devin-native-build.json'))
            self.assertEqual(devin['node']['path'], 'node/node.exe')
            self.assertTrue(devin['node']['bundled'])
            with zipfile.ZipFile(io.BytesIO(archive.read('host-template.vsix'))) as host:
                config = json.loads(host.read('extension/out/azrael-runtime.json'))
                self.assertEqual(config['codexHome'], '@STATE@')
                self.assertEqual(config['devinNative']['releaseDirectory'], '.')

    def test_engine_and_external_node_tamper_rejected(self):
        for file, expected in ((self.release / 'engine/codex.exe', 'Hash mismatch'), (self.node, 'External Node hash mismatch')):
            old = file.read_bytes()
            file.write_bytes(b'tampered')
            self.assertIn(expected, self.package(1).stderr)
            self.assertFalse(self.output.exists())
            file.write_bytes(old)

    def test_missing_provider_script_rejected(self):
        (self.release / 'scripts/start-devin-native.ps1').unlink()
        self.assertIn('Missing file', self.package(1).stderr)

    def test_numeric_release_version_boundaries(self):
        for version in ('02026.0.0', '2026.00.0', '2026.0.00', '9007199254740992.0.0', '0.9007199254740992.0', '0.0.9007199254740992', '2026.0.0-rc1', '2026.0.0+build'):
            with self.subTest(version=version):
                self.assertIn('Invalid release version', self.package(1, version).stderr)
                self.assertFalse(self.output.exists())
        for version in ('0.5.1791324000000', '9007199254740991.0.0'):
            with self.subTest(version=version):
                self.host_entries['extension/package.json'] = json.dumps({'version': version}).encode()
                self.write_host()
                self.output = self.root / ('output-' + version)
                self.package(version=version)
                manifest = json.loads((self.output / 'release-manifest.json').read_bytes())
                self.assertEqual(manifest['releaseVersion'], version)

    def test_unsafe_zip_paths_and_case_collisions_rejected(self):
        with self.assertRaises(ValueError):
            builder.relative('a\\b')
        # Windows zipfile normalizes backslashes to safe forward slashes.
        for entries in ([('../escape', b'x')], [('/absolute', b'x')], [('a:stream', b'x')], [('A', b'x'), ('a', b'y')]):
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, 'w') as archive:
                for name, data in entries:
                    archive.writestr(name, data)
            stream.seek(0)
            with self.assertRaises(ValueError):
                builder.read_zip(stream)

    def test_relocated_prepare_only_and_same_version_refusal(self):
        extracted = self.extract()
        destination = self.root / 'installed'
        self.install(extracted, destination)
        receipt = json.loads((destination / 'installer-receipt.json').read_bytes())
        self.assertTrue(receipt['preparedOnly'])
        self.assertFalse(receipt['installed'])
        self.assertEqual(receipt['runtimeConfig']['codexHome'], str(self.root / 'isolated-state'))
        self.assertEqual(receipt['runtimeConfig']['engine'], str(destination / 'runtime/engine/codex.exe'))
        before = (destination / 'installer-receipt.json').read_bytes()
        self.assertIn('occupied', self.install(extracted, destination, 1).stderr)
        self.assertEqual((destination / 'installer-receipt.json').read_bytes(), before)

    def test_prepare_failure_rolls_back_new_destination(self):
        extracted = self.extract()
        # Re-sign the inventory after changing template configuration, so failure
        # occurs after runtime creation and exercises rollback rather than preflight.
        template = extracted / 'host-template.vsix'
        entries = builder.read_zip(template)
        config = json.loads(entries['extension/out/azrael-runtime.json'])
        config['codexHome'] = 'invalid-template'
        entries['extension/out/azrael-runtime.json'] = json.dumps(config).encode()
        template.write_bytes(builder.zip_bytes(entries))
        inventory = json.loads((extracted / 'package-manifest.json').read_bytes())
        entry = next(e for e in inventory['files'] if e['path'] == 'host-template.vsix')
        entry.update(size=template.stat().st_size, sha256=sha(template.read_bytes()))
        self.write_json(extracted / 'package-manifest.json', inventory)
        destination = self.root / 'rollback-destination'
        self.assertIn('template version/configuration mismatch', self.install(extracted, destination, 1).stderr)
        self.assertFalse(destination.exists())

    def test_recipient_environment_paths_are_frozen_and_portable(self):
        extracted = self.extract()
        # Remove the synthetic publisher's source and external Node using native
        # PowerShell, with containment checked before each recursive deletion.
        cleanup = self.root / 'remove-packaging-inputs.ps1'
        self.write(cleanup, b'''param([string]$FixtureRoot, [string]$Source, [string]$NodeRoot)
$ErrorActionPreference = 'Stop'
foreach ($path in @($Source, $NodeRoot)) {
    $full = [IO.Path]::GetFullPath($path)
    if (-not $full.StartsWith([IO.Path]::GetFullPath($FixtureRoot).TrimEnd('\\') + '\\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Outside fixture' }
    Remove-Item -LiteralPath $full -Recurse -Force
}
''')
        result = self.run_process(['pwsh', '-NoProfile', '-File', str(cleanup),
                                   '-FixtureRoot', str(self.root), '-Source', str(self.release),
                                   '-NodeRoot', str(self.node.parent)])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.release.exists())
        self.assertFalse(self.node.parent.exists())
        snapshots = []
        for user in ('Alice 공간', 'Bob 사용자'):
            with self.subTest(user=user):
                recipient = self.root / user
                releases = recipient / 'custom releases'
                state = recipient / 'persistent 상태'
                devin = recipient / 'cli 도구' / 'devin.exe'
                self.write(devin, b'fake recipient CLI')
                self.write(state / 'auth-sentinel', b'preserve recipient state')
                ordinary = recipient / '.codex' / 'auth-sentinel'
                self.write(ordinary, b'ordinary Codex remains separate')
                env = {'USERPROFILE': str(recipient), 'AZRAEL_RELEASES_ROOT': str(releases),
                       'AZRAEL_STATE_ROOT': str(state), 'AZRAEL_DEVIN_EXECUTABLE': str(devin)}
                self.run_installer(extracted, env=env)
                destination = releases / '2026.0.0'
                receipt, config = self.installed_config(destination)
                self.assertEqual(config['codexHome'], str(state))
                self.assertEqual(config['devinExecutable'], str(devin))
                self.assertEqual(config['engine'], str(destination / 'runtime/engine/codex.exe'))
                self.assertEqual(config['devinNative']['releaseDirectory'], str(destination / 'runtime'))
                devin_manifest = json.loads((destination / 'runtime/devin-native-build.json').read_bytes())
                self.assertEqual(devin_manifest['node']['path'], str(destination / 'runtime/node/node.exe'))
                self.assertEqual((destination / 'runtime/node/node.exe').read_bytes(), b'fake node')
                self.assertEqual((state / 'auth-sentinel').read_bytes(), b'preserve recipient state')
                self.assertEqual(ordinary.read_bytes(), b'ordinary Codex remains separate')
                self.assertTrue(receipt['preparedOnly'])
                self.assertFalse(receipt['installed'])
                snapshots.append((destination, config))
        # A later install for another recipient never rewrites the earlier config.
        for destination, frozen in snapshots:
            self.assertEqual(self.installed_config(destination)[1], frozen)
        self.assertNotEqual(snapshots[0][1]['codexHome'], snapshots[1][1]['codexHome'])

    def test_default_roots_follow_current_recipient(self):
        extracted = self.extract()
        for user in ('default Alice', 'default Bob 사용자'):
            with self.subTest(user=user):
                home = self.root / user
                local = home / 'Local AppData'
                self.run_installer(extracted, env={'USERPROFILE': str(home), 'LOCALAPPDATA': str(local)})
                destination = local / 'azrael-ex/releases/2026.0.0'
                _, config = self.installed_config(destination)
                self.assertEqual(config['codexHome'], str(home / '.azrael-ex'))
                self.assertNotIn('devinExecutable', config)
                self.assertFalse((home / '.codex').exists())

    def test_explicit_options_override_environment_and_installroot_wins(self):
        extracted = self.extract()
        explicit_devin = self.root / 'explicit CLI 공간' / 'devin.exe'
        self.write(explicit_devin, b'explicit CLI')
        state = self.root / 'explicit state 상태'
        releases = self.root / 'explicit releases 공간'
        env = {'AZRAEL_RELEASES_ROOT': 'invalid-relative-env-release',
               'AZRAEL_STATE_ROOT': 'invalid-relative-env-state',
               'AZRAEL_DEVIN_EXECUTABLE': str(self.root / 'missing-env-devin.exe')}
        options = ['-StateRoot', state, '-DevinExecutable', explicit_devin]
        self.run_installer(extracted, ['-ReleasesRoot', releases, *options], env)
        _, config = self.installed_config(releases / '2026.0.0')
        self.assertEqual(config['codexHome'], str(state))
        self.assertEqual(config['devinExecutable'], str(explicit_devin))
        destination = self.root / 'exact destination 사용자'
        self.run_installer(extracted, ['-InstallRoot', destination,
                                       '-ReleasesRoot', 'invalid-ignored-option', *options], env)
        self.assertEqual(self.installed_config(destination)[1]['engine'],
                         str(destination / 'runtime/engine/codex.exe'))

    def test_invalid_recipient_paths_fail_before_destination_creation(self):
        extracted = self.extract()
        state = self.root / 'safe-state'
        home = self.root / 'recipient'
        ordinary = home / '.codex' / 'auth-sentinel'
        self.write(ordinary, b'preserve ordinary state')
        self.write(state / 'auth-sentinel', b'preserve Azrael state')
        cases = [
            (lambda destination: ['-ReleasesRoot', 'relative-release'], {}, 'absolute Windows path'),
            (lambda destination: ['-StateRoot', 'relative-state'], {}, 'absolute Windows path'),
            (lambda destination: ['-StateRoot', destination / 'state'], {}, 'separate'),
            (lambda destination: ['-StateRoot', self.root], {}, 'separate'),
            (lambda destination: ['-StateRoot', extracted / 'state'], {}, 'separate'),
            (lambda destination: ['-StateRoot', home / '.codex'], {}, 'ordinary Codex'),
            (lambda destination: ['-StateRoot', home / '.codex' / 'nested'], {}, 'ordinary Codex'),
            (lambda destination: ['-DevinExecutable', 'relative-cli.exe'], {}, 'absolute Windows path'),
            (lambda destination: [], {'AZRAEL_DEVIN_EXECUTABLE': str(self.root / 'missing-cli.exe')}, 'missing'),
            (lambda destination: ['-DevinExecutable', self.root], {}, 'missing'),
        ]
        for index, (make_options, env, error) in enumerate(cases):
            destination = self.root / ('never-created-' + str(index))
            options = make_options(destination)
            with self.subTest(options=options, env=env):
                # ReleasesRoot case must exercise release-root resolution.
                base = [] if '-ReleasesRoot' in options else ['-InstallRoot', destination]
                if '-InstallRoot' in options:
                    base = []
                if '-StateRoot' not in options:
                    base += ['-StateRoot', state]
                result = self.run_installer(extracted, [*base, *options], env, expected=1)
                self.assertIn(error, result.stderr)
                self.assertFalse(destination.exists())
                self.assertFalse((extracted / 'state').exists())
                self.assertEqual(ordinary.read_bytes(), b'preserve ordinary state')
                self.assertEqual((state / 'auth-sentinel').read_bytes(), b'preserve Azrael state')

    def test_reparse_devin_parent_rejected_before_creation(self):
        extracted = self.extract()
        real = self.root / 'real-cli'
        self.write(real / 'devin.exe', b'fake CLI')
        junction = self.root / 'linked-cli'
        result = self.run_process(['pwsh', '-NoProfile', '-Command',
                                  'New-Item -ItemType Junction -Path $env:TEST_LINK -Target $env:TEST_TARGET -ErrorAction Stop | Out-Null',],
                                 {'TEST_LINK': str(junction), 'TEST_TARGET': str(real)})
        if result.returncode:
            self.skipTest('Fixture junction unavailable: ' + result.stderr.strip())
        # Remove only the junction itself before TemporaryDirectory cleanup.
        self.addCleanup(os.rmdir, junction)
        destination = self.root / 'reparse-never-created'
        result = self.run_installer(extracted, ['-InstallRoot', destination,
                                               '-DevinExecutable', junction / 'devin.exe'], expected=1)
        self.assertIn('Reparse point forbidden', result.stderr)
        self.assertFalse(destination.exists())
        self.assertEqual((real / 'devin.exe').read_bytes(), b'fake CLI')

    def test_codepath_selection_uses_only_local_mock_cli(self):
        extracted = self.extract()
        env_cli = self.fake_code('env-code.ps1')
        explicit_cli = self.fake_code('explicit-code.ps1')
        default_cli = self.fake_code('code.ps1')
        for name, options, env, selected in (
            ('environment', [], {'AZRAEL_CODE_PATH': str(env_cli)}, env_cli),
            ('explicit', ['-CodePath', explicit_cli], {'AZRAEL_CODE_PATH': str(self.root / 'missing-code')}, explicit_cli),
            ('default', [], {'PATH': str(default_cli.parent) + os.pathsep + str(Path(shutil.which('pwsh')).parent)}, default_cli),
        ):
            with self.subTest(selection=name):
                destination = self.root / ('mock-install-' + name)
                self.run_installer(extracted, ['-InstallRoot', destination, *options], env, prepare=False)
                receipt, _ = self.installed_config(destination)
                self.assertTrue(receipt['installed'])
                self.assertFalse(receipt['preparedOnly'])
                calls = json.loads((selected.parent / (selected.name + '.calls.json')).read_text(encoding='utf-8-sig'))
                self.assertEqual(calls, ['--install-extension', receipt['customizedVsix']])
        missing = self.root / 'missing-code-destination'
        result = self.run_installer(extracted, ['-InstallRoot', missing],
                                    {'AZRAEL_CODE_PATH': str(self.root / 'missing-cli')}, expected=1, prepare=False)
        self.assertIn('Get-Command', result.stderr)
        self.assertFalse(missing.exists())
        failed_cli = self.fake_code('failed-code.ps1', exit_code=17)
        retained = self.root / 'mock-cli-failed'
        result = self.run_installer(extracted, ['-InstallRoot', retained, '-CodePath', failed_cli],
                                    expected=1, prepare=False)
        self.assertIn('exit code 17', result.stderr)
        self.assertTrue((retained / 'runtime').exists())
        self.assertFalse((retained / 'installer-receipt.json').exists())

    def test_orchestrator_rejects_mismatched_receipt_before_packaging(self):
        receipt = self.root / 'prepared.json'
        configured_version = json.loads((SCRIPTS / 'azrael-app-release.json').read_bytes())['version']
        mismatched_version = '0.0.0' if configured_version != '0.0.0' else '0.0.1'
        self.write_json(receipt, {'HostVersion': mismatched_version, 'ReleaseDirectory': str(self.release), 'HostVsix': str(self.host), 'HostSha256': sha(self.host.read_bytes())})
        output = self.root / 'orchestrated'
        result = self.run_process(['pwsh', '-NoProfile', '-File', str(SCRIPTS / 'prepare-app-release.ps1'), '-ReleaseDirectory', str(self.release), '-OutputDirectory', str(output), '-PreparedHostReceipt', str(receipt)])
        self.assertEqual(result.returncode, 1)
        self.assertIn('does not match', result.stderr)
        self.assertFalse((output / 'assets').exists())

    def publisher_preflight(self, repository_info, allow_public=False, verification_hash=None, tag_exists=False):
        if not self.output.exists():
            self.package()
        manifest_path = self.output / 'release-manifest.json'
        manifest = json.loads(manifest_path.read_bytes())
        verification = self.root / 'verification.json'
        self.write_json(verification, {
            'schemaVersion': 1, 'passed': True, 'releaseVersion': manifest['releaseVersion'],
            'manifestSha256': verification_hash or sha(manifest_path.read_bytes()),
            'assets': manifest['assets'],
        })
        notes = self.root / 'notes.md'
        self.write(notes, b'Synthetic release notes')
        fixture = self.root / 'github.json'
        self.write_json(fixture, {'repository': repository_info, 'commit': 'a' * 40, 'tagExists': tag_exists})
        calls = self.root / 'github-calls.jsonl'
        shim = self.root / 'gh-fixture.ps1'
        # The publisher invokes this shim in-process; return preserves its caller.
        self.write(shim, b'''$global:LASTEXITCODE = 0
$fixture = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'github.json') -Raw | ConvertFrom-Json -AsHashtable
ConvertTo-Json -InputObject @($args) -Compress | Add-Content -LiteralPath (Join-Path $PSScriptRoot 'github-calls.jsonl')
if ($args.Count -eq 2 -and $args[0] -eq 'api' -and $args[1] -eq 'repos/felrer/Azrael') {
    $fixture.repository | ConvertTo-Json -Depth 4 -Compress
    return
}
if ($args.Count -eq 2 -and $args[1] -eq "repos/felrer/Azrael/commits/$($fixture.commit)") {
    @{sha=$fixture.commit} | ConvertTo-Json -Compress
    return
}
if ($args.Count -eq 3 -and $args[0] -eq 'api' -and $args[1] -eq '--include' -and $args[2] -like 'repos/felrer/Azrael/git/ref/tags/*') {
    if ($fixture.tagExists) { '{}'; return }
    $global:LASTEXITCODE = 1
    'HTTP/2.0 404 Not Found'
    return
}
if ($args.Count -eq 4 -and $args[0] -eq 'api' -and $args[1] -eq '--paginate' -and $args[2] -eq '--slurp' -and $args[3] -eq 'repos/felrer/Azrael/releases?per_page=100') {
    '[[]]'
    return
}
$global:LASTEXITCODE = 2
'Unexpected GitHub operation'
''')
        command = ['pwsh', '-NoProfile', '-File', str(SCRIPTS / 'publish-app-release.ps1'),
                   '-ManifestPath', str(manifest_path), '-VerificationPath', str(verification),
                   '-NotesFile', str(notes), '-TargetCommit', 'a' * 40,
                   '-GhPath', str(shim), '-PreflightOnly']
        if allow_public:
            command.append('-AllowPublicRepository')
        result = self.run_process(command)
        recorded = [json.loads(line) for line in calls.read_text().splitlines()] if calls.exists() else []
        self.assertFalse((self.output / 'publish-receipt.json').exists())
        # Every simulated remote call must be a read; an unexpected mutation fails the shim.
        self.assertTrue(all(call[0] == 'api' and '--method' not in call for call in recorded))
        return result, recorded

    @staticmethod
    def publisher_repository(private=True, archived=False, pull=True, push=True):
        return {'private': private, 'archived': archived, 'permissions': {'pull': pull, 'push': push}}

    def test_publisher_private_repository_allowed_by_default(self):
        result, calls = self.publisher_preflight(self.publisher_repository())
        self.assertEqual(result.returncode, 0, result.stderr)
        preflight = json.loads(result.stdout)
        self.assertTrue(preflight['preflightPassed'])
        self.assertEqual(preflight['repositoryVisibility'], 'private')
        self.assertEqual(preflight['targetCommit'], 'a' * 40)
        self.assertEqual(len(calls), 4)

    def test_publisher_public_repository_requires_explicit_switch(self):
        result, calls = self.publisher_preflight(self.publisher_repository(private=False))
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn('requires explicit -AllowPublicRepository', result.stderr)
        self.assertEqual(len(calls), 1)

    def test_publisher_public_repository_allowed_with_explicit_switch(self):
        result, calls = self.publisher_preflight(self.publisher_repository(private=False), allow_public=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        preflight = json.loads(result.stdout)
        self.assertTrue(preflight['preflightPassed'])
        self.assertEqual(preflight['repositoryVisibility'], 'public')
        self.assertEqual(len(calls), 4)

    def test_publisher_public_switch_preserves_repository_safety_checks(self):
        for overrides in ({'archived': True}, {'pull': False}, {'push': False}):
            with self.subTest(overrides=overrides):
                result, calls = self.publisher_preflight(self.publisher_repository(private=False, **overrides), allow_public=True)
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertIn('active and accessible with read/write permissions', result.stderr)
                self.assertEqual(len(calls), 1)
                (self.root / 'github-calls.jsonl').unlink()

    def test_publisher_public_switch_requires_boolean_visibility(self):
        for private in ('false', 0, None):
            with self.subTest(private=private):
                result, calls = self.publisher_preflight(self.publisher_repository(private=private), allow_public=True)
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertIn('visibility must be a Boolean', result.stderr)
                self.assertEqual(len(calls), 1)
                (self.root / 'github-calls.jsonl').unlink()

    def test_publisher_public_switch_preserves_exact_manifest_and_tag_checks(self):
        result, calls = self.publisher_preflight(self.publisher_repository(private=False), allow_public=True, verification_hash='0' * 64)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn('does not certify this exact release manifest', result.stderr)
        self.assertEqual(calls, [])
        result, calls = self.publisher_preflight(self.publisher_repository(private=False), allow_public=True, tag_exists=True)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn('already exists; refusing to overwrite', result.stderr)
        self.assertEqual(len(calls), 3)


if __name__ == '__main__':
    unittest.main(verbosity=2)
