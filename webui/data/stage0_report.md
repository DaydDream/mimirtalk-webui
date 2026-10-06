# MimirTalk WebUI 阶段 0 报告

## 结果

- 扫描 PNG：522
- 去重后可展示素材：522
- 因 sprite/texture2d 重复而移除：0
- 可选头像：80
- 可选背景：4
- 可选贴纸：344

## 分类

| 分类 | 数量 |
| --- | ---: |
| 图集拆图 (`atlas`) | 5 |
| 聊天背景 (`backgrounds`) | 4 |
| 角色头图池 (`character_itemshead`) | 73 |
| 聊天贴纸 (`chat_stickers`) | 335 |
| 本地化聊天贴纸 (`chat_stickers_i18n`) | 9 |
| misc (`misc`) | 30 |
| 通讯图片与头像 (`momotalk_images`) | 17 |
| UI 控件 (`widgets`) | 49 |

## 去重规则

- 同一分类、资源目录和图片名通常优先保留 `sprite`。`textureconfig/chatbubble` 与旧版 `9016_1`、`9017_1` 气泡例外，保留完整 `texture2d` 以匹配 Unity `Sprite.m_Border`。
- 只有 `texture2d` 时保留 `texture2d`。
- 被移除的重复文件路径记录在 `asset_index.json` 的 `duplicate_paths` 中。
