# MimirTalk WebUI 交接说明

写入时间：2026-09-19
最近更新：2026-09-20
写入来源：上一个任务「查看弥弥尔通讯开发进度」报错后的排查。
用途：**下次开新对话时先读这一份，再读 `WORKLOG.md`。**

## 当前晚间恢复点（2026-09-20）

**已按用户要求暂停，最新一轮界面改造已完成并验证。晚上继续时先读这里。**

当前结论：

- “弥弥尔通讯 + 项目管理”侧栏已完成。
- 项目支持新建和删除；侧栏列表不再显示消息条数。
- 底部“导出 PNG”已移除，导出仅保留在聊天预览输入栏。
- 后端项目删除接口及项目存储删除测试已完成。
- `check_project_store.py`、`check_backend.py`、`check_frontend.py`、`check_ui_playwright.js` 均通过；Playwright `issues=[]`。
- 当前预览：`http://127.0.0.1:8765/`
- 最新侧栏截图：`output/ui_project_management_active.png`

晚上恢复顺序：

1. 请用户确认项目管理的交互与视觉；有反馈先改这一项。
2. 清理 `tools/_inspect_*.py`、`tools/_inspect_ui.js`、`tools/_read_lines.py`、旧日志和根目录 0 字节残留。
3. 等待用户补充气泡中文名后接入选择器。
4. 评估气泡选择器与编辑区分离。
5. 导出头像尺寸对齐继续暂缓。
---

## 一、上个对话为什么报错

- 任务标题：`查看弥弥尔通讯开发进度`
- 任务状态：`systemError`（已失败，不建议续用）
- 使用链路：CC Switch 本地代理 -> OpenCode Go -> 模型 `deepseek-v4-flash`
- 报错原文关键部分：

```
CC Switch local proxy failed while handling Codex endpoint /responses.
Provider: OpenCode Go; model: deepseek-v4-flash; upstream_status: HTTP 400
cause: Upstream request failed: [400]
Assistant tool call function.arguments must be valid JSON.
```

结论：

1. 这不是项目代码、数据文件或本地服务的问题，项目文件没有被这个报错破坏。
2. 失败原因是助手发出的一次工具调用，`function.arguments` 不是合法 JSON，上游校验请求历史时直接返回 400。
3. 这轮请求持续了约 779 秒（约 13 分钟），中途发生过一次上下文压缩，属于典型的长上下文 + 多工具调用场景。`deepseek-v4-flash` 在这种场景下更容易产出畸形工具调用参数。
4. 那条坏掉的工具调用已经进入该任务历史，之后追问「出现什么问题了」只用了约 1 秒就再次 400，是同一条坏历史被重放导致。

处理方式：

- **不要续用那个报错任务**，否则会反复 400。
- 在同一个项目目录新开对话，换更稳的模型（建议 `deepseek-v4-pro` 或其它长上下文稳定的模型）。
- 如果 CC Switch 有 JSON 修复 / 容错相关开关，可以开启。

---

## 二、下次对话怎么开始（给新模型看的指令）

1. 先读 `mimirtalk_webui/WORKLOG.md`，以其中的「后续修改要点」为准。
2. 再读本文件，了解环境、报错原因和本次排查留下的证据。
3. 按「剩余待办」顺序开发，每完成一项先给用户反馈，再继续下一项。
4. 修改文件用仓库现有模式，编辑前先读相关文件；不要回退用户已有改动。
5. 编辑栏 UI 与功能需求统一记录在 `mimirtalk_webui/EDITOR_REQUIREMENTS.md`，先补验收标准再开发。
6. 全程用简体中文回复。

---

## 三、当前项目进度（快照，2026-09-20 第七次更新）

项目目录：`C:\\Users\\ori\\OneDrive\\文档\\ChatGPT\\adv解包\\mimirtalk_webui`
该目录不是 Git 仓库。

