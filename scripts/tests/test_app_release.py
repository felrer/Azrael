"""Synthetic portable package checks; never access real profiles or remote services."""
import hashlib
import importlib.util
import io
import json
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
        self.addCleanup(self.temp.cleanup)
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

    def write_json(self, path, value):
        self.write(path, json.dumps(value).encode())

    def write_host(self):
        with zipfile.ZipFile(self.host, 'w') as archive:
            for name, data in self.host_entries.items():
                archive.writestr(name, data)

    def package(self, expected=0, version='2026.0.0'):
        result = subprocess.run([sys.executable, '-B', str(SCRIPTS / 'package-app-release.py'), '--release-directory', str(self.release), '--host-vsix', str(self.host), '--version', version, '--output', str(self.output)], capture_output=True, text=True, encoding='utf-8', errors='replace')
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
        result = subprocess.run(['pwsh', '-NoProfile', '-File', str(extracted / 'install.ps1'), '-PrepareOnly', '-InstallRoot', str(destination), '-StateRoot', str(state), '-CodePath', str(self.root / 'missing-code.cmd')], capture_output=True, text=True, encoding='utf-8', errors='replace')
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

    def test_orchestrator_rejects_mismatched_receipt_before_packaging(self):
        receipt = self.root / 'prepared.json'
        self.write_json(receipt, {'HostVersion': '2026.0.1', 'ReleaseDirectory': str(self.release), 'HostVsix': str(self.host), 'HostSha256': sha(self.host.read_bytes())})
        output = self.root / 'orchestrated'
        result = subprocess.run(['pwsh', '-NoProfile', '-File', str(SCRIPTS / 'prepare-app-release.ps1'), '-ReleaseDirectory', str(self.release), '-OutputDirectory', str(output), '-PreparedHostReceipt', str(receipt)], capture_output=True, text=True, encoding='utf-8', errors='replace')
        self.assertEqual(result.returncode, 1)
        self.assertIn('does not match', result.stderr)
        self.assertFalse((output / 'assets').exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
