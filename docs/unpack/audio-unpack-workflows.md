# 音频解包工作流汇总

## 解包固定流程

遇到任何游戏数据解包需求，先按下面顺序走：

1. 确定需要的数据对应的数据包 / 数据目录：先确认目标资源（CG、BGM、OP、剧本等）大概率在哪个包或哪个目录，不要漫无目的地全盘乱扫。
2. 确定数据包类型：看文件头、扩展名和引擎特征，判断是 Unity `.assets` / `resources.resource`、BGI/Buriko ARC、CRI CPK/HCA、普通图片/音频容器，还是别的封装。
3. 查找社区内已有的对应解包工具：优先搜索和复用现成工具或脚本，例如 AssetRipper/UnityPy、hazuki、vgmstream、QuickBMS、对应 CRI 工具等。
4. 有现成工具就直接解包。
5. 没有现成工具就先停下来，明确告诉用户“暂未找到可用工具”和当前卡点，不自行从零硬写解码器或格式逆向流程，除非用户明确要求继续研究。

如果后续新增某种格式的解包路线，也按这套判断流程补充到本文档对应章节。

> 本文档用于以后直接按“引擎/封装形式”查找音频解包命令。默认使用 PowerShell，相对路径默认以 `C:\Users\ori\OneDrive\文档\ChatGPT\adv解包` 为当前目录。

## 先判断音频所在形式

| 遇到的情况 | 对应引擎/封装 | 处理方式 |
|---|---|---|
| Unity 游戏 `_Data` 目录含 `.assets` / `resources.resource` | Unity AudioClip | 用 UnityPy 脚本扫描/提取，输出 WAV |
| `BURIKO ARC20` / BGI 引擎游戏 | BGI/Buriko | 用 `hazuki` 解包，自动转 OGG |
| CRIWARE CPK 内是 `.hca` | CRI CPK / HCA | 从 CPK 抽 HCA，再用 vgmstream 转 WAV |

---

## 1. Unity AudioClip：GE / RT

适用：`EVE Ghost Enemies`、`EVE Rebirth Terror` 这类 Unity 游戏。

### 工具

| 用途 | 路径 |
|---|---|
| 固定 Python | `C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe` |
| 扫描 AudioClip | `tools\scan_audio.py` |
| 提取 AudioClip | `tools\extract_audio.py` |

### 流程

```powershell
$py = 'C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'

# 1. 扫描 Unity Data 目录，生成报告
& $py tools\scan_audio.py "C:\Users\ori\Downloads\EVE rebirth terror\EVE_RT_Data" "C:\Users\ori\OneDrive\文档\ChatGPT\adv解包\extract\rt_audio_scan.json"
& $py tools\scan_audio.py "C:\Users\ori\Downloads\redf_0005\[231208][El Dia] EVE ghost enemies【全年齢向け】\EVE ghost enemies\EVE_GE_Data" "C:\Users\ori\OneDrive\文档\ChatGPT\adv解包\extract\ge_audio_scan.json"

# 2. 提取 BGM，按 AudioClip 名前缀过滤
& $py tools\extract_audio.py "C:\Users\ori\Downloads\EVE rebirth terror\EVE_RT_Data" "C:\Users\ori\OneDrive\文档\ChatGPT\adv解包\extract\bgm\rt" --prefix EVE_
& $py tools\extract_audio.py "C:\Users\ori\Downloads\redf_0005\[231208][El Dia] EVE ghost enemies【全年齢向け】\EVE ghost enemies\EVE_GE_Data" "C:\Users\ori\OneDrive\文档\ChatGPT\adv解包\extract\bgm\ge" --prefix EVE_
```

### 实测结果

| 游戏 | 输出目录 | 数量 | 命名 |
|---|---|---|---|
| RT | `extract\bgm\rt` | 34 个 WAV | `EVE_00.wav` 等内部编号 |
| GE | `extract\bgm\ge` | 66 个 WAV | `EVE_01.wav` 等，另有 `EVE_R_*.wav` |

注意：Unity 文件里 AudioClip 的 `m_Name` 只是内部编号，不是曲名。资源里暂时没找到对应 BGM 标题的数据库字段。

---

## 2. BGI / Buriko：BE

适用：`EVE Burst Error`。

### 工具

```text
C:\Users\ori\OneDrive\文档\ChatGPT\adv解包\tools\bin\hazuki-windows-amd64.exe
```

### 流程

```powershell
$hazuki = 'C:\Users\ori\OneDrive\文档\ChatGPT\adv解包\tools\bin\hazuki-windows-amd64.exe'

# 解 BGI/Buriko ARC
& $hazuki unpack "C:\El Dia\EVE burst error A\data05020.arc" -o "C:\Users\ori\OneDrive\文档\ChatGPT\adv解包\extract\be_data05020" --decode-cp 932 --encode-cp 932

# 只收集转好的 OGG
$out = "C:\Users\ori\OneDrive\文档\ChatGPT\adv解包\extract\bgm\be"
New-Item -ItemType Directory -Force -Path $out | Out-Null
Get-ChildItem "C:\Users\ori\OneDrive\文档\ChatGPT\adv解包\extract\be_data05020\data05020" -File -Filter '*.ogg' | Copy-Item -Destination $out
```

