"""扫描解包 PNG 与本地头像，生成去重素材索引和阶段报告。"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

from PIL import Image


WORKSPACE_DIR = Path(__file__).resolve().parents[2]
WEBUI_DIR = WORKSPACE_DIR / "mimirtalk_webui"
DEFAULT_IMAGE_DIR = WORKSPACE_DIR / "extract" / "aethergazer_momotalk" / "images"
DEFAULT_SHARED_HEADS_DIR = (
    WORKSPACE_DIR / "extract" / "aethergazer_momotalk_shared_heads" / "images"
)
DEFAULT_LOCAL_AVATARS_DIR = WEBUI_DIR / "assets" / "avatars"
DEFAULT_OUTPUT = WEBUI_DIR / "data" / "asset_index.json"
DEFAULT_REPORT = WEBUI_DIR / "data" / "stage0_report.md"

KIND_PRIORITY = {
    "texture2d": 10,
    "sprite": 20,
    "raw": 5,
}

CATEGORY_LABELS = {
    "atlas": "图集拆图",
    "backgrounds": "聊天背景",
    "chat_stickers": "聊天贴纸",
    "chat_stickers_i18n": "本地化聊天贴纸",
    "icons": "系统图标",
    "momotalk_images": "通讯图片与头像",
    "widgets": "UI 控件",
    "character_itemshead": "角色头图池",
}

AVATAR_CATEGORIES = {
    "character_itemshead",
}


def relpath(path: Path) -> str:
    """将路径转换为基于工作区的正斜杠相对路径。"""
    return str(path.relative_to(WORKSPACE_DIR)).replace("\\", "/")


def safe_id(value: str) -> str:
    """将资源 ID 转为可用于 URL 的安全标识。"""
    return value.replace("/", "_").replace("\\", "_").replace(":", "_")


def parse_image_path(root: Path, path: Path):
    """解析素材路径并提取分类、资源键和名称。"""
    relative = path.relative_to(root)
    parts = relative.parts
    if len(parts) < 2:
        raise ValueError(f"Unexpected image path: {path}")

    category = parts[0]
    kind = parts[-2] if parts[-2] in KIND_PRIORITY else "raw"
    if kind == "raw":
        asset_key = parts[-2]
    else:
        if len(parts) < 3:
            raise ValueError(f"Missing asset key in image path: {path}")
        asset_key = parts[-3]
    name = path.stem
    identity = f"{category}/{asset_key}/{name.lower()}"
    return {
        "identity": identity,
        "category": category,
        "asset_key": asset_key,
        "name": name,
        "kind": kind,
        "width": 0,
        "height": 0,
        "path": relpath(path),
        "source_root": relpath(root),
        "duplicate_count": 0,
        "duplicate_paths": [],
    }


def prefers_full_texture(record: dict) -> bool:
    """判断素材是否应优先使用完整 Texture2D。"""
    if record["kind"] != "texture2d":
        return False
    if record["category"] == "misc" and record["asset_key"].startswith("textureconfig_chatbubble_"):
        return True
    return (
        record["category"] == "widgets"
        and record["asset_key"] == "widget_system_chat"
        and record["name"] in {"9016_1", "9017_1"}
    )

def add_image(selected: dict, record: dict):
    """加入或替换素材记录并维护重复路径。"""
    current = selected.get(record["identity"])
    if current is None:
        selected[record["identity"]] = record
        return True

    old_rank = 30 if prefers_full_texture(current) else KIND_PRIORITY.get(current["kind"], 0)
    new_rank = 30 if prefers_full_texture(record) else KIND_PRIORITY.get(record["kind"], 0)
    preferred = record if new_rank > old_rank else current
    duplicate = current if preferred is record else record
    preferred["duplicate_count"] = current.get("duplicate_count", 0) + 1
    preferred["duplicate_paths"] = list(current.get("duplicate_paths", []))
    preferred["duplicate_paths"].append(duplicate["path"])
    selected[record["identity"]] = preferred
    return preferred is record


def load_dimensions(path: Path):
    """读取图片尺寸。"""
    with Image.open(path) as image:
        return image.size


def scan_images(root: Path, selected: dict, stats: Counter):
    """递归扫描 PNG 并收集素材元数据。"""
    if not root.is_dir():
        return

    for path in sorted(root.rglob("*.png")):
        stats["scanned"] += 1
        record = parse_image_path(root, path)
        record["width"], record["height"] = load_dimensions(path)
        stats[f"scanned_{record['category']}"] += 1
        add_image(selected, record)


def asset_url(record: dict) -> str:
    """生成素材文件 API 路径。"""
    return f"/api/assets/{safe_id(record['id'])}/file"


def build_index(
    image_root: Path,
    shared_heads_root: Path,
    local_avatars_root: Path,
):
    """扫描并构建素材索引。"""
    selected = {}
    stats = Counter()
    scan_images(image_root, selected, stats)
    scan_images(shared_heads_root, selected, stats)
    scan_images(local_avatars_root, selected, stats)

    assets = []
    for record in selected.values():
        category = record["category"]
        asset_id = f"{category}:{record['asset_key']}:{record['name']}"
        record["id"] = asset_id
        record["label"] = record["name"]
        record["category_label"] = CATEGORY_LABELS.get(category, category)
        record["url"] = asset_url(record)
        record["duplicate_paths"] = sorted(set(record["duplicate_paths"]))
        assets.append(record)

    assets.sort(key=lambda item: (item["category"], item["asset_key"], item["name"]))
    category_counts = Counter(item["category"] for item in assets)
    by_category = {}
    for category in sorted(category_counts):
        by_category[category] = {
            "label": CATEGORY_LABELS.get(category, category),
            "count": category_counts[category],
        }

    avatars = []
    for item in assets:
        if item["category"] in AVATAR_CATEGORIES or "head" in item["name"].lower():
            avatars.append(
                {
                    "id": item["id"],
                    "name": item["name"],
                    "asset_key": item["asset_key"],
                    "category": item["category"],
                    "category_label": item["category_label"],
                    "path": item["path"],
                    "url": item["url"],
                    "width": item["width"],
                    "height": item["height"],
                }
            )

    backgrounds = [
        item
        for item in assets
        if item["category"] == "backgrounds"
    ]
    stickers = [
        item
        for item in assets
        if item["category"] in {"chat_stickers", "chat_stickers_i18n"}
    ]
    duplicate_count = sum(item["duplicate_count"] for item in assets)

    return {
        "version": 1,
        "sources": {
            "images": relpath(image_root),
            "shared_heads": relpath(shared_heads_root),
            "local_avatars": relpath(local_avatars_root),
        },
        "stats": {
            "scanned_files": stats["scanned"],
            "selected_assets": len(assets),
            "duplicate_files_removed": duplicate_count,
            "avatar_count": len(avatars),
            "background_count": len(backgrounds),
            "sticker_count": len(stickers),
            "scanned_by_category": {
                key.removeprefix("scanned_"): value
                for key, value in sorted(stats.items())
                if key.startswith("scanned_")
            },
            "selected_by_category": dict(sorted(category_counts.items())),
        },
        "categories": by_category,
        "assets": assets,
        "avatars": avatars,
        "backgrounds": backgrounds,
        "stickers": stickers,
    }


def write_report(path: Path, index: dict):
    """生成并写入报告文件。"""
    stats = index["stats"]
    lines = [
        "# MimirTalk WebUI 阶段 0 报告",
        "",
        "## 结果",
        "",
        f"- 扫描 PNG：{stats['scanned_files']}",
        f"- 去重后可展示素材：{stats['selected_assets']}",
        f"- 因 sprite/texture2d 重复而移除：{stats['duplicate_files_removed']}",
        f"- 可选头像：{stats['avatar_count']}",
        f"- 可选背景：{stats['background_count']}",
        f"- 可选贴纸：{stats['sticker_count']}",
        "",
        "## 分类",
        "",
        "| 分类 | 数量 |",
        "| --- | ---: |",
    ]
    for category, data in index["categories"].items():
        lines.append(f"| {data['label']} (`{category}`) | {data['count']} |")

    lines.extend(
        [
            "",
            "## 去重规则",
            "",
            "- 同一分类、资源目录和图片名通常优先保留 `sprite`。`textureconfig/chatbubble` 与旧版 `9016_1`、`9017_1` 气泡例外，保留完整 `texture2d` 以匹配 Unity `Sprite.m_Border`。",
            "- 只有 `texture2d` 时保留 `texture2d`。",
            "- 被移除的重复文件路径记录在 `asset_index.json` 的 `duplicate_paths` 中。",
            "",
        ]
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def validate_index(index: dict):
    """校验素材索引结构和必要分类。"""
    ids = [item["id"] for item in index["assets"]]
    if len(ids) != len(set(ids)):
        raise ValueError("Asset IDs are not unique")
    if not index["assets"]:
        raise ValueError("No assets were indexed")
    if not index["avatars"]:
        raise ValueError("No avatars were indexed")


def main() -> int:
    """命令行主入口。"""
    parser = argparse.ArgumentParser(
        description="Build the MimirTalk WebUI asset index from extracted PNG files."
    )
    parser.add_argument("--image-dir", type=Path, default=DEFAULT_IMAGE_DIR)
    parser.add_argument("--shared-heads-dir", type=Path, default=DEFAULT_SHARED_HEADS_DIR)
    parser.add_argument("--local-avatars-dir", type=Path, default=DEFAULT_LOCAL_AVATARS_DIR)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    args = parser.parse_args()

    index = build_index(
        args.image_dir,
        args.shared_heads_dir,
        args.local_avatars_dir,
    )
    validate_index(index)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(index, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    write_report(args.report, index)

    stats = index["stats"]
    print(
        f"scanned={stats['scanned_files']} selected={stats['selected_assets']} "
        f"duplicates_removed={stats['duplicate_files_removed']} "
        f"avatars={stats['avatar_count']} backgrounds={stats['background_count']} "
        f"stickers={stats['sticker_count']}",
        flush=True,
    )
    print(f"index={args.output}", flush=True)
    print(f"report={args.report}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
