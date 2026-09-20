"""extract_aethergazer_images：深空之眼专项资源提取脚本，负责扫描资源包并输出图像或结构数据。"""
import argparse
import io
import json
import re
import time
import warnings
from collections import Counter
from pathlib import Path

import UnityPy


DEFAULT_GAME_DIR = Path(r"C:\Program Files\AetherGazerLauncher\AetherGazer")
DEFAULT_OUT_DIR = Path(r"C:\Users\ori\OneDrive\文档\ChatGPT\adv解包\extract\aethergazer")

TARGET_GROUPS = {
    "textureconfig/character/portrait/": "character_portrait",
    "textureconfig/character/portraitdlc/": "character_portrait_dlc",
    "textureconfig/character/portrait_half/": "character_portrait_half",
    "textureconfig/illustratedhandbook/itemplot_l/": "story_cg_large",
    "textureconfig/illustratedhandbook/itemplot_s/": "story_cg_small",
    "textureconfig/illustratedhandbook/boss/": "illustrated_boss",
    "textureconfig/illustratedhandbook/portrait/": "illustrated_portrait",
    "texturebg/illustratedhandbook/illustrated_storyline/": "storyline_scene",
    "texturebg/story/": "story_ui",
    "textureconfig/story/storyexpression/": "story_expression",
    "comsingle/textureconfig/story/character/": "story_character",
    "comsingle/textureconfig/illustratedhandbook/collect_s/": "illustrated_collect",
    "comsingle/textureconfig/background/": "story_background",
    "comsingle/textureconfig/loading/": "story_loading",
    "textureconfig/chapterpaint.ys": "chapter_paint",
    "textureconfig/chapter/": "chapter_art",
    "textureconfig/chapteplot.ys": "story_plot_cg",
    "textureconfig/backgroundquad/": "background_quad",
    "textureconfig/emptydream/plot/": "story_plot_cg",
    "textureconfig/hero_oath/photo/": "story_photos",
    "textureconfig/activity_skuld/skuld_photos/": "story_photos",
    "textureconfig/activity_jokercard/story/": "activity_story",
    "textureconfig/activity_roulike/roulike_incident/": "activity_story",
    "textureconfig/activity_roulike/roulike_plot/": "activity_story",
    "textureconfig/backhouseui/idolchapter/": "story_chapter_art",
    "texturebg/background/": "story_plot_cg",
    "texturebg/xuheng_plotmap/": "story_plotmap",
    "texturebg/activity_skuld/": "story_photos",
    "texturebg/activity_jokercard/": "activity_story",
    "texturebg/activity_autochess_main/lllustrated/": "activity_illustrated",
    "texturebg/activity_ekchuah/ekchuah_illustratedui/": "activity_illustrated",
    "texturebg/activity_roulike/": "activity_illustrated",
    "texturebg/activity_summerrace/": "activity_illustrated",
    "texturebg/activity_wuluo/wuluo_main/wuluo_illustratedpopui/": "activity_illustrated",
    "texturebg/illustratedhandbook/": "illustrated_bg",
    "modelui/4_4cowboy_ui/activity_ekchuah_illustratedbg.ys": "activity_illustrated",
    "i18nimg/textureconfig/chapter/": "chapter_art_i18n",
    "texturebg/": "story_texturebg_broad",
    "textureconfig/activity_": "activity_assets",
    "textureconfig/hero_": "story_photos",
    "textureconfig/backhouseui/": "story_backhouseui",
    "textureconfig/emptydream/": "story_plot_cg",
    "textureconfig/sandplay_quanzhou/": "activity_assets",
    "textureconfig/chat/chatsticker/": "chat_sticker",
    "i18nimg/chat/chatsticker/": "chat_sticker",
    "dynamicsticker/": "chat_sticker",
    "comchar/oath/facetimeline/": "chat_sticker",
    "modelui/": "story_modelui",
    "comeffect/story/": "story_comeffect",
    "comchar/oath/": "story_photos",
    "comchar/story/": "story_comeffect",
    "comscene/story/": "story_comeffect",
    "comsceneq/idoltrainee/": "story_comeffect",
    "comcharq/qwworld/": "story_comeffect",
    "comcharq/idoltrainee/": "story_comeffect",
    "assets/uiresources/ui_art/modelui/": "story_modelui",
    "textures/storyui/": "story_ui",
    "textures/xuhengchapter/": "story_plotmap",
    "comeffect/storytimeline/": "story_comeffect",
    "textureconfig/illustratedhandbook/": "story_cg_extra",
    "textureconfig/music/": "story_music",
    "textureconfig/weaponservant/": "character_weaponservant",
    "textureconfig/passport/": "character_passport",
    "textureconfig/mardukui/": "story_mardukui",
    "textureconfig/treasure/": "story_treasure",
    "textureconfig/character/": "character_extra",
    "atlas/": "atlas_sprite",
    "comeffect/": "story_comeffect",
    "comscene/": "scene_assets",
    "comsceneq/": "scene_assets",
    "comchar/": "character_assets",
    "comcharq/": "character_assets",
    "comsingle/": "story_misc",
    "textureconfig/": "story_misc",
    "textures/": "ui_textures",
    "i18nimg/": "i18n_image",
    "assets/": "ui_resources",
}

