from __future__ import annotations

import argparse
import struct
from pathlib import Path


def read_uleb128(data: bytes, pos: int) -> tuple[int, int]:
    value = 0
    shift = 0
    while True:
        byte = data[pos]
        pos += 1
        value |= (byte & 0x7F) << shift
        if byte < 0x80:
            return value, pos
        shift += 7


def read_ktab(data: bytes, pos: int) -> tuple[list[tuple[str, object]], int]:
    count, pos = read_uleb128(data, pos)
    values: list[tuple[str, object]] = []
    for _ in range(count):
        tag = data[pos]
        pos += 1
        if tag == 0:
            values.append(("nil", None))
        elif tag == 1:
            values.append(("false", False))
        elif tag == 2:
            values.append(("true", True))
        elif tag in {3, 4}:
            low = struct.unpack_from("<I", data, pos)[0]
            pos += 4
            if tag == 3:
                values.append(("int", low))
            else:
                high = struct.unpack_from("<I", data, pos)[0]
                pos += 4
                values.append(("num", struct.unpack("<d", struct.pack("<II", low, high))[0]))
        elif tag >= 5:
            length, pos = read_uleb128(data, pos)
            text = data[pos : pos + length].decode("utf-8", "replace")
            pos += length
            values.append(("str", text))
        else:
            raise ValueError(f"Unsupported constant tag {tag} at {pos - 1}")
    return values, pos


def read_proto(data: bytes, pos: int) -> tuple[dict, int]:
    flags = data[pos]
    pos += 1
    param_count = data[pos]
    pos += 1
    frame_size = data[pos]
    pos += 1
    upvalue_count = data[pos]
    pos += 1
    num_params = 0
    if flags & 0x02:
        num_params = struct.unpack_from("<H", data, pos)[0]
        pos += 2
    chunk_name_len, pos = read_uleb128(data, pos)
    chunk_name = data[pos : pos + chunk_name_len].decode("utf-8", "replace")
    pos += chunk_name_len
    constants, pos = read_ktab(data, pos)
    instruction_count, pos = read_uleb128(data, pos)
    pos += instruction_count * 4
    nested_count, pos = read_uleb128(data, pos)
    nested = []
    for _ in range(nested_count):
        nested.append(None)
        break
    debug_size, pos = read_uleb128(data, pos)
    pos += debug_size
    return {
        "chunk_name": chunk_name,
        "flags": flags,
        "param_count": param_count,
        "frame_size": frame_size,
        "upvalue_count": upvalue_count,
        "num_params": num_params,
        "constants": constants,
        "instruction_count": instruction_count,
        "nested": nested,
    }, pos


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    data = args.path.read_bytes()
    if data[:4] != b"\x1bLJ\x02":
        raise SystemExit("Not a LuaJIT 2.0 bytecode file")
    pos = 5
    proto, pos = read_proto(data, pos)
    print("pos", pos, "size", len(data))
    print("top constants", len(proto["constants"]))
    for i, (kind, value) in enumerate(proto["constants"]):
        print(i, kind, repr(value))
    def walk(items, indent=0):
        for index, item in enumerate(items):
            if item is None:
                print(" " * indent, "proto", index, "<not parsed>")
                continue
            print(
                " " * indent,
                "proto",
                index,
                repr(item["chunk_name"]),
                "constants",
                len(item["constants"]),
                "instr",
                item["instruction_count"],
            )
            for ci, (kind, value) in enumerate(item["constants"]):
                if kind in {"int", "num", "str"}:
                    print(" " * (indent + 2), ci, kind, repr(value))
            walk(item["nested"], indent + 2)
    walk(proto["nested"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
