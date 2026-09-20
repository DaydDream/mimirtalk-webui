"""生成素材联系表，便于人工检查素材分类和图像内容。"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def parse_args() -> argparse.Namespace:
    """解析命令行参数。"""
    parser = argparse.ArgumentParser(description="Build a labelled contact sheet from selected indexed assets.")
    parser.add_argument("--index", default="mimirtalk_webui/data/asset_index.json")
    parser.add_argument("--output", default="output/stage4/asset-sheet.png")
    parser.add_argument("--names", nargs="*", default=None)
    parser.add_argument("--categories", nargs="*", default=["atlas", "widgets"])
    parser.add_argument("--name-contains", default=None)
    parser.add_argument("--cell", type=int, default=220)
    parser.add_argument("--columns", type=int, default=5)
    return parser.parse_args()


def fit_contain(image: Image.Image, box: tuple[int, int]) -> Image.Image:
    """按等比缩放将图片放入指定尺寸。"""
    copy = image.copy()
    copy.thumbnail(box, Image.Resampling.LANCZOS)
    return copy


def main() -> None:
    """命令行主入口。"""
    args = parse_args()
    index_path = Path(args.index)
    output_path = Path(args.output)
    data = json.loads(index_path.read_text(encoding="utf-8"))

    wanted_names = set(args.names or [])
    categories = set(args.categories or [])
    items = []
    for asset in data["assets"]:
        name = asset.get("name", "")
        if categories and asset.get("category") not in categories:
            continue
        if wanted_names and name not in wanted_names:
            continue
        if args.name_contains and args.name_contains not in name:
            continue
        items.append(asset)

    if not items:
        raise SystemExit("No matching assets.")

    label_height = 34
    row_height = args.cell + label_height
    rows = (len(items) + args.columns - 1) // args.columns
    sheet = Image.new("RGBA", (args.columns * args.cell, rows * row_height), (35, 39, 46, 255))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()

    for index, asset in enumerate(items):
        source = Image.open(asset["path"]).convert("RGBA")
        tile = Image.new("RGBA", (args.cell, args.cell), (230, 234, 240, 255))
        tile_draw = ImageDraw.Draw(tile)
        for y in range(0, args.cell, 16):
            for x in range(0, args.cell, 16):
                if (x // 16 + y // 16) % 2 == 0:
                    tile_draw.rectangle((x, y, x + 15, y + 15), fill=(208, 214, 223, 255))

        preview = fit_contain(source, (args.cell - 20, args.cell - 20))
        tile.alpha_composite(preview, ((args.cell - preview.width) // 2, (args.cell - preview.height) // 2))

        column = index % args.columns
        row = index // args.columns
        x = column * args.cell
        y = row * row_height
        sheet.alpha_composite(tile, (x, y))
        label = f"{asset.get('name')} {asset.get('width')}x{asset.get('height')}"
        draw.text((x + 6, y + args.cell + 8), label, fill=(245, 247, 250, 255), font=font)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output_path)
    print(output_path)


if __name__ == "__main__":
    main()
