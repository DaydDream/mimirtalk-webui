# MimirTalk WebUI 完整开发日志

归档日期：2026-09-20  
项目目录：`C:\Users\ori\OneDrive\文档\ChatGPT\adv解包\mimirtalk_webui`  
当前状态：核心编辑、预览、项目保存、群聊管理、图片上传和 PNG 长图导出已完成；编辑栏六项改造、气泡九宫格修正、字体修复、撤回导出和六个补充角色均已落地。

## 一、项目目标

为《深空之眼》弥弥尔通讯/MomoTalk 建立一个本地 WebUI：

- 浏览和选择可会话角色与群组。
- 编辑角色、群组、背景和气泡。
- 编辑文本、系统提示、撤回、贴纸和静态图片消息。
- 本地保存多个项目。
- 实时预览游戏风格聊天界面。
- 导出 PNG 聊天长图。
- 尽可能复用游戏内 UI、头像、字体、气泡和贴纸资源。

## 二、开发时间线

### 1. 2026-09-18：解包基础

- 梳理 CPK、UnityFS、USM、音频和视频资源解包流程。
- 恢复深空之眼 MomoTalk Lua 配置和 UI 解包入口。
- 建立 `extract/aethergazer_momotalk/` 资源目录。
- 提取联系人、背景、贴纸、头像和气泡候选资源。
- 确认 USM 视频 key 和导出流程，文档见 `aethergazer-video-unpack-workflow.md`。

### 2. 2026-09-19：WebUI 主体

- 建立前端、后端、项目 schema、示例项目和数据目录。
- 从 `ChatHeroCfg.lua` 生成联系人名单。
- 建立角色头像映射和通用头像库。
- 完成项目保存、重新打开和自动保存。
- 完成联系人列表、聊天预览、消息编辑器和 PNG 长图导出。
- 加入静态贴纸和背景选择。
- 完成群聊管理、成员搜索、分页、修改成员和删除群聊。
- 接入管理员头像和发言人选择。
- 完成手机比例、消息气泡、头像裁切和长文本布局精修。
- 建立 Playwright UI 回归。

### 3. 2026-09-20 上午：功能补全

- 加入静态图片上传，支持 PNG/JPG/JPEG，最大 8 MiB。
- 图片消息支持预览、保存、重载和 PNG 导出。
- 移除动态贴纸和动态 GIF 范围。
- 优化群头像拼图：成员不少于 4 人时取前 4 人。
- 统一项目和会话数据结构，补齐多会话镜像。
- 清理已读、签名和消息计数等冗余界面。
- 修复短消息对齐 bug。
- 完成项目侧栏“弥弥尔通讯 + 项目管理”，支持新建和删除项目。

### 4. 2026-09-20 下午：气泡和字体审计

- 定向解包 `textureconfig/chatbubble/`。
- 审计 `ChatBubbleCfg.lua` 22 条定义。
- 最终保留 17 组静态主题。
- 排除 `9019`、`9021`、`9022` 运行时动态组件主题。
- 恢复旧版 `9016`、`9017` 静态主体。
- 接入游戏 `SourceHanSans` 正文和名字样式。
- 完成气泡文字留白、字体、透明标题、时间戳和会话排序调整。

### 5. 2026-09-20 晚间：九宫格与稳定性

- 对照 `widget/system/chat.ys` 确认气泡 `bg` 使用 `Unity Image.m_Type=1`。
- 读取 Unity `Sprite.m_Border` 官方九宫格边界。
- 修正原先错误的估算 slice。
- 改用完整 Texture2D，避免 Sprite 自动裁边错位。
- 预览和 PNG 导出按左右变体分别九宫格渲染。
- 修复 OneDrive 只读/ReparsePoint 项目目录删除失败。
- 记录 9016/9017 的额外动画、羽饰和粒子子节点未接入静态 WebUI。

### 6. 编辑栏六项改造

- REQ-001：添加消息直接创建系统提示，不弹选择层，可改为撤回。
- REQ-002：会话标题改为项目标题，默认“未命名项目”。
- REQ-003：群组联系人名字可写回群名；联系人头像只读并引用自动群头像。
- REQ-004：聊天背景只保留 `Momotalk_03`、`Momotalk_04`。
- REQ-005：修复消息删除；删除改为原地操作活动会话数组。
- REQ-006：移除 `delay_ms`；消息类型只保留文本、系统、撤回、贴纸、图片。

