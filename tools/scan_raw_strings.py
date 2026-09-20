"""scan_raw_strings：资源或字符串扫描工具。"""
import argparse
import json
from pathlib import Path


def files_for(data_path: Path):
    if data_path.is_dir():
        for p in sorted(data_path.rglob("*")):
            if p.is_file():
                yield p
    else:
        yield data_path


def enc_name(enc: str) -> str:
    return {
        "utf8": "utf-8",
        "utf16": "utf-16le",
        "utf16le": "utf-16le",
        "cp932": "cp932",
    }[enc]


def decode_around(data: bytes, start: int, end: int, encoding: str):
    lo = max(0, start)
    hi = min(len(data), end)
    if encoding == "utf-16le":
        # Snap to even boundaries to avoid split surrogate pairs.
        if lo % 2:
            lo -= 1
        if hi % 2:
            hi -= 1
    return data[lo:hi].decode(encoding, errors="replace")


def scan(data: bytes, needle: str, encoding: str, ctx: int):
    term = needle.encode(encoding)
    hits = []
    start = 0
    while True:
        pos = data.find(term, start)
        if pos < 0:
            break
        text = decode_around(data, pos - ctx, pos + len(term) + ctx, encoding)
        hits.append({"offset": pos, "text": text})
        start = pos + 1
    return hits


def main():
    """命令行主入口。"""
    ap = argparse.ArgumentParser()
    ap.add_argument("path", type=Path)
    ap.add_argument("--needle", action="append", required=True)
    ap.add_argument("--encoding", action="append", choices=["utf8", "utf16le", "cp932"])
    ap.add_argument("--context", type=int, default=120)
    ap.add_argument("--json", type=Path)
    args = ap.parse_args()

    encodings = args.encoding or ["utf8", "utf16le"]
    rows = []
    skipped = []
    for fp in files_for(args.path):
        try:
            data = fp.read_bytes()
        except Exception as exc:
            skipped.append({"file": str(fp), "error": str(exc)})
            continue
        for needle in args.needle:
            for enc in encodings:
                hits = scan(data, needle, enc_name(enc), args.context)
                for hit in hits:
                    rows.append(
                        {
                            "file": str(fp),
                            "needle": needle,
                            "encoding": enc,
                            "offset": hit["offset"],
                            "context": hit["text"],
                        }
                    )

    out = {"rows": rows, "skipped": skipped}
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    for r in rows:
        print(f"{r['file']} [{r['needle']}/{r['encoding']} @{r['offset']}]\n{r['context']}\n")
    print(f"count: {len(rows)}")
    print(f"skipped: {len(skipped)}")


if __name__ == "__main__":
    raise SystemExit(main())
