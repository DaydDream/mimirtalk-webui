# MimirTalk WebUI 工作记录

更新日期：2026-09-20（晚间暂停快照）

当前状态：**中心界面开发已基本完成**。气泡资源审计后最终保留 17 组静态主题，运行时动态组件主题不纳入 WebUI。
回归：联系人、项目读写、群聊管理、图片上传、前端和 Playwright UI 检查均通过。

交接说明：早期一次「查看弥弥尔通讯开发进度」任务因模型侧工具调用参数非法 JSON 报错中断，
排查结论与开工步骤见 `mimirtalk_webui/HANDOFF.md`。

## 晚间恢复点

**当前状态：功能已完成并通过回归，按用户要求暂停，晚上继续。**

本轮最新完成：

- “弥弥尔通讯”侧栏、项目管理入口、新建项目和删除项目已完成。
- 项目列表字段改为“项目”，移除消息条数；角色选项卡中的会话列表保持原样。
- 侧栏底部只保留“保存项目”，PNG 导出仅保留在聊天预览输入栏。
- 后端 `DELETE /api/projects/<id>` 与项目目录删除测试已补齐。
- 最新回归：`check_project_store.py`、`check_backend.py`、`check_frontend.py` 均通过，Playwright `issues=[]`。
- 端到端验证：临时创建项目 → 显示删除按钮 → 界面删除 → 读取接口返回 `404`。

晚上继续时优先处理：

1. 用户先确认项目管理侧栏的交互和样式；如需调整，优先处理这一项。
2. 清理临时检查文件、0 字节残留和旧日志。
3. 气泡中文名等待用户从游戏内补充后接入。
4. 评估“气泡实时预览与编辑器分离”，目前仍是可选项。
5. 头像尺寸对齐暂不改，保留为已知差异。

恢复预览：

```powershell
C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe `
  mimirtalk_webui\backend\app.py --host 127.0.0.1 --port 8765
```

预览地址：`http://127.0.0.1:8765/`
## 项目边界

- 项目目录：`C:\Users\ori\OneDrive\文档\ChatGPT\adv解包\mimirtalk_webui`
- 当前目录不是 Git 仓库，暂不需要上传 Git。
- `image` 类型支持静态 PNG/JPG/JPEG；`moment` 类型仍不在范围内。
- 动态贴纸已移出输入和输出范围。
- 最终导出文件只支持静态 PNG，不支持动图。

## 已确认决策

- 顶部按钮进入“群聊管理”；新建群组只保留在角色列表顶部的“新建群组”入口。
- 内置群和自建群都允许修改成员、删除群聊；群名仍不支持修改。
- 新建群组只服务于用户生成更多可对话角色的聊天记录。
- 自定义群组使用 `9200` 起始 ID 序列递增；当前已有 `9200`、`9201`、`9202`，下一个应从 `9203` 开始。
- 群名没有中文时，显示名使用「群」。
- 新建群组最少选择两人，不满足时提示「至少选择两名成员」。
- **“前鬼坊天狗”统一使用角色 ID `1048`，`1148` 映射已删除。**
- 用户提供的「宁西达」「斯卡蒂」对应当前项目名「宁希达」「丝卡蒃」。
- **气泡主题：仅玩家自己的消息（右侧）套用玩家选定主题；其他角色（左侧）使用默认气泡。**
  依据：`MomoTalkBubbleBaseItem.lua` 的 `chatBubbleNormal` / `chatBubble_L` / `chatBubble_R`
  配合 `GetCurChatBubbleID`、`IsDefaultBubble`、`RestoreDefaultBubbleStyle`。
- **群成员 ≥ 4 人时取前 4 人拼图**（对齐游戏内置群头像，实测 9002 的 9 人也只输出 4 格）。
- **不再校验用户自建群名**（用户明确取消）。
- 活动限定气泡不再补解。
- 气泡中文名暂时不补，用户会从游戏内补充。

## 2026-09-20 第七次更新：气泡资源审计与补全

