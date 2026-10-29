/*
 * static 适配层：离线运行。
 * 只读数据来自打包的 static-data/*.json；项目、自建群、会话清单与上传图片
 * 写入 IndexedDB。业务层通过 request() 走与后端一致的 `/api/*` 语义。
 */
(function () {
  "use strict";

  const platform = window.MimirTalkPlatform;
  const { adapterError, browserDownload } = platform;

  const DB_NAME = "mimirtalk_static";
  const DB_VERSION = 1;
  const STORE_PROJECTS = "projects";
  const STORE_META = "meta";
  const STORE_UPLOADS = "uploads";

  const META_CONVERSATION = "conversation";
  const META_GROUPS = "groups";
  const META_STICKER_FAVORITES = "sticker_favorites";

  const DEFAULT_PROJECT_TITLE = "未命名项目";
  const DEFAULT_BACKGROUND_ASSET_ID = "backgrounds:texturebg_momotalk_momotalk_04:Momotalk_04";
  const ALLOWED_BACKGROUND_ASSET_IDS = new Set([
    "backgrounds:texturebg_momotalk_momotalk_03:Momotalk_03",
    DEFAULT_BACKGROUND_ASSET_ID,
  ]);
  const SIDED_MESSAGE_TYPES = new Set(["text", "sticker", "image"]);
  const STICKER_FAVORITE_SOURCES = new Set(["builtin", "upload"]);
  const MESSAGE_TYPES = new Set(["text", "sticker", "image", "system", "recall"]);
  const LEGACY_UNSUPPORTED_MESSAGE_TYPES = new Set(["choice", "moment"]);
  const IMAGE_FILE_ID = /^[0-9a-f]{32}\.(?:png|jpg|jpeg)$/;
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
  const IMAGE_SIGNATURES = new Map([
    ["image/png", { ext: ".png", signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
    ["image/jpeg", { ext: ".jpg", signature: [0xff, 0xd8, 0xff] }],
    ["image/jpg", { ext: ".jpg", signature: [0xff, 0xd8, 0xff] }],
  ]);

  const DATA_FILES = {
    contacts: "contacts.json",
    conversation: "conversation-contacts.json",
    groups: "groups.json",
    bubbleThemes: "bubble-themes.json",
    stickerCategories: "sticker-categories.json",
    characterProfiles: "character-profiles.json",
    assetIndex: "asset-index.json",
  };

  function deepClone(value) {
    return value === undefined ? value : JSON.parse(JSON.stringify(value));
  }

  function safeId(value) {
    return String(value).replace(/[/\\:]/g, "_");
  }

  function randomHex(bytes) {
    const view = new Uint8Array(bytes);
    crypto.getRandomValues(view);
    return Array.from(view, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function encodeSegments(path) {
    return String(path)
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
  }

  // ---- IndexedDB 基础封装 ----

  function createAdapter(options = {}) {
    const baseUrl = String(options.baseUrl || "").replace(/\/+$/, "") + "/";
    let dbPromise = null;
    let dataPromise = null;
    let readyPromise = null;
    // 静态数据加载完成后同步暴露一份引用，供 resolveAssetUrl 这类同步接口使用。
    let syncedData = null;
    const uploadUrlCache = new Map();

    function openDatabase() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) {
          reject(adapterError("INVALID_REQUEST", "当前环境不支持 IndexedDB"));
          return;
        }
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
            db.createObjectStore(STORE_PROJECTS, { keyPath: "id" });
          }
          if (!db.objectStoreNames.contains(STORE_META)) {
            db.createObjectStore(STORE_META, { keyPath: "key" });
          }
          if (!db.objectStoreNames.contains(STORE_UPLOADS)) {
            db.createObjectStore(STORE_UPLOADS, { keyPath: "file_id" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(
          adapterError("INVALID_REQUEST", "无法打开本地数据库", {
            reason: request.error?.message || String(request.error),
          }),
        );
      });
      return dbPromise;
    }

    function idbGet(storeName, key) {
      return openDatabase().then((db) => new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const request = tx.objectStore(storeName).get(key);
        request.onsuccess = () => resolve(request.result === undefined ? null : request.result);
        request.onerror = () => reject(request.error);
      }));
    }

    function idbGetAll(storeName) {
      return openDatabase().then((db) => new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const request = tx.objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      }));
    }

    function idbPut(storeName, value) {
      return openDatabase().then((db) => new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).put(value);
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }));
    }

    function idbDelete(storeName, key) {
      return openDatabase().then((db) => new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).delete(key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }));
    }

    // ---- 只读静态数据 ----

    function dataUrl(name) {
      return `${baseUrl}${name}`;
    }

    async function fetchJson(name) {
      try {
        const response = await fetch(dataUrl(name), { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (error) {
        throw adapterError("NETWORK_ERROR", `静态数据加载失败：${name}`, {
          name,
          reason: error?.message || String(error),
        });
      }
    }

    function loadStaticData() {
      if (dataPromise) return dataPromise;
      dataPromise = Promise.all([
        fetchJson(DATA_FILES.contacts),
        fetchJson(DATA_FILES.conversation),
        fetchJson(DATA_FILES.groups),
        fetchJson(DATA_FILES.bubbleThemes),
        fetchJson(DATA_FILES.stickerCategories),
        fetchJson(DATA_FILES.characterProfiles),
        fetchJson(DATA_FILES.assetIndex),
      ]).then(([contacts, conversation, groups, bubbleThemes, stickerCategories, characterProfiles, assetIndex]) => {
        const assetsById = new Map();
        const assetsBySafeId = new Map();
        for (const asset of assetIndex.assets || []) {
          assetsById.set(asset.id, asset);
          assetsBySafeId.set(safeId(asset.id), asset);
        }
        syncedData = {
          contacts: Array.isArray(contacts) ? contacts : [],
          conversation,
          groups,
          bubbleThemes,
          stickerCategories,
          characterProfiles,
          assetIndex,
          assetsById,
          assetsBySafeId,
        };
        return syncedData;
      });
      return dataPromise;
    }

    // ---- 素材地址 ----

    function assetStaticUrl(asset) {
      const path = String(asset?.path || "");
      if (path.startsWith("webui/assets/")) {
        return `/static-assets/${encodeSegments(path.slice("webui/assets/".length))}`;
      }
      if (path.startsWith("assets_source/")) {
        return `/static-source/${encodeSegments(path.slice("assets_source/".length))}`;
      }
      if (path.startsWith("webui/")) {
        return `/static-root/${encodeSegments(path.slice("webui/".length))}`;
      }
      return `/static-root/${encodeSegments(path)}`;
    }

    function publicAsset(asset) {
      const url = assetStaticUrl(asset);
      return {
        ...asset,
        url_id: safeId(asset.id),
        url,
        file_url: url,
        // 静态模式暂不预生成缩略图，回退为原图；后续可接 Canvas 生成。
        thumbnail_url: url,
      };
    }

    function resolveAssetUrl(assetId, variant = "file") {
      if (!assetId || !["file", "thumbnail"].includes(variant)) {
        throw adapterError("INVALID_ASSET", "素材地址参数非法", { assetId, variant });
      }
      if (!syncedData) {
        throw adapterError("INVALID_ASSET", "静态数据尚未加载，无法解析素材地址", { assetId, variant });
      }
      return resolveAssetUrlSync(assetId, variant, syncedData);
    }

    function resolveAssetUrlSync(assetId, variant, data) {
      const asset = data
        ? (data.assetsById.get(assetId) || data.assetsBySafeId.get(safeId(assetId)))
        : null;
      if (!asset) {
        throw adapterError("INVALID_ASSET", "素材不存在", { assetId, variant });
      }
      return assetStaticUrl(asset);
    }

    function resolveUploadUrl(fileId) {
      if (!fileId) return "";
      return uploadUrlCache.get(fileId) || "";
    }

    async function cacheUploadUrl(record) {
      if (!record || uploadUrlCache.has(record.file_id)) return uploadUrlCache.get(record.file_id);
      const blob = record.blob instanceof Blob
        ? record.blob
        : new Blob([record.bytes || new Uint8Array()], { type: record.content_type || "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      uploadUrlCache.set(record.file_id, url);
      return url;
    }

    // ---- 群组叠加层 ----

    async function loadGroupsState(data) {
      const stored = await idbGet(STORE_META, META_GROUPS);
      if (stored) return stored;
      return {
        key: META_GROUPS,
        custom: [],
        deleted_builtin: [],
        name_overrides: {},
        member_overrides: {},
        next_id: Number(data.groups?.id_start) || 9200,
      };
    }

    function normalizeGroup(group) {
      return {
        id: Number(group.id),
        name: String(group.name),
        display_name: String(group.display_name || group.name),
        kind: "group",
        member_ids: Array.isArray(group.member_ids) ? group.member_ids.slice() : [],
        asset_id: group.asset_id ?? null,
        custom: Boolean(group.custom),
      };
    }

    function publicContact(contact) {
      return {
        id: contact.id,
        name: contact.name,
        kind: contact.kind || "hero",
        game_icon_path: contact.game_icon_path || "",
        asset_id: contact.asset_id ?? null,
        asset_category: contact.asset_category ?? null,
        member_ids: Array.isArray(contact.member_ids) ? contact.member_ids.slice() : [],
        custom: Boolean(contact.custom),
        enabled: true,
      };
    }

    async function buildContacts(data) {
      const state = await loadGroupsState(data);
      const builtinMembers = data.groups?.builtin_members || {};
      const deleted = new Set(state.deleted_builtin.map(String));
      const items = [];
      for (const contact of data.contacts) {
        if (contact.enabled === false) continue;
        const id = contact.id;
        const kind = contact.kind || "hero";
        if (kind === "group") {
          if (deleted.has(String(id))) continue;
          const override = state.member_overrides[String(id)];
          items.push(publicContact({
            ...contact,
            name: state.name_overrides[String(id)] || contact.name,
            member_ids: Array.isArray(override) ? override : (builtinMembers[String(id)] || []),
          }));
        } else {
          items.push(publicContact(contact));
        }
      }
      for (const group of state.custom) {
        items.push(publicContact(normalizeGroup(group)));
      }
      return items;
    }

    function heroIds(data) {
      const ids = new Set();
      for (const contact of data.contacts) {
        if ((contact.kind || "hero") !== "group") ids.add(contact.id);
      }
      return ids;
    }

    function validateGroupMembers(data, memberIds) {
      if (!Array.isArray(memberIds) || memberIds.length < 2) {
        throw adapterError("INVALID_GROUP", "群聊至少需要两个成员", { member_ids: memberIds });
      }
      const heroes = heroIds(data);
      const normalized = memberIds.map(Number);
      const missing = normalized.filter((id) => !Number.isInteger(id) || !heroes.has(id));
      if (missing.length) {
        throw adapterError("INVALID_GROUP", "群成员不存在", { missing });
      }
      return normalized;
    }

    async function findGroup(data, id) {
      const numericId = Number(id);
      const state = await loadGroupsState(data);
      if (state.custom.some((group) => Number(group.id) === numericId)) {
        return { numericId, state, builtin: false };
      }
      const builtin = (data.contacts || []).some(
        (contact) => Number(contact.id) === numericId && (contact.kind || "hero") === "group",
      );
      if (builtin && !state.deleted_builtin.map(String).includes(String(numericId))) {
        return { numericId, state, builtin: true };
      }
      return null;
    }

    // ---- 项目规范化 ----

    function normalizeProject(raw, projectId = null) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw adapterError("INVALID_PROJECT", "项目数据必须是对象");
      }
      const version = raw.version ?? 1;
      if (Number(version) !== 1) {
        throw adapterError("INVALID_PROJECT", "项目版本不支持", { version });
      }
      const project = deepClone(raw);
      project.version = 1;
      project.id = project.id || projectId;
      if (!project.id) throw adapterError("INVALID_PROJECT", "项目缺少 id");
      project.title = project.title || DEFAULT_PROJECT_TITLE;
      if (project.title === "未命名会话") project.title = DEFAULT_PROJECT_TITLE;
      project.contact = project.contact && typeof project.contact === "object" ? project.contact : {};
      project.contact.name = project.contact.name || "角色名";
      project.contact.avatar_asset_id = project.contact.avatar_asset_id ?? null;
      project.contact.signature = project.contact.signature || "";
      project.contact.contact_id = project.contact.contact_id ?? null;
      project.contact.kind = project.contact.kind || "hero";
      project.contact.member_ids = Array.isArray(project.contact.member_ids)
        ? project.contact.member_ids.slice()
        : [];
      project.appearance = project.appearance && typeof project.appearance === "object"
        ? project.appearance
        : {};
      project.appearance.background_asset_id =
        ALLOWED_BACKGROUND_ASSET_IDS.has(project.appearance.background_asset_id)
          ? project.appearance.background_asset_id
          : DEFAULT_BACKGROUND_ASSET_ID;
      project.appearance.admin_avatar_asset_id = project.appearance.admin_avatar_asset_id ?? null;
      project.appearance.read = project.appearance.read !== false;

      const messageIds = new Set();
      const rawMessages = Array.isArray(project.messages) ? project.messages : [];
      project.messages = rawMessages
        .filter((message) => !LEGACY_UNSUPPORTED_MESSAGE_TYPES.has(message?.type))
        .map((message, index) => {
          if (!message || typeof message !== "object") {
            throw adapterError("INVALID_PROJECT", `messages[${index}] 必须是对象`);
          }
          const normalized = deepClone(message);
          const type = normalized.type || "text";
          if (!MESSAGE_TYPES.has(type) && !LEGACY_UNSUPPORTED_MESSAGE_TYPES.has(type)) {
            throw adapterError("INVALID_PROJECT", `消息类型不支持: ${type}`);
          }
          normalized.id = normalized.id || `msg_${randomHex(6)}`;
          if (messageIds.has(normalized.id)) {
            throw adapterError("INVALID_PROJECT", `消息 id 重复: ${normalized.id}`);
          }
          messageIds.add(normalized.id);
          normalized.type = type;
          delete normalized.delay;
          delete normalized.delay_ms;
          if (SIDED_MESSAGE_TYPES.has(type)) {
            const side = normalized.side || "left";
            if (!["left", "right"].includes(side)) {
              throw adapterError("INVALID_PROJECT", `messages[${index}].side 非法`);
            }
            normalized.side = side;
          } else {
            normalized.side = "center";
          }
          if (type === "text") {
            normalized.text = typeof normalized.text === "string" ? normalized.text : "";
          } else if (type === "sticker") {
            normalized.asset_id = normalized.asset_id || normalized.asset;
            if (!normalized.asset_id) throw adapterError("INVALID_PROJECT", "贴纸缺少 asset_id");
            delete normalized.asset;
          } else if (type === "image") {
            if (!IMAGE_FILE_ID.test(normalized.file_id || "")) {
              throw adapterError("INVALID_PROJECT", "图片 file_id 非法");
            }
            if (!Number.isInteger(normalized.width) || normalized.width <= 0) {
              throw adapterError("INVALID_PROJECT", "图片 width 非法");
            }
            if (!Number.isInteger(normalized.height) || normalized.height <= 0) {
              throw adapterError("INVALID_PROJECT", "图片 height 非法");
            }
          } else {
            normalized.text = typeof normalized.text === "string" ? normalized.text : "";
          }
          return normalized;
        })
        .filter((message) => !(message.type === "text" && !message.text.trim()));

      const conversationKey = String(
        project.contact.contact_id ?? `${project.contact.kind}:${project.contact.name}`,
      );
      project.conversations = project.conversations && typeof project.conversations === "object"
        ? project.conversations
        : {};
      project.active_conversation_id = project.active_conversation_id || conversationKey;
      project.conversations[project.active_conversation_id] = project.messages;
      project.messages = project.conversations[project.active_conversation_id];
      return project;
    }

    // ---- 项目仓库 ----

    async function findProject(id) {
      const project = await idbGet(STORE_PROJECTS, id);
      if (!project) throw adapterError("PROJECT_NOT_FOUND", "项目不存在", { id });
      return project;
    }

    async function saveProject(project) {
      const normalized = normalizeProject(project);
      await idbPut(STORE_PROJECTS, normalized);
      return deepClone(normalized);
    }

    // ---- 会话清单 ----

    async function conversationState(data) {
      const stored = await idbGet(STORE_META, META_CONVERSATION);
      if (stored) return stored;
      return {
        key: META_CONVERSATION,
        contact_ids: Array.isArray(data.conversation?.contact_ids) ? data.conversation.contact_ids : [],
        preview_ids: Array.isArray(data.conversation?.preview_ids) ? data.conversation.preview_ids : [],
        pinned_ids: Array.isArray(data.conversation?.pinned_ids) ? data.conversation.pinned_ids : [],
      };
    }

    async function listConversationContacts(data) {
      const contacts = await buildContacts(data);
      const byId = new Map(contacts.map((contact) => [String(contact.id), contact]));
      const state = await conversationState(data);
      const items = state.contact_ids.map((id) => byId.get(String(id))).filter(Boolean);
      const previewItems = state.preview_ids.map((id) => byId.get(String(id))).filter(Boolean);
      const previewIds = previewItems.map((contact) => contact.id);
      const previewSet = new Set(previewIds.map(String));
      const pinnedIds = state.pinned_ids
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && byId.has(String(id)) && previewSet.has(String(id)));
      return {
        version: 3,
        items,
        total: items.length,
        preview_ids: previewIds,
        preview_items: previewItems,
        preview_total: previewItems.length,
        pinned_ids: pinnedIds,
      };
    }

    async function saveConversationContacts(data, payload) {
      if (
        !payload ||
        typeof payload !== "object" ||
        (!payload.contact_ids && !payload.preview_ids && !payload.pinned_ids)
      ) {
        throw adapterError("INVALID_REQUEST", "缺少联系人、预览或置顶清单");
      }
      const contacts = await buildContacts(data);
      const known = new Set(contacts.map((contact) => String(contact.id)));
      const state = await conversationState(data);
      const validate = (ids, label) => {
        if (!Array.isArray(ids)) throw adapterError("INVALID_REQUEST", `${label} 必须是数组`);
        const normalized = ids.map(Number);
        const missing = normalized.filter((id) => !Number.isInteger(id) || !known.has(String(id)));
        if (missing.length) {
          throw adapterError("INVALID_REQUEST", `${label} 包含未知联系人`, { missing });
        }
        return normalized;
      };
      if (payload.contact_ids) state.contact_ids = validate(payload.contact_ids, "contact_ids");
      if (payload.preview_ids) state.preview_ids = validate(payload.preview_ids, "preview_ids");
      if (payload.pinned_ids) state.pinned_ids = validate(payload.pinned_ids, "pinned_ids");
      // 置顶项必须属于会话列表：随 preview_ids 收缩时同步裁剪。
      const previewSet = new Set((state.preview_ids || []).map(String));
      state.pinned_ids = (state.pinned_ids || []).filter((id) => previewSet.has(String(id)));
      state.key = META_CONVERSATION;
      await idbPut(STORE_META, state);
      return listConversationContacts(data);
    }

    // ---- 表情收藏（storage.v1.md 的 sticker_favorites 仓库） ----

    function normalizeStickerFavorite(record, fallbackOrder) {
      if (!record || typeof record !== "object" || Array.isArray(record)) {
        throw adapterError("INVALID_REQUEST", "收藏记录必须是对象");
      }
      const source = record.source;
      if (!STICKER_FAVORITE_SOURCES.has(source)) {
        throw adapterError("INVALID_REQUEST", "收藏来源必须是 builtin 或 upload", { source });
      }
      const rawAssetId = record.asset_id;
      const assetId = rawAssetId === undefined || rawAssetId === null ? "" : rawAssetId;
      if (typeof assetId !== "string") {
        throw adapterError("INVALID_REQUEST", "收藏 asset_id 必须是字符串");
      }
      const fileId = record.file_id;
      if (source === "upload") {
        if (typeof fileId !== "string" || !fileId) {
          throw adapterError("INVALID_REQUEST", "upload 收藏必须带 file_id");
        }
      } else if (!assetId) {
        throw adapterError("INVALID_REQUEST", "builtin 收藏必须带 asset_id");
      }
      const rawOrder = record.sort_order;
      const sortOrder = typeof rawOrder === "number" && Number.isFinite(rawOrder)
        ? Math.trunc(rawOrder)
        : fallbackOrder;
      const createdAt = typeof record.created_at === "string" && record.created_at.trim()
        ? record.created_at
        : new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
      const normalized = {
        asset_id: assetId,
        source,
        sort_order: sortOrder,
        created_at: createdAt,
      };
      if (source === "upload") normalized.file_id = fileId;
      return normalized;
    }

    function stickerFavoriteKey(record) {
      const identity = record.source === "upload" ? record.file_id : record.asset_id;
      return `${record.source}\u0000${identity}`;
    }

    function dedupeStickerFavorites(records) {
      // Map 保序 + Array.sort 稳定：同一逻辑键后者覆盖前者，再按 sort_order 排序。
      const byKey = new Map();
      records.forEach((record) => byKey.set(stickerFavoriteKey(record), record));
      return Array.from(byKey.values()).sort((left, right) => left.sort_order - right.sort_order);
    }

    async function listStickerFavorites() {
      const stored = await idbGet(STORE_META, META_STICKER_FAVORITES);
      const storedItems = stored && Array.isArray(stored.items) ? stored.items : [];
      const records = storedItems.map((item, index) => normalizeStickerFavorite(item, index));
      const items = dedupeStickerFavorites(records);
      return { items, total: items.length };
    }

    async function saveStickerFavorites(payload) {
      const raw = Array.isArray(payload)
        ? payload
        : payload && Array.isArray(payload.items)
          ? payload.items
          : null;
      if (!raw) {
        throw adapterError("INVALID_REQUEST", "收藏请求体必须是数组或含 items 数组的对象");
      }
      const records = dedupeStickerFavorites(
        raw.map((item, index) => normalizeStickerFavorite(item, index)),
      );
      await idbPut(STORE_META, { key: META_STICKER_FAVORITES, items: records });
      return { items: records, total: records.length };
    }

    // ---- 素材查询 ----

    function listAssets(data, params) {
      const category = params.get("category") || "";
      const query = params.get("q") || "";
      const role = params.get("role") || "";
      const assetIds = (params.get("ids") || "").split(",").map((value) => value.trim()).filter(Boolean);
      const offset = Math.max(0, Number(params.get("offset")) || 0);
      const limit = Math.min(Math.max(1, Number(params.get("limit")) || 200), 1000);
      let items = data.assetIndex.assets || [];
      if (assetIds.length) {
        const wanted = new Set(assetIds);
        items = items.filter((item) => wanted.has(item.id));
      } else if (role === "avatar") {
        items = data.assetIndex.avatars || [];
      } else if (role === "background") {
        items = data.assetIndex.backgrounds || [];
      } else if (role === "sticker") {
        items = data.assetIndex.stickers || [];
      }
      if (category) items = items.filter((item) => item.category === category);
      if (query) {
        const needle = query.casefold ? query.casefold() : query.toLowerCase();
        items = items.filter((item) => (
          (item.id || "").toLowerCase().includes(needle)
          || (item.name || "").toLowerCase().includes(needle)
          || (item.asset_key || "").toLowerCase().includes(needle)
        ));
      }
      const total = items.length;
      const page = items.slice(offset, offset + limit);
      return {
        total,
        offset,
        limit,
        count: page.length,
        items: page.map(publicAsset),
        categories: data.assetIndex.categories || {},
      };
    }

    function findAsset(data, assetId) {
      return data.assetsById.get(assetId) || data.assetsBySafeId.get(safeId(assetId)) || null;
    }

    function publicStickerCategory(data, category) {
      const payload = {
        id: String(category.id),
        category_id: category.category_id,
        official_icon: category.official_icon || "",
        record_count: category.record_count || 0,
        available_count: category.available_count || 0,
        missing_count: category.missing_count || 0,
        disabled: Boolean(category.disabled),
      };
      const icon = findAsset(data, category.icon_asset_id);
      if (icon) payload.icon = publicAsset(icon);
      return payload;
    }

    function rewriteBubbleThemes(data, payload) {
      const themes = (payload.themes || []).map((theme) => {
        const copy = deepClone(theme);
        for (const side of ["left", "right"]) {
          const variant = copy.variants && copy.variants[side];
          if (variant && variant.asset_id) {
            const asset = findAsset(data, variant.asset_id);
            if (asset) variant.url = assetStaticUrl(asset);
          }
        }
        return copy;
      });
      return {
        default_theme: payload.default_theme || "",
        count: payload.count ?? themes.length,
        slice_rule: payload.slice_rule || "",
        themes,
      };
    }

    // ---- 上传 ----

    async function toUint8(blobOrBytes) {
      if (blobOrBytes instanceof Blob) return new Uint8Array(await blobOrBytes.arrayBuffer());
      if (blobOrBytes instanceof ArrayBuffer) return new Uint8Array(blobOrBytes);
      if (ArrayBuffer.isView(blobOrBytes)) {
        return new Uint8Array(blobOrBytes.buffer, blobOrBytes.byteOffset, blobOrBytes.byteLength);
      }
      return new Uint8Array(blobOrBytes || []);
    }

    async function uploadImage({ file_name = "image", mime_type, bytes } = {}) {
      const type = String(mime_type || "").split(";")[0].trim().toLowerCase();
      const imageType = IMAGE_SIGNATURES.get(type);
      if (!imageType) {
        throw adapterError("UNSUPPORTED_IMAGE", "仅支持 PNG、JPG、JPEG 静态图片", { mime_type });
      }
      const data = await toUint8(bytes);
      if (!data.length) throw adapterError("INVALID_IMAGE", "图片文件不能为空");
      if (data.length > MAX_IMAGE_BYTES) {
        throw adapterError("UPLOAD_TOO_LARGE", "图片不能超过 8 MiB", { size: data.length });
      }
      for (let index = 0; index < imageType.signature.length; index += 1) {
        if (data[index] !== imageType.signature[index]) {
          throw adapterError("INVALID_IMAGE", "图片内容与文件格式不匹配");
        }
      }
      const contentType = type === "image/jpg" ? "image/jpeg" : type;
      const fileId = `${randomHex(16)}${imageType.ext}`;
      const name = String(file_name || "image").slice(0, 120);
      const blob = new Blob([data], { type: contentType });
      const record = { file_id: fileId, name, content_type: contentType, blob };
      await idbPut(STORE_UPLOADS, record);
      await cacheUploadUrl(record);
      return { file_id: fileId, name, url: `/static-uploads/${fileId}`, content_type: contentType, size: data.length };
    }

    async function getUploadRecord(fileId) {
      const record = await idbGet(STORE_UPLOADS, fileId);
      if (!record) throw adapterError("UPLOAD_NOT_FOUND", "上传文件不存在", { file_id: fileId });
      return record;
    }

    // ---- 启动预热 ----

    function ready() {
      if (readyPromise) return readyPromise;
      readyPromise = (async () => {
        const data = await loadStaticData();
        const uploads = await idbGetAll(STORE_UPLOADS);
        for (const record of uploads) {
          // eslint-disable-next-line no-await-in-loop
          await cacheUploadUrl(record);
        }
        await loadGroupsState(data);
        return true;
      })();
      return readyPromise;
    }

    // ---- REST 路由（供业务层 request 使用） ----

    function parseBody(body) {
      if (body === undefined || body === null || body === "") return {};
      if (typeof body === "string") {
        try {
          return JSON.parse(body);
        } catch (error) {
          throw adapterError("INVALID_JSON", "请求体不是合法 JSON", { reason: error.message });
        }
      }
      return body;
    }

    async function route(method, pathname, params, body) {
      const data = syncedData || (await loadStaticData());

      if (pathname === "/api/contacts" && method === "GET") {
        const items = await buildContacts(data);
        return { items, total: items.length };
      }

      if (pathname === "/api/conversation-contacts") {
        if (method === "GET") return listConversationContacts(data);
        if (method === "PUT") return saveConversationContacts(data, parseBody(body));
      }

      if (pathname === "/api/bubble-themes" && method === "GET") {
        return rewriteBubbleThemes(data, data.bubbleThemes);
      }

      if (pathname === "/api/character-profiles" && method === "GET") {
        const profiles = Array.isArray(data.characterProfiles?.profiles)
          ? data.characterProfiles.profiles
          : [];
        return { items: profiles, total: profiles.length };
      }

      if (pathname === "/api/sticker-categories" && method === "GET") {
        const categories = (data.stickerCategories.categories || [])
          .map((category) => publicStickerCategory(data, category));
        return {
          total: categories.length,
          selectable_total: categories.filter((item) => !item.disabled).length,
          missing_count: data.stickerCategories.missing_count || 0,
          items: categories,
        };
      }

      const stickerMatch = pathname.match(/^\/api\/sticker-categories\/([^/]+)\/stickers$/);
      if (stickerMatch && method === "GET") {
        const categoryId = decodeURIComponent(stickerMatch[1]);
        const category = (data.stickerCategories.categories || [])
          .find((item) => String(item.id) === categoryId);
        if (!category) {
          throw adapterError("INVALID_REQUEST", `贴纸分类不存在：${categoryId}`, { category_id: categoryId });
        }
        const allIds = category.sticker_asset_ids || [];
        const offset = Math.max(0, Number(params.get("offset")) || 0);
        const limit = Math.min(Math.max(1, Number(params.get("limit")) || 24), 60);
        const items = allIds
          .slice(offset, offset + limit)
          .map((assetId) => findAsset(data, assetId))
          .filter(Boolean)
          .map(publicAsset);
        return {
          category: publicStickerCategory(data, category),
          total: allIds.length,
          offset,
          limit,
          count: items.length,
          items,
        };
      }

      if (pathname === "/api/assets" && method === "GET") {
        return listAssets(data, params);
      }

      if (pathname === "/api/sticker-favorites") {
        if (method === "GET") return listStickerFavorites();
        if (method === "PUT") return saveStickerFavorites(parseBody(body));
      }

      const assetMatch = pathname.match(/^\/api\/assets\/([^/]+)\/(file|thumbnail|detail)$/);
      if (assetMatch && method === "GET") {
        const asset = findAsset(data, decodeURIComponent(assetMatch[1]));
        if (!asset) throw adapterError("INVALID_ASSET", "素材不存在", { asset_id: assetMatch[1] });
        return publicAsset(asset);
      }

      if (pathname === "/api/projects") {
        if (method === "GET") {
          const records = await idbGetAll(STORE_PROJECTS);
          const contacts = await buildContacts(data);
          const groupsById = new Map(
            contacts.filter((contact) => contact.kind === "group").map((contact) => [String(contact.id), contact]),
          );
          const items = records
            .sort((left, right) => String(left.id).localeCompare(String(right.id)))
            .map((project) => {
              let contactName = project.contact?.name || "";
              if (project.contact?.kind === "group") {
                const live = groupsById.get(String(project.contact.contact_id));
                if (live) contactName = live.name;
              }
              return {
                id: project.id,
                title: project.title,
                contact_name: contactName,
                contact_id: project.contact?.contact_id ?? null,
                contact_kind: project.contact?.kind || "hero",
              };
            });
          return { items };
        }
        if (method === "POST") {
          const payload = parseBody(body);
          const normalized = normalizeProject({
            version: 1,
            id: payload.id,
            title: payload.title || DEFAULT_PROJECT_TITLE,
            contact: { name: payload.contact_name || "角色名" },
            appearance: { background_asset_id: DEFAULT_BACKGROUND_ASSET_ID, admin_avatar_asset_id: null, read: true },
            messages: [],
          }, payload.id || `project_${randomHex(6)}`);
          await idbPut(STORE_PROJECTS, normalized);
          return deepClone(normalized);
        }
      }

      const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
      if (projectMatch) {
        const projectId = decodeURIComponent(projectMatch[1]);
        if (method === "GET") return findProject(projectId);
        if (method === "PUT") {
          const payload = parseBody(body);
          if (payload.id && payload.id !== projectId) {
            throw adapterError("INVALID_PROJECT", "项目 id 与路径不一致", { id: payload.id });
          }
          payload.id = projectId;
          return saveProject(payload);
        }
        if (method === "DELETE") {
          await findProject(projectId);
          await idbDelete(STORE_PROJECTS, projectId);
          return { id: projectId, deleted: true };
        }
      }

      if (pathname === "/api/groups" && method === "POST") {
        const payload = parseBody(body);
        const memberIds = validateGroupMembers(data, payload.member_ids);
        const state = await loadGroupsState(data);
        const id = Math.max(Number(state.next_id) || 9200, 9200);
        state.next_id = id + 1;
        const group = normalizeGroup({ id, name: payload.name || "新建群聊", member_ids: memberIds, asset_id: null, custom: true });
        state.custom.push(group);
        state.key = META_GROUPS;
        await idbPut(STORE_META, state);
        return deepClone(group);
      }

      const groupMatch = pathname.match(/^\/api\/groups\/([^/]+)$/);
      if (groupMatch) {
        const found = await findGroup(data, decodeURIComponent(groupMatch[1]));
        if (!found) {
          throw adapterError("GROUP_NOT_FOUND", "群聊不存在", { id: groupMatch[1] });
        }
        const { numericId, state, builtin } = found;
        if (method === "PUT") {
          const payload = parseBody(body);
          const memberIds = validateGroupMembers(data, payload.member_ids);
          if (builtin) {
            state.member_overrides[String(numericId)] = memberIds;
            if (payload.name) state.name_overrides[String(numericId)] = payload.name;
          } else {
            const index = state.custom.findIndex((group) => Number(group.id) === numericId);
            const current = state.custom[index];
            state.custom[index] = normalizeGroup({
              ...current,
              name: payload.name || current.name,
              member_ids: memberIds,
              custom: true,
            });
          }
          state.key = META_GROUPS;
          await idbPut(STORE_META, state);
          const contacts = await buildContacts(data);
          return contacts.find((contact) => Number(contact.id) === numericId) || { id: numericId };
        }
        if (method === "DELETE") {
          if (builtin) {
            if (!state.deleted_builtin.map(String).includes(String(numericId))) {
              state.deleted_builtin.push(numericId);
            }
          } else {
            state.custom = state.custom.filter((group) => Number(group.id) !== numericId);
          }
          state.key = META_GROUPS;
          await idbPut(STORE_META, state);
          return { id: numericId, deleted: true };
        }
      }

      if (pathname === "/api/uploads/images" && method === "POST") {
        return uploadImage(parseBody(body));
      }

      const uploadMatch = pathname.match(/^\/api\/uploads\/([^/]+)$/);
      if (uploadMatch && method === "DELETE") {
        const fileId = decodeURIComponent(uploadMatch[1]);
        const record = await getUploadRecord(fileId);
        const cached = uploadUrlCache.get(fileId);
        if (cached) URL.revokeObjectURL(cached);
        uploadUrlCache.delete(fileId);
        await idbDelete(STORE_UPLOADS, record.file_id);
        return { file_id: fileId, deleted: true };
      }

      if (pathname === "/api/shutdown" && method === "POST") {
        return { status: "noop" };
      }

      throw adapterError("INVALID_REQUEST", `静态模式不支持该请求：${method} ${pathname}`);
    }

    async function request(path, options = {}) {
      const method = String(options.method || "GET").toUpperCase();
      const raw = path.startsWith("/") ? path : `/${path}`;
      let [pathname, search = ""] = raw.split("?", 2);
      // 业务层沿用与后端一致的语义：path 形如 `/contacts`、`/projects/:id`。
      // 这里统一补 `/api` 前缀，与 web 适配层的补全规则保持一致。
      if (pathname !== "/api" && !pathname.startsWith("/api/")) {
        pathname = `/api${pathname}`;
      }
      const params = new URLSearchParams(search);
      return route(method, pathname, params, options.body);
    }

    return {
      kind: "static",

      capabilities() {
        return {
          offline: true,
          server: false,
          indexed_db: true,
          opfs: false,
          native_share: false,
          native_filesystem: false,
          streaming_export: false,
        };
      },

      ready,
      request,

      async listProjects() {
        return (await request("/projects")).items;
      },
      async createProject(payload = {}) {
        return request("/projects", { method: "POST", body: JSON.stringify(payload) });
      },
      async getProject(id) {
        return request(`/projects/${encodeURIComponent(id)}`);
      },
      async saveProject(project) {
        return request(`/projects/${encodeURIComponent(project.id)}`, {
          method: "PUT",
          body: JSON.stringify(project),
        });
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
        return (await request("/contacts")).items;
      },
      async listConversationContacts() {
        return request("/conversation-contacts");
      },
      async saveConversationContacts(payload) {
        return request("/conversation-contacts", { method: "PUT", body: JSON.stringify(payload) });
      },
      async listStickerFavorites() {
        const payload = await request("/sticker-favorites");
        return Array.isArray(payload) ? payload : payload.items;
      },
      async saveStickerFavorites(records) {
        const payload = await request("/sticker-favorites", {
          method: "PUT",
          body: JSON.stringify({ items: records }),
        });
        return Array.isArray(payload) ? payload : payload.items;
      },
      async createGroup(payload) {
        return request("/groups", { method: "POST", body: JSON.stringify(payload) });
      },
      async updateGroup(id, payload) {
        return request(`/groups/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(payload) });
      },
      async deleteGroup(id) {
        return request(`/groups/${encodeURIComponent(id)}`, { method: "DELETE" });
      },
      uploadImage,
      async getUpload(fileId) {
        const record = await getUploadRecord(fileId);
        return { bytes: record.blob, content_type: record.content_type };
      },
      async deleteUpload(fileId) {
        return request(`/uploads/${encodeURIComponent(fileId)}`, { method: "DELETE" });
      },
      resolveAssetUrl,
      resolveUploadUrl,
      async shutdown() {
        return { status: "noop" };
      },
      // 导出落盘：离线桌面端降级为浏览器下载；安卓 WebView 由 android.js 覆盖。
      async saveExport(blob, { file_name = "export.png" } = {}) {
        browserDownload(blob, file_name);
        return { saved: true, via: "browser-download", file_name };
      },
      async nativeShare() {
        return { supported: false, reason: "static adapter does not implement native share" };
      },
    };
  }

  window.MimirTalkPlatformRegistry.static = { createStaticAdapter: createAdapter };
})();
