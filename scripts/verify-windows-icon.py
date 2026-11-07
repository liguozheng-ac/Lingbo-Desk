"""Read Windows PE icon resources without running the executable; compare to source ICO."""
import argparse
import ctypes
import hashlib
import json
import struct
from ctypes import wintypes
from pathlib import Path


def verify(executable, icon):
    data = icon.read_bytes()
    reserved, kind, count = struct.unpack_from('<HHH', data)
    assert reserved == 0 and kind == 1
    expected = []
    for i in range(count):
        width, height, _, _, _, _, size, offset = struct.unpack_from('<BBBBHHII', data, 6 + i * 16)
        expected.append((width or 256, height or 256, hashlib.sha256(data[offset:offset + size]).hexdigest()))
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.LoadLibraryExW.argtypes = [wintypes.LPCWSTR, wintypes.HANDLE, wintypes.DWORD]
    kernel.LoadLibraryExW.restype = wintypes.HMODULE
    kernel.FindResourceW.argtypes = [wintypes.HMODULE, ctypes.c_void_p, ctypes.c_void_p]
    kernel.FindResourceW.restype = wintypes.HANDLE
    kernel.LoadResource.argtypes = [wintypes.HMODULE, wintypes.HANDLE]
    kernel.LoadResource.restype = wintypes.HANDLE
    kernel.LockResource.argtypes = [wintypes.HANDLE]
    kernel.LockResource.restype = ctypes.c_void_p
    kernel.SizeofResource.argtypes = [wintypes.HMODULE, wintypes.HANDLE]
    kernel.SizeofResource.restype = wintypes.DWORD
    kernel.FreeLibrary.argtypes = [wintypes.HMODULE]
    # LOAD_LIBRARY_AS_DATAFILE | LOAD_LIBRARY_AS_IMAGE_RESOURCE; never execute module code.
    module = kernel.LoadLibraryExW(str(executable.resolve()), None, 0x22)
    if not module:
        raise ctypes.WinError(ctypes.get_last_error())

    def resource(name, kind):
        handle = kernel.FindResourceW(module, name, kind)
        if not handle:
            raise ctypes.WinError(ctypes.get_last_error())
        size = kernel.SizeofResource(module, handle)
        pointer = kernel.LockResource(kernel.LoadResource(module, handle))
        if not pointer:
            raise ctypes.WinError(ctypes.get_last_error())
        return ctypes.string_at(pointer, size)

    try:
        names = []
        callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HMODULE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ssize_t)

        @callback_type
        def collect(_module, _kind, name, _param):
            names.append(name if name <= 65535 else ctypes.wstring_at(name))
            return True

        kernel.EnumResourceNamesW.argtypes = [wintypes.HMODULE, ctypes.c_void_p, callback_type, ctypes.c_ssize_t]
        if not kernel.EnumResourceNamesW(module, 14, collect, 0):
            raise ctypes.WinError(ctypes.get_last_error())
        matched = False
        for name in names:
            name_pointer = name if isinstance(name, int) else ctypes.cast(ctypes.c_wchar_p(name), ctypes.c_void_p)
            group = resource(name_pointer, 14)
            _, _, entries = struct.unpack_from('<HHH', group)
            actual = []
            for i in range(entries):
                width, height, _, _, _, _, size, identifier = struct.unpack_from('<BBBBHHIH', group, 6 + i * 14)
                encoded = resource(identifier, 3)
                assert len(encoded) == size
                actual.append((width or 256, height or 256, hashlib.sha256(encoded).hexdigest()))
            if sorted(actual) == sorted(expected):
                matched = True
        assert matched, 'Executable icon resource differs from the source ICO'
        return {'passed': True, 'frames': count, 'sizes': sorted({width for width, _, _ in expected}), 'icoSha256': hashlib.sha256(data).hexdigest(), 'executableSha256': hashlib.sha256(executable.read_bytes()).hexdigest()}
    finally:
        kernel.FreeLibrary(module)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('executable', type=Path)
    parser.add_argument('icon', type=Path)
    args = parser.parse_args()
    print(json.dumps(verify(args.executable, args.icon)))
