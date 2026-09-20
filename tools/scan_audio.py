"""scan_audio：资源或字符串扫描工具。"""
import argparse
import json
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


def as_dict(data):
    keys = [
        "m_Name",
        "m_OriginalPath",
        "m_LoadType",
        "m_Format",
        "m_CompressionFormat",
        "m_Frequency",
        "m_Channels",
        "m_Length",
        "m_Size",
        "m_Resource",
    ]
    out = {}
    for key in keys:
        value = getattr(data, key, None)
        if value is None:
            continue
        if hasattr(value, "m_Source"):
            out[key] = {
                "m_Source": getattr(value, "m_Source", None),
                "m_Offset": getattr(value, "m_Offset", None),
                "m_Size": getattr(value, "m_Size", None),
            }
        else:
            out[key] = value
    return out


def main():
    """命令行主入口。"""
    parser = argparse.ArgumentParser()
    parser.add_argument("data_dir", type=Path)
    parser.add_argument("report", type=Path)
    args = parser.parse_args()

    data_dir = args.data_dir
    clips = []
    errors = []
    files = []

    for fp in interesting_files(data_dir):
        files.append(str(fp))
        print(f"scanning {fp}", flush=True)
        try:
            env = UnityPy.load(str(fp))
        except Exception as exc:
            errors.append({"file": fp.name, "stage": "load", "error": str(exc)})
            continue

        for obj in env.objects:
            if obj.type.name != "AudioClip":
                continue
            try:
                data = obj.read()
                info = as_dict(data)
                info["file"] = fp.name
                info["path_id"] = obj.path_id
                clips.append(info)
                if len(clips) % 100 == 0:
                    print(f"  found {len(clips)} AudioClips", flush=True)
            except Exception as exc:
                errors.append(
                    {
                        "file": fp.name,
                        "path_id": obj.path_id,
                        "stage": "AudioClip.read",
                        "error": str(exc),
                    }
                )

    report = {
        "data_dir": str(data_dir),
        "files": files,
        "audio_clip_count": len(clips),
        "audio_clips": clips,
        "errors": errors,
        "error_count": len(errors),
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"audio_clip_count: {len(clips)}")
    print(f"error_count: {len(errors)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
