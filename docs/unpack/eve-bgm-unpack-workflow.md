# EVE 系列 BGM 解包工作流

## 适用范围

GE / RT 都是 Unity，可用同一套 Unity AudioClip 路线；BE 属 BGI/Buriko 引擎，需单独用 `hazuki` 解包，不能走 UnityPy。

## 工具

| 用途 | 路径 / 命令 |
|---|---|
| Python | `C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe` |
| Unity 依赖 | `UnityPy`（已安装） |
| BGI ARC / 音频 | `C:\Users\ori\OneDrive\文档\ChatGPT\eve\hazuki-windows-amd64.exe` |
| 音频扫描脚本 | `C:\Users\ori\OneDrive\文档\ChatGPT\eve\tools\scan_audio.py` |
| 音频提取脚本 | `C:\Users\ori\OneDrive\文档\ChatGPT\eve\tools\extract_audio.py` |
| BE BGM 使用映射脚本 | `C:\Users\ori\OneDrive\文档\ChatGPT\eve\tools\map_be_bgm.py` |

## RT BGM 提取

游戏 Data 目录：

`C:\Users\ori\Downloads\EVE rebirth terror\EVE_RT_Data`

先扫描 Unity `AudioClip`，生成报告：

```powershell
& 'C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' tools\scan_audio.py "C:\Users\ori\Downloads\EVE rebirth terror\EVE_RT_Data" "C:\Users\ori\OneDrive\文档\ChatGPT\eve\extract\rt_audio_scan.json"
```

再提取 RT BGM：

```powershell
& 'C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' tools\extract_audio.py "C:\Users\ori\Downloads\EVE rebirth terror\EVE_RT_Data" "C:\Users\ori\OneDrive\文档\ChatGPT\eve\extract\bgm\rt" --prefix EVE_
```

输出目录：

`C:\Users\ori\OneDrive\文档\ChatGPT\eve\extract\bgm\rt`

RT 的 Unity 资源里共有 34 个 `EVE_*` AudioClip，输出为 `EVE_00.wav` 到 `EVE_43.wav`。不是从 `00` 到 `43` 连续，缺号说明原资源里就没有这些 AudioClip：

实际导出编号：`00, 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21, 24, 26, 27, 28, 29, 30, 32, 38, 39, 40, 41, 42, 43`

## GE BGM 提取

游戏 Data 目录（原版完整版，不是机翻补丁目录）：

`C:\Users\ori\Downloads\redf_0005\[231208][El Dia] EVE ghost enemies【全年齢向け】\EVE ghost enemies\EVE_GE_Data`

扫描 Unity `AudioClip`：

```powershell
& 'C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' tools\scan_audio.py "C:\Users\ori\Downloads\redf_0005\[231208][El Dia] EVE ghost enemies【全年齢向け】\EVE ghost enemies\EVE_GE_Data" "C:\Users\ori\OneDrive\文档\ChatGPT\eve\extract\ge_audio_scan.json"
```

扫描结果：

`C:\Users\ori\OneDrive\文档\ChatGPT\eve\extract\ge_audio_scan.json`

GE 的 Unity 资源里 AudioClip 总数约 16871，其中绝大多数是 `Vo_*` 语音；BGM 候选按 `EVE_` 前缀过滤。

提取 GE BGM：

```powershell
& 'C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' tools\extract_audio.py "C:\Users\ori\Downloads\redf_0005\[231208][El Dia] EVE ghost enemies【全年齢向け】\EVE ghost enemies\EVE_GE_Data" "C:\Users\ori\OneDrive\文档\ChatGPT\eve\extract\bgm\ge" --prefix EVE_
```

输出目录：

`C:\Users\ori\OneDrive\文档\ChatGPT\eve\extract\bgm\ge`

GE 实测导出 66 个 WAV：

- `EVE_01.wav` 到 `EVE_59.wav`：59 个，编号连续。
- `EVE_R_*.wav`：7 个，分别为 `EVE_R_10`、`EVE_R_14`、`EVE_R_15`、`EVE_R_16`、`EVE_R_20`、`EVE_R_39`、`EVE_R_42`。

资源文件里同样只有 AudioClip 内部编号，没有 GE BGM 的官方曲名文本映射；网上也暂时没搜到完整公开的 GE OST 可用来直接自动配歌名。

## 为什么只有序号，没有曲名

Unity 文件数据库里 AudioClip 是有名字的，但 `m_Name` 就是内部编号 `EVE_00`、`EVE_01` 这种，不是音乐标题。RT 扫描报告可确认：

`C:\Users\ori\OneDrive\文档\ChatGPT\eve\extract\rt_audio_scan.json`

具体表现：

- `m_Name`：`EVE_xx`
- `m_OriginalPath`：没有曲名字段
- 音频数据源：`resources.resource`
- TextAsset 扫描没有发现 RT 的 BGM 曲名/曲目列表资源，绝大多数 TextAsset 是 `Vo_*` 语音剧本

结论：游戏资源本身没有可供自动映射的官方曲名，光靠解包无法把 `EVE_xx` 变成歌名。

## 曲名确认建议

要补上曲名，只能从游戏外部对照：

1. 人工听 34 个 `EVE_xx.wav` 后填曲名。
2. 若有官方数字原声带 / Amazon 特典 OST，可用文件名、音频时长、听感做配对。
3. 提取出的时长和大小可作为辅助对照，但官网目前没有公开的 RT 完整曲目顺序可可靠对应这些内部编号。

## BE BGM 提取（BGI / Buriko）

### 1. 找到主音频包

BE 游戏目录：

`C:\El Dia\EVE burst error A`

