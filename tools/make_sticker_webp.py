"""Build lossless animated WebP stickers from extracted chat sticker frames.

Compared with the GIF output this keeps the original RGBA alpha (soft edges
included), avoids palette quantization, and stores frame delays in exact
milliseconds instead of 10 ms centisecond steps.

The animation container is muxed here instead of using Pillow's ``save_all``
because libwebp's anim encoder silently merges consecutive pixel-identical
frames into one longer frame. Muxing the ANMF chunks manually keeps every
source PNG as its own WebP frame.
"""

import argparse
import io
import json
import struct
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

from make_sticker_gifs import (  # noqa: E402
    DEFAULT_DATA_DIR,
    DEFAULT_FPS,
    DEFAULT_FRAMES_DIR,
    clip_stop_time,
    collect_groups,
    load_index,
)

DEFAULT_OUT_DIR = Path(
    r"C:\Users\ori\OneDrive\文档\ChatGPT\adv解包\extract\aethergazer\chat_sticker_webp"
)


def frame_durations(stop_seconds: float, frame_count: int, fps: float):
    """Split the clip length into per-frame integer millisecond delays."""
    total_ms = max(frame_count, round(stop_seconds * 1000)) if stop_seconds else None
    if total_ms is None:
        base = max(1, round(1000.0 / fps))
        return [base] * frame_count, base * frame_count, f"fallback {fps:.0f} fps"
    base, remainder = divmod(total_ms, frame_count)
    durations = [base + (1 if index < remainder else 0) for index in range(frame_count)]
    return durations, sum(durations), f"clip {stop_seconds:.3f}s / {frame_count} frames"


def _iter_chunks(data: bytes):
    if data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        raise ValueError("not a RIFF/WEBP payload")
    offset = 12
    while offset + 8 <= len(data):
        fourcc = data[offset : offset + 4]
        size = struct.unpack("<I", data[offset + 4 : offset + 8])[0]
        yield fourcc, data[offset + 8 : offset + 8 + size]
        offset += 8 + size + (size & 1)


def _chunk(fourcc: bytes, payload: bytes) -> bytes:
    chunk = fourcc + struct.pack("<I", len(payload)) + payload
    if len(payload) & 1:
        chunk += b"\x00"
    return chunk


def _still_image_chunks(image: Image.Image, method: int):
    """Return the bitstream chunks (ALPH/VP8/VP8L) of a lossless still WebP."""
    buffer = io.BytesIO()
    image.save(buffer, format="WEBP", lossless=True, quality=100, method=method)
    found = [
        (fourcc, payload)
        for fourcc, payload in _iter_chunks(buffer.getvalue())
        if fourcc in (b"ALPH", b"VP8 ", b"VP8L")
    ]
    if not found:
        raise ValueError("encoded still frame has no image bitstream")
    return found


def _u24(value: int) -> bytes:
    return int(value).to_bytes(3, "little")


def build_webp(frames, durations, out_path: Path, method: int):
    """构建webp所需的数据结构。"""
    images = [Image.open(path).convert("RGBA") for _, path in frames]
    width, height = images[0].size
    has_alpha = any(image.getchannel("A").getextrema()[0] < 255 for image in images)

    flags = 0x02 | (0x10 if has_alpha else 0x00)
    vp8x = _chunk(
        b"VP8X",
        bytes([flags, 0, 0, 0]) + _u24(width - 1) + _u24(height - 1),
    )
    anim = _chunk(b"ANIM", b"\x00\x00\x00\x00" + struct.pack("<H", 0))

    frame_chunks = []
    for image, duration in zip(images, durations):
        payload = (
            _u24(0)
            + _u24(0)
            + _u24(width - 1)
            + _u24(height - 1)
            + _u24(duration)
            # bit 0: dispose to background, bit 1: do not blend
            + b"\x03"
        )
        for fourcc, chunk_payload in _still_image_chunks(image, method):
            payload += _chunk(fourcc, chunk_payload)
        frame_chunks.append(_chunk(b"ANMF", payload))

    body = vp8x + anim + b"".join(frame_chunks)
    riff = b"RIFF" + struct.pack("<I", len(body) + 4) + b"WEBP" + body
    out_path.write_bytes(riff)
    return (width, height)


