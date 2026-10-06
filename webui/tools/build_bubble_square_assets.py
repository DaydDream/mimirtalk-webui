#!/usr/bin/env python3
"""Build square (tail-less) bubble assets for MimirTalk WebUI.

The game ships each chat bubble as a single Texture2D that contains the body
frame, edge decorations and a tail pointing at the sender.  Consecutive messages
need the same frame without the tail, so this tool removes only the tail pixels
and rebuilds the frame edge that the tail covered.

Usage:
    python tools/build_bubble_square_assets.py --analyze
    python tools/build_bubble_square_assets.py
    python tools/build_bubble_square_assets.py --contact-sheet
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

TOOLS_DIR = Path(__file__).resolve().parent
WEBUI_DIR = TOOLS_DIR.parent
WORKSPACE_DIR = WEBUI_DIR.parent

THEMES_PATH = WEBUI_DIR / "data" / "bubble_themes.json"
ASSET_INDEX_PATH = WEBUI_DIR / "data" / "asset_index.json"
OUTPUT_DIR = WEBUI_DIR / "frontend" / "assets" / "bubbles"

ALPHA_THRESHOLD = 8
EDGE_REPAIR_WIDTH = 6
# Unity m_Border may describe the whole texture, which leaves a zero sized
# nine-slice center.  CSS border-image and the canvas exporter both need a real
# center or the frame collapses into four disconnected corners.
MIN_SLICE_CENTER = 1

# Tail row range per (theme id, side).  Ranges are derived from the per-row
# alpha extent of the source art; edge decorations that stick out on the same
# side are deliberately excluded so they survive into the square variant.
TAIL_RANGES: dict[tuple[str, str], tuple[int, int]] = {
    ("9000", "left"): (28, 56),
    ("9000", "right"): (28, 56),
    ("9001", "left"): (28, 56),
    ("9001", "right"): (30, 56),
    ("9002", "left"): (30, 53),
    ("9002", "right"): (30, 53),
    ("9003", "left"): (30, 53),
    ("9003", "right"): (30, 53),
    ("9004", "left"): (30, 53),
    ("9004", "right"): (30, 53),
    ("9005", "left"): (30, 52),
    ("9005", "right"): (30, 53),
    ("9007", "left"): (32, 55),
    ("9007", "right"): (31, 55),
    ("9008", "left"): (30, 52),
    ("9008", "right"): (30, 53),
    ("9010", "left"): (14, 55),
    ("9010", "right"): (14, 55),
    ("9011", "left"): (32, 54),
    ("9011", "right"): (32, 54),
    ("9013", "left"): (32, 54),
    ("9013", "right"): (32, 55),
    ("9014", "left"): (27, 60),
    ("9014", "right"): (27, 60),
    ("9015", "left"): (32, 55),
    ("9015", "right"): (32, 55),
    ("9016", "left"): (28, 56),
    ("9016", "right"): (25, 46),
    ("9017", "left"): (28, 56),
    ("9017", "right"): (22, 40),
    ("9018", "left"): (30, 53),
    ("9018", "right"): (30, 53),
    ("9020", "left"): (30, 53),
    ("9020", "right"): (30, 53),
}


@dataclass
class VariantSource:
    theme_id: str
    side: str
    url: str
    path: Path
    slice: dict
    raw_slice: dict
    size: tuple[int, int]


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def asset_path_by_url() -> dict[str, Path]:
    index = load_json(ASSET_INDEX_PATH)
    mapping: dict[str, Path] = {}
    for asset in index.get("assets", []):
        url = asset.get("url")
        path = asset.get("path")
        if url and path:
            mapping[url] = WORKSPACE_DIR / path
    return mapping


def variant_sources() -> list[VariantSource]:
    themes = load_json(THEMES_PATH)["available_themes"]["themes"]
    by_url = asset_path_by_url()
    sources: list[VariantSource] = []
    for theme in themes:
        theme_id = str(theme.get("id"))
        for side in ("left", "right"):
            variant = (theme.get("variants") or {}).get(side) or {}
            url = variant.get("url")
            if not url:
                continue
            path = by_url.get(url)
            if path is None:
                raise SystemExit(f"asset index has no entry for {url}")
            with Image.open(path) as image:
                width, height = image.size
            raw_slice = variant.get("slice") or {}
            sources.append(
                VariantSource(
                    theme_id=theme_id,
                    side=side,
                    url=url,
                    path=path,
                    slice=safe_slice(raw_slice, width, height),
                    raw_slice=raw_slice,
                    size=(width, height),
                )
            )
    return sources


def safe_slice(
    slice_data: dict,
    width: int,
    height: int,
    min_center: int = MIN_SLICE_CENTER,
) -> dict:
    """Clamp nine-slice borders so a stretchable center strip stays visible.

    The thicker side is trimmed first: it loses the smallest share of its own
    width, and the thinner side usually carries the detailed corner art.
    """
    top = max(1, int(slice_data.get("top", 1)))
    right = max(1, int(slice_data.get("right", 1)))
    bottom = max(1, int(slice_data.get("bottom", 1)))
    left = max(1, int(slice_data.get("left", 1)))

    def trim(first: int, second: int, limit: int) -> tuple[int, int]:
        while first + second > limit - min_center and (first > 1 or second > 1):
            if first >= second and first > 1:
                first -= 1
            elif second > 1:
                second -= 1
            else:
                break
        return first, second

    left, right = trim(left, right, width)
    top, bottom = trim(top, bottom, height)
    return {"top": top, "right": right, "bottom": bottom, "left": left}


def row_extents(alpha: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Return per-row first and last non-transparent x, or -1 for empty rows."""
    active = alpha > ALPHA_THRESHOLD
    has_pixel = active.any(axis=1)
    height, width = active.shape
    left = np.where(has_pixel, active.argmax(axis=1), -1)
    right = np.where(has_pixel, width - 1 - np.fliplr(active).argmax(axis=1), -1)
    return left, right


