"""项目存储模块：负责项目 JSON 规范化、旧数据迁移、保存、读取、列表和删除。"""
from __future__ import annotations

import copy
import json
import os
import re
import shutil
import stat
import uuid
from pathlib import Path
from typing import Any


CURRENT_PROJECT_VERSION = 1
DEFAULT_PROJECT_TITLE = "未命名项目"
DEFAULT_BACKGROUND_ASSET_ID = "backgrounds:texturebg_momotalk_momotalk_04:Momotalk_04"
ALLOWED_BACKGROUND_ASSET_IDS = {
    "backgrounds:texturebg_momotalk_momotalk_03:Momotalk_03",
    DEFAULT_BACKGROUND_ASSET_ID,
}
SIDED_MESSAGE_TYPES = {"text", "sticker", "image"}
MESSAGE_TYPES = {
    "text",
    "sticker",
    "image",
    "system",
    "recall",
}
LEGACY_UNSUPPORTED_MESSAGE_TYPES = {"choice", "moment"}


class ProjectValidationError(ValueError):
    """项目数据校验异常。"""
    pass


def new_id(prefix: str) -> str:
    """生成带指定前缀的短随机 ID。"""
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _require_dict(value: Any, path: str) -> dict:
    """校验并返回指定类型的数据。"""
    if not isinstance(value, dict):
        raise ProjectValidationError(f"{path} must be an object")
    return value


def _require_list(value: Any, path: str) -> list:
    """校验并返回指定类型的数据。"""
    if not isinstance(value, list):
        raise ProjectValidationError(f"{path} must be an array")
    return value


def _require_string(value: Any, path: str, allow_empty: bool = True) -> str:
    """校验并返回指定类型的数据。"""
    if not isinstance(value, str):
        raise ProjectValidationError(f"{path} must be a string")
    if not allow_empty and not value.strip():
        raise ProjectValidationError(f"{path} must not be empty")
    return value


def _optional_string(value: Any, path: str) -> str | None:
    """解析可选字段。"""
    if value is None:
        return None
    return _require_string(value, path)


def _normalize_background_asset_id(value: Any, path: str) -> str:
    """规范化相关字段。"""
    normalized = _optional_string(value, path)
    if not normalized or normalized not in ALLOWED_BACKGROUND_ASSET_IDS:
        return DEFAULT_BACKGROUND_ASSET_ID
    return normalized


def _optional_integer(value: Any, path: str) -> int | None:
    """解析可选字段。"""
    if value is None:
        return None
    return _require_integer(value, path)


def _require_integer(value: Any, path: str) -> int:
    """校验并返回指定类型的数据。"""
    if isinstance(value, bool) or not isinstance(value, int):
        raise ProjectValidationError(f"{path} must be an integer")
    return value


def _normalize_speaker_fields(message: dict, path: str) -> None:
    """规范化相关字段。"""
    if "speaker_id" in message:
        message["speaker_id"] = _optional_integer(
            message.get("speaker_id"),
            f"{path}.speaker_id",
        )
    if "speaker_name" in message:
        message["speaker_name"] = _require_string(
            message.get("speaker_name", ""),
            f"{path}.speaker_name",
        )
    if "speaker_asset_id" in message:
        message["speaker_asset_id"] = _optional_string(
            message.get("speaker_asset_id"),
            f"{path}.speaker_asset_id",
        )


def _normalize_message(raw: Any, index: int, path_prefix: str = "messages") -> dict:
    """规范化相关字段。"""
    path = f"{path_prefix}[{index}]"
    message = copy.deepcopy(_require_dict(raw, path))
    message_type = _require_string(message.get("type"), f"{path}.type", allow_empty=False)
    if message_type not in MESSAGE_TYPES:
        raise ProjectValidationError(f"{path}.type is not supported: {message_type}")

    message["id"] = message.get("id") or new_id("msg")
    message["id"] = _require_string(message["id"], f"{path}.id", allow_empty=False)
    message["type"] = message_type
    message.pop("delay_ms", None)
    message.pop("delay", None)

    if message_type in SIDED_MESSAGE_TYPES:
        side = message.get("side", "left")
        if side not in {"left", "right"}:
            raise ProjectValidationError(f"{path}.side must be left or right")
        message["side"] = side
    else:
        message["side"] = "center"

    if message_type == "text":
        message["text"] = _require_string(message.get("text", ""), f"{path}.text")
    elif message_type == "sticker":
        asset_id = message.get("asset_id", message.get("asset"))
        message["asset_id"] = _require_string(
            asset_id,
            f"{path}.asset_id",
            allow_empty=False,
        )
        message.pop("asset", None)
    elif message_type == "image":
        file_id = _require_string(message.get("file_id"), f"{path}.file_id", allow_empty=False)
        if not re.fullmatch(r"[0-9a-f]{32}\.(?:png|jpg|jpeg)", file_id):
            raise ProjectValidationError(f"{path}.file_id is not a supported static image")
        message["file_id"] = file_id
        message["name"] = _require_string(message.get("name", "image"), f"{path}.name")
        for dimension in ("width", "height"):
            value = _require_integer(message.get(dimension), f"{path}.{dimension}")
            if value <= 0:
                raise ProjectValidationError(f"{path}.{dimension} must be positive")
            message[dimension] = value
    elif message_type == "system":
        message["text"] = _require_string(message.get("text", ""), f"{path}.text")
    elif message_type == "recall":
        message["text"] = _require_string(
            message.get("text", "对方撤回了一条消息"),
            f"{path}.text",
        )

    _normalize_speaker_fields(message, path)
    return message


