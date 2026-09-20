"""inspect_cdph_streams：Unity、二进制或配置结构检查工具。"""
from __future__ import annotations

import argparse
import struct
from pathlib import Path


def main() -> int:
    """命令行主入口。"""
    parser = argparse.ArgumentParser(description="Dump CDPH container and BSJB stream layout.")
    parser.add_argument("cdph", type=Path)
    args = parser.parse_args()

    data = args.cdph.read_bytes()
    print(f"file size: {len(data)} (0x{len(data):X})")
    print(f"magic: {data[:4]!r}")

    # Header: 0x10 bytes, then 8 length-prefixed padded descriptors.
    descriptor = 0x10
    print(f"schedule table: 0x10..0x110")
    cursor = 0x110
    for index in range(8):
        length = struct.unpack_from("<I", data, cursor)[0]
        payload = cursor + 4
        end = payload + length
        padded = (end + 3) & ~3
        head = data[payload : payload + 16].hex(" ")
        print(
            f"desc{index}: header=0x{cursor:X} length=0x{length:X} "
            f"payload=0x{payload:X}..0x{end:X} padded_end=0x{padded:X} head={head}"
        )
        cursor = padded
    print(f"state: 0x{cursor:X}..0x{cursor + 0x10:X} = {data[cursor:cursor + 0x10].hex()}")
    print(f"bytes 0x{cursor + 0x10:X}..BSJB length=0x{0 - 1:X}")

    # Locate BSJB.
    bsjb = data.find(b"BSJB")
    print(f"BSJB at 0x{bsjb:X}")
    if bsjb >= 0:
        (magic, major, minor, reserved, version_len) = struct.unpack_from("<IHHII", data, bsjb)
        version = data[bsjb + 16 : bsjb + 16 + version_len].rstrip(b"\0").decode("latin1", "replace")
        after_version = (bsjb + 16 + version_len + 3) & ~3
        flags, stream_count = struct.unpack_from("<HH", data, after_version)
        print(f"version: {version!r} streams: {stream_count} flags=0x{flags:X}")
        cursor = after_version + 4
        for index in range(stream_count):
            offset, size = struct.unpack_from("<II", data, cursor)
            name_start = cursor + 8
            name_end = data.index(b"\0", name_start)
            name = data[name_start:name_end].decode("latin1")
            stream_abs = bsjb + offset
            print(
                f"stream {index}: name={name!r} rel=0x{offset:X} size=0x{size:X} "
                f"abs=0x{stream_abs:X}..0x{stream_abs + size:X} head={data[stream_abs:stream_abs + 16].hex(' ')}"
            )
            cursor = (name_end + 4) & ~3

    # Gap between state and BSJB.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
