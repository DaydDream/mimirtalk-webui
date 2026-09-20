"""素材引用审计：检查 asset_index 中的素材是否真的被应用引用。

判定方式
--------
对每条素材，取它的三个标识去全仓库文本里查找：

1. 完整 asset id（如 backgrounds:texturebg_momotalk_momotalk_04:Momotalk_04）
2. safe_id 形式（如 backgrounds_texturebg_momotalk_momotalk_04_Momotalk_04），
   即 CSS / JS 里 /api/assets/<safe_id>/file 使用的形式
3. 文件名去扩展名（如 Momotalk_04）

只要任意一个出现，就认为被引用。**必须扫描 .css**——界面背景、
卡片、图标等很多素材只用 safe_id 写在样式表里，只扫 JS 会漏判。

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
WORKSPACE_DIR = WEBUI_DIR.parent

INDEX_PATH = WEBUI_DIR / "data" / "asset_index.json"
NAMES_PATH = WEBUI_DIR / "data" / "asset_names.json"

TEXT_SUFFIXES = {".js", ".css", ".html", ".py", ".json", ".md", ".txt", ".csv"}
SKIP_NAMES = {"asset_index.json", "asset_names.json", "ARCHIVE_MANIFEST.json"}
SKIP_PARTS = {"data-backup", "旧项目快照", "__pycache__", ".git"}


def safe_id(value: str) -> str:
    """把 asset id 转换为 URL 中使用的安全标识。"""
    return re.sub(r"[^A-Za-z0-9_]+", "_", value)


def iter_text_files(root: Path):
    """遍历参与引用的文本文件。"""
    if not root.exists():
        return
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if path.name in SKIP_NAMES:
            continue
        if any(part in SKIP_PARTS for part in path.parts):
            continue
        if path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        try:
            yield path, path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue


def build_blob() -> str:
    """把所有可能包含引用的文本拼成一个大字符串。"""
    roots = [
        WEBUI_DIR / "frontend",
        WEBUI_DIR / "backend",
        WEBUI_DIR / "tools",
        WEBUI_DIR / "data",
        WEBUI_DIR / "schema",
        WORKSPACE_DIR / "docs",
        WORKSPACE_DIR / "tools",
    ]
    chunks = []
    for root in roots:
        for _, text in iter_text_files(root):
            chunks.append(text)
    return "\n".join(chunks)


def main() -> int:
    """执行审计并输出结果。"""
    if not INDEX_PATH.is_file():
        print(f"[FAIL] 找不到素材索引: {INDEX_PATH}")
        return 1

    index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    assets = index.get("assets", [])
    blob = build_blob()

    referenced, unreferenced = [], []
    for asset in assets:
        asset_id = asset["id"]
        sid = safe_id(asset_id)
        stem = Path(asset["path"]).stem
        hit = sid in blob or asset_id in blob
        if not hit and stem:
            hit = re.search(rf"(?<![A-Za-z0-9_]){re.escape(stem)}(?![A-Za-z0-9_])", blob) is not None
        (referenced if hit else unreferenced).append(asset)

    print(f"素材索引条目: {len(assets)}")
    print(f"判定为被引用: {len(referenced)}")
    print(f"判定为未引用: {len(unreferenced)}")

    urls = set(re.findall(r"/api/assets/([A-Za-z0-9_@]+)/(?:file|thumbnail)", blob))
    known = {safe_id(asset["id"]) for asset in assets}
    unknown_urls = sorted(url for url in urls if url not in known)
    print(f"代码中出现的素材 URL: {len(urls)}，无法解析: {len(unknown_urls)}")

    if unreferenced:
        print("\n以下素材未被任何代码或数据引用：")
        for asset in unreferenced[:50]:
            print(f"  - {asset['id']}")
        if len(unreferenced) > 50:
            print(f"  ... 共 {len(unreferenced)} 条")

    if unknown_urls:
        print("\n以下 URL 指向了不存在的素材（界面会加载失败）：")
        for url in unknown_urls[:50]:
            print(f"  - {url}")

    if NAMES_PATH.is_file():
        names = json.loads(NAMES_PATH.read_text(encoding="utf-8")).get("assets", {})
        only_in_names = sorted(set(names) - set(a["id"] for a in assets))
        if only_in_names:
            print(f"\nasset_names.json 中有 {len(only_in_names)} 条不在索引里：")
            for item in only_in_names[:20]:
                print(f"  - {item}")

    if unknown_urls:
        print("\n[FAIL] 存在无法解析的素材 URL。")
        return 1
    print("\n[OK] 所有代码引用的素材都能在索引中解析。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