NESTED_GROUPS = {
    "story_ui",
    "story_expression",
    "story_character",
    "illustrated_collect",
    "story_background",
    "story_loading",
    "chapter_paint",
    "chapter_art",
    "background_quad",
    "illustrated_boss",
    "illustrated_portrait",
    "story_plot_cg",
    "story_photos",
    "activity_story",
    "story_chapter_art",
    "story_plotmap",
    "activity_illustrated",
    "illustrated_bg",
    "chapter_art_i18n",
    "story_texturebg_broad",
    "activity_assets",
    "story_backhouseui",
    "story_modelui",
    "story_comeffect",
    "story_cg_extra",
    "story_music",
    "character_weaponservant",
    "character_passport",
    "story_mardukui",
    "story_treasure",
    "character_extra",
    "atlas_sprite",
    "scene_assets",
    "character_assets",
    "story_misc",
    "ui_textures",
    "i18n_image",
    "ui_resources",
}

PRESETS = {
    "portraits": [
        "textureconfig/character/portrait/",
        "textureconfig/character/portraitdlc/",
        "textureconfig/character/portrait_half/",
    ],
    "story-cg": [
        "textureconfig/illustratedhandbook/itemplot_l/",
        "textureconfig/illustratedhandbook/itemplot_s/",
        "textureconfig/illustratedhandbook/boss/",
        "textureconfig/illustratedhandbook/portrait/",
        "texturebg/illustratedhandbook/illustrated_storyline/",
        "texturebg/story/",
        "textureconfig/story/storyexpression/",
        "comsingle/textureconfig/story/character/",
    ],
    "story-scenes": [
        "comsingle/textureconfig/background/",
        "comsingle/textureconfig/loading/",
        "textureconfig/chapterpaint.ys",
        "textureconfig/chapter/",
        "textureconfig/backgroundquad/",
    ],
    "story-full": [
        "textureconfig/illustratedhandbook/itemplot_l/",
        "textureconfig/illustratedhandbook/itemplot_s/",
        "textureconfig/illustratedhandbook/boss/",
        "textureconfig/illustratedhandbook/portrait/",
        "texturebg/illustratedhandbook/illustrated_storyline/",
        "texturebg/story/",
        "textureconfig/story/storyexpression/",
        "comsingle/textureconfig/story/character/",
        "comsingle/textureconfig/illustratedhandbook/collect_s/",
        "comsingle/textureconfig/background/",
        "comsingle/textureconfig/loading/",
        "textureconfig/chapterpaint.ys",
        "textureconfig/chapter/",
        "textureconfig/backgroundquad/",
    ],
    "story-expanded": [
        "textureconfig/chapteplot.ys",
        "textureconfig/emptydream/plot/",
        "textureconfig/hero_oath/photo/",
        "textureconfig/activity_skuld/skuld_photos/",
        "textureconfig/activity_jokercard/story/",
        "textureconfig/activity_roulike/roulike_incident/",
        "textureconfig/activity_roulike/roulike_plot/",
        "textureconfig/backhouseui/idolchapter/",
        "texturebg/background/",
        "texturebg/xuheng_plotmap/",
        "texturebg/activity_skuld/",
        "texturebg/activity_jokercard/",
        "texturebg/activity_autochess_main/lllustrated/",
        "texturebg/activity_ekchuah/ekchuah_illustratedui/",
        "texturebg/activity_roulike/",
        "texturebg/activity_summerrace/",
        "texturebg/activity_wuluo/wuluo_main/wuluo_illustratedpopui/",
        "texturebg/illustratedhandbook/",
        "modelui/4_4cowboy_ui/activity_ekchuah_illustratedbg.ys",
        "i18nimg/textureconfig/chapter/",
    ],
    "story-broad": [
        "texturebg/",
        "textureconfig/activity_",
        "textureconfig/hero_",
        "textureconfig/backhouseui/",
        "textureconfig/emptydream/",
        "textureconfig/sandplay_quanzhou/",
        "modelui/",
        "comeffect/story/",
        "comchar/oath/",
        "comchar/story/",
        "comscene/story/",
        "comsceneq/idoltrainee/",
        "comcharq/qwworld/",
        "comcharq/idoltrainee/",
        "assets/uiresources/ui_art/modelui/",
        "textures/storyui/",
        "textures/xuhengchapter/",
    ],
    "story-deep": [
        "comeffect/storytimeline/",
        "atlas/",
        "textureconfig/illustratedhandbook/",
        "textureconfig/music/",
        "textureconfig/weaponservant/",
        "textureconfig/passport/",
        "textureconfig/mardukui/",
        "textureconfig/treasure/",
        "textureconfig/character/",
        "textureconfig/backhouseui/",
        "textureconfig/emptydream/",
        "textureconfig/hero_oath/",
        "textureconfig/activity_",
        "comsingle/textureconfig/story/",
        "comsingle/textureconfig/illustratedhandbook/",
        "textures/",
        "i18nimg/",
        "modelui/",
        "assets/uiresources/",
        "assets/artresources/",
    ],
    "story-max": [
        "comeffect/",
        "comscene/",
        "comchar/",
        "comsceneq/",
        "comcharq/",
        "textureconfig/",
        "texturebg/",
        "comsingle/",
        "atlas/",
        "textures/",
        "i18nimg/",
        "modelui/",
        "assets/",
    ],
    "chat-emoji": [
        "textureconfig/chat/chatsticker/",
        "i18nimg/chat/chatsticker/",
        "dynamicsticker/",
        "comchar/oath/facetimeline/",
    ],
    "all": list(TARGET_GROUPS),
}


