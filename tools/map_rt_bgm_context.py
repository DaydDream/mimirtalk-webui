"""map_rt_bgm_context：项目辅助脚本，封装对应的数据处理、提取或验证流程。"""
import argparse
import json
import re
import sys
from pathlib import Path

import UnityPy


BGM_RE = re.compile(r"bgmPlay\s*\(\s*(EVE_\d+)\s*\)")


def data_files(data_dir: Path):
    names = [
        "globalgamemanagers",
        "globalgamemanagers.assets",
        "level0",
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


def clean_lines(text):
    return text.splitlines()


def snippet(lines, idx, before=5, after=2):
    a = max(0, idx - before)
    b = min(len(lines), idx + after + 1)
    return lines[a:b]


def main():
    """命令行主入口。"""
    parser = argparse.ArgumentParser()
    parser.add_argument("data_dir", type=Path)
    parser.add_argument("out_json", type=Path)
    parser.add_argument("out_md", type=Path)
    parser.add_argument("--limit-file", action="append")
    args = parser.parse_args()

    limit = set(args.limit_file or [])
    by_bgm = {}
    rows = []
    errors = []

    for fp in data_files(args.data_dir):
        if limit and fp.name not in limit:
            continue
        print(f"scanning {fp}", flush=True)
        try:
            env = UnityPy.load(str(fp))
        except Exception as exc:
            errors.append({"file": fp.name, "stage": "load", "error": str(exc)})
            continue

        for obj in env.objects:
            if obj.type.name != "TextAsset":
                continue
            try:
                data = obj.read()
                script = data.m_Script
            except Exception as exc:
                errors.append({"file": fp.name, "path_id": obj.path_id, "type": "TextAsset", "stage": "read", "error": str(exc)})
                continue
            if isinstance(script, bytes):
                script = script.decode("utf-8", errors="replace")
            name = getattr(data, "m_Name", "") or ""
            lines = clean_lines(script)
            for i, line in enumerate(lines):
                m = BGM_RE.search(line)
                if not m:
                    continue
                ev = m.group(1)
                snap = snippet(lines, i)
                by_bgm.setdefault(ev, []).append(
                    {
                        "file": fp.name,
                        "text_name": name,
                        "line": i,
                        "snippet": snap,
                    }
                )

    rows = []
    for ev in sorted(by_bgm):
        uses = by_bgm[ev]
        rows.append({"bgm": ev, "use_count": len(uses), "uses": uses})

    out = {"rows": rows, "errors": errors}
    args.out_json.parent.mkdir(parents=True, exist_ok=True)
    args.out_json.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    md_lines = ["# RT BGM 场景调用线索", "", "此表只说明脚本资源里 `bgmPlay( EVE_xx )` 出现在哪些场景/脚本附近，不等于官方曲名。", ""]
    for r in rows:
        md_lines.append(f"## {r['bgm']}")
        md_lines.append("")
        for u in r["uses"][:4]:
            md_lines.append(f"`{u['file']}` / `{u['text_name']}` (line {u['line']})")
            md_lines.append("```")
            md_lines.extend(u["snippet"])
            md_lines.append("```")
            md_lines.append("")
    args.out_md.parent.mkdir(parents=True, exist_ok=True)
    args.out_md.write_text("\n".join(md_lines), encoding="utf-8")

    print("bgm ids:", len(rows))
    print("errors:", len(errors))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