GALLERY_HEAD = """<!DOCTYPE html>
<html lang="zh-CN">
<meta charset="utf-8">
<title>AetherGazer 动态聊天贴纸</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 24px;
    background: #14161a;
    color: #e6e8eb;
    font: 14px/1.5 "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
  }
  header {
    display: flex;
    align-items: baseline;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 18px;
  }
  h1 { font-size: 18px; margin: 0; font-weight: 600; }
  .meta { color: #8b929c; font-size: 13px; }
  .tools { margin-left: auto; display: flex; gap: 8px; }
  button {
    font: inherit;
    color: #e6e8eb;
    background: #24272e;
    border: 1px solid #363b44;
    border-radius: 6px;
    padding: 6px 12px;
    cursor: pointer;
  }
  button:hover { background: #2e323a; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 14px;
  }
  figure {
    margin: 0;
    background: #1c1f24;
    border: 1px solid #2b2f36;
    border-radius: 8px;
    overflow: hidden;
  }
  .stage {
    height: 190px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  body[data-bg="checker"] .stage {
    background-color: #fff;
    background-image:
      conic-gradient(#d7dbe0 25%, #ffffff 0 50%, #d7dbe0 0 75%, #ffffff 0);
    background-size: 20px 20px;
  }
  body[data-bg="light"] .stage { background: #ffffff; }
  body[data-bg="dark"] .stage { background: #0e1013; }
  img { width: 170px; height: 170px; display: block; }
  figcaption {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    border-top: 1px solid #2b2f36;
    font-size: 12px;
    color: #9aa1ab;
  }
  figcaption b { color: #e6e8eb; font-weight: 600; }
</style>
<body data-bg="checker">
<header>
  <h1>AetherGazer 动态聊天贴纸</h1>
  <span class="meta" id="meta"></span>
  <span class="tools">
    <button id="replay">重播全部</button>
    <button id="bg">切换背景</button>
  </span>
</header>
<div class="grid" id="grid"></div>
<script>
  const items = ITEMS_JSON;
  const grid = document.getElementById("grid");
  for (const it of items) {
    const fig = document.createElement("figure");
    fig.innerHTML =
      '<div class="stage"><img src="' + it.file + '" alt="' + it.group + '"></div>' +
      '<figcaption><b>' + it.group + '</b><span>' + it.frames + ' 帧 · ' + it.total + ' ms</span></figcaption>';
    grid.appendChild(fig);
  }
  document.getElementById("meta").textContent =
    items.length + " 组 · 240x240 · 无损 RGBA WebP";
  document.getElementById("replay").onclick = () => {
    for (const img of document.images) {
      const base = img.src.split("?")[0];
      img.src = base + "?t=" + Date.now();
    }
  };
  const order = ["checker", "light", "dark"];
  document.getElementById("bg").onclick = () => {
    const body = document.body;
    const next = order[(order.indexOf(body.dataset.bg) + 1) % order.length];
    body.dataset.bg = next;
  };
</script>
</body>
</html>
"""


def write_gallery(out_dir: Path, manifest):
    items = [
        {
            "file": Path(entry["output"]).name,
            "group": entry["group"],
            "frames": entry["frames"],
            "total": entry["total_ms"],
        }
        for entry in manifest
    ]
    payload = json.dumps(items, ensure_ascii=False, indent=2)
    html = GALLERY_HEAD.replace("ITEMS_JSON", payload)
    (out_dir / "_gallery.html").write_text(html, encoding="utf-8")


def main():
    """命令行主入口。"""
    parser = argparse.ArgumentParser(description="Build animated WebP chat stickers.")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--frames-dir", type=Path, default=DEFAULT_FRAMES_DIR)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--fps", type=float, default=DEFAULT_FPS, help="Fallback frame rate.")
    parser.add_argument("--method", type=int, default=6, help="Encoder effort, 0-6.")
    parser.add_argument("--only", action="append", help="Only build these group ids; repeatable.")
    args = parser.parse_args()

    entries = load_index(args.data_dir)
    groups = collect_groups(args.frames_dir)
    if args.only:
        wanted = set(args.only)
        groups = type(groups)((k, v) for k, v in groups.items() if k in wanted)
    if not groups:
        print("no sticker frame groups found", file=sys.stderr)
        return 1

    args.out_dir.mkdir(parents=True, exist_ok=True)
    manifest = []

    for group, frames in groups.items():
        stop, rate, source = clip_stop_time(entries, group)
        durations, total_ms, timing = frame_durations(stop or 0.0, len(frames), rate)

        out_path = args.out_dir / f"{group}.webp"
        size = build_webp(frames, durations, out_path, args.method)
        manifest.append(
            {
                "group": group,
                "frames": len(frames),
                "frame_durations_ms": durations,
                "total_ms": total_ms,
                "size": list(size),
                "timing": timing,
                "source": source,
                "output": str(out_path),
            }
        )
        print(f"{group}: {len(frames)} frames, {total_ms} ms total -> {out_path.name}")

    manifest_path = args.out_dir / "webp_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    write_gallery(args.out_dir, manifest)
    print(f"\n{len(manifest)} WebP stickers written to {args.out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
