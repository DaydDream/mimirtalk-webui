# Android源码

本目录保留实际Android工程、原生插件、资源和构建脚本。前端业务来自同仓 `webui/frontend/`，构建后通过Capacitor同步；不依赖桌面Python后端运行。

## 构建环境

- Node.js与npm。
- Python 3.12及以上，安装根目录 `requirements-build.txt`。
- JDK 21，配置 `JAVA_HOME`。
- Android SDK，配置 `ANDROID_HOME` 或 `ANDROID_SDK_ROOT`，安装工程指定的SDK平台与构建工具。
- 从同版本WebUI运行包复制 `assets_source/` 到仓库根目录。

在仓库根目录执行：

```powershell
npm ci
python -m pip install -r requirements-build.txt
npm run build:web
npm run sync:android
npm run build:debug
```

也可显式指定路径：

```powershell
./android/tools/build_debug.ps1 -Python '路径/python.exe' -JavaHome '路径/jdk21' -AndroidSdk '路径/Android/Sdk'
```

构建输出在 `android/app/build/outputs/apk/debug/`。构建脚本不会启动模拟器或安装APK。

应用包名、原生版本与权限在Android工程中维护，WebUI资源版本独立标识为1.1.1。正式签名密钥和用户配置不随源码提交；发布APK需使用维护者指定的签名。

`app/src/main/` 中的PNG是实际启动图标等运行资源。测试工程、参考图、真机截图、日志、缓存和APK/AAB产物不包含在本源码候选中。
