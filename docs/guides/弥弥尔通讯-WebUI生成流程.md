# MimirTalk WebUI 生成器工作流

## 目标

利用已解包的 MomoTalk UI、图片、结构数据和脚本清单，制作一个本地 WebUI 生成器：

- 编辑联系人、对话、选择支、静态贴纸、背景和状态。
- 在浏览器中实时预览接近游戏内 MomoTalk 的聊天界面。
- 导出静态 PNG 长图。
- 优先完成可用的手动编辑器，再考虑导入官方 MomoTalk 配置和剧情。

## 当前可行范围

可做：

- 复用现有背景、气泡、按钮、系统图标和聊天贴纸。
- 使用 `manifest.json`、`structure/`、`images/` 建立素材索引。
- 参考 `structure/widget_system_momotalk.json` 还原主要布局。
- 导出静态聊天截图和长图。
- 贴纸输入和输出只使用静态贴纸；动态贴纸分类不进入选择器、API 结果或 PNG 导出。

需要补充：

- 角色通用头像不在 `textureconfig/momotalk/` 中，需要额外提取通用头像资源。
  奥丁 `1029`、宁希达 `10066`、望舒 `10170` 已使用
  `story_character0917/comsingle` 的剧情头像补入项目目录。
- 官方对话文本和完整配置当前是 LuaJIT 字节码或配置表，不能直接当明文数据导入。

暂不做：

- 直接运行 Unity prefab 或 Unity UI 序列化结构。
- 在浏览器中完整复刻游戏运行时逻辑。

## 资源来源

当前解包根目录：

```text
extract/aethergazer_momotalk/
```

主要素材：

| 目录 | 用途 |
| --- | --- |
| `images/backgrounds/` | 聊天背景 |
| `images/momotalk_images/` | MomoTalk 专属图片、通讯插画和少量头像资源 |
| `images/chat_stickers/` | 聊天贴纸 |
| `images/icons/` | 按钮、系统图标 |
| `images/widgets/` | UI 控件图片 |
| `structure/` | UI 节点、RectTransform、组件和控件结构 |
| `scripts/` | MomoTalk 直连 LuaJIT 字节码与清单 |

项目内置补充头像：

```text
mimirtalk_webui/assets/avatars/character_itemshead/story_comsingle/sprite/
```

该目录会随 `build_asset_index.py` 一起扫描，来源不在运行时直接引用 `D:` 盘。

头像缺口：

| 资源目录 | 索引数量 | 说明 |
| --- | ---: | --- |
| `textureconfig/character/icon/` | 300 | 角色通用头像池 |
| `textureconfig/character/itemshead/` | 196 | 物品或角色头图池 |
| `textureconfig/backhouseui/rolehead/` | 104 | 后宅角色头像池 |
| `textureconfig/momotalk/` | 28 | MomoTalk 专属资源和少量头像 |

## 建议目录

生成器与解包结果分离，避免污染原始提取目录：

```text
mimirtalk_webui/
├── backend/
│   ├── app.py
│   ├── asset_index.py
│   ├── project_store.py
│   └── exporters/
├── frontend/
│   ├── index.html
│   ├── src/
│   └── assets/
├── data/
│   ├── projects/
│   └── asset_index.json
├── exports/
└── tools/
```

## 阶段 0：素材盘点与补充

1. 扫描 `extract/aethergazer_momotalk/images/`。
2. 生成 `asset_index.json`，记录路径、类型、尺寸、资源来源和是否 sprite。
3. 同一资源优先使用 `sprite`，不把 `texture2d` 作为重复项展示。
4. 额外提取通用角色头像目录，输出到独立目录，例如：
   `extract/aethergazer_momotalk_shared_heads/`。
5. 扫描项目内置补充头像目录 `mimirtalk_webui/assets/avatars/`。
6. 为头像建立 ID、名称和图片路径的映射；无法解析名称时保留资源 ID。

