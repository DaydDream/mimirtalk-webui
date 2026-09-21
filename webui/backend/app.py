"""MimirTalk WebUI 本地 HTTP 服务：提供联系人、素材、项目、群聊、上传、气泡主题和关闭接口。"""
from __future__ import annotations

import argparse
import sys
import json
import mimetypes
import threading
import traceback
import uuid
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

# 嵌入式 Python 处于隔离模式，不会自动把脚本所在目录加入 sys.path，这里显式补上。
_PACKAGE_DIR = str(Path(__file__).resolve().parent)
if _PACKAGE_DIR not in sys.path:
    sys.path.insert(0, _PACKAGE_DIR)

from asset_index import AssetIndex
from project_store import DEFAULT_PROJECT_TITLE, ProjectStore, ProjectValidationError


WEBUI_DIR = Path(__file__).resolve().parents[1]
WORKSPACE_DIR = WEBUI_DIR.parent
DEFAULT_PROJECTS_DIR = WEBUI_DIR / "data" / "projects"
DEFAULT_FRONTEND_DIR = WEBUI_DIR / "frontend"
DEFAULT_STICKER_CATEGORIES_PATH = WEBUI_DIR / "data" / "sticker_categories.json"
DEFAULT_CHAT_CONTACTS_PATH = WEBUI_DIR / "data" / "chat_contacts.json"
DEFAULT_GROUP_MEMBERS_PATH = WEBUI_DIR / "data" / "group_members.json"
DEFAULT_CUSTOM_GROUPS_PATH = WEBUI_DIR / "data" / "custom_groups.json"
DEFAULT_UPLOADS_DIR = WEBUI_DIR / "data" / "uploads"
CUSTOM_GROUP_ID_START = 9200
MIN_GROUP_MEMBERS = 2
MAX_STATIC_IMAGE_BYTES = 8 * 1024 * 1024
STATIC_IMAGE_FORMATS = {
    "image/png": (".png", b"\x89PNG\r\n\x1a\n"),
    "image/jpeg": (".jpg", b"\xff\xd8\xff"),
    "image/jpg": (".jpg", b"\xff\xd8\xff"),
}