- 游戏版本：`v5.3.0`，build `313`。
- 定向解包 `textureconfig/chatbubble/`，实际得到 15 组完整气泡、30 张左右变体，提取错误为 0。
- `ChatBubbleCfg.lua` 中共有 22 条气泡配置。
- 从 `widget/system/chat.ys` 恢复 5 组旧版右侧完整气泡：
  `9016`、`9017`、`9019`、`9021`、`9022`。
- 新增的静态完整单图主题只替换玩家右侧气泡；左侧继续使用默认 `9000`。
- `9016`、`9017` 是完整单图，已纳入；`9019`、`9021`、`9022` 是运行时动态组件主题，最终不纳入 WebUI。
- 最终主题数量：17。
- 当前游戏包没有找到 `9006`、`9009`、`9012`、`9101` 的气泡图，不进行伪造或错误替代。
- 审计结果：
  `mimirtalk_webui/data/bubble_extraction_report.json`
- 本轮定向解包产物：
  `extract/aethergazer_momotalk_bubbles_audit/manifest.json`

## 2026-09-20 第六次更新：静态发图

- 在表情按钮左侧增加图片按钮，并新增隐藏文件选择器。
- 仅允许 PNG、JPG、JPEG，最大 8 MiB；其他格式和超大文件通过系统提示拒绝。
- 图片上传到 `mimirtalk_webui/data/uploads/`，项目消息保存 `file_id`、文件名和宽高。
- 图片消息支持左右方向、发言人、预览、项目保存/重载和 PNG 长图导出。
- 图片本身不显示管理员/发言人文字，不套灰色卡片或新增背景。
- 文本只做垂直居中：左右气泡的每一行都从气泡左侧安全边界起排，避免右侧长文本换行后逐行反向贴右。
- 预览和 PNG 导出统一使用 14px 左右的文本横向安全边距。
- 长文本消息使用两个头像之间的完整消息轨道，右侧长气泡可向左扩展至轨道边界，但不会越过头像。
- 发言人标签与对应气泡采用同一左侧内边距，预览与导出都不再贴到右侧头像。
- 聊天滚动区底部增加背景预留，滚到底时最后一条消息与输入栏之间保留自然间距。
- 预览最大宽度 `34cqw`、最大高度 `32cqh`；PNG 导出最大 `320x240`，按原图比例等比缩放。
- 输入栏增加第三枚功能按钮后，缩窄发言角色选择、输入间距和按钮尺寸，所有控件保持在输入栏边界内。
- 新增项目消息类型 `image`，更新 schema、项目迁移、后端上传接口和自动化测试。

## 2026-09-20 第五次更新：群聊管理

- 顶部“新建群聊”改为“群聊管理”，角色列表顶部“新建群组”继续负责创建流程。
- 管理弹窗可切换全部内置群和自建群，复用成员分页、搜索与头像拼图。
- 成员卡片支持加入和移除，点击“保存修改”写入后端并刷新联系人、发言人和当前项目。
- 删除群聊使用二次确认。自建群从 `custom_groups.json` 删除；内置群通过
  `group_members.json` 的 `deleted_group_ids` 记录删除状态。
- 新增 `PUT /api/groups/{id}` 与 `DELETE /api/groups/{id}`。
- 后端测试覆盖内置群/自建群成员更新与删除；浏览器端到端测试覆盖改成员、保存和删除。

## 2026-09-20 第四次 UI 更新

- 聊天头部移除联系人头像，只保留联系人名字；网页预览与 PNG 导出的名字均水平、垂直居中。
- 左右文本气泡统一水平、垂直居中，预览 DOM 与 Canvas PNG 导出使用同一对齐规则。
- 表情按钮不再复用实际内容为加号的 `icon_face_add`，改为内联 SVG 笑脸图标。
- Playwright 新增头部无头像、头部名字居中、文本气泡居中、SVG 图标存在且尺寸有效的断言。

## 本轮已完成（2026-09-20 第二次更新）

### A. 数据与资源

- **迁移 `1148` → `1048`**：6 个项目文件各 1 处（均在 `contact/member_ids[3]`）。
  备份在 `mimirtalk_webui/output/backup_1148_migration_20260920/`。