**中心界面开发已基本完成。** 详细清单以 `WORKLOG.md` 的「本轮已完成」为准，本文件不重复抄写。

本轮完成（摘要）：

- 数据：`1148` → `1048` 迁移（6 个项目文件，已备份）。
- 群头像：官方群优先自身资源；成员 ≥4 人取前 4 人拼图（对齐游戏内置）。
- 气泡：15 组完整主题 + `9016`、`9017` 两组旧版完整单图，共 17 组可选；支持 9-slice 渲染、文字色自适应、选择器和 PNG 导出同步。
- UI：列表卡片背景与选中箭头、选中位移、输入栏整行背景、管理员头像弹窗、新建群聊弹窗均已精修。
- **修复一个影响所有短消息的对齐 bug**：`.chat-row.right` 的 `justify-content` 对象写反。
- 删除冗余功能：已读、消息计数、签名（含导出绘制）。

回归状态：联系人、项目读写、后端、前端和 Playwright UI 检查均通过。

第三次维护已完成：`check_backend.py` 的资源与背景数量改为数据驱动，文档同步当前 `1478` 项资源、`6` 个背景和自定义群 `9200–9202` 状态。

第四次更新已完成：聊天头部只保留居中名字，左右消息文字全部居中，表情按钮改为内联 SVG 笑脸；预览和 PNG 导出的头部规则保持一致。

第五次更新已完成：顶部“新建群聊”改为“群聊管理”，内置群和自建群都支持修改成员与删除；新建群组仅保留在角色列表顶部入口。

第六次更新已完成：表情按钮左侧新增静态发图，仅允许 PNG/JPG/JPEG，错误格式显示系统提示；上传图片可预览、保存、重载并导出 PNG。

第七次更新已完成：定向解包游戏 v5.3.0/build313 气泡资源，恢复 5 组旧版 `widget_system_chat` 主题；其中 `9016`、`9017` 为完整单图，`9019`、`9021`、`9022` 后续确认是动态组件。

第八次更新结论：`9019`、`9021`、`9022` 是运行时动态组件气泡，静态输入无法忠实还原；三组主题已从 WebUI、派生资源和资源索引中移除，最终保留 17 组静态可用主题。

第九次更新已完成：对照游戏内比例收紧消息框并修正 PNG 导出文字位置；导出文字边距按主题 9-slice 动态计算，17 组主题检查通过，Playwright `issues=[]`。

第十次更新已完成：接入游戏 `SourceHanSans` 正文与 `SourceHanSerifCN-Bold` 名字字体，名字布局和 PNG 导出同步调整；Playwright `issues=[]`。

第十一次更新已完成：系统/撤回消息纯文字化，校正选择卡箭头、气泡与头像比例及尾巴对位；Playwright `issues=[]`。

第十二次更新已完成：标题改为文字加虚线框，消息滚动区限制在标题与输入栏之间，并增加滚动背景预留；Playwright `issues=[]`。

第十三次更新已完成：标题栏透明化，删除管理员名字字段，修正左侧表情对齐和导出系统消息透明文字样式；Playwright `issues=[]`。

第十四次更新已完成：保持透明标题和纯文字系统提示，修正表情左右对齐及导出系统消息样式；Playwright `issues=[]`。

第十五次更新已完成：加入消息时间戳和会话列表倒序排序，选中聊天室置顶，并完成透明标题与导出系统消息统一；Playwright `issues=[]`。

第十六次更新已完成：收紧导出短气泡，取消固定最小宽度，并将角色名与气泡改为上下分层布局；Playwright issues=[]。

第十七次更新已完成：项目侧栏改为“弥弥尔通讯 + 项目管理”，支持新建/删除项目；列表字段改为项目且移除消息条数，底部导出 PNG 删除，导出仅保留在聊天预览输入栏；Playwright issues=[]。

## 四、剩余待办（替代旧的“剩余 9 项”）