class Application:
    """应用服务容器：加载配置和素材索引，并管理联系人、群组、项目、贴纸和上传操作。"""
    def __init__(
        self,
        workspace_dir: Path = WORKSPACE_DIR,
        projects_dir: Path = DEFAULT_PROJECTS_DIR,
        index_path: Path | None = None,
        frontend_dir: Path = DEFAULT_FRONTEND_DIR,
        chat_contacts_path: Path = DEFAULT_CHAT_CONTACTS_PATH,
        group_members_path: Path = DEFAULT_GROUP_MEMBERS_PATH,
        custom_groups_path: Path = DEFAULT_CUSTOM_GROUPS_PATH,
        uploads_dir: Path = DEFAULT_UPLOADS_DIR,
        bubble_themes_path: Path | None = None,
    ):
        self.workspace_dir = Path(workspace_dir)
        self.frontend_dir = Path(frontend_dir)
        self.index = AssetIndex(
            index_path=index_path or WEBUI_DIR / "data" / "asset_index.json",
            workspace_dir=self.workspace_dir,
        )
        self.store = ProjectStore(projects_dir)
        self.sticker_categories_path = DEFAULT_STICKER_CATEGORIES_PATH
        self.chat_contacts_path = Path(chat_contacts_path)
        self.group_members_path = Path(group_members_path)
        self.custom_groups_path = Path(custom_groups_path)
        self.uploads_dir = Path(uploads_dir)
        self.bubble_themes_path = Path(
            bubble_themes_path
            or WEBUI_DIR / "data" / "bubble_themes.json"
        )
        self.index.load()
        self._load_sticker_categories()

    def _load_sticker_categories(self):
        """加载并返回目标配置。"""
        payload = json.loads(self.sticker_categories_path.read_text(encoding="utf-8"))
        categories = payload.get("categories", [])
        if not isinstance(categories, list) or not categories:
            raise ValueError("sticker_categories.json must contain a non-empty categories array")
        self.sticker_catalog = payload
        self.sticker_categories_by_id = {
            str(category.get("id")): category
            for category in categories
            if isinstance(category, dict) and category.get("id") is not None
        }

    def _load_json_object(self, path: Path) -> dict:
        """加载并返回目标配置。"""
        if not path.is_file():
            return {}
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise ValueError(f"{path.name} must contain an object")
        return payload

    def _load_contact_catalog(self) -> list[dict]:
        """加载并返回目标配置。"""
        payload = self._load_json_object(self.chat_contacts_path)
        contacts = payload.get("contacts", [])
        if not isinstance(contacts, list):
            raise ValueError("chat_contacts.json contacts must be an array")
        return contacts

    def _load_group_members(self) -> dict[int, list[int]]:
        """加载并返回目标配置。"""
        payload = self._load_json_object(self.group_members_path)
        groups = payload.get("groups", {})
        if not isinstance(groups, dict):
            raise ValueError("group_members.json groups must be an object")
        result: dict[int, list[int]] = {}
        for raw_group_id, raw_member_ids in groups.items():
            if not isinstance(raw_member_ids, list):
                raise ValueError(f"group_members.json group {raw_group_id} must be an array")
            try:
                group_id = int(raw_group_id)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"group_members.json group id must be an integer: {raw_group_id}") from exc
            members = []
            for raw_member_id in raw_member_ids:
                if isinstance(raw_member_id, bool) or not isinstance(raw_member_id, int):
                    raise ValueError(
                        f"group_members.json group {raw_group_id} member id must be an integer"
                    )
                if raw_member_id not in members:
                    members.append(raw_member_id)
            result[group_id] = members
        return result

    def _load_group_name_overrides(self) -> dict[int, str]:
        """加载并返回目标配置。"""
        payload = self._load_json_object(self.group_members_path)
        names = payload.get("group_names", {})
        if not isinstance(names, dict):
            raise ValueError("group_members.json group_names must be an object")
        result: dict[int, str] = {}
        for raw_group_id, raw_name in names.items():
            try:
                group_id = int(raw_group_id)
            except (TypeError, ValueError) as exc:
                raise ValueError(
                    f"group_members.json group_names key must be an integer: {raw_group_id}"
                ) from exc
            if not isinstance(raw_name, str) or not raw_name.strip():
                raise ValueError(
                    f"group_members.json group_names[{raw_group_id}] must be a non-empty string"
                )
            result[group_id] = raw_name.strip()
        return result

    def _load_deleted_builtin_group_ids(self) -> set[int]:
        """加载并返回目标配置。"""
        payload = self._load_json_object(self.group_members_path)
        values = payload.get("deleted_group_ids", [])
        if not isinstance(values, list):
            raise ValueError("group_members.json deleted_group_ids must be an array")
        deleted: set[int] = set()
        for index, value in enumerate(values):
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValueError(
                    f"group_members.json deleted_group_ids[{index}] must be an integer"
                )
            deleted.add(value)
        return deleted

    def _write_group_members(
        self,
        groups: dict[int, list[int]],
        deleted_ids: set[int],
        group_names: dict[int, str] | None = None,
    ) -> None:
        """将数据写入目标文件。"""
        if group_names is None:
            group_names = self._load_group_name_overrides()
        payload = self._load_json_object(self.group_members_path)
        payload["version"] = 1
        payload["groups"] = {
            str(group_id): member_ids
            for group_id, member_ids in sorted(groups.items())
        }
        if group_names:
            payload["group_names"] = {
                str(group_id): name
                for group_id, name in sorted(group_names.items())
            }
        else:
            payload.pop("group_names", None)
        if deleted_ids:
            payload["deleted_group_ids"] = sorted(deleted_ids)
        else:
            payload.pop("deleted_group_ids", None)
        self.group_members_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.group_members_path.with_suffix(".json.tmp")
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        temporary.replace(self.group_members_path)

    def _write_custom_groups(self, groups: list[dict]) -> None:
        """将数据写入目标文件。"""
        self.custom_groups_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.custom_groups_path.with_suffix(".json.tmp")
        temporary.write_text(
            json.dumps(
                {
                    "version": 1,
                    "id_start": CUSTOM_GROUP_ID_START,
                    "groups": groups,
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        temporary.replace(self.custom_groups_path)

    def _load_custom_groups(self) -> list[dict]:
        """加载并返回目标配置。"""
        payload = self._load_json_object(self.custom_groups_path)
        groups = payload.get("groups", [])
        if not isinstance(groups, list):
            raise ValueError("custom_groups.json groups must be an array")
        result = []
        for item in groups:
            if not isinstance(item, dict):
                raise ValueError("custom_groups.json group entries must be objects")
            result.append(item)
        return result

    @staticmethod
    def _normalize_member_ids(value, context: str) -> list[int]:
        """规范化相关字段。"""
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError(f"{context} must be an array")
        member_ids: list[int] = []
        for index, item in enumerate(value):
            if isinstance(item, bool) or not isinstance(item, int):
                raise ValueError(f"{context}[{index}] must be an integer")
            if item not in member_ids:
                member_ids.append(item)
        return member_ids

    @staticmethod
    def _public_group_name(name: str) -> str:
        """生成群组公开显示名：没有中文时回退为“群”。"""
        return name if any("\u4e00" <= char <= "\u9fff" for char in name) else "群"

    def bubble_themes(self) -> dict:
        """\u53ef\u9009\u6c14\u6ce1\u4e3b\u9898\u6e05\u5355\uff08\u542b\u5de6/\u53f3\u53d8\u4f53\u4e0e 9-slice \u53c2\u6570\uff09\u3002"""
        payload = self._load_json_object(self.bubble_themes_path)
        available = payload.get("available_themes") or {}
        themes = available.get("themes") or []
        default_id = available.get("default_theme") or (themes[0]["id"] if themes else "")
        return {
            "default_theme": default_id,
            "count": len(themes),
            "slice_rule": available.get("slice_rule", ""),
            "themes": themes,
        }

    def list_contacts(self) -> list[dict]:
        """加载角色、内置群和自定义群，返回启用且未删除的联系人列表。"""
        contacts = self._load_contact_catalog()
        group_members = self._load_group_members()
        group_name_overrides = self._load_group_name_overrides()
        deleted_builtin_group_ids = self._load_deleted_builtin_group_ids()
        custom_groups = self._load_custom_groups()
        enabled = []
        for contact in contacts:
            if not isinstance(contact, dict) or not contact.get("enabled", True):
                continue
            contact_id = contact.get("id")
            kind = contact.get("kind", "hero")
            if kind == "group" and contact_id in deleted_builtin_group_ids:
                continue
            member_ids = group_members.get(contact_id, []) if isinstance(contact_id, int) else []
            enabled.append(
                {
                    "id": contact_id,
                    "name": group_name_overrides.get(contact_id, contact.get("name", "")),
                    "kind": kind,
                    "game_icon_path": contact.get("game_icon_path", ""),
                    "asset_id": contact.get("asset_id"),
                    "asset_category": contact.get("asset_category"),
                    "member_ids": member_ids,
                    "custom": False,
                    "enabled": True,
                }
            )
        for contact in custom_groups:
            contact_id = contact.get("id")
            if isinstance(contact_id, bool) or not isinstance(contact_id, int):
                raise ValueError("custom group id must be an integer")
            name = str(contact.get("name", "")).strip()
            if not name:
                raise ValueError(f"custom group {contact_id} name must not be empty")
            enabled.append(
                {
                    "id": contact_id,
                    "name": name,
                    "kind": "group",
                    "game_icon_path": contact.get("game_icon_path", ""),
                    "asset_id": contact.get("asset_id"),
                    "asset_category": "custom_groups",
                    "member_ids": self._normalize_member_ids(
                        contact.get("member_ids", []),
                        f"custom group {contact_id} member_ids",
                    ),
                    "custom": True,
                    "enabled": True,
                }
            )
        return enabled

    def _sync_project_group_contact(self, project: dict) -> dict:
        """用当前群组状态同步项目中的联系人快照。"""
        contact = project.get("contact")
        if not isinstance(contact, dict) or contact.get("kind") != "group":
            return project
        contact_id = contact.get("contact_id")
        if contact_id is None:
            return project
        live = next(
            (
                item
                for item in self.list_contacts()
                if item.get("kind") == "group"
                and str(item.get("id")) == str(contact_id)
            ),
            None,
        )
        if not live:
            return project
        contact["name"] = live.get("name", contact.get("name", ""))
        contact["member_ids"] = list(live.get("member_ids") or [])
        if not contact.get("avatar_asset_id"):
            contact["avatar_asset_id"] = live.get("asset_id")
        return project

    def list_projects(self) -> list[dict]:
        """列出项目摘要，并用当前群名覆盖已过期的项目联系人快照。"""
        contacts = {
            str(contact.get("id")): contact
            for contact in self.list_contacts()
            if contact.get("kind") == "group"
        }
        projects = self.store.list_projects()
        for project in projects:
            if project.get("contact_kind") != "group":
                continue
            live = contacts.get(str(project.get("contact_id")))
            if live:
                project["contact_name"] = live.get("name", project.get("contact_name", ""))
        return projects

    def load_project(self, project_id: str) -> dict:
        """加载project数据。"""
        return self._sync_project_group_contact(self.store.load_project(project_id))

    def create_group(self, payload: dict) -> dict:
        """创建并返回目标对象。"""
        contacts = self.list_contacts()
        hero_by_id = {
            contact["id"]: contact
            for contact in contacts
            if contact.get("kind") != "group" and isinstance(contact.get("id"), int)
        }
        used_ids = {
            contact["id"]
            for contact in contacts
            if isinstance(contact.get("id"), int)
        }
        name = payload.get("name")
        if not isinstance(name, str) or not name.strip():
            raise ValueError("群名不能为空")
        name = name.strip()
        if len(name) > 40:
            raise ValueError("群名不能超过 40 个字符")
        member_ids = self._normalize_member_ids(payload.get("member_ids"), "member_ids")
        if len(member_ids) < MIN_GROUP_MEMBERS:
            raise ValueError("至少选择两名成员")
        missing_ids = [member_id for member_id in member_ids if member_id not in hero_by_id]
        if missing_ids:
            raise ValueError(f"群成员不存在或不是可对话角色: {missing_ids}")

        next_id = CUSTOM_GROUP_ID_START
        while next_id in used_ids:
            next_id += 1
        group = {
            "version": 1,
            "id": next_id,
            "name": name,
            "display_name": self._public_group_name(name),
            "kind": "group",
            "member_ids": member_ids,
            "asset_id": None,
            "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        }
        custom_groups = self._load_custom_groups()
        custom_groups.append(group)
        self._write_custom_groups(custom_groups)
        return self._find_group(next_id)

    def save_static_image(self, content_type: str, file_name: str, body: bytes) -> dict:
        """校验并保存用户上传的 PNG/JPG/JPEG 静态图片。"""
        normalized_type = str(content_type or "").split(";", 1)[0].strip().lower()
        image_format = STATIC_IMAGE_FORMATS.get(normalized_type)
        if image_format is None:
            raise ValueError("仅支持 PNG、JPG、JPEG 静态图片")
        if not body:
            raise ValueError("图片文件不能为空")
        if len(body) > MAX_STATIC_IMAGE_BYTES:
            raise ValueError("图片不能超过 8 MiB")
        extension, signature = image_format
        if not body.startswith(signature):
            raise ValueError("图片内容与文件格式不匹配")
        safe_name = Path(str(file_name or "image")).name.strip()[:120] or f"image{extension}"
        file_id = f"{uuid.uuid4().hex}{extension}"
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        target = self.uploads_dir / file_id
        temporary = target.with_suffix(target.suffix + ".tmp")
        temporary.write_bytes(body)
        temporary.replace(target)
        return {
            "file_id": file_id,
            "name": safe_name,
            "url": f"/api/uploads/{file_id}",
            "content_type": "image/jpeg" if normalized_type == "image/jpg" else normalized_type,
            "size": len(body),
        }

    def delete_upload(self, file_id: str) -> dict:
        """删除指定上传文件。"""
        target = self.upload_path(file_id)
        target.unlink()
        return {"file_id": file_id, "deleted": True}

    def upload_path(self, file_id: str) -> Path:
        """校验上传文件 ID 并返回安全的文件路径。"""
        if not file_id or "/" in file_id or "\\" in file_id:
            raise FileNotFoundError(file_id)
        stem, dot, extension = file_id.rpartition(".")
        if not dot or extension.lower() not in {"png", "jpg", "jpeg"} or len(stem) != 32:
            raise FileNotFoundError(file_id)
        try:
            uuid.UUID(hex=stem)
        except ValueError as exc:
            raise FileNotFoundError(file_id) from exc
        target = (self.uploads_dir / file_id).resolve()
        uploads_root = self.uploads_dir.resolve()
        if uploads_root not in target.parents or not target.is_file():
            raise FileNotFoundError(file_id)
        return target

    def _find_group(self, group_id: int) -> dict:
        """按 ID 查找群组联系人。"""
        for contact in self.list_contacts():
            if contact.get("kind") == "group" and contact.get("id") == group_id:
                return contact
        raise ApiError(HTTPStatus.NOT_FOUND, "group_not_found", f"群聊不存在: {group_id}")

    def _validated_group_member_ids(self, payload: dict) -> list[int]:
        """校验并返回群成员 ID 列表。"""
        contacts = self.list_contacts()
        hero_by_id = {
            contact["id"]: contact
            for contact in contacts
            if contact.get("kind") != "group" and isinstance(contact.get("id"), int)
        }
        member_ids = self._normalize_member_ids(payload.get("member_ids"), "member_ids")
        if len(member_ids) < MIN_GROUP_MEMBERS:
            raise ValueError("至少选择两名成员")
        missing_ids = [member_id for member_id in member_ids if member_id not in hero_by_id]
        if missing_ids:
            raise ValueError(f"群成员不存在或不是可对话角色: {missing_ids}")
        return member_ids

    def update_group(self, group_id: int, payload: dict) -> dict:
        """更新群名称和成员，并按自定义群或内置群分别持久化。"""
        target = self._find_group(group_id)
        member_ids = (
            self._validated_group_member_ids(payload)
            if "member_ids" in payload
            else self._normalize_member_ids(target.get("member_ids", []), "member_ids")
        )
        name = target.get("name", "")
        if "name" in payload:
            raw_name = payload.get("name")
            if not isinstance(raw_name, str) or not raw_name.strip():
                raise ValueError("群名不能为空")
            name = raw_name.strip()
            if len(name) > 40:
                raise ValueError("群名不能超过 40 个字符")
        if target.get("custom"):
            custom_groups = self._load_custom_groups()
            for group in custom_groups:
                if group.get("id") == group_id:
                    group["member_ids"] = member_ids
                    group["name"] = name
                    group["display_name"] = self._public_group_name(name)
                    break
            else:
                raise ApiError(HTTPStatus.NOT_FOUND, "group_not_found", f"群聊不存在: {group_id}")
            self._write_custom_groups(custom_groups)
        else:
            groups = self._load_group_members()
            groups[group_id] = member_ids
            group_names = self._load_group_name_overrides()
            if name:
                group_names[group_id] = name
            else:
                group_names.pop(group_id, None)
            self._write_group_members(
                groups,
                self._load_deleted_builtin_group_ids(),
                group_names,
            )
        return self._find_group(group_id)

    def delete_group(self, group_id: int) -> dict:
        """删除自定义群或为内置群写入删除标记。"""
        target = self._find_group(group_id)
        if target.get("custom"):
            custom_groups = [
                group
                for group in self._load_custom_groups()
                if group.get("id") != group_id
            ]
            self._write_custom_groups(custom_groups)
        else:
            groups = self._load_group_members()
            deleted_ids = self._load_deleted_builtin_group_ids()
            deleted_ids.add(group_id)
            self._write_group_members(groups, deleted_ids)
        return {
            "id": group_id,
            "deleted": True,
            "custom": bool(target.get("custom")),
        }

    def public_sticker_category(self, category: dict) -> dict:
        """将贴纸分类转换为前端公开结构。"""
        payload = {
            "id": str(category.get("id")),
            "category_id": category.get("category_id"),
            "official_icon": category.get("official_icon"),
            "record_count": category.get("record_count", 0),
            "available_count": category.get("available_count", 0),
            "missing_count": category.get("missing_count", 0),
            "disabled": bool(category.get("disabled")),
        }
        icon_asset = self.index.get(category.get("icon_asset_id"))
        if icon_asset:
            payload["icon"] = self.index.public_asset(icon_asset)
        return payload

    def list_sticker_categories(self) -> dict:
        """返回可选择的贴纸分类列表。"""
        categories = [
            self.public_sticker_category(category)
            for category in self.sticker_catalog.get("categories", [])
        ]
        return {
            "total": len(categories),
            "selectable_total": sum(1 for item in categories if not item["disabled"]),
            "missing_count": self.sticker_catalog.get("missing_count", 0),
            "items": categories,
        }

    def list_sticker_category_stickers(
        self,
        category_id: str,
        offset: int = 0,
        limit: int = 24,
    ) -> dict | None:
        """分页返回指定贴纸分类下的素材。"""
        category = self.sticker_categories_by_id.get(str(category_id))
        if category is None:
            return None
        all_ids = list(category.get("sticker_asset_ids", []))
        page_ids = all_ids[offset : offset + limit]
        items = []
        for asset_id in page_ids:
            asset = self.index.get(asset_id)
            if asset is not None:
                items.append(self.index.public_asset(asset))
        return {
            "category": self.public_sticker_category(category),
            "total": len(all_ids),
            "offset": offset,
            "limit": limit,
            "count": len(items),
            "items": items,
        }


class ApiError(Exception):
    """API 业务异常：携带 HTTP 状态码、错误码和用户可读消息。"""
    def __init__(
        self,
        status: HTTPStatus,
        code: str,
        message: str,
        details: dict | None = None,
    ):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details


class MomoTalkRequestHandler(BaseHTTPRequestHandler):
    """HTTP 请求处理器：分发 API/静态文件路由并统一生成本地服务响应。"""
    app: Application
    server_version = "MimirTalkWebUI/1.0.1"

    def log_message(self, format, *args):
        """将 HTTP 访问日志输出到服务终端。"""
        print(f"{self.address_string()} - {format % args}", flush=True)

    def do_GET(self):
        """处理对应的 HTTP 方法请求。"""
        self._dispatch("GET")

    def do_HEAD(self):
        """处理对应的 HTTP 方法请求。"""
        self._dispatch("HEAD")

    def do_POST(self):
        """处理对应的 HTTP 方法请求。"""
        self._dispatch("POST")

    def do_PUT(self):
        """处理对应的 HTTP 方法请求。"""
        self._dispatch("PUT")

    def do_DELETE(self):
        """处理对应的 HTTP 方法请求。"""
        self._dispatch("DELETE")

    def do_OPTIONS(self):
        """处理对应的 HTTP 方法请求。"""
        self._send_empty(HTTPStatus.NO_CONTENT)

    def _dispatch(self, method: str):
        """根据 HTTP 方法分发请求，并统一处理业务异常和 500 错误。"""
        try:
            parsed = urlparse(self.path)
            path = unquote(parsed.path)
            query = parse_qs(parsed.query)
            if method in {"GET", "HEAD"}:
                self._route_get(path, query, head_only=method == "HEAD")
            elif method == "POST":
                self._route_post(path)
            elif method == "PUT":
                self._route_put(path)
            elif method == "DELETE":
                self._route_delete(path)
            else:
                raise ApiError(
                    HTTPStatus.METHOD_NOT_ALLOWED,
                    "method_not_allowed",
                    f"Method not allowed: {method}",
                )
        except ApiError as exc:
            self._send_error(exc)
        except FileNotFoundError as exc:
            self._send_error(
                ApiError(HTTPStatus.NOT_FOUND, "not_found", str(exc))
            )
        except (json.JSONDecodeError, ProjectValidationError, ValueError) as exc:
            self._send_error(
                ApiError(HTTPStatus.BAD_REQUEST, "invalid_request", str(exc))
            )
        except Exception as exc:
            traceback.print_exc()
            self._send_error(
                ApiError(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    "internal_error",
                    str(exc),
                )
            )

    def _route_get(self, path: str, query: dict, head_only: bool = False):
        """处理对应 HTTP 路由。"""
        if path == "/api/health":
            contacts = self.app.list_contacts()
            self._send_json(
                {
                    "status": "ok",
                    "asset_count": self.app.index.stats().get("selected_assets", 0),
                    "contact_count": len(contacts),
                    "project_count": len(self.app.store.list_projects()),
                },
                head_only=head_only,
            )
            return

        upload_id = _match_upload_route(path)
        if upload_id:
            self._send_file(self.app.upload_path(upload_id), head_only=head_only)
            return

        if path == "/api/bubble-themes":
            self._send_json(self.app.bubble_themes(), head_only=head_only)
            return

        if path == "/api/contacts":
            contacts = self.app.list_contacts()
            self._send_json(
                {
                    "items": contacts,
                    "total": len(contacts),
                },
                head_only=head_only,
            )
            return

        if path == "/api/sticker-categories":
            self._send_json(self.app.list_sticker_categories(), head_only=head_only)
            return

        sticker_category_route = _match_sticker_category_stickers_route(path)
        if sticker_category_route is not None:
            offset = _query_int(query, "offset", 0, minimum=0)
            limit = _query_int(query, "limit", 24, minimum=1, maximum=60)
            payload = self.app.list_sticker_category_stickers(
                sticker_category_route,
                offset=offset,
                limit=limit,
            )
            if payload is None:
                raise ApiError(
                    HTTPStatus.NOT_FOUND,
                    "sticker_category_not_found",
                    f"Sticker category not found: {sticker_category_route}",
                )
            self._send_json(payload, head_only=head_only)
            return

        if path == "/api/assets":
            category = _query_one(query, "category")
            search = _query_one(query, "q")
            role = _query_one(query, "role")
            asset_ids = [
                value.strip()
                for value in (_query_one(query, "ids") or "").split(",")
                if value.strip()
            ]
            offset = _query_int(query, "offset", 0, minimum=0)
            limit = _query_int(query, "limit", 200, minimum=1, maximum=1000)
            payload = self.app.index.list_assets(
                category=category,
                query=search,
                role=role,
                asset_ids=asset_ids,
                offset=offset,
                limit=limit,
            )
            payload["categories"] = self.app.index.index.get("categories", {})
            self._send_json(payload, head_only=head_only)
            return

        asset_route = _match_asset_route(path)
        if asset_route:
            asset_id, action = asset_route
            asset = self.app.index.get(asset_id)
            if asset is None:
                raise ApiError(
                    HTTPStatus.NOT_FOUND,
                    "asset_not_found",
                    f"Asset not found: {asset_id}",
                )
            if action == "detail":
                self._send_json(
                    self.app.index.public_asset(asset),
                    head_only=head_only,
                )
                return
            if action == "file":
                self._send_file(asset, head_only=head_only)
                return
            if action == "thumbnail":
                width = _query_int(query, "width", 160, minimum=16, maximum=1024)
                height = _query_int(query, "height", 160, minimum=16, maximum=1024)
                path = self.app.index.thumbnail_path(asset, width, height)
                self._send_file(path, head_only=head_only)
                return

        if path == "/api/projects":
            self._send_json(
                {"items": self.app.list_projects()},
                head_only=head_only,
            )
            return

        project_id = _match_project_route(path)
        if project_id:
            project = self.app.load_project(project_id)
            self._send_json(project, head_only=head_only)
            return

        if path == "/":
            self._send_frontend_file("index.html", head_only=head_only)
            return

        if path == "/src/app.js":
            self._send_frontend_file("src/app.js", head_only=head_only)
            return

        if path == "/src/styles.css":
            self._send_frontend_file("src/styles.css", head_only=head_only)
            return

        if path.startswith("/assets/"):
            self._send_frontend_file(f"assets/{path[len('/assets/'): ]}", head_only=head_only)
            return

        raise ApiError(HTTPStatus.NOT_FOUND, "route_not_found", f"Route not found: {path}")

    def _route_post(self, path: str):
        """处理对应 HTTP 路由。"""
        if path == "/api/uploads/images":
            body = self._read_binary(MAX_STATIC_IMAGE_BYTES)
            content_type = self.headers.get("Content-Type", "")
            raw_name = self.headers.get("X-File-Name", "image")
            file_name = unquote(raw_name)
            uploaded = self.app.save_static_image(content_type, file_name, body)
            self._send_json(uploaded, status=HTTPStatus.CREATED)
            return

        if path == "/api/projects":
            payload = self._read_json()
            project = self.app.store.create_project(
                title=payload.get("title", DEFAULT_PROJECT_TITLE),
                contact_name=payload.get("contact_name", "角色名"),
                project_id=payload.get("id"),
            )
            self._send_json(project, status=HTTPStatus.CREATED)
            return

        if path == "/api/groups":
            payload = self._read_json()
            group = self.app.create_group(payload)
            self._send_json(group, status=HTTPStatus.CREATED)
            return

        if path == "/api/shutdown":
            self._read_json(required=False)
            self._send_json({"status": "shutting_down"})
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return

        raise ApiError(HTTPStatus.NOT_FOUND, "route_not_found", f"Route not found: {path}")

    def _route_put(self, path: str):
        """处理对应 HTTP 路由。"""
        group_id = _match_group_route(path)
        if group_id is not None:
            payload = self._read_json()
            group = self.app.update_group(group_id, payload)
            self._send_json(group)
            return

        project_id = _match_project_route(path)
        if not project_id:
            raise ApiError(HTTPStatus.NOT_FOUND, "route_not_found", f"Route not found: {path}")
        payload = self._read_json()
        if payload.get("id") not in {None, project_id}:
            raise ProjectValidationError("Project id in body does not match the route")
        payload["id"] = project_id
        saved = self.app.store.save_project(payload)
        self._send_json(saved)

    def _route_delete(self, path: str):
        """处理对应 HTTP 路由。"""
        upload_id = _match_upload_route(path)
        if upload_id is not None:
            self._send_json(self.app.delete_upload(upload_id))
            return

        group_id = _match_group_route(path)
        if group_id is not None:
            self._send_json(self.app.delete_group(group_id))
            return

        project_id = _match_project_route(path)
        if project_id:
            self.app.store.delete_project(project_id)
            self._send_json({"id": project_id, "deleted": True})
            return

        raise ApiError(HTTPStatus.NOT_FOUND, "route_not_found", f"Route not found: {path}")

    def _read_binary(self, maximum: int) -> bytes:
        """读取并校验二进制上传正文长度。"""
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
        except ValueError as exc:
            raise ValueError("Invalid Content-Length") from exc
        if length <= 0:
            raise ValueError("图片文件不能为空")
        if length > maximum:
            raise ValueError("图片不能超过 8 MiB")
        return self.rfile.read(length)

    def _read_json(self, required: bool = True) -> dict:
        """读取并解析 JSON 请求正文。"""
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length == 0:
            if required:
                raise ProjectValidationError("JSON request body is required")
            return {}
        if length > 5 * 1024 * 1024:
            raise ApiError(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                "request_too_large",
                "Request body exceeds 5 MiB",
            )
        raw = self.rfile.read(length)
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ProjectValidationError("JSON request body must be an object")
        return payload

    def _send_json(self, payload, status=HTTPStatus.OK, head_only: bool = False):
        """发送 JSON 响应。"""
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if not head_only:
            self.wfile.write(body)

    def _send_file(self, source: Path | dict, head_only: bool = False):
        """发送带正确 MIME 类型的文件响应。"""
        if isinstance(source, dict):
            source = self.app.index.asset_path(source)
        body = source.read_bytes()
        content_type = mimetypes.guess_type(source.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "public, max-age=3600")
        self.end_headers()
        if not head_only:
            self.wfile.write(body)

    def _send_frontend_file(self, relative_path: str, head_only: bool = False):
        """从 frontend 目录发送静态资源。"""
        source = (self.app.frontend_dir / relative_path).resolve()
        frontend_root = self.app.frontend_dir.resolve()
        if frontend_root not in source.parents:
            raise ValueError("Frontend path escapes the frontend directory")
        if not source.is_file():
            raise FileNotFoundError(f"Frontend file not found: {source}")
        body = source.read_bytes()
        content_type = mimetypes.guess_type(source.name)[0] or "application/octet-stream"
        if source.suffix == ".js":
            content_type = "text/javascript; charset=utf-8"
        elif source.suffix == ".css":
            content_type = "text/css; charset=utf-8"
        elif source.suffix == ".html":
            content_type = "text/html; charset=utf-8"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if not head_only:
            self.wfile.write(body)

    def _send_empty(self, status: HTTPStatus):
        """发送无正文 HTTP 响应。"""
        self.send_response(status)
        self.send_header("Content-Length", "0")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-File-Name")
        self.end_headers()

    def _send_error(self, error: ApiError):
        """将业务异常转换为统一 JSON 错误响应。"""
        payload = {
            "error": {
                "code": error.code,
                "message": error.message,
            }
        }
        if error.details:
            payload["error"]["details"] = error.details
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(error.status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except BrokenPipeError:
            pass


def _query_one(query: dict, key: str) -> str | None:
    """读取单个查询参数，忽略空值。"""
    values = query.get(key)
    return values[0] if values else None


def _query_int(
    query: dict,
    key: str,
    default: int,
    minimum: int | None = None,
    maximum: int | None = None,
) -> int:
    """读取整数查询参数，并校验最小值和默认值。"""
    raw = _query_one(query, key)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ProjectValidationError(f"{key} must be an integer") from exc
    if minimum is not None and value < minimum:
        raise ProjectValidationError(f"{key} must be at least {minimum}")
    if maximum is not None and value > maximum:
        raise ProjectValidationError(f"{key} must be at most {maximum}")
    return value


def _match_asset_route(path: str):
    """匹配并解析对应路由。"""
    prefix = "/api/assets/"
    if not path.startswith(prefix):
        return None
    remainder = path[len(prefix) :]
    for action in ("thumbnail", "file", "detail"):
        suffix = "" if action == "detail" else f"/{action}"
        if action == "detail":
            if "/" not in remainder and remainder:
                return remainder, "detail"
            continue
        if remainder.endswith(suffix):
            asset_id = remainder[: -len(suffix)]
            if asset_id and "/" not in asset_id:
                return asset_id, action
    return None


def _match_sticker_category_stickers_route(path: str) -> str | None:
    """匹配并解析对应路由。"""
    prefix = "/api/sticker-categories/"
    suffix = "/stickers"
    if not path.startswith(prefix) or not path.endswith(suffix):
        return None
    category_id = path[len(prefix) : -len(suffix)]
    if not category_id or "/" in category_id:
        return None
    return category_id


def _match_upload_route(path: str) -> str | None:
    """匹配并解析对应路由。"""
    prefix = "/api/uploads/"
    if not path.startswith(prefix):
        return None
    file_id = path[len(prefix) :]
    if not file_id or "/" in file_id:
        return None
    return file_id


def _match_group_route(path: str) -> int | None:
    """匹配并解析对应路由。"""
    prefix = "/api/groups/"
    if not path.startswith(prefix):
        return None
    raw_group_id = path[len(prefix) :]
    if not raw_group_id or "/" in raw_group_id:
        return None
    try:
        return int(raw_group_id)
    except ValueError:
        return None


def _match_project_route(path: str) -> str | None:
    """匹配并解析对应路由。"""
    prefix = "/api/projects/"
    if not path.startswith(prefix):
        return None
    project_id = path[len(prefix) :]
    if not project_id or "/" in project_id:
        return None
    return project_id


def create_server(
    host: str = "127.0.0.1",
    port: int = 8765,
    workspace_dir: Path = WORKSPACE_DIR,
    projects_dir: Path = DEFAULT_PROJECTS_DIR,
    index_path: Path | None = None,
    frontend_dir: Path = DEFAULT_FRONTEND_DIR,
    chat_contacts_path: Path = DEFAULT_CHAT_CONTACTS_PATH,
    group_members_path: Path = DEFAULT_GROUP_MEMBERS_PATH,
    custom_groups_path: Path = DEFAULT_CUSTOM_GROUPS_PATH,
    uploads_dir: Path = DEFAULT_UPLOADS_DIR,
):
    """创建并返回目标对象。"""
    app = Application(
        workspace_dir=workspace_dir,
        projects_dir=projects_dir,
        index_path=index_path,
        frontend_dir=frontend_dir,
        chat_contacts_path=chat_contacts_path,
        group_members_path=group_members_path,
        custom_groups_path=custom_groups_path,
        uploads_dir=uploads_dir,
    )

    class Handler(MomoTalkRequestHandler):
        """HTTP 路由处理函数类型别名。"""
        pass

    Handler.app = app
    return ThreadingHTTPServer((host, port), Handler)


def main() -> int:
    """命令行主入口。"""
    parser = argparse.ArgumentParser(description="Run the local MimirTalk WebUI API.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--projects-dir", type=Path, default=DEFAULT_PROJECTS_DIR)
    parser.add_argument("--index", type=Path)
    args = parser.parse_args()

    server = create_server(
        host=args.host,
        port=args.port,
        projects_dir=args.projects_dir,
        index_path=args.index,
    )
    host, port = server.server_address
    print(f"MimirTalk WebUI API listening on http://{host}:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