### 7. 后续修复与补充

- 群组改名后同步所有引用该群组的项目摘要和联系人快照。
- 撤回消息重新加入 PNG 长图导出。
- 名字字体改用完整 `NotoSerifSC-VF.ttf`，解决“西、暗、哈”等逐字回退。
- 补充角色：克图格娅、长琴、泰逢、后土、尼娅、苍术。
- 气泡中文名接入选择器，9005/9007 暂未命名。
- 删除预览栏 `LIVE PREVIEW` 和编辑栏 `INSPECTOR` 英文标题。
- 建立代码冗余审计和清理归档。

## 三、当前功能

### 联系人

- 79 条基础联系人：69 个普通角色、10 个系统/群组。
- 支持自建群组。
- 群组成员可修改和删除。
- 群组名称可修改并同步所有相关项目。
- 角色头像来自游戏头图池或项目内 story_comsingle 素材。

### 消息类型

- `text`：文本。
- `system`：系统提示。
- `recall`：撤回。
- `sticker`：静态贴纸。
- `image`：用户上传的静态图片。

已移除：`choice`、`moment`、`delay_ms`。

### 气泡

- 17 组静态主题。
- 左侧默认气泡 `9000`。
- 右侧使用玩家选择主题。
- 官方 `Sprite.m_Border` 九宫格渲染。
- 完整 Texture2D 资源。
- 中文名已接入，9005/9007 暂显示 ID。
- 9019/9021/9022 动态主题排除。
- 9016/9017 仅接入静态主体，不还原动态子节点。

### 背景和字体

- 聊天背景仅 `Momotalk_03`、`Momotalk_04`。
- 默认背景 `Momotalk_04`。
- 正文 `SourceHanSans`。
- 名字 `NotoSerifSC-VF`，完整覆盖当前 87 个唯一联系人名称。

### 项目与导出

- 项目保存到 `mimirtalk_webui/data/projects/`。
- 支持新建、切换、删除、自动保存。
- PNG 单张导出最近 20 条可导出消息。
- 系统提示和撤回消息均以居中文字导出。
- 静态图片、贴纸、文本、气泡和头像均支持导出。

## 四、关键数据与文件

- 联系人：`mimirtalk_webui/data/chat_contacts.json`
- 头像名称映射：`mimirtalk_webui/data/asset_names.json`
- 素材索引：`mimirtalk_webui/data/asset_index.json`
- 气泡主题：`mimirtalk_webui/data/bubble_themes.json`
- 气泡审计：`mimirtalk_webui/data/bubble_extraction_report.json`
- 项目 schema：`mimirtalk_webui/schema/project.schema.json`
- 后端：`mimirtalk_webui/backend/`
- 前端：`mimirtalk_webui/frontend/`
- 验证脚本：`mimirtalk_webui/tools/`
- 完整历史记录：`文档/WORKLOG.md`
- 交接说明：`文档/HANDOFF.md`
- 编辑栏需求：`文档/EDITOR_REQUIREMENTS.md`
- 冗余审计：`文档/CODE_CLEANUP_AUDIT.md`

## 五、验证方式

常用命令：

```powershell
& "C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" `
  mimirtalk_webui\tools\check_contact_map.py

& "C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" `
  mimirtalk_webui\tools\check_project_store.py

& "C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" `
  mimirtalk_webui\tools\check_backend.py

& "C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" `
  mimirtalk_webui\tools\check_frontend.py
```

UI 回归：

```powershell
$env:MOMOTALK_URL = "http://127.0.0.1:8765"
$env:MOMOTALK_OUTPUT = "output/ui-regression-final"
$env:NODE_PATH = "<node_modules路径>"
node mimirtalk_webui\tools\check_ui_playwright.js
```

最终验证结果：

- 联系人、项目存储、后端、前端检查全部通过。
- Playwright `issues=[]`。
- 气泡九宫格、撤回导出、字体覆盖、新角色和编辑栏改造均经过回归。

## 六、已知限制

