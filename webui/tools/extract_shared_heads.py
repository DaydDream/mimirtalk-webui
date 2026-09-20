"""提取共享角色头像和通用头像素材，生成供 WebUI 使用的头像资源。"""
from __future__ import annotations

import argparse
import io
import json
import re
import time
import warnings
from pathlib import Path

import UnityPy


DEFAULT_GAME_DIR = Path(r"C:\Program Files\AetherGazerLauncher\AetherGazer")
WORKSPACE_DIR = Path(__file__).resolve().parents[2]
DEFAULT_OUT_DIR = WORKSPACE_DIR / "extract" / "aethergazer_momotalk_shared_heads"

HEAD_GROUPS = {
    "textureconfig/character/itemshead/": "character_itemshead",
}


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


def safe_name(value: str) -> str:
    """清理文件名中的非法字符。"""
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value)
    value = value.strip(" .")
    return value or "unnamed"


def safe_asset_key(asset_path: str) -> str:
    """生成安全的素材键。"""
    return safe_name(asset_path.removesuffix(".ys").replace("/", "_"))


def load_bundle(bundle_path: Path):
    """读取并加载 UnityFS 资源包。"""
    raw = bundle_path.read_bytes()
    offset = raw.find(b"UnityFS")
    if offset < 0:
        raise ValueError("UnityFS signature not found")
    return UnityPy.load(io.BytesIO(raw[offset:]))


def extract_images(asset_path: str, bundle_path: Path, out_dir: Path, overwrite: bool):
    """提取资源包中的贴图和精灵图片。"""
    env = load_bundle(bundle_path)
    group = next(
        group_name
        for prefix, group_name in HEAD_GROUPS.items()
        if asset_path.startswith(prefix)
    )
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

            name = safe_name(getattr(data, "m_Name", "") or str(obj.path_id))
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
                    "output": str(output_path.relative_to(WORKSPACE_DIR)).replace("\\", "/"),
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


def main() -> int:
    """命令行主入口。"""
    parser = argparse.ArgumentParser(
        description=(
            "Extract AetherGazer shared character avatar pools for the MimirTalk WebUI."
        )
    )
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--include-naive", action="store_true")
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    warnings.filterwarnings("ignore", message="No valid Unity version found.*")
    UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f3c1"

    data_dir = args.game_dir / "AetherGazer_Data" / "StreamingAssets" / "Windows"
    payload, entries = load_index(data_dir)
    selected = [
        (path, entry)
        for path, entry in sorted(entries.items())
        if any(path.startswith(prefix) for prefix in HEAD_GROUPS)
        and (args.include_naive or "$naive" not in path.lower())
    ]
    if args.limit:
        selected = selected[: args.limit]

    args.out_dir.mkdir(parents=True, exist_ok=True)
    started = time.time()
    outputs = []
    errors = []

    print(
        f"version={payload.get('versionName', '?')} build={payload.get('buildCode', '?')} "
        f"selected={len(selected)} out={args.out_dir}",
        flush=True,
    )

    for position, (asset_path, entry) in enumerate(selected, start=1):
        try:
            asset_outputs, asset_errors = extract_images(
                asset_path,
                entry["bundle"],
                args.out_dir,
                args.overwrite,
            )
            outputs.extend(asset_outputs)
            errors.extend(
                {
                    "asset": asset_path,
                    **error,
                }
                for error in asset_errors
            )
            if position == 1 or position % 25 == 0 or position == len(selected):
                print(
                    f"[{position}/{len(selected)}] {asset_path} "
                    f"images={len(asset_outputs)}",
                    flush=True,
                )
        except Exception as exc:
            errors.append({"asset": asset_path, "stage": "asset", "error": str(exc)})
            print(f"ERROR {asset_path}: {exc}", flush=True)

    report = {
        "version": 1,
        "game_version": payload.get("versionName"),
        "build": payload.get("buildCode"),
        "out_dir": str(args.out_dir.relative_to(WORKSPACE_DIR)).replace("\\", "/"),
        "selected_count": len(selected),
        "processed_count": len(selected) - len(
            [error for error in errors if error.get("stage") == "asset"]
        ),
        "image_count": len(outputs),
        "saved_image_count": sum(1 for item in outputs if item["status"] == "saved"),
        "existing_image_count": sum(1 for item in outputs if item["status"] == "exists"),
        "error_count": len(errors),
        "elapsed_seconds": round(time.time() - started, 3),
        "groups": {
            group: sum(1 for item in outputs if item["group"] == group)
            for group in sorted(set(HEAD_GROUPS.values()))
        },
        "outputs": outputs,
        "errors": errors,
    }
    report_path = args.out_dir / "manifest.json"
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(
        f"done assets={report['processed_count']} images={report['image_count']} "
        f"errors={report['error_count']} manifest={report_path}",
        flush=True,
    )
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
