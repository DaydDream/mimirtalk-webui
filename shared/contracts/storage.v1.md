# 存储、迁移与回滚契约 v1

依据 D15/D28 冻结的平台存储设计。离线模式必须能跑通现有 WebUI 全功能；
服务端只承接 AI 相关能力与数据，本地与远端分层预留。

契约版本：`1`（`STORAGE_CONTRACT_VERSION = 1`）。

## 1. 对象仓库划分

存储分为「只读内置数据」与「用户可写数据」两类。用户可写数据在两条实现上必须一一对应：

| 仓库 | 键 | 内容 | web 模式落盘位置 | 离线模式（IndexedDB / OPFS） |
| --- | --- | --- | --- | --- |
| `projects` | 项目 `id` | 单个项目 JSON（`version` 字段见第 2 节） | `data/projects/<id>.json` | object store `projects` |
| `uploads` | `file_id` | 上传 PNG/JPG/JPEG 原图 | `data/uploads/<file_id>` | `uploads`（Blob；后续可迁 OPFS） |
| `thumbnails` | `file_id` | 可选缩略图缓存，可随时重建 | `data/thumbnails/` | `thumbnails` |
| `groups` | 群 `id` | 自建群 + 内置群成员覆盖与删除标记 | `data/custom_groups.json` + `data/group_members.json` | store `groups` |
| `conversation_contacts` | `"default"` | 会话联系人清单、会话预览顺序与置顶偏好（`version: 3`） | `data/conversation_contacts.json` | store `conversation_contacts` |
| `sticker_favorites` | `"default"` | 用户收藏的表情记录数组（`{ asset_id, source, sort_order, created_at }`） | `data/sticker_favorites.json` | store `meta` 的 `sticker_favorites` 键 |
| `settings` | 键名 | 应用级设置（主题、模式等） | 前端本地存储 | store `settings` |
| `meta` | 键名 | `db_version`、`app_version`、`last_migration` | 无（由文件结构隐含） | store `meta` |

安卓原生设置另使用以下本地键，均不进入项目 schema，也不递增 `db_version`：

| 键 | 归属 | 语义 |
| --- | --- | --- |
| `bug_folder_uri` | `MimirDiagnostics` SharedPreferences | 用户授权的 Bug 记录文件夹 tree URI |
| `bug_folder_label` | `MimirDiagnostics` SharedPreferences | Bug 文件夹显示名缓存 |
| `bug_delivery_ids` | `MimirDiagnostics` SharedPreferences | 已成功转存的私有报告 id 集合，用于重试去重 |

`bug_folder_uri` 只服务于 Bug 记录文件夹。长图导出固定写入应用管理的
`Pictures/MimirTalk`，不使用 SAF URI、不持久化文件夹授权，也不得与 `bug_folder_uri`
复用或互相迁移。

只读内置数据（`chat_contacts.json`、`bubble_themes.json`、`sticker_categories.json`、
`asset_index.json`、`chat_sticker_cfg.json`）不写进用户仓库，由静态数据包 + manifest 提供，
见 `webui/tools/build_static_data.py` 与 `tools/check_static_data.py`。

## 2. 版本号

| 版本 | 取值 | 说明 |
| --- | --- | --- |
| 项目 schema `version` | `1` | 与 `backend/project_store.py` 的 `CURRENT_PROJECT_VERSION` 对齐 |
| 会话联系人清单 `version` | `3` | 与后端 `CONVERSATION_CONTACTS_VERSION` 对齐；v3 新增 `pinned_ids`（置顶会话 id，始终为 `preview_ids` 子集，保序） |
| 静态数据包 `manifest_version` / `schema_version` | `1` / `1` | 由 `build_static_data.py` 生成 |
| 存储 `db_version` | `1` | IndexedDB 数据库版本；只允许通过第 4 节的迁移递增 |

离线实现必须把 `db_version` 记在 `meta` 仓库；打开数据库时先读 `db_version` 与声明版本比较。
声明的 `db_version` 高于本地已存值时，禁止直接读旧结构，必须先走迁移。

## 3. 导入 / 导出

1. 单项目导出 = 项目 JSON 原样（含 `version`），导出内容必须能被 `importProject` 重新读入。
2. 导入走适配层 `importProject`，内部按 `normalize_project` 同等语义校验：字段缺失补默认值，
   非法结构抛 `INVALID_PROJECT`，且**不得写入半截数据**（校验全部通过后才落库）。
3. 项目 `version` 不受支持时拒绝导入并给出明确错误，不做静默降级。
4. 全量备份（后续实现）导出为单个归档，含各仓库数据 + manifest（`db_version`、`schema_version`、
   导出时间、文件 hash 列表）。

## 4. 迁移与失败回滚

1. 迁移按 `db_version` 从小到大逐级执行，每一步在一个事务内完成；任一步失败则中止后续步骤。
2. 迁移前**自动备份**：把当前用户可写仓库导出为快照（或写入 `meta.last_migration` 指向的备份记录），
   备份失败则整体中止迁移，不进入改动。
3. 事务失败时依靠 IndexedDB 事务回滚保持旧数据可用；进程中断后重开，从 `db_version` 重新判断，
   允许重试同一步迁移。
4. 破坏性 schema 变更必须配套迁移与回滚方案，并与 D24 的 APK 版本回滚联动；
   回滚后老版本 APK 只能读取它自己支持的 `db_version`，因此不支持降级 `db_version` 的数据。
5. 迁移完成前不得删除旧结构数据；确认新结构可读后才清理。

## 5. 备份与恢复

1. 恢复前校验备份 manifest 的 `db_version`：高于当前应用支持值则拒绝，提示升级应用。
2. 恢复是整体替换：先写临时仓库，校验通过后原子替换，失败则保留原数据。
3. 缩略图等可重建缓存不进入备份，恢复后按需重建。

## 6. 访问边界

业务层只通过平台适配层的稳定接口读写存储，不直接使用 IndexedDB / OPFS / 文件系统 API（D28）。
新增仓库或新增字段属于契约变更，按 `adapter-contract.v1.md` 第 5 节处理。兼容新增可选仓库或
字段追加本文件末尾的兼容记录即可；破坏性修改必须升 `STORAGE_CONTRACT_VERSION` 并同步双端。

## 7. 兼容追加记录

| 日期 | 变更 | 支持端 | 兼容性说明 |
| --- | --- | --- | --- |
| 2026-10-15 | `sticker_favorites` 仓库 | web / static / android | B3-A2 批次 B；桌面落 `data/sticker_favorites.json`，安卓与离线端落 IndexedDB `meta` store 的 `sticker_favorites` 键 |

回滚方式：删除 `sticker_favorites` 数据并在后端移除 `/api/sticker-favorites` 即可；
旧版本不会读取该键，未知键按忽略处理，因此不影响既有项目、图片和会话数据。