完成标准：

- WebUI 能加载背景、贴纸、系统图标和头像列表。
- 同一素材不会因为 sprite/texture2d 重复出现。

## 阶段 1：对话数据格式

定义可版本化的项目 JSON：

```json
{
  "version": 1,
  "title": "示例会话",
  "contact": {
    "name": "角色名",
    "avatar": "assets/avatar.png"
  },
  "messages": [
    {
      "type": "text",
      "side": "left",
      "text": "你好。",
      "delay": 600
    },
    {
      "type": "sticker",
      "side": "right",
      "asset": "stickers/10001.png"
    },
    {
      "type": "choice",
      "options": ["继续", "离开"]
    }
  ]
}
```

消息类型：

- `text`：文本气泡。
- `sticker`：聊天贴纸。
- `image`：用户上传的静态 PNG/JPG/JPEG 图片。
- `choice`：玩家选项。
- `system`：系统提示。
- `recall`：撤回消息。

完成标准：

- 项目 JSON 可保存、重新打开和向后兼容。
- 编辑器能识别并修改所有第一版消息类型。

## 阶段 2：后端服务

使用 Python 本地服务：

1. 扫描并索引解包素材。
2. 读取、保存和复制项目 JSON。
3. 提供素材缩略图和原图访问。
4. 调用前端导出流程生成静态 PNG。
5. 所有路径限制在项目和指定素材根目录内。

优先接口：

```text
GET  /api/assets
GET  /api/assets/{id}
GET  /api/projects
POST /api/projects
GET  /api/projects/{id}
PUT  /api/projects/{id}
```

完成标准：

- 前端不需要直接读取游戏安装目录。
- 素材扫描、项目保存和导出均有明确错误返回。

## 阶段 3：WebUI 编辑器

布局建议：

- 左侧：联系人列表和会话列表。
- 中间：手机比例聊天预览。
- 右侧：当前消息编辑面板。

第一版功能：

- 新增、删除、排序消息。
- 切换左侧、右侧消息。
- 输入文本、选择头像、插入静态贴纸。
- 切换背景和聊天标题。
- 调整消息延迟和已读状态。
- 实时预览。

完成标准：

- 能完成一段 20 到 50 条消息的对话编辑。
- 刷新页面后项目内容不丢失。
- 常用编辑操作不需要手动修改 JSON。

## 阶段 4：UI 还原

1. 先按 `structure/widget_system_momotalk.json` 提取主要区域尺寸和层级。
2. 使用解包图片手写 HTML/CSS 布局。
3. 固定手机预览比例，避免素材和文字导致布局跳动。
4. 对气泡、头像、贴纸和系统提示分别建立组件。
5. 不同分辨率下验证文本换行、长名字、长链接和超长消息。

完成标准：

- 主要视觉元素与游戏内 MomoTalk 风格接近。
- 文本、头像和贴纸不重叠、不溢出。
- 桌面和移动尺寸都能正常预览。

## 阶段 5：渲染与导出

1. 用固定视口渲染聊天内容。
2. 静态对话优先导出 PNG 长图。
3. 单张 PNG 以 20 条对话为上限，超过 20 条按消息边界自动分页。
4. 空消息不进入导出流程，改为在聊天界面正中心弹窗提示“输入不能为空”。
5. 缺失素材暂不做导出前校验，集中记录到“缺失素材待补清单”，最后统一补齐。
6. 只导出静态 PNG；不实现 GIF、WebM、MP4 或动态贴纸导出。

导出类型：

- PNG 长图。
- 多张 PNG 分页。

### 当前项目输入输出范围

项目只处理用户自己产生的内容：

- 输入：用户输入的文本、静态贴纸，以及从本地选择的 PNG/JPG/JPEG 静态图片。
- 输出：PNG 聊天长图，单张最多 20 条对话，超过后分页。

已移出项目实现范围的内容：