- 补解 `textureconfig/chatbubble/`：30 个资产 = **15 组气泡主题**，每组含左/右两个变体。
  已并入 `extract/aethergazer_momotalk/images/misc/`，索引新增 `misc: 30`。
- 新建 `mimirtalk_webui/data/bubble_themes.json`：15 个可用主题 + `ChatBubbleCfg` 配置表（22 条）。
- 新建派生资源 `assets/avatars/bubbles/bubble_9021_01_body.png` / `_streak.png`（飘带拆分，后续已清理）。

### B. 气泡主题系统

- 后端新增 `GET /api/bubble-themes`（`Application.bubble_themes()`）。
- 气泡从“整图拉伸”改为 **9-slice**；左右各用自己的图
  （编号本体 = 尾巴朝左；`_1` 变体 = 尾巴朝右），**不再使用 `scaleX(-1)` 镜像**。
- 切边按比例：上下 25%、左右 30%，保证四角装饰不进入拉伸区。
- 文字颜色按**气泡底色亮度**自动取：深底用 `ChatBubbleCfg.color2`，浅底用 `color1`。
  注意 **9001 的左右变体底色不同**（左 `#EEEEEE` 浅、右 `#595959` 深），故文字色分左右设置。
- 选择器入口两处：编辑区「聊天气泡」按钮 + **中心界面左栏管理员头像下方的气泡图标**。
- 选中后同步：CSS 变量（左右图 + slice + edge）、导出用 `EXPORT_ASSET_URLS` 与
  `BUBBLE_NINE_SLICE`、文字色 `BUBBLE_TEXT_COLOR_LEFT/RIGHT`，并存入 `project.appearance.bubble_theme_id`。
- 默认主题 `9000`。

### C. UI 精修

- **列表卡片**：恢复 `Momotalk_10`（普通）/ `Momotalk_11`（选中）作 9-slice 背景；
  新增选中态蓝色三角 `Momotalk_12`（与游戏 `chatItem/arrow` 20×36 一致）；卡片上下留 5% 间距。
- **选中位移**：`.side-entry.active { transform: translateX(0.5cqw) }` + 0.16s 过渡
  （对应游戏 `ChatMainView` 的 `SetSelectedState` + `localPosition`）。
- **输入栏**：`Momotalk_06` 面板图从只覆盖 speaker 扩展到**整行铺满**（`opacity: 0.42` 淡化，
  `overflow: hidden` 裁掉溢出）；加深了外框、speaker 分隔线、输入框与按钮边界。
- **管理员头像弹窗**：隐藏分类下拉与搜索栏（仅 7 个头像）；卡片高度从 ~975px 收敛到 137px；
  弹窗高度自适应（720px → 260px）；状态行紧贴网格下方。
- **新建群聊弹窗**：「取消 / 创建群聊」从底部 footer 移到**左栏群头像预览下方**（各占一半宽、
  高 34px）；删除 footer；弹窗高度（700px → 442px）。
- **列表卡片无消息时不再显示类别文案**：移除「群组 / 角色」回退文案，
  `secondary` 直接留空；`title` 也不再留多余的 ` · `。

### D. 样式修正

- **长宽比修正**：WebUI 的 `cqw` 基准是 `.phone-stack`（916px），而游戏逻辑宽 1680px，
  整体缩放 **0.549 倍**。气泡边框宽度之前按源图 1:1 填，导致相对粗 1.8 倍，已按 0.549 修正
  （实测从 5px 降到 1.5–2px）。
- **气泡宽度**：`34cqw` → `67cqw`。
- **短消息右对齐 bug（重要）**：`.chat-row.right` 原为
  `justify-content: flex-end` + `flex-direction: row-reverse`，但 row-reverse 下 `flex-start` 才是右边缘。
  长消息因气泡几乎占满行宽而看不出，**所有短消息都会靠左**（实测头像右间隙 303px）。
  修正后为 8px。
- **头像右边界**：预览 `.chat-scroll` 左右 padding `1.8cqw` → `0.9cqw`；
  导出 `bodyPaddingX` 30 → 16；两边头像右间隙均约 **1.7%**。

### E. 功能删除

