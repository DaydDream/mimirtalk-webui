/*
 * 安卓原生桥适配层。
 *
 * 安卓端在 WebView 里跑的是同一份 static 静态包，因此本层不重复业务逻辑：
 * 它在 static 适配层之上再叠加安卓 WebView 专有的原生能力（当前是固定目录落盘保存），
 * 由 index.js 在检测到原生外壳时自动包装。业务层仍只调用同一套契约方法（D28 / 约束 §3.1）。
 *
 * 插件方法统一通过 window.Capacitor.Plugins 获取；业务层不得直接触碰 Capacitor API。
 */
(function () {
  "use strict";

  const platform = window.MimirTalkPlatform;
  const { adapterError } = platform;

  const FILE_SAVER_PLUGIN = "MimirFileSaver";
  const DIAGNOSTICS_PLUGIN = "MimirDiagnostics";

  function isNativeShell() {
    const capacitor = window.Capacitor;
    return Boolean(
      capacitor &&
        typeof capacitor.isNativePlatform === "function" &&
        capacitor.isNativePlatform(),
    );
  }

  function nativePlugin(name) {
    const target = window.Capacitor?.Plugins?.[name];
    if (!target) {
      throw adapterError("NATIVE_UNAVAILABLE", `原生插件不可用：${name}`, { plugin: name });
    }
    return target;
  }

  // Capacitor 桥以 JSON 传输二进制，保存时先转成 base64。
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () =>
        reject(adapterError("NATIVE_UNAVAILABLE", "读取导出数据失败", {}));
      reader.onload = () => {
        const text = String(reader.result || "");
        const comma = text.indexOf(",");
        resolve(comma >= 0 ? text.slice(comma + 1) : text);
      };
      reader.readAsDataURL(blob);
    });
  }

  function nativeErrorCode(error) {
    return String(error?.code || error?.data?.code || "");
  }

  function mapFileSaverError(error, fallbackMessage) {
    const code = nativeErrorCode(error);
    const nativeMessage = String(error?.message || error || "");
    window.MimirTalkDevLogger?.recordError?.("export.native", "原生文件保存失败", error, {
      native_code: code || null,
    });

    if (code === "INVALID_REQUEST") {
      return adapterError("INVALID_REQUEST", "缺少有效的导出数据", {
        native_message: nativeMessage,
      });
    }
    if (code === "INVALID_IMAGE") {
      return adapterError("INVALID_IMAGE", "导出内容不是有效的 PNG 图片", {
        native_message: nativeMessage,
      });
    }
    if (code === "STORAGE_PERMISSION_DENIED") {
      return adapterError("EXPORT_WRITE_FAILED", "需要允许存储权限才能写入导出目录", {
        native_message: nativeMessage,
      });
    }
    return adapterError("EXPORT_WRITE_FAILED", fallbackMessage, {
      native_message: nativeMessage,
    });
  }

  function base64ToBlob(base64, mimeType) {
    const binary = atob(String(base64 || ""));
    const chunks = [];
    const chunkSize = 32768;
    for (let offset = 0; offset < binary.length; offset += chunkSize) {
      const slice = binary.slice(offset, offset + chunkSize);
      const bytes = new Uint8Array(slice.length);
      for (let index = 0; index < slice.length; index += 1) {
        bytes[index] = slice.charCodeAt(index);
      }
      chunks.push(bytes);
    }
    return new Blob(chunks, { type: mimeType || "image/png" });
  }

  function createAndroidAdapter(base) {
    // 固定导出目录显示名缓存：原生读取是异步的，外壳的 exportFolderLabel()
    // 走同步签名，这里缓存最近一次原生读取结果，由 refreshExportFolderLabel 刷新。
    const fixedExportFolderLabel = "Pictures/MimirTalk";
    let lastFolderLabel = fixedExportFolderLabel;
    // Bug 记录文件夹继续使用独立 SAF 授权；长图导出固定写入 Pictures/MimirTalk。
    let lastBugFolderLabel = "";
    // 导出画廊 URL 由适配层创建和释放；键为 size|uri，值为 { url, width, height }。
    const exportImageUrls = new Map();

    function releaseExportImage(url) {
      const target = String(url || "");
      if (!target) return;
      for (const [key, item] of exportImageUrls) {
        if (item.url === target) {
          exportImageUrls.delete(key);
          URL.revokeObjectURL(item.url);
          return;
        }
      }
      if (target.startsWith("blob:")) URL.revokeObjectURL(target);
    }

    function releaseExportImages() {
      for (const item of exportImageUrls.values()) {
        URL.revokeObjectURL(item.url);
      }
      exportImageUrls.clear();
    }

    async function saveExport(blob, { file_name = "export.png", mime_type = "application/octet-stream" } = {}) {
      const data = await blobToBase64(blob);
      let result;
      try {
        result = await nativePlugin(FILE_SAVER_PLUGIN).saveFile({
          fileName: file_name,
          mimeType: mime_type,
          data,
        });
      } catch (error) {
        throw mapFileSaverError(error, "图片保存失败，请检查设备存储空间或固定导出目录");
      }
      if (result && result.cancelled) {
        return { saved: false, cancelled: true, reason: "用户取消保存", file_name };
      }
      if (result && result.folder_label) lastFolderLabel = result.folder_label;
      return {
        saved: true,
        via: "native_fixed",
        uri: (result && result.uri) || "",
        file_name: (result && result.name) || file_name,
        // B3-A2 兼容字段：继续透传固定导出位置的显示名 / URI，供导出总览消费。
        folder_label: (result && result.folder_label) || "",
        folder_uri: (result && result.folder_uri) || "",
      };
    }

    // 诊断、版本与固定导出目录为 B3-A2 兼容追加能力，仅安卓外壳实现；
    // 原生插件缺失时统一抛 NATIVE_UNAVAILABLE，调用方按方法存在性做能力探测。
    async function listDiagnostics() {
      const result = await nativePlugin(DIAGNOSTICS_PLUGIN).listReports({});
      const reports = result && result.reports;
      return Array.isArray(reports) ? reports : [];
    }

    async function writeDiagnostic(report = {}) {
      return nativePlugin(DIAGNOSTICS_PLUGIN).writeReport({
        kind: String(report.kind || "js-error"),
        message: String(report.message || ""),
        stack: String(report.stack || ""),
        occurred_at: String(report.occurred_at || ""),
        view: String(report.view || ""),
      });
    }

    async function clearDiagnostics() {
      return nativePlugin(DIAGNOSTICS_PLUGIN).clearReports({});
    }

    async function exportDiagnostic(id) {
      return nativePlugin(DIAGNOSTICS_PLUGIN).exportReport({ id: String(id || "") });
    }

    function mapBugFolderError(error, fallbackMessage) {
      const code = nativeErrorCode(error);
      return adapterError(
        code === "FOLDER_PERMISSION_REVOKED" ? "FOLDER_PERMISSION_REVOKED" : "EXPORT_WRITE_FAILED",
        fallbackMessage,
        { native_message: String(error?.message || error || "") },
      );
    }

    async function chooseBugFolder() {
      let result;
      try {
        result = await nativePlugin(DIAGNOSTICS_PLUGIN).chooseBugFolder({});
      } catch (error) {
        throw mapBugFolderError(error, "无法更换 Bug 记录文件夹");
      }
      if (!result || result.cancelled || result.selected === false) {
        return { selected: false, cancelled: true, reason: "用户取消更换" };
      }
      lastBugFolderLabel = result.folder_label || "";
      return {
        selected: true,
        folder_label: result.folder_label || "",
        folder_uri: result.folder_uri || "",
      };
    }

    function bugFolderLabel() {
      return lastBugFolderLabel;
    }

    async function refreshBugFolderLabel() {
      const plugin = window.Capacitor?.Plugins?.[DIAGNOSTICS_PLUGIN];
      if (!plugin || typeof plugin.bugFolderLabel !== "function") {
        lastBugFolderLabel = "";
        return "";
      }
      try {
        const result = await plugin.bugFolderLabel({});
        lastBugFolderLabel = (result && result.label) || "";
      } catch (error) {
        lastBugFolderLabel = "";
      }
      return lastBugFolderLabel;
    }

    async function retryDiagnosticSync() {
      const plugin = window.Capacitor?.Plugins?.[DIAGNOSTICS_PLUGIN];
      if (!plugin || typeof plugin.retrySync !== "function") {
        return { synced: 0, pending: 0, reason: "NATIVE_UNAVAILABLE" };
      }
      const result = await plugin.retrySync({});
      return {
        synced: Number(result?.synced || 0),
        pending: Number(result?.pending || 0),
        reason: (result && result.reason) || "",
      };
    }

    async function appVersion() {
      const result = await nativePlugin(DIAGNOSTICS_PLUGIN).getAppVersion({});
      return {
        versionName: (result && result.versionName) || "",
        versionCode: result && result.versionCode != null ? result.versionCode : null,
      };
    }

    async function chooseExportFolder() {
      releaseExportImages();
      lastFolderLabel = fixedExportFolderLabel;
      return {
        selected: true,
        folder_label: fixedExportFolderLabel,
        folder_uri: "mimirtalk://pictures/MimirTalk",
      };
    }

    function exportFolderLabel() {
      return lastFolderLabel || fixedExportFolderLabel;
    }

    async function listExportImages() {
      const plugin = window.Capacitor?.Plugins?.[FILE_SAVER_PLUGIN];
      if (!plugin || typeof plugin.listExportImages !== "function") {
        return { images: [], reason: "NATIVE_UNAVAILABLE" };
      }
      let result;
      try {
        result = await plugin.listExportImages({});
      } catch (error) {
        return {
          images: [],
          reason: "LIST_FAILED",
        };
      }
      const rawImages = Array.isArray(result?.images) ? result.images : [];
      const images = rawImages
        .map((item) => ({
          uri: String(item?.uri || ""),
          name: String(item?.name || ""),
          created_at: String(item?.created_at || ""),
          modified_at: String(item?.modified_at || ""),
          width: Number(item?.width) > 0 ? Number(item.width) : 0,
          height: Number(item?.height) > 0 ? Number(item.height) : 0,
          readable: item?.readable !== false,
        }))
        .filter((item) => item.uri);
      if (result?.folder_label) lastFolderLabel = result.folder_label;
      return {
        images,
        folder_label: String(result?.folder_label || lastFolderLabel || ""),
        reason: String(result?.reason || ""),
      };
    }

    async function resolveExportImage(uri, { size = "thumbnail" } = {}) {
      const targetUri = String(uri || "");
      const targetSize = size === "full" ? "full" : "thumbnail";
      if (!targetUri) return { url: "", reason: "INVALID_REQUEST" };
      const key = `${targetSize}|${targetUri}`;
      const cached = exportImageUrls.get(key);
      if (cached) return { ...cached };

      const plugin = window.Capacitor?.Plugins?.[FILE_SAVER_PLUGIN];
      if (!plugin || typeof plugin.resolveExportImage !== "function") {
        return { url: "", reason: "NATIVE_UNAVAILABLE" };
      }

      let result;
      try {
        result = await plugin.resolveExportImage({ uri: targetUri, size: targetSize });
      } catch (error) {
        return {
          url: "",
          reason: "UNREADABLE",
        };
      }
      if (!result || !result.data) {
        return { url: "", reason: String(result?.reason || "UNREADABLE") };
      }

      let blob;
      try {
        blob = base64ToBlob(result.data, result.mime_type || "image/png");
      } catch (error) {
        window.MimirTalkDevLogger?.recordError?.(
          "export.gallery",
          "导出图片转码失败",
          error,
          { size: targetSize },
        );
        return { url: "", reason: "UNREADABLE" };
      }
      const item = {
        url: URL.createObjectURL(blob),
        width: Number(result.width) > 0 ? Number(result.width) : 0,
        height: Number(result.height) > 0 ? Number(result.height) : 0,
      };
      exportImageUrls.set(key, item);
      return { ...item };
    }

    async function refreshExportFolderLabel() {
      const plugin = window.Capacitor?.Plugins?.[FILE_SAVER_PLUGIN];
      if (!plugin || typeof plugin.folderLabel !== "function") {
        lastFolderLabel = fixedExportFolderLabel;
        return lastFolderLabel;
      }
      try {
        const result = await plugin.folderLabel({});
        lastFolderLabel = (result && result.label) || fixedExportFolderLabel;
      } catch (error) {
        lastFolderLabel = fixedExportFolderLabel;
      }
      return lastFolderLabel;
    }

    return {
      ...base,
      kind: "android",

      capabilities() {
        return {
          ...base.capabilities(),
          native_filesystem: true,
          // 安卓侧长图导出走低内存分片渲染（B2 / D10 / D11）；桌面与离线端保持整幅渲染。
          streaming_export: true,
        };
      },

      saveExport,
      listDiagnostics,
      writeDiagnostic,
      clearDiagnostics,
      exportDiagnostic,
      chooseBugFolder,
      bugFolderLabel,
      refreshBugFolderLabel,
      retryDiagnosticSync,
      appVersion,
      chooseExportFolder,
      exportFolderLabel,
      listExportImages,
      resolveExportImage,
      releaseExportImage,
      releaseExportImages,
      refreshExportFolderLabel,
    };
  }

  window.MimirTalkPlatformRegistry.android = { isNativeShell, createAndroidAdapter };
})();
