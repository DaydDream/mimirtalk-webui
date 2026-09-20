"""合并 ChatHeroCfg 与现有联系人，生成联系人名单、头像名称映射和报告。"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


WORKSPACE_DIR = Path(__file__).resolve().parents[2]
DEFAULT_CHAT_CFG = (
    WORKSPACE_DIR
    / "extract"
    / "aethergazer_momotalk"
    / "scripts"
    / "lua_all"
    / "ChatHeroCfg.lua"
)
DEFAULT_ASSET_INDEX = WORKSPACE_DIR / "mimirtalk_webui" / "data" / "asset_index.json"
DEFAULT_CONTACTS = WORKSPACE_DIR / "mimirtalk_webui" / "data" / "chat_contacts.json"
DEFAULT_ASSET_NAMES = WORKSPACE_DIR / "mimirtalk_webui" / "data" / "asset_names.json"
DEFAULT_REPORT = WORKSPACE_DIR / "mimirtalk_webui" / "data" / "contact_map_report.md"

CHINESE_RUN = re.compile(rb"(?:[\xc2-\xf4][\x80-\xbf]+)+")
ICON_PATH = re.compile(
    rb"TextureConfig/(?:Character/MediumIcon|Momotalk)/([0-9]+)"
)

# Hero avatar source. character_itemshead holds the 56x56 MomoTalk contact
# icons used by every hero entry in the cleaned asset set.
HERO_CATEGORIES = ("character_itemshead",)
GROUP_CATEGORY = "momotalk_images"


def parse_chat_cfg(path: Path) -> list[dict]:
    """解析 ChatHeroCfg 中的角色名称和图标路径。"""
    data = path.read_bytes()
    names: list[str] = []
    for match in CHINESE_RUN.finditer(data):
        try:
            names.append(match.group().decode("utf-8"))
        except UnicodeDecodeError:
            continue
    icons: list[str] = []
    for match in ICON_PATH.finditer(data):
        icons.append(match.group().decode("ascii"))

    if len(names) != len(icons):
        raise ValueError(
            f"ChatHeroCfg name/icon count mismatch: {len(names)} != {len(icons)}"
        )

    entries = []
    for name, icon in zip(names, icons):
        icon_id = int(icon.rsplit("/", 1)[-1])
        entries.append(
            {
                "id": icon_id,
                "name": name,
                "kind": "group" if "Momotalk" in icon else "hero",
                "game_icon_path": icon,
            }
        )
    return entries


def index_by_category(assets: list[dict]) -> dict[str, dict[str, dict]]:
    """按素材分类和名称建立索引。"""
    result: dict[str, dict[str, dict]] = {}
    for asset in assets:
        result.setdefault(asset["category"], {})[asset["name"]] = asset
    return result


def resolve_asset(entry: dict, by_category: dict[str, dict[str, dict]]):
    """为角色选择优先级最高的头像资源。"""
    name = str(entry["id"])
    if entry["kind"] == "group":
        return by_category.get(GROUP_CATEGORY, {}).get(name)

    for category in HERO_CATEGORIES:
        asset = by_category.get(category, {}).get(name)
        if asset is not None:
            return asset
    return None


def load_json_object(path: Path) -> dict:
    """读取 JSON 对象文件。"""
    if not path.is_file():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    return payload if isinstance(payload, dict) else {}


def merge_contacts(generated: list[dict], existing: list[dict]) -> list[dict]:
    """按现有名单合并生成联系人，保留手工角色与删除状态。"""
    if not existing:
        return generated
    generated_by_id = {entry["id"]: entry for entry in generated}
    merged = []
    for old in existing:
        entry = generated_by_id.get(old.get("id"))
        if entry is None:
            merged.append(old)
            continue
        entry = dict(entry)
        if entry.get("asset_id") is None and old.get("asset_id"):
            entry["asset_id"] = old["asset_id"]
            entry["asset_category"] = old.get("asset_category")
        merged.append(entry)
    return merged


def merge_library(generated: dict, existing: dict) -> dict:
    """合并头像名称映射，避免覆盖已有名称。"""
    merged = {}
    for asset_id in set(generated) | set(existing):
        record = dict(generated.get(asset_id) or existing.get(asset_id) or {})
        old = existing.get(asset_id) or {}
        if not record.get("name") and old.get("name"):
            record["name"] = old["name"]
            record["base_id"] = old.get("base_id")
            record["variant"] = old.get("variant")
        merged[asset_id] = record
    return merged


def build_contacts(entries: list[dict], by_category: dict[str, dict[str, dict]]):
    """将角色配置转换为联系人记录。"""
    contacts = []
    for entry in entries:
        asset = resolve_asset(entry, by_category)
        contacts.append(
            {
                "id": entry["id"],
                "name": entry["name"],
                "kind": entry["kind"],
                "game_icon_path": entry["game_icon_path"],
                "asset_id": asset["id"] if asset else None,
                "asset_category": asset["category"] if asset else None,
                "enabled": True,
            }
        )
    return contacts


def hero_names(entries: list[dict]) -> dict[int, str]:
    """从联系人配置中提取普通角色 ID 与名称映射。"""
    names: dict[int, str] = {}
    for entry in entries:
        if entry["kind"] == "hero":
            names.setdefault(entry["id"], entry["name"])
    return names


def general_library_names(assets: list[dict], names: dict[int, str]):
    """Name the general avatar pool using the chat-hero roster as the source."""
    result = {}
    for asset in assets:
        category = asset["category"]
        if category not in HERO_CATEGORIES:
            continue
        raw = asset["name"]
        record = {
            "category": category,
            "asset_key": asset["asset_key"],
            "path": asset["path"],
            "url": asset["url"],
        }
        if raw.isdigit():
            number = int(raw)
            if number in names:
                record["name"] = names[number]
                record["base_id"] = number
                record["variant"] = None
            else:
                base = number // 100
                variant = number % 100
                if len(raw) >= 6 and base in names and variant:
                    record["name"] = names[base]
                    record["base_id"] = base
                    record["variant"] = variant
                else:
                    record["name"] = None
                    record["base_id"] = None
                    record["variant"] = None
        else:
            record["name"] = None
            record["base_id"] = None
            record["variant"] = None
        result[asset["id"]] = record
    return result


def validate(contacts: list[dict], names: dict[int, str], library: dict):
    """执行一致性校验并返回问题列表。"""
    problems = []
    ids = [c["id"] for c in contacts]
    if len(ids) != len(set(ids)):
        problems.append("联系人 ID 不唯一")
    heroes = [c for c in contacts if c["kind"] == "hero"]
    groups = [c for c in contacts if c["kind"] == "group"]
    if not contacts:
        problems.append("可会话角色列表为空")
    invalid_kinds = sorted({c.get("kind") for c in contacts} - {"hero", "group"})
    if invalid_kinds:
        problems.append(f"联系人 kind 只能为 hero/group，实际出现: {invalid_kinds}")

    missing = [c["id"] for c in heroes if c["asset_id"] is None]

    for group in groups:
        if group["asset_id"] is None:
            problems.append(f"群组 {group['id']} 缺少头像")

    for asset_id, record in library.items():
        if asset_id.endswith(":101701") and record.get("base_id") != 1017:
            problems.append("101701 必须映射到 1017，而不是 10170")

    return problems


def write_report(path: Path, contacts: list[dict], library: dict, problems: list[str]):
    """生成并写入报告文件。"""
    heroes = [c for c in contacts if c["kind"] == "hero"]
    groups = [c for c in contacts if c["kind"] == "group"]
    named = [r for r in library.values() if r.get("name")]

    lines = [
        "# MomoTalk 角色名与头像映射报告",
        "",
        f"- 可会话角色：{len(contacts)}（普通角色 {len(heroes)}，系统/群组 {len(groups)}）",
        f"- 通用头像库条目：{len(library)}",
        f"- 已解析名称：{len(named)}",
        f"- 未解析名称：{len(library) - len(named)}（保留资源 ID，后续可补）",
        f"- 缺少正式头像的角色："
        + "、".join(
            f"{c['name']}({c['id']})" for c in heroes if c["asset_id"] is None
        ),
        "",
        "## 可会话角色",
        "",
        "| ID | 类型 | 名称 | 头像资源 | 游戏内图标路径 |",
        "| ---: | --- | --- | --- | --- |",
    ]
    for contact in contacts:
        kind = "普通角色" if contact["kind"] == "hero" else "系统/群组"
        asset = contact["asset_id"] or "（缺正式头像，用占位图）"
        lines.append(
            f"| {contact['id']} | {kind} | {contact['name']} | "
            f"`{asset}` | `{contact['game_icon_path']}` |"
        )

    lines.extend(
        [
            "",
            "## 通用头像库来源优先级",
            "",
            "1. `character_itemshead`（角色头图池，56x56 弥弥尔联系人头像）",
            "",
            "系统/群组头像统一取自 `momotalk_images`。",
            "",
            "## 变体规则",
            "",
            "- 头像资源名等于基础 ID 时，直接对应角色。",
            "- 六位数资源名按 `基础ID * 100 + 变体号` 解释，例如 `102001` 是 `1020` 的变体 1。",
            "- `101701` 属于 `1017` 的变体，不能当作望舒(`10170`)的头像。",
            "",
        ]
    )
    if problems:
        lines.extend(["## 校验问题", ""])
        lines.extend(f"- {problem}" for problem in problems)
        lines.append("")

    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    """命令行主入口。"""
    parser = argparse.ArgumentParser(
        description="Build chat contact and general avatar name maps."
    )
    parser.add_argument("--chat-cfg", type=Path, default=DEFAULT_CHAT_CFG)
    parser.add_argument("--asset-index", type=Path, default=DEFAULT_ASSET_INDEX)
    parser.add_argument("--contacts", type=Path, default=DEFAULT_CONTACTS)
    parser.add_argument("--asset-names", type=Path, default=DEFAULT_ASSET_NAMES)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    args = parser.parse_args()

    entries = parse_chat_cfg(args.chat_cfg)
    index = json.loads(args.asset_index.read_text(encoding="utf-8"))
    by_category = index_by_category(index["assets"])

    generated_contacts = build_contacts(entries, by_category)
    existing_contacts = load_json_object(args.contacts).get("contacts", [])
    contacts = merge_contacts(generated_contacts, existing_contacts)
    names = hero_names(entries)
    for contact in contacts:
        if contact.get("kind") == "hero" and isinstance(contact.get("id"), int):
            names.setdefault(contact["id"], contact.get("name", ""))

    generated_library = general_library_names(index["assets"], names)
    existing_library = load_json_object(args.asset_names).get("assets", {})
    library = merge_library(generated_library, existing_library)
    problems = validate(contacts, names, library)

    contacts_doc = {
        "version": 1,
        "source": "ChatHeroCfg.lua + 用户补充角色（合并保留）",
        "note": (
            "可会话角色名单。新增角色时复制一条记录，填写 name、game_icon_path，"
            "并把 asset_id 指向 asset_index.json 中的头像资源 ID；没有正式头像时"
            "把 asset_id 设为 null。头像 PNG 不需要预先裁切，WebUI 和 PNG 导出"
            "会统一按 MomoTalk 头像内孔裁切。"
        ),
        "contacts": contacts,
    }
    names_doc = {
        "version": 1,
        "source": "ChatHeroCfg.lua + asset_index.json",
        "note": "通用角色库映射。name 为 null 表示该素材尚未对应到已收录角色；重建时会保留用户补充角色。",
        "assets": library,
    }

    args.contacts.write_text(
        json.dumps(contacts_doc, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    args.asset_names.write_text(
        json.dumps(names_doc, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    write_report(args.report, contacts, library, problems)

    if problems:
        for problem in problems:
            print(f"[FAIL] {problem}", file=sys.stderr)
        return 1

    hero_count = sum(1 for c in contacts if c["kind"] == "hero")
    group_count = sum(1 for c in contacts if c["kind"] == "group")
    named = sum(1 for r in library.values() if r["name"])
    print(
        f"contacts={len(contacts)} (hero={hero_count}, group={group_count}) "
        f"library={len(library)} named={named}",
        flush=True,
    )
    print(f"contacts_file={args.contacts}", flush=True)
    print(f"asset_names_file={args.asset_names}", flush=True)
    print(f"report_file={args.report}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
