"""extract_aethergazer_momotalk_lua：深空之眼专项资源提取脚本，负责扫描资源包并输出图像或结构数据。"""
import argparse
import hashlib
import io
import json
import re
import time
import warnings
from collections import Counter
from pathlib import Path

import UnityPy


DEFAULT_GAME_DIR = Path(r"C:\Program Files\AetherGazerLauncher\AetherGazer")
DEFAULT_OUT_DIR = (
    Path(r"C:\Users\ori\OneDrive\文档\ChatGPT\adv解包")
    / "extract"
    / "aethergazer_momotalk"
)

ARCHITECTURES = {
    "lua64": {
        "asset": "scripts64",
        "label": "x64",
        "output": "lua_all",
        "momotalk_output": "lua_momotalk",
    },
    "lua32": {
        "asset": "scripts32",
        "label": "x86",
        "output": "lua32_all",
        "momotalk_output": "lua_momotalk_32",
    },
}

DIRECT_MOMOTALK_SCRIPTS = {
    "MomoTalkAction.lua",
    "MomoTalkBaseItemView.lua",
    "MomoTalkBubbleBaseItem.lua",
    "MomoTalkBubblePicItem.lua",
    "MomoTalkBubbleTalkItem.lua",
    "MomoTalkBubbleWorldItem.lua",
    "MomoTalkBubleItem.lua",
    "MomoTalkCharactorListItem.lua",
    "MomoTalkCharactorListView.lua",
    "MomoTalkChatContentView.lua",
    "MomoTalkChatRecordView.lua",
    "MomoTalkChatTabsView.lua",
    "MomoTalkChoiceView.lua",
    "MomoTalkConst.lua",
    "MomoTalkData.lua",
    "MomoTalkHeadIconItem.lua",
    "MomoTalkHeadPortrait.lua",
    "MomoTalkImagePopView.lua",
    "MomoTalkMainView.lua",
    "MomoTalkMessagePoolView.lua",
    "MomoTalkMomentsDetailView.lua",
    "MomoTalkMomentsView.lua",
    "MomoTalkNoneItem.lua",
    "MomoTalkPlayerSettingView.lua",
    "MomoTalkRecordItem.lua",
    "MomoTalkReplyItem.lua",
    "MomoTalkSelectTabItem.lua",
    "MomoTalkSettingItem.lua",
    "MomoTalkTipsItem.lua",
    "MomoTalkTools.lua",
    "StageArchiveMomoTalkItem.lua",
    "StageArchiveMomoTalkNoNewItem.lua",
    "StageArchiveMomoTalkPlayer.lua",
    "StageArchiveMomoTalkPool.lua",
    "StageArchiveMomoTalkView.lua",
    "StageArchivesCollectMomoTalkCfg.lua",
    "StageAshMomoTalkView.lua",
}

UI_REFERENCE_RE = re.compile(
    rb"(?i)(?:atlas|hid|texturebg|textureconfig|widget)/[A-Za-z0-9_./@$-]+"
)
LUA_REFERENCE_RE = re.compile(rb"[A-Za-z0-9_./-]+\.lua")
ASCII_STRING_RE = re.compile(rb"[\x20-\x7e]{4,}")


def safe_name(value: str, fallback: str = "item") -> str:
    """清理文件名中的非法字符。"""
    clean = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value or "").strip().rstrip(".")
    return clean or fallback


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


def load_bundle(bundle_path: Path):
    """读取并加载 UnityFS 资源包。"""
    raw = bundle_path.read_bytes()
    offset = raw.find(b"UnityFS")
    if offset < 0:
        raise ValueError("UnityFS signature not found")
    return UnityPy.load(io.BytesIO(raw[offset:]))


def payload_bytes(value):
    if isinstance(value, bytes):
        return value
    if isinstance(value, bytearray):
        return bytes(value)
    if isinstance(value, memoryview):
        return value.tobytes()
    if isinstance(value, str):
        return value.encode("utf-8", "surrogateescape")
    if value is None:
        return b""
    return bytes(value)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def unique_ascii_strings(blob: bytes, limit: int = 8000):
    seen = set()
    values = []
    truncated = False
    for match in ASCII_STRING_RE.finditer(blob):
        value = match.group(0).decode("ascii", "ignore")
        if value in seen:
            continue
        seen.add(value)
        if len(values) >= limit:
            truncated = True
            break
        values.append(value)
    return sorted(values, key=lambda item: (item.lower(), item)), truncated


