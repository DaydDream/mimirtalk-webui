"""inspect_facetimeline：Unity、二进制或配置结构检查工具。"""
import io
import json
from pathlib import Path

import UnityPy

UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f3c1"

DATA_DIR = Path(
    r"C:\Program Files\AetherGazerLauncher\AetherGazer\AetherGazer_Data\StreamingAssets\Windows"
)


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
    target = "comchar/oath/facetimeline/104903/104903ui@wedding_emoji0.ys"
    raw = entries[target].read_bytes()
    offset = raw.find(b"UnityFS")
    env = UnityPy.load(io.BytesIO(raw[offset:]))
    for obj in env.objects:
        print("=== ", obj.type.name, obj.path_id)
        try:
            tree = obj.read_typetree()
        except Exception as exc:  # noqa: BLE001
            print("  typetree err", exc)
            continue
        text = json.dumps(tree, ensure_ascii=False, default=str)
        print("  ", text[:1500])


if __name__ == "__main__":
    main()
