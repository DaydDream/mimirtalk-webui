# 平台适配层契约 v1

本文件是 WebUI（web / static 两条实现）与安卓端共同遵守的**唯一权威源**。
简单的消息分组检查示例位于 `examples/`，完整接口定义以本文件为准。

契约版本：`1`（`ADAPTER_CONTRACT_VERSION = 1`）。

## 1. 能力声明

适配层实例必须提供：

```js
createAdapter(options) -> adapter

adapter.capabilities() -> {
  offline: boolean,       // 不依赖本地服务也能跑完整编辑与导出
  server: boolean,        // 需要本地/远端 HTTP 服务
  indexed_db: boolean,    // 具备 IndexedDB 持久化
  opfs: boolean,          // 具备 OPFS（navigator.storage.getDirectory）
  native_share: boolean,  // 具备原生分享（D19 后不实现，恒为 false）
  native_filesystem: boolean // 具备原生文件系统落盘（安卓固定导出目录；桌面/离线为 false）
  streaming_export: boolean // 长图导出走低内存分片渲染（安卓 true；桌面/离线 false，见 D10/D11）
}
```

业务层只根据能力位决定走哪条分支，不直接读取平台实现细节（D28）。
能力位为 `false` 时必须由适配层显式降级并给出 `reason`，不允许静默失败。

当前实现的能力位：

| 能力位 | web（本地服务） | static（离线） |
| --- | --- | --- |
| `offline` | `false` | `true` |
| `server` | `true` | `false` |
| `indexed_db` | `false` | `true` |
| `opfs` | `false` | `false`（后续接 OPFS 时再开） |
| `native_share` | `false` | `false`（安卓端由原生桥接管） |
| `native_filesystem` | `false` | `false`（安卓端由原生桥接管） |
| `streaming_export` | `false` | `false`（安卓端为 `true`，走低内存分片渲染） |

## 2. 稳定接口

```js
adapter.listProjects() -> ProjectSummary[]
adapter.createProject({ id, title, contact_name }) -> Project
adapter.getProject(id) -> Project
adapter.saveProject(project) -> Project
adapter.deleteProject(id) -> { id, deleted: true }
adapter.importProject(jsonOrObject) -> Project
adapter.exportProject(id) -> string

adapter.listContacts() -> Contact[]
adapter.listConversationContacts() -> ConversationContactManifest
adapter.saveConversationContacts({ contact_ids?, preview_ids?, pinned_ids? }) -> ConversationContactManifest

adapter.createGroup({ name, member_ids }) -> Contact
adapter.updateGroup(id, { name, member_ids }) -> Contact
adapter.deleteGroup(id) -> { deleted: true }

adapter.uploadImage({ file_name, mime_type, bytes }) -> UploadedImage
adapter.getUpload(file_id) -> { bytes, content_type }
adapter.deleteUpload(file_id) -> { file_id, deleted: true }

adapter.resolveAssetUrl(asset_id, "file" | "thumbnail") -> string
adapter.nativeShare(payload) -> { supported: boolean, reason?: string }
adapter.saveExport(blob, { file_name, mime_type }) -> { saved: boolean, via?: string, uri?: string, file_name?: string, folder_label?: string, folder_uri?: string, cancelled?: boolean, reason?: string }

adapter.listStickerFavorites() -> StickerFavorite[]
adapter.saveStickerFavorites(records) -> StickerFavorite[]

adapter.listDiagnostics() -> DiagnosticReportSummary[]
adapter.writeDiagnostic(report) -> { written: boolean, id?: string, name?: string, bytes?: number, reason?: string }
adapter.clearDiagnostics() -> { cleared: boolean, count?: number }
adapter.exportDiagnostic(id) -> { saved: boolean, cancelled?: boolean, uri?: string, file_name?: string, reason?: string }

adapter.appVersion() -> Promise<{ versionName: string, versionCode: number }>
adapter.chooseExportFolder() -> { selected: boolean, cancelled?: boolean, folder_label?: string, folder_uri?: string, reason?: string }
adapter.exportFolderLabel() -> string
adapter.listExportImages() -> Promise<{ images: ExportImageSummary[], folder_label?: string, reason?: string }>
adapter.resolveExportImage(uri, { size: "thumbnail" | "full" }) -> Promise<{ url: string, width?: number, height?: number, reason?: string }>
adapter.releaseExportImage(url) -> void
adapter.chooseBugFolder() -> { selected: boolean, cancelled?: boolean, folder_label?: string, folder_uri?: string, reason?: string }
adapter.bugFolderLabel() -> string
adapter.retryDiagnosticSync() -> { synced: number, pending: number, reason?: string }
```

接口语义、字段名和返回结构一旦发布即为冻结：改名或改返回结构属于破坏性变更，
必须升契约版本并按第 5 节处理。

`saveExport` 为可选方法（2026-10-11 追加，向后兼容）：桌面 / 离线端降级为浏览器下载并返回
`via: "browser-download"`；安卓端写入应用固定目录 `Pictures/MimirTalk`，返回
`via: "native_fixed"`、目标 `uri`、`folder_label` 和稳定的兼容 `folder_uri`（D19，不做系统分享）。