def extract_references(blob: bytes):
    """提取并返回目标资源或数据。"""
    lua_refs = {
        value.decode("ascii", "ignore")
        for value in LUA_REFERENCE_RE.findall(blob)
    }
    ui_refs = {
        value.decode("ascii", "ignore").rstrip(".,;:")
        for value in UI_REFERENCE_RE.findall(blob)
    }
    return sorted(lua_refs, key=str.lower), sorted(ui_refs, key=str.lower)


def build_target(output_dir: Path, original_name: str, path_id: int, used: set):
    """构建target所需的数据结构。"""
    name = safe_name(original_name or str(path_id), str(path_id))
    if not Path(name).suffix:
        name = f"{name}.lua"

    candidate = output_dir / name
    if candidate in used:
        suffix = Path(name).suffix
        stem = name[: -len(suffix)] if suffix else name
        candidate = output_dir / f"{stem}__{path_id}{suffix}"
    if candidate in used:
        candidate = output_dir / f"{Path(name).stem}__{path_id}_{len(used)}{Path(name).suffix}"

    used.add(candidate)
    return candidate


def write_bytes(path: Path, data: bytes, overwrite: bool):
    if path.exists() and not overwrite:
        existing_size = path.stat().st_size
        if existing_size == len(data):
            return "exists"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return "saved"


def write_text(path: Path, value: str, overwrite: bool):
    if path.exists() and not overwrite:
        return "exists"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8")
    return "saved"


def write_json(path: Path, payload, overwrite: bool):
    """写入 JSON 文件。"""
    if path.exists() and not overwrite:
        return "exists"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return "saved"


def count_text_assets(env):
    return sum(1 for obj in env.objects if obj.type.name == "TextAsset")


def extract_architecture(
    arch_key: str,
    arch: dict,
    entry: dict,
    out_dir: Path,
    overwrite: bool,
    limit: int,
):
    """提取并返回目标资源或数据。"""
    scripts_root = out_dir / "scripts"
    all_dir = scripts_root / arch["output"]
    direct_dir = scripts_root / arch["momotalk_output"]
    all_dir.mkdir(parents=True, exist_ok=True)
    direct_dir.mkdir(parents=True, exist_ok=True)

    env = load_bundle(entry["bundle"])
    declared_text_assets = count_text_assets(env)
    records = []
    direct_records = []
    errors = []
    used_all = set()
    used_direct = set()
    direct_extracted = 0
    processed = 0

    for obj in env.objects:
        if obj.type.name != "TextAsset":
            continue
        if limit and processed >= limit:
            break
        processed += 1
        try:
            data = obj.read()
            name = getattr(data, "m_Name", "") or f"TextAsset_{obj.path_id}.lua"
            blob = payload_bytes(getattr(data, "m_Script", None))
            digest = sha256(blob)
            record = {
                "architecture": arch["label"],
                "arch_key": arch_key,
                "asset": arch["asset"],
                "path_id": obj.path_id,
                "name": name,
                "size": len(blob),
                "sha256": digest,
                "luajit_bytecode": blob.startswith(b"\x1bLJ"),
            }

            output_path = build_target(all_dir, name, obj.path_id, used_all)
            status = write_bytes(output_path, blob, overwrite)
            record["output"] = str(output_path)
            record["output_status"] = status
            records.append(record)

            if name in DIRECT_MOMOTALK_SCRIPTS:
                direct_path = build_target(direct_dir, name, obj.path_id, used_direct)
                direct_status = write_bytes(direct_path, blob, overwrite)
                lua_refs, ui_refs = extract_references(blob)
                strings, strings_truncated = unique_ascii_strings(blob)
                direct_records.append(
                    {
                        **record,
                        "direct_output": str(direct_path),
                        "direct_output_status": direct_status,
                        "lua_references": lua_refs,
                        "ui_path_references": ui_refs,
                        "ascii_string_count": len(strings),
                        "ascii_strings_truncated": strings_truncated,
                        "ascii_strings": strings,
                    }
                )
                direct_extracted += 1
        except Exception as exc:
            errors.append(
                {
                    "architecture": arch["label"],
                    "arch_key": arch_key,
                    "path_id": obj.path_id,
                    "error": str(exc),
                }
            )

        if processed % 500 == 0:
            print(
                f"{arch['label']}: {processed}/{declared_text_assets} "
                f"direct={direct_extracted} errors={len(errors)}",
                flush=True,
            )

    return {
        "architecture": arch["label"],
        "arch_key": arch_key,
        "asset": arch["asset"],
        "bundle": str(entry["bundle"]),
        "bundle_size": entry["size"],
        "bundle_hash": entry["hash"],
        "declared_text_assets": declared_text_assets,
        "processed_text_assets": processed,
        "extracted_text_assets": len(records),
        "direct_momotalk_extracted": direct_extracted,
        "all_output_dir": str(all_dir),
        "momotalk_output_dir": str(direct_dir),
        "records": records,
        "direct_scripts": direct_records,
        "errors": errors,
    }


