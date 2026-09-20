"""dump_dotnet_us_strings：项目辅助脚本，封装对应的数据处理、提取或验证流程。"""
import argparse
import json
import struct
from pathlib import Path


def metadata_streams(path: Path):
    data = path.read_bytes()
    e_lfanew = struct.unpack_from("<I", data, 0x3C)[0]
    if data[e_lfanew:e_lfanew + 4] != b"PE\0\0":
        raise RuntimeError("Not a PE file")
    pos = data.find(b"BSJB")
    if pos < 0:
        raise RuntimeError("No BSJB metadata root")

    major, minor = struct.unpack_from("<HH", data, pos + 4)
    version_len = struct.unpack_from("<I", data, pos + 12)[0]
    cursor = pos + 16
    version_bytes = data[cursor:cursor + version_len]
    cursor += (version_len + 3) & ~3
    flags, stream_count = struct.unpack_from("<HH", data, cursor)
    cursor += 4
    streams = []
    for _ in range(stream_count):
        off, size = struct.unpack_from("<II", data, cursor)
        cursor += 8
        name_start = cursor
        while cursor < len(data) and data[cursor] != 0:
            cursor += 1
        name = data[name_start:cursor].decode("ascii", errors="replace")
        cursor += 1
        cursor = (cursor + 3) & ~3
        streams.append({"name": name, "offset": off, "size": size})
    return data, pos, streams, version_bytes


def read_compressed_u(data: bytes, start: int):
    b0 = data[start]
    if b0 & 0x80 == 0:
        return b0, start + 1
    if b0 & 0xC0 == 0x80:
        b1 = data[start + 1]
        return ((b0 & 0x3F) << 8) | b1, start + 2
    if b0 & 0xE0 == 0xC0:
        b1 = data[start + 1]
        b2 = data[start + 2]
        b3 = data[start + 3]
        return ((b0 & 0x1F) << 24) | (b1 << 16) | (b2 << 8) | b3, start + 4
    raise ValueError("Bad compressed int")


def parse_us(data: bytes, start: int, size: int):
    """解析us相关数据。"""
    us = data[start:start + size]
    out = []
    p = 0
    while p < len(us):
        begin = p
        blob_len, p = read_compressed_u(us, p)
        if blob_len == 0:
            continue
        # The final byte of the #US blob is a 0/1 terminal; the chars are UTF-16LE.
        char_bytes_len = blob_len - 1
        if char_bytes_len < 0:
            p += 1
            continue
        chars = us[p:p + char_bytes_len]
        p += char_bytes_len
        if p < len(us):
            p += 1
        try:
            text = chars.decode("utf-16le", errors="replace")
        except Exception as exc:
            text = f"<decode error {exc}>"
        out.append({"offset": begin, "text": text})
    return out


def parse_strings_heap(data: bytes, start: int, size: int):
    """解析strings_heap相关数据。"""
    heap = data[start:start + size]
    out = []
    p = 0
    while p < len(heap):
        begin = p
        end = heap.find(b"\0", p)
        if end < 0:
            break
        raw = heap[p:end]
        if raw:
            out.append({"offset": begin, "text": raw.decode("utf-8", errors="replace")})
        p = end + 1
    return out


def main():
    """命令行主入口。"""
    ap = argparse.ArgumentParser()
    ap.add_argument("path", type=Path)
    ap.add_argument("--needle", action="append")
    ap.add_argument("--heap", choices=["us", "strings"], default="us")
    ap.add_argument("--json", type=Path)
    args = ap.parse_args()

    data, metadata_base, streams, version = metadata_streams(args.path)
    wanted = "#US" if args.heap == "us" else "#Strings"
    stream = next((s for s in streams if s["name"] == wanted), None)
    if not stream:
        print(f"No {wanted} stream")
        return 1
    if args.heap == "us":
        strings = parse_us(data, metadata_base + stream["offset"], stream["size"])
    else:
        strings = parse_strings_heap(data, metadata_base + stream["offset"], stream["size"])
    needles = [n or "" for n in (args.needle or [])]
    rows = []
    for item in strings:
        if not needles or any(n in item["text"] for n in needles):
            rows.append(item)

    out = {
        "assembly": str(args.path),
        "streams": streams,
        "needles": needles,
        "string_count": len(rows),
        "rows": rows,
    }
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    for r in rows:
        print(f"[{r['offset']:08x}] {r['text']}")
    print(f"total strings matching: {len(rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
