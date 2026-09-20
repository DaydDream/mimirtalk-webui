"""校验前端静态结构、脚本标记和项目 API 集成。"""
from __future__ import annotations

import json
import sys
import tempfile
import threading
import urllib.request
from pathlib import Path


WEBUI_DIR = Path(__file__).resolve().parents[1]
BACKEND_DIR = WEBUI_DIR / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app import create_server  # noqa: E402


def request(base_url: str, path: str, method: str = "GET", body: dict | None = None):
    """发送 HTTP 请求并返回状态、响应头和正文。"""
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = urllib.request.Request(base_url + path, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=10) as response:
        return response.status, response.headers, response.read()


def request_json(base_url: str, path: str, method: str = "GET", body: dict | None = None):
    """发送 HTTP 请求并解析 JSON 响应。"""
    status, headers, raw = request(base_url, path, method=method, body=body)
    return status, headers, json.loads(raw.decode("utf-8"))


def main() -> int:
    """命令行主入口。"""
    with tempfile.TemporaryDirectory() as temporary:
        projects_dir = Path(temporary) / "projects"
        server = create_server(host="127.0.0.1", port=0, projects_dir=projects_dir)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        host, port = server.server_address
        base_url = f"http://{host}:{port}"
        try:
            status, headers, index_html = request(base_url, "/")
            if status != 200 or "text/html" not in headers.get_content_type():
                raise AssertionError("Editor index was not served")
            for marker in (
                b'id="projectList"',
                b'id="phonePreview"',
                b'id="messageEditor"',
                b'id="newGroupButton"',
                b'id="groupModal"',
                b'id="groupMemberList"',
            ):
                if marker not in index_html:
                    raise AssertionError(f"Editor markup missing {marker!r}")

            status, headers, app_js = request(base_url, "/src/app.js")
            if status != 200 or "javascript" not in headers.get_content_type():
                raise AssertionError("Editor JavaScript was not served")
            for marker in (
                b"function saveProject",
                b"function renderPreview",
                b"function addMessage",
                b"function moveMessage",
                b"openAssetModal",
                b"/sticker-categories",
                b"renderStickerCategoryGrid",
                b"assetPagination",
                b"function openGroupCreate",
                b"function openGroupManager",
                b"function renderGroupModal",
                b"function saveManagedGroup",
                b"function handleStaticImageSelection",
                b"function messageImageUrl",
                b"function contactAvatarHtml",
                b"function renderAvatarNode",
                b"function exportContactAvatarContent",
            ):
                if marker not in app_js:
                    raise AssertionError(f"Editor JavaScript missing {marker!r}")

            status, _, created = request_json(
                base_url,
                "/api/projects",
                method="POST",
                body={"id": "project_frontend_test", "title": "编辑器测试", "contact_name": "弥弥尔"},
            )
            if status != 201:
                raise AssertionError(f"Project creation failed: {status} {created}")

            for index in range(20):
                created["messages"].append(
                    {
                        "id": f"msg_frontend_{index:02d}",
                        "type": "text",
                        "side": "left" if index % 2 == 0 else "right",
                        "text": f"第 {index + 1} 条消息",
                    }
                )
            created["appearance"]["read"] = False
            status, _, saved = request_json(
                base_url,
                "/api/projects/project_frontend_test",
                method="PUT",
                body=created,
            )
            if status != 200 or len(saved["messages"]) != 20:
                raise AssertionError("20-message autosave payload failed")
            if any("delay_ms" in message or "delay" in message for message in saved["messages"]):
                raise AssertionError("Delay fields were not removed from editor payload")

            status, _, reopened = request_json(
                base_url,
                "/api/projects/project_frontend_test",
            )
            if reopened["messages"][19]["text"] != "第 20 条消息":
                raise AssertionError("Project reload did not restore editor content")
            if reopened["appearance"]["read"] is not False:
                raise AssertionError("Project reload did not restore read state")

            status, _, backgrounds = request_json(base_url, "/api/assets?category=backgrounds&limit=10")
            background_ids = [item["id"] for item in backgrounds.get("items", [])]
            if status != 200 or not any("momotalk_04" in value.lower() for value in background_ids):
                raise AssertionError("Background picker asset query failed")

            result = {
                "editor_shell": True,
                "phone_preview": True,
                "group_modal": True,
                "static_image_upload_ui": True,
                "group_avatar_helpers": True,
                "message_editor_script": True,
                "autosave_20_messages": True,
                "reload_persistence": True,
                "background_picker": True,
                "delay_removed": True,
            }
            print(json.dumps(result, ensure_ascii=False, indent=2))
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