def continuous_runs(mask: np.ndarray) -> list[tuple[int, int]]:
    rows = np.flatnonzero(mask)
    if rows.size == 0:
        return []
    gaps = np.flatnonzero(np.diff(rows) > 1)
    starts = np.concatenate(([rows[0]], rows[gaps + 1]))
    ends = np.concatenate((rows[gaps], [rows[-1]])) + 1
    return [(int(start), int(end)) for start, end in zip(starts, ends)]


def analyze_variant(source: VariantSource) -> dict:
    with Image.open(source.path) as image:
        rgba = np.array(image.convert("RGBA"))
    alpha = rgba[:, :, 3].astype(np.int16)
    height, width = alpha.shape
    left, right = row_extents(alpha)
    active = alpha > ALPHA_THRESHOLD
    columns = np.flatnonzero(active.any(axis=0))
    body_edge = int(Counter(
        (left if source.side == "left" else right)[
            (left if source.side == "left" else right) >= 0
        ].tolist()
    ).most_common(1)[0][0])
    if source.side == "left":
        outliers = (left >= 0) & (left < body_edge - 1)
    else:
        outliers = (right >= 0) & (right > body_edge + 1)
    runs = continuous_runs(outliers)
    detail = []
    for start, end in runs:
        if source.side == "left":
            overshoot = body_edge - left[start:end]
        else:
            overshoot = right[start:end] - body_edge
        detail.append({
            "start": start,
            "end": end,
            "height": end - start,
            "overshoot": [int(overshoot.min()), int(overshoot.max())],
        })
    return {
        "theme_id": source.theme_id,
        "side": source.side,
        "width": width,
        "height": height,
        "body_edge": body_edge,
        "active_x": [int(columns[0]), int(columns[-1]) + 1] if columns.size else [0, 0],
        "runs": detail,
    }


def body_edge_of(alpha: np.ndarray, side: str) -> int:
    left, right = row_extents(alpha)
    values = (left if side == "left" else right)
    values = values[values >= 0]
    if values.size == 0:
        raise ValueError("source art has no opaque pixels")
    return int(Counter(values.tolist()).most_common(1)[0][0])


def build_square_variant(
    source: VariantSource,
    rgba: np.ndarray,
) -> tuple[np.ndarray, dict]:
    """Return the tail-less RGBA image and its adjusted nine-slice borders."""
    height, width = rgba.shape[:2]
    alpha = rgba[:, :, 3].astype(np.int16)
    body_edge = body_edge_of(alpha, source.side)
    key = (source.theme_id, source.side)
    if key not in TAIL_RANGES:
        raise SystemExit(f"missing tail range for {key}")
    y0, y1 = TAIL_RANGES[key]
    if not (0 <= y0 < y1 <= height):
        raise SystemExit(f"invalid tail range for {key}: {y0}-{y1}")

    left, right = row_extents(alpha)
    if source.side == "left":
        overshoot = [body_edge - int(left[y]) for y in range(y0, y1)]
    else:
        overshoot = [int(right[y]) - body_edge for y in range(y0, y1)]
    repair_width = max(EDGE_REPAIR_WIDTH, max(overshoot) + 2)

    work = rgba.copy()
    if source.side == "left":
        work[y0:y1, 0:body_edge] = 0
        repair_x0 = body_edge
        repair_x1 = min(width, body_edge + repair_width)
    else:
        work[y0:y1, body_edge + 1:] = 0
        repair_x0 = max(0, body_edge - repair_width + 1)
        repair_x1 = body_edge + 1

    up = y0 - 1
    down = y1
    has_up = up >= 0
    has_down = down < height
    if has_up or has_down:
        for y in range(y0, y1):
            if has_up and has_down:
                ratio = (y - y0 + 1) / (y1 - y0 + 1)
                blended = (
                    work[up, repair_x0:repair_x1].astype(np.float32) * (1 - ratio)
                    + work[down, repair_x0:repair_x1].astype(np.float32) * ratio
                )
                work[y, repair_x0:repair_x1] = np.round(blended).astype(np.uint8)
            elif has_up:
                work[y, repair_x0:repair_x1] = work[up, repair_x0:repair_x1]
            else:
                work[y, repair_x0:repair_x1] = work[down, repair_x0:repair_x1]

    rebuilt_alpha = work[:, :, 3] > ALPHA_THRESHOLD
    columns = np.flatnonzero(rebuilt_alpha.any(axis=0))
    if columns.size == 0:
        raise SystemExit(f"square variant for {key} became empty")
    crop_left = int(columns[0])
    crop_right = int(columns[-1]) + 1
    cropped = work[:, crop_left:crop_right]

    base = source.slice or {}
    removed_left = crop_left
    removed_right = width - crop_right
    new_width = crop_right - crop_left
    new_slice = {
        "top": int(base.get("top", 0)),
        "right": max(0, min(new_width, int(base.get("right", 0)) - removed_right)),
        "bottom": int(base.get("bottom", 0)),
        "left": max(0, min(new_width, int(base.get("left", 0)) - removed_left)),
    }
    return cropped, safe_slice(new_slice, new_width, cropped.shape[0])