- `moment` 消息类型：不再作为项目消息类型，也没有编辑器、预览或 PNG 导出逻辑。
- 动态图片：GIF、动画 WebP 和其他非 PNG/JPG/JPEG 文件会被拒绝，不进入项目。
- 动态贴纸：不进入贴纸选择器、贴纸 API 结果或 PNG 导出；全量素材索引可保留帧文件，但 WebUI 不使用。
- 游戏内视频内容，以及 GIF、WebM、MP4 输出。
- `choice` 选项卡片：保留在项目 JSON 和编辑器里，但不进入 PNG 导出。
- `recall` 撤回提示：保留在项目 JSON 和编辑器里，但不进入 PNG 导出。

静态图片通过 `POST /api/uploads/images` 上传到 `mimirtalk_webui/data/uploads/`，
消息只保存文件 ID、文件名和宽高。后端不再提供 `/api/export/image` 和
`/api/export/video`，当前导出仍由前端生成 PNG。旧项目里的 `moment` 消息会在
加载时丢弃，`image` 消息则需要符合当前静态图片字段结构。

### 导出时的消息类型处理

本项目定位是聊天内容生成，不复现实时对话流程，所以导出规则如下：

| 消息类型 | 保留在项目 JSON | 进入 PNG 导出 |
| --- | --- | --- |
| `text` 文本 | 是 | 是 |
| `sticker` 表情包 | 是 | 是 |
| `image` 静态图片 | 是 | 是 |
| `system` 系统提示 | 是 | 是 |
| `choice` 选项卡片 | 是 | 否 |
| `recall` 撤回提示 | 是 | 否 |

`choice` 和 `recall` 只作为项目文件里的记录保留，导出长图时跳过；`system` 属于
输出内容，正常绘制。

### 表情包选择器分类约定

表情包选择器后续按官方分类做分页，分类来源优先使用 `ChatStickerCategoryCfg.lua`
和 `ChatStickerCfg.lua`。当前解析确认官方普通聊天表情有 31 个分类，分类表本身只
提供 `id` 和 `icon`，表情条目里的 `category` 用于建立表情到分类的映射。

选择器 UI 只展示分类图标/表情缩略图，不显示表情名称和表情 ID。分类名和素材 ID
仅作为内部数据、映射文件和调试信息使用。

完成标准：

- 同一项目重复导出结果稳定。
- 导出文件不包含编辑器按钮或调试界面。
- 导出中和导出失败都有可恢复状态。
- 单张 PNG 不超过 20 条对话，分页结果按顺序连续。

### 当前导出尺寸结论

现有导出布局固定宽度 956，头部 80，上下内边距各 24，消息间距 20，头像 76。
文本气泡单行高度 83.5，带发言人名字再加 30；静态贴纸最高约 231。

头像尺寸与游戏 UI 脚本的对应关系：

| 位置 | 游戏脚本尺寸 | 缩放后尺寸 | 当前 WebUI |
| --- | ---: | ---: | ---: |
| 聊天头部 `chat/info/top/Image` | 60 x 60 | 约 54 x 54 | 60px，与脚本原始尺寸一致 |
| 消息 `replyM/headNode` | 100 x 100 | 约 90 x 90 | 76px 导出头像，自定义导出布局尺寸 |
| 消息 `replyM/headNode/headItem` | 112 x 112 | 约 100.8 x 100.8 | 76px 导出头像，自定义导出布局尺寸 |

`MomotalkUI/panel` 在游戏脚本中带 `0.9` 缩放。WebUI 当前不是做完整 Unity
RectTransform 复刻，而是按 956px 的聊天导出宽度重新布局，因此消息头像没有直接
采用游戏脚本的 90/100.8px，而是使用 76px。浏览器预览和 PNG 导出都会让头像图片
铺满圆形框，并最后绘制头像框，避免框线被图片遮住。

