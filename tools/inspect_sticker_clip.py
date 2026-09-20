"""inspect_sticker_clip：Unity、二进制或配置结构检查工具。"""
import io
import json
import sys
from pathlib import Path

import UnityPy

UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f3c1"

GAME_DIR = Path(r"C:\Program Files\AetherGazerLauncher\AetherGazer")
DATA_DIR = GAME_DIR / "AetherGazer_Data" / "StreamingAssets" / "Windows"


def load_index():
    """加载资源索引并建立路径映射。"""
    index_path = DATA_DIR / "AssetHash_Info.bytes"
    payload = json.loads(index_path.read_text(encoding="utf-8-sig"))
    entries = {}
    for raw in payload["assetHashList"]:
        asset_path, asset_hash, size_text = raw.split("|", 2)
        entries[asset_path] = DATA_DIR / asset_hash[0] / asset_hash[1] / f"{asset_hash}.ys"
    return entries


def load_env(bundle_path: Path):
    """加载env数据。"""
    raw = bundle_path.read_bytes()
    offset = raw.find(b"UnityFS")
    return UnityPy.load(io.BytesIO(raw[offset:]))


def main():
    """命令行主入口。"""
    target = sys.argv[1] if len(sys.argv) > 1 else "dynamicsticker/1020_01@zh_cn.ys"
    entries = load_index()
    bundle = entries[target]
    env = load_env(bundle)
    for obj in env.objects:
        print("=== ", obj.type.name)
        data = obj.read()
        if obj.type.name == "AnimationClip":
            try:
                tree = obj.read_typetree()
                mc = tree.get("m_MuscleClip", {})
                print("  muscle keys:", list(mc.keys()))
                for key in ("m_StartTime", "m_StopTime", "m_AverageSpeed", "m_IndexArray"):
                    if key in mc:
                        val = mc[key]
                        if isinstance(val, list):
                            print(f"  {key}: list len={len(val)} first={val[:12]}")
                        else:
                            print(f"  {key}: {val}")
                for key in ("m_Clip", "m_ConstantClip", "m_DenseClip"):
                    if key in mc:
                        print(f"  {key}:", json.dumps(mc[key], indent=1, ensure_ascii=False)[:4000])
                if isinstance(mc.get("m_Clip"), dict):
                    for sub in ("m_DenseClip", "m_ConstantClip", "m_IndexArray", "m_SampleArray"):
                        if sub in mc["m_Clip"]:
                            print(f"  clip.{sub}:", json.dumps(mc["m_Clip"][sub], indent=1, ensure_ascii=False)[:3000])
                print("  top keys:", list(tree.keys()))
            except Exception as exc:  # noqa: BLE001
                print("  typetree err:", exc)
            print("  m_Name:", getattr(data, "m_Name", None))
            print("  m_SampleRate:", getattr(data, "m_SampleRate", None))
            print("  m_FrameCount:", getattr(data, "m_FrameCount", None))
            for attr in ("m_PositionCurves", "m_ScaleCurves", "m_RotationCurves",
                         "m_EulerCurves", "m_FloatCurves", "m_PPtrCurves"):
                val = getattr(data, attr, None)
                try:
                    n = len(val) if val is not None else None
                except TypeError:
                    n = "?"
                print(f"  {attr}: len={n}")
            muscle = getattr(data, "m_MuscleClip", None)
            print("  m_MuscleClip:", type(muscle))
            try:
                dd = data.m_MuscleClip.m_Clip.m_DenseClip
                print("   DenseClip:", dd)
            except Exception as exc:  # noqa: BLE001
                print("   DenseClip err:", exc)
            try:
                cc = data.m_MuscleClip.m_Clip.m_ConstantClip
                print("   ConstantClip:", cc)
            except Exception as exc:  # noqa: BLE001
                print("   ConstantClip err:", exc)
            try:
                print("   raw dict keys:", list(data.m_MuscleClip.keys()))
            except Exception as exc:  # noqa: BLE001
                print("   raw err:", exc)
        elif obj.type.name == "MonoBehaviour":
            print("  m_Name:", getattr(data, "m_Name", None))
            try:
                tree = data.m_Script.read().m_ClassName
            except Exception:
                tree = "?"
            print("  script:", tree)
        else:
            print("  m_Name:", getattr(data, "m_Name", None))


if __name__ == "__main__":
    main()
