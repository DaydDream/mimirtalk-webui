"""根据游戏贴纸配置和素材索引生成可用贴纸分类。"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


WEBUI_DIR = Path(__file__).resolve().parents[1]
INDEX_PATH = WEBUI_DIR / "data" / "asset_index.json"
CONFIG_PATH = WEBUI_DIR / "data" / "chat_sticker_cfg.json"
OUTPUT_PATH = WEBUI_DIR / "data" / "sticker_categories.json"


def asset_base_name(asset: dict) -> str:
    """提取贴纸素材的基础名称。"""
    return str(asset.get("name", "")).split("@", 1)[0]


def asset_priority(asset: dict) -> tuple:
    """计算贴纸素材优先级。"""
    category = asset.get("category", "")
    category_rank = {
        "chat_stickers_i18n": 0,
        "chat_stickers": 1,
    }.get(category, 2)
    name = str(asset.get("name", ""))
    localized_rank = 0 if "@zh_cn" in name else 1
    return category_rank, localized_rank, name


def find_exact_asset(stickers: list[dict], icon: str) -> list[dict]:
    """查找与配置完全匹配的素材。"""
    candidates = [asset for asset in stickers if asset_base_name(asset) == icon]
    return sorted(candidates, key=asset_priority)


def selectable_assets_for_record(
    stickers: list[dict],
    record: dict,
) -> list[dict] | None:
    """为贴纸配置选择可用素材。"""
    if record.get("type") != 1:
        return None
    return find_exact_asset(stickers, str(record.get("icon", "")))


def main() -> int:
    """命令行主入口。"""
    parser = argparse.ArgumentParser(
        description="Build official MomoTalk sticker categories from ChatSticker config."
    )
    parser.add_argument("--index", type=Path, default=INDEX_PATH)
    parser.add_argument("--config", type=Path, default=CONFIG_PATH)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    args = parser.parse_args()

    index = json.loads(args.index.read_text(encoding="utf-8"))
    config = json.loads(args.config.read_text(encoding="utf-8"))
    stickers = index.get("stickers", [])
    records = config.get("records", [])
    official_categories = config.get("categories", [])
    if not stickers:
        raise RuntimeError(f"No sticker assets found in {args.index}")
    if not records or not official_categories:
        raise RuntimeError(f"ChatSticker config is incomplete: {args.config}")

    categories = []
    missing_records = []
    assigned_asset_ids: set[str] = set()

    for category_cfg in sorted(official_categories, key=lambda item: item["id"]):
        category_id = int(category_cfg["id"])
        icon = str(category_cfg["icon"])
        icon_assets = find_exact_asset(stickers, icon)
        if not icon_assets:
            raise RuntimeError(f"Missing category icon asset: category={category_id} icon={icon}")

        category_records = sorted(
            (record for record in records if int(record["category"]) == category_id),
            key=lambda item: int(item["id"]),
        )
        sticker_asset_ids: list[str] = []
        missing_count = 0

        for record in category_records:
            if category_id == 0:
                # Category 0 is the custom/favorite entry. It is shown as a
                # disabled category icon, but its add-icon record is not a sticker.
                continue

            candidates = selectable_assets_for_record(stickers, record)
            if candidates is None:
                continue
            if not candidates:
                missing_count += 1
                missing_records.append(
                    {
                        "category_id": category_id,
                        "record_id": int(record["id"]),
                        "icon": record.get("icon", ""),
                        "name": record.get("name", ""),
                    }
                )
                continue

            representative = candidates[0]
            if representative["id"] not in assigned_asset_ids:
                sticker_asset_ids.append(representative["id"])
                assigned_asset_ids.add(representative["id"])

        categories.append(
            {
                "id": str(category_id),
                "category_id": category_id,
                "official_icon": icon,
                "icon_asset_id": icon_assets[0]["id"],
                "record_count": len(category_records),
                "sticker_asset_ids": sticker_asset_ids,
                "available_count": len(sticker_asset_ids),
                "missing_count": missing_count,
                "disabled": category_id == 0 or not sticker_asset_ids,
            }
        )

    payload = {
        "version": 2,
        "source": {
            "chat_sticker_cfg": config.get("source", {}).get("chat_sticker_cfg"),
            "category_cfg": config.get("source", {}).get("category_cfg"),
            "asset_index": args.index.name,
        },
        "category_count": len(categories),
        "selectable_category_count": sum(1 for item in categories if not item["disabled"]),
        "record_count": sum(item["record_count"] for item in categories),
        "sticker_count": sum(item["available_count"] for item in categories),
        "missing_count": len(missing_records),
        "missing_records": missing_records,
        "categories": categories,
    }
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "output": str(args.output),
                "categories": payload["category_count"],
                "selectable_categories": payload["selectable_category_count"],
                "stickers": payload["sticker_count"],
                "missing_records": payload["missing_count"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
