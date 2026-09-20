# 深空之眼 USM 视频 key 定位任务目录

日期：2026-09-18
状态：容器解析已完成，视频载荷解密 key 未拿到。

## 结论

现在不是 MP4 编码器要密码，而是 CRI USM 的 VP9 视频载荷需要 32 位整数 key。
拿到这个整数后，`generate_keys(key_num)` 会生成：

- 视频 key：`0x40` 字节
- 音频 key：`0x20` 字节

今天只处理 `story` 和 `activity`，共 116 个 `.usm`：

- `extract\aethergazer\story\SofdecAsset\story`：64 个，2,608,155,488 字节
- `extract\aethergazer\activity\SofdecAsset\activity`：52 个，228,895,040 字节

`function` 目录 183 个、2,337,215,584 字节暂不处理。

## 今日完成标准

- 找到候选 32 位 `key_num`，并记录来源和证据。
- 用主样本完整解密并解码 240 帧，`ffmpeg -xerror` 返回 0，且无 VP9 坏帧错误。
- 用一个含 `@SFA` 音频的 `story` 样本验证同一个 key 可处理音频。
- 批量输出 `story` + `activity` 的 MP4 到：
  - `extract\aethergazer\mp4\story`
  - `extract\aethergazer\mp4\activity`
- 生成 JSON 清单：源文件、输出文件、帧数、分辨率、时长、音频流、错误数、key 来源。

只让 `ffprobe` 读到元数据不算完成。必须完整解码无错误。

## 任务目录

| ID | 任务 | 输入 | 产物 | 完成判定 |
|---|---|---|---|---|
| T0 | 固定复现证据 | `1076_skin02_activity_loop.usm` | SHA256、帧数、分辨率、错误基线 | 与昨日结论一致：2340x1080、60 fps、240 帧 |
| T1 | 确认可用工具链 | `dumpbin`、Python、现有 WannaCRI | 工具路径记录 | 能用 `dumpbin /exports` 和 `/imports` 读 PE |
| T2 | 扫描 IL2CPP / CRI 字符串 | `GameAssembly.dll`、`global-metadata.dat`、CRI DLL | JSON 命中清单 | 找到 `CriMana`、`Decrypter`、`SetKey`、`Movie` 等候选位置 |
| T3 | 建 C# -> IL2CPP -> CRI Mana 调用链 | T2 命中项、CRI 导出表 | 调用链笔记 | 明确 key 是常量、配置、回调，还是上层传入 |
| T4 | 静态分析 CRI Mana 解密层 | `cri_ware_unity.dll`、`cri_mana_vpx.dll` | 函数/xref 注释 | 确认 Mana 容器层在哪里接收或设置 key |
| T5 | 候选 key 验证器 | `generate_keys()`、`decrypt_video_packet()` | 候选 IVF/MP4、错误日志 | 240 帧完整解码无错误 |
| T6 | 音频验证 | 含 `@SFA` 的 story 样本 | HCA/WAV、合并 MP4 | 音画同步，时长正常 |
| T7 | 批量导出 | 116 个目标 USM | `mp4\story`、`mp4\activity`、manifest | 全部有输出或明确失败原因 |
| T8 | 收尾归档 | T7 产物 | 更新 briefing | 记录 key、命令、清单、遗留问题 |

## 已知输入

主视频样本：

```text
extract\aethergazer\activity\SofdecAsset\activity\1076_skin02_activity_loop.usm
```

游戏侧关键文件：

```text
C:\Program Files\AetherGazerLauncher\AetherGazer\GameAssembly.dll
C:\Program Files\AetherGazerLauncher\AetherGazer\AetherGazer_Data\il2cpp_data\Metadata\global-metadata.dat
C:\Program Files\AetherGazerLauncher\AetherGazer\AetherGazer_Data\Plugins\x86_64\cri_mana_vpx.dll
C:\Program Files\AetherGazerLauncher\AetherGazer\AetherGazer_Data\Plugins\x86_64\cri_ware_unity.dll
```

本机已确认 `dumpbin`：

```text
C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC\14.42.34433\bin\Hostx64\x64\dumpbin.exe
```

PATH 中没有 `llvm-objdump`、`objdump`、`nm`、`strings`、`radare2`、Ghidra、Il2CppDumper、dnSpy、x64dbg、WinDbg。

Python 运行时有 `UnityPy`，没有 `pefile`、`capstone`、`lief`。静态反汇编优先用本机 Visual Studio `dumpbin` 和现有字符串扫描脚本。

## 解决工作流程

### 1. 固定失败基线

目标：确认样本仍然只在 VP9 载荷层失败，不分心到封装、帧率、IVF 头或 ffmpeg 参数。

动作：

