"""Read NVMe SMART log 02 through Windows' documented storage property query.

No pass-through, writes, self-tests, reset, or third-party driver is used.
Layouts: Windows SDK 10.0.26100.0 ntddstor.h and nvme.h.
"""
import ctypes
from ctypes import wintypes
import datetime
import json
import struct
import sys


def decode_descriptor(data):
    if len(data) < 48:
        raise ValueError('Truncated protocol descriptor')
    version, size, protocol, datatype = struct.unpack_from('<4I', data)
    offset, length = struct.unpack_from('<2I', data, 24)
    if (version != 48 or size != 48 or protocol != 3 or datatype != 2
            or offset < 40 or length < 512 or 8 + offset + length > len(data)):
        raise ValueError('Invalid NVMe health descriptor layout')
    health = data[8 + offset:8 + offset + 512]
    def number(offset, count=16):
        return int.from_bytes(health[offset:offset + count], 'little')
    kelvin = number(1, 2)
    if kelvin == 0:
        raise ValueError('Missing composite temperature; refuse all-zero health log')
    return {
        'criticalWarning': health[0],
        'temperatureC': round(kelvin - 273.15, 2),
        'availableSparePercent': health[3],
        'availableSpareThresholdPercent': health[4],
        'percentageUsed': health[5],
        'dataUnitsRead': number(32), 'dataUnitsWritten': number(48),
        'controllerBusyMinutes': number(96), 'powerCycles': number(112),
        'powerOnHours': number(128), 'unsafeShutdowns': number(144),
        'mediaAndDataIntegrityErrors': number(160),
        'errorInformationLogEntries': number(176),
        'warningTemperatureMinutes': number(192, 4),
        'criticalTemperatureMinutes': number(196, 4),
        'temperatureSensorsC': [round(number(i, 2) - 273.15, 2)
                               if number(i, 2) else None for i in range(200, 216, 2)],
    }


def read_health(disk_number):
    if sys.platform != 'win32' or not 0 <= disk_number <= 255:
        raise ValueError('Windows and a bounded physical disk number are required')
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                  ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.DeviceIoControl.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.c_void_p,
                                      wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD,
                                      ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p]
    kernel.DeviceIoControl.restype = wintypes.BOOL
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    handle = kernel.CreateFileW('\\\\.\\PhysicalDrive' + str(disk_number), 0, 3, None, 3, 0, None)
    if handle == ctypes.c_void_p(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        # Property 50, StandardQuery 0; NVMe 3, LogPage 2, SMART page 2.
        buffer = ctypes.create_string_buffer(560)
        struct.pack_into('<12I', buffer, 0, 50, 0, 3, 2, 2, 0, 40, 512, 0, 0, 0, 0)
        returned = wintypes.DWORD()
        if not kernel.DeviceIoControl(handle, 0x002D1400, buffer, 560, buffer, 560,
                                      ctypes.byref(returned), None):
            raise ctypes.WinError(ctypes.get_last_error())
        return decode_descriptor(buffer.raw[:returned.value])
    finally:
        kernel.CloseHandle(handle)


if __name__ == '__main__':
    report = {'timestampUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'readOnly': True, 'method': 'IOCTL_STORAGE_QUERY_PROPERTY / NVMe SMART log 02'}
    try:
        report['diskNumber'] = int(sys.argv[1])
        report['health'] = read_health(report['diskNumber'])
    except Exception as error:
        report['error'] = str(error)
    print(json.dumps(report))
    sys.exit(2 if 'error' in report else 0)
