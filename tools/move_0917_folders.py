"""Move every 0917-marked extraction folder into the D: resource library.

Nested folders are flattened: the parent chain is not recreated, only the
marked folder itself is moved. Every move is verified (file count + bytes)
before and after, and a JSON report is written next to this script.

Run without --execute for a dry run.
"""

import argparse
import json
import os
import shutil
import stat
import sys
import time
from pathlib import Path

BASE = Path(r"C:\Users\ori\OneDrive\文档\ChatGPT\adv解包\extract\aethergazer")
DEST = Path(r"D:\大眼解包图片资源")

SOURCES = [
    BASE / "chapter_art0917",
    BASE / "character_portrait0917",
    BASE / "character_portrait_dlc0917",
    BASE / "chat_sticker0917",
    BASE / "chat_sticker_gif0917",
    BASE / "chat_sticker_webp0917",
    BASE / "illustrated_portrait0917",
    BASE / "story_background0917",
    BASE / "story_cg_large0917",
    BASE / "story_character0917",
    BASE / "story_expression0917",
    BASE / "story_loading0917",
    BASE / "activity_assets" / "textureconfig" / "activity_autochess_chess" / "rolebattle0917",
    BASE / "character_weaponservant" / "textureconfig" / "weaponservant" / "portrait0917",
    BASE / "story_plot_cg" / "textureconfig" / "emptydream" / "letter_role_title0917",
    BASE / "story_plot_cg" / "textureconfig" / "emptydream" / "role0917",
]


def folder_stats(path: Path):
    files = 0
    size = 0
    for item in path.rglob("*"):
        if item.is_file():
            files += 1
            size += item.stat().st_size
    return files, size


def force_remove(path: Path, attempts: int = 5):
    """Delete a tree, clearing read-only bits and retrying transient locks."""
    def on_error(func, target, _exc_info):
        os.chmod(target, stat.S_IWRITE)
        func(target)

    last_error = None
    for attempt in range(attempts):
        try:
            shutil.rmtree(path, onerror=on_error)
            return True
        except OSError as error:
            last_error = error
            time.sleep(1.0 + attempt)
    if last_error is not None:
        print(f"could not remove {path}: {last_error}", file=sys.stderr)
    return False


def resolve_expected(source: Path, target: Path):
    """Pick the authoritative copy: the source normally, the target if the
    source was already emptied by an interrupted cross-volume move."""
    source_stats = folder_stats(source) if source.is_dir() else (0, 0)
    target_stats = folder_stats(target) if target.is_dir() else (0, 0)
    if source_stats[0] == 0 and target_stats[0] > 0:
        return target_stats
    return source_stats


def main():
    """命令行主入口。"""
    parser = argparse.ArgumentParser(description="Move 0917 folders to the D: library.")
    parser.add_argument("--execute", action="store_true", help="Actually perform the moves.")
    args = parser.parse_args()

    if not DEST.is_dir():
        print(f"destination missing: {DEST}", file=sys.stderr)
        return 1

    names = [source.name for source in SOURCES]
    if len(names) != len(set(names)):
        print("duplicate folder names would collide in the flat destination", file=sys.stderr)
        return 1

    for source in SOURCES:
        target = DEST / source.name
        if target.exists() and source.is_dir() and folder_stats(source)[0] > 0:
            print(f"target exists while source still has files: {target}", file=sys.stderr)
            return 1

    total_files = total_bytes = 0
    for source in SOURCES:
        files, size = resolve_expected(source, DEST / source.name)
        total_files += files
        total_bytes += size
        print(f"{'MOVE' if args.execute else 'PLAN'} {source.name:28s} {files:5d} files  {size/1048576:9.1f} MB")
    print(f"\n{len(SOURCES)} folders, {total_files} files, {total_bytes/1048576/1024:.2f} GB -> {DEST}")

    if not args.execute:
        print("\ndry run only; re-run with --execute to move")
        return 0

    report = []
    for source in SOURCES:
        target = DEST / source.name
        expected = resolve_expected(source, target)

        if not target.exists():
            shutil.copytree(source, target, symlinks=True)
        copied = folder_stats(target)
        copy_ok = copied == expected

        if source.exists():
            if copy_ok:
                copy_ok = force_remove(source)
            if not copy_ok:
                report.append(
                    {
                        "source": str(source),
                        "target": str(target),
                        "files": expected[0],
                        "bytes": expected[1],
                        "verified": False,
                    }
                )
                print(f"FAIL {source.name} -> {target}", file=sys.stderr)
                break

        ok = (target_files := folder_stats(target)) == expected and not source.exists()
        report.append(
            {
                "source": str(source),
                "target": str(target),
                "files": expected[0],
                "bytes": expected[1],
                "verified": ok,
            }
        )
        print(f"{'OK  ' if ok else 'FAIL'} {source.name} -> {target}  ({target_files[0]} files)")
        if not ok:
            print("verification failed, stopping", file=sys.stderr)
            break

    report_path = Path(__file__).with_name("move_0917_folders_report.json")
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    failures = [item for item in report if not item["verified"]]
    print(f"\nreport: {report_path}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
