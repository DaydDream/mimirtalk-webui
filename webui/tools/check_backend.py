"""启动临时后端并验证 API、项目、群聊、上传、迁移和关闭行为。"""
from __future__ import annotations

import base64
import json
import sys
import tempfile
import threading
import urllib.error
import urllib.parse
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
    request = urllib.request.Request(
        base_url + path,
        data=data,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.headers, exc.read()


def request_json(base_url: str, path: str, method: str = "GET", body: dict | None = None):
    """发送 HTTP 请求并解析 JSON 响应。"""
    status, headers, raw = request(base_url, path, method=method, body=body)
    return status, headers, json.loads(raw.decode("utf-8"))


def request_binary(
    base_url: str,
    path: str,
    body: bytes,
    content_type: str,
    file_name: str,
):
    """发送二进制上传请求并返回响应。"""
    request = urllib.request.Request(
        base_url + path,
        data=body,
        headers={
            "Content-Type": content_type,
            "X-File-Name": urllib.parse.quote(file_name, safe=""),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.headers, exc.read()


def main() -> int:
    """命令行主入口。"""
    with tempfile.TemporaryDirectory() as temporary:
        projects_dir = Path(temporary) / "projects"
        custom_groups_path = Path(temporary) / "custom_groups.json"
        group_members_path = Path(temporary) / "group_members.json"
        group_members_path.write_text(
            (WEBUI_DIR / "data" / "group_members.json").read_text(encoding="utf-8"),
            encoding="utf-8",
        )
        custom_groups_path.write_text(
            json.dumps(
                {"version": 1, "id_start": 9200, "groups": []},
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        server = create_server(
            host="127.0.0.1",
            port=0,
            projects_dir=projects_dir,
            group_members_path=group_members_path,
            custom_groups_path=custom_groups_path,
            uploads_dir=Path(temporary) / "uploads",
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        host, port = server.server_address
        base_url = f"http://{host}:{port}"
        asset_index = json.loads(
            (WEBUI_DIR / "data" / "asset_index.json").read_text(encoding="utf-8")
        )
        expected_asset_count = len(asset_index["assets"])
        expected_background_count = sum(
            1
            for asset in asset_index["assets"]
            if asset.get("category") == "backgrounds"
        )

        try:
            status, _, health = request_json(base_url, "/api/health")
            if status != 200 or health["status"] != "ok":
                raise AssertionError(f"Unexpected health response: {status} {health}")
            if health["asset_count"] != expected_asset_count:
                raise AssertionError(f"Unexpected asset count: {health['asset_count']}")

            status, headers, index_html = request(base_url, "/")
            if status != 200 or "text/html" not in headers.get_content_type():
                raise AssertionError("WebUI index was not served as HTML")
            if b"MimirTalk WebUI" not in index_html:
                raise AssertionError("WebUI index payload did not look like the editor")

            status, headers, app_js = request(base_url, "/src/app.js")
            if status != 200 or "javascript" not in headers.get_content_type():
                raise AssertionError("WebUI app.js was not served as JavaScript")
            if b"saveProject" not in app_js:
                raise AssertionError("WebUI app.js did not contain editor logic")

            status, headers, styles_css = request(base_url, "/src/styles.css")
            if status != 200 or "text/css" not in headers.get_content_type():
                raise AssertionError("WebUI styles.css was not served as CSS")
            if b".phone-preview" not in styles_css:
                raise AssertionError("WebUI stylesheet did not contain the phone preview")

            status, _, bubble_themes = request_json(base_url, "/api/bubble-themes")
            if status != 200 or bubble_themes["count"] != 17:
                raise AssertionError(f"Unexpected bubble theme payload: {bubble_themes}")
            bubble_9016 = next(
                (theme for theme in bubble_themes["themes"] if theme["id"] == "9016"),
                None,
            )
            if not bubble_9016:
                raise AssertionError("Bubble theme 9016 is missing")
            left_slice = bubble_9016["variants"]["left"]["slice"]
            right_slice = bubble_9016["variants"]["right"]["slice"]
            if left_slice != {"top": 57, "right": 63, "bottom": 30, "left": 63}:
                raise AssertionError(f"Unexpected 9016 left slice: {left_slice}")
            if right_slice != {"top": 56, "right": 41, "bottom": 29, "left": 47}:
                raise AssertionError(f"Unexpected 9016 right slice: {right_slice}")
            if bubble_9016["variants"]["right"].get("source_kind") != "texture2d":
                raise AssertionError("9016 right bubble must use the full Texture2D asset")

            status, _, backgrounds = request_json(
                base_url,
                "/api/assets?category=backgrounds&limit=10",
            )
            if status != 200 or backgrounds["total"] != expected_background_count:
                raise AssertionError(f"Unexpected backgrounds response: {backgrounds}")
            background = backgrounds["items"][0]

            status, _, detail = request_json(
                base_url,
                f"/api/assets/{background['url_id']}",
            )
            if status != 200 or detail["id"] != background["id"]:
                raise AssertionError(f"Unexpected asset detail response: {detail}")

            status, headers, image = request(base_url, detail["file_url"])
            if status != 200 or headers.get_content_type() != "image/png":
                raise AssertionError("Asset file endpoint did not return PNG")
            if not image.startswith(b"\x89PNG\r\n\x1a\n"):
                raise AssertionError("Asset file payload is not a PNG")

            status, headers, thumbnail = request(
                base_url,
                detail["thumbnail_url"] + "?width=64&height=64",
            )
            if status != 200 or headers.get_content_type() != "image/png":
                raise AssertionError("Thumbnail endpoint did not return PNG")
            if not thumbnail.startswith(b"\x89PNG\r\n\x1a\n"):
                raise AssertionError("Thumbnail payload is not a PNG")

            status, _, sticker_categories = request_json(
                base_url,
                "/api/sticker-categories",
            )
            if status != 200:
                raise AssertionError(f"Sticker category list failed: {status}")
            if sticker_categories["total"] != 31:
                raise AssertionError(f"Unexpected sticker category total: {sticker_categories}")
            if sticker_categories["selectable_total"] != 29:
                raise AssertionError(f"Unexpected selectable sticker category total: {sticker_categories}")
            if sticker_categories["items"][0]["id"] != "0":
                raise AssertionError("Sticker categories should preserve official order")
            if sticker_categories["items"][0]["disabled"] is not True:
                raise AssertionError("Sticker category 0 should be disabled")

            status, _, sticker_page = request_json(
                base_url,
                "/api/sticker-categories/1/stickers?offset=0&limit=5",
            )
            if status != 200:
                raise AssertionError(f"Sticker category page failed: {status}")
            if sticker_page["category"]["id"] != "1":
                raise AssertionError(f"Unexpected sticker category payload: {sticker_page}")
            if sticker_page["total"] < 1 or len(sticker_page["items"]) > 5:
                raise AssertionError(f"Unexpected sticker page size: {sticker_page}")
            if not sticker_page["items"][0]["file_url"]:
                raise AssertionError("Sticker page item did not include a file URL")

            status, _, project_list = request_json(base_url, "/api/projects")
            if status != 200 or project_list["items"]:
                raise AssertionError(f"Unexpected initial project list: {project_list}")

            status, _, created = request_json(
                base_url,
                "/api/projects",
                method="POST",
                body={"id": "project_api_test", "contact_name": "弥弥尔"},
            )
            if status != 201 or created["id"] != "project_api_test":
                raise AssertionError(f"Project creation failed: {status} {created}")
            if created["title"] != "未命名项目":
                raise AssertionError(f"Project default title was not migrated: {created}")
            if created["active_conversation_id"] not in created["conversations"]:
                raise AssertionError(f"Project creation did not initialize conversations: {created}")

            active_conversation_id = created["active_conversation_id"]
            created["conversations"][active_conversation_id] = [
                {
                    "id": "message_api_test",
                    "type": "text",
                    "side": "left",
                    "text": "后端接口测试",
                    "delay_ms": 500,
                }
            ]
            created["conversations"]["secondary"] = [
                {
                    "id": "message_api_secondary",
                    "type": "text",
                    "side": "right",
                    "text": "第二会话",
                    "delay_ms": 600,
                },
                {
                    "id": "message_api_choice",
                    "type": "choice",
                    "side": "center",
                    "prompt": "旧选择支",
                    "options": ["继续"],
                },
            ]
            created["messages"] = created["conversations"][active_conversation_id]
            status, _, updated = request_json(
                base_url,
                "/api/projects/project_api_test",
                method="PUT",
                body=created,
            )
            if status != 200 or len(updated["messages"]) != 1:
                raise AssertionError(f"Project update failed: {status} {updated}")
            if updated["messages"] != updated["conversations"][active_conversation_id]:
                raise AssertionError(f"Active conversation mirror failed: {updated}")
            if updated["conversations"].get("secondary") != [
                {
                    "id": "message_api_secondary",
                    "type": "text",
                    "side": "right",
                    "text": "第二会话",
                }
            ]:
                raise AssertionError(f"Second conversation was not preserved or choice was not dropped: {updated}")
            saved_messages = [
                message
                for messages in updated["conversations"].values()
                for message in messages
            ]
            if any("delay_ms" in message or "delay" in message for message in saved_messages):
                raise AssertionError(f"Delay fields were not stripped: {saved_messages}")

            status, _, loaded = request_json(
                base_url,
                "/api/projects/project_api_test",
            )
            if status != 200 or loaded["messages"][0]["text"] != "后端接口测试":
                raise AssertionError(f"Project reload failed: {loaded}")

            status, _, deleted_project = request_json(
                base_url,
                "/api/projects/project_api_test",
                method="DELETE",
            )
            if status != 200 or deleted_project != {"id": "project_api_test", "deleted": True}:
                raise AssertionError(f"Project deletion failed: {status} {deleted_project}")
            status, _, deleted_loaded = request_json(
                base_url,
                "/api/projects/project_api_test",
            )
            if status != 404:
                raise AssertionError(f"Deleted project was still readable: {status} {deleted_loaded}")

            status, _, contacts = request_json(base_url, "/api/contacts")
            if status != 200 or not contacts["items"]:
                raise AssertionError(f"Contact list failed: {contacts}")
            hero_ids = [
                contact["id"]
                for contact in contacts["items"]
                if contact.get("kind") != "group" and isinstance(contact.get("id"), int)
            ][:2]
            if len(hero_ids) < 2:
                raise AssertionError("Expected at least two hero contacts for group creation")
            if any(contact["id"] == 9200 for contact in contacts["items"]):
                raise AssertionError("Custom group id 9200 was unexpectedly occupied")

            status, _, too_few = request_json(
                base_url,
                "/api/groups",
                method="POST",
                body={"name": "单人组", "member_ids": hero_ids[:1]},
            )
            if status != 400 or too_few["error"]["code"] != "invalid_request":
                raise AssertionError(f"One-member group should be rejected: {too_few}")

            status, _, missing_member = request_json(
                base_url,
                "/api/groups",
                method="POST",
                body={"name": "缺失成员", "member_ids": hero_ids + [99999999]},
            )
            if status != 400 or "群成员不存在" not in missing_member["error"]["message"]:
                raise AssertionError(f"Unknown group member should be rejected: {missing_member}")

            status, _, group_a = request_json(
                base_url,
                "/api/groups",
                method="POST",
                body={"name": "测试群聊", "member_ids": hero_ids},
            )
            if status != 201 or group_a["id"] != 9200 or group_a["kind"] != "group":
                raise AssertionError(f"First custom group was not assigned 9200: {group_a}")
            if group_a["member_ids"] != hero_ids:
                raise AssertionError(f"Custom group member_ids mismatch: {group_a}")
            status, _, group_b = request_json(
                base_url,
                "/api/groups",
                method="POST",
                body={"name": "Test Squad", "member_ids": list(reversed(hero_ids))},
            )
            if status != 201 or group_b["id"] != 9201:
                raise AssertionError(f"Second custom group was not assigned 9201: {group_b}")

            status, _, contacts_after = request_json(base_url, "/api/contacts")
            custom_ids = [
                contact["id"]
                for contact in contacts_after["items"]
                if contact.get("custom") and contact.get("kind") == "group"
            ]
            if custom_ids[-2:] != [9200, 9201]:
                raise AssertionError(f"Custom groups missing from contact list: {contacts_after}")
            stored_groups = json.loads(custom_groups_path.read_text(encoding="utf-8"))["groups"]
            if [group["id"] for group in stored_groups] != [9200, 9201]:
                raise AssertionError(f"Custom group file was not updated: {stored_groups}")

            status, _, updated_custom = request_json(
                base_url,
                "/api/groups/9200",
                method="PUT",
                body={"name": "改名后的群聊", "member_ids": list(reversed(hero_ids))},
            )
            if (
                status != 200
                or updated_custom["member_ids"] != list(reversed(hero_ids))
                or updated_custom["name"] != "改名后的群聊"
            ):
                raise AssertionError(f"Custom group update failed: {updated_custom}")

            project_group_ids = []
            for suffix in ("a", "b"):
                project_id = f"project_group_name_{suffix}"
                status, _, group_project = request_json(
                    base_url,
                    "/api/projects",
                    method="POST",
                    body={"id": project_id, "title": f"群组项目 {suffix}"},
                )
                if status != 201:
                    raise AssertionError(f"Group-name project creation failed: {group_project}")
                group_project["contact"].update(
                    {
                        "contact_id": 9200,
                        "kind": "group",
                        "name": updated_custom["name"],
                        "avatar_asset_id": None,
                        "member_ids": updated_custom["member_ids"],
                    }
                )
                status, _, saved_group_project = request_json(
                    base_url,
                    f"/api/projects/{project_id}",
                    method="PUT",
                    body=group_project,
                )
                if status != 200:
                    raise AssertionError(f"Group-name project save failed: {saved_group_project}")
                project_group_ids.append(project_id)

            renamed_group = request_json(
                base_url,
                "/api/groups/9200",
                method="PUT",
                body={
                    "name": "全局同步群名",
                    "member_ids": list(reversed(hero_ids)),
                },
            )[2]
            listed_projects = request_json(base_url, "/api/projects")[2]["items"]
            group_project_rows = [
                item for item in listed_projects if item["id"] in project_group_ids
            ]
            if any(item["contact_name"] != renamed_group["name"] for item in group_project_rows):
                raise AssertionError(
                    f"Group rename did not update all project summaries: {group_project_rows}"
                )
            for project_id in project_group_ids:
                loaded_group_project = request_json(
                    base_url,
                    f"/api/projects/{project_id}",
                )[2]
                if loaded_group_project["contact"]["name"] != renamed_group["name"]:
                    raise AssertionError(
                        f"Group rename did not update project contact snapshot: {loaded_group_project}"
                    )

            status, _, deleted_custom = request_json(
                base_url,
                "/api/groups/9201",
                method="DELETE",
                body={},
            )
            if status != 200 or deleted_custom.get("deleted") is not True:
                raise AssertionError(f"Custom group delete failed: {deleted_custom}")
            contacts_after_delete = request_json(base_url, "/api/contacts")[2]
            if any(contact["id"] == 9201 for contact in contacts_after_delete["items"]):
                raise AssertionError("Deleted custom group is still exposed")
            stored_groups = json.loads(custom_groups_path.read_text(encoding="utf-8"))["groups"]
            if [group["id"] for group in stored_groups] != [9200]:
                raise AssertionError(f"Deleted custom group remains in file: {stored_groups}")

            builtin_group = next(
                contact
                for contact in contacts_after_delete["items"]
                if contact.get("kind") == "group" and not contact.get("custom")
            )
            builtin_id = builtin_group["id"]
            updated_members = list(reversed(hero_ids))
            builtin_name = "内置群改名测试"
            status, _, updated_builtin = request_json(
                base_url,
                f"/api/groups/{builtin_id}",
                method="PUT",
                body={"name": builtin_name, "member_ids": updated_members},
            )
            if (
                status != 200
                or updated_builtin["member_ids"] != updated_members
                or updated_builtin["name"] != builtin_name
            ):
                raise AssertionError(f"Built-in group update failed: {updated_builtin}")
            stored_group_payload = json.loads(group_members_path.read_text(encoding="utf-8"))
            stored_members = stored_group_payload["groups"]
            if stored_members[str(builtin_id)] != updated_members:
                raise AssertionError("Built-in group update was not persisted")
            if stored_group_payload.get("group_names", {}).get(str(builtin_id)) != builtin_name:
                raise AssertionError("Built-in group name override was not persisted")

            status, _, deleted_builtin = request_json(
                base_url,
                f"/api/groups/{builtin_id}",
                method="DELETE",
                body={},
            )
            if status != 200 or deleted_builtin.get("deleted") is not True:
                raise AssertionError(f"Built-in group delete failed: {deleted_builtin}")
            contacts_after_builtin_delete = request_json(base_url, "/api/contacts")[2]
            if any(contact["id"] == builtin_id for contact in contacts_after_builtin_delete["items"]):
                raise AssertionError("Deleted built-in group is still exposed")
            stored_members = json.loads(group_members_path.read_text(encoding="utf-8"))
            if builtin_id not in stored_members.get("deleted_group_ids", []):
                raise AssertionError("Built-in group deletion tombstone was not persisted")

            png_bytes = base64.b64decode(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
            )
            status, _, invalid_image = request_binary(
                base_url,
                "/api/uploads/images",
                b"GIF89a-not-a-static-image",
                "image/gif",
                "bad.gif",
            )
            if status != 400:
                raise AssertionError(f"GIF upload should be rejected: {status} {invalid_image}")
            status, _, uploaded_raw = request_binary(
                base_url,
                "/api/uploads/images",
                png_bytes,
                "image/png",
                "sample.png",
            )
            uploaded = json.loads(uploaded_raw.decode("utf-8"))
            if status != 201 or not uploaded.get("file_id", "").endswith(".png"):
                raise AssertionError(f"PNG upload failed: {status} {uploaded}")
            status, headers, uploaded_body = request(base_url, uploaded["url"])
            if status != 200 or headers.get_content_type() != "image/png" or uploaded_body != png_bytes:
                raise AssertionError("Uploaded image could not be served back")
            status, _, deleted_upload = request_json(
                base_url,
                f"/api/uploads/{uploaded['file_id']}",
                method="DELETE",
            )
            if status != 200 or deleted_upload.get("deleted") is not True:
                raise AssertionError(f"Uploaded image deletion failed: {status} {deleted_upload}")
            status, _, missing_upload = request_json(
                base_url,
                f"/api/uploads/{uploaded['file_id']}",
            )
            if status != 404:
                raise AssertionError(f"Deleted upload was still readable: {status} {missing_upload}")

            status, _, missing = request_json(
                base_url,
                "/api/assets/missing_asset",
            )
            if status != 404 or missing["error"]["code"] != "asset_not_found":
                raise AssertionError(f"Missing asset response was wrong: {missing}")

            status, _, removed_export = request_json(
                base_url,
                "/api/export/image",
                method="POST",
                body={"project_id": "project_api_test"},
            )
            if status != 404 or removed_export["error"]["code"] != "route_not_found":
                raise AssertionError(f"Removed export route response was wrong: {removed_export}")
            status, _, removed_rebuild = request_json(
                base_url,
                "/api/assets/rebuild",
                method="POST",
                body={},
            )
            if status != 404 or removed_rebuild["error"]["code"] != "route_not_found":
                raise AssertionError(f"Removed asset rebuild route response was wrong: {removed_rebuild}")

            status, _, shutdown = request_json(
                base_url,
                "/api/shutdown",
                method="POST",
                body={},
            )
            if status != 200 or shutdown.get("status") != "shutting_down":
                raise AssertionError(f"Shutdown response was wrong: {shutdown}")
            thread.join(timeout=5)
            if thread.is_alive():
                raise AssertionError("Server kept running after /api/shutdown")

            result = {
                "health": True,
                "frontend_index": True,
                "frontend_javascript": True,
                "frontend_stylesheet": True,
                "asset_list": backgrounds["total"],
                "asset_file_png": True,
                "asset_thumbnail_png": True,
                "bubble_slice_9016": True,
                "sticker_categories": sticker_categories["selectable_total"],
                "sticker_category_page": sticker_page["total"],
                "project_create": True,
                "project_update": True,
                "project_reload": True,
                "project_delete": True,
                "project_title_default": True,
                "message_delay_removed": True,
                "message_choice_removed": True,
                "custom_group_ids": custom_ids[-2:],
                "custom_group_min_members": True,
                "custom_group_invalid_member": True,
                "custom_group_update": True,
                "custom_group_rename": True,
                "group_rename_project_sync": True,
                "custom_group_delete": True,
                "builtin_group_update": True,
                "builtin_group_rename": True,
                "builtin_group_delete": True,
                "static_image_upload": True,
                "static_image_format_rejected": True,
                "static_image_delete": True,
                "missing_asset_404": True,
                "removed_export_routes_404": True,
                "removed_asset_rebuild_route_404": True,
                "shutdown_endpoint": True,
            }
            print(json.dumps(result, ensure_ascii=False, indent=2))
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
