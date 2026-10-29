# 官方字体源文件

直接来自 https://github.com/google/fonts 的固定 Commit。每个目录保留完整 TTF、同 Commit 的 OFL.txt、METADATA.pb；不使用第三方下载站或系统字体目录。

| 字体 | Commit | 原文件 | 处理 |
| --- | --- | --- | --- |
| Noto Sans SC | a85815a42757630ce188fdad368c2dfc444d4773 | NotoSansSC[wght].ttf | 原样复制 |
| Noto Serif SC | 8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5 | NotoSerifSC[wght].ttf | fonttools 4.67.0，完整 wght=700，无子集化 |

运行 manifest 记录 SHA256、版本及内嵌版权；python -B webui/tools/build_fonts.py 可复现。此目录不通过 frontend/assets 复制进 APK；APK 包含运行文件、许可和 manifest。
