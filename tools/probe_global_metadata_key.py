"""probe_global_metadata_key：密钥、元数据或运行时参数探测工具。"""
import argparse
import json
import re
import struct
import sys
from pathlib import Path


ASCII_PATTERNS = [
    b"CriWare",
    b"CriMana",
    b"CRIWARE",
    b"Decrypter",
    b"Decrypt",
    b"ManaDecryption",
    b"AtomDecryption",
    b"SetKey",
    b"EncryptionKey",
]

CRIWARE_RE = re.compile(rb"CRIWARE[0-9A-Fa-f]{8}")


def utf16le(text: str) -> bytes:
    return text.encode("utf-16le")


def decode_context(data: bytes, start: int, end: int) -> str:
    return data[start:end].decode("latin-1", errors="replace")


def nearby_ints(data: bytes, start: int, end: int, radius: int = 0x80):
    lo = max(0, start - radius)
    hi = min(len(data), end + radius)
    rows = []
    for pos in range(lo, max(lo, hi - 3)):
        value = struct.unpack_from("<I", data, pos)[0]
        if value in range(0x1000, 0x10000000):
            rows.append(
                {
                    "offset": pos,
                    "hex": f"0x{value:08X}",
                    "decimal": value,
                }
            )
    return rows


def find_all(data: bytes, needle: bytes, limit: int):
    rows = []
    start = 0
    while len(rows) < limit:
        pos = data.find(needle, start)
        if pos < 0:
            break
        rows.append(pos)
        start = pos + 1
    return rows


def main() -> int:
    """命令行主入口。"""
    parser = argparse.ArgumentParser(
        description="Scan raw global-metadata bytes for CRI decrypter strings and nearby integers."
    )
    parser.add_argument("metadata", type=Path)
    parser.add_argument("--json", type=Path)
    parser.add_argument("--context", type=int, default=192)
    parser.add_argument("--limit", type=int, default=80)
    args = parser.parse_args()

    data = args.metadata.read_bytes()
    hits = []
    patterns = list(ASCII_PATTERNS)
    for text in ASCII_PATTERNS:
        try:
            decoded = text.decode("ascii")
        except UnicodeDecodeError:
            continue
        patterns.append(utf16le(decoded))

    for pattern in patterns:
        for offset in find_all(data, pattern, args.limit):
            start = max(0, offset - args.context)
            end = min(len(data), offset + len(pattern) + args.context)
            hits.append(
                {
                    "pattern": pattern.decode("latin-1", errors="replace"),
                    "offset": offset,
                    "context": decode_context(data, start, end),
                    "nearby_le_i32": nearby_ints(data, offset, offset + len(pattern)),
                }
            )

    criware_rows = []
    for match in CRIWARE_RE.finditer(data):
        value_text = match.group(0)[7:].decode("ascii")
        criware_rows.append(
            {
                "offset": match.start(),
                "text": match.group(0).decode("ascii"),
                "value_hex": f"0x{value_text}",
                "value_decimal": int(value_text, 16),
                "context": decode_context(
                    data, max(0, match.start() - args.context), min(len(data), match.end() + args.context)
                ),
            }
        )

    unique = {}
    for row in hits:
        unique[(row["pattern"], row["offset"])] = row
    hits = sorted(unique.values(), key=lambda row: (row["offset"], row["pattern"]))

    output = {
        "metadata": str(args.metadata),
        "size": len(data),
        "hit_count": len(hits),
        "hits": hits,
        "criware_count": len(criware_rows),
        "criware": criware_rows,
    }
    text = json.dumps(output, ensure_ascii=False, indent=2, default=str)
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(text, encoding="utf-8")
    sys.stdout.buffer.write(text.encode("utf-8", "backslashreplace"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
