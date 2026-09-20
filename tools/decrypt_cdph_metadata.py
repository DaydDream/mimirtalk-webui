"""decrypt_cdph_metadata：CPK、加密数据或二进制结构处理工具。"""
from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from solve_cdph_transform import TABLE_COUNT, TABLE_VA, TransformEmulator, parse_pe, read_table


BLOCK_SIZE = 0x100
BYTE_BASE = 0x10000000
STATE_BASE = 0x20000000


def build_table(dll_path: Path) -> list[int]:
    """构建table所需的数据结构。"""
    data = dll_path.read_bytes()
    image = parse_pe(data)
    return data, image, read_table(data, image, TABLE_VA, TABLE_COUNT)


def new_emulator(dll_data, image, schedule: bytes, state_len: int) -> TransformEmulator:
    emu = TransformEmulator(dll_data, image, schedule, bytes(state_len))
    emu.regs["r10"] = state_len
    return emu


def apply_selectors(emu: TransformEmulator, table: list[int], selectors: bytes) -> bytes:
    for selector in selectors:
        emu.run_branch(table[selector])
    return bytes(emu.state)


def transform_block(
    dll_data,
    image,
    table,
    schedule: bytes,
    block: bytes,
    initial: bytes | None,
    reverse: bool,
) -> bytes:
    state_len = len(block)
    emu = TransformEmulator(dll_data, image, schedule, initial if initial is not None else bytes(state_len))
    emu.regs["r10"] = state_len
    selectors = block[::-1] if reverse else block
    return apply_selectors(emu, table, selectors)


def score_text(data: bytes) -> dict:
    zeros = data.count(0)
    printable = sum(1 for byte in data if byte == 0 or 0x20 <= byte <= 0x7E)
    longest = 0
    current = 0
    for byte in data:
        if 0x20 <= byte <= 0x7E:
            current += 1
            longest = max(longest, current)
        else:
            current = 0
    return {
        "zero_count": zeros,
        "printable_fraction": round(printable / max(len(data), 1), 4),
        "longest_ascii_run": longest,
    }


def decrypt_per_block(dll_data, image, table, schedule, stream: bytes, mode: str) -> bytes:
    if mode.startswith("global"):
        base = mode[len("global") :].lstrip("_")
        initial = None if base.startswith("zero") else stream
        reverse = base.endswith("rev")
        return transform_block(dll_data, image, table, schedule, stream, initial, reverse)
    out = bytearray()
    for offset in range(0, len(stream), BLOCK_SIZE):
        block = stream[offset : offset + BLOCK_SIZE]
        if mode == "zero":
            initial = None
            reverse = False
        elif mode == "cipher":
            initial = block
            reverse = False
        elif mode == "zero_rev":
            initial = None
            reverse = True
        elif mode == "cipher_rev":
            initial = block
            reverse = True
        else:
            raise ValueError(mode)
        out += transform_block(dll_data, image, table, schedule, block, initial, reverse)
    return bytes(out)


def parse_streams(data: bytes) -> dict:
    """解析streams相关数据。"""
    bsjb = data.find(b"BSJB")
    if bsjb < 0:
        raise ValueError("BSJB not found")
    version_len = struct.unpack_from("<I", data, bsjb + 12)[0]
    after_version = (bsjb + 16 + version_len + 3) & ~3
    stream_count = struct.unpack_from("<H", data, after_version + 2)[0]
    cursor = after_version + 4
    streams = {}
    for _ in range(stream_count):
        offset, size = struct.unpack_from("<II", data, cursor)
        name_end = data.index(b"\0", cursor + 8)
        name = data[cursor + 8 : name_end].decode("latin1")
        streams[name] = (bsjb + offset, size)
        cursor = (name_end + 4) & ~3
    return {"bsjb": bsjb, "streams": streams}


def main() -> int:
    """命令行主入口。"""
    parser = argparse.ArgumentParser(description="Decrypt HybridCLR CDPH metadata streams.")
    parser.add_argument("dll", type=Path)
    parser.add_argument("cdph", type=Path)
    parser.add_argument("out_dir", type=Path)
    args = parser.parse_args()

    dll_data, image, table = build_table(args.dll)
    cdph = args.cdph.read_bytes()
    if cdph[:4] != b"CDPH":
        raise ValueError("input is not a CDPH blob")
    schedule = cdph[0x10:0x110]
    layout = parse_streams(cdph)
    targets = ["#~", "#Strings", "#US", "#Blob"]

    args.out_dir.mkdir(parents=True, exist_ok=True)
    report = {"cdph": str(args.cdph.resolve()), "block_size": BLOCK_SIZE, "streams": {}}

    for name in targets:
        abs_offset, size = layout["streams"][name]
        stream = cdph[abs_offset : abs_offset + size]
        entry = {"abs_offset": f"0x{abs_offset:X}", "size": f"0x{size:X}", "modes": {}}
        modes = ("zero", "cipher", "zero_rev", "cipher_rev")
        if name == "#~":
            modes = modes + ("global_zero", "global_cipher", "global_zero_rev", "global_cipher_rev")
        for mode in modes:
            decrypted = decrypt_per_block(dll_data, image, table, schedule, stream, mode)
            entry["modes"][mode] = score_text(decrypted)
            entry["modes"][mode]["head"] = decrypted[:32].hex(" ")
            if name == "#Strings" or mode == "zero":
                path = args.out_dir / f"{name.strip('#').replace('~', 'tables') or 'root'}.{mode}.bin"
                path.write_bytes(decrypted)
        report["streams"][name] = entry

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
