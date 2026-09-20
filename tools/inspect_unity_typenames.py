"""inspect_unity_typenames：Unity、二进制或配置结构检查工具。"""
import argparse
import json
import sys
from pathlib import Path

import UnityPy


def match_any(text: str, needles: list[str]) -> bool:
    lowered = text.lower()
    return any(needle.lower() in lowered for needle in needles)


def main() -> int:
    """命令行主入口。"""
    parser = argparse.ArgumentParser(
        description="List Unity MonoScripts and matching MonoBehaviour objects."
    )
    parser.add_argument("asset", type=Path)
    parser.add_argument("--needle", action="append", required=True)
    parser.add_argument("--json", type=Path)
    parser.add_argument("--include-data", action="store_true")
    args = parser.parse_args()

    env = UnityPy.load(str(args.asset))
    scripts = {}
    for obj in env.objects:
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

    script_rows = []
    for row in scripts.values():
        text = "|".join(str(value) for value in row.values())
        if match_any(text, args.needle):
            script_rows.append(row)

    mono_rows = []
    for obj in env.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        try:
            data = obj.read_typetree()
        except Exception as exc:
            mono_rows.append(
                {
                    "path_id": obj.path_id,
                    "error": str(exc),
                }
            )
            continue
        raw_script = data.get("m_Script")
        script_path_id = (
            raw_script.get("m_PathID")
            if isinstance(raw_script, dict)
            else None
        )
        script = scripts.get(script_path_id)
        text = f"{script}|{data}" if script else str(data)
        if match_any(text, args.needle):
            row = {
                "path_id": obj.path_id,
                "script_path_id": script_path_id,
                "script": script,
                "keys": sorted(data.keys()),
            }
            if args.include_data:
                row["data"] = data
            mono_rows.append(row)

    output = {
        "asset": str(args.asset),
        "needles": args.needle,
        "mono_script_count": len(scripts),
        "scripts": script_rows,
        "mono_behaviours": mono_rows,
    }
    text = json.dumps(output, ensure_ascii=True, indent=2, default=str)
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(text, encoding="utf-8")
    sys.stdout.buffer.write(text.encode("ascii", "backslashreplace"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