- **已读**：顶栏 `#readToggle`、`#messageCount`（N 条消息）、右侧 `#readCheckbox`（显示已读）
  及其事件与渲染逻辑全部删除。**保留 `appearance.read` 数据字段**（向后兼容）。
- **签名**：聊天头部 `#previewSignature`、编辑栏 `#contactSignatureInput`、
  **导出 PNG 时的签名绘制**（`fillText(signature, ...)` 三行）全部删除。**保留 `contact.signature` 数据字段**。

### F. 回归与测试

- `check_ui_playwright.js` 更新：`Momotalk_03` → `Momotalk_06`、`side` 旧断言改为反向防回退、
  群头像 tiles 期望值改为内置坐标、5 人场景改为断言“仍为 4 格”、
  删除群名断言与已读/签名相关读取与断言。
- `check_frontend.py` 修正过期断言：`backgrounds` 数量从硬等 5 改为检查默认背景存在。
- `check_backend.py` 的资源总数与背景数量改为从 `data/asset_index.json` 动态计算，避免新增资源后误报。
- `drawNineSlice()` 从固定四边同值升级为**支持非对称切边**。
- 回归结果：`check_ui_playwright.js` **exit=0、issues=[]**；`check_contact_map.py`、`check_project_store.py`、`check_backend.py`、`check_frontend.py` 均通过。

### G. 气泡设计参考（重要）

- **15 组 `TextureConfig/ChatBubble` 气泡主体是“完整单图”**，装饰直接画在图上，不存在独立组件。
- `9016`、`9017` 的 `bg` 也是完整 sliced 单图主体，但其 UI 树另有羽饰 Image、Animation 和粒子子节点。
- `9019_01`/`9021_01`/`9022_01` 是“主体 + 独立装饰”的运行时动态结构，未纳入 WebUI。
- 每组主题的左右两张图分别对应 `ChatBubbleCfg.image1` / `image2`。
- `ChatBubbleCfg.color1` = 浅底时的文字色；`color2` = 深底时的文字色。
- 气泡资源逻辑路径为 `TextureConfig/ChatBubble/{image1}`（动态拼接）。

## 2026-09-20 动态组件气泡排除

- 经对照游戏内预览确认，`9019`、`9021`、`9022` 的装饰依赖运行时动态 UI 组件、Animator 和粒子/特效状态。
- 项目是静态内容编辑与导出，无法忠实还原这些动态布局，因此三组主题不纳入 WebUI。
- 已删除派生单图、合成报告、合成脚本和资源索引条目；气泡选择器保留 17 组静态可用主题。

## 2026-09-20 气泡文字留白调整

- 对照游戏内文字效果，将预览气泡内边距从四边 `1.4cqw` 调整为纵向 `1.9cqw`、横向 `1.5cqw`。
- PNG 导出同步调整：文字横向预留保持 `14px`，单行气泡上下总留白从 `40px` 调整为 `44px`。
- 已逐项检查 17 组主题；文字上下最小留白 `15.72px`，左右最小留白 `12.41px`，无文字贴边或遮挡。
- Playwright 回归 `issues=[]`。

## 2026-09-20 游戏字体与名字布局

- 从游戏 `fonts/sourcehansans.ys` 提取 `SourceHanSans`，用于界面和正文。
- 从游戏 `fonts/sourcehanserifcn-bold-3.ys` 提取 `SourceHanSerifCN-Bold-3.0`，用于消息名字。
- 新增前端静态资源路由 `/assets/`，字体文件位于 `mimirtalk_webui/frontend/assets/fonts/`。
- 名字字号、字重和相对气泡的左缩进按游戏截图调整；PNG 导出同步使用游戏字体。
- 提取脚本：`tools/extract_aethergazer_fonts.py`。
- Playwright 回归 `issues=[]`，字体加载检查 `sans=true`、`serif=true`。

## 2026-09-20 UI 细节收尾

- 系统消息和撤回消息统一为纯文字样式，移除底板和内边距。
- 选中会话卡的蓝色三角指示移入卡片与侧栏边界之间，并给选中卡增加边界阴影。
- 预览正文缩小到 `1.5cqw`，导出正文为 `22px`；消息框不再限制为头像倍数，而是按聊天气泡通道自然展开。
- 导出时名字移到头像上方，气泡贴近头像顶部，使三角指示落在头像中间偏下位置。
- 非管理员角色消息在预览和导出中固定使用 9000，管理员消息使用当前选择主题。
- Playwright issues=[]。

