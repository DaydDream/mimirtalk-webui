"""parse_cdph_transform_chain：CPK、加密数据或二进制结构处理工具。"""
from __future__ import annotations

import argparse
import json
import re
import struct
from collections import Counter
from pathlib import Path


IMM_RE = re.compile(r"\b([0-9A-F]{1,16})h\b", re.IGNORECASE)


def parse_hex_immediate(text: str) -> int:
    """解析hex_immediate相关数据。"""
    value = int(text, 16)
    if value >= 0x80000000:
        value -= 0x100000000
    return value


def parse_disasm(path: Path) -> list[tuple[int, str]]:
    """解析disasm相关数据。"""
    instructions: list[tuple[int, str]] = []
    current: int | None = None
    current_text = ""
    pending: str | None = None

    def flush() -> None:
        nonlocal current, current_text, pending
        if current is not None and (current_text or pending):
            text = current_text
            if pending:
                text = f"{text} {pending}".strip()
            instructions.append((current, text))
        current = None
        current_text = ""
        pending = None

    for raw_line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw_line.rstrip()
        match = re.match(r"\s*([0-9A-F]{16}):\s+(.*)$", line)
        if match:
            flush()
            current = int(match.group(1), 16)
            current_text = match.group(2).strip()
            continue

        stripped = line.strip()
        if not stripped or current is None:
            continue
        if re.fullmatch(r"[0-9A-F]{2}", stripped):
            if pending:
                current_text = f"{current_text} {pending}".strip()
            pending = stripped
        else:
            current_text = f"{current_text} {stripped}".strip()

    flush()
    return instructions


def index_instructions(instructions: list[tuple[int, str]]) -> tuple[dict[int, int], dict[int, str]]:
    by_address: dict[int, int] = {}
    text_by_address: dict[int, str] = {}
    for index, (address, text) in enumerate(instructions):
        by_address[address] = index
        text_by_address[address] = text
    return by_address, text_by_address


def branch_lines(
    entry: int,
    stop_address: int | None,
    by_address: dict[int, int],
    instructions: list[tuple[int, str]],
) -> list[str]:
    if entry not in by_address:
        raise KeyError(f"missing instruction 0x{entry:X}")
    lines: list[str] = []
    for address, text in instructions[by_address[entry] :]:
        if stop_address is not None and address >= stop_address:
            break
        lines.append(f"{address:016X}: {text}")
        if re.search(r"\bjmp\s+00000001806E3392h\b|\bjmp\s+00000001806E3396h\b", text):
            break
    return lines


def parse_pe(data: bytes) -> dict:
    """解析pe相关数据。"""
    pe_offset = struct.unpack_from("<I", data, 0x3C)[0]
    if data[pe_offset : pe_offset + 4] != b"PE\0\0":
        raise ValueError("not a PE file")
    coff = pe_offset + 4
    _, section_count, _, _, _, optional_size, _ = struct.unpack_from("<HHIIIHH", data, coff)
    optional = coff + 20
    image_base = struct.unpack_from("<Q", data, optional + 24)[0]
    sections_start = optional + optional_size
    sections = []
    for index in range(section_count):
        offset = sections_start + index * 40
        name = data[offset : offset + 8].rstrip(b"\0").decode("latin1")
        virtual_size, virtual_address, raw_size, raw_pointer, _ = struct.unpack_from(
            "<IIIII", data, offset + 8
        )
        sections.append(
            {
                "name": name,
                "virtual_address": virtual_address,
                "virtual_size": virtual_size,
                "raw_pointer": raw_pointer,
                "raw_size": raw_size,
            }
        )
    return {"image_base": image_base, "sections": sections}


def va_to_offset(image: dict, va: int) -> int:
    image_base = image["image_base"]
    if not (image_base <= va < image_base + 0x1_0000_0000):
        raise ValueError(f"VA outside image range: 0x{va:X}")
    rva = va - image_base
    for section in image["sections"]:
        start = section["virtual_address"]
        size = max(section["virtual_size"], section["raw_size"])
        if start <= rva < start + size:
            offset = rva - start
            if offset >= section["raw_size"]:
                break
            return section["raw_pointer"] + offset
    raise ValueError(f"VA not mapped: 0x{va:X}")


STOP_JUMPS = {
    0x1806E3392,  # write state[index], then loop
    0x1806E3396,  # loop directly
}


def extract_branches(data: bytes, image: dict, table_va: int, count: int) -> list[dict]:
    """提取并返回目标资源或数据。"""
    table_offset = va_to_offset(image, table_va)
    entries = [
        image["image_base"] + struct.unpack_from("<I", data, table_offset + index * 4)[0]
        for index in range(count)
    ]
    branches = []
    for index, address in enumerate(entries):
        offset = va_to_offset(image, address)
        end = None
        target = None
        for cursor in range(offset, offset + 160):
            if data[cursor] != 0xE9:
                continue
            relative = struct.unpack_from("<i", data, cursor + 1)[0]
            jump_target = address + (cursor - offset) + 5 + relative
            if jump_target in STOP_JUMPS:
                end = cursor - offset + 5
                target = jump_target
                break
        code = data[offset : offset + (end if end is not None else 96)]
        branches.append(
            {
                "selector": index,
                "entry_va": address,
                "stop_jump_va": target,
                "bytes": code.hex(),
            }
        )
    return branches


