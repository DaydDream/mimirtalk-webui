#!/usr/bin/env python3
"""Map EVE Burst Error BGM ids to usage sites in hazuki txt exports.

The script looks at scripts under EVE_burst_error_unpack for a resource
entry whose src is an eve_* name immediately followed by bgmPlay / sePlay.
It writes a compact JSON plus a human readable md summary.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path


ENTRY_RE = re.compile(r"^\[ENTRY\]\s*$")
SRC_RE = re.compile(r"^src=(.*)$")
NAME_RE = re.compile(r"^(eve_[A-Za-z0-9]+|boon|goo)$", re.IGNORECASE)


def parse_file(path: Path) -> list[dict]:
    """解析file相关数据。"""
    entries: list[dict] = []
    cur: dict | None = None
    for lineno, raw in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
        line = raw.strip()
        if not line:
            continue
        if ENTRY_RE.match(line):
            if cur is not None:
                entries.append(cur)
            cur = {"line": lineno, "fields": {}}
            continue
        if cur is None:
            continue
        if "=" in line:
            key, value = line.split("=", 1)
            cur["fields"][key] = value
    if cur is not None:
        entries.append(cur)
    return entries


def main() -> None:
    """命令行主入口。"""
    parser = argparse.ArgumentParser()
    parser.add_argument("scripts_dir", type=Path)
    parser.add_argument("out_json", type=Path)
    parser.add_argument("out_md", type=Path)
    args = parser.parse_args()

    bgm_uses = defaultdict(list)
    se_uses = defaultdict(list)
    all_audio_uses = defaultdict(list)
    bgm_play_without_named_prev: list[tuple[Path, int]] = []

    for path in sorted(args.scripts_dir.rglob("*.hazuki.txt")):
        entries = parse_file(path)
        for idx, entry in enumerate(entries):
            src = entry["fields"].get("src", "").strip()
            next_src = entries[idx + 1]["fields"].get("src", "").strip() if idx + 1 < len(entries) else ""
            if not src or not NAME_RE.match(src):
                continue
            all_audio_uses[src].append({"file": str(path), "line": entry["line"], "next": next_src})
            if next_src == "bgmPlay":
                bgm_uses[src].append({"file": str(path), "line": entry["line"]})
            elif next_src == "sePlay":
                se_uses[src].append({"file": str(path), "line": entry["line"]})
        # Report bgmPlay calls that do not have a directly preceding eve_* resource.
        srcs = [entry["fields"].get("src", "").strip() for entry in entries]
        for idx, entry in enumerate(entries):
            if entry["fields"].get("src", "").strip() == "bgmPlay":
                # Look back over at most 20 blocks for the last resource assignment.
                found = None
                for j in range(idx - 1, max(-1, idx - 21), -1):
                    s = srcs[j] if j >= 0 else ""
                    if s and s != "bgmStop" and not s.startswith(("text", "name", "visual", "black", "wait", "code")):
                        found = s
                        break
                if not found or not NAME_RE.match(found):
                    bgm_play_without_named_prev.append((path, entry["line"], found))

    def simplify(rows):
        # Keep one row per file/line; later users can inspect context.
        return sorted(rows, key=lambda r: (r["file"], r["line"]))

    payload = {
        "bgm_use": {k: simplify(v) for k, v in sorted(bgm_uses.items())},
        "se_use": {k: simplify(v) for k, v in sorted(se_uses.items())},
        "all_audio_use": {k: simplify(v) for k, v in sorted(all_audio_uses.items())},
        "bgm_play_without_named_prev": [
            {"file": str(p), "line": line, "last_src": last}
            for p, line, last in bgm_play_without_named_prev
        ],
    }

    args.out_json.parent.mkdir(parents=True, exist_ok=True)
    args.out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = ["# BE BGM 编号使用映射", ""]
    lines.append("规则：把 `src=eve_xx` 后紧跟 `bgmPlay` 的脚本位置视为一次 BGM 使用。")
    lines.append("同一编号也会出现在 `sePlay` 附近，说明部分 `eve_xx` 资源同时被当作音效/系统音使用。")
    lines.append("")

    for track, rows in sorted(bgm_uses.items()):
        lines.append(f"## {track}")
        for row in simplify(rows):
            rel = Path(row["file"]).relative_to(args.scripts_dir)
            lines.append(f"- {rel}:{row['line']}")
        lines.append("")

    lines.append("## bgmPlay 前没有找到紧邻 eve_* 的调用")
    if payload["bgm_play_without_named_prev"]:
        for row in payload["bgm_play_without_named_prev"]:
            rel = Path(row["file"]).relative_to(args.scripts_dir)
            lines.append(f"- {rel}:{row['line']} last={row['last_src']}")
    else:
        lines.append("无")
    lines.append("")

    args.out_md.parent.mkdir(parents=True, exist_ok=True)
    args.out_md.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {args.out_json}")
    print(f"wrote {args.out_md}")


if __name__ == "__main__":
    main()