## 2026-09-20 标题框与消息滚动边界

- 群名/会话名改为文字加虚线边框的居中标签。
- 消息滚动区限制在标题栏下沿与输入栏上沿之间，手机和桌面均不会伸入两端 UI 下层。
- 出现选择支时，滚动区底部自动收缩到选择面板上方。
- 滚动区保留顶部和底部背景空间，避免首尾消息贴边。
- 同步收紧正文/导出字号；左、右消息按头像之间通道自然展开，不再卡在中间窄带。
- 非管理员角色消息在预览和导出中固定使用 9000，管理员消息使用当前选择主题。
- Playwright issues=[]。

## 2026-09-20 透明标题、管理员与表情对齐

- 标题栏背景完全透明，只保留会话名/群名文字和虚线边框。
- 管理员消息不再显示“管理员”名字字段，头像和消息内容保持不变。
- 左侧角色的表情消息改为左对齐，右侧表情保持右对齐。
- 导出系统消息移除底板，只保留居中文字，与界面保持一致。
- 非管理员角色消息在预览和导出中固定使用 9000，管理员消息使用当前选择主题。
- Playwright issues=[]。

## 2026-09-20 透明标题与系统导出修正

- 顶部标题栏背景改为透明，只保留群名/角色名文字与虚线框。
- 管理员消息不再显示“管理员”名字标签。
- 左侧角色表情消息改为左对齐，右侧表情保持右对齐。
- 导出系统消息移除弹窗底板，仅保留居中文字，与预览一致。
- 非管理员角色消息在预览和导出中固定使用 9000，管理员消息使用当前选择主题。
- Playwright issues=[]。

## 2026-09-20 会话排序与纯文字修整

- 标题虚线框改为透明框，只保留文字和透明的布局占位。
- 新消息写入 `created_at`；旧消息在打开项目时补齐顺序时间。
- 角色/聊天室列表按最后一条消息时间倒序排列，当前选中项置顶，“新建群组”入口保持第一。
- 管理员消息隐藏名字标签；左侧表情对齐左侧，右侧表情对齐右侧。
- 导出系统消息改为纯文字，无底板。
- 导出短消息取消固定最小宽度，按文字宽度收紧；角色名与气泡改为明确的上下分层布局。
- 非管理员角色消息在预览和导出中固定使用 9000，管理员消息使用当前选择主题。
- Playwright issues=[]。

## 2026-09-20 项目封包

- 生成自包含发布包：`webui项目封包/MimirTalk_WebUI_v1_20260920.zip`。
- 包内包含 WebUI 源码、1484 个索引资源、字体、提取工具、流程文档、完整开发日志和启动脚本。
- 素材索引路径已从 `extract/` 重写为包内 `assets_source/`，无需依赖原始解包目录。
- 项目、上传、缩略图、运行输出、自定义群、内置群改名和删除覆盖均已清空。
- 独立启动验证：资源 1484、项目 0、联系人 79、状态 `ok`。
- ZIP 大小约 195.40 MiB，SHA256：`3B3DEC1D3B89C64AE5D6FAF5B98914E33302D39FFFC508D1F63844C4754BBF34`。

## 2026-09-20 脚本中文注释统一

- 为项目自有 Python 脚本统一补充中文模块说明；第三方 vendor/bin 目录跳过。
- 为 WebUI 后端、构建脚本、检查脚本和提取脚本补充关键类/函数职责说明。
- 删除自动生成的泛化占位注释，只保留有实际语义的中文注释。
- 前端主脚本和 Playwright 回归脚本增加中文模块头、关键区块说明，并替换英文注释。
- 全量 Python AST 解析、Node 语法检查、联系人/项目/后端/前端检查和 Playwright 回归均通过。

## 2026-09-20 项目归档与清理