def safe_name(name: str, fallback: str) -> str:
    """清理文件名中的非法字符。"""
    clean = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip().rstrip(".")
    return clean or fallback


def group_for_path(asset_path: str):
    """根据资源路径判断素材分类。"""
    for prefix, group in TARGET_GROUPS.items():
        if asset_path.startswith(prefix):
            return group
    return None


def output_base(category_dir: Path, asset_path: str, group: str) -> Path:
    if group not in NESTED_GROUPS:
        return category_dir / safe_name(Path(asset_path).stem, "image")

    relative = Path(asset_path).with_suffix("")
    safe_parts = [safe_name(part, "_") for part in relative.parts]
    return category_dir.joinpath(*safe_parts)


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


def selected_entries(entries, prefixes, include_naive: bool):
    selected = {}
    for prefix in prefixes:
        for path, entry in entries.items():
            if path.startswith(prefix) and (include_naive or "$naive" not in Path(path).name):
                selected[path] = entry
    return sorted(selected.items(), key=lambda item: item[0])


def extract_texture(bundle_path: Path, asset_path: str, out_dir: Path, overwrite: bool, image_source: str):
    """提取并返回目标资源或数据。"""
    raw = bundle_path.read_bytes()
    offset = raw.find(b"UnityFS")
    if offset < 0:
        raise ValueError("UnityFS signature not found")

    env = UnityPy.load(io.BytesIO(raw[offset:]))
    textures = []
    sprites = []

    for obj in env.objects:
        if obj.type.name == "Texture2D":
            data = obj.read()
            image = data.image
            if image is not None:
                textures.append(
                    {
                        "name": getattr(data, "m_Name", "") or asset_path,
                        "width": getattr(data, "m_Width", image.width),
                        "height": getattr(data, "m_Height", image.height),
                        "image": image,
                    }
                )
        elif image_source in {"sprite", "both"} and obj.type.name == "Sprite":
            data = obj.read()
            image = data.image
            if image is not None:
                sprites.append(
                    {
                        "name": getattr(data, "m_Name", "") or asset_path,
                        "width": image.width,
                        "height": image.height,
                        "image": image,
                    }
                )

    candidates = []
    if image_source in {"texture", "both"}:
        candidates.extend(("texture", item) for item in textures)
    if image_source in {"sprite", "both"}:
        candidates.extend(("sprite", item) for item in sprites)

    if not candidates:
        raise ValueError(f"No supported image object found (source={image_source})")

    group = group_for_path(asset_path)
    if group is None:
        raise ValueError(f"No output group configured for {asset_path}")

    category_dir = out_dir / group
    category_dir.mkdir(parents=True, exist_ok=True)

    outputs = []
    base_output = output_base(category_dir, asset_path, group)
    for index, (kind, item) in enumerate(candidates, start=1):
        suffix = ""
        if len(candidates) > 1:
            suffix = f"__{kind}_{index}"
        output_path = base_output.with_name(f"{base_output.name}{suffix}.png")
        output_path.parent.mkdir(parents=True, exist_ok=True)

        if output_path.exists() and not overwrite:
            outputs.append(
                {
                    "kind": kind,
                    "group": group,
                    "name": item["name"],
                    "width": item["width"],
                    "height": item["height"],
                    "output": str(output_path),
                    "status": "exists",
                }
            )
            continue

        item["image"].save(output_path, format="PNG")
        outputs.append(
            {
                "kind": kind,
                "group": group,
                "name": item["name"],
                "width": item["width"],
                "height": item["height"],
                "output": str(output_path),
                "status": "saved",
            }
        )

    return outputs