def _conversation_key_for_contact(contact: dict) -> str:
    """为角色或群组生成稳定的会话键。"""
    contact_id = contact.get("contact_id")
    if contact_id is not None:
        return str(contact_id)
    return f"{contact.get('kind', 'hero')}:{contact.get('name', '角色名')}"


def _normalize_messages(raw: Any, path: str) -> list[dict]:
    """规范化相关字段。"""
    raw_messages = _require_list(raw, path)
    messages = []
    for index, message in enumerate(raw_messages):
        if (
            isinstance(message, dict)
            and message.get("type") in LEGACY_UNSUPPORTED_MESSAGE_TYPES
        ):
            continue
        normalized = _normalize_message(message, index, path)
        if normalized["type"] == "text" and not normalized["text"].strip():
            continue
        messages.append(normalized)
    return messages


def _message_ids_are_unique(messages: list[dict], path: str) -> bool:
    """检查消息 ID 在给定范围内是否唯一。"""
    message_ids = [message["id"] for message in messages]
    return len(message_ids) == len(set(message_ids))


def normalize_project(
    raw: dict,
    project_id: str | None = None,
) -> dict:
    """规范化输入数据并补齐默认值。"""
    project = copy.deepcopy(_require_dict(raw, "project"))
    version = project.get("version", CURRENT_PROJECT_VERSION)
    if isinstance(version, str) and version.isdigit():
        version = int(version)
    if version != CURRENT_PROJECT_VERSION:
        raise ProjectValidationError(
            f"Unsupported project version: {version!r}; "
            f"current version is {CURRENT_PROJECT_VERSION}"
        )

    project["version"] = CURRENT_PROJECT_VERSION
    project["id"] = project.get("id") or project_id or new_id("project")
    project["id"] = _require_string(project["id"], "id", allow_empty=False)
    title = _require_string(
        project.get("title", DEFAULT_PROJECT_TITLE),
        "title",
    )
    if title == "未命名会话":
        title = DEFAULT_PROJECT_TITLE
    project["title"] = title

    contact = copy.deepcopy(_require_dict(project.get("contact", {}), "contact"))
    contact["name"] = _require_string(contact.get("name", "角色名"), "contact.name")
    avatar_id = contact.get("avatar_asset_id", contact.get("avatar"))
    contact["avatar_asset_id"] = _optional_string(
        avatar_id,
        "contact.avatar_asset_id",
    )
    contact.pop("avatar", None)
    contact["signature"] = _require_string(
        contact.get("signature", ""),
        "contact.signature",
    )
    contact["contact_id"] = _optional_integer(
        contact.get("contact_id"),
        "contact.contact_id",
    )
    kind = contact.get("kind", "hero")
    if kind not in {"hero", "group"}:
        raise ProjectValidationError("contact.kind must be hero or group")
    contact["kind"] = kind
    member_ids = contact.get("member_ids", [])
    if not isinstance(member_ids, list):
        raise ProjectValidationError("contact.member_ids must be an array")
    contact["member_ids"] = [
        _require_integer(value, f"contact.member_ids[{index}]")
        for index, value in enumerate(member_ids)
    ]
    project["contact"] = contact

    appearance = copy.deepcopy(
        _require_dict(project.get("appearance", {}), "appearance")
    )
    background_id = appearance.get(
        "background_asset_id",
        appearance.get("background"),
    )
    appearance["background_asset_id"] = _normalize_background_asset_id(
        background_id,
        "appearance.background_asset_id",
    )
    appearance.pop("background", None)
    appearance["admin_avatar_asset_id"] = _optional_string(
        appearance.get("admin_avatar_asset_id"),
        "appearance.admin_avatar_asset_id",
    )
    read = appearance.get("read", True)
    if not isinstance(read, bool):
        raise ProjectValidationError("appearance.read must be a boolean")
    appearance["read"] = read
    project["appearance"] = appearance

    messages_provided = "messages" in project
    messages = _normalize_messages(project.get("messages", []), "messages")
    if not _message_ids_are_unique(messages, "messages"):
        raise ProjectValidationError("message IDs must be unique")

    conversations: dict[str, list[dict]] = {}
    raw_conversations = project.get("conversations")
    if raw_conversations is not None:
        raw_conversations = _require_dict(raw_conversations, "conversations")
        for raw_key, raw_messages in raw_conversations.items():
            if not isinstance(raw_key, str) or not raw_key:
                raise ProjectValidationError("conversation keys must be non-empty strings")
            normalized_messages = _normalize_messages(
                raw_messages,
                f"conversations[{raw_key!r}]",
            )
            if not _message_ids_are_unique(normalized_messages, f"conversations[{raw_key!r}]"):
                raise ProjectValidationError("message IDs must be unique within each conversation")
            conversations[raw_key] = normalized_messages

    contact_key = _conversation_key_for_contact(contact)
    raw_active_id = project.get("active_conversation_id")
    active_id = None
    if raw_active_id is not None:
        active_id = _require_string(
            raw_active_id,
            "active_conversation_id",
            allow_empty=False,
        )

    if not conversations:
        conversations[contact_key] = messages
        active_id = contact_key
    else:
        if active_id is None:
            active_id = contact_key if contact_key in conversations else next(iter(conversations))
        if active_id not in conversations:
            conversations[active_id] = []
        # The API keeps messages as the active conversation mirror. Treat a
        # non-empty messages payload as authoritative so simple clients can
        # append messages without rebuilding the conversations map.
        if messages_provided and (messages or not conversations[active_id]):
            conversations[active_id] = messages

    project["conversations"] = conversations
    project["active_conversation_id"] = active_id
    project["messages"] = conversations[active_id]
    return project