- 新建 `webui开发日志/`，保存完整开发日志、核心文档、有效脚本、关键截图、报告、项目清理清单和 SHA256 校验。
- `build_contact_map.py` 已改为保留手工角色和现有映射。
- Playwright 已加入测试项目和测试上传图片自动清理。
- 已删除前端未调用函数、变量、popup 残留、死 CSS 和未使用方法。
- 旧 serif 子集及旧样式备份已归档，未使用字体资源已移除。
- 已备份并删除 260 个测试/未命名项目，保留 7 个非测试项目。
- 已删除 65 个测试上传文件，清空旧 output 生成物和 Python 缓存。
- 最终健康检查：`status=ok`，项目 7，上传 0。

## 2026-09-20 新角色导入

- 导入克图格娅（10183）、长琴（10169）、泰逢（10175）、后土（10176）、尼娅（10144）、苍术（10111）。
- 六张源图均为 `300x144 RGBA`，复制到 `frontend/assets/avatars/character_itemshead/story_comsingle/sprite/`。
- 已更新 `chat_contacts.json`、`asset_names.json`、资源索引和联系人映射报告。
- 浏览器验证：六个角色均出现在左侧列表、联系人头像、发言人下拉，预览名称与头像资源正确。
- 字体覆盖复查：当前 87 个唯一联系人名称在 Sans/Serif 字体中缺字均为 0。

## 2026-09-20 名字字体回退修复

- 游戏提取的 `SourceHanSerifCN-Bold` 只有 437 个字码，缺少“奥、里、御、津、羽、迪、斯”等常用字，浏览器会逐字回退到微软雅黑。
- 名字字体改用完整 `NotoSerifSC-VF.ttf`（30,928 个字码，与 Source Han Serif 同源），覆盖“奥西里斯”“暗御津羽”“哈迪斯”等名字。
- 预览与 PNG 导出同步使用完整字体；Playwright `issues=[]`。
- 已扫描 `chat_contacts.json`、群组名称覆盖、自定义群和现有项目联系人共 346 条名称记录、82 个唯一名称；SourceHanSans 与 NotoSerifSC 缺字数均为 0。

## 2026-09-20 气泡中文名接入

- 已接入用户提供的中文名称：9000 默认白、9001 默认黑、9002 岁序更新、9003 愿祈佳语、9004 稳定与唯一、9008 海滨邹鲁、9010 喷香美味吐司、9011 雾中语、9013 真心洞察、9014 掌上星、9015 紊中有序、9016 她与我的花季、9017 解心语、9018 拼凑的字符、9020 亲亲时刻。
- `9005`、`9007` 暂未找到，选择器继续显示编号。
- 气泡选择卡和当前气泡标签已使用中文名，小字继续保留 ID 和尺寸。
- 对照文件：`data/bubble_name_checklist.csv`、`output/bubble_name_checklist.png`。
- Playwright 名称与气泡回归 `issues=[]`。

## 2026-09-20 编辑栏六项改造

- 添加消息改为直接创建默认系统提示，不弹选择层；可在消息属性中改为撤回。
- “会话标题”改名为“项目标题”，默认标题改为“未命名项目”，旧默认标题自动迁移。
- 群组联系人名字支持写回群名；内置群名称保存在 `group_members.json.group_names`。
- 群组改名后同步所有引用该群组的项目摘要；打开旧项目时以后端当前群名覆盖项目联系人快照。
- 联系人头像改为只读展示，群组使用自动群头像；联系人头像素材选择入口已删除。
- 聊天背景选择器只保留 `Momotalk_03` 和 `Momotalk_04`，其他背景回退到 04。
- 修复消息删除：活动会话数组原地删除，避免被旧数组引用覆盖。
- 移除 `delay_ms`；消息类型精简为 text、system、recall、sticker、image；旧 choice/moment 加载时丢弃。
- 修复撤回消息未进入 PNG 长图的问题；system/recall 均作为居中文字导出。
- 删除预览栏英文 `LIVE PREVIEW` 和编辑栏英文 `INSPECTOR`。
- 验证：`check_project_store.py`、`check_backend.py`、`check_frontend.py` 通过；Playwright `issues=[]`。

