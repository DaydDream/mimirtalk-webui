"""extract_aethergazer_momotalk：深空之眼专项资源提取脚本，负责扫描资源包并输出图像或结构数据。"""
import argparse
import io
import json
import re
import time
import warnings
from collections import Counter, defaultdict
from pathlib import Path

import UnityPy


DEFAULT_GAME_DIR = Path(r"C:\Program Files\AetherGazerLauncher\AetherGazer")
DEFAULT_OUT_DIR = (
    Path(r"C:\Users\ori\OneDrive\文档\ChatGPT\adv解包")
    / "extract"
    / "aethergazer_momotalk"
)

CORE_EXACT = {
    "atlas/mimirchipatlas.ys",
    "atlas/monotalkatlas.ys",
    "hid/pages/chatpage.ys",
    "hid/pages/chatpage/sendmessage.ys",
    "hid/pages/home/chat.ys",
    "texturebg/operation/operation_bg_momotalk.ys",
    "textures/matrix/icon_mimir_shop.ys",
    "widget/system/mimirchip.ys",
    "widget/system/momotalk.ys",
}

CORE_PREFIXES = {
    "texturebg/momotalk/",
    "textureconfig/momotalk/",
}

WIDGET_CHAT_EXACT = {
    "widget/system/chat.ys",
}

CHAT_STICKER_PREFIXES = {
    "i18nimg/chat/chatsticker/",
    "textureconfig/chat/chatsticker/",
}

STRUCTURE_TYPES = {
    "AnimationClip",
    "Animator",
    "AnimatorController",
    "Canvas",
    "CanvasGroup",
    "GameObject",
    "MonoBehaviour",
    "MonoScript",
    "RectTransform",
    "SpriteAtlas",
}

TYPETREE_TYPES = STRUCTURE_TYPES - {"GameObject", "MonoScript", "RectTransform"}


def safe_name(value: str, fallback: str = "item") -> str:
    """清理文件名中的非法字符。"""
    clean = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value or "").strip().rstrip(".")
    return clean or fallback


def safe_asset_key(asset_path: str) -> str:
    """生成安全的素材键。"""
    clean_path = str(Path(asset_path.replace("\\", "/")).with_suffix(""))
    return safe_name(clean_path.replace("/", "__"), "asset")


def group_for_path(asset_path: str) -> str:
    """根据资源路径判断素材分类。"""
    if asset_path.startswith("atlas/"):
        return "atlas"
    if asset_path.startswith("widget/"):
        return "widgets"
    if asset_path.startswith("hid/"):
        return "input"
    if asset_path.startswith("texturebg/"):
        return "backgrounds"
    if asset_path.startswith("textureconfig/chat/chatsticker/"):
        return "chat_stickers"
    if asset_path.startswith("i18nimg/chat/chatsticker/"):
        return "chat_stickers_i18n"
    if asset_path.startswith("textureconfig/momotalk/"):
        return "momotalk_images"
    if asset_path.startswith("textures/matrix/"):
        return "icons"
    return "misc"


def load_index(data_dir: Path):
    """加载资源索引并建立路径映射。"""
    index_path = data_dir / "AssetHash_Info.bytes"
    if not index_path.is_file():
        raise FileNotFoundError(f"Asset index not found: {index_path}")

    payload = json.loads(index_path.read_text(encoding="utf-8-sig"))
    entries = {}
    for raw in payload["assetHashList"]:
        asset_path, asset_hash, size_text = raw.split("|", 2)
        entries[asset_path] = {
            "path": asset_path,
            "hash": asset_hash,
            "size": int(size_text),
            "bundle": data_dir / asset_hash[0] / asset_hash[1] / f"{asset_hash}.ys",
        }
    return payload, entries


