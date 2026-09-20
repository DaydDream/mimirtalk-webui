from __future__ import annotations

import io
import json
from pathlib import Path

import UnityPy


UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f3c1"

BUNDLE_DIR = Path(
    r"C:\Program Files\AetherGazerLauncher\AetherGazer\AetherGazer_Data"
    r"\StreamingAssets\Windows\8\b"
)
TARGET_CAB = "CAB-d08536dd6deb53281849ce38aab420f6"
TARGET_PATH_ID = -5182878735218833696


def iter_bundle_paths():
    yield from sorted(BUNDLE_DIR.glob("*.ys"))


def object_name(obj):
    try:
        data = obj.read()
    except Exception:
        return ""
    return str(getattr(data, "m_Name", "") or getattr(data, "name", "") or "")


def scan_bundle(path: Path):
    raw = path.read_bytes()
    offset = raw.find(b"UnityFS")
    if offset < 0:
        return None
    env = UnityPy.load(io.BytesIO(raw[offset:]))
    names = []
    for file in env.files:
        for attr in ("name", "path"):
            value = getattr(file, attr, None)
            if value:
                names.append(str(value))
    matched_name = any(TARGET_CAB in name for name in names)
    matched_object = False
    interesting = []
    for obj in env.objects:
        if obj.path_id == TARGET_PATH_ID:
            matched_object = True
        name = object_name(obj)
        if name in {"side", "changeBtn", "outBtn", "headItem", "historyBtn"}:
            interesting.append(
                {
                    "path_id": obj.path_id,
                    "type": obj.type.name,
                    "name": name,
                    "container": obj.container,
                }
            )
    if not matched_name and not matched_object and not interesting:
        return None
    return {
        "bundle": str(path),
        "internal_names": names,
        "matched_name": matched_name,
        "matched_object": matched_object,
        "interesting": interesting,
    }


def main():
    matches = []
    for path in iter_bundle_paths():
        try:
            result = scan_bundle(path)
        except Exception as exc:
            result = {
                "bundle": str(path),
                "error": f"{type(exc).__name__}: {exc}",
            }
        if result is not None:
            matches.append(result)
            print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
    print(json.dumps({"match_count": len(matches)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
