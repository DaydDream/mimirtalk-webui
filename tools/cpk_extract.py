"""Small CPK extractor/list helper for CRIWARE archives used by this project."""

from __future__ import annotations

from pathlib import Path
from struct import calcsize, unpack
from typing import Any


TYPE_FMT = "BbHhIiQqfdI"


def _u16(data: bytes, off: int) -> int:
    return int.from_bytes(data[off : off + 2], "big")


def _u32(data: bytes, off: int) -> int:
    return int.from_bytes(data[off : off + 4], "big")


def _fmt_and_size(typ: int) -> tuple[str, int]:
    if typ == 0xB:
        return "II", 8
    if typ == 0xA:
        return "I", 4
    fmt = TYPE_FMT[typ]
    return fmt, calcsize(fmt)


def _read_string(data: bytes, string_start: int, offset: int) -> str:
    if offset < 0:
        return ""
    pos = string_start + offset
    end = data.find(b"\x00", pos)
    if end < 0:
        end = len(data)
    raw = data[pos:end]
    for enc in ("utf-8", "shift-jis", "cp932"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _decode_utf(data: bytes, start: int) -> list[dict[str, Any]]:
    """Decode an @UTF table at an absolute offset in *data*."""
    magic = data[start : start + 4]
    if magic == b"\x1f\x9e\xf3\xf5":
        # Encrypted UTF tables are not expected in MO2's bgm.cpk, but keep the
        # error explicit instead of silently producing garbage.
        raise NotImplementedError("encrypted @UTF table not supported here")
    if magic != b"@UTF":
        raise ValueError(f"not an @UTF table at offset {start:#x}")

    (
        _table_size,
        _rows_offset,
        _strings_offset,
        _data_offset,
        _table_name_offset,
        num_columns,
        row_length,
        num_rows,
    ) = unpack(">IIIIIHHI", data[start + 4 : start + 32])

    pos = start + 32
    descriptors: list[dict[str, Any]] = []
    for _ in range(num_columns):
        flag = data[pos]
        storage = flag >> 4
        typ = flag & 0xF
        pos += 1
        if storage in (1, 5):
            name_offset = _u32(data, pos)
            pos += 4
            descriptors.append(
                {"storage": storage, "type": typ, "name_offset": name_offset}
            )
        elif storage == 3:
            name_offset = _u32(data, pos)
            pos += 4
            fmt, size = _fmt_and_size(typ)
            _constant = unpack(">" + fmt, data[pos : pos + size])
            pos += size
            descriptors.append(
                {
                    "storage": storage,
                    "type": typ,
                    "name_offset": name_offset,
                    "constant": _constant,
                }
            )
        else:
            raise NotImplementedError(
                f"storage flag {storage:#x} at offset {pos:#x} not handled"
            )

    data_cols = [d for d in descriptors if d["storage"] == 5]
    row_start = pos
    string_start = row_start + num_rows * row_length
    rows: list[dict[str, Any]] = []

    for ridx in range(num_rows):
        p = row_start + ridx * row_length
        row: dict[str, Any] = {}
        for col in data_cols:
            name = _read_string(data, string_start, col["name_offset"])
            typ = col["type"]
            fmt, size = _fmt_and_size(typ)
            if typ == 0xB:
                off = _u32(data, p)
                size2 = _u32(data, p + 4)
                row[name] = (off, size2)
                p += size
            elif typ == 0xA:
                off = _u32(data, p)
                row[name] = _read_string(data, string_start, off)
                p += size
            else:
                row[name] = unpack(">" + fmt, data[p : p + size])[0]
                p += size
        rows.append(row)
    return rows


def _cpk_header_row(path: Path) -> dict[str, Any]:
    with path.open("rb") as fh:
        head = fh.read(0x1000)
    if head[:4] != b"CPK ":
        raise ValueError("not a CPK file")
    rows = _decode_utf(head, 16)
    if len(rows) != 1:
        raise ValueError("unexpected CPK header row count")
    return rows[0]


def _toc_rows(path: Path, header_row: dict[str, Any]) -> list[dict[str, Any]]:
    toc_offset = int(header_row.get("TocOffset", 0))
    toc_size = int(header_row.get("TocSize", 0))
    if not toc_offset or not toc_size:
        raise ValueError("CPK header has no TocOffset/TocSize")
    with path.open("rb") as fh:
        fh.seek(toc_offset)
        raw = fh.read(toc_size)
    if raw[:4] not in (b"TOC ", b"ITOC", b"ETOC"):
        raise ValueError(f"unsupported TOC header: {raw[:4]!r}")
    return _decode_utf(raw, 16)


def list_files(path: str) -> None:
    p = Path(path)
    header = _cpk_header_row(p)
    rows = _toc_rows(p, header)
    print(f"content_offset={header.get('ContentOffset')}")
    print(f"toc_offset={header.get('TocOffset')} toc_size={header.get('TocSize')}")
    for row in rows:
        name = row.get("FileName", "")
        dirname = row.get("DirName", "")
        size = row.get("FileSize", 0)
        extract = row.get("ExtractSize", 0)
        off = row.get("FileOffset", 0)
        compressed = bool(extract and extract > size)
        print(f"{size}\t{extract}\t{compressed}\t{dirname}\t{name}\t{off}")


def extract_files(path: str, out_dir: str, prefix: str = "") -> None:
    """提取并返回目标资源或数据。"""
    p = Path(path)
    header = _cpk_header_row(p)
    rows = _toc_rows(p, header)
    content_offset = int(header.get("ContentOffset") or 0x800)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    written = 0
    compressed = 0

    with p.open("rb") as fh:
        for row in rows:
            name = str(row.get("FileName") or "")
            if not name:
                continue
            size = int(row.get("FileSize") or 0)
            extract_size = int(row.get("ExtractSize") or size)
            file_offset = int(row.get("FileOffset") or 0)
            if extract_size > size:
                compressed += 1
            fh.seek(content_offset + file_offset)
            payload = fh.read(size)
            out_name = f"{prefix}{name}" if prefix else name
            target = out / out_name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)
            written += 1
    print(f"wrote {written} files to {out}")
    if compressed:
        print(f"warning: {compressed} entries are compressed; raw packed data was saved")


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("cpk")
    ap.add_argument("--list", action="store_true", help="list files and exit")
    ap.add_argument("--out", help="output directory")
    ap.add_argument("--prefix", default="", help="optional filename prefix")
    args = ap.parse_args()
    if args.list:
        list_files(args.cpk)
    elif args.out:
        extract_files(args.cpk, args.out, args.prefix)
    else:
        list_files(args.cpk)
