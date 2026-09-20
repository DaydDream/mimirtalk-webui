from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image


ASCII_RAMP = " .:-=+*#%@"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Print a compact ASCII preview of indexed transparent images.")
    parser.add_argument("--index", default="mimirtalk_webui/data/asset_index.json")
    parser.add_argument("--names", nargs="+", required=True)
    parser.add_argument("--width", type=int, default=48)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    data = json.loads(Path(args.index).read_text(encoding="utf-8"))
    by_name = {asset.get("name"): asset for asset in data["assets"]}

    for name in args.names:
        asset = by_name.get(name)
        if not asset:
            print(f"{name}: missing")
            continue
        image = Image.open(asset["path"]).convert("RGBA")
        aspect = image.height / image.width
        width = min(args.width, image.width)
        height = max(1, round(width * aspect * 0.5))
        sample = image.resize((width, height), Image.Resampling.LANCZOS)
        alpha_bbox = image.getchannel("A").getbbox()
        print(f"\n{name} {image.width}x{image.height} alpha_bbox={alpha_bbox}")
        for y in range(height):
            row = []
            for x in range(width):
                r, g, b, a = sample.getpixel((x, y))
                if a < 12:
                    row.append(" ")
                    continue
                luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
                ink = (1 - luminance) * (a / 255)
                row.append(ASCII_RAMP[min(len(ASCII_RAMP) - 1, max(1, round(ink * (len(ASCII_RAMP) - 1))))])
            print("".join(row).rstrip())


if __name__ == "__main__":
    main()