def build_momotalk_list(results, out_dir: Path):
    """构建momotalk_list所需的数据结构。"""
    by_name = {}
    for result in results:
        for record in result["direct_scripts"]:
            by_name.setdefault(record["name"], {})[record["arch_key"]] = record

    scripts = []
    missing = sorted(DIRECT_MOMOTALK_SCRIPTS - set(by_name))
    for name in sorted(DIRECT_MOMOTALK_SCRIPTS):
        variants = by_name.get(name, {})
        primary = variants.get("lua64") or next(iter(variants.values()), {})
        if not primary:
            continue
        scripts.append(
            {
                "name": name,
                "primary_architecture": primary.get("architecture"),
                "size": primary.get("size"),
                "sha256": primary.get("sha256"),
                "luajit_bytecode": primary.get("luajit_bytecode"),
                "lua_references": primary.get("lua_references", []),
                "ui_path_references": primary.get("ui_path_references", []),
                "ascii_string_count": primary.get("ascii_string_count", 0),
                "variants": {
                    key: {
                        "architecture": value.get("architecture"),
                        "size": value.get("size"),
                        "sha256": value.get("sha256"),
                        "luajit_bytecode": value.get("luajit_bytecode"),
                        "output": value.get("direct_output"),
                    }
                    for key, value in sorted(variants.items())
                },
            }
        )

    reference_counts = Counter()
    for script in scripts:
        for reference in script["lua_references"]:
            reference_counts[reference] += 1

    return {
        "expected_direct_script_count": len(DIRECT_MOMOTALK_SCRIPTS),
        "extracted_direct_script_count": len(scripts),
        "missing_direct_scripts": missing,
        "luajit_bytecode_count": sum(bool(item["luajit_bytecode"]) for item in scripts),
        "scripts": scripts,
        "lua_reference_counts": dict(reference_counts.most_common()),
    }


def markdown_list(manifest, momotalk_list):
    lines = [
        "# AetherGazer 弥弥尔通讯 / MomoTalk 脚本与资源清单",
        "",
        "## 提取结果",
        "",
        f"- 游戏版本：`{manifest.get('version', '?')}`，build `{manifest.get('build', '?')}`",
        f"- MomoTalk 直接脚本：`{momotalk_list['extracted_direct_script_count']}` / "
        f"`{momotalk_list['expected_direct_script_count']}`",
        "- 脚本格式：LuaJIT 字节码（文件头 `\\x1bLJ`），不是可直接阅读的明文 Lua",
        "",
    ]
    for arch in manifest["architectures"]:
        lines.extend(
            [
                f"### {arch['architecture']} ({arch['asset']})",
                "",
                f"- TextAsset：`{arch['extracted_text_assets']}` / "
                f"`{arch['declared_text_assets']}`",
                f"- MomoTalk 直连脚本：`{arch['direct_momotalk_extracted']}`",
                f"- 全量脚本目录：`{arch['all_output_dir']}`",
                f"- MomoTalk 脚本目录：`{arch['momotalk_output_dir']}`",
                f"- 错误：`{len(arch['errors'])}`",
                "",
            ]
        )

    lines.extend(["## MomoTalk 直连脚本", ""])
    for index, script in enumerate(momotalk_list["scripts"], start=1):
        lines.append(
            f"{index}. `{script['name']}` - {script['size']} bytes, "
            f"SHA-256 `{script['sha256']}`"
        )

    ui_refs = Counter()
    lua_refs = Counter()
    for script in momotalk_list["scripts"]:
        ui_refs.update(script["ui_path_references"])
        lua_refs.update(script["lua_references"])

    lines.extend(["", "## 已识别 UI / 资源路径", ""])
    if ui_refs:
        for reference, count in ui_refs.most_common():
            lines.append(f"- `{reference}` ({count})")
    else:
        lines.append("- 未从字节码 ASCII 常量中识别到 UI 路径")

    lines.extend(["", "## Lua 文件名引用候选", ""])
    if lua_refs:
        for reference, count in lua_refs.most_common():
            lines.append(f"- `{reference}` ({count})")
    else:
        lines.append("- 未从字节码中识别到 `.lua` 文件名引用")

    lines.extend(
        [
            "",
            "## 限制",
            "",
            "- 全量 TextAsset 已保留为原始 LuaJIT 字节码；本次没有修改、反编译或重新打包。",
            "- 引用候选来自字节码中的 ASCII 字符串扫描，能证明候选关系，但不能替代 LuaJIT 反编译后的调用图。",
            "- 若需要可读方法体，下一阶段应针对 LuaJIT 字节码做反汇编/反编译，而不是继续从 UI bundle 提取。",
            "",
        ]
    )
    return "\n".join(lines)


