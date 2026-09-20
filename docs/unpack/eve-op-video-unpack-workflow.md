# EVE 系列 OP 视频解包工作流

## 适用范围

- GE / RT：Unity 游戏，OP 是 `VideoClip`，媒体数据在 `resources.resource` 里，按偏移切片得到 `.mp4`。
- BE：BGI/Buriko 引擎，OP 已由 `hazuki-windows-amd64.exe` 解包为 `.mpg`，直接复制即可。

## 工具

- Python：`C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe`
- 依赖：`UnityPy`（已安装）
- 脚本：`tools/extract_videos.py`

## Unity 游戏（GE / RT）

### 1. 提取

脚本会扫描 Data 目录里的 `.assets`，读取 `VideoClip` 的 `m_ExternalResources` 偏移和大小，然后从 `resources.resource` 切片保存为 `.mp4`。

```powershell
& 'C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' tools\extract_videos.py "C:\Users\ori\Downloads\redf_0005\[231208][El Dia] EVE ghost enemies【全年齢向け】\EVE ghost enemies\EVE_GE_Data" "C:\Users\ori\OneDrive\文档\ChatGPT\eve\extract\op_videos\ge"

& 'C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' tools\extract_videos.py "C:\Users\ori\Downloads\EVE rebirth terror\EVE_RT_Data" "C:\Users\ori\OneDrive\文档\ChatGPT\eve\extract\op_videos\rt"
```

默认只提取名字含 `_OP` 的片段，避免把 `LOOP` 循环视频误当 OP 收进来。要导出全部 `VideoClip`，加 `--all`。

### 2. 各游戏提取到的 OP

GE 的 Unity 资源里同时打包了多部 OP：

| 文件 | 说明 |
|---|---|
| `EVE_GE_OP.mp4` | GE 本篇 OP |
| `EVE_RT_OP.mp4` | RT OP |
| `EVE_BE_OP.mp4` / `EVE_BE_OP_SS.mp4` | BE OP / 无字幕版 |
| `DESIRE_OP.mp4` / `DESIRE_OP_SS.mp4` / `DESIRE_OP_1280x720.mp4` | Desire OP 各版本 |

RT 提取到：

| 文件 | 说明 |
|---|---|
| `EVE_RT_OP.mp4` | RT 本篇 OP |
| `EVER_OP_1280x720.mp4` | 高清版 OP |

## BGI / Buriko（BE）

BE 的 OP 已解包在：

`EVE_burst_error_unpack\data02300`

相关 `.mpg` 文件：

- `op_demo.mpg`
- `eve r op.mpg`
- `eve_r_op.mpg`
- `eve_op_ss.mpg`

复制到统一输出目录即可：

```powershell
$out = "C:\Users\ori\OneDrive\文档\ChatGPT\eve\extract\op_videos\be"
New-Item -ItemType Directory -Force -Path $out | Out-Null
Copy-Item -LiteralPath "C:\Users\ori\OneDrive\文档\ChatGPT\eve\EVE_burst_error_unpack\data02300\op_demo.mpg" -Destination $out
Copy-Item -LiteralPath "C:\Users\ori\OneDrive\文档\ChatGPT\eve\EVE_burst_error_unpack\data02300\eve r op.mpg" -Destination $out
Copy-Item -LiteralPath "C:\Users\ori\OneDrive\文档\ChatGPT\eve\EVE_burst_error_unpack\data02300\eve_r_op.mpg" -Destination $out
Copy-Item -LiteralPath "C:\Users\ori\OneDrive\文档\ChatGPT\eve\EVE_burst_error_unpack\data02300\eve_op_ss.mpg" -Destination $out
```

## 最终输出

```text
extract/op_videos/
├── ge/  # GE 提取的 mp4
├── rt/  # RT 提取的 mp4
└── be/  # BE 复制的 mpg
```

## 验证

- `.mp4` 文件头应为 `ftyp`。
- `.mpg` 文件头应为 MPEG 序列头，常见为 `00 00 01 BA` / `00 00 01 B3`。
- 文件大小应和 `resources.resource` 里 `VideoClip` 的 `m_Size` 一致。
