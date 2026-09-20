"""analyze_hybridclr_cdph：项目辅助脚本，封装对应的数据处理、提取或验证流程。"""
from __future__ import annotations

import argparse
import json
import re
import struct
from pathlib import Path

import UnityPy


def load_text_assets(path: Path):
    """加载text_assets数据。"""
    raw = path.read_bytes()
    unity_offset = raw.find(b"UnityFS")
    if unity_offset < 0:
        raise ValueError("UnityFS signature not found")
    env = UnityPy.load(raw[unity_offset:])
    assets = []
    for obj in env.objects:
        if obj.type.name != "TextAsset":
            continue
        parsed = obj.read()
        name = getattr(parsed, "m_Name", "") or ""
        script = getattr(parsed, "m_Script", b"")
        if isinstance(script, str):
            script = script.encode("utf-8", errors="surrogateescape")
        assets.append(
            {
                "path_id": obj.path_id,
                "name": str(name),
                "size": len(script),
                "data": bytes(script),
            }
        )
    return raw, unity_offset, assets


def parse_cdph(data: bytes) -> dict:
    """解析cdph相关数据。"""
    if not data.startswith(b"CDPH"):
        raise ValueError("TextAsset does not start with CDPH")
    if len(data) < 16:
        raise ValueError("CDPH header truncated")
    fields = struct.unpack_from("<4I", data, 4)
    return {
        "magic": "CDPH",
        "fields": [f"0x{value:08X}" for value in fields],
        "field_values": list(fields),
        "bsjb_offsets": [m.start() for m in re.finditer(b"BSJB", data)],
        "size": len(data),
    }


def metadata_root(data: bytes, offset: int) -> dict:
    if data[offset:offset + 4] != b"BSJB":
        raise ValueError("not a BSJB root")
    major, minor, reserved, version_len = struct.unpack_from("<HHII", data, offset + 4)
    cursor = offset + 16
    version = data[cursor:cursor + version_len].rstrip(b"\0").decode("ascii", errors="replace")
    cursor += (version_len + 3) & ~3
    flags, stream_count = struct.unpack_from("<HH", data, cursor)
    cursor += 4
    streams = []
    for _ in range(stream_count):
        rel_offset, size = struct.unpack_from("<II", data, cursor)
        cursor += 8
        name_start = cursor
        while cursor < len(data) and data[cursor] != 0:
            cursor += 1
        name = data[name_start:cursor].decode("ascii", errors="replace")
        cursor += 1
        cursor = (cursor + 3) & ~3
        streams.append(
            {
                "name": name,
                "offset": rel_offset,
                "absolute_offset": offset + rel_offset,
                "size": size,
            }
        )
    return {
        "major": major,
        "minor": minor,
        "reserved": reserved,
        "version": version,
        "flags": flags,
        "stream_count": stream_count,
        "streams": streams,
    }


def strings_heap(data: bytes, offset: int, size: int, needles: list[str]) -> list[dict]:
    heap = data[offset:offset + size]
    rows = []
    cursor = 0
    while cursor < len(heap):
        end = heap.find(b"\0", cursor)
        if end < 0:
            break
        raw = heap[cursor:end]
        if raw:
            text = raw.decode("utf-8", errors="replace")
            if not needles or any(needle.lower() in text.lower() for needle in needles):
                rows.append({"offset": cursor, "text": text})
        cursor = end + 1
    return rows


def printable_ascii_hits(data: bytes, needles: list[str], context: int) -> list[dict]:
    rows = []
    for needle in needles:
        term = needle.encode("utf-8")
        start = 0
        while True:
            pos = data.find(term, start)
            if pos < 0:
                break
            lo = max(0, pos - context)
            hi = min(len(data), pos + len(term) + context)
            rows.append(
                {
                    "needle": needle,
                    "offset": pos,
                    "context": data[lo:hi].decode("utf-8", errors="replace"),
                }
            )
            start = pos + 1
    return rows


def safe_json(value):
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="backslashreplace")
    if isinstance(value, str):
        return value.encode("utf-8", errors="backslashreplace").decode("utf-8")
    if isinstance(value, list):
        return [safe_json(item) for item in value]
    if isinstance(value, dict):
        return {safe_json(key): safe_json(item) for key, item in value.items()}
    return value


def main() -> int:
    """命令行主入口。"""
    parser = argparse.ArgumentParser(description="Extract and inspect HybridCLR CDPH TextAssets.")
    parser.add_argument("bundle", type=Path)
    parser.add_argument("--json", type=Path)
    parser.add_argument("--needle", action="append", default=[])
    parser.add_argument("--context", type=int, default=160)
    parser.add_argument("--dump-cdph-dir", type=Path)
    args = parser.parse_args()

    raw, unity_offset, assets = load_text_assets(args.bundle)
    needles = args.needle or [
        "CriWareDecrypter",
        "CriMana",
        "keyNum",
        "decryptKey",
        "SetDecryptionKey",
        "Config",
    ]
    report = {
        "bundle": str(args.bundle.resolve()),
        "bundle_size": len(raw),
        "unityfs_offset": unity_offset,
        "text_asset_count": len(assets),
        "assets": [],
    }
    for asset in assets:
        row = {
            "path_id": asset["path_id"],
            "name": asset["name"],
            "size": asset["size"],
        }
        data = asset["data"]
        if data.startswith(b"CDPH"):
            row["cdph"] = parse_cdph(data)
            for root in row["cdph"]["bsjb_offsets"]:
                try:
                    meta = metadata_root(data, root)
                    for stream in meta["streams"]:
                        if stream["name"] == "#Strings":
                            stream["matches"] = strings_heap(
                                data,
                                stream["absolute_offset"],
                                stream["size"],
                                needles,
                            )
                    row.setdefault("metadata_roots", []).append(meta)
                except Exception as exc:  # noqa: BLE001
                    row.setdefault("metadata_errors", []).append(
                        {"offset": root, "error": f"{type(exc).__name__}: {exc}"}
                    )
        row["ascii_hits"] = printable_ascii_hits(data, needles, args.context)
        report["assets"].append(row)
        if args.dump_cdph_dir:
            args.dump_cdph_dir.mkdir(parents=True, exist_ok=True)
            out = args.dump_cdph_dir / f"{asset['path_id']}_{asset['name'] or 'TextAsset'}.cdph"
            out.write_bytes(data)
            row["dumped_to"] = str(out.resolve())

    text = json.dumps(safe_json(report), ensure_ascii=False, indent=2)
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(text, encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
