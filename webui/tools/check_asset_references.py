"""素材引用审计：检查代码引用与素材索引是否一致。

为什么需要这个检查
------------------
界面素材有两种引用方式：

1. **完整 asset id**，例如
   ``backgrounds:texturebg_momotalk_momotalk_04:Momotalk_04``
2. **safe_id 形式的 URL**，例如 CSS 里的
   ``/api/assets/backgrounds_texturebg_momotalk_momotalk_04_Momotalk_04/file``

只扫描第 1 种会漏判——导航栏背景、消息卡片、退出图标等界面素材
**只以 safe_id 出现在样式表里**。曾经因为漏扫 CSS，导致 5 个界面素材
被误判为未引用并删除。这个脚本因此同时扫描 ``.css``。

检查内容
--------
- 代码（js/css/html/py）中出现的 ``/api/assets/<safe_id>//(file|thumbnail)``
  是否都能在 ``asset_index.json`` 里找到
- ``asset_names.json`` 是否引用了不存在的素材
- 索引条目数与分类统计

不依赖本地的 ``assets_source/`` 目录，可在没有素材的检出中直接运行。

用法
----
    python webui/tools/check_asset_references.py

返回码 0 表示全部通过。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

WEBUI_DIR = Path(__file__).resolve().parents[1]
INDEX_PATH = WEBUI_DIR / "data" / "asset_index.json"
NAMES_PATH = WEBUI_DIR / "data" / "asset_names.json"

CODE_ROOTS = [
    WEBUI_DIR / "frontend",
    WEBUI_DIR / "backend",
    WEBUI_DIR / "tools",
]
CODE_SUFFIXES = {".js", ".css", ".html", ".py"}
URL_PATTERN = re.compile(r"/api/assets/([A-Za-z0-9_@]+)/(?:file|thumbnail)")
SKIP_PARTS = {"__pycache__", ".git", "node_modules"}


def safe_id(value: str) -> str:
    """把 asset id 转换为 URL 中使用的安全标识。"""
    return re.sub(r"[^A-Za-z0-9_]+", "_", value)


def collect_code_references() -> set[str]:
    """收集代码中所有 /api/assets/<safe_id>/ 形式的引用。"""
    found: set[str] = set()
    for root in CODE_ROOTS:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in CODE_SUFFIXES:
                continue
            if any(part in SKIP_PARTS for part in path.parts):
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            found.update(URL_PATTERN.findall(text))
    return found


REFERENCE_SUFFIXES = {".js", ".css", ".html", ".py", ".json", ".md", ".txt", ".csv"}
REFERENCE_SKIP_NAMES = {"asset_index.json", "asset_names.json", "ARCHIVE_MANIFEST.json"}


def collect_reference_text() -> str:
    """收集除索引自身外的全部引用文本，用于统计未引用素材。"""
    roots = [
        WEBUI_DIR / "frontend",
        WEBUI_DIR / "backend",
        WEBUI_DIR / "data",
        WEBUI_DIR.parent / "docs",
        WEBUI_DIR.parent / "tools",
    ]
    chunks: list[str] = []
    for root in roots:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in REFERENCE_SUFFIXES:
                continue
            if path.name in REFERENCE_SKIP_NAMES:
                continue
            if any(part in SKIP_PARTS for part in path.parts):
                continue
            if "data-backup" in path.parts or "旧项目快照" in str(path):
                continue
            try:
                chunks.append(path.read_text(encoding="utf-8", errors="ignore"))
            except OSError:
                continue
    return "\n".join(chunks)


def find_unreferenced(assets: list[dict]) -> list[dict]:
    """找出在代码与数据中都没出现过的素材（仅用于提示，不判定失败）。"""
    blob = collect_reference_text()
    unreferenced = []
    for asset in assets:
        asset_id = asset["id"]
        sid = safe_id(asset_id)
        stem = Path(asset["path"]).stem
        hit = sid in blob or asset_id in blob
        if not hit and stem:
            hit = re.search(rf"(?<![A-Za-z0-9_]){re.escape(stem)}(?![A-Za-z0-9_])", blob) is not None
        if not hit:
            unreferenced.append(asset)
    return unreferenced


def main() -> int:
    """执行检查并输出结果。"""
    if not INDEX_PATH.is_file():
        print(f"[FAIL] 找不到素材索引: {INDEX_PATH}")
        return 1

    index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    assets = index.get("assets", [])
    known = {safe_id(asset["id"]) for asset in assets}

    print(f"素材索引条目: {len(assets)}")
    counts: dict[str, int] = {}
    for asset in assets:
        counts[asset["category"]] = counts.get(asset["category"], 0) + 1
    for category in sorted(counts):
        print(f"  {category:<22} {counts[category]}")

    references = collect_code_references()
    unknown = sorted(ref for ref in references if ref not in known)
    print(f"\n代码中的素材引用: {len(references)}")
    print(f"无法在索引中解析: {len(unknown)}")


    unreferenced = find_unreferenced(assets)
    print(f"未在代码/数据中出现: {len(unreferenced)}")
    if unreferenced:
        print("  （仅供人工复核，删除前请确认不是通过 safe_id 被引用）")
        for asset in unreferenced[:20]:
            print(f"  - {asset['id']}")
        if len(unreferenced) > 20:
            print(f"  ... 共 {len(unreferenced)} 条")
    problems = 0
    if unknown:
        problems += len(unknown)
        print("\n以下引用指向不存在的素材（界面会加载失败）：")
        for ref in unknown[:50]:
            print(f"  - {ref}")
        if len(unknown) > 50:
            print(f"  ... 共 {len(unknown)} 条")

    if NAMES_PATH.is_file():
        names = json.loads(NAMES_PATH.read_text(encoding="utf-8")).get("assets", {})
        index_ids = {asset["id"] for asset in assets}
        orphan_names = sorted(set(names) - index_ids)
        if orphan_names:
            problems += len(orphan_names)
            print(f"\nasset_names.json 中有 {len(orphan_names)} 条不在索引里：")
            for item in orphan_names[:20]:
                print(f"  - {item}")

    if problems:
        print(f"\n[FAIL] 共发现 {problems} 处不一致。")
        return 1
    print("\n[OK] 代码引用与素材索引一致。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
