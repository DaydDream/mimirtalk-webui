"""inspect_eainfo_packages：Unity、二进制或配置结构检查工具。"""
from __future__ import annotations

import json
import re
import struct
from pathlib import Path

import UnityPy


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "extract" / "aethergazer" / "_usm_probe"
INSTALL = Path(r"C:\Program Files\AetherGazerLauncher\AetherGazer\AetherGazer_Data")
STREAMING = INSTALL / "StreamingAssets" / "Windows"


def find_unityfs_offset(data: bytes) -> int:
    idx = data.find(b"UnityFS")
    if idx < 0:
        raise ValueError("UnityFS signature not found")
    return idx


def read_eainfo() -> dict:
    raw = (OUT / "bundle_eainfo.json").read_text(encoding="utf-8")
    data = json.loads(raw)
    for obj in data["matched_objects"]:
        if obj.get("type") == "TextAsset" and obj.get("name") == "EAInfo":
            return json.loads(obj["data"]["m_Script"])
    raise ValueError("EAInfo TextAsset not found")


def load_asset_hash() -> dict[str, str]:
    """加载asset_hash数据。"""
    path = STREAMING / "AssetHash_Info.bytes"
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    out: dict[str, str] = {}
    for item in data.get("assetHashList", []):
        if isinstance(item, str):
            parts = item.split("|")
            if len(parts) >= 2:
                out[parts[0].replace("\\", "/").lower()] = parts[1].lower()
        elif isinstance(item, dict):
            name = item.get("assetName") or item.get("name") or item.get("path")
            digest = item.get("hash") or item.get("md5") or item.get("assetHash")
            if name and digest:
                out[str(name).replace("\\", "/").lower()] = str(digest).lower()
        elif isinstance(item, list) and len(item) >= 2:
            out[str(item[0]).replace("\\", "/").lower()] = str(item[1]).lower()
    return out


def resolve_hashed_file(digest: str) -> Path:
    return STREAMING / digest[0] / digest[1] / f"{digest}.ys"


def extract_cri_objects(bundle_path: Path, max_items: int = 80) -> dict:
    """提取并返回目标资源或数据。"""
    raw = bundle_path.read_bytes()
    offset = find_unityfs_offset(raw)
    env = UnityPy.load(raw[offset:])
    result: dict[str, object] = {
        "path": str(bundle_path),
        "size": len(raw),
        "unityfs_offset": offset,
        "objects": [],
        "raw_hits": [],
    }
    needles = [
        b"CriWareDecrypter",
        b"enableAtomDecryption",
        b"enableManaDecryption",
        b"decryptKey",
        b"keyNum",
        b"CriMana",
        b"P08.Base",
    ]
    for needle in needles:
        start = 0
        while len(result["raw_hits"]) < max_items:
            pos = raw.find(needle, start)
            if pos < 0:
                break
            result["raw_hits"].append(
                {
                    "needle": needle.decode("ascii", "replace"),
                    "offset": pos,
                    "context_hex": raw[max(0, pos - 32) : pos + 160].hex(),
                }
            )
            start = pos + 1

    for obj in env.objects:
        item = {"type": obj.type.name, "path_id": getattr(obj, "path_id", None)}
        try:
            parsed = obj.read()
        except Exception as exc:  # noqa: BLE001
            item["read_error"] = f"{type(exc).__name__}: {exc}"
            result["objects"].append(item)
            continue

        for attr in ("m_Name", "name"):
            value = getattr(parsed, attr, None)
            if isinstance(value, str):
                item["name"] = value
                break

        data = {}
        for key in (
            "m_Script",
            "m_Name",
            "name",
            "decryptKey",
            "keyNum",
            "enableAtomDecryption",
            "enableManaDecryption",
            "m_AssemblyName",
            "m_ClassName",
            "m_Namespace",
        ):
            if hasattr(parsed, key):
                value = getattr(parsed, key)
                if isinstance(value, bytes):
                    data[key] = value.hex()
                elif isinstance(value, str):
                    data[key] = value[:4000]
                else:
                    data[key] = repr(value)
        if isinstance(getattr(parsed, "m_Script", None), str):
            script = parsed.m_Script
            item["script_hits"] = [
                needle.decode("ascii")
                for needle in needles
                if needle.decode("ascii") in script
            ]
        if data:
            item["data"] = data

        if len(result["objects"]) < 300:
            result["objects"].append(item)
    return result


def clean_for_json(value):
    if isinstance(value, str):
        return value.encode("utf-8", "surrogatepass").decode("utf-8", "replace")
    if isinstance(value, list):
        return [clean_for_json(item) for item in value]
    if isinstance(value, dict):
        return {clean_for_json(k): clean_for_json(v) for k, v in value.items()}
    return value


def main() -> None:
    """命令行主入口。"""
    eainfo = read_eainfo()
    hashes = load_asset_hash()
    names = eainfo.get("aots", []) + eainfo.get("hotfixs", [])
    mapped = []
    seen = set()
    for name in names:
        key = name.replace("\\", "/").lower()
        digest = hashes.get(key)
        if digest is None and key.endswith(".bytes"):
            digest = hashes.get(key[:-6] + ".ys")
        if digest is None and key.startswith("splash/"):
            digest = hashes.get("assets/abresources/" + key)
        entry = {"name": name, "hash": digest, "exists": False, "path": None}
        if digest:
            path = resolve_hashed_file(digest)
            entry["exists"] = path.exists()
            entry["path"] = str(path)
            if path.exists() and digest not in seen:
                seen.add(digest)
                try:
                    entry["bundle"] = extract_cri_objects(path)
                except Exception as exc:  # noqa: BLE001
                    entry["bundle_error"] = f"{type(exc).__name__}: {exc}"
        mapped.append(entry)
    report = {
        "streaming_assets": str(STREAMING),
        "asset_hash_count": len(hashes),
        "eainfo_name_count": len(names),
        "mapped": mapped,
    }
    out = OUT / "eainfo_package_scan.json"
    out.write_text(
        json.dumps(clean_for_json(report), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(out)
    for item in mapped:
        print(item["name"], item.get("hash"), item.get("exists"), item.get("bundle_error", ""))


if __name__ == "__main__":
    main()
