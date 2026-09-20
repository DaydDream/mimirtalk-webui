# 深空之眼（AetherGazer）0917 解包任务简报

> 给后续接手的人/AI：只看这一份就能理解这次做了什么、东西在哪、脚本怎么用、
> 哪些坑已经踩过。更早的通用流程见 `docs/aethergazer-unpack-workflow.md`。

## 一句话结论

2026-09-17 完成深空之眼角色原画 / 剧情 CG / 剧情立绘 / 表情差分 / 聊天贴纸的解包，
成品共 16 个文件夹、5285 个文件、5.22 GB，已全部移到 `D:\大眼解包图片资源`。
2026-09-18 已把未归档的图形资源（UI、图标、图鉴、特效贴图，共 13622 个 PNG）
全部删除，工作区只保留 `.usm` 视频和解码工作流。剩下 299 个 `.usm`（4.82 GB）
待转 mp4，卡在 CRI 视频解密 key 上，明天继续。

## 任务目标

只要人物相关资源：角色原画、剧情 CG、剧情立绘、表情差分、聊天表情/emoji。
不要盲目扩大范围去导图标、UI、场景、模型。

## 关键路径

| 用途 | 路径 |
|---|---|
| 工作区根目录 | `C:\Users\ori\OneDrive\文档\ChatGPT\adv解包` |
| 游戏安装目录 | `C:\Program Files\AetherGazerLauncher\AetherGazer` |
| 游戏数据目录 | `C:\Program Files\AetherGazerLauncher\AetherGazer\AetherGazer_Data\StreamingAssets\Windows` |
| 资源索引 | 数据目录下的 `AssetHash_Info.bytes` |
| 成品库（最终归档） | `D:\大眼解包图片资源` |
| Python 运行时 | `C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe` |

## 最终产出（已归档到 D 盘）

全部平铺在 `D:\大眼解包图片资源` 下，没有保留父目录层级。

| 文件夹 | 文件数 | 大小 | 内容 |
|---|---|---|---|
| chapter_art0917 | 201 | 276.9 MB | 章节插画 |
| character_portrait0917 | 445 | 439.2 MB | 角色原画/立绘 |
| character_portrait_dlc0917 | 69 | 150.5 MB | 角色 DLC 原画 |
| chat_sticker0917 | 722 | 48.9 MB | 动态聊天贴纸原始帧 PNG |
| chat_sticker_gif0917 | 24 | 7.4 MB | 22 个 GIF + 清单 + 预览拼图 |
| chat_sticker_webp0917 | 24 | 9.2 MB | 22 个无损 WebP + 清单 + 浏览页 |
| illustrated_portrait0917 | 92 | 57.3 MB | 图鉴立绘 |
| story_background0917 | 1598 | 3638.5 MB | 剧情背景 |
| story_cg_large0917 | 77 | 235.1 MB | 剧情 CG 大图 |
| story_character0917 | 1096 | 55.2 MB | 剧情立绘 |
| story_expression0917 | 544 | 69.8 MB | 表情差分 |
| story_loading0917 | 61 | 167.3 MB | 加载图 |
| rolebattle0917 | 172 | 5.6 MB | 自走棋角色贴图（原深层嵌套） |
| portrait0917 | 137 | 182.5 MB | 武器使魔立绘（原深层嵌套） |
| letter_role_title0917 | 22 | 1.4 MB | emptydream 剧情标题图（原深层嵌套） |
| role0917 | 1 | 0.1 MB | emptydream 剧情立绘（原深层嵌套） |

后 4 个原本嵌在 `activity_assets/`、`character_weaponservant/`、`story_plot_cg/`
内部，按用户要求平铺，父目录没有跟着搬。

## 工作区现状

2026-09-18 最终清理后，`.usm`、`.ivf`、`.mp4`、`.vp9` 等解包视频媒体文件
已从 `extract\aethergazer` 删除，共 549 个文件、约 4.94 GiB。空目录、
`*_manifest.json`、提取脚本、CDPH 文本证据和视频工作流文档保留。

视频流程已单独保存到：

