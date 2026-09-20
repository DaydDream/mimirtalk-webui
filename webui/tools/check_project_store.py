"""验证项目格式、旧数据迁移、保存重载、路径安全和删除。"""
from __future__ import annotations

import json
import os
import sys
import stat
import tempfile
from pathlib import Path


WEBUI_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WEBUI_DIR))

from backend.project_store import (  # noqa: E402
    DEFAULT_BACKGROUND_ASSET_ID,
    ProjectStore,
    ProjectValidationError,
    normalize_project,
)


def expect_validation_error(callback, label: str):
    """断言指定操作抛出项目校验错误。"""
    try:
        callback()
    except ProjectValidationError:
        return
    raise AssertionError(f"Expected ProjectValidationError: {label}")


def main() -> int:
    """命令行主入口。"""
    legacy_project = {
        "title": "未命名会话",
        "contact": {
            "name": "测试角色",
            "avatar": "character_icon:1001",
            "contact_id": 1017,
            "kind": "hero",
            "member_ids": [],
        },
        "appearance": {"background": "backgrounds:momotalk_01", "read": False},
        "messages": [
            {
                "type": "text",
                "side": "left",
                "text": "你好",
                "delay": 600,
                "speaker_id": 1017,
                "speaker_name": "测试角色",
                "speaker_asset_id": "character_icon:1001",
            },
            {
                "type": "image",
                "side": "right",
                "file_id": "0123456789abcdef0123456789abcdef.png",
                "name": "legacy.png",
                "width": 128,
                "height": 96,
            },
            {
                "type": "sticker",
                "side": "right",
                "asset": "chat_stickers:10001",
            },
            {"type": "choice", "prompt": "继续吗？", "options": ["继续", "离开"]},
            {"type": "system", "text": "对方正在输入"},
            {"type": "recall", "text": "对方撤回了一条消息"},
            {"type": "text", "side": "left", "text": "   "},
            {
                "type": "moment",
                "author": "测试角色",
                "text": "今天的记录",
                "asset_ids": ["momotalk_images:9001"],
                "likes": 3,
                "comments": [{"name": "管理员", "text": "收到"}],
            },
        ],
    }

    normalized = normalize_project(legacy_project, project_id="project_legacy")
    message_types = {message["type"] for message in normalized["messages"]}
    expected_types = {
        "text",
        "sticker",
        "image",
        "system",
        "recall",
    }
    if message_types != expected_types:
        raise AssertionError(f"Unexpected message types: {message_types}")
    if len(normalized["messages"]) != 5:
        raise AssertionError(
            f"Legacy choice/moment messages were not dropped: {normalized['messages']}"
        )
    if normalized["contact"]["avatar_asset_id"] != "character_icon:1001":
        raise AssertionError("Legacy contact avatar was not migrated")
    if normalized["contact"]["contact_id"] != 1017:
        raise AssertionError("Contact id was not preserved")
    if normalized["contact"]["kind"] != "hero":
        raise AssertionError("Contact kind was not preserved")
    if normalized["contact"]["member_ids"] != []:
        raise AssertionError("Contact member ids were not preserved")
    if normalized["appearance"]["background_asset_id"] != DEFAULT_BACKGROUND_ASSET_ID:
        raise AssertionError("Legacy background was not migrated to Momotalk_04")
    if normalized["appearance"]["admin_avatar_asset_id"] is not None:
        raise AssertionError("Missing legacy admin avatar should normalize to null")
    if normalized["title"] != "未命名项目":
        raise AssertionError("Legacy default title was not migrated")
    if any("delay_ms" in message or "delay" in message for message in normalized["messages"]):
        raise AssertionError("Legacy delay fields were not removed")
    if normalized["messages"][0]["speaker_id"] != 1017:
        raise AssertionError("Message speaker id was not preserved")
    if normalized["messages"][0]["speaker_name"] != "测试角色":
        raise AssertionError("Message speaker name was not preserved")
    if normalized["messages"][0]["speaker_asset_id"] != "character_icon:1001":
        raise AssertionError("Message speaker asset was not preserved")
    if normalized["active_conversation_id"] != "1017":
        raise AssertionError("Legacy project did not migrate to a contact conversation")
    if normalized["conversations"].get("1017") != normalized["messages"]:
        raise AssertionError("Legacy messages were not copied into conversations")

    group_project = normalize_project(
        {
            "version": 1,
            "id": "project_group",
            "title": "群聊测试",
            "contact": {
                "name": "漫画同好会",
                "avatar_asset_id": "momotalk_images:textureconfig_momotalk_9010:9010",
                "contact_id": 9010,
                "kind": "group",
                "member_ids": [1017, 1020],
            },
            "appearance": {
                "background_asset_id": None,
                "admin_avatar_asset_id": "momotalk_images:admin_head_02",
                "read": True,
            },
            "messages": [
                {
                    "type": "text",
                    "side": "left",
                    "text": "群聊消息",
                    "speaker_id": 1020,
                    "speaker_name": "测试发言人",
                    "speaker_asset_id": "character_icon:1020",
                }
            ],
        }
    )
    if group_project["contact"]["kind"] != "group":
        raise AssertionError("Group contact kind was not preserved")
    if group_project["contact"]["member_ids"] != [1017, 1020]:
        raise AssertionError("Group member ids were not preserved")
    if group_project["messages"][0]["speaker_name"] != "测试发言人":
        raise AssertionError("Group message speaker was not preserved")
    if group_project["appearance"]["admin_avatar_asset_id"] != "momotalk_images:admin_head_02":
        raise AssertionError("Administrator avatar was not preserved")
    if group_project["appearance"]["background_asset_id"] != DEFAULT_BACKGROUND_ASSET_ID:
        raise AssertionError("Null background was not normalized to Momotalk_04")

    multi_conversation_project = normalize_project(
        {
            "version": 1,
            "id": "project_multi",
            "title": "多会话测试",
            "contact": {
                "name": "当前角色",
                "contact_id": 42,
                "kind": "hero",
            },
            "messages": [
                {
                    "id": "msg_multi",
                    "type": "text",
                    "side": "right",
                    "text": "新会话",
                }
            ],
            "active_conversation_id": "99",
            "conversations": {
                "42": [
                    {
                        "id": "msg_old",
                        "type": "text",
                        "side": "left",
                        "text": "旧会话",
                    }
                ],
                "99": [
                    {
                        "id": "msg_multi",
                        "type": "text",
                        "side": "right",
                        "text": "新会话",
                    },
                    {"id": "msg_blank", "type": "text", "side": "left", "text": " \n "},
                ],
            },
        }
    )
    if multi_conversation_project["messages"] != multi_conversation_project["conversations"]["99"]:
        raise AssertionError("Active conversation was not mirrored to messages")
    if len(multi_conversation_project["conversations"]["99"]) != 1:
        raise AssertionError("Blank conversation messages were not dropped")
    if len(multi_conversation_project["conversations"]["42"]) != 1:
        raise AssertionError("Inactive conversation messages were not preserved")

    with tempfile.TemporaryDirectory() as temporary:
        store = ProjectStore(Path(temporary) / "projects")
        saved = store.save_project(normalized)
        loaded = store.load_project(saved["id"])
        if loaded != saved:
            raise AssertionError("Save/load round trip changed the project")
        summaries = store.list_projects()
        if len(summaries) != 1:
            raise AssertionError(f"Unexpected project summaries: {summaries}")
        if len(store.load_project(summaries[0]["id"])["messages"]) != 5:
            raise AssertionError(f"Unexpected project message count: {summaries}")

        created = store.create_project(
            title="新建会话",
            contact_name="新角色",
            project_id="project_created",
        )
        if created["version"] != 1 or created["id"] != "project_created":
            raise AssertionError("create_project returned an invalid project")
        if created["appearance"]["background_asset_id"] != DEFAULT_BACKGROUND_ASSET_ID:
            raise AssertionError("create_project did not use the default chat background")
        if created["active_conversation_id"] not in created["conversations"]:
            raise AssertionError("create_project did not initialize conversations")

        project_dir = Path(temporary) / "projects" / "project_created"
        os.chmod(project_dir, stat.S_IREAD)
        store.delete_project("project_created")
        if project_dir.exists():
            raise AssertionError("delete_project left the project directory behind")
        try:
            store.load_project("project_created")
        except FileNotFoundError:
            pass
        else:
            raise AssertionError("delete_project did not remove the project")

        expect_validation_error(
            lambda: store.load_project("../escape"),
            "path traversal",
        )
        expect_validation_error(
            lambda: normalize_project({"version": 99, "messages": []}),
            "unsupported version",
        )
        expect_validation_error(
            lambda: normalize_project(
                {
                    "version": 1,
                    "messages": [{"type": "sticker", "side": "right"}],
                }
            ),
            "missing sticker asset",
        )
        expect_validation_error(
            lambda: normalize_project(
                {
                    "version": 1,
                    "messages": [
                        {
                            "type": "image",
                            "side": "right",
                            "file_id": "not-an-upload",
                            "name": "bad.png",
                            "width": 1,
                            "height": 1,
                        }
                    ],
                }
            ),
            "invalid image file id",
        )

        expect_validation_error(
            lambda: normalize_project(
                {
                    "version": 1,
                    "conversations": [],
                    "messages": [],
                }
            ),
            "invalid conversations container",
        )
        expect_validation_error(
            lambda: normalize_project(
                {
                    "version": 1,
                    "messages": [
                        {"id": "same", "type": "text", "text": "a"},
                        {"id": "same", "type": "text", "text": "b"},
                    ],
                }
            ),
            "duplicate message ids",
        )
        expect_validation_error(
            lambda: normalize_project(
                {
                    "version": 1,
                    "contact": {"kind": "channel"},
                    "messages": [],
                }
            ),
            "unsupported contact kind",
        )
        expect_validation_error(
            lambda: normalize_project(
                {
                    "version": 1,
                    "contact": {"kind": "group", "member_ids": ["not-an-int"]},
                    "messages": [],
                }
            ),
            "invalid group member ids",
        )
        expect_validation_error(
            lambda: normalize_project(
                {
                    "version": 1,
                    "messages": [
                        {
                            "type": "text",
                            "text": "bad speaker",
                            "speaker_id": "not-an-int",
                        }
                    ],
                }
            ),
            "invalid speaker id",
        )

    result = {
        "version": normalized["version"],
        "message_types": sorted(message_types),
        "message_count": len(normalized["messages"]),
        "legacy_migration": True,
        "legacy_moment_dropped": True,
        "legacy_choice_dropped": True,
        "legacy_delay_removed": True,
        "static_image_supported": True,
        "contact_metadata": True,
        "message_speaker_metadata": True,
        "group_contact_metadata": True,
        "multi_conversation": True,
        "blank_message_filter": True,
        "active_message_mirror": True,
        "save_load_round_trip": True,
        "project_delete": True,
        "path_traversal_rejected": True,
        "invalid_projects_rejected": True,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
