# 第三方资源声明

本项目有权许可的源代码采用MIT许可证，见 [LICENSE](LICENSE)。字体、游戏素材和第三方组件不因项目采用MIT而自动适用同一许可。

## 当前运行字体

| 字体 | 用途及处理 | 许可 |
| --- | --- | --- |
| Noto Sans SC | 正文与界面，保留官方完整可变TTF，100～900字重 | SIL Open Font License 1.1 |
| Noto Serif SC | 发言人名字，由官方完整可变TTF实例化为静态700，不裁剪字符 | SIL Open Font License 1.1 |

字体文件、完整版权与OFL文本位于 `webui/frontend/assets/fonts/`。固定版本、源文件与输出哈希见同目录 `manifest.json`。源码包另保留 `docs/font-sources/`，用于复现字体构建。

- [Noto Sans SC固定来源](https://github.com/google/fonts/tree/a85815a42757630ce188fdad368c2dfc444d4773/ofl/notosanssc)，许可附件 `NotoSansSC-OFL.txt`。
- [Noto Serif SC固定来源](https://github.com/google/fonts/tree/8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5/ofl/notoserifsc)，许可附件 `NotoSerifSC-OFL.txt`。静态实例是修改版，未冒充原始可变文件。

字体不得作为独立商品出售，须保留版权与许可，并遵守OFL的修改及分发条件。完整条件以随附许可原文为准。本次源码与运行包不包含历史来源未核实的鸿蒙字体或旧字体归档。

## 游戏素材

头像、贴纸、气泡、背景、界面图片及部分联系人、角色数据来自《深空之眼》客户端或其衍生处理，相关权利属于各自权利人。本项目不主张拥有这些素材，项目MIT许可证不覆盖游戏素材。

素材位于运行包 `assets_source/`、`webui/assets/`、`webui/frontend/assets/` 及相关数据文件中。去尾、缩放、提取或格式转换不改变原素材的权利归属。

本项目为粉丝向二次创作与学习交流工具，与游戏官方无隶属关系。现有记录中未确认覆盖提取素材再分发的完整授权依据；免费、非商业说明及本声明本身不构成权利人授权。维护者决定保留素材正常分发，不代表取得额外授权。

## 运行时与Android组件

- Python及其标准库：运行包 `python-runtime/LICENSE.txt`。
- Pillow：运行包 `python-runtime/Lib/site-packages/pillow-12.3.0.dist-info/` 中的许可附件。
- Capacitor：MIT许可，安装npm依赖后可在对应依赖目录查阅；Android原生模板及启动资源沿用其适用许可。
- Gradle Wrapper：遵循Gradle上游适用许可；该构建工具不改变应用源代码与资源的许可。

源码构建使用的其他依赖应遵守各自许可证。接收者在其他项目中使用第三方资源前，应独立核实相应权利与条件。
