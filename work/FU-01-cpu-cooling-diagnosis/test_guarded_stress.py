"""No hardware reads and no CPU stress: cutoff and own-worker stop checks."""
import importlib.util
import multiprocessing as mp
from pathlib import Path
import time
import unittest


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


guard = load('guarded_stress', 'guarded-stress.py')
monitor = load('diagnostic_monitor', 'monitor.py')


def idle_worker(active, lease, stop, hard_end):
    guard.cpu_worker(0, active, lease, stop, hard_end)


def reading(temp=85):
    return dict(source='CPUID165_direct', status='ok', errors=[],
                readings=[dict(sensor='Intel CPU', name='CPU Package', kind=1, value=temp)])


class GuardTests(unittest.TestCase):
    def test_strict_85_degree_boundary(self):
        for temp, expected in [(84, False), (85, False), (85.1, True), (86, True)]:
            with self.subTest(temp=temp):
                self.assertEqual(guard.stop_reason(reading(temp), .01) == 'cpu_temperature_above_85C', expected)
                self.assertEqual('cpu_temperature_above_85C' in monitor.alerts({'sensors': reading(temp)}), expected)

    def test_hot_logical_processor_stops_even_if_package_cool(self):
        row = reading(70)
        row['readings'].append(dict(name='CPU Logical Processor 0', kind=1, value=86))
        self.assertEqual(guard.stop_reason(row, .01), 'cpu_temperature_above_85C')

    def test_missing_invalid_and_slow_sensor_fail_closed(self):
        self.assertIsNotNone(guard.stop_reason(reading(), 1.0))
        self.assertIsNotNone(guard.stop_reason(reading(float('nan')), .01))
        row = reading(); row['readings'] = []
        self.assertIsNotNone(guard.stop_reason(row, .01))
        row = reading(); row['status'] = 'unavailable'
        self.assertIsNotNone(guard.stop_reason(row, .01))

    def test_idle_owned_worker_stops_on_stop_event(self):
        ctx = mp.get_context('spawn')
        active, lease, stop = ctx.RawValue('i', 0), ctx.RawValue('d', 0), ctx.Event()
        worker = ctx.Process(target=idle_worker, args=(active, lease, stop, time.monotonic()+10))
        worker.start()
        try:
            self.assertTrue(guard.stop_workers([worker], active, lease, stop))
            self.assertFalse(worker.is_alive())
        finally:
            if worker.is_alive(): worker.terminate()
            worker.join(2)

    def test_idle_owned_worker_exits_without_supervisor_renewal(self):
        ctx = mp.get_context('spawn')
        active, lease, stop = ctx.RawValue('i', 0), ctx.RawValue('d', time.monotonic()+.5), ctx.Event()
        worker = ctx.Process(target=idle_worker, args=(active, lease, stop, time.monotonic()+10))
        worker.start()
        try:
            worker.join(3)
            self.assertFalse(worker.is_alive())
            self.assertEqual(worker.exitcode, 0)
        finally:
            if worker.is_alive(): worker.terminate()
            worker.join(2)


if __name__ == '__main__':
    unittest.main()
