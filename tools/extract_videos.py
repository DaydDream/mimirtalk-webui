"""extract_videos：资源提取脚本，按指定格式输出目标资源。"""
import argparse
import sys
from pathlib import Path

import UnityPy


def interesting_files(data_dir: Path):
    names = [
        "globalgamemanagers",
        "globalgamemanagers.assets",
        "level0",
        "level1",
        "resources.assets",
        "sharedassets0.assets",
    ]
    for name in names:
        p = data_dir / name
        if p.is_file():
            yield p
    for p in sorted(data_dir.glob("*.assets")):
        if p.name not in names:
            yield p


def safe_name(name: str, path_id: int):
    """清理文件名中的非法字符。"""
    clean = name.replace("/", "_").replace("\\", "_").replace(":", "_")
    clean = "".join(ch if ch.isprintable() else "_" for ch in clean).strip()
    return clean or f"video_{path_id}"


def unique_path(out_dir: Path, stem: str):
    p = out_dir / f"{stem}.mp4"
    n = 1
    while p.exists():
        p = out_dir / f"{stem}_{n}.mp4"
        n += 1
    return p


def main():
    """命令行主入口。"""
    parser = argparse.ArgumentParser()
    parser.add_argument("data_dir", type=Path)
    parser.add_argument("out_dir", type=Path)
    parser.add_argument("--resource", type=Path, default=None)
    parser.add_argument("--all", action="store_true", help="extract every VideoClip, not just names containing OP")
    args = parser.parse_args()

    data_dir = args.data_dir
    out_dir = args.out_dir
    resource_path = args.resource or (data_dir / "resources.resource")

    if not resource_path.is_file():
        print(f"missing streamed resource file: {resource_path}")
        return 2

    out_dir.mkdir(parents=True, exist_ok=True)
    saved = 0
    skipped = 0
    errors = []

    for fp in interesting_files(data_dir):
        print(f"scanning {fp}", flush=True)
        try:
            env = UnityPy.load(str(fp))
        except Exception as exc:
            errors.append({"file": fp.name, "stage": "load", "error": str(exc)})
            continue

        for obj in env.objects:
            if obj.type.name != "VideoClip":
                continue
            try:
                clip = obj.read()
            except Exception as exc:
                errors.append({"file": fp.name, "path_id": obj.path_id, "stage": "VideoClip.read", "error": str(exc)})
                continue

            name = getattr(clip, "m_Name", "") or ""
            upper_name = name.upper()
            # OP movies are named with an OP segment (EVE_GE_OP, DESIRE_OP_SS, ...).
            # LOOP clips contain the substring "OP" too, so require the underscore form.
            if not args.all and "_OP" not in upper_name:
                skipped += 1
                continue

            res = getattr(clip, "m_ExternalResources", None)
            if res is None:
                skipped += 1
                continue

            offset = getattr(res, "m_Offset", 0) or 0
            size = getattr(res, "m_Size", 0) or 0
            source = getattr(res, "m_Source", "") or ""
            original_path = getattr(clip, "m_OriginalPath", "") or ""

            if size <= 0 or offset < 0:
                skipped += 1
                continue

            try:
                with resource_path.open("rb") as fh:
                    fh.seek(offset)
                    data = fh.read(size)
                if len(data) != size:
                    raise RuntimeError(f"read {len(data)} bytes, expected {size}")
                fp_out = unique_path(out_dir, safe_name(name, obj.path_id))
                fp_out.write_bytes(data)
                saved += 1
                print(
                    f"  {name} path_id={obj.path_id} offset={offset} size={size} source={source} -> {fp_out}",
                    flush=True,
                )
            except Exception as exc:
                errors.append(
                    {
                        "file": fp.name,
                        "path_id": obj.path_id,
                        "name": name,
                        "offset": offset,
                        "size": size,
                        "original_path": original_path,
                        "stage": "slice",
                        "error": str(exc),
                    }
                )

    print("done")
    print("saved", saved)
    print("skipped", skipped)
    if errors:
        print("errors", len(errors))
        for e in errors[:50]:
            print(e)

    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
