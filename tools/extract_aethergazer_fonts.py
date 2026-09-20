"""extract_aethergazer_fonts：深空之眼专项资源提取脚本，负责扫描资源包并输出图像或结构数据。"""
from __future__ import annotations
import argparse, json, sys
from pathlib import Path
import UnityPy
WORKSPACE = Path(__file__).resolve().parents[1]
TOOLS_DIR = Path(__file__).resolve().parent
DEFAULT_GAME_DIR = Path(r"C:\Program Files\AetherGazerLauncher\AetherGazer")
DEFAULT_OUT = WORKSPACE / "mimirtalk_webui" / "frontend" / "assets" / "fonts"
FONTS = {
    "fonts/sourcehansans.ys": {"name": "SourceHanSans", "output": "source-han-sans.ttf"},
    "fonts/sourcehanserifcn-bold-3.ys": {"name": "SourceHanSerifCN-Bold-3.0", "output": "source-han-serif-cn-bold.ttf"},
}


def main() -> int:
    """命令行主入口。"""
    parser = argparse.ArgumentParser(description="Extract AetherGazer UI fonts from AssetHash bundles.")
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f3c1"
    sys.path.insert(0, str(TOOLS_DIR))
    from extract_aethergazer_momotalk import load_bundle, load_index
    data_dir = args.game_dir / "AetherGazer_Data" / "StreamingAssets" / "Windows"
    _, entries = load_index(data_dir)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    manifest = []
    for asset_path, spec in FONTS.items():
        entry = entries.get(asset_path)
        if entry is None:
            raise SystemExit(f"Font asset not found: {asset_path}")
        env = load_bundle(entry["bundle"])
        selected = None
        for obj in env.objects:
            if obj.type.name != "Font":
                continue
            data = obj.read_typetree()
            if data.get("m_Name") == spec["name"]:
                selected = data
                break
        if selected is None:
            raise SystemExit(f"Font object not found in {asset_path}: {spec['name']}")
        font_bytes = bytes(selected.get("m_FontData") or [])
        if not font_bytes:
            raise SystemExit(f"Font data is empty: {asset_path}")
        output = args.out_dir / spec["output"]
        if args.overwrite or not output.exists():
            output.write_bytes(font_bytes)
        manifest.append({"asset": asset_path, "font_name": spec["name"], "output": str(output.relative_to(WORKSPACE)).replace("\\", "/"), "bytes": len(font_bytes)})
    report = args.out_dir / "manifest.json"
    report.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