def _remove_readonly(function, path, exception):
    """删除只读或 OneDrive 同步目录时清除只读属性并重试。"""
    if not isinstance(exception, PermissionError):
        raise exception
    os.chmod(path, stat.S_IWRITE)
    function(path)


class ProjectStore:
    """项目文件存储：负责项目目录定位、规范化、保存、读取和删除。"""
    def __init__(self, projects_dir: Path):
        self.projects_dir = Path(projects_dir)

    @staticmethod
    def _valid_project_id(project_id: str) -> bool:
        """校验项目 ID 是否安全且不包含路径分隔符。"""
        if not project_id or project_id in {".", ".."}:
            return False
        if any(separator in project_id for separator in ("/", "\\", ":")):
            return False
        return Path(project_id).name == project_id

    def _project_dir(self, project_id: str) -> Path:
        """返回并校验项目目录路径。"""
        if not self._valid_project_id(project_id):
            raise ProjectValidationError(f"Invalid project id: {project_id!r}")
        return self.projects_dir / project_id

    def _project_path(self, project_id: str) -> Path:
        """返回项目的 project.json 路径。"""
        return self._project_dir(project_id) / "project.json"

    def create_project(
        self,
        title: str = DEFAULT_PROJECT_TITLE,
        contact_name: str = "角色名",
        project_id: str | None = None,
    ) -> dict:
        """创建并返回目标对象。"""
        project = normalize_project(
            {
                "version": CURRENT_PROJECT_VERSION,
                "title": title,
                "contact": {"name": contact_name},
                "appearance": {
                    "background_asset_id": DEFAULT_BACKGROUND_ASSET_ID,
                    "read": True,
                },
                "messages": [],
            },
            project_id=project_id or new_id("project"),
        )
        return self.save_project(project)

    def load_project(self, project_id: str) -> dict:
        """加载project数据。"""
        path = self._project_path(project_id)
        if not path.is_file():
            raise FileNotFoundError(f"Project not found: {project_id}")
        raw = json.loads(path.read_text(encoding="utf-8"))
        return normalize_project(raw, project_id=project_id)

    def save_project(self, project: dict) -> dict:
        """规范化项目并通过临时文件原子保存 project.json。"""
        normalized = normalize_project(project)
        project_id = normalized["id"]
        project_dir = self._project_dir(project_id)
        project_dir.mkdir(parents=True, exist_ok=True)
        path = project_dir / "project.json"
        temporary = project_dir / "project.json.tmp"
        temporary.write_text(
            json.dumps(normalized, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        temporary.replace(path)
        return normalized

    def delete_project(self, project_id: str) -> None:
        """删除项目目录，并兼容 Windows OneDrive 只读属性。"""
        path = self._project_path(project_id)
        if not path.is_file():
            raise FileNotFoundError(f"Project not found: {project_id}")
        shutil.rmtree(path.parent, onexc=_remove_readonly)

    def list_projects(self) -> list[dict]:
        """读取所有有效项目并生成侧栏摘要。"""
        if not self.projects_dir.is_dir():
            return []
        summaries = []
        for path in sorted(self.projects_dir.glob("*/project.json")):
            try:
                project = self.load_project(path.parent.name)
            except (OSError, json.JSONDecodeError, ProjectValidationError):
                continue
            summaries.append(
                {
                    "id": project["id"],
                    "title": project["title"],
                    "contact_name": project["contact"]["name"],
                    "contact_id": project["contact"].get("contact_id"),
                    "contact_kind": project["contact"].get("kind", "hero"),
                }
            )
        return summaries
