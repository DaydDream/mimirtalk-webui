"""scan_sticker_clips：资源或字符串扫描工具。"""
import io
import json
from pathlib import Path

import UnityPy

UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f3c1"

GAME_DIR = Path(r"C:\Program Files\AetherGazerLauncher\AetherGazer")
DATA_DIR = GAME_DIR / "AetherGazer_Data" / "StreamingAssets" / "Windows"


def load_index():
    """加载资源索引并建立路径映射。"""
    payload = json.loads((DATA_DIR / "AssetHash_Info.bytes").read_text(encoding="utf-8-sig"))
    entries = {}
    for raw in payload["assetHashList"]:
        asset_path, asset_hash, _ = raw.split("|", 2)
        entries[asset_path] = DATA_DIR / asset_hash[0] / asset_hash[1] / f"{asset_hash}.ys"
    return entries


def main():
    """命令行主入口。"""
    entries = load_index()
    targets = sorted(p for p in entries if p.startswith("dynamicsticker/"))
    print(f"total dynamicsticker entries: {len(targets)}")
    for path in targets:
        raw = entries[path].read_bytes()
        offset = raw.find(b"UnityFS")
        env = UnityPy.load(io.BytesIO(raw[offset:]))
        for obj in env.objects:
            if obj.type.name != "AnimationClip":
                continue
            tree = obj.read_typetree()
            stop = tree.get("m_MuscleClip", {}).get("m_StopTime")
            bindings = tree.get("m_ClipBindingConstant", {})
            nbind = len(bindings.get("genericBindings", [])) if isinstance(bindings, dict) else "?"
            curve_count = None
            clip = tree.get("m_MuscleClip", {}).get("m_Clip", {})
            if isinstance(clip, dict) and isinstance(clip.get("data"), dict):
                inner = clip["data"]
                curve_count = inner.get("m_StreamedClip", {}).get("curveCount")
            print(f"{path}\tstop={stop}\tstreamCurves={curve_count}\tbindings={nbind}")


if __name__ == "__main__":
    main()
