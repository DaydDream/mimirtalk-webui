"""xref_dll_calls：项目辅助脚本，封装对应的数据处理、提取或验证流程。"""
from __future__ import annotations

import argparse
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from solve_cdph_transform import parse_pe, va_to_offset


def main() -> int:
    """命令行主入口。"""
    parser = argparse.ArgumentParser(description="Find direct call/jmp xrefs to given VAs.")
    parser.add_argument("dll", type=Path)
    parser.add_argument("targets", nargs="+")
    args = parser.parse_args()

    data = args.dll.read_bytes()
    image = parse_pe(data)
    base = image["image_base"]
    text = next(s for s in image["sections"] if s["name"] == ".text")
    start = text["raw_pointer"]
    end = start + text["raw_size"]
    text_va = base + text["virtual_address"]
    code = data[start:end]

    targets = {int(t, 16): t for t in args.targets}
    hits = {t: [] for t in targets}
    for i in range(len(code) - 5):
        if code[i] not in (0xE8, 0xE9):
            continue
        rel = struct.unpack_from("<i", code, i + 1)[0]
        target = text_va + i + 5 + rel
        if target in targets:
            hits[target].append((text_va + i, code[i]))

    for target, name in targets.items():
        print(f"{name} (0x{target:X}): {len(hits[target])} hits")
        for va, opcode in hits[target]:
            print(f"  {'call' if opcode == 0xE8 else 'jmp '} at 0x{va:X}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
