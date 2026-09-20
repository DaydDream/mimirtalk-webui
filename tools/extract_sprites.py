"""extract_sprites：资源提取脚本，按指定格式输出目标资源。"""
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
    clean = "".join(ch if ch.isprintable() else "_" for ch in clean)
    return clean or f"sprite_{path_id}"


def main():
    """命令行主入口。"""
    parser = argparse.ArgumentParser()
    parser.add_argument("data_dir", type=Path)
    parser.add_argument("out_dir", type=Path)
    parser.add_argument("--prefix", action="append")
    args = parser.parse_args()

    if not args.prefix:
        args.prefix = ["EV_", "ST_"]

    data_dir = args.data_dir
    out_dir = args.out_dir
    prefixes = tuple(args.prefix)

    counts = {prefix: 0 for prefix in args.prefix}
    errors = []
    saved = 0
    skipped = 0

    for fp in interesting_files(data_dir):
        print(f"scanning {fp}", flush=True)
        try:
            env = UnityPy.load(str(fp))
        except Exception as exc:
            errors.append({"file": fp.name, "stage": "load", "error": str(exc)})
            continue

        for obj in env.objects:
            if obj.type.name != "Sprite":
                continue
            try:
                sprite = obj.read()
            except Exception as exc:
                errors.append({"file": fp.name, "path_id": obj.path_id, "stage": "Sprite.read", "error": str(exc)})
                continue

            name = getattr(sprite, "m_Name", "") or ""
            matched = None
            for prefix in args.prefix:
                if name.upper().startswith(prefix):
                    matched = prefix
                    break
            if not matched:
                skipped += 1
                continue

            try:
                img = sprite.image
                if img is None:
                    skipped += 1
                    continue
                cat_dir = out_dir / matched.rstrip("_")
                cat_dir.mkdir(parents=True, exist_ok=True)
                fp_out = cat_dir / f"{safe_name(name, obj.path_id)}.png"
                img.save(fp_out)
                saved += 1
                counts[matched] += 1
                if saved % 100 == 0:
                    print(f"  saved {saved} images", flush=True)
            except Exception as exc:
                errors.append({"file": fp.name, "path_id": obj.path_id, "name": name, "stage": "sprite.image", "error": str(exc)})

    print("done")
    print("saved", saved)
    print("skipped", skipped)
    print("counts", counts)
    if errors:
        print("errors", len(errors))
        for e in errors[:50]:
            print(e)

    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
