# EVE 系列游戏解包整理工作流

## 适用范围

- Unity 引擎游戏：EVE Ghost Enemies（GE）、EVE Rebirth Terror（RT）
- BGI / Buriko 引擎游戏：EVE Burst Error（BE）

## 工具

| 用途 | 工具 |
|---|---|
| Unity 完整导出/初筛 | `C:\Users\ori\Downloads\AssetRipper\AssetRipper.GUI.Free.exe` |
| Unity Sprite 扫描/提取 | `C:\Users\ori\OneDrive\文档\ChatGPT\eve\tools\scan_assets.py` / `extract_sprites.py` |
| BGI/Buriko ARC 解包 | `C:\Users\ori\OneDrive\文档\ChatGPT\eve\hazuki-windows-amd64.exe` |

## Unity 解包流程（GE / RT）

前两个游戏都是 Unity，不走 ARC 解包。AssetRipper 已下载在 `C:\Users\ori\Downloads\AssetRipper`。实际按 Sprite 名字直接整理用 UnityPy 脚本更快，AssetRipper 可作完整项目导出验证。

### 1. 扫描 Data 目录

```powershell
& python tools/scan_assets.py "C:\Users\ori\Downloads\redf_0005\[231208][El Dia] EVE ghost enemies【全年齢向け】\EVE ghost enemies\EVE_GE_Data" "C:\Users\ori\OneDrive\文档\ChatGPT\eve\extract\scan_report.json"
& python tools/scan_assets.py "C:\Users\ori\Downloads\EVE rebirth terror\EVE_RT_Data" "C:\Users\ori\OneDrive\文档\ChatGPT\eve\extract\scan_report_rt.json"
```

### 2. 提取 Sprite

```powershell
& python tools/extract_sprites.py "C:\Users\ori\Downloads\redf_0005\[231208][El Dia] EVE ghost enemies【全年齢向け】\EVE ghost enemies\EVE_GE_Data" "C:\Users\ori\OneDrive\文档\ChatGPT\eve\extract\images" --prefix EV_ ST_
& python tools/extract_sprites.py "C:\Users\ori\Downloads\EVE rebirth terror\EVE_RT_Data" "C:\Users\ori\OneDrive\文档\ChatGPT\eve\extract\images_rt" --prefix EV_ ST_
```

### 3. 分类和纯 CG 筛选

- Sprite 命名规律：`EV_*` = 事件 CG，`ST_*` = 立绘，`BG_*` = 背景。
- 完整 CG 通常命名如 `EV_XX_01_0A.png`，例如 `EV_GE_01_0A.png`、`EV_KO_01_0A.png`、`EV_MA_01_0A.png`。
- 需要排除的拆分素材：
  - 逐帧动画碎片：`EV_GE_08_0A_25_4_38_0.png`、`EV_KO_19_0A_04_0.png`
  - 背景拆分：`EV_KO_01_0A_BG_25_4_38B_0.png` 这类含 `_BG_` 的
  - 高分辨率局部细节：含 `_hi_`
- RT 的 `_BL`、`_2` 等变体也属于完整 CG，保留。
- 最终复制到 OneDrive 图片目录：
  - GE：`C:\Users\ori\OneDrive\图片\eve-ge-cg`，343 张
  - RT：`C:\Users\ori\OneDrive\图片\eve-rb-cg`，274 张

### Unity 实测数据

| 游戏 | Data 目录 | Sprite 总数 | EV_CG Sprite 数 | 最终 CG 数 | OneDrive 目录 |
|---|---|---:|---:|---:|---|
| EVE Ghost Enemies | `...\EVE ghost enemies\EVE_GE_Data` | 6345 | 2060 | 343 | `图片\eve-ge-cg` |
| EVE Rebirth Terror | `...\EVE rebirth terror\EVE_RT_Data` | 1824 | 279 | 274 | `图片\eve-rb-cg` |

### Unity 注意

- 直接扫 `Data` 目录里的 `globalgamemanagers` / `*.assets` 即可，不需要先解包。
- AssetRipper 版本 `2.0.0.0`，GUI 在 `C:\Users\ori\Downloads\AssetRipper\AssetRipper.GUI.Free.exe`；日志在 `C:\Users\ori\Downloads\AssetRipper\AssetRipper_20260831_150912.log`。
- 如果 UnityPy 读不了某个版本，再用 AssetRipper GUI 打开游戏根目录做 Export All。

## BGI / Buriko ARC 解包流程（BE）

### 适用场景

