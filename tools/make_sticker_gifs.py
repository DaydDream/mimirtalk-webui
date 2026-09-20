"""Build animated GIFs from extracted AetherGazer dynamic chat sticker frames.

Input frames live in `extract/aethergazer/chat_sticker0917` and are named like
`1020_01_03@zh_cn.png`. Each group of frames becomes one GIF whose total loop
length matches the Unity AnimationClip duration when that metadata is
available; otherwise a 30 fps default is used.
"""

import argparse
import io
import json
import re
import sys
from collections import OrderedDict
from pathlib import Path

import UnityPy
from PIL import Image

UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f3c1"

DEFAULT_DATA_DIR = Path(
    r"C:\Program Files\AetherGazerLauncher\AetherGazer\AetherGazer_Data\StreamingAssets\Windows"
)
DEFAULT_FRAMES_DIR = Path(
    r"C:\Users\ori\OneDrive\文档\ChatGPT\adv解包\extract\aethergazer\chat_sticker0917"
)
DEFAULT_OUT_DIR = Path(
    r"C:\Users\ori\OneDrive\文档\ChatGPT\adv解包\extract\aethergazer\chat_sticker_gif"
)

FRAME_RE = re.compile(r"^(?P<group>\d{4}_\d{2})_(?P<index>\d{2})(?:@[a-z_]+)?\.png$", re.IGNORECASE)
DEFAULT_FPS = 30.0
GIF_MIN_MS = 20


def load_index(data_dir: Path):
    """加载资源索引并建立路径映射。"""
    payload = json.loads((data_dir / "AssetHash_Info.bytes").read_text(encoding="utf-8-sig"))
    entries = {}
    for raw in payload["assetHashList"]:
        asset_path, asset_hash, _ = raw.split("|", 2)
        entries[asset_path] = data_dir / asset_hash[0] / asset_hash[1] / f"{asset_hash}.ys"
    return entries


def clip_stop_time(entries, group: str):
    for candidate in (f"dynamicsticker/{group}@zh_cn.ys", f"dynamicsticker/{group}.ys"):
        bundle = entries.get(candidate)
        if bundle is None or not bundle.is_file():
            continue
        raw = bundle.read_bytes()
        offset = raw.find(b"UnityFS")
        if offset < 0:
            continue
        env = UnityPy.load(io.BytesIO(raw[offset:]))
        for obj in env.objects:
            if obj.type.name != "AnimationClip":
                continue
            tree = obj.read_typetree()
            stop = tree.get("m_MuscleClip", {}).get("m_StopTime")
            rate = tree.get("m_SampleRate") or DEFAULT_FPS
            if stop:
                return float(stop), float(rate), candidate
    return None, DEFAULT_FPS, None


def collect_groups(frames_dir: Path):
    groups = OrderedDict()
    for path in sorted(frames_dir.glob("*.png")):
        match = FRAME_RE.match(path.name)
        if not match:
            continue
        groups.setdefault(match.group("group"), []).append((int(match.group("index")), path))
    for group in groups:
        groups[group].sort(key=lambda item: item[0])
    return groups


def frame_to_palette(image: Image.Image, threshold: int = 128):
    """Convert RGBA to a P-mode frame with index 255 reserved for transparency."""
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    palette_frame = rgba.convert("RGB").quantize(colors=255, method=Image.MEDIANCUT)
    # Pillow blends pasted values by mask/255, so the mask must be 0/255.
    transparent_mask = alpha.point(lambda value: 0 if value >= threshold else 255)
    palette_frame.paste(255, transparent_mask)
    palette_frame.info["transparency"] = 255
    return palette_frame


def build_gif(frames, duration_ms: int, out_path: Path):
    """构建gif所需的数据结构。"""
    converted = [frame_to_palette(Image.open(path)) for _, path in frames]
    converted[0].save(
        out_path,
        format="GIF",
        save_all=True,
        append_images=converted[1:],
        duration=duration_ms,
        loop=0,
        transparency=255,
        disposal=2,
        optimize=False,
    )
    return converted[0].size


def main():
    """命令行主入口。"""
    parser = argparse.ArgumentParser(description="Build GIFs from dynamic chat sticker frames.")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--frames-dir", type=Path, default=DEFAULT_FRAMES_DIR)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--fps", type=float, default=DEFAULT_FPS, help="Fallback frame rate.")
    parser.add_argument("--only", action="append", help="Only build these group ids; repeatable.")
    args = parser.parse_args()

    entries = load_index(args.data_dir)
    groups = collect_groups(args.frames_dir)
    if args.only:
        wanted = set(args.only)
        groups = OrderedDict((k, v) for k, v in groups.items() if k in wanted)
    if not groups:
        print("no sticker frame groups found", file=sys.stderr)
        return 1

    args.out_dir.mkdir(parents=True, exist_ok=True)
    manifest = []
    fallback_ms = round(1000.0 / args.fps / 10) * 10

    for group, frames in groups.items():
        stop, rate, source = clip_stop_time(entries, group)
        if stop:
            # GIF stores frame delays in centiseconds, so round to 10 ms steps.
            duration_ms = max(GIF_MIN_MS, round((stop / len(frames)) * 1000 / 10) * 10)
            timing = f"clip {stop:.3f}s / {len(frames)} frames"
        else:
            duration_ms = max(GIF_MIN_MS, round(1000.0 / rate / 10) * 10)
            timing = f"fallback {rate:.0f} fps"

        out_path = args.out_dir / f"{group}.gif"
        size = build_gif(frames, duration_ms, out_path)
        total_ms = duration_ms * len(frames)
        manifest.append(
            {
                "group": group,
                "frames": len(frames),
                "duration_ms_per_frame": duration_ms,
                "total_ms": total_ms,
                "size": list(size),
                "timing": timing,
                "source": source,
                "output": str(out_path),
            }
        )
        print(f"{group}: {len(frames)} frames, {duration_ms} ms/frame -> {out_path.name}")

    manifest_path = args.out_dir / "gif_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n{len(manifest)} GIFs written to {args.out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
