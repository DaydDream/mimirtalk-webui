"""extract_audio：资源提取脚本，按指定格式输出目标资源。"""
import argparse
import sys
from pathlib import Path

import UnityPy


def interesting_files(data_dir: Path):
    names = [
        "globalgamemanagers",
        "globalgamemanagers.assets",
        "level0",
        "level1",
        "resources.assets",
        "sharedassets0.assets",
    ]
    for name in names:
        p = data_dir / name
        if p.is_file():
            yield p
    for p in sorted(data_dir.glob("*.assets")):
        if p.name not in names:
            yield p


def safe_name(name: str, path_id: int):
    """清理文件名中的非法字符。"""
    clean = name.replace("/", "_").replace("\\", "_").replace(":", "_")
    clean = "".join(ch if ch.isprintable() else "_" for ch in clean).strip()
    return clean or f"audio_{path_id}"


def matches(name: str, prefixes, substrings):
    upper = name.upper()
    if prefixes:
        if not any(upper.startswith(p.upper()) for p in prefixes):
            return False
    if substrings:
        if not any(s.upper() in upper for s in substrings):
            return False
    return True


def main():
    """命令行主入口。"""
    parser = argparse.ArgumentParser()
    parser.add_argument("data_dir", type=Path)
    parser.add_argument("out_dir", type=Path)
    parser.add_argument("--prefix", action="append", help="require name prefix, repeatable")
    parser.add_argument("--substring", action="append", help="require name substring, repeatable")
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    out_dir = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    saved = 0
    skipped = 0
    errors = []

    for fp in interesting_files(args.data_dir):
        print(f"scanning {fp}", flush=True)
        try:
            env = UnityPy.load(str(fp))
        except Exception as exc:
            errors.append({"file": fp.name, "stage": "load", "error": str(exc)})
            continue

        for obj in env.objects:
            if obj.type.name != "AudioClip":
                continue
            try:
                data = obj.read()
                name = getattr(data, "m_Name", "") or ""
                if not matches(name, args.prefix or [], args.substring or []):
                    skipped += 1
                    continue
                samples = data.samples
            except Exception as exc:
                errors.append({"file": fp.name, "path_id": obj.path_id, "name": name, "stage": "read/samples", "error": str(exc)})
                continue

            if not samples:
                skipped += 1
                continue

            if isinstance(samples, dict):
                iterable = samples.items()
            elif isinstance(samples, bytes):
                iterable = [(f"{safe_name(name, obj.path_id)}.bin", samples)]
            else:
                errors.append({"file": fp.name, "path_id": obj.path_id, "name": name, "stage": "samples", "error": f"unexpected type {type(samples)}"})
                continue

            for sample_name, sample_bytes in iterable:
                ext = Path(sample_name).suffix or ".wav"
                stem = Path(sample_name).stem or safe_name(name, obj.path_id)
                fp_out = out_dir / f"{stem}{ext}"
                if fp_out.exists() and not args.overwrite:
                    print(f"  exists {fp_out}", flush=True)
                    saved += 1
                    continue
                try:
                    fp_out.write_bytes(sample_bytes)
                    saved += 1
                    print(f"  {name} -> {fp_out} ({len(sample_bytes)} bytes)", flush=True)
                except Exception as exc:
                    errors.append({"file": fp.name, "path_id": obj.path_id, "name": name, "output": str(fp_out), "stage": "write", "error": str(exc)})

    print("done")
    print("saved", saved)
    print("skipped", skipped)
    if errors:
        print("errors", len(errors))
        for e in errors[:50]:
            print(e)

    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
