"""解析游戏贴纸配置并生成 WebUI 所需贴纸分类数据。"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


WEBUI_DIR = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_PATH = WEBUI_DIR / "data" / "chat_sticker_cfg.json"

RECORD_PATTERN = re.compile(
    r"\{\s*"
    r"free = (-?\d+),\s*"
    r'name = "(.*?)",\s*'
    r"type = (-?\d+),\s*"
    r'desc_source_1 = "(.*?)",\s*'
    r'desc_source = "(.*?)",\s*'
    r"display_type = (-?\d+),\s*"
    r"category = (-?\d+),\s*"
    r"id = (-?\d+),\s*"
    r'icon = "(.*?)"\s*'
    r"\}",
    re.DOTALL,
)

CATEGORY_PATTERN = re.compile(
    r"\{\s*"
    r"id = (-?\d+),\s*"
    r'icon = "(.*?)"\s*'
    r"\}",
    re.DOTALL,
)


def parse_records(path: Path) -> list[dict]:
    """解析贴纸记录。"""
    text = path.read_text(encoding="utf-8-sig")
    records = []
    for match in RECORD_PATTERN.finditer(text):
        records.append(
            {
                "free": int(match.group(1)),
                "name": match.group(2),
                "type": int(match.group(3)),
                "desc_source_1": match.group(4),
                "desc_source": match.group(5),
                "display_type": int(match.group(6)),
                "category": int(match.group(7)),
                "id": int(match.group(8)),
                "icon": match.group(9),
            }
        )
    records.sort(key=lambda item: item["id"])
    return records


def parse_categories(path: Path) -> list[dict]:
    """解析贴纸分类。"""
    text = path.read_text(encoding="utf-8-sig")
    categories = []
    for match in CATEGORY_PATTERN.finditer(text):
        categories.append(
            {
                "id": int(match.group(1)),
                "icon": match.group(2),
            }
        )
    categories.sort(key=lambda item: item["id"])
    return categories


def main() -> int:
    """命令行主入口。"""
    parser = argparse.ArgumentParser(
        description="Extract readable ChatSticker Lua tables into a JSON snapshot."
    )
    parser.add_argument("--chat-sticker-cfg", type=Path, required=True)
    parser.add_argument("--category-cfg", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_PATH)
    args = parser.parse_args()

    records = parse_records(args.chat_sticker_cfg)
    categories = parse_categories(args.category_cfg)
    if not records:
        raise RuntimeError(f"No ChatStickerCfg records found in {args.chat_sticker_cfg}")
    if not categories:
        raise RuntimeError(f"No ChatStickerCategoryCfg records found in {args.category_cfg}")

    expected_ids = {item["id"] for item in categories}
    missing_category_ids = sorted({item["category"] for item in records} - expected_ids)
    if missing_category_ids:
        raise RuntimeError(f"Sticker records reference unknown categories: {missing_category_ids}")

    payload = {
        "version": 1,
        "source": {
            "chat_sticker_cfg": args.chat_sticker_cfg.name,
            "category_cfg": args.category_cfg.name,
        },
        "record_count": len(records),
        "category_count": len(categories),
        "records": records,
        "categories": categories,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "output": str(args.output),
                "records": len(records),
                "categories": len(categories),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