### 实测结果

- 输出目录：`extract\bgm\be`
- 182 个 OGG
- 命名：`eve_01_1_a.ogg` 这类编号
- 大部分没有曲名元数据；例外：`eve_29_b.ogg`、`eve_37_b.ogg` 带官方 OST Vorbis 注释，可拿到 `Title` / `Album`。

若要从脚本反查 BGM 使用场景，可跑：

```powershell
$env:PYTHONIOENCODING='utf-8'
& 'C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' tools\map_be_bgm.py ..\eve\EVE_burst_error_unpack extract\bgm\be\bgm_id_map.json extract\bgm\be\bgm_id_map.md
```

UI 曲名表解包后不是文本，而是 DSC 转成的图片，例如：

```text
extract\music_ui_screenshots\be_music_ui_SGMusic010000.png
```

---

## 3. CRI CPK / HCA：MO2

适用：包内是 `.hca` 的 CRIWARE CPK 音频包。实测来源是 Memories Off 2：

```text
C:\Program Files (x86)\Steam\steamapps\common\memo02\data\bgm.cpk
```

### 工具

```text
C:\Users\ori\OneDrive\文档\ChatGPT\adv解包\tools\bin\vgmstream-cli.exe
```

### 第一步：从 CPK 抽出 `.hca`

这个 CPK 里的条目是不压缩 HCA。注意：不要直接照抄 `content_offset + FileOffset`，本次实测直接这么取会错位；更可靠的做法是扫 `HCA\0` 魔数，并按 TOC 顺序 / `FileSize` 切片。

可先列出条目：

```powershell
& 'C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' tools\cpk_extract.py --list "C:\Program Files (x86)\Steam\steamapps\common\memo02\data\bgm.cpk"
```

然后参考下面思路抽 HCA：

```python
from pathlib import Path
import sys
sys.path.insert(0, r"C:\Users\ori\OneDrive\文档\ChatGPT\adv解包\tools")
import cpk_extract

src = Path(r"C:\Program Files (x86)\Steam\steamapps\common\memo02\data\bgm.cpk")
out = Path(r"C:\Users\ori\OneDrive\文档\ChatGPT\adv解包\extract\mo2_hca")
out.mkdir(parents=True, exist_ok=True)

header = cpk_extract._cpk_header_row(src)
rows = cpk_extract._toc_rows(src, header)
data = src.read_bytes()

starts = []
pos = 0
while True:
    i = data.find(b"HCA\x00", pos)
    if i < 0:
        break
    starts.append(i)
    pos = i + 1

assert len(starts) == len(rows), (len(starts), len(rows))
for row, start in zip(rows, starts):
    name = str(row["FileName"])
    size = int(row["FileSize"])
    payload = data[start:start + size]
    assert payload[:4] == b"HCA\x00"
    (out / name).write_bytes(payload)
```

### 第二步：用 vgmstream 转 WAV

```powershell
$vg = "C:\Users\ori\OneDrive\文档\ChatGPT\adv解包\tools\bin\vgmstream-cli.exe"
$indir = "C:\Users\ori\OneDrive\文档\ChatGPT\adv解包\extract\mo2_hca"
$outdir = "C:\Users\ori\OneDrive\文档\ChatGPT\adv解包\mo2_BGM"
New-Item -ItemType Directory -Force -Path $outdir | Out-Null

Get-ChildItem -LiteralPath $indir -Filter '*.hca' | Sort-Object Name | ForEach-Object {
    $wav = Join-Path $outdir ($_.BaseName + '.wav')
    & $vg -o $wav $_.FullName *> $null
}
```

### 实测结果

- 输出目录：`mo2_BGM`
- 64 个 WAV
- 命名：`adx02.wav`、`bgm01.wav`、`bgm01nl.wav`、`song_op1.wav` 等
- CPK 内没有曲名元数据，曲名仍只能靠游戏内音乐列表/UI 或人工试听对应。

---

## 4. 曲名/元数据说明

目前几款游戏音频资源本身基本都没有可自动读取的官方曲名表：

| 游戏/引擎 | 能拿到的名字 | 曲名来源 |
|---|---|---|
| Unity RT/GE | `EVE_xx` | 目前只能人工/外部 OST 对照 |
| BGI BE | `eve_xx` | UI 图 `SGMusic010000`，少部分 OGG Vorbis 注释 |
| CRI MO2 | `bgmxx` / `song_opx` | 暂无，需试听或游戏内音乐资料 UI 对照 |

## 5. 常用检查

```powershell
# 数文件
(Get-ChildItem -LiteralPath '<目录>' -File -Filter '*.wav').Count

# 看 WAV 文件头
$path = '<目录>\<文件>.wav'
$bytes = [System.IO.File]::ReadAllBytes($path)
[System.Text.Encoding]::ASCII.GetString($bytes[0..3])
[System.Text.Encoding]::ASCII.GetString($bytes[8..11])
```

## 6. 下次新增工作流时

遇到新的音频格式时，往这个文件追加一节，并记录：

1. 来源游戏/路径。
2. 引擎或封装格式。
3. 用什么工具提取。
4. 实际命令。
5. 输出目录和数量。
6. 有没有曲名/元数据，以及曲名来源在哪。