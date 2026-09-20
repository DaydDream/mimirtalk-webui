"""inspect_monobehaviour_headers：Unity、二进制或配置结构检查工具。"""
import argparse
import json
import struct
import sys
from pathlib import Path

import UnityPy


def parse_pptr(raw: bytes, offset: int):
    """解析pptr相关数据。"""
    file_id = struct.unpack_from("<i", raw, offset)[0]
    path_id = struct.unpack_from("<q", raw, offset + 4)[0]
    return {"file_id": file_id, "path_id": path_id}


def read_csharp_string(raw: bytes, offset: int):
    length = struct.unpack_from("<I", raw, offset)[0]
    value_offset = offset + 4
    if length > 0x10000 or value_offset + length > len(raw):
        return None, offset
    return raw[value_offset : value_offset + length].decode("utf-8", errors="replace"), value_offset + length


def main() -> int:
    """命令行主入口。"""
    parser = argparse.ArgumentParser(
        description="Parse MonoBehaviour raw headers without relying on generated typetrees."
    )
    parser.add_argument("asset", type=Path)
    parser.add_argument("--scripts-asset", type=Path)
    parser.add_argument("--path-id", type=int, action="append", default=[])
    parser.add_argument("--script-path-id", type=int)
    parser.add_argument("--start", type=int)
    parser.add_argument("--end", type=int)
    parser.add_argument("--json", type=Path)
    args = parser.parse_args()

    scripts = {}
    behaviours = {}
    if args.scripts_asset:
        scripts_env = UnityPy.load(str(args.scripts_asset))
        for obj in scripts_env.objects:
            if obj.type.name != "MonoScript":
                continue
            data = obj.read()
            scripts[obj.path_id] = {
                "path_id": obj.path_id,
                "name": getattr(data, "m_Name", "") or "",
                "class": getattr(data, "m_ClassName", "") or "",
                "namespace": getattr(data, "m_Namespace", "") or "",
                "assembly": getattr(data, "m_AssemblyName", "") or "",
            }

    env = UnityPy.load(str(args.asset))
    for obj in env.objects:
        if obj.type.name == "MonoScript":
            data = obj.read()
            scripts[obj.path_id] = {
                "path_id": obj.path_id,
                "name": getattr(data, "m_Name", "") or "",
                "class": getattr(data, "m_ClassName", "") or "",
                "namespace": getattr(data, "m_Namespace", "") or "",
                "assembly": getattr(data, "m_AssemblyName", "") or "",
            }
        elif obj.type.name == "MonoBehaviour":
            behaviours[obj.path_id] = obj

    wanted = list(args.path_id)
    if args.start is not None or args.end is not None:
        if args.start is None or args.end is None:
            raise SystemExit("--start and --end must be used together")
        wanted.extend(range(args.start, args.end + 1))
    if not wanted and args.script_path_id is None:
        wanted = sorted(behaviours)

    rows = []
    for path_id in wanted:
        obj = behaviours.get(path_id)
        if obj is None:
            rows.append({"path_id": path_id, "error": "MonoBehaviour not found"})
            continue
        raw = obj.get_raw_data()
        row = {
            "path_id": path_id,
            "byte_start": getattr(obj, "byte_start", None),
            "byte_size": getattr(obj, "byte_size", None),
            "raw_length": len(raw),
            "raw_prefix_hex": raw[:96].hex(" "),
            "game_object_offset_0": parse_pptr(raw, 0) if len(raw) >= 12 else None,
            "enabled_12": raw[12] if len(raw) > 12 else None,
            "script_offset_16": parse_pptr(raw, 16) if len(raw) >= 28 else None,
        }
        script_id = row["script_offset_16"]["path_id"] if row["script_offset_16"] else None
        row["script"] = scripts.get(script_id)
        if len(raw) >= 32:
            name, name_end = read_csharp_string(raw, 28)
            row["name_offset_28"] = name
            if name is not None:
                row["serialized_end_after_name"] = name_end
        if args.script_path_id is not None and script_id != args.script_path_id:
            continue
        rows.append(row)

    output = {
        "asset": str(args.asset),
        "mono_script_count": len(scripts),
        "mono_behaviour_count": len(behaviours),
        "rows": rows,
    }
    text = json.dumps(output, ensure_ascii=False, indent=2, default=str)
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(text, encoding="utf-8")
    sys.stdout.buffer.write(text.encode("utf-8", "backslashreplace"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