`docs/aethergazer-video-unpack-workflow.md`

**本次删除范围**：`extract\aethergazer` 下 32 个纯 PNG 目录（13622 个文件、4091 MB），
以及早期测试产物 `extract\aethergazer_smoke`、`extract\aethergazer_smoketest`、
`extract\ag_probe`。逐项清单见 `tools/delete_graphics_report.json`。
`aethergazer_smoke` 里 3 个 `.usm` 是 `story` 目录的同名副本，已确认主目录仍在。
图形资源所有删除均成功，无遗留。视频媒体随后按用户要求另行清理。

`D:\大眼解包图片资源` 的 16 个归档文件夹未动，与
`tools/move_0917_folders_report.json`（16 项全部 verified）一致。

## 工具清单

| 脚本 | 用途 |
|---|---|
| `tools/extract_aethergazer_images.py` | 主图片提取器，`--preset all/portraits/story-cg`，默认跳过已存在文件支持续跑，`--overwrite` 重建，`--include-naive` 带上备用资源 |
| `tools/extract_aethergazer_videos.py` | `.usm` 视频提取 |
| `tools/make_sticker_gifs.py` | 动态贴纸帧合成 GIF |
| `tools/make_sticker_webp.py` | 动态贴纸帧合成无损 WebP，并生成 `_gallery.html` 浏览页 |
| `tools/move_0917_folders.py` | 把带 0917 的文件夹搬到 D 盘，带文件数/字节数校验和重试删除；默认干跑，`--execute` 才真动 |
| `tools/move_0917_folders_report.json` | 上面这次移动的逐项校验报告（16 项，全部 verified） |
| `tools/scan_sticker_clips.py` / `inspect_sticker_clip.py` | 扫描 `dynamicsticker/*.ys` 里的 AnimationClip 时长 |
| `tools/inspect_facetimeline.py` | 检查 oath facetimeline emoji 资源内容 |

## 技术要点（复用必读）

**资源索引与加载**

- `AssetHash_Info.bytes` 是 JSON，`assetHashList` 每项为
  `虚拟路径|hash|大小`；实体文件在 `Windows\<hash[0]>\<hash[1]>\<hash>.ys`。
- `.ys` 是 Unity AssetBundle，部分文件在 `UnityFS` 签名前有附加字节，必须先
  `raw.find(b"UnityFS")` 再 `UnityPy.load`。
- `UnityPy.config.FALLBACK_UNITY_VERSION = "2022.3.62f3c1"`。
- 账号是否拥有角色**不影响**解包，资源都在 bundle 里，与账号解锁状态无关。

**动态聊天贴纸**

- 贴图帧在 `textureconfig/chat/chatsticker/*_00.png`，动画元数据在
  `dynamicsticker/<id>@zh_cn.ys`，里面只有 Animator / AnimationController /
  AnimationClip，没有逐帧 PPTR 曲线。
- 时长取 `AnimationClip.m_MuscleClip.m_StopTime`，按帧数均分；读不到就用 30 fps。
- GIF 合成：Pillow 用 mask 做透明，mask 必须是 `0/255`（写成 `0/1` 会被当成半透明
  混合，这是踩过的 bug）；GIF 延迟以 10 ms 为单位。
- **GIF 和 libwebp 的动画编码器都会把连续同像素帧合并成更长的帧**。想要严格 1:1
  帧数，必须自己封装 WebP 容器，不能用 Pillow 的 `save_all`。
- 自封装的 WebP 结构：`RIFF` + `VP8X`（flags `0x12` = animation+alpha，画布宽高减 1 各 3 字节）
  + `ANIM`（背景 BGRA 全 0，loop 0）+ 每帧 `ANMF`（x/2、y/2、宽高减 1、时长 3 字节、
  flags `0x03` = 不混合 + dispose to background），帧数据用单帧无损编码出来的 `VP8L` chunk，
  每个 chunk 补偶数对齐。这样 22 组全部帧数、总时长、可见像素与源图完全一致。
- Windows 资源管理器/照片应用对动画 WebP 支持有限，通常只显示第一帧，这不是文件坏了。
  要动起来就开 `chat_sticker_webp0917\_gallery.html`（浏览器原生支持）。