安卓 10 及以上使用 MediaStore 写入 `Pictures/MimirTalk`，不申请广泛存储权限；Android 7～9
仅申请写入公共图片目录所需的 `WRITE_EXTERNAL_STORAGE`。长图导出不再让用户选择、更换或持久
授权文件夹。导出内容必须是有效 PNG：缺数据、非 PNG 或超过限制时分别返回稳定错误码，不得返回
成功；创建文件或写入失败时也不得返回成功，也不得把底层 `content://` / `file://` URI 或异常
字符串直接展示给用户。

`listStickerFavorites` / `saveStickerFavorites` 为 2026-10-15 兼容追加，B3-A2 批次 B 三端同步
落地。记录结构必须为：

```js
StickerFavorite = {
  asset_id: string,
  source: "builtin" | "upload",
  sort_order: number,
  created_at: string, // ISO 8601
  file_id?: string    // source 为 upload 时使用；本轮只要求 builtin
}
```

收藏去重以 `source + (asset_id 或 file_id)` 为逻辑键，保存时必须按 `sort_order` 稳定排序。
安卓端与离线端落在 IndexedDB `meta` store 的 `sticker_favorites` 键；桌面端走本地后端
`/api/sticker-favorites` 并写入 `data/sticker_favorites.json`。业务层不得直接读写上述存储。

诊断、版本和导出文件夹接口为 2026-10-15 兼容追加，B3-A2 批次 A 在安卓原生外壳实现；
web / static 端可以省略这些方法。调用方必须按方法是否存在进行能力探测，并在省略时显式显示
“当前端未启用”而非抛裸异常。`DiagnosticReportSummary` 至少包含 `{ id, name, at?, bytes? }`；
`writeDiagnostic(report)` 的输入至少包含 `{ kind, message, stack?, occurred_at?, view? }`，
不得写入聊天正文、图片内容或用户输入。

`chooseExportFolder` 仅为 2026-10-15 旧调用方保留兼容入口。安卓端不再弹文件夹选择器：调用后
释放旧画廊 URL 缓存，固定返回 `{ selected: true, folder_label: "Pictures/MimirTalk",
folder_uri: "mimirtalk://pictures/MimirTalk" }`，不返回 `cancelled`。`exportFolderLabel()`
固定返回 `Pictures/MimirTalk`，不得再显示“尚未选择文件夹”或“更换文件夹”。

`listExportImages` / `resolveExportImage` / `releaseExportImage` 为 2026-10-18 兼容追加
（`B3B-REQ-016`），仅安卓原生外壳必须实现；web / static 可省略，调用方必须按方法存在性探测。
图片目录只读取应用固定目录 `Pictures/MimirTalk` 中由本应用生成且可识别的 PNG，不得把无关
图片混入画廊。Android 10+ 经 MediaStore 枚举，Android 7～9 读取公共图片目录；只有旧系统
可能触发受限的 `WRITE_EXTERNAL_STORAGE` 权限请求。

```js
ExportImageSummary = {
  uri: string,
  name: string,
  created_at?: string, // ISO 8601；provider 无可靠创建时间时使用修改时间
  modified_at?: string,
  width?: number,
  height?: number,
  readable?: boolean
}
```

`listExportImages()` 返回固定导出目录内由本应用生成、且可识别的 PNG 导出。`reason` 使用稳定
降级原因（例如 `NATIVE_UNAVAILABLE`、`LIST_FAILED`、`UNREADABLE`），不得返回底层异常原文或
`content://` URI。目录为空时返回空 `images`，调用方显示空状态。

`resolveExportImage(uri, { size })` 只接受列表返回的 `uri`。`size: "thumbnail"` 用于固定比例网格，
解码时必须限制尺寸；`size: "full"` 只在用户打开大图时调用。返回的 `url` 必须是 WebView 可直接
显示的本地 URL，由适配层创建并缓存；不可读或过大的图片返回空 `url` 与稳定 `reason`，不得抛裸异常。
`releaseExportImage(url)` 释放单个 URL；适配层在兼容接口 `chooseExportFolder` 被调用、离开
导出总览或重新枚举前释放不再使用的缓存。

业务层不得直接解析 SAF tree / document URI，也不得在可见文本中输出 `content://` / `file://`；
列表返回的导出 URI 只作为不透明句柄交给 `resolveExportImage`。缩略图按需、有限并发懒加载；
全图关闭后及时释放，避免长图列表一次性占用大量内存。

`chooseBugFolder` / `bugFolderLabel` / `retryDiagnosticSync` 为 2026-10-18 兼容追加
（`B3B-REQ-007`），仅安卓原生外壳实现；web / static 可省略，调用方必须能力探测。
Bug 记录文件夹仍使用用户选择的 SAF 授权与独立存储键；长图导出固定目录不使用 SAF 授权，
两者不得复用同一存储键或互相迁移。
`writeDiagnostic(report)` 在文件夹未配置或授权不可用时可以返回 `pending_sync: true`；
报告仍必须优先完整写入应用私有目录，外部目录转存失败不得造成崩溃或阻塞提示。
`retryDiagnosticSync()` 按确定性文件名去重后补写，失败时返回 `pending` 与可选的稳定
`reason`，不得抛出裸异常或重复生成同一份报告。旧的 `listDiagnostics` / `clearDiagnostics` /
`exportDiagnostic` 仅为接口兼容保留，设置页不再提供报告浏览、清空或逐条导出入口。

