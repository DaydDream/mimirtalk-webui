#!/usr/bin/env python
"""构建安卓端可打包的静态只读数据。

这个脚本只读取仓库里的内置数据，不读取用户项目、上传图片、自建群和群改名。
输出目录默认在 ``output/static-data``；如需给 Capacitor 打调试包，可用
``--output`` 指向安卓工程的静态资源目录。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


WEBUI_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = WEBUI_DIR / "data"
DEFAULT_OUTPUT_DIR = WEBUI_DIR / "output" / "static-data"

MANIFEST_VERSION = 1
SCHEMA_VERSION = 1
OUTPUT_FILE_NAMES = (
    "contacts.json",
    "conversation-contacts.json",
    "groups.json",
    "bubble-themes.json",
    "sticker-categories.json",
    "character-profiles.json",
    "asset-index.json",
    "manifest.json",
)


def load_json(path: Path) -> dict:
    """读取 JSON 对象，失败时抛出带文件名的错误。"""
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ValueError(f"缺少数据文件: {path}") from None
    except json.JSONDecodeError as exc:
        raise ValueError(f"JSON 解析失败: {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"数据文件必须是对象: {path}")
    return payload


def load_list(path: Path, key: str) -> list:
    """读取对象里的数组字段。"""
    payload = load_json(path)
    value = payload.get(key)
    if not isinstance(value, list):
        raise ValueError(f"{path.name} 的 {key} 必须是数组")
    return value


def require_contact_fields(contact: dict, index: int) -> None:
    """校验联系人公开字段，避免生成半套数据。"""
    if not isinstance(contact, dict):
        raise ValueError(f"chat_contacts.json contacts[{index}] 必须是对象")
    contact_id = contact.get("id")
    if isinstance(contact_id, bool) or not isinstance(contact_id, int):
        raise ValueError(f"chat_contacts.json contacts[{index}].id 必须是整数")
    name = contact.get("name")
    if not isinstance(name, str) or not name.strip():
        raise ValueError(f"chat_contacts.json contacts[{index}].name 不能为空")
    kind = contact.get("kind", "hero")
    if kind not in {"hero", "group"}:
        raise ValueError(f"chat_contacts.json contacts[{index}].kind 不支持: {kind}")


def normalize_contacts() -> list[dict]:
    """输出启用中的内置联系人，字段与后端列表接口保持一致。"""
    contacts = load_list(DATA_DIR / "chat_contacts.json", "contacts")
    output: list[dict] = []
    for index, contact in enumerate(contacts):
        require_contact_fields(contact, index)
        if not contact.get("enabled", True):
            continue
        output.append(
            {
                "id": contact["id"],
                "name": contact.get("name", ""),
                "kind": contact.get("kind", "hero"),
                "game_icon_path": contact.get("game_icon_path", ""),
                "asset_id": contact.get("asset_id"),
                "asset_category": contact.get("asset_category"),
                "custom": False,
                "enabled": True,
            }
        )
    return output


def normalize_group_members() -> dict[str, list[int]]:
    """读取内置群成员默认值，不包含 group_names / deleted_group_ids 覆盖。"""
    payload = load_json(DATA_DIR / "group_members.json")
    groups = payload.get("groups", {})
    if not isinstance(groups, dict):
        raise ValueError("group_members.json 的 groups 必须是对象")
    normalized: dict[str, list[int]] = {}
    for raw_group_id, raw_member_ids in sorted(groups.items(), key=lambda item: str(item[0])):
        try:
            group_id = int(raw_group_id)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"group_members.json 群 ID 必须是整数: {raw_group_id}") from exc
        if not isinstance(raw_member_ids, list):
            raise ValueError(f"group_members.json groups[{raw_group_id}] 必须是数组")
        member_ids: list[int] = []
        for item in raw_member_ids:
            if isinstance(item, bool) or not isinstance(item, int):
                raise ValueError(
                    f"group_members.json groups[{raw_group_id}] 成员 ID 必须是整数"
                )
            if item not in member_ids:
                member_ids.append(item)
        normalized[str(group_id)] = member_ids
    return normalized


def normalize_contacts_with_members() -> list[dict]:
    """把内置群成员复制进联系人条目，方便静态适配层直接使用。"""
    members = normalize_group_members()
    contacts = []
    for contact in normalize_contacts():
        item = dict(contact)
        if item.get("kind") == "group":
            item["member_ids"] = members.get(str(item["id"]), [])
        else:
            item["member_ids"] = []
        contacts.append(item)
    return contacts


def default_preview_ids(contacts: list[dict]) -> list[int]:
    """默认会话清单：薇儿丹蒂 + 全部内置群。"""
    ids = [
        contact["id"]
        for contact in contacts
        if isinstance(contact.get("id"), int)
        and (
            (contact.get("kind") == "group" and contact.get("custom") is False)
            or contact.get("id") == 1084
        )
    ]
    return ids


def normalize_bubble_themes() -> dict:
    """生成气泡主题静态包。"""
    payload = load_json(DATA_DIR / "bubble_themes.json")
    available = payload.get("available_themes") or {}
    themes = available.get("themes") or []
    if not isinstance(themes, list):
        raise ValueError("bubble_themes.json available_themes.themes 必须是数组")
    default_id = available.get("default_theme") or (themes[0]["id"] if themes else "")
    return {
        "default_theme": default_id,
        "count": len(themes),
        "slice_rule": available.get("slice_rule", ""),
        "themes": themes,
    }


def normalize_sticker_categories() -> dict:
    """生成表情分类静态包，保留原始分页所需 ID。"""
    payload = load_json(DATA_DIR / "sticker_categories.json")
    categories = payload.get("categories", [])
    if not isinstance(categories, list) or not categories:
        raise ValueError("sticker_categories.json 的 categories 必须是非空数组")
    return payload


def normalize_assets() -> dict:
    """生成素材索引静态包。"""
    payload = load_json(DATA_DIR / "asset_index.json")
    assets = payload.get("assets", [])
    if not isinstance(assets, list) or not assets:
        raise ValueError("asset_index.json 的 assets 必须是非空数组")
    return payload


def normalize_character_profiles() -> dict:
    """生成角色身份档案静态包（角色信息页数据源）。

    缺失档案的字段在源文件里已统一填「未知」；这里只做结构校验，保证 id 唯一。
    """
    payload = load_json(DATA_DIR / "character_profiles.json")
    profiles = payload.get("profiles")
    if not isinstance(profiles, list) or not profiles:
        raise ValueError("character_profiles.json 的 profiles 必须是非空数组")
    seen: set[int] = set()
    for index, profile in enumerate(profiles):
        if not isinstance(profile, dict):
            raise ValueError(f"character_profiles.json profiles[{index}] 必须是对象")
        profile_id = profile.get("id")
        if isinstance(profile_id, bool) or not isinstance(profile_id, int):
            raise ValueError(f"character_profiles.json profiles[{index}].id 必须是整数")
        if profile_id in seen:
            raise ValueError(f"character_profiles.json 角色 ID 重复: {profile_id}")
        seen.add(profile_id)
    return payload


def json_bytes(payload) -> bytes:
    """稳定 JSON 编码：排序键、固定缩进、UTF-8。"""
    text = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True)
    return (text + "\n").encode("utf-8")


def sha256_bytes(content: bytes) -> str:
    """计算 SHA-256。"""
    return hashlib.sha256(content).hexdigest()


def write_json_file(path: Path, payload) -> dict:
    """写入单个 JSON 文件并返回 manifest 条目。"""
    content = json_bytes(payload)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return {
        "path": path.name,
        "sha256": sha256_bytes(content),
        "size": len(content),
    }


def clear_known_outputs(output_dir: Path) -> None:
    """仅删除本工具已知输出文件。

    Windows 的受限工作区可能给输出目录加上禁止删除目录的 ACL；直接清理整棵目录
    会失败，但覆盖已知文件仍可用，因此构建器不做递归删除。
    """
    for name in OUTPUT_FILE_NAMES:
        path = output_dir / name
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass


def build_payloads() -> dict[str, object]:
    """构建所有静态数据对象。"""
    contacts = normalize_contacts_with_members()
    preview_ids = default_preview_ids(contacts)
    group_members = normalize_group_members()
    return {
        "contacts.json": contacts,
        "conversation-contacts.json": {
            "version": 3,
            "contact_ids": [contact["id"] for contact in contacts],
            "preview_ids": preview_ids,
            "pinned_ids": [],
        },
        "groups.json": {
            "version": 1,
            "id_start": 9200,
            "groups": [],
            "builtin_members": group_members,
        },
        "bubble-themes.json": normalize_bubble_themes(),
        "sticker-categories.json": normalize_sticker_categories(),
        "character-profiles.json": normalize_character_profiles(),
        "asset-index.json": normalize_assets(),
    }


def build(output_dir: Path, *, clean: bool = True) -> dict:
    """生成静态数据并返回 manifest。"""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    if clean:
        clear_known_outputs(output_dir)

    entries = []
    payloads = build_payloads()
    for name, payload in payloads.items():
        entries.append(write_json_file(output_dir / name, payload))

    manifest = {
        "manifest_version": MANIFEST_VERSION,
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "generator": "webui/tools/build_static_data.py",
        "files": entries,
        "total_files": len(entries),
        "total_size": sum(entry["size"] for entry in entries),
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest


def parse_args(argv: list[str]) -> argparse.Namespace:
    """解析命令行参数。"""
    parser = argparse.ArgumentParser(description="Build MimirTalk static data bundle.")
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"输出目录，默认 {DEFAULT_OUTPUT_DIR}",
    )
    parser.add_argument(
        "--keep",
        action="store_true",
        help="保留输出目录中的已有文件，不做清空重建",
    )
    parser.add_argument("--json", action="store_true", help="输出机器可读 manifest")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """命令行入口。"""
    args = parse_args(argv or sys.argv[1:])
    try:
        manifest = build(args.output, clean=not args.keep)
    except ValueError as exc:
        print(f"[FAIL] {exc}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(manifest, ensure_ascii=False, indent=2))
    else:
        print(f"[OK] static data -> {args.output}")
        print(f"     files={manifest['total_files']} size={manifest['total_size']} bytes")
        for entry in manifest["files"]:
            print(f"     {entry['path']}  {entry['sha256'][:12]}  {entry['size']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
