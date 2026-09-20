"""校验联系人 ID、头像资源和名称映射的一致性。"""
from __future__ import annotations

import json
import sys
from pathlib import Path


WORKSPACE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = WORKSPACE_DIR / "mimirtalk_webui" / "data"


def load(name: str):
    """加载并返回指定数据。"""
    path = DATA_DIR / name
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    """命令行主入口。"""
    contacts_doc = load("chat_contacts.json")
    names_doc = load("asset_names.json")
    index = load("asset_index.json")
    valid_ids = {asset["id"] for asset in index["assets"]}

    problems = []
    contacts = contacts_doc["contacts"]
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

    for contact in contacts:
        asset_id = contact.get("asset_id")
        if asset_id is not None and asset_id not in valid_ids:
            problems.append(f"联系人 {contact['id']} 的 asset_id 不在资源索引中: {asset_id}")
        if contact["kind"] == "group" and asset_id is None:
            problems.append(f"群组 {contact['id']} 缺少头像")

    missing = sorted(c["id"] for c in heroes if c["asset_id"] is None)

    library = names_doc["assets"]
    # 变体命名规则：六位数资源名按「基础ID * 100 + 变体号」解释，
    # 不能把 101701（1017 的变体）误判成 10170（望舒）。
    hero_names_by_id = {int(c["id"]): c.get("name") for c in heroes}
    for asset_id, record in library.items():
        base_id = record.get("base_id")
        name = record.get("name")
        if base_id is None or name is None:
            continue
        expected = hero_names_by_id.get(int(base_id))
        if expected is not None and expected != name:
            problems.append(f"{asset_id} 的名称 {name} 与基础角色 {base_id} 的 {expected} 不一致")
    for asset_id in library:
        if asset_id not in valid_ids:
            problems.append(f"通用库条目不在资源索引中: {asset_id}")

    if problems:
        for problem in problems:
            print(f"[FAIL] {problem}")
        return 1

    named = sum(1 for record in library.values() if record.get("name"))
    print(
        f"[OK] contacts={len(contacts)} hero={len(heroes)} group={len(groups)} "
        f"library={len(library)} named={named} missing_avatar={missing}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
