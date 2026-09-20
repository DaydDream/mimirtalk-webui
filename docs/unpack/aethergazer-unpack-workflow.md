# AetherGazer / 深空之眼 资源解包

## 已验证环境

- 游戏目录：`C:\Program Files\AetherGazerLauncher\AetherGazer`
- 数据目录：`C:\Program Files\AetherGazerLauncher\AetherGazer\AetherGazer_Data\StreamingAssets\Windows`
- 索引文件：`AssetHash_Info.bytes`
- Unity 版本 fallback：`2022.3.62f3c1`
- 工具：`tools\extract_aethergazer_images.py`
- 依赖：`UnityPy 1.25.3+`、`Pillow`

弥弥尔通讯 / MomoTalk 的专项提取流程见：

[`aethergazer-momotalk-extraction-workflow.md`](aethergazer-momotalk-extraction-workflow.md)

## 数据格式

`StreamingAssets\Windows` 下有 `0-f` 共 16 个十六进制子目录，约 6.5 万个 `.ys`
文件。它们本质上是 Unity AssetBundle，但文件名是资源 hash，
并按以下规则落盘：

```text
Windows\<hash[0]>\<hash[1]>\<hash>.ys
```

`AssetHash_Info.bytes` 是 JSON，其中 `assetHashList` 每项格式为：

```text
资产虚拟路径|hash|文件大小
```

例如：

```text
textureconfig/character/portrait/1041.ys|ee661615638afa7d3e35ac3c122d7133|6748345
```

实际文件：

```text
Windows\e\e\ee661615638afa7d3e35ac3c122d7133.ys
```

部分 `.ys` 文件在 `UnityFS` 签名前带有少量附加字节。使用 UnityPy
加载前需要执行：

```python
raw = bundle_path.read_bytes()
offset = raw.find(b"UnityFS")
env = UnityPy.load(io.BytesIO(raw[offset:]))
```

## 提取角色原画和剧情 CG

当前脚本默认包含：

- `textureconfig/character/portrait/`：角色原画
- `textureconfig/character/portraitdlc/`：角色 DLC 原画
- `textureconfig/character/portrait_half/`：半身像
- `textureconfig/illustratedhandbook/itemplot_l/`：剧情 CG 大图
- `textureconfig/illustratedhandbook/itemplot_s/`：剧情 CG 小图
- `texturebg/illustratedhandbook/illustrated_storyline/`：剧情场景图

默认跳过 `$naive` 备用资源，导出 Texture2D 原图 PNG，并保留透明度。

完整命令：

```powershell
C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe `
  tools\extract_aethergazer_images.py `
  --preset all `
  --out-dir extract\aethergazer
```

只提取角色原画：

```powershell
C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe `
  tools\extract_aethergazer_images.py `
  --preset portraits `
  --out-dir extract\aethergazer
```

只提取剧情 CG：

```powershell
C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe `
  tools\extract_aethergazer_images.py `
  --preset story-cg `
  --out-dir extract\aethergazer
```

如果要包含 `$naive` 备用资源：

```powershell
... --include-naive
```

## 输出

```text
extract/aethergazer/
├── manifest.json
├── character_portrait/
├── character_portrait_dlc/
├── character_portrait_half/
├── story_cg_large/
├── story_cg_small/
└── storyline_scene/
```

`manifest.json` 记录输入分类、输出文件、尺寸、错误和耗时。脚本默认跳过已经存在的
PNG，可直接断点续跑；需要重建时增加 `--overwrite`。

当前 `extract\aethergazer` 的已执行结果为：675 张 PNG，约 851.6 MiB，0 个错误。
其中包括通过 `--include-naive` 补充的 91 个 `$naive` 备用版本，文件名保留
`$naive` 后缀以便区分。

## 其他候选资源

以下目录暂未纳入默认提取范围：

- `comsingle/textureconfig/background/`：约 1607 张、5.9 GiB，主要是剧情背景/场景图
- `comsingle/textureconfig/loading/`：约 62 张，加载界面图
- `comsingle/textureconfig/illustratedhandbook/collect_s/`：约 983 张，图鉴和小图集合
- `textureconfig/illustratedhandbook/boss/`：敌人/Boss 图鉴
- `textureconfig/illustratedhandbook/portrait/`：剧情相关半身像