def first_div_constant(block_lines: list[str]) -> int | None:
    prev: int | None = None
    for line in block_lines:
        if re.search(r"\bdiv\s+eax,r10d\b", line):
            return prev
        match = re.search(r"\bmov\s+eax,([0-9A-F]+h)\b", line, re.IGNORECASE)
        if match:
            prev = parse_hex_immediate(match.group(1)[:-1])
    return None


def classify_block(
    by_address: dict[int, int],
    instructions: list[tuple[int, str]],
    branch: dict,
) -> dict:
    entry = branch["entry_va"]
    stop = entry + len(bytes.fromhex(branch["bytes"]))
    lines = branch_lines(entry, stop, by_address, instructions)
    raw = branch["bytes"]
    code = bytes.fromhex(raw)
    info = {
        "selector": branch["selector"],
        "entry_va": f"0x{entry:08X}",
        "stop_jump_va": f"0x{branch['stop_jump_va']:08X}" if branch["stop_jump_va"] else None,
        "index": None,
        "input_offset": None,
        "operation": None,
        "constant": None,
        "raw_len": len(code),
    }

    # Common prologue: div by r10d (0x10); the quotient selector gives state[index].
    div_const = first_div_constant(lines)
    if div_const is None:
        match = re.search(r",([0-9A-F]+)h\b", lines[1] if len(lines) > 1 else "")
        if match:
            div_const = parse_hex_immediate(match.group(1))
    if div_const is not None:
        info["index"] = div_const % 16
        info["index_constant"] = f"0x{div_const & 0xFFFFFFFF:08X}"

    xor_match = re.search(
        r"xor\s+al,byte ptr \[rdx\+r11\]\s*\n\s*[0-9A-F]{16}:\s+[0-9A-F ]+\s+xor\s+al,([0-9A-F]+)h",
        "\n".join(lines),
        re.IGNORECASE,
    )
    input_match = re.search(r"\[r8\+([0-9A-F]+)h\]", " ".join(lines), re.IGNORECASE)
    if input_match:
        info["input_offset"] = int(input_match.group(1), 16)

    if "xor         al,byte ptr [rdx+r11]" in " ".join(lines):
        info["operation"] = "xor_const"
        if xor_match:
            info["constant"] = parse_hex_immediate(xor_match.group(1)[:-1])
    elif "ror         al,cl" in " ".join(lines):
        info["operation"] = "ror"
        add_match = re.search(
            r"(?:add|sub)\s+ecx,([0-9A-F]+)h|--- no match ---",
            " ".join(lines),
            re.IGNORECASE,
        )
        if add_match:
            info["constant"] = parse_hex_immediate(add_match.group(1)[:-1])
    elif re.search(r"\bsub\s+byte ptr \[rdx\+r11\],al\b", " ".join(lines)):
        info["operation"] = "sub_state_by_al"
    elif re.search(r"\badd\s+byte ptr \[rdx\+r11\],al\b", " ".join(lines)):
        info["operation"] = "add_state_by_al"
    elif re.search(r"\bsub\s+byte ptr \[r9\+r11\],cl\b", " ".join(lines)):
        info["operation"] = "sub_then_write_cl"
        info["secondary_input_offset"] = None
    else:
        info["operation"] = "unknown"
    return info


def main() -> int:
    """命令行主入口。"""
    parser = argparse.ArgumentParser(description="Parse the CDPH byte transform chain.")
    parser.add_argument("dll", type=Path)
    parser.add_argument("disasm", type=Path)
    parser.add_argument("--table-va", type=lambda value: int(value, 0), default=0x1806E33B8)
    parser.add_argument("--count", type=int, default=256)
    parser.add_argument("--json", type=Path, required=True)
    args = parser.parse_args()

    data = args.dll.read_bytes()
    image = parse_pe(data)
    blocks = parse_disasm(args.disasm)
    branches = extract_branches(data, image, args.table_va, args.count)
    by_address, _ = index_instructions(blocks)
    parsed = [classify_block(by_address, blocks, branch) for branch in branches]

    operation_counts = Counter(row["operation"] for row in parsed)
    report = {
        "dll": str(args.dll.resolve()),
        "disasm": str(args.disasm.resolve()),
        "table_va": f"0x{args.table_va:08X}",
        "count": args.count,
        "operation_counts": dict(operation_counts),
        "branches": parsed,
    }
    args.json.parent.mkdir(parents=True, exist_ok=True)
    args.json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("table_va", "count", "operation_counts")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