def select_entries(
    entries,
    include_widget_chat: bool,
    include_chat_stickers: bool,
    exact_assets: list[str],
    match_patterns: list[str],
):
    """按配置筛选需要处理的资源条目。"""
    selected = {}
    exact = set(CORE_EXACT)
    exact.update(exact_assets)
    prefixes = set(CORE_PREFIXES)
    if include_widget_chat:
        exact.update(WIDGET_CHAT_EXACT)
    if include_chat_stickers:
        prefixes.update(CHAT_STICKER_PREFIXES)

    patterns = [re.compile(pattern, re.IGNORECASE) for pattern in match_patterns]
    for path, entry in entries.items():
        if (
            path in exact
            or any(path.startswith(prefix) for prefix in prefixes)
            or any(pattern.search(path) for pattern in patterns)
        ):
            selected[path] = entry
    return sorted(selected.items(), key=lambda item: item[0])


def load_bundle(bundle_path: Path):
    """读取并加载 UnityFS 资源包。"""
    raw = bundle_path.read_bytes()
    offset = raw.find(b"UnityFS")
    if offset < 0:
        raise ValueError("UnityFS signature not found")
    return UnityPy.load(io.BytesIO(raw[offset:]))


def json_default(value):
    """为 JSON 序列化提供默认转换。"""
    if isinstance(value, bytes):
        return value.hex()
    return str(value)


def write_json(path: Path, payload, overwrite: bool):
    """写入 JSON 文件。"""
    if path.exists() and not overwrite:
        return "exists"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=json_default),
        encoding="utf-8",
    )
    return "saved"


def path_id(value):
    """读取 Unity 资源引用中的路径 ID。"""
    if isinstance(value, dict):
        return value.get("m_PathID")
    return None


def read_script_map(env):
    """读取 MonoScript 映射。"""
    scripts = {}
    for obj in env.objects:
        if obj.type.name != "MonoScript":
            continue
        try:
            data = obj.read()
            scripts[obj.path_id] = {
                "path_id": obj.path_id,
                "name": getattr(data, "m_Name", "") or "",
                "class": getattr(data, "m_ClassName", "") or "",
                "namespace": getattr(data, "m_Namespace", "") or "",
                "assembly": getattr(data, "m_AssemblyName", "") or "",
            }
        except Exception as exc:
            scripts[obj.path_id] = {
                "path_id": obj.path_id,
                "error": str(exc),
            }
    return scripts


def script_label(script):
    """生成脚本的完整标签。"""
    if not script:
        return "<unknown>"
    namespace = script.get("namespace") or ""
    name = script.get("name") or script.get("class") or "<unknown>"
    return f"{namespace}.{name}".strip(".")


def extract_images(env, asset_path: str, out_dir: Path, overwrite: bool):
    """提取资源包中的贴图和精灵图片。"""
    group = group_for_path(asset_path)
    asset_key = safe_asset_key(asset_path)
    outputs = []
    errors = []
    used_paths = set()

    for obj in env.objects:
        if obj.type.name not in {"Texture2D", "Sprite"}:
            continue
        kind = obj.type.name.lower()
        try:
            data = obj.read()
            image = data.image
            if image is None:
                errors.append(
                    {
                        "path_id": obj.path_id,
                        "kind": obj.type.name,
                        "error": "image is None",
                    }
                )
                continue

            name = safe_name(getattr(data, "m_Name", "") or str(obj.path_id), str(obj.path_id))
            output_dir = out_dir / "images" / group / asset_key / kind
            output_path = output_dir / f"{name}.png"
            if output_path in used_paths:
                output_path = output_dir / f"{name}__{obj.path_id}.png"
            used_paths.add(output_path)

            status = "exists"
            if overwrite or not output_path.exists():
                output_dir.mkdir(parents=True, exist_ok=True)
                image.save(output_path, format="PNG")
                status = "saved"

            outputs.append(
                {
                    "asset": asset_path,
                    "group": group,
                    "kind": obj.type.name,
                    "name": getattr(data, "m_Name", "") or "",
                    "path_id": obj.path_id,
                    "width": image.width,
                    "height": image.height,
                    "output": str(output_path),
                    "status": status,
                }
            )
        except Exception as exc:
            errors.append(
                {
                    "path_id": obj.path_id,
                    "kind": obj.type.name,
                    "error": str(exc),
                }
            )

    return outputs, errors