def main():
    """命令行主入口。"""
    parser = argparse.ArgumentParser(
        description="Extract AetherGazer portraits, story art, and illustrated CG assets from Unity .ys bundles."
    )
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--preset", choices=sorted(PRESETS), default="all")
    parser.add_argument("--prefix", action="append", help="Override/extend asset path prefixes; repeatable.")
    parser.add_argument("--include-naive", action="store_true", help="Include $naive alternate assets.")
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--image-source", choices=["texture", "sprite", "both"], default="texture")
    parser.add_argument("--limit", type=int, default=0, help="Only process the first N selected entries.")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    warnings.filterwarnings("ignore", message="No valid Unity version found.*")
    UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f3c1"

    data_dir = args.game_dir / "AetherGazer_Data" / "StreamingAssets" / "Windows"
    prefixes = args.prefix or PRESETS[args.preset]
    for prefix in prefixes:
        if group_for_path(prefix) is None:
            parser.error(f"unsupported prefix: {prefix}")

    payload, entries = load_index(data_dir)
    selected = selected_entries(entries, prefixes, args.include_naive)
    if args.limit:
        selected = selected[: args.limit]

    args.out_dir.mkdir(parents=True, exist_ok=True)
    report_path = args.report or (args.out_dir / "manifest.json")
    started = time.time()

    counts = Counter()
    dimensions = Counter()
    outputs = []
    errors = []

    print(
        f"version={payload.get('versionName', '?')} build={payload.get('buildCode', '?')} "
        f"selected={len(selected)} out={args.out_dir}",
        flush=True,
    )

    for position, (asset_path, entry) in enumerate(selected, start=1):
        try:
            item_outputs = extract_texture(
                entry["bundle"],
                asset_path,
                args.out_dir,
                args.overwrite,
                args.image_source,
            )
            for item in item_outputs:
                outputs.append({"asset": asset_path, "bundle": str(entry["bundle"]), **item})
                counts[item["status"]] += 1
                dimensions[(item["width"], item["height"])] += 1
        except Exception as exc:
            errors.append({"asset": asset_path, "bundle": str(entry["bundle"]), "error": str(exc)})
            print(f"ERROR {asset_path}: {exc}", flush=True)

        if position % 20 == 0 or position == len(selected):
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
        "include_naive": args.include_naive,
        "image_source": args.image_source,
        "selected_count": len(selected),
        "saved_count": counts["saved"],
        "existing_count": counts["exists"],
        "error_count": len(errors),
        "elapsed_seconds": round(time.time() - started, 3),
        "dimension_counts": [
            {"width": width, "height": height, "count": count}
            for (width, height), count in dimensions.most_common()
        ],
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