- 需要解包 BGI/Ethornell 引擎游戏（ARC 头一般是 `BURIKO ARC20` 或 `ARC2`）。
- 目标通常是提取 CG、立绘、背景图。
- 这类游戏不能用 AssetRipper；用 `hazuki-windows-amd64.exe`。

### 工具

工具文件在本项目根目录：

`C:\Users\ori\OneDrive\文档\ChatGPT\eve\hazuki-windows-amd64.exe`

常用命令：

```powershell
& 'C:\Users\ori\OneDrive\文档\ChatGPT\eve\hazuki-windows-amd64.exe' unpack <arc或目录> -o <输出目录> --decode-cp 932 --encode-cp 932
```

- 会自动把 `.arc` 里的 `CBG` 转成 `PNG`。
- 会自动把 `DSC` 提取成 `.hazuki.txt`。
- 会自动把 BGI 音频转成 `OGG`。

### 常规步骤

1. 先确认引擎：
   - 搜游戏目录里的 `.arc` 文件。
   - 用 `probe` 或直接看头几个字节判断是不是 `BURIKO ARC20`。
2. 把整个游戏目录递归解包到项目里的 `unpack` 输出目录。
3. 根据 ARC 编号分类资源：
   - 不同游戏的编号不同，需要先扫目录里的文件名和数量。
   - 常见规律：
     - `data02100` 常是 CG。
     - `data02110` 常是立绘。
     - `data02120` / `data02250` 常是背景。
4. 整理到项目下的分类文件夹，例如 `EVE_burst_error_cg\CG`、`BG`、`立绘`。
5. 最终复制到 OneDrive 图片目录，例如：
   - `C:\Users\ori\OneDrive\图片\eve-be-cg`
   - `C:\Users\ori\OneDrive\图片\eve-be-bg`
   - `C:\Users\ori\OneDrive\图片\eve-be-standings`

> OneDrive 图片目录在沙箱外，复制时用 `sandbox_permissions: "require_escalated"` 请求权限。

### EVE Burst Error 实测路径

- 游戏目录：`C:\El Dia\EVE burst error A`
- 解包输出：`C:\Users\ori\OneDrive\文档\ChatGPT\eve\EVE_burst_error_unpack`
- 二次验证解包：`C:\Users\ori\OneDrive\文档\ChatGPT\eve\EVE_burst_error_verify`
- 分类整理：`C:\Users\ori\OneDrive\文档\ChatGPT\eve\EVE_burst_error_cg`

各分类数量：

| 分类 | 来源 ARC | 数量 | OneDrive 目录 |
|---|---|---:|---|
| CG | `data02100` | 384（完整解包 386，含 2 张非纯 CG frame） | `图片\eve-be-cg` |
| 背景 | `data02120` / `data02250` | 219 | `图片\eve-be-bg` |
| 立绘 | `data02110` | 123 | `图片\eve-be-standings` |

### 关键坑

- 第一次解包 `data02100` 只得到 373 张，并漏掉尾部 `s30xx` 系列；用新输出目录重跑完整验证后才得到 386 张。
- 第一次的 `s3030.png` 是截断文件；完整重解包后替换为完整版。
- `s3045_フレームof.png` 和 `s3045_フレームの.png` 是“フレーム/边框”素材，不是纯 CG，整理 `eve-be-cg` 时不要放进去。
- 画廊脚本是 `data01000\setupforgallery.hazuki.txt`，可 grep `src=` 判断哪些是画廊 CG。
- 画廊里的 `img_*` 不是实际文件，通常是运行时合成的标题/缩略图；基础 CG 文件是 `s3045.png` 这种。

## 常用检查命令

统计 PNG 数量：

```powershell
(Get-ChildItem -LiteralPath '<目录>' -File -Filter *.png).Count
```

对比两个目录差异：

```powershell
$a = Get-ChildItem -LiteralPath '<目录A>' -File -Filter *.png | % Name
$b = Get-ChildItem -LiteralPath '<目录B>' -File -Filter *.png | % Name
$a | Where-Object { $_ -notin $b }
```

检查 PNG 能否正常打开：

```powershell
& 'C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -c "from PIL import Image; import os; [Image.open(os.path.join(p,f)).load() for f in os.listdir(p)]"
```

## 其他说明

- Unity 游戏优先用 UnityPy 扫描 `Data` 目录，AssetRipper 作为完整导出备份。
- BGI/Buriko 游戏用 `hazuki` 解包，不能用 AssetRipper。
- 文件名含日文/非 ASCII 时，PowerShell 命令里尽量用 `-LiteralPath`。
- 解包中途若输出 `GetFileAttributesEx ... file not found` 之类，先看是不是重复文件名/非必要资源，不一定影响 CG。
