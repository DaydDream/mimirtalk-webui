# MimirTalk WebUI 代码冗余与无效项审计

日期：2026-09-20  
范围：`mimirtalk_webui/` 后端、前端、测试、工具和运行数据；不含 `extract/` 原始解包素材。  
结论：项目主体没有大面积失活代码，但存在一批选择支/签名/延迟功能移除后的残留、历史工具、生成物和测试污染。

## 清理执行结果（2026-09-20）

- 已修复 `build_contact_map.py`：现有联系人名单为准，保留手工角色，不回补已删除角色，并保留已有头像名称映射。
- Playwright 回归新增自动清理：测试项目、图片消息上传文件会在结束后删除；后端新增上传删除接口。
- 已删除未调用前端函数、未使用变量、popup 导出资源、未使用 CSS 变量和残留选择器。
- 已删除未使用的 `POST /api/assets/rebuild` 和 `AssetIndex.rebuild()`。
- 旧 `source-han-serif-cn-bold.ttf` 已归档到 `webui开发日志/历史工具/字体/` 并从运行资源删除。
- 当前字体 manifest 只保留实际加载的 `SourceHanSans` 和 `Noto Serif SC`。
- 已删除临时脚本、0 字节残留、旧日志和旧样式备份；相关文件已归档。
- 已备份并删除 260 个测试/未命名项目，保留 7 个非测试项目。
- 已删除 65 个测试上传文件。
- 已清空旧 `output/` 与 `mimirtalk_webui/output/` 内容，保留当前服务日志；后续服务会重新生成必要文件。
- 已清理 `__pycache__` 和 `.pyc`。
- 兼容用途的 `choice`、`moment` 迁移、`signature`、`read` 仍保留。

## 优先级汇总

| 等级 | 项目 | 建议 |
| --- | --- | --- |
| P0 | `build_contact_map.py` 会覆盖手工补充角色 | 改成合并模式或标记为历史工具，不能直接重跑 |
| P0 | UI 测试残留大量项目、上传图片 | 测试结束自动删除临时项目；人工清理旧测试数据前先备份 |
| P1 | 前端未调用函数与变量 | 删除或移入测试辅助代码 |
| P1 | 选择支移除后的 popup 资源和 CSS | 删除未使用资源引用与样式 |
| P1 | 旧字体子集和过期字体 manifest | 删除未被 CSS 引用的旧 serif 子集，更新 manifest |
| P2 | schema 中签名/已读字段 | 属于旧项目兼容字段，暂不删除 |
| P2 | 历史调查脚本和旧输出 | 可归档到独立目录，按需清理 |

## P0：高风险或会继续制造冗余

### 1. `build_contact_map.py` 会覆盖手工角色

文件：`mimirtalk_webui/tools/build_contact_map.py`

问题：

- 脚本完全以 `ChatHeroCfg.lua` 重建 `chat_contacts.json`。
- 当前手工补充角色：克图格娅、长琴、泰逢、后土、尼娅、苍术。
- 这些角色不在重建源中，直接运行会把它们从联系人列表覆盖掉。
- `asset_names.json` 也会被旧映射覆盖，新增角色的名称记录会丢失。

建议：

- 改成“从现有 contacts 合并新增/更新”，不要整表覆盖。
- 或在 README 中标记为历史初始化脚本，禁止在已有项目上直接运行。

### 2. UI 回归污染项目数据和上传目录

文件：`mimirtalk_webui/tools/check_ui_playwright.js`

现状：

- 当前项目总数：`242`。
- 标题为“阶段4 UI 验证 ...”的测试项目：`99`。
- 标题为“未命名项目/未命名会话”的项目：`136`。
- `data/uploads/`：`65` 个测试上传文件，约 `17.88 MB`。
- `data/projects/`：`267` 个项目目录，约 `0.87 MB`。

问题：

- 回归测试创建项目后不会删除。
- 测试上传的图片不会清理。
- 多次运行会持续增加项目和上传文件。

建议：

- 在 Playwright 测试结尾调用项目删除接口并清理本轮的 `file_id`。
- 清理历史测试数据前先按项目标题和时间备份。

## P1：前端确定的死代码/失效资源

### 3. 未调用的前端函数

文件：`mimirtalk_webui/frontend/src/app.js`

| 项 | 行号 | 证据 | 建议 |
| --- | ---: | --- | --- |
| `GROUP_AVATAR_LAYOUT_LIMIT` | 18 | 仅定义，未使用；拼图代码直接写死 `slice(0, 4)` | 删除常量或替换写死值 |
| `sortedAvatarAssets()` | 277 | 仅函数定义，无调用 | 删除；连带检查 `roleDisplayName()`、`roleCategoryRank()` |
| `drawCanvasTextLines()` | 2402 | 仅函数定义，无调用 | 删除 |
| `drawExportAvatar()` | 2531 | 仅 Playwright 测试直接调用，产品代码不调用 | 保留则明确为测试钩子；否则测试改用 `drawExportAvatarContent()` |
| `const fontFamily` | 2688 | `buildChatExportLayout()` 内定义后未使用 | 删除该局部变量 |

### 4. 选择支移除后的 popup 资源残留

文件：

- `frontend/src/app.js`
- `frontend/src/styles.css`

问题：

- `EXPORT_ASSET_URLS.popup` 仍存在。
- 导出图片加载时仍会加载 popup 图片。
- `images.popup` 构建后没有被任何绘制逻辑使用。
- CSS 变量 `--momotalk-popup` 只定义，不再被引用。