def write_contact_sheet(sources: list[VariantSource], built: dict) -> Path:
    scale = 2
    tile_width = 0
    rows: list[tuple[str, Image.Image, Image.Image]] = []
    for source in sources:
        key = (source.theme_id, source.side)
        if key not in built:
            continue
        with Image.open(source.path) as handle:
            original = handle.convert("RGBA")
        square = Image.fromarray(built[key][0], "RGBA")
        rows.append((f"{source.theme_id} {source.side}", original, square))
        tile_width = max(tile_width, original.width, square.width)
    tile_width *= scale
    tile_height = tile_width
    sheet_width = tile_width * 3
    sheet_height = tile_height * len(rows) + 20 * len(rows)
    sheet = Image.new("RGBA", (sheet_width, sheet_height), (245, 246, 248, 255))
    for index, (_label, original, square) in enumerate(rows):
        top = index * (tile_height + 20)
        for column, image in enumerate((original, square)):
            enlarged = image.resize(
                (image.width * scale, image.height * scale),
                Image.Resampling.NEAREST,
            )
            sheet.alpha_composite(enlarged, (column * tile_width, top))
    output = WEBUI_DIR / "tmp_bubble_square_sheet.png"
    sheet.save(output)
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--analyze", action="store_true", help="print tail detection data")
    parser.add_argument("--contact-sheet", action="store_true", help="write a preview sheet")
    args = parser.parse_args()

    sources = variant_sources()
    if args.analyze:
        for source in sources:
            report = analyze_variant(source)
            runs = ", ".join(
                f"y{r['start']}-{r['end']} h{r['height']} over{r['overshoot']}"
                for r in report["runs"]
            )
            print(
                f"{report['theme_id']:>5} {report['side']:<5} "
                f"{report['width']}x{report['height']} body={report['body_edge']} "
                f"active={report['active_x']} runs=[{runs}]"
            )
        return 0

    built: dict[tuple[str, str], tuple[np.ndarray, dict]] = {}
    for source in sources:
        with Image.open(source.path) as image:
            rgba = np.array(image.convert("RGBA"))
        built[(source.theme_id, source.side)] = build_square_variant(source, rgba)

    if args.contact_sheet:
        output = write_contact_sheet(sources, built)
        print(f"contact sheet: {output}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    themes_payload = load_json(THEMES_PATH)
    themes = themes_payload["available_themes"]["themes"]
    by_key = {(source.theme_id, source.side): source for source in sources}
    for theme in themes:
        theme_id = str(theme.get("id"))
        for side in ("left", "right"):
            key = (theme_id, side)
            source = by_key.get(key)
            variant = (theme.get("variants") or {}).get(side)
            if source and variant is not None:
                variant["slice"] = dict(source.slice)
                if source.raw_slice != source.slice:
                    note = variant.get("slice_source") or "Unity Sprite.m_Border"
                    if "center clamped" not in note:
                        variant["slice_source"] = f"{note} (center clamped)"
            if key not in built:
                continue
            pixels, new_slice = built[key]
            filename = f"square_{theme_id}_{side}.png"
            Image.fromarray(pixels, "RGBA").save(OUTPUT_DIR / filename)
            theme[f"square_{side}"] = f"/assets/bubbles/{filename}"
            theme[f"square_slice_{side}"] = new_slice
    with THEMES_PATH.open("w", encoding="utf-8") as handle:
        json.dump(themes_payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(f"wrote {len(built)} square assets to {OUTPUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