## 2026-09-20 气泡九宫格修正

- 对照 `widget/system/chat.ys` UI 树：气泡主体 `bg` 为 `UnityEngine.UI.Image`，`m_Type=1`（Sliced）。
- 原有气泡 `slice` 是比例估算，不是官方值，且右侧气泡错误复用了左侧切片；例如 9000 官方 `m_Border(top/right/bottom/left)` 为 `57/63/30/63`，旧值只有 `22/34/22/34`。
- 17 组主题左右变体已全部改用 Unity `Sprite.m_Border`，并分别写入各自 slice。
- 素材索引对 `textureconfig/chatbubble` 和 9016/9017 改用完整 `texture2d`，避免 sprite 自动裁边后九宫格边界失真。
- 预览 CSS 与 PNG 导出改为左右分别使用各自的 slice；导出气泡最小宽高按四角和连接区约束。
- 核对 UI 树：9016 有 17 个节点（含 10 Image、3 Animation、1 ParticleSystem），9017 有 10 个节点（含 5 Image、3 Animation）；当前仅接静态主体，动态层未接入。

## 2026-09-20 项目侧栏与项目管理

- 左侧标题从“弥弥尔频道”改为“弥弥尔通讯”，英文副标题改为 `Mimir Communication`。
- 标题右侧按钮改为项目管理入口，进入后可新建项目，并为列表中的项目显示删除按钮。
- 侧栏字段改为“项目”；项目条目不再显示消息条数。
- 角色选项卡中的会话字段保持原样，仍展示会话名称、最近消息和时间排序。
- 移除侧栏底部“导出 PNG”，只保留“保存项目”；导出功能仅保留在聊天预览输入栏。
- 后端新增 `DELETE /api/projects/<id>`，`ProjectStore.delete_project()` 删除项目目录；删除当前项目后自动切换到其它项目或创建空项目。
- 端到端验证：临时创建项目 → 打开项目管理 → 显示删除按钮 → 从界面删除 → 接口返回 404；`check_project_store.py`、`check_frontend.py`、`check_backend.py` 均通过，Playwright `issues=[]`。
- 修复 OneDrive 将项目目录同步为 `ReparsePoint + ReadOnly` 后删除返回 `500` 的问题：清理只读属性后重试删除。`check_project_store.py` 已增加只读目录删除回归。
- 重启后端后通过真实 API 验证：创建项目 → 标记目录只读 → 删除接口返回 200 → 项目目录不存在。
## 后续待办

1. **清理临时检查文件**
   - `mimirtalk_webui/tools/_inspect_ui.js`
   - `mimirtalk_webui/tools/_inspect_alpha.py`
   - `mimirtalk_webui/tools/_read_lines.py`
   - 项目根目录 `adv解包/0){`（0 字节残留）
   - `mimirtalk_webui/output/_uiJ.log`、`_uiM.log`（被中断进程占用，重启服务后可删）

2. **气泡中文名**
   - 当前选择器只显示编号（9000–9020）。
   - 名称由道具表 `ItemCfg` 提供，但解包内只找到「默认气泡」「初始气泡」 2 条。
   - 用户会从游戏内补充后再加。

3. **气泡实时预览与编辑器分离**
   - 当前主题选择器与编辑区共用一个弹窗，下一步可考虑独立。

4. **头像尺寸对齐（用户已说暂不改）**
   - 导出头像 76px（占画布 7.9%）vs 游戏 112px（11.7%）vs 预览约 12.7%。

5. ~~**表情按钮可见性**~~ 已完成
   - 已改为内联 SVG 笑脸图标，并通过桌面、移动端和 Playwright 视觉回归。

6. ~~导出侧气泡装饰层~~ 已清理
   - 已删除 `drawBubbleDecorations()`、`BUBBLE_DECORATIONS`、`BUBBLE_DECOR_BASE_WIDTH`、
     `--momotalk-bubble-flower` / `-streak`变量与 `.bubble::after` 规则，
     并删除 `assets/avatars/bubbles/` 下的两张派生图。索引已重建（`bubbles` 分类消失）。

## 关键文件