def main():
    """命令行主入口。"""
    parser = argparse.ArgumentParser(
        description=(
            "Extract AetherGazer scripts32/scripts64 LuaJIT TextAssets and build "
            "a MomoTalk script/resource inventory."
        )
    )
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument(
        "--arch",
        choices=["both", "lua64", "lua32"],
        default="both",
        help="Which script bundle to process (default: both).",
    )
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--limit", type=int, default=0, help="Debug-only TextAsset limit.")
    args = parser.parse_args()

    warnings.filterwarnings("ignore", message="No valid Unity version found.*")
    UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f3c1"

    data_dir = args.game_dir / "AetherGazer_Data" / "StreamingAssets" / "Windows"
    payload, entries = load_index(data_dir)
    selected_arches = (
        ARCHITECTURES
        if args.arch == "both"
        else {args.arch: ARCHITECTURES[args.arch]}
    )
    missing_entries = [
        arch["asset"]
        for arch in selected_arches.values()
        if arch["asset"] not in entries
    ]
    if missing_entries:
        raise KeyError(f"Missing script assets in index: {', '.join(missing_entries)}")

    started = time.time()
    results = []
    for arch_key, arch in selected_arches.items():
        entry = entries[arch["asset"]]
        print(
            f"extracting {arch['asset']} ({arch['label']}) "
            f"bundle={entry['bundle']} size={entry['size']}",
            flush=True,
        )
        results.append(
            extract_architecture(
                arch_key,
                arch,
                entry,
                args.out_dir,
                args.overwrite,
                args.limit,
            )
        )

    momotalk_list = build_momotalk_list(results, args.out_dir)
    manifest = {
        "game_dir": str(args.game_dir),
        "data_dir": str(data_dir),
        "out_dir": str(args.out_dir),
        "version": payload.get("versionName", ""),
        "build": payload.get("buildCode", ""),
        "elapsed_seconds": round(time.time() - started, 3),
        "architectures": results,
        "direct_momotalk_scripts": sorted(DIRECT_MOMOTALK_SCRIPTS),
        "totals": {
            "processed_text_assets": sum(item["processed_text_assets"] for item in results),
            "extracted_text_assets": sum(item["extracted_text_assets"] for item in results),
            "direct_momotalk_extracted": sum(
                item["direct_momotalk_extracted"] for item in results
            ),
            "errors": sum(len(item["errors"]) for item in results),
        },
    }

    scripts_root = args.out_dir / "scripts"
    manifest_path = scripts_root / "lua_manifest.json"
    momotalk_json_path = scripts_root / "lua_momotalk_list.json"
    momotalk_md_path = scripts_root / "lua_momotalk_list.md"
    write_json(manifest_path, manifest, True)
    write_json(momotalk_json_path, momotalk_list, True)
    write_text(momotalk_md_path, markdown_list(manifest, momotalk_list), True)

    header = (
        "These files are original LuaJIT bytecode extracted from AetherGazer.\n"
        "They are not plaintext Lua source. File signature: 1B 4C 4A (\\x1bLJ).\n"
    )
    for arch in selected_arches.values():
        for output_dir in (arch["output"], arch["momotalk_output"]):
            write_text(scripts_root / output_dir / "HEADER.txt", header, True)

    print(
        f"done elapsed={manifest['elapsed_seconds']}s "
        f"textassets={manifest['totals']['extracted_text_assets']} "
        f"momotalk={manifest['totals']['direct_momotalk_extracted']} "
        f"errors={manifest['totals']['errors']}",
        flush=True,
    )
    print(f"manifest={manifest_path}", flush=True)
    print(f"list={momotalk_md_path}", flush=True)


if __name__ == "__main__":
    main()
