# adv解包

集中记录和存放 ADV 游戏解包工作流的项目目录。

## 目录结构

```text
adv解包/
├── README.md
├── docs/
│   ├── audio-unpack-workflows.md       # 音频解包总入口，按格式/引擎分类
│   ├── aethergazer-0917-briefing.md    # 深空之眼 0917 解包任务简报
│   ├── aethergazer-unpack-workflow.md  # 深空之眼解包流程记录
│   ├── aethergazer-video-unpack-workflow.md # 深空之眼 USM 视频解包与 key 验证流程
│   ├── eve-unpack-workflow.md          # EVE 系列旧版完整解包流程（历史参考）
│   ├── eve-bgm-unpack-workflow.md      # EVE 系列 BGM 解包旧版流程（历史参考）
│   └── eve-op-video-unpack-workflow.md # EVE 系列 OP 视频解包旧版流程（历史参考）
└── tools/
    ├── *.py / *.ps1                     # 通用扫描/提取脚本
    └── bin/
        ├── hazuki-windows-amd64.exe     # BGI/Buriko ARC 解包
        └── vgmstream-cli.exe            # CRI HCA 等音频解码
```

## 默认工作目录

本项目的相对路径命令默认以：

```text
C:\Users\ori\OneDrive\文档\ChatGPT\adv解包
```

为当前目录。

## 使用方式

按需打开对应工作流文档：

- 音频：`docs/audio-unpack-workflows.md`
- 深空之眼 0917 任务简报：`docs/aethergazer-0917-briefing.md`
- 深空之眼气泡资源审计：`docs/aethergazer-bubble-extraction-audit.md`
- 深空之眼流程记录：`docs/aethergazer-unpack-workflow.md`
- 深空之眼 USM 视频流程：`docs/aethergazer-video-unpack-workflow.md`
- 旧 EVE 系列整体解包：`docs/eve-unpack-workflow.md`

遇到新游戏或新封装格式时，先按 `docs/audio-unpack-workflows.md` 里的“解包固定流程”判断，再在对应文档追加新的工作流记录。
