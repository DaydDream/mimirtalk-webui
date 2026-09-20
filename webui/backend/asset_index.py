"""素材索引模块：负责索引加载、查询、路径安全校验和缩略图生成。"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image


WEBUI_DIR = Path(__file__).resolve().parents[1]
WORKSPACE_DIR = WEBUI_DIR.parent
DEFAULT_INDEX_PATH = WEBUI_DIR / "data" / "asset_index.json"
DEFAULT_THUMBNAIL_DIR = WEBUI_DIR / "data" / "thumbnails"


def safe_id(value: str) -> str:
    """将资源 ID 转为可用于 URL 的安全标识。"""
    return value.replace("/", "_").replace("\\", "_").replace(":", "_")


class AssetIndex:
    """素材索引访问器：加载索引、查询素材、校验路径并生成缩略图。"""
    def __init__(
        self,
        index_path: Path = DEFAULT_INDEX_PATH,
        thumbnail_dir: Path = DEFAULT_THUMBNAIL_DIR,
        workspace_dir: Path = WORKSPACE_DIR,
    ):
        self.index_path = Path(index_path)
        self.thumbnail_dir = Path(thumbnail_dir)
        self.workspace_dir = Path(workspace_dir)
        self.index: dict = {}
        self.assets_by_id: dict[str, dict] = {}
        self.assets_by_url_id: dict[str, dict] = {}

    def load(self) -> dict:
        """加载并返回指定数据。"""
        if not self.index_path.is_file():
            raise FileNotFoundError(f"Asset index not found: {self.index_path}")
        self.index = json.loads(self.index_path.read_text(encoding="utf-8"))
        self.assets_by_id = {}
        self.assets_by_url_id = {}
        for asset in self.index.get("assets", []):
            asset_id = asset["id"]
            self.assets_by_id[asset_id] = asset
            self.assets_by_url_id[safe_id(asset_id)] = asset
        return self.index

    def stats(self) -> dict:
        """返回素材索引统计信息。"""
        if not self.index:
            self.load()
        return self.index.get("stats", {})

    def get(self, asset_id: str) -> dict | None:
        """按资源 ID 或安全 URL ID 查询素材。"""
        return self.assets_by_id.get(asset_id) or self.assets_by_url_id.get(asset_id)

    def list_assets(
        self,
        category: str | None = None,
        query: str | None = None,
        role: str | None = None,
        asset_ids: list[str] | None = None,
        offset: int = 0,
        limit: int = 200,
    ) -> dict:
        """按角色、分类、ID 和关键词筛选并分页返回素材。"""
        if not self.index:
            self.load()

        items = self.index.get("assets", [])
        if asset_ids:
            wanted = set(asset_ids)
            items = [item for item in items if item.get("id") in wanted]
        elif role == "avatar":
            items = self.index.get("avatars", [])
        elif role == "background":
            items = self.index.get("backgrounds", [])
        elif role == "sticker":
            items = self.index.get("stickers", [])
        if category:
            items = [item for item in items if item.get("category") == category]
        if query:
            needle = query.casefold()
            items = [
                item
                for item in items
                if needle in item.get("id", "").casefold()
                or needle in item.get("name", "").casefold()
                or needle in item.get("asset_key", "").casefold()
            ]

        total = len(items)
        page = items[offset : offset + limit]
        return {
            "total": total,
            "offset": offset,
            "limit": limit,
            "count": len(page),
            "items": [self.public_asset(item) for item in page],
        }

    def public_asset(self, asset: dict) -> dict:
        """为素材补充公开 URL 和缩略图 URL。"""
        item = dict(asset)
        url_id = safe_id(asset["id"])
        item["url_id"] = url_id
        item["file_url"] = f"/api/assets/{url_id}/file"
        item["thumbnail_url"] = f"/api/assets/{url_id}/thumbnail"
        return item

    def asset_path(self, asset: dict) -> Path:
        """解析素材真实路径并阻止越出工作区。"""
        path = (self.workspace_dir / asset["path"]).resolve()
        workspace = self.workspace_dir.resolve()
        if workspace not in path.parents:
            raise ValueError("Asset path escapes the workspace")
        if path.suffix.lower() != ".png" or not path.is_file():
            raise FileNotFoundError(f"Asset file not found: {path}")
        return path

    def thumbnail_path(self, asset: dict, width: int, height: int) -> Path:
        """按指定尺寸生成并缓存 PNG 缩略图。"""
        source = self.asset_path(asset)
        width = max(16, min(width, 1024))
        height = max(16, min(height, 1024))
        output = (
            self.thumbnail_dir
            / safe_id(asset["id"])
            / f"{width}x{height}.png"
        )
        if output.is_file():
            return output

        output.parent.mkdir(parents=True, exist_ok=True)
        temporary = output.with_suffix(".png.tmp")
        with Image.open(source) as image:
            image.thumbnail((width, height), Image.Resampling.LANCZOS)
            image.convert("RGBA").save(temporary, format="PNG")
        temporary.replace(output)
        return output