## 3. 错误结构

所有失败都必须抛出或返回同一结构，不允许抛裸字符串、裸 `Error` 或不带 `code` 的对象：

```json
{
  "code": "PROJECT_NOT_FOUND",
  "message": "项目不存在",
  "detail": {}
}
```

约定错误码：

| 错误码 | 语义 |
| --- | --- |
| `PROJECT_NOT_FOUND` | 项目不存在 |
| `INVALID_PROJECT` | 项目数据不合法 |
| `INVALID_JSON` | 导入内容不是合法 JSON |
| `UPLOAD_NOT_FOUND` | 上传文件不存在 |
| `INVALID_IMAGE` | 图片内容与格式不符或为空 |
| `UNSUPPORTED_IMAGE` | 非 PNG/JPG/JPEG |
| `UPLOAD_TOO_LARGE` | 超过单图 8 MiB 上限 |
| `INVALID_GROUP` | 群成员不合法 |
| `GROUP_NOT_FOUND` | 群不存在 |
| `INVALID_REQUEST` | 请求参数不合法 |
| `INVALID_ASSET` | 素材地址参数非法 |
| `NETWORK_ERROR` | 网络层彻底失败（连接被重置、后端未响应等） |
| `NATIVE_UNAVAILABLE` | 原生插件或原生能力在当前外壳不可用 |
| `FOLDER_PERMISSION_REVOKED` | Bug 记录文件夹的持久读写授权已失效或无法保留（长图导出不再使用） |
| `EXPORT_WRITE_FAILED` | 导出文件创建、写入或清理失败 |

web 适配层把后端错误映射到上表：后端 `not_found` → `PROJECT_NOT_FOUND` / `UPLOAD_NOT_FOUND`，
`invalid_request` → `INVALID_PROJECT` / `INVALID_IMAGE`；无法识别的状态码回退为 `HTTP_<status>`。

## 4. 简单检查示例

在仓库根目录执行 `node examples/check_export_groups.cjs`。该示例只检查消息分组，不替代完整平台能力验证。

## 5. 版本与兼容规则

1. 破坏性变更必须升 `ADAPTER_CONTRACT_VERSION` 并写兼容说明（D28）。
2. 新增可选能力位、可选方法或可选返回字段属于向后兼容，不升主契约版本；必须在第 6 节
   登记追加日期、支持端、调用方和回滚方式。
3. 破坏性变更必须先改共享契约文件，再同步 web / static / 安卓三端实现与契约用例。
4. 业务层禁止依赖契约未声明的能力或错误码；发现缺口先补契约，再改实现。

## 6. 兼容追加记录

| 日期 | 变更 | 支持端 | 兼容性说明 |
| --- | --- | --- | --- |
| 2026-10-11 | `saveExport` | web / static / android | 可选方法；缺失时由适配层或外壳显式降级 |
| 2026-10-15 | `saveExport.folder_label` / `saveExport.folder_uri` | android | 可选返回字段；旧调用方忽略即可 |
| 2026-10-15 | `listDiagnostics` / `writeDiagnostic` / `clearDiagnostics` / `exportDiagnostic` | android | B3-A2 批次 A；web / static 可省略 |
| 2026-10-15 | `appVersion` / `chooseExportFolder` / `exportFolderLabel` | android | B3-A2 批次 A；web / static 可省略 |
| 2026-10-15 | `listStickerFavorites` / `saveStickerFavorites` | web / static / android | B3-A2 批次 B；三端必须实现后才能收口 |
| 2026-10-15 | `NATIVE_UNAVAILABLE` | android | 原生桥不可用时统一错误码；其它端不抛此码 |
| 2026-10-18 | `FOLDER_PERMISSION_REVOKED` / `EXPORT_WRITE_FAILED` | android | `saveExport` 失败语义兼容追加；调用方按稳定错误码显示短提示 |
| 2026-10-18 | `chooseBugFolder` / `bugFolderLabel` / `retryDiagnosticSync` | android | `B3B-REQ-007`；web / static 可省略，调用方按方法存在性探测 |
| 2026-10-18 | `listExportImages` / `resolveExportImage` / `releaseExportImage` | android | `B3B-REQ-016`；web / static 可省略，调用方按方法存在性探测并显示显式空状态 |
| 2026-10-23 | 长图导出固定为 `Pictures/MimirTalk` | android | 保留 `saveExport` / `chooseExportFolder` / `exportFolderLabel` 的字段结构；`via` 使用 `native_fixed`，旧 SAF 字段仅作显示兼容 |

回滚方式：本轮均为兼容追加，回滚时删除对应追加记录并让调用方恢复能力探测即可；
不得回滚为已发布实现依赖的未声明接口。
