import json
import io
from pathlib import Path

import UnityPy

UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f3c1"


BUNDLE = Path(
    r"C:\Program Files\AetherGazerLauncher\AetherGazer\AetherGazer_Data"
    r"\StreamingAssets\Windows\8\b\8b544351f1417aba81c480114ed5f9d2.ys"
)
TARGET_PATH_ID = -5182878735218833696


def describe(value):
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, dict):
        return {
            str(key): describe(item)
            for key, item in value.items()
            if key in {"m_Name", "m_FileID", "m_PathID", "name", "path_id"}
        }
    if isinstance(value, list):
        return [describe(item) for item in value[:8]]
    return repr(value)


raw = BUNDLE.read_bytes()
offset = raw.find(b"UnityFS")
print("offset", offset, "size", len(raw))
env = UnityPy.load(io.BytesIO(raw[offset:]))
print("bundle", BUNDLE)
print("objects", len(env.objects))
print("files", len(env.files))
for index, file in enumerate(env.files):
    print("FILE", index, getattr(file, "name", None), getattr(file, "path", None))
    for attr in ("externals", "m_Externals", "external_files"):
        value = getattr(file, attr, None)
        if value is not None:
            print("FILE", index, attr, value)

container = None
for obj in env.objects:
    if getattr(obj, "container", None):
        container = obj.container
        break
print("container", container)

first = next(iter(env.objects))
asset_file = first.assets_file
print("asset_file", type(asset_file), [name for name in dir(asset_file) if "external" in name.lower()])
for attr in ("externals", "m_Externals"):
    value = getattr(asset_file, attr, None)
    print("asset_file", attr, value)
    if value:
        for index, item in enumerate(value):
            print("EXTERNAL", index, item)

target = None
for obj in env.objects:
    if obj.path_id == TARGET_PATH_ID:
        target = obj
        break
print("target object", None if target is None else (target.path_id, target.type.name, target.container))
if target is not None:
    data = target.read()
    print("target data", json.dumps(describe(data.__dict__), ensure_ascii=False, indent=2)[:8000])

for file in env.files:
    print("file attrs", [name for name in dir(file) if "external" in name.lower()])
    try:
        print("file dict", file.__dict__)
    except Exception as exc:
        print("file dict error", exc)