- 9019/9021/9022 动态组件气泡未接入。
- 9016/9017 的动态羽饰、粒子节点未接入。
- 气泡 9005、9007 暂无中文名。
- 头像尺寸对齐暂缓：导出 76px，游戏脚本约 112px。
- 通用头像库仍有部分素材没有解析出角色名。
- 游戏字体和素材版权、字体授权需按实际用途确认。

## 七、恢复与维护

启动服务：

```powershell
& "C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" `
  mimirtalk_webui\backend\app.py --host 127.0.0.1 --port 8765
```

预览地址：

```text
http://127.0.0.1:8765/
```

维护注意事项：

- 不要直接重跑旧的 `build_contact_map.py`，除非确认它已经支持保留手工补充角色。
- 删除前端 DOM 控件时，同步搜索 Playwright 脚本中的选择器。
- 修改项目 JSON schema 时，同时补充旧项目迁移和回归测试。
- UI 回归结束后应删除临时项目和测试上传文件。
- OneDrive 同步目录可能出现只读/ReparsePoint 特性，文件删除和替换需考虑重试。

## 九、清理与注释执行结果

- 归档目录已建立：`webui开发日志/`。
- 已保存完整开发日志、核心文档、有效脚本、关键截图、报告、项目清理清单和归档校验文件。
- 已修复联系人重建脚本的覆盖风险，改为保留手工角色和现有映射。
- 已将 UI 回归改为自动删除测试项目和测试上传图片。
- 已删除前端未调用函数、未使用变量、popup 残留和死 CSS。
- 已删除运行时 rebuild 接口和对应未使用方法。
- 已将旧 serif 字体子集移入归档，并更新字体 manifest。
- 已清理临时脚本、0 字节文件、旧日志和旧样式备份。
- 已归档并删除 260 个测试/未命名项目，保留 7 个非测试项目。
- 已删除 65 个测试上传文件。
- 已清空旧 `output/` 和 `mimirtalk_webui/output/` 生成物，当前服务只保留必要运行日志。
- 已清理 `__pycache__` 和 `.pyc`。
- 最终服务健康检查：`status=ok`，项目数 7，上传目录 0 个文件。
- 项目自有 Python 脚本已补充中文模块说明，WebUI 后端、构建、检查、提取脚本补充了关键职责注释。
- 前端主脚本和 Playwright 回归脚本已增加中文模块头、关键区块说明，并清理英文/转义注释。
- 注释修改后，Python、Node、联系人、项目、后端、前端和 Playwright 回归全部通过。

## 八、发布封包

- 发布目录：`webui项目封包/MimirTalk_WebUI_v1_20260920/`
- ZIP：`webui项目封包/MimirTalk_WebUI_v1_20260920.zip`
- 包内素材：索引实际引用的 1484 个资源，路径位于 `assets_source/`。
- 发布包不包含用户项目、上传图片、自定义群、内置群改名/删除覆盖、缩略图缓存和运行日志。
- 包内启动入口：`启动WebUI.cmd`、`启动WebUI.ps1`。
- 独立启动验证：资源 1484、项目 0、联系人 79、状态 `ok`。
- ZIP SHA256：见同级 `.zip.sha256`；打包基线记录见包内 `BUILD_INFO.txt`。

## 十、归档说明

本目录保存：

- `文档/`：完整开发、交接、需求、审计文档。
- `脚本/`：当前有效构建、提取和验证脚本。
- `生成物/关键截图/`：最终界面和关键功能验证图。
- `生成物/报告/`：联系人、素材、气泡和索引报告。
- `清单/归档文件校验.json`：归档文件的来源、大小和 SHA256。
- `数据备份/`：清理前保存的历史数据清单或备份。
## 十一、项目改名与归档刷新

- 2026-09-21 将项目由 `MomoTalk WebUI` 统一改名为 `MimirTalk WebUI`。
- 源码目录、发布目录、ZIP、启动脚本、页面标题、服务版本、schema 标题、README 与全部开发日志引用同步更新。
- `webui开发日志/脚本/` 中的核心代码和有效脚本已与 `mimirtalk_webui/` 当前源码重新对齐。
- `归档文件校验.json` 已按改名后的路径和最新文件内容重新生成。
- 游戏本身的 MomoTalk 术语、Lua 文件名和素材路径属于游戏内容，按原样保留。
