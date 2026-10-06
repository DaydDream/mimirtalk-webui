# MimirTalk WebUI v1.1.0 更新说明

> 本文档是 1.1.0 的发布内容整理，供发布页 / GitHub Release 文案直接取用。

| 项目 | 内容 |
| --- | --- |
| 版本 | v1.1.0 |
| 发布包 | `MimirTalk_WebUI_v1.1.0_20261007` |
| 打包日期 | 2026-10-07 |
| 包类型 | 纯运行时包（内置 Python 3.12.10 + Pillow 12.3.0，用户无需安装环境） |
| 上一版本 | v1.0.1（2026-09-20 包） |
| 更新方式 | 全量更新（完整包） |

> 本次 1.1.0 为**全量更新**：发布的是完整发布包，包含内置运行时、全部代码与全部素材，
> **需解压到新目录使用，不能直接覆盖安装到旧目录**，也不依赖上一版文件。

## 主要更新

### 1. 连续消息：统一无尾方框

- 为 17 个气泡主题、左右两侧生成 34 张显式无尾方框资源，目录
  `frontend/assets/bubbles/`，命名 `square_<theme>_<side>.png`。
- 同一侧、同一发言人的连续文本消息只在首条保留气泡三角，后续使用无尾方框；
  系统消息、贴纸、图片或换边会正常打断分组。
- 预览与 PNG 导出共用同一套 `groupContinuousBubbles()` 分组结果和同一份切片元数据，
  不再按主题或预览路径重复判断。
- 导出的无尾方框与首条带尾气泡正文左右对齐、外缘对齐，导出图中的 1px 细线 / 接缝
  已消除，头像与气泡的可见间距同步收窄。

### 2. 联系人库与可会话列表

- 右侧编辑面板新增「联系人列表」页签，与「编辑」页签并列，页签结构可扩展。
- 支持按分类筛选：全部 / 角色 / 内置群 / 自建群，筛选条数量随搜索词实时联动。
- 双击联系人卡片即可加入可会话列表并自动选中；单击不加入，支持搜索与分页。

![联系人列表：页签、分类筛选与分页](https://raw.githubusercontent.com/DaydDream/mimirtalk-webui/main/docs/screenshots/final/联系人列表.png)

- 可会话列表持久保存到 `data/conversation_contacts.json`（`version: 2`）：
  `contact_ids` 为联系人列表来源，`preview_ids` 为会话列表目标。
- 首次启动默认清单为 11 条：薇儿丹蒂 `1084` + 10 个内置群，避免初始界面为空；
  自建群不默认加入，新建群组时自动加入、删除群组时同步移除。
- 旧项目如果引用了不在清单中的联系人，会临时置顶且不写盘，保证历史项目仍能正常打开；
  非当前会话卡提供移除入口，当前会话需先切换。

![会话选项卡：非当前会话卡可移除](https://raw.githubusercontent.com/DaydDream/mimirtalk-webui/main/docs/screenshots/final/会话选项卡移除.png)

### 3. 新增可会话角色

- 新增 5 名可会话角色，头像取自项目内 `story_comsingle` 素材：

| 角色 | ID | 资源 ID |
| --- | --- | --- |
| 巴德尔 | 1036 | `character_itemshead:story_comsingle:1036` |
| 亚里沙 | 1045 | `character_itemshead:story_comsingle:1045` |
| 雪儿 | 1046 | `character_itemshead:story_comsingle:1046` |
| 庚辰 | 1076 | `character_itemshead:story_comsingle:1076` |
| 梅塞可 | 10131 | `character_itemshead:story_comsingle:10131` |

![新增角色目录：5 名可会话角色](https://raw.githubusercontent.com/DaydDream/mimirtalk-webui/main/docs/screenshots/final/新增角色目录.png)

- 5 名角色的头像均可用于联系人列表、可会话列表、聊天预览与 PNG 导出。

### 4. 预留功能模块

- 本版同时预留了可扩展模块：编辑面板页签（已有「编辑」「联系人列表」两个页签）与可会话清单
  数据结构均为后续功能预留了独立入口，后续的对话模板 Prompt 与自动 AI 对话可在其上单独启用，
  本版不开放。

## 修复清单

- 修复 `9008`、`9010`、`9020` 三个主题气泡沿十字割裂的问题：这三个主题的
  Unity 九宫格纵横向顶+底、左+右正好等于整图边长，中心区域为 0。
  现按真实图片边长收口切片，保证中心宽高至少 1px。
- 修复导出图中气泡内部的 1px 细线 / 接缝。
- 修复首条带尾气泡与后续无尾方框气泡的正文左右未对齐。
- 修复连续消息无尾方框由带尾原图运行时裁剪导致的缺口、裁断装饰、残留三角等问题。
- 开放 `9016 她与我的花季`、`9017 解心语` 两个静态版气泡主题：只接入静态主体九宫格切片，
  可正常选择、预览并导出 PNG；选择器显示「静态版」，不再显示「组件待合成」，也不再禁用。
- 界面细节：「添加消息」按钮移到预览区顶部工具栏；预览工具栏与按钮组允许换行，
  窄屏下标题占一行、操作按钮保持右对齐。

## 数据与兼容性

- 本包为全量包，请解压到新目录运行，不要直接覆盖安装到旧目录。
- 旧项目无需迁移即可打开；项目数据结构未变。
- `conversation_contacts.json` 为全局单文件，不随包提供，首次运行按默认清单生成。
- 移除联系人不会删除基础角色库，也不会破坏历史项目中的 `contact_id`。
- 发布包内 `custom_groups.json` 已重置为空，`group_members.json` 仅保留基础成员映射。

## 已知限制与不在本版范围

以下三项继续保留在反馈文档中，后续单独立项，不属于 1.1.0：

- 手机端完整适配。
- 用户自制游戏图床接入。
- 每角色对话模板 Prompt 与自动 AI 对话。

另：`9019`、`9021`、`9022` 等运行时动态组件气泡主题仍不纳入 WebUI。

## 发布包信息

| 项目 | 内容 |
| --- | --- |
| 索引条目 | 523 |
| assets_source 文件数 | 509 |
| python-runtime 文件数 | 158 |
| mimirtalk_webui 文件数 | 68 |
| 清单文件数 | 741 |
| ZIP | `MimirTalk_WebUI_v1.1.0_20261007.zip` |
| ZIP SHA256 | `AB24859BC5FF21653CBF6E3F00B149CBCAEF179A58FA9C05A7088B49AF84046D` |

## 验证记录

- `check_contact_map.py`：通过。
- `check_asset_references.py`：通过。
- `check_backend.py`、`check_frontend.py`、`check_project_store.py`：通过。
- `check_ui_playwright.js`：`issues: []`。
- 发布包内置 `python-runtime` 启动成功：`/api/health` 返回
  `asset_count=523 contact_count=84 project_count=0`；静态气泡路由
  `/assets/bubbles/square_9013_left.png` 返回 `200`。
- 发布包 `PACKAGE_FILES.sha256` 与包目录逐文件校验一致（741 条，无缺失、无错配、无多余）。
