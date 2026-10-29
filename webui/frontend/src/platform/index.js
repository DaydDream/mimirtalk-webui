/*
 * 平台适配层入口。
 * 业务层只调用 window.MimirTalkPlatform.createPlatform() 获取适配层实例，
 * 不直接使用 fetch；web 与 static 两条实现见同目录 web.js / static.js。
 */
(function () {
  "use strict";

  // 契约版本必须与 shared/contracts/adapter-contract.v1.md 保持一致。
  const ADAPTER_CONTRACT_VERSION = 1;
  const registry = (window.MimirTalkPlatformRegistry = window.MimirTalkPlatformRegistry || {});

  class AdapterError extends Error {
    constructor(code, message, detail = {}) {
      super(message);
      this.name = "AdapterError";
      this.code = code;
      this.detail = detail && typeof detail === "object" ? detail : { value: detail };
    }

    toJSON() {
      return { code: this.code, message: this.message, detail: this.detail };
    }
  }

  function adapterError(code, message, detail = {}) {
    return new AdapterError(code, message, detail);
  }

  function staticDataBaseUrl() {
    const base = document.baseURI || window.location.href;
    return `${new URL("static-data/", base).href.replace(/\/+$/, "")}/`;
  }

  // 浏览器原生下载：桌面端 WebUI 与 static 离线端共用的降级路径。
  // 安卓 WebView 不支持 <a download>，那条路径由 android.js 的原生桥接管（D19）。
  function browserDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // 平台模式由启动/打包阶段显式注入：静态包写入
  // `window.MIMIRTALK_PLATFORM_MODE = "static"`，桌面后端不加该标记，缺省为 web。
  // 这里刻意不做网络探测：web 模式下探测 `/static-data/` 只会得到 404 并污染控制台。
  function resolvePlatformMode(options = {}) {
    const mode = String(options.mode || window.MIMIRTALK_PLATFORM_MODE || "web");
    if (mode !== "web" && mode !== "static") {
      throw adapterError("INVALID_REQUEST", `未知平台模式：${mode}`, { mode });
    }
    return mode;
  }

  async function createPlatform(options = {}) {
    const kind = resolvePlatformMode(options);
    if (kind === "static") {
      if (!registry.static) {
        throw adapterError("INVALID_REQUEST", "静态适配层未加载");
      }
      const adapter = registry.static.createStaticAdapter({ baseUrl: staticDataBaseUrl(), ...options });
      // 同一份静态包既跑离线桌面端，也跑安卓 WebView；
      // 只有真正处于原生外壳时才叠加原生桥能力，桌面端保持纯浏览器行为。
      if (registry.android && typeof registry.android.isNativeShell === "function" && registry.android.isNativeShell()) {
        return registry.android.createAndroidAdapter(adapter);
      }
      return adapter;
    }
    if (!registry.web) {
      throw adapterError("INVALID_REQUEST", "web 适配层未加载");
    }
    return registry.web.createWebAdapter(options.baseUrl || "");
  }

  window.MimirTalkPlatform = {
    ADAPTER_CONTRACT_VERSION,
    AdapterError,
    adapterError,
    browserDownload,
    createPlatform,
    resolvePlatformMode,
    staticDataBaseUrl,
  };
})();
