from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Print alpha bounds per row/column for indexed images.")
    parser.add_argument("--index", default="mimirtalk_webui/data/asset_index.json")
    parser.add_argument("--names", nargs="+", required=True)
    parser.add_argument("--rows", type=int, default=12)
    parser.add_argument("--cols", type=int, default=12)
    return parser.parse_args()


def sample(values: list[int], count: int) -> list[int]:
    if len(values) <= count:
        return values
    last = len(values) - 1
    return [values[round(index * last / (count - 1))] for index in range(count)]


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
        alpha = image.getchannel("A")
        bbox = alpha.getbbox()
        print(f"\n{name} {image.width}x{image.height} alpha_bbox={bbox}")
        if not bbox:
            continue
        x0, y0, x1, y1 = bbox
        rows = []
        for y in range(y0, y1):
            xs = [x for x in range(x0, x1) if alpha.getpixel((x, y)) > 8]
            rows.append((min(xs), max(xs)) if xs else (None, None))
        cols = []
        for x in range(x0, x1):
            ys = [y for y in range(y0, y1) if alpha.getpixel((x, y)) > 8]
            cols.append((min(ys), max(ys)) if ys else (None, None))
        print("row x-min/x-max:", [f"{a}:{b}" if a is not None else "-" for a, b in sample(rows, args.rows)])
        print("col y-min/y-max:", [f"{a}:{b}" if a is not None else "-" for a, b in sample(cols, args.cols)])


if __name__ == "__main__":
    main()