**emoji 类资源**

`comchar/oath/facetimeline/`、`comchar/t0world/facetimeline/` 下的 `*emoji*.ys`
是 Timeline 动画数据，里面没有 Texture2D/Sprite，拿不到独立 emoji 贴图；
表情是运行时用角色脸部贴图合成的。动态聊天贴纸走的是 `textureconfig/chat/chatsticker`。

**跨盘移动的坑**

`shutil.move` 跨盘 = 先复制再 `rmtree`。这次 `chapter_art0917` 复制成功、源文件也删了，
但删最后两个空目录时被 OneDrive 锁住报 `PermissionError`，导致后面的文件夹没走到。
`move_0917_folders.py` 已改成可续跑：复制后校验文件数和字节数，再用带重试和清除
只读属性的 `force_remove` 删源，目标已存在且源已空时只做收尾清理。

## 未做 / 后续可选

- **299 个 `.usm` 视频未转 mp4，卡在解密 key**（见下方“USM 视频解密进展”）。
- **原 `.usm` 媒体已按用户要求删除**；后续如需继续，先用视频工作流文档中的命令
  从游戏安装目录重新提取。
- 工作区里剩余的图鉴、剧情 CG、特效贴图已于 2026-09-18 删除，用户确认不需要。
- `character_portrait_half` 只剩 2 张（`1066.png`、`1166.png`），不是遗漏就是源里只有这些。

## USM 视频解密进展（2026-09-18 暂停点）

### 目标

把 `story`（64 个）、`activity`（52 个）两个目录的 `.usm` 转成可看的 mp4。
`function`（183 个）暂不处理。

### 已经打通的

- USM 容器解析可用：`tools/extract_aethergazer_videos.py` +
  `tools/bin/wannacri_py/wannacri/usm`。
- **坑**：WannaCRI 读本游戏样本必须传 `encoding="gbk"`，默认 UTF-8 会报错。
- 样本 `1076_skin02_activity_loop.usm`：`2340x1080`、60 fps、240 帧、约 4 秒、
  1 路视频、无音频。
- 流类型：`@SFV` = VP9 视频，`@SFA` = HCA 音频。
- IVF/VP9 头部和帧数解析正确，`ffprobe` 能读到正确元数据。

### 阻塞点

- 每个视频帧 `0x40` 字节之后的载荷被 CRI 视频加密，`ffmpeg` 实际解码失败。
  容器没问题，缺的是解密 key。
- 已试常见 key 全部失败：`0x5E5CE3`、`0`、`0xFFFFFFFF`、`0x7F1E4C`、
  `0x12345678`、`0x9E5CE3`。
- `generate_keys(key_num)` 会生成 `0x40` 字节视频 key + `0x20` 字节音频 key；
  `decrypt_video_packet()` 保留前 `0x40` 字节不加密。
- 需要继续静态/动态分析 IL2CPP 调用链拿 Mana 视频 key。相关文件：
  - `C:\Program Files\AetherGazerLauncher\AetherGazer\GameAssembly.dll`
  - `...\AetherGazer_Data\il2cpp_data\Metadata\global-metadata.dat`
  - `...\Plugins\x86_64\cri_mana_vpx.dll`（导出很少，主要 `criVvp9_GetInterface` 等）
  - `...\Plugins\x86_64\cri_ware_unity.dll`

### 明天的验证标准

找到候选 key 后，必须**完整解码 240 帧且无坏帧**才算通过，不能只看 `ffprobe` 元数据。
key 正确后再处理 `@SFA` HCA 音频并合并，最后批量转 `story` + `activity` 的 mp4。

### 关于“实时演算”

`.usm` 本身是预渲染视频，不是实时演算。缺失的部分剧情 CG 疑似是游戏
Runtime/Timeline 实时演出资源，无法直接解包成 mp4；这类只能用游戏内录屏。

### 补充说明

如果最终拿不到 key，备选方案是游戏内录屏。`function` 目录里的 `.usm` 同理，
需要时再单独处理。