1. **清理临时检查文件**
   - `tools/_inspect_ui.js`、`tools/_inspect_alpha.py`、`tools/_read_lines.py`
   - 项目根目录 `adv解包/0){`（0 字节）
   - `output/_uiJ.log`、`_uiM.log`（被占用，重启服务后可删）

2. **气泡中文名**：等用户从游戏内补充；目前选择器只显示编号。

3. ~~**表情按钮可见性**~~：已完成，改为内联 SVG 笑脸并通过视觉回归。

4. **头像尺寸对齐**（用户已说暂不改）：导出 76px vs 游戏 112px。

5. ~~导出侧气泡装饰层~~ 已清理（函数、常量、CSS 变量、派生图均已删除）。

## 五、关键风险：删 DOM 元素时要同步改测试

`tools/check_ui_playwright.js` 会等待具体选择器，超时 **90 秒**。
本轮删除「已读」和「签名」时各踩一次：元素删了但测试还在等，导致回归卡死。
**以后删除 DOM 元素，必须先搜一遍 `tools/`。**

## 六、本次排查检查过的文件（证据清单）

| 文件 | 用途 |
| --- | --- |
| `mimirtalk_webui/WORKLOG.md` | **本轮进度与剩余待办的权威来源** |
| `mimirtalk_webui/README.md` | 各阶段构建、运行、验证命令 |
| `mimirtalk_webui/data/chat_contacts.json` | `1048` / `1148` 重复角色（已删除 `1148`） |
| `mimirtalk_webui/data/group_members.json` | 已统一到 `1048` |
| `mimirtalk_webui/data/custom_groups.json` | 当前自定义群为 `9200`、`9201`、`9202`，`asset_id` 为 null |
| `mimirtalk_webui/frontend/src/styles.css` | 主题气泡变量、列表卡片、输入栏、轮讯位移 |
| `mimirtalk_webui/frontend/src/app.js` | 主题应用、9-slice 导出、群头像布局 |
| `mimirtalk_webui/frontend/index.html` | 气泡入口、弹窗结构 |
| `mimirtalk_webui/tools/` | 验证脚本与待清理临时脚本 |
| `adv解包/0){` | 0 字节疑似残留文件 |

---

## 七、验证方法

Python 解释器路径（运行时自带）：

```powershell
C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe
```

常用检查：

```powershell
# 联系人映射
python.exe mimirtalk_webui\tools\check_contact_map.py

# 项目读写 / 迁移
python.exe mimirtalk_webui\tools\check_project_store.py

# 后端
python.exe mimirtalk_webui\tools\check_backend.py

# 前端
python.exe mimirtalk_webui\tools\check_frontend.py
```

UI 回归（需要先起服务）：

```powershell
python.exe mimirtalk_webui\backend\app.py --host 127.0.0.1 --port 8765

$env:MOMOTALK_URL = "http://127.0.0.1:8765"
$env:MOMOTALK_OUTPUT = "output/stage4"
$env:NODE_PATH = "<你的 node_modules 路径>"
node mimirtalk_webui\tools\check_ui_playwright.js
```

注意：

- `check_ui_playwright.js` 默认不写数据。
- 只有服务使用临时 `custom_groups.json` 时，才设置 `MOMOTALK_GROUP_MUTATION=1` 跑会真正建群的完整路径。
- 历史上用过的预览端口是 `8765` 和 `8878`。
- 服务日志在 `mimirtalk_webui/output/` 下，如 `server-8765.out.log`、`server-8878.out.log`。

---

## 八、模型与工具注意事项

- 不要在长上下文、多工具调用的任务里使用 `deepseek-v4-flash`，本次报错就来自它。
- 建议新对话使用 `deepseek-v4-pro` 或同样稳定的模型。
- 如果新对话再次出现 `Assistant tool call function.arguments must be valid JSON`，说明又是模型侧工具参数畸形，换模型或新开任务即可，不要怀疑项目文件。



