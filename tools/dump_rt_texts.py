"""dump_rt_texts：项目辅助脚本，封装对应的数据处理、提取或验证流程。"""
import argparse
import json
import sys
from pathlib import Path

import UnityPy


def data_files(data_dir: Path):
    names = [
        "globalgamemanagers",
        "globalgamemanagers.assets",
        "level0",
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


def clean_text(raw):
    if isinstance(raw, bytes):
        return raw.decode("utf-8", errors="replace")
    return raw


def main():
    """命令行主入口。"""
    parser = argparse.ArgumentParser()
    parser.add_argument("data_dir", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--needle", action="append")
    parser.add_argument("--min-len", type=int, default=0)
    args = parser.parse_args()

    needles = [(n or "").lower() for n in (args.needle or [])]
    rows = []
    errors = []

    for fp in data_files(args.data_dir):
        print(f"scanning {fp}", flush=True)
        try:
            env = UnityPy.load(str(fp))
        except Exception as exc:
            errors.append({"file": fp.name, "stage": "load", "error": str(exc)})
            continue

        for obj in env.objects:
            t = obj.type.name
            if t not in {"TextAsset", "MonoBehaviour", "MonoScript"}:
                continue
            try:
                data = obj.read()
                if t == "TextAsset":
                    text = clean_text(data.m_Script) if getattr(data, "m_Script", None) else ""
                    name = getattr(data, "m_Name", "") or ""
                elif t == "MonoBehaviour":
                    name = getattr(data, "m_Name", "") or ""
                    text = data.__str__()
                else:
                    name = getattr(data, "m_Name", "") or ""
                    text = data.__str__()
            except Exception as exc:
                errors.append({"file": fp.name, "path_id": obj.path_id, "type": t, "stage": "read", "error": str(exc)})
                continue

            if len(text) < args.min_len:
                continue
            if needles:
                low = text.lower()
                if not any(n in low for n in needles):
                    continue
            rows.append(
                {
                    "file": fp.name,
                    "path_id": obj.path_id,
                    "type": t,
                    "name": name,
                    "text_len": len(text),
                    "text": text[:20000],
                }
            )

    out = {
        "needles": args.needle or [],
        "count": len(rows),
        "errors": errors,
        "rows": rows,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"count: {len(rows)}")
    print(f"errors: {len(errors)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
