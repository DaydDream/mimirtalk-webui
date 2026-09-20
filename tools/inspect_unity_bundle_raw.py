"""inspect_unity_bundle_raw：Unity、二进制或配置结构检查工具。"""
import argparse
import io
import json
import re
import struct
import sys
from pathlib import Path

import UnityPy


HEX32_RE = re.compile(rb"(?i)(?:0x)?([0-9a-f]{8})")


def match_any(text: str, needles: list[str]) -> bool:
    lowered = text.lower()
    return any(needle.lower() in lowered for needle in needles)


def safe_json(value) -> str:
    return json.dumps(value, ensure_ascii=False, default=str, sort_keys=True)


def raw_hits(raw: bytes, needles: list[str], limit: int):
    rows = []
    for needle in needles:
        for encoding in ("utf-8", "utf-16le"):
            try:
                term = needle.encode(encoding)
            except UnicodeEncodeError:
                continue
            start = 0
            count = 0
            while count < limit:
                pos = raw.find(term, start)
                if pos < 0:
                    break
                lo = max(0, pos - 96)
                hi = min(len(raw), pos + len(term) + 96)
                rows.append(
                    {
                        "needle": needle,
                        "encoding": encoding,
                        "offset": pos,
                        "context_latin1": raw[lo:hi].decode("latin-1", errors="replace"),
                    }
                )
                count += 1
                start = pos + 1
    return rows


def raw_hex32_hits(raw: bytes, start: int, end: int, limit: int):
    rows = []
    for match in HEX32_RE.finditer(raw, start, end):
        rows.append(
            {
                "offset": match.start(),
                "text": match.group(0).decode("ascii", errors="replace"),
                "hex": f"0x{match.group(1).decode('ascii').upper()}",
                "decimal": int(match.group(1), 16),
            }
        )
        if len(rows) >= limit:
            break
    return rows


def main() -> int:
    """命令行主入口。"""
    parser = argparse.ArgumentParser(
        description="Inspect a UnityFS bundle for text assets and objects containing key-related strings."
    )
    parser.add_argument("bundle", type=Path)
    parser.add_argument("--needle", action="append", required=True)
    parser.add_argument("--json", type=Path)
    parser.add_argument("--include-data", action="store_true")
    parser.add_argument("--max-objects", type=int, default=0)
    parser.add_argument("--raw-limit", type=int, default=40)
    args = parser.parse_args()

    raw = args.bundle.read_bytes()
    unity_offset = raw.find(b"UnityFS")
    if unity_offset < 0:
        raise SystemExit("UnityFS signature not found")

    env = UnityPy.load(io.BytesIO(raw[unity_offset:]))
    objects = []
    matched_objects = []
    object_count = 0

    for obj in env.objects:
        object_count += 1
        if args.max_objects and object_count > args.max_objects:
            break

        entry = {
            "path_id": obj.path_id,
            "type": obj.type.name,
        }
        try:
            data = obj.read()
            name = getattr(data, "m_Name", None)
            if name:
                entry["name"] = str(name)
        except Exception as exc:
            entry["read_error"] = str(exc)

        typetree = None
        try:
            typetree = obj.read_typetree()
            entry["keys"] = sorted(typetree.keys()) if isinstance(typetree, dict) else []
        except Exception as exc:
            entry["typetree_error"] = str(exc)

        text = safe_json(typetree if typetree is not None else entry)
        if match_any(f"{entry}|{text}", args.needle):
            matched = dict(entry)
            if args.include_data and typetree is not None:
                matched["data"] = typetree
            matched_objects.append(matched)

        objects.append(entry)

    output = {
        "bundle": str(args.bundle),
        "size": len(raw),
        "unityfs_offset": unity_offset,
        "object_count": object_count,
        "matched_object_count": len(matched_objects),
        "matched_objects": matched_objects,
        "raw_hits": raw_hits(raw, args.needle, args.raw_limit),
        "raw_hex32_near_hits": raw_hex32_hits(
            raw,
            max(0, unity_offset),
            min(len(raw), unity_offset + 0x500000),
            200,
        ),
    }

    text = json.dumps(output, ensure_ascii=False, indent=2, default=str)
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(text, encoding="utf-8")
    sys.stdout.buffer.write(text.encode("utf-8", "backslashreplace"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