def component_refs(game_object_data):
    refs = []
    for item in game_object_data.get("m_Component", []) or []:
        ref = item.get("component", item.get("m_Component")) if isinstance(item, dict) else None
        refs.append(path_id(ref))
    return refs


def build_ui_tree(rect_transforms, game_objects, component_types):
    """构建ui_tree所需的数据结构。"""
    nodes = {}
    child_ids = set()
    for rect_id, rect in rect_transforms.items():
        game_object_id = path_id(rect.get("m_GameObject"))
        game_object = game_objects.get(game_object_id, {})
        components = []
        for component_id in component_refs(game_object):
            if component_id is None:
                continue
            components.append(
                {
                    "path_id": component_id,
                    "type": component_types.get(component_id, "<unknown>"),
                }
            )

        children = []
        for child in rect.get("m_Children", []) or []:
            child_id = path_id(child)
            if child_id is not None:
                children.append(child_id)
                child_ids.add(child_id)

        nodes[rect_id] = {
            "path_id": rect_id,
            "game_object_path_id": game_object_id,
            "name": game_object.get("m_Name", ""),
            "active": game_object.get("m_IsActive"),
            "components": components,
            "children": children,
            "rect": {
                "m_Father": rect.get("m_Father"),
                "m_AnchoredPosition": rect.get("m_AnchoredPosition"),
                "m_SizeDelta": rect.get("m_SizeDelta"),
                "m_Pivot": rect.get("m_Pivot"),
                "m_LocalScale": rect.get("m_LocalScale"),
            },
        }

    roots = sorted(set(nodes) - child_ids)
    visited = set()

    def expand(node_id):
        if node_id in visited:
            return {"path_id": node_id, "cycle": True}
        visited.add(node_id)
        node = nodes.get(node_id)
        if node is None:
            return {"path_id": node_id, "missing": True}
        result = dict(node)
        result["children"] = [expand(child_id) for child_id in node["children"]]
        return result

    return roots, [expand(root_id) for root_id in roots]


def collect_monobehaviour_metadata(data):
    interesting = {}

    def visit(value, path=""):
        if isinstance(value, dict):
            for key, child in value.items():
                child_path = f"{path}.{key}" if path else key
                lowered = key.lower()
                if any(
                    token in lowered
                    for token in (
                        "assetpath",
                        "content",
                        "guid",
                        "i18nkey",
                        "itemprefab",
                        "message",
                        "name",
                        "path",
                        "prefab",
                        "sprite",
                        "story",
                        "string",
                        "text",
                    )
                ):
                    if not isinstance(child, (dict, list)) or isinstance(child, str):
                        interesting[child_path] = child
                visit(child, child_path)
        elif isinstance(value, list):
            for index, child in enumerate(value):
                visit(child, f"{path}[{index}]")

    visit(data)
    return interesting


