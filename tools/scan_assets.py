"""scan_assets：资源或字符串扫描工具。"""
import collections
import json
import re
import sys
from pathlib import Path

import UnityPy


def category(name: str):
    n = (name or "").upper()
    if n.startswith("EV_"):
        return "EV_CG"
    if n.startswith("BG_"):
        return "BG_background"
    if n.startswith("ST_"):
        return "ST_standing"
    if "TITLE" in n:
        return "UI_title"
    return "other"


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


def main():
    """命令行主入口。"""
    if len(sys.argv) < 2:
        print("usage: scan_assets.py <EVE_GE_Data_dir> [report_json]")
        return 2

    data_dir = Path(sys.argv[1])
    report_path = Path(sys.argv[2]) if len(sys.argv) > 2 else None

    counts = collections.Counter()
    tex_stats = collections.Counter()
    tex_names = []
    sprite_names = []
    texture_categories = collections.Counter()
    sprite_categories = collections.Counter()
    text_names = []
    errors = []
    files = []

    for fp in interesting_files(data_dir):
        files.append(str(fp))
        print(f"scanning {fp}")
        try:
            env = UnityPy.load(str(fp))
        except Exception as exc:
            errors.append({"file": str(fp), "stage": "load", "error": str(exc)})
            continue

        for obj in env.objects:
            obj_type = obj.type.name
            counts[obj_type] += 1

            if obj_type == "Texture2D":
                try:
                    data = obj.read()
                    width = getattr(data, "m_Width", 0)
                    height = getattr(data, "m_Height", 0)
                    fmt = getattr(data, "m_TextureFormat", "?")
                    name = getattr(data, "m_Name", "") or ""
                    tex_stats[(width, height, fmt)] += 1
                    texture_categories[category(name)] += 1
                    if name and len(tex_names) < 500:
                        tex_names.append(
                            {
                                "file": fp.name,
                                "name": name,
                                "width": width,
                                "height": height,
                                "format": str(fmt),
                            }
                        )
                except Exception as exc:
                    errors.append({"file": fp.name, "stage": "Texture2D", "error": str(exc)})

            elif obj_type == "Sprite":
                try:
                    data = obj.read()
                    name = getattr(data, "m_Name", "") or ""
                    if name:
                        sprite_categories[category(name)] += 1
                        sprite_names.append({"file": fp.name, "name": name})
                except Exception as exc:
                    errors.append({"file": fp.name, "stage": "Sprite", "error": str(exc)})

            elif obj_type == "TextAsset":
                try:
                    data = obj.read()
                    name = getattr(data, "m_Name", "") or ""
                    if name:
                        text_names.append({"file": fp.name, "name": name})
                except Exception as exc:
                    errors.append({"file": fp.name, "stage": "TextAsset", "error": str(exc)})

    report = {
        "game_data_dir": str(data_dir),
        "files_scanned": files,
        "type_counts": dict(sorted(counts.items(), key=lambda kv: -kv[1])),
        "texture_size_format_counts": [
            {"width": w, "height": h, "format": f, "count": c}
            for (w, h, f), c in tex_stats.most_common()
        ],
        "texture_category_counts": dict(sorted(texture_categories.items(), key=lambda kv: -kv[1])),
        "sprite_category_counts": dict(sorted(sprite_categories.items(), key=lambda kv: -kv[1])),
        "texture_name_samples": tex_names,
        "sprite_count": len(sprite_names),
        "sprite_name_samples": sprite_names[:500],
        "text_asset_count": len(text_names),
        "text_asset_name_samples": text_names[:500],
        "errors": errors[:200],
        "error_count": len(errors),
    }

    if report_path:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print("=== type counts ===")
    for key, value in report["type_counts"].items():
        print(f"{key}: {value}")
    print("=== texture size/format (top 40) ===")
    for item in report["texture_size_format_counts"][:40]:
        print(item)
    print("=== texture categories ===")
    for key, value in report["texture_category_counts"].items():
        print(f"{key}: {value}")
    print("=== sprite categories ===")
    for key, value in report["sprite_category_counts"].items():
        print(f"{key}: {value}")
    print(f"sprite_count: {report['sprite_count']}")
    print(f"text_asset_count: {report['text_asset_count']}")
    print(f"error_count: {report['error_count']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
