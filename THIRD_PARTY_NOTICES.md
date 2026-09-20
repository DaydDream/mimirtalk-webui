# 第三方资源声明

本仓库的**源代码**以 [MIT 许可证](LICENSE) 发布。

本仓库同时包含或依赖以下第三方资源，其版权与许可归各自权利人所有，
**不适用** MIT 许可证。

## 1. 字体

| 字体 | 用途 | 许可证 |
| --- | --- | --- |
| Source Han Sans（思源黑体） | 正文与界面 | SIL Open Font License 1.1 |
| Noto Serif SC（思源宋体 / Noto 衬线） | 角色名字体 | SIL Open Font License 1.1 |

字体文件位于 `webui/frontend/assets/fonts/`。

SIL Open Font License 1.1 允许自由使用、修改与再分发，但要求：

- 字体副本保留原始版权声明与许可文件
- 不得单独出售字体本身
- 修改后的版本不得使用保留字体名称（Reserved Font Name）

许可证全文见 <https://scripts.sil.org/OFL>。

## 2. 游戏素材

《深空之眼》（AetherGazer）相关的角色名称、头像、图标、贴纸、
气泡组件、聊天背景及配置数据等，版权归其各自权利人所有。

这些素材来自对游戏客户端的解包，位于：

- `assets_source/`（发布包内）
- `webui/data/`（素材索引与联系人数据）
- `docs/reports/`（素材相关审计报告）

本项目为**粉丝向二次创作与学习交流**用途：

- 不主张对上述素材的任何权利
- 不将其用于商业目的
- 如权利人提出异议，将立即移除相关素材

## 3. 解包与处理工具

`tools/` 目录下的脚本由本项目编写，以 MIT 许可证发布。

脚本运行所需的第三方二进制工具（如 ffmpeg、vgmstream、hazuki 等）
**未包含在本仓库中**，需由使用者自行获取，并遵守各自的许可条款。

## 4. 代码

除上述第三方资源外，本项目源码以 MIT 许可证发布，
详见 [LICENSE](LICENSE)。