聊天背景默认使用
`backgrounds:texturebg_momotalk_momotalk_04:Momotalk_04`，来源为：

```text
extract/aethergazer_momotalk/images/backgrounds/texturebg_momotalk_momotalk_04/sprite/Momotalk_04.png
```

背景只作用于 956px 宽的聊天区，不铺到左侧联系人栏或整机预览。预览和导出均按
`center / cover` 处理；如果项目显式选择了其他背景，则使用项目设置。

- 20 条单行文本（私聊）：整图约 2178，2 倍缩放后约 4356。
- 20 条单行文本（群聊，每条带名字）：整图约 2778，2 倍缩放后约 5556。
- 20 条三行文本（群聊）：整图约 4518，2 倍缩放后约 9036。
浏览器的单张画布上限按 30000 处理。20 条普通对话在 2 倍缩放下都能单张导出，
只有单条消息包含大段超长文本时才可能超出，需要在导出时降为 1 倍或提示缩短内容。

### 非法路径说明

原始工作流里的“非法路径”指项目 JSON 通过 `../` 之类的相对路径引用素材根目录
之外的文件。当前实现里素材一律走 `asset_index.json` 白名单和 `/api/assets/{id}`
接口，接口只解析索引里的 ID，不接受任意文件路径，因此这一项已经被白名单覆盖，
不需要在导出阶段单独校验。

## 阶段 6：官方内容导入

这一阶段独立于手动编辑器：

1. 对 LuaJIT 字节码做反汇编或反编译。
2. 解析 `ChatHeroCfg`、`ChatContentCfg`、`ChatMessageCfg` 和 `ChatMonoAvatarCfg`。
3. 把官方聊天转换为项目 JSON。
4. 保留原始配置 ID，便于回溯。

完成标准：

- 能稳定导出一段官方 MomoTalk 到 WebUI。
- 转换失败时保留原始 ID 和错误原因。

## 阶段 7：验证与打包

验证项：

- 素材索引数量与解包清单一致。
- 项目 JSON 可以保存、关闭、重开。
- PNG 导出尺寸、文件头和分页结果正确。
- 中文、英文、数字和表情符号换行正常。
- 不同视口下不发生文本截断或控件重叠。
- 启动、停止和重建素材索引有明确命令。

打包目标：

```text
启动本地服务 -> 浏览器打开 WebUI -> 编辑项目 -> 预览 -> 导出
```

## MVP 范围

第一版只做：

- 联系人信息。
- 文本气泡。
- 静态贴纸。
- 背景切换。
- 项目保存与重新打开。
- PNG 长图导出。

第二版增加：

- 通用头像资源提取和头像选择器。
- 选择支、撤回消息、系统提示。
- 官方对话导入。

第三版增加：

- 批量生成与模板。

## 缺失素材待补清单

导出阶段暂不校验缺失素材，以下问题集中记录，最后统一补齐。

1. 三个可会话角色缺正式头像：望舒（10170）、宁希达（10066）、奥丁（1029）。
2. 游戏配置里的 `TextureConfig/Character/MediumIcon/{id}` 没有单独导出，当前用
   `character_itemshead` 的 56x56 头像兜底，后续要确认是否需要原尺寸 MediumIcon。
3. 通用头像库仍有 225 条素材未解析出角色名，键位保留为数字 ID，后续按需补名。
4. 素材索引目前只覆盖 MomoTalk 相关解包目录，若后续用到其他 UI 或立绘资源需要
   重新扫描并扩类。
5. 望舒（10170）与变体 `101701` 不能混用，`101701` 属于基础 ID 1017。

## 风险与注意

- 游戏资源版权和字体授权需要按实际用途单独处理，公开分发前必须确认授权范围。
- UI 序列化结构不能直接等同于浏览器 DOM，需要人工映射或写转换器。
- 当前解包不含完整角色头像和官方明文对话，缺失内容要分阶段补齐。
