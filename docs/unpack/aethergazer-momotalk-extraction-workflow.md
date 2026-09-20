# 深空之眼弥弥尔通讯 / MomoTalk 提取工作流

## 目标

从深空之眼 Windows 资源中提取弥弥尔通讯模块的完整 UI、序列化结构、图片、入口配置和 Lua 脚本包，
并保留可复核的文件清单与哈希。

## 已验证环境

- 游戏目录：`C:\Program Files\AetherGazerLauncher\AetherGazer`
- 数据目录：`C:\Program Files\AetherGazerLauncher\AetherGazer\AetherGazer_Data\StreamingAssets\Windows`
- Python：
  `C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe`
- 依赖：`UnityPy 1.25.3`
- Unity fallback：`2022.3.62f3c1`

## UI 与图片提取

```powershell
C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe `
  tools\extract_aethergazer_momotalk.py `
  --out-dir extract\aethergazer_momotalk `
  --include-chat-stickers `
  --overwrite
```

主要资源：

- `widget/system/momotalk.ys`
- `widget/system/chat.ys`
- `widget/system/mimirchip.ys`
- `hid/pages/chatpage.ys`
- `hid/pages/chatpage/sendmessage.ys`
- `hid/pages/home/chat.ys`
- `atlas/mimirchipatlas.ys`
- `atlas/monotalkatlas.ys`
- `texturebg/momotalk/`
- `textureconfig/momotalk/`
- `textureconfig/chat/chatsticker/`
- `i18nimg/chat/chatsticker/`

## Lua 脚本提取

脚本包索引：

```text
scripts32 | c09dd85757652b239b5e668bab1f404b | 35723244
scripts64 | 3f1ecf910a2e332dc34190e9a70c03a6 | 35817435
```

完整命令：

```powershell
C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe `
  tools\extract_aethergazer_momotalk_lua.py `
  --out-dir extract\aethergazer_momotalk `
  --arch both `
  --overwrite
```

脚本是 LuaJIT 字节码，文件头为 `1B 4C 4A 02`。脚本提取器保留原始字节，不进行明文转换。

## 输出结构

```text
extract/aethergazer_momotalk/
├── COMPLETE_INVENTORY.md
├── manifest.json
├── images/
├── structure/
├── typetrees/
└── scripts/
    ├── lua_all/
    ├── lua32_all/
    ├── lua_momotalk/
    ├── lua_momotalk_32/
    ├── lua_manifest.json
    ├── lua_momotalk_list.json
    └── lua_momotalk_list.md
```

## 校验

- UI 资源：`769 / 769`
- PNG：`1729`
- x64 TextAsset：`10267 / 10267`
- x86 TextAsset：`10267 / 10267`
- MomoTalk 直连脚本：`37 / 37`
- LuaJIT 文件头异常：`0`
- 错误：`0`

## 后续阶段

如果需要阅读方法体或恢复调用图，下一步是针对 LuaJIT 字节码进行反汇编/反编译。继续从 UI bundle
提取不会得到明文 Lua。