- 对样本计算 SHA256。
- 用现有 USM 逻辑解析流类型、帧数、分辨率、帧率。
- 保留裸流 IVF 的 `ffmpeg -v error -xerror` 错误。
- 记录已失败的 key：`0x5E5CE3`、`0`、`0xFFFFFFFF`、`0x7F1E4C`、`0x12345678`、`0x9E5CE3`。

产物：

- `_usm_probe\baseline_key_search.json`
- `_usm_probe\baseline_dec_err.txt`

### 2. 扫描二进制字符串和元数据

目标：不要在 `GameAssembly.dll` 上盲搜，先缩小到 CRI Mana / decrypter / movie 调用。

动作：

- 用 `tools\scan_raw_strings.py` 按 UTF-8 和 UTF-16LE 扫描：
  - `CriMana`
  - `Mana`
  - `Decrypter`
  - `Decrypt`
  - `SetDecryptionKey`
  - `SetKey`
  - `Movie`
  - `Sofdec`
  - `Vvp9`
- 把结果写入 JSON，按文件、offset、上下文筛。
- 对 CRI 错误字符串优先查 xref，例如 `Only one decrypter is creatable`、`E2011072703`。

产物：

- `_usm_probe\strings_crimana.json`
- `_usm_probe\strings_il2cpp.json`

### 3. 建立 key 来源调用链

目标：回答 key 从哪里来。

动作：

- `dumpbin /exports cri_ware_unity.dll`、`dumpbin /exports cri_mana_vpx.dll`。
- `dumpbin /imports GameAssembly.dll`，确认它如何绑定 CRI 插件。
- 在 `GameAssembly.dll` 中围绕 Mana 字符串、IL2CPP 方法名和导入调用找 xref。
- 如果 key 由配置传入，继续找配置 assets 或代码常量。
- 如果 key 由运行时生成，记录生成算法和输入来源。

产物：

- `_usm_probe\cri_exports.txt`
- `_usm_probe\gameassembly_imports.txt`
- `docs\aethergazer-usm-key-location-notes.md`

### 4. 候选 key 验证

目标：把每个候选 key 都当作独立实验证据，不靠肉眼判断。

动作：

- 对候选整数调用 `generate_keys()`。
- 对全部视频帧调用 `decrypt_video_packet()`。
- 导出候选 IVF/MP4。
- 用捆绑 FFmpeg 完整解码：

```powershell
& ".\tools\bin\ffmpeg\ffmpeg-master-latest-win64-gpl-shared\bin\ffmpeg.exe" `
  -v error -xerror -i ".\_usm_probe\candidate.ivf" -f null -
```

- 抽样导出第一帧、中间帧、最后一帧 PNG。

通过标准：

- 进程退出码为 0。
- 无 `Invalid data`、`Not all references are available` 等 VP9 错误。
- 帧数为 240。
- 抽帧画面正常，不是花屏或全灰。

### 5. 音频和 MP4 合成

目标：视频 key 通过后，不把音频漏掉。

动作：

- 找一个含 `@SFA` 的 story 样本。
- 用同一 `key_num` 生成音频 key，并走 `decrypt_audio_packet()`。
- 用 vgmstream 或 FFmpeg 解码 HCA。
- 检查音视频首尾同步。
- 生成 MP4 时记录视频流、音频流、时长和编码参数。

### 6. 批量导出

目标：只对 `story` + `activity` 开跑，避免误处理 `function`。

动作：

- 写一个批量脚本，例如 `tools\convert_aethergazer_usm_to_mp4.py`。
- 输入目录固定为：
  - `extract\aethergazer\story\SofdecAsset\story`
  - `extract\aethergazer\activity\SofdecAsset\activity`
- 输出目录固定为：
  - `extract\aethergazer\mp4\story`
  - `extract\aethergazer\mp4\activity`
- 支持跳过已存在输出、单文件失败继续、JSON 清单。

产物：

- `extract\aethergazer\mp4\story`
- `extract\aethergazer\mp4\activity`
- `extract\aethergazer\mp4\manifest.json`

### 7. 静态失败时的动态备用

目标：静态调用链无法还原时，抓运行时 key。

动作：

- 在 CRI Mana 初始化、decrypter 注册、视频播放调用点下断点。
- 拦截 `generate_keys` 等价函数的输入，或直接抓 key buffer。
- 记录调用栈、模块偏移、寄存器值、内存值。
- 回到候选 key 验证器做完整解码验证。

如果最终无法拿到 key，再考虑游戏内录屏；这是最后备选，不作为今天首选路径。

## 不做事项

- 不暴力枚举大范围 key。
- 不重复尝试已失败 key。
- 不把 `ffprobe` 元数据当成功。
- 不处理 `function` 目录。
- 不覆盖已有 `_usm_probe` / `_usm_mp4_test` 试验产物。
- 不在拿到完整验证前批量覆盖正式 MP4 输出。