def extract_asset(entry, out_dir: Path, overwrite: bool):
    """提取并返回目标资源或数据。"""
    asset_path = entry["path"]
    asset_key = safe_asset_key(asset_path)
    env = load_bundle(entry["bundle"])
    scripts = read_script_map(env)
    component_types = {obj.path_id: obj.type.name for obj in env.objects}

    game_objects = {}
    rect_transforms = {}
    monobehaviours = []
    typetree_rows = defaultdict(list)
    object_type_counts = Counter()

    for obj in env.objects:
        object_type_counts[obj.type.name] += 1
        if obj.type.name not in STRUCTURE_TYPES:
            continue

        try:
            data = obj.read_typetree()
        except Exception as exc:
            typetree_rows[obj.type.name].append(
                {
                    "path_id": obj.path_id,
                    "error": str(exc),
                }
            )
            continue

        game_object_id = path_id(data.get("m_GameObject"))
        script_id = path_id(data.get("m_Script")) if obj.type.name == "MonoBehaviour" else None
        script = scripts.get(script_id)
        row = {
            "path_id": obj.path_id,
            "game_object_path_id": game_object_id,
        }
        if obj.type.name == "MonoScript":
            row["script"] = scripts.get(obj.path_id)
        if obj.type.name == "MonoBehaviour":
            row["script"] = script
            row["script_label"] = script_label(script)
            row["script_path_id"] = script_id
            monobehaviours.append(row)

        if obj.type.name in TYPETREE_TYPES:
            typetree_rows[obj.type.name].append({**row, "data": data})

        if obj.type.name == "GameObject":
            game_objects[obj.path_id] = {
                "path_id": obj.path_id,
                "m_Name": data.get("m_Name", ""),
                "m_IsActive": data.get("m_IsActive"),
                "m_Component": data.get("m_Component", []),
            }
        elif obj.type.name == "RectTransform":
            rect_transforms[obj.path_id] = data

    for row in monobehaviours:
        game_object = game_objects.get(row.get("game_object_path_id"), {})
        row["game_object_name"] = game_object.get("m_Name", "")
        typetree = typetree_rows["MonoBehaviour"]
        matching = next((item for item in typetree if item["path_id"] == row["path_id"]), None)
        if matching is not None:
            matching["game_object_name"] = row["game_object_name"]
            matching["interesting_fields"] = collect_monobehaviour_metadata(matching.get("data", {}))

    roots, ui_tree = build_ui_tree(rect_transforms, game_objects, component_types)
    script_usage = Counter(row["script_label"] for row in monobehaviours)
    structure = {
        "asset": asset_path,
        "bundle": str(entry["bundle"]),
        "object_type_counts": dict(sorted(object_type_counts.items())),
        "script_count": len(scripts),
        "scripts": sorted(scripts.values(), key=lambda item: (item.get("namespace", ""), item.get("name", ""))),
        "script_usage": dict(script_usage.most_common()),
        "game_object_count": len(game_objects),
        "rect_transform_count": len(rect_transforms),
        "ui_root_rect_transform_ids": roots,
        "ui_tree": ui_tree,
        "game_objects": sorted(game_objects.values(), key=lambda item: item["path_id"]),
    }

    structure_status = write_json(
        out_dir / "structure" / f"{asset_key}.json",
        structure,
        overwrite,
    )
    typetree_outputs = []
    for object_type, rows in sorted(typetree_rows.items()):
        status = write_json(
            out_dir / "typetrees" / object_type / f"{asset_key}.json",
            {
                "asset": asset_path,
                "bundle": str(entry["bundle"]),
                "type": object_type,
                "count": len(rows),
                "objects": rows,
            },
            overwrite,
        )
        typetree_outputs.append(
            {
                "type": object_type,
                "count": len(rows),
                "status": status,
            }
        )

    images, image_errors = extract_images(env, asset_path, out_dir, overwrite)
    return {
        "structure_status": structure_status,
        "typetree_outputs": typetree_outputs,
        "images": images,
        "image_errors": image_errors,
        "scripts": list(scripts.values()),
        "monobehaviours": [
            {
                "path_id": row["path_id"],
                "game_object_path_id": row.get("game_object_path_id"),
                "game_object_name": row.get("game_object_name", ""),
                "script_label": row.get("script_label", "<unknown>"),
                "script_path_id": row.get("script_path_id"),
            }
            for row in monobehaviours
        ],
    }