主要 BGM 包是 `data05020.arc`（约 212 MB）。解包后文件全部是 `eve_*`：

```powershell
& 'C:\Users\ori\OneDrive\文档\ChatGPT\eve\hazuki-windows-amd64.exe' unpack 'C:\El Dia\EVE burst error A\data05020.arc' -o 'C:\Users\ori\OneDrive\文档\ChatGPT\eve\extract\be_data05020'
```

Hazuki 会自动把 BGI 音频转成 `.ogg`，并保留一个同名的无扩展名原始文件。

### 2. 整理到统一 BGM 目录

只复制 `.ogg`，不复制原始容器文件：

```powershell
$out = 'C:\Users\ori\OneDrive\文档\ChatGPT\eve\extract\bgm\be'
New-Item -ItemType Directory -Force -Path $out | Out-Null
Get-ChildItem 'C:\Users\ori\OneDrive\文档\ChatGPT\eve\extract\be_data05020\data05020' -File -Filter '*.ogg' | Copy-Item -Destination $out
```

输出目录：

`C:\Users\ori\OneDrive\文档\ChatGPT\eve\extract\bgm\be`

BE 主 BGM 包实测：

| 项目 | 值 |
|---|---|
| 来源 | `data05020.arc` |
| OGG 总数 | 182 |
| 总大小 | 约 212 MB |
| 内部名 | `eve_01_1_a.ogg` 到 `eve_45_2_b.ogg` 这类编号 |
| 根编号 | `eve_01` 到 `eve_45`，另有 `19a / 19b / 22 / 29 / 37` 这类分轨后缀 |

同一个根编号通常有多个文件，命名里的 `1/2`、`a/b` 是变体或分段，不是曲名字段。

### 3. 从脚本反查 BGM 使用场景

剧情脚本解包在 `EVE_burst_error_unpack\data01000` 到 `data01300`。脚本里的模式是：

```text
[ENTRY]
src=eve_xx

[ENTRY]
src=bgmPlay
```

用映射脚本扫一遍，生成 JSON 和 Markdown 对照表：

```powershell
$env:PYTHONIOENCODING='utf-8'
& 'C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' tools\map_be_bgm.py EVE_burst_error_unpack extract\bgm\be\bgm_id_map.json extract\bgm\be\bgm_id_map.md
```

产物：

`extract\bgm\be\bgm_id_map.json`

`extract\bgm\be\bgm_id_map.md`

本轮从脚本里直接紧邻 `bgmPlay` 的写法抓到 32 个根编号；其余 OGG 可能用在当前未纳入脚本或另类调用里，属于资源包中存在但脚本直连统计没覆盖的曲目。

### 4. 关于 `eve_50` 到 `eve_62`

`EVE_burst_error_unpack\data03030` 里有 `eve_50` 到 `eve_62` 以及大量 `se*` / `j*` / `m*`。从当前解包出的剧情脚本看，这些编号大多和 `sePlay` 或台词/效果提示一起出现，不是 `bgmPlay` 的直接资源，所以本轮没有把它们并进 BE BGM 主输出。若你只是想把所有 `eve_*` 音频都提出来，可以另外复制：

`EVE_burst_error_unpack\data03030\eve_*.ogg`

### 5. BE 有没有曲名

绝大多数 BE BGM 解包得到的内部名只有 `eve_xx`，没有日文曲名；搜索已解包文本没有发现 BGM 曲名数据库或曲名映射文本。`setupforgallery.hazuki.txt` 里只有画廊 CG/演出相关字段，不包含音乐资料表。

不过 BE 的音乐 UI 曲名表不是脚本文本，而是 `sysgrp.arc` 内的 DSC 图片资源。解包后已复制到项目目录：

- `extract\music_ui_screenshots\be_music_ui_SGMusic010000.png`

这张 `SGMusic010000` 图上直接印有音乐播放器/资料画面里的 BGM 名与序号对应关系，可作为人工确认曲名的来源。原文件在：

`extract\be_sysgrp\sysgrp\SGMusic010000`

这类 DSC 解压后是图片，`hazuki text extract` 不会得到曲名文本；里面还有同族的 `SGMusic000000`、`SGMusic000100`、`SGMusic990000`，分别为背景/小图/画面尺寸等 UI 素材。用户提到的 `original style` / `nostalgic style` 切换目前还没有在这些资源里找到直接文本字段，仍待继续对照 UI 图层确认。

但检查 `.ogg` 的 Vorbis 注释后发现有 2 个例外，`eve_29_b.ogg` 和 `eve_37_b.ogg` 自带官方 OST 标签。原文未加壳的 BGI 资源里也有同样字段，说明不是 `hazuki` 转码时加的，而是 `data05020.arc` 里原始音频就带这些注释：

| OGG 文件 | Vorbis 注释 |
|---|---|
| `eve_29_b.ogg` | `Title=デイリー・オープニング`，`Artist=サウンドトラック`，`Album=EVE burst error ORIGINAL SOUNDTRACK`，`TRACKNUMBER=2` |
| `eve_37_b.ogg` | `Title=エンディング-3`，`Artist=サウンドトラック`，`Album=EVE burst error ORIGINAL SOUNDTRACK`，`TRACKNUMBER=29` |

这两个文件像是直接用了官方 OST 音频/压制源，所以保留了唱片集和曲目号；其余 180 个 OGG 都没有这套注释。

结论：BE 大部分 BGM 只能按编号提取，但至少 `eve_29_b` / `eve_37_b` 这两首能从文件元数据直接得到曲名；UI 里还有一张 `SGMusic010000` 图片承载完整曲名列表，目前没有可直接自动读取的文本/数据库字段。
