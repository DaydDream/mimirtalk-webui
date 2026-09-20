"""extract_aethergazer_videos：深空之眼专项资源提取脚本，负责扫描资源包并输出图像或结构数据。"""
import argparse
import json
import time
from collections import Counter
from pathlib import Path


DEFAULT_GAME_DIR = Path(r"C:\Program Files\AetherGazerLauncher\AetherGazer")
DEFAULT_OUT_DIR = Path(r"C:\Users\ori\OneDrive\文档\ChatGPT\adv解包\extract\aethergazer")

PRESETS = {
    "story": ["SofdecAsset/story/"],
    "activity": ["SofdecAsset/activity/"],
    "function": ["SofdecAsset/function/"],
    "all": ["SofdecAsset/"],
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


def selected_entries(entries, prefixes):
    selected = []
    for prefix in prefixes:
        selected.extend(
            (path, entry)
            for path, entry in entries.items()
            if path.startswith(prefix)
        )
    return sorted(selected, key=lambda item: item[0])


def output_path(out_dir: Path, preset: str, asset_path: str) -> Path:
    relative = Path(asset_path)
    if relative.suffix.lower() != ".usm":
        relative = relative.with_suffix(".usm")
    return out_dir / preset / relative


def extract_usm(bundle_path: Path, destination: Path, overwrite: bool):
    """提取并返回目标资源或数据。"""
    raw = bundle_path.read_bytes()
    offset = raw.find(b"CRID")
    if offset < 0:
        raise ValueError("CRID signature not found")

    payload = raw[offset:]
    if destination.exists() and not overwrite:
        return len(payload), "exists"

    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(payload)
    return len(payload), "saved"


def main():
    """命令行主入口。"""
    parser = argparse.ArgumentParser(
        description="Export raw CRI USM story and activity videos from AetherGazer .ys assets."
    )
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--preset", choices=sorted(PRESETS), default="story")
    parser.add_argument("--prefix", action="append", help="Override/extend asset path prefixes.")
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    data_dir = args.game_dir / "AetherGazer_Data" / "StreamingAssets" / "Windows"
    prefixes = args.prefix or PRESETS[args.preset]
    payload, entries = load_index(data_dir)
    selected = selected_entries(entries, prefixes)
    if args.limit:
        selected = selected[: args.limit]

    report_path = args.report or (args.out_dir / f"{args.preset}_video_manifest.json")
    started = time.time()
    counts = Counter()
    outputs = []
    errors = []

    print(
        f"version={payload.get('versionName', '?')} build={payload.get('buildCode', '?')} "
        f"selected={len(selected)} out={args.out_dir}",
        flush=True,
    )

    for position, (asset_path, entry) in enumerate(selected, start=1):
        destination = output_path(args.out_dir, args.preset, asset_path)
        try:
            size, status = extract_usm(entry["bundle"], destination, args.overwrite)
            counts[status] += 1
            outputs.append(
                {
                    "asset": asset_path,
                    "bundle": str(entry["bundle"]),
                    "output": str(destination),
                    "bytes": size,
                    "status": status,
                }
            )
        except Exception as exc:
            errors.append({"asset": asset_path, "bundle": str(entry["bundle"]), "error": str(exc)})
            print(f"ERROR {asset_path}: {exc}", flush=True)

        if position % 10 == 0 or position == len(selected):
            elapsed = time.time() - started
            speed = position / elapsed if elapsed else 0
            print(
                f"[{position}/{len(selected)}] saved={counts['saved']} exists={counts['exists']} "
                f"errors={len(errors)} speed={speed:.2f}/s elapsed={elapsed:.1f}s",
                flush=True,
            )

    report = {
        "game_dir": str(args.game_dir),
        "data_dir": str(data_dir),
        "out_dir": str(args.out_dir),
        "preset": args.preset,
        "prefixes": prefixes,
        "selected_count": len(selected),
        "saved_count": counts["saved"],
        "existing_count": counts["exists"],
        "error_count": len(errors),
        "elapsed_seconds": round(time.time() - started, 3),
        "outputs": outputs,
        "errors": errors,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        f"done saved={report['saved_count']} existing={report['existing_count']} "
        f"errors={report['error_count']} manifest={report_path}",
        flush=True,
    )
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