def main():
    """命令行主入口。"""
    parser = argparse.ArgumentParser(
        description=(
            "Extract AetherGazer MomoTalk UI images, UI structure, MonoScripts, "
            "MonoBehaviour serialized fields, and related animation objects."
        )
    )
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument(
        "--include-widget-chat",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Include widget/system/chat.ys (default: true).",
    )
    parser.add_argument(
        "--include-chat-stickers",
        action="store_true",
        help="Also include textureconfig/chat/chatsticker and i18n chat stickers.",
    )
    parser.add_argument(
        "--asset",
        action="append",
        default=[],
        help="Additional exact asset path; repeatable.",
    )
    parser.add_argument(
        "--match",
        action="append",
        default=[],
        help="Additional case-insensitive regular expression against asset paths; repeatable.",
    )
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    warnings.filterwarnings("ignore", message="No valid Unity version found.*")
    UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f3c1"

    data_dir = args.game_dir / "AetherGazer_Data" / "StreamingAssets" / "Windows"
    payload, entries = load_index(data_dir)
    selected = select_entries(
        entries,
        args.include_widget_chat,
        args.include_chat_stickers,
        args.asset,
        args.match,
    )
    if args.limit:
        selected = selected[: args.limit]

    args.out_dir.mkdir(parents=True, exist_ok=True)
    report_path = args.report or (args.out_dir / "manifest.json")
    started = time.time()

    outputs = []
    errors = []
    image_counts = Counter()
    script_usage = defaultdict(lambda: Counter())
    all_scripts = {}

    print(
        f"version={payload.get('versionName', '?')} build={payload.get('buildCode', '?')} "
        f"selected={len(selected)} out={args.out_dir}",
        flush=True,
    )

    for position, (asset_path, entry) in enumerate(selected, start=1):
        try:
            result = extract_asset(entry, args.out_dir, args.overwrite)
            for image in result["images"]:
                image_counts[image["status"]] += 1
            for script in result["scripts"]:
                label = script_label(script)
                all_scripts[(label, script.get("assembly", ""))] = script
            for row in result["monobehaviours"]:
                script_usage[row["script_label"]][asset_path] += 1
            outputs.append(
                {
                    "asset": asset_path,
                    "bundle": str(entry["bundle"]),
                    "structure_status": result["structure_status"],
                    "typetree_outputs": result["typetree_outputs"],
                    "image_count": len(result["images"]),
                    "image_error_count": len(result["image_errors"]),
                }
            )
            errors.extend(
                {
                    "asset": asset_path,
                    "stage": "image",
                    **error,
                }
                for error in result["image_errors"]
            )
            print(
                f"[{position}/{len(selected)}] {asset_path} "
                f"images={len(result['images'])} scripts={len(result['scripts'])} "
                f"mono={len(result['monobehaviours'])}",
                flush=True,
            )
        except Exception as exc:
            errors.append({"asset": asset_path, "stage": "asset", "error": str(exc)})
            print(f"ERROR {asset_path}: {exc}", flush=True)

    usage_report = {
        label: {
            "assets": dict(asset_counts.most_common()),
            "total": sum(asset_counts.values()),
        }
        for label, asset_counts in sorted(
            script_usage.items(),
            key=lambda item: (-sum(item[1].values()), item[0]),
        )
    }
    write_json(
        args.out_dir / "scripts" / "mono_scripts.json",
        {
            "scripts": sorted(
                all_scripts.values(),
                key=lambda item: (item.get("namespace", ""), item.get("name", ""), item.get("assembly", "")),
            )
        },
        True,
    )
    write_json(
        args.out_dir / "scripts" / "monobehaviour_usage.json",
        usage_report,
        True,
    )

    report = {
        "game_dir": str(args.game_dir),
        "data_dir": str(data_dir),
        "out_dir": str(args.out_dir),
        "version": payload.get("versionName"),
        "build": payload.get("buildCode"),
        "include_widget_chat": args.include_widget_chat,
        "include_chat_stickers": args.include_chat_stickers,
        "selected_count": len(selected),
        "processed_count": len(outputs),
        "saved_image_count": image_counts["saved"],
        "existing_image_count": image_counts["exists"],
        "error_count": len(errors),
        "elapsed_seconds": round(time.time() - started, 3),
        "selected_assets": [path for path, _ in selected],
        "outputs": outputs,
        "errors": errors,
    }
    write_json(report_path, report, True)

    print(
        f"done assets={report['processed_count']} images_saved={report['saved_image_count']} "
        f"images_existing={report['existing_image_count']} errors={report['error_count']} "
        f"manifest={report_path}",
        flush=True,
    )
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