建议：

- 删除 `popup` URL、`images.popup` 和 `--momotalk-popup`。
- 可顺带删除未引用的 `--momotalk-back-icon`。

### 5. 其他未使用 CSS

文件：`mimirtalk_webui/frontend/src/styles.css`

| 选择器/变量 | 说明 |
| --- | --- |
| `--bubble-left` / `--bubble-right` | 新气泡资源变量取代，当前仅定义 |
| `--momotalk-back-icon` | 仅定义，无 `var()` 使用 |
| `.contact-signature` | 签名功能已移除 |
| `.toggle-button` / `.toggle-button.off` | 已读开关移除后的残留 |
| `.checkbox-row` | 已读/签名旧表单残留 |
| `.avatar-image` / `.avatar-frame .avatar-image` | 当前头像改由背景图和 mosaic 渲染 |
| `.split-fields` | 延迟字段删除后消息属性不再使用双列布局 |

## P1：Python 与工具冗余

### 6. 未使用导入

文件：`mimirtalk_webui/tools/build_asset_index.py`

- `from collections import Counter, defaultdict`
- `defaultdict` 未使用。

### 7. 未接入实际流程的维护接口

文件：

- `mimirtalk_webui/backend/app.py`
- `mimirtalk_webui/backend/asset_index.py`

项：

- `POST /api/assets/rebuild`
- `AssetIndex.rebuild()`

证据：

- 前端、测试和文档均未调用。
- 当前素材索引通过命令行 `build_asset_index.py` 重建。

建议：

- 如果不需要运行时重建，删除路由和方法。
- 如果保留为维护接口，应在 README 中说明。

### 8. 项目列表响应中的未使用字段

文件：`mimirtalk_webui/backend/project_store.py`

- `message_count`：项目列表已移除消息条数，前端不再使用。
- `path`：前端未使用，仅适合调试。

建议：

- 从公共项目列表响应中移除，或明确标记为调试字段。

### 9. 无引用的历史工具脚本

当前未被 README、代码或测试引用：

- `mimirtalk_webui/tools/build_asset_contact_sheet.py`
- `mimirtalk_webui/tools/inspect_asset_ascii.py`
- `mimirtalk_webui/tools/inspect_luajit_constants.py`
- `mimirtalk_webui/tools/cdp_probe.js`
- `mimirtalk_webui/output/inspect_momotalk_bundle.py`
- `mimirtalk_webui/output/scan_left_rail_dependency.py`

其中 `output/` 下的 Python 脚本属于位置错误，不应放在运行输出目录。

## P1：字体与静态资源冗余

### 10. 旧 serif 子集已不再使用

文件：

- `frontend/assets/fonts/source-han-serif-cn-bold.ttf`（122,308 bytes）
- `frontend/assets/fonts/manifest.json`

状态：

- CSS 已改用 `noto-serif-sc-vf.ttf`。
- 旧 serif 子集只出现在提取 manifest 中，不再被页面引用。
- manifest 不包含当前实际使用的完整 Noto Serif 字体，属于过期记录。

建议：

- 删除旧子集，或者移入历史提取目录。
- 更新 manifest，加入 `noto-serif-sc-vf.ttf` 的来源和用途。

## P2：兼容用途，不建议直接删除

以下项看起来“无效”，实际用于旧项目迁移或 HTTP 基础协议：

- `LEGACY_UNSUPPORTED_MESSAGE_TYPES = {"choice", "moment"}`：负责丢弃旧消息类型。
- `contact.signature`：旧项目字段，当前 UI 已隐藏。
- `appearance.read`：旧已读状态字段。
- `server_version`、`do_OPTIONS`：HTTP 服务基础行为。
- `DEFAULT_CHAT_BACKGROUND_ASSET`、默认头像等 fallback：离线或资源缺失时仍会被使用。

## P2：临时文件和生成物

### 11. 明确残留文件

- 根目录 `0){`，0 bytes。
- 根目录 `debug.log`，14,759 bytes。
- `mimirtalk_webui/debug.log`，990 bytes。
- `mimirtalk_webui/tools/_inspect_ui.js`
- `mimirtalk_webui/tools/_inspect_alpha.py`
- `mimirtalk_webui/tools/_read_lines.py`
- `mimirtalk_webui/output/_uiJ.log`
- `mimirtalk_webui/output/_uiM.log`
- `mimirtalk_webui/output/styles.css.bak_bubble`

### 12. 生成物目录

- `mimirtalk_webui/output/`：113 files，约 37.46 MB。
- 根目录 `output/`：175 files，约 78.70 MB。
- `__pycache__`：43 个目录。
- `.pyc`：298 个文件。
- `data/uploads/`：65 个文件，约 17.88 MB，主要是测试上传图。

建议：

- 保留最终交付截图；中间回归目录按批次归档或删除。
- 清理 `__pycache__` 和 `.pyc` 属于低风险。
- 历史迁移备份 `backup_1148_migration_20260920` 确认无误后再处理。

## 推荐清理顺序

1. 修复 `build_contact_map.py` 的覆盖风险，并让 Playwright 自动清理测试项目/上传文件。
2. 删除前端确认无调用的函数、变量、popup 资源和死 CSS。
3. 清理旧 serif 子集并更新字体 manifest。
4. 处理临时脚本、0 字节文件和日志。
5. 确认历史数据后再清理测试项目和 output 目录。