- `mimirtalk_webui/frontend/src/app.js`
- `mimirtalk_webui/frontend/src/styles.css`
- `mimirtalk_webui/frontend/index.html`
- `mimirtalk_webui/data/chat_contacts.json`
- `mimirtalk_webui/data/group_members.json`
- `mimirtalk_webui/data/custom_groups.json`
- `mimirtalk_webui/data/asset_index.json`
- `mimirtalk_webui/data/bubble_themes.json`
- `mimirtalk_webui/data/bubble_extraction_report.json`（新增）
- `extract/aethergazer_momotalk/images/misc/textureconfig_chatbubble_*`（新增）

## 验证脚本

- `mimirtalk_webui/tools/check_frontend.py`
- `mimirtalk_webui/tools/check_backend.py`
- `mimirtalk_webui/tools/check_project_store.py`
- `mimirtalk_webui/tools/check_ui_playwright.js`

## 已知风险

- `check_ui_playwright.js` 中有一批等待选择器的超时（90s）：
  **删除 DOM 元素时必须同步搜一遍 `tools/`**，否则会因等不到元素而挂住。
  本轮已在删除「已读」与「签名」时各踩一次。




## 2026-09-21 项目改名为 MimirTalk WebUI

- 源码目录 `momotalk_webui/` 重命名为 `mimirtalk_webui/`，发布包内同名目录同步改名。
- 产品标题、启动脚本、页面 `<title>`、服务 `server_version`、schema `title`、README、开发日志和归档文档统一改为 `MimirTalk WebUI`。
- 发布目录与 ZIP 更名为 `MimirTalk_WebUI_v1_20260920`。
- 游戏自身术语（`MomoTalk`、`MomoTalkRequestHandler`、`MomoTalk Sans/Serif`、Lua 文件名和资源路径）属于对照游戏内容，保持原样。
- 全量复扫确认 `momotalk_webui`、`MomoTalk_WebUI`、`MomoTalk WebUI`、`MomoTalkWebUI` 已被清除。
## 2026-09-21 未引用素材清理

- 以「联系人 / 贴纸分类 / 气泡主题 / 管理员头像 / 聊天背景 / 代码内硬编码」为引用来源，对 asset_index 的 1484 条逐条比对。
- 删除 971 个未被引用素材（约 146.3 MB），其中 `character_icon` 半身像库 254 张（108 MB）占大头。
- 同步删除 `backhouse_rolehead`（104 张）、`character_icon`（254 张）两个目录，并从 `build_asset_index.py`、`build_contact_map.py`、`extract_shared_heads.py` 移除对应分类。
- 保留 513 条被引用素材：联系人头像 69、贴纸 335、气泡组件 49、misc 30、momotalk_images 17、本地化贴纸 9、背景 3、图集 1。
- 发布包 `assets_source` 从 1475 个文件降到 504 个，ZIP 从约 195 MB 降到约 48 MB。
- 校验：513 条索引全部可在包内解析，79 个联系人无缺失头像，后端/前端/项目/联系人检查全部通过。
- 被删素材在 `extract/aethergazer_chatbubble`、`extract/aethergazer_i18n` 等备份目录仍保留原件，可按需重新索引。

## 2026-09-21 v1.0.1 发布包与索引口径统一

- 发布目录、ZIP 与 SHA256 文件统一为 `MimirTalk_WebUI_v1.0.1_20260920`，不再使用无点号的 `v1` 命名。
- 包内 `VERSION.txt`、`BUILD_INFO.txt`、`README-发布包.md` 与服务 `server_version` 统一标记 `v1.0.1`。
- 素材索引统一为 518 条，发布包内 `assets_source` 509 个文件；验证脚本报告 0 条无法解析的引用。
- `PACKAGE_FILES.sha256` 为 701 条，独立解压后逐文件复算 0 处不符；ZIP 内 702 个文件、4 个目录，顶层目录名正确。
- 发布包验证：`check_asset_references.py` 与 `check_backend.py` 均退出码 0。
- ZIP 大小 61,663,476 字节，SHA256：`FEFB75FB9734041CB16BED0C9195EADF79DB4A58950AABD1A59CBEF059CAA2C5`。
