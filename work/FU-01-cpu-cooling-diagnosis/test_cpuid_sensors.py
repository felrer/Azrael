"""Hardware-independent regression checks for this local diagnostic reader."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch

spec = importlib.util.spec_from_file_location('cpuid_sensors', Path(__file__).with_name('cpuid-sensors.py'))
sensor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sensor)


class SensorTests(unittest.TestCase):
    def test_temperature_validity(self):
        self.assertEqual(sensor.temperature(100 << 16, (1 << 31) | (30 << 16)), 70)
        self.assertIsNone(sensor.temperature(100 << 16, 30 << 16))

    def test_register_allowlist(self):
        reader = sensor.Reader.__new__(sensor.Reader)
        with self.assertRaises(ValueError):
            reader.read_msr(0x10)
        self.assertEqual(sensor.READ_REGISTERS, {0x19C, 0x1A2, 0x1B1, 0x606, 0x611})

    def test_snapshot_retries_transient_sharing_failure(self):
        output = MagicMock()
        with patch.object(sensor.os, 'replace', side_effect=[PermissionError(5, 'sharing'), None]) as replace:
            with patch.object(sensor.time, 'sleep') as sleep:
                sensor.publish_snapshot(output, {'status': 'ok'})
        self.assertEqual(replace.call_count, 2)
        sleep.assert_called_once_with(0.02)
        output.__truediv__.return_value.write_text.assert_called_once()

    def test_snapshot_persistent_failure_is_bounded(self):
        with patch.object(sensor.os, 'replace', side_effect=PermissionError(5, 'persistent')) as replace:
            with patch.object(sensor.time, 'sleep') as sleep:
                with self.assertRaises(PermissionError):
                    sensor.publish_snapshot(MagicMock(), {'status': 'ok'})
        self.assertEqual(replace.call_count, 10)
        self.assertEqual(sleep.call_count, 9)


if __name__ == '__main__':
    unittest.main()
