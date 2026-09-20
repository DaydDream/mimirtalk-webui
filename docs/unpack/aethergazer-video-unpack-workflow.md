# AetherGazer CRI USM 视频解包工作流

## 当前状态

2026-09-18 暂停。USM 容器和视频流元数据可以解析，但从 CDPH / HybridCLR
路径没有取得有明确设置或调用证据的 32 位 CRI 视频 key，因此停止继续分析。
按约定不使用类名、hash、普通字符串或猜测值作为 key，也不继续批量转 MP4。

项目中的解包视频媒体文件已清理。需要继续时，可以从游戏安装目录重新提取
`.usm`；脚本、manifest、CDPH 分析文本和证据都保留在本项目中。

## 适用范围

- 游戏：AetherGazer / 深空之眼
- 游戏目录：`C:\Program Files\AetherGazerLauncher\AetherGazer`
- 数据目录：`...\AetherGazer_Data\StreamingAssets\Windows`
- 媒体容器：CRI USM，内部视频流为 VP9 `@SFV`，音频流为 HCA `@SFA`
- 目标输出：VP9 视频转可播放 MP4；有音频时再提取 HCA 并合并

## 关键路径

| 用途 | 路径 |
|---|---|
| 工作区根目录 | `C:\Users\ori\OneDrive\文档\ChatGPT\adv解包` |
| 资源索引 | 数据目录下的 `AssetHash_Info.bytes` |
| 视频提取脚本 | `tools/extract_aethergazer_videos.py` |
| 单样本 key 验证脚本 | `tools/probe_aethergazer_usm_key.py` |
| WannaCRI 本地依赖 | `tools/bin/wannacri_py` |
| FFmpeg | `tools/bin/ffmpeg/ffmpeg-master-latest-win64-gpl-shared/bin/ffmpeg.exe` |
| 视频 manifest | `extract/aethergazer/*_video_manifest.json` |

## 第一步：从 Unity 资源索引提取 USM

`AssetHash_Info.bytes` 的 `assetHashList` 每项格式为：

```text
虚拟路径|hash|文件大小
```

对应 Bundle 位置：

```text
Windows\<hash[0]>\<hash[1]>\<hash>.ys
```

脚本从 `.ys` 中查找 `CRID` 签名，并把签名开始到文件末尾的 CRI USM 数据
原样写出。常用预设：

- `story`：`SofdecAsset/story/`
- `activity`：`SofdecAsset/activity/`
- `function`：`SofdecAsset/function/`
- `all`：`SofdecAsset/`

提取命令示例：

```powershell
C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe `
  tools\extract_aethergazer_videos.py `
  --preset story `
  --out-dir extract\aethergazer

C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe `
  tools\extract_aethergazer_videos.py `
  --preset activity `
  --out-dir extract\aethergazer
```

脚本默认跳过已存在文件，支持断点续跑；需要重建时增加 `--overwrite`。
默认 manifest 写到 `out_dir\<preset>_video_manifest.json`。

## 第二步：解析 USM 和验证 key

WannaCRI 读取本项目样本时必须使用：

```text
encoding = "gbk"
```

默认 UTF-8 会报错。样本 `1076_skin02_activity_loop.usm` 的已知元数据：

- 分辨率：`2340x1080`
- 帧率：`60 fps`
- 总帧数：`240`
- 视频流：VP9 `@SFV`
- 音频流：无

单样本验证命令：

```powershell
C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe `
  tools\probe_aethergazer_usm_key.py `
  <sample.usm> `
  --key <32-bit-key> `
  --out <new-output-directory>
```

脚本会：

1. 用 `wannacri.usm.Usm.open(..., encoding="gbk", key=...)` 打开 USM。
2. 从 `@SFV` 流提取 VP9 包并写成 IVF。
3. 读取宽高、帧率和预期帧数。
4. 用 FFmpeg 完整解码 IVF，默认 `-xerror`。
5. 写 `report.json`，只有返回码为 0 且写出帧数等于预期帧数才视为通过。

## key 判定标准

候选 key 必须同时满足：

- 是 32 位整数。
- 在 CDPH / HybridCLR / CRI 调用链中有明确的设置或调用证据。
- 用于样本后可以完整解码全部 240 帧且无坏帧。

以下条件不算有效证据：

- 只出现在 hash、类名、普通字符串或日志里。
- 只让 `ffprobe` 读出元数据。
- 只解出部分帧或画面仍损坏。

已排除的盲试值：

```text
0x5E5CE3
0
0xFFFFFFFF
0x007F1E4C
0x12345678
0x009E5CE3
0x784C4141
0x784C41D1
```

## CDPH / HybridCLR 暂停点

已确认 CDPH 转换器可复现：

- 初始状态：`a975d17195c162fe5c386c4838c6767f`
- 最终状态：`Hello, HybridCLR`
- 指令数：`2406`
- 核心转换：`0x1806E11F0`
- 流包装：`0x1804FF5D0`

尚未确认真正处理 BSJB `#~ / #Strings / #US / #Blob` 的元数据解密路径，也没有
取得有设置证据的 32 位视频 key。详细材料在：

```text
extract/aethergazer/_usm_probe/cdph_transform_solution.json
extract/aethergazer/_usm_probe/cdph_meta_paths/
```

## 最终 MP4 流程

只有 key 验证通过后才执行：

1. 用正确 key 提取 `@SFV` 的 VP9 包并写 IVF 或直接封装 MP4。
2. 若存在 `@SFA`，提取并解码 HCA。
3. 用 FFmpeg 合并视频和音频。
4. 抽查首帧、中间帧和末帧，确认无坏帧、无偏移。
5. 对 `story` 和 `activity` 批量转换；`function` 未纳入本次范围。

如果最终没有明确 key，备选方案是游戏内录屏。
