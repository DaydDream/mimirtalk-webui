/*
 * web 适配层：请求现有 `/api/*` 后端。
 * 供桌面端 WebUI 与安卓端联调使用；static 适配层见 static.js。
 */
(function () {
  "use strict";

  const platform = window.MimirTalkPlatform;
  const { adapterError, browserDownload } = platform;

  function parseJsonText(text) {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function mapBackendCode(code, path) {
    const projectPath = path.startsWith("/api/projects");
    const uploadPath = path.startsWith("/api/uploads");
    if (code === "not_found") {
      if (projectPath) return "PROJECT_NOT_FOUND";
      if (uploadPath) return "UPLOAD_NOT_FOUND";
    }
    if (code === "invalid_request") {
      if (projectPath) return "INVALID_PROJECT";
      if (uploadPath) return "INVALID_IMAGE";
    }
    return code;
  }

  function normalizeHttpError(status, payload, path) {
    const error = payload?.error || {};
    const code = mapBackendCode(error.code || `HTTP_${status}`, path);
    const message = error.message || `HTTP ${status}：${path}`;
    const detail = error.details ?? error.detail ?? {};
    const normalized = adapterError(code, message, detail);
    normalized.status = status;
    return normalized;
  }

  function normalizeConversationContacts(payload) {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const previewItems = Array.isArray(payload?.preview_items) ? payload.preview_items : [];
    return {
      ...payload,
      items,
      total: Number.isInteger(payload?.total) ? payload.total : items.length,
      contact_ids: Array.isArray(payload?.contact_ids)
        ? payload.contact_ids
        : items.map((contact) => contact?.id).filter((id) => Number.isInteger(id)),
      preview_ids: Array.isArray(payload?.preview_ids)
        ? payload.preview_ids
        : previewItems.map((contact) => contact?.id).filter((id) => Number.isInteger(id)),
      preview_items: previewItems,
      preview_total: Number.isInteger(payload?.preview_total)
        ? payload.preview_total
        : previewItems.length,
      pinned_ids: Array.isArray(payload?.pinned_ids)
        ? payload.pinned_ids.filter((id) => Number.isInteger(id))
        : [],
    };
  }

  function createWebAdapter(baseUrl) {
    const root = String(baseUrl || "").replace(/\/+$/, "");

    async function fetchOrNetworkError(url, init, path) {
      try {
        return await fetch(url, init);
      } catch (error) {
        throw adapterError("NETWORK_ERROR", `请求失败：${path}`, {
          path,
          reason: error?.message || String(error),
        });
      }
    }

    // 业务层的低层入口：path 形如 `/projects`、`/assets?ids=...`，统一补 `/api`。
    async function request(path, options = {}) {
      const normalized = path.startsWith("/") ? path : `/${path}`;
      const url = `${root}/api${normalized}`;
      const init = {
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
        ...options,
      };
      const response = await fetchOrNetworkError(url, init, normalized);
      const text = await response.text();
      let payload = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = { message: text };
        }
      }
      if (!response.ok) {
        throw normalizeHttpError(response.status, payload, normalized);
      }
      return payload;
    }

    async function writeJson(path, method, body) {
      return request(path, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }

    return {
      kind: "web",

      capabilities() {
        return {
          offline: false,
          server: true,
          indexed_db: false,
          opfs: false,
          native_share: false,
          native_filesystem: false,
          streaming_export: false,
        };
      },

      async ready() {
        return true;
      },

      request,

      async listProjects() {
        const payload = await request("/projects");
        return payload.items || [];
      },

      async createProject({ id, title, contact_name } = {}) {
        return writeJson("/projects", "POST", { id, title, contact_name });
      },

      async getProject(id) {
        return request(`/projects/${encodeURIComponent(id)}`);
      },

      async saveProject(project) {
        return writeJson(`/projects/${encodeURIComponent(project.id)}`, "PUT", project);
      },

      async deleteProject(id) {
        return request(`/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
      },

      async importProject(input) {
        let project = input;
        if (typeof input === "string") {
          try {
            project = JSON.parse(input);
          } catch (error) {
            throw adapterError("INVALID_JSON", "项目 JSON 无法解析", { reason: error.message });
          }
        }
        return this.saveProject(project);
      },

      async exportProject(id) {
        return JSON.stringify(await this.getProject(id), null, 2);
      },

      async listContacts() {
        const payload = await request("/contacts");
        return payload.items || [];
      },

      async listConversationContacts() {
        return normalizeConversationContacts(await request("/conversation-contacts"));
      },

      async saveConversationContacts(payload) {
        return normalizeConversationContacts(await writeJson("/conversation-contacts", "PUT", payload));
      },

      async listStickerFavorites() {
        const payload = await request("/sticker-favorites");
        return Array.isArray(payload) ? payload : payload.items || [];
      },

      async saveStickerFavorites(records) {
        const payload = await writeJson("/sticker-favorites", "PUT", { items: records });
        return Array.isArray(payload) ? payload : payload.items || [];
      },

      async createGroup(payload) {
        return writeJson("/groups", "POST", payload);
      },

      async updateGroup(id, payload) {
        return writeJson(`/groups/${encodeURIComponent(id)}`, "PUT", payload);
      },

      async deleteGroup(id) {
        return writeJson(`/groups/${encodeURIComponent(id)}`, "DELETE", {});
      },

      async uploadImage({ file_name = "image", mime_type, bytes } = {}) {
        const path = "/uploads/images";
        const response = await fetchOrNetworkError(`${root}/api${path}`, {
          method: "POST",
          headers: {
            "Content-Type": mime_type,
            "X-File-Name": encodeURIComponent(file_name),
          },
          body: bytes,
        }, path);
        const text = await response.text();
        const payload = parseJsonText(text);
        if (!response.ok) {
          throw normalizeHttpError(response.status, payload, path);
        }
        return payload;
      },

      async getUpload(fileId) {
        const path = `/uploads/${encodeURIComponent(fileId)}`;
        const response = await fetchOrNetworkError(`${root}/api${path}`, undefined, path);
        if (!response.ok) {
          throw normalizeHttpError(response.status, parseJsonText(await response.text()), path);
        }
        return {
          bytes: await response.arrayBuffer(),
          content_type: response.headers.get("content-type") || "",
        };
      },

      async deleteUpload(fileId) {
        return request(`/uploads/${encodeURIComponent(fileId)}`, { method: "DELETE" });
      },

      resolveAssetUrl(assetId, variant = "file") {
        if (!assetId || !["file", "thumbnail"].includes(variant)) {
          throw adapterError("INVALID_ASSET", "素材地址参数非法", { assetId, variant });
        }
        const safeId = String(assetId).replace(/[^A-Za-z0-9_]+/g, "_");
        return `${root}/api/assets/${safeId}/${variant}`;
      },

      resolveUploadUrl(fileId) {
        if (!fileId) return "";
        return `${root}/api/uploads/${encodeURIComponent(fileId)}`;
      },

      async shutdown() {
        return request("/shutdown", { method: "POST", body: "{}" });
      },

      // 导出落盘：桌面端降级为浏览器下载（D19 不做系统分享、不接原生文件系统）。
      async saveExport(blob, { file_name = "export.png" } = {}) {
        browserDownload(blob, file_name);
        return { saved: true, via: "browser-download", file_name };
      },

      async nativeShare() {
        return {
          supported: false,
          reason: "web adapter does not implement Android native share",
        };
      },
    };
  }

  window.MimirTalkPlatformRegistry.web = { createWebAdapter };
})();
