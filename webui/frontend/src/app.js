/*
 * MimirTalk WebUI 前端主脚本。
 * 负责状态管理、联系人编辑、项目读写、聊天预览、消息编辑和 PNG 长图导出。
 */
const API = "/api";
const LAST_PROJECT_KEY = "mimirtalk_webui.last_project_id";
const PNG_EXPORT_SCALE = 2;
const PNG_EXPORT_MAX_HEIGHT = 30000;
const PNG_EXPORT_MESSAGE_LIMIT = 20;
const BUBBLE_TEXT_PADDING_X = 14;
const MOMO_SANS_FONT_FAMILY = '"MomoTalk Sans", "Microsoft YaHei", sans-serif';
const MOMO_SERIF_FONT_FAMILY = '"MomoTalk Serif", "Microsoft YaHei", serif';
const MOMO_SPEAKER_FONT_SIZE = 20;
const MOMO_MESSAGE_FONT_SIZE = 22;
const MOMO_MESSAGE_LINE_HEIGHT = 32;
const MOMO_SPEAKER_LABEL_HEIGHT = 30;
const AVATAR_FRAME_INSET_RATIO = 10 / 108;
const AVATAR_FRAME_CORNER_RADIUS_RATIO = 6 / 108;
const ADMIN_SPEAKER_ID = "__admin__";
const MIN_GROUP_MEMBERS = 2;
const GROUP_MEMBER_PAGE_SIZE = 8;
const MAX_STATIC_IMAGE_BYTES = 8 * 1024 * 1024;
const STATIC_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg"]);
const ADMIN_AVATAR_ASSET_IDS = [
  "momotalk_images:textureconfig_momotalk_momotalk_head_01:Momotalk_head_01",
  "momotalk_images:textureconfig_momotalk_momotalk_head_02:Momotalk_head_02",
  "momotalk_images:textureconfig_momotalk_momotalk_head_03:Momotalk_head_03",
  "momotalk_images:textureconfig_momotalk_momotalk_head_04:Momotalk_head_04",
  "momotalk_images:textureconfig_momotalk_momotalk_head_05:Momotalk_head_05",
  "momotalk_images:textureconfig_momotalk_momotalk_head_06:Momotalk_head_06",
  "momotalk_images:textureconfig_momotalk_momotalk_head_07:Momotalk_head_07",
];
const DEFAULT_ADMIN_AVATAR_ASSET_ID = ADMIN_AVATAR_ASSET_IDS[0];
const DEFAULT_STICKER_ASSET_ID =
  "chat_stickers:textureconfig_chat_chatsticker_icon_face_add:icon_face_add";
const DEFAULT_CHAT_BACKGROUND_ASSET_ID =
  "backgrounds:texturebg_momotalk_momotalk_04:Momotalk_04";
const DEFAULT_CHAT_BACKGROUND_URL =
  "/api/assets/backgrounds_texturebg_momotalk_momotalk_04_Momotalk_04/file";
const DEFAULT_CHAT_BACKGROUND_ASSET = Object.freeze({
  id: DEFAULT_CHAT_BACKGROUND_ASSET_ID,
  label: "Momotalk_04",
  thumbnail_url: DEFAULT_CHAT_BACKGROUND_URL,
  file_url: DEFAULT_CHAT_BACKGROUND_URL,
});
const CHAT_BACKGROUND_ASSET_IDS = new Set([
  "backgrounds:texturebg_momotalk_momotalk_03:Momotalk_03",
  DEFAULT_CHAT_BACKGROUND_ASSET_ID,
]);
const EXPORT_ASSET_URLS = {
  bubbleLeft: "/api/assets/misc_textureconfig_chatbubble_9000_9000/file",
  bubbleRight: "/api/assets/misc_textureconfig_chatbubble_9000_1_9000_1/file",
  selectedBubbleLeft: "/api/assets/misc_textureconfig_chatbubble_9000_9000/file",
  selectedBubbleRight: "/api/assets/misc_textureconfig_chatbubble_9000_1_9000_1/file",
  recallLine: "/api/assets/atlas_atlas_monotalkatlas_Momotalk_29/file",
};

const MESSAGE_TYPES = [
  ["text", "文本"],
  ["sticker", "贴纸"],
  ["image", "图片"],
  ["system", "系统提示"],
  ["recall", "撤回"],
];

// 全局运行时状态：项目、联系人、资源缓存、选择状态和弹窗状态。
const state = {
  projects: [],
  project: null,
  imageUploadTarget: null,
  contacts: [],
  speakerContactId: null,
  selectedMessageId: null,
  assets: {
    backgrounds: [],
    avatars: [],
    stickers: [],
  },
  assetCache: new Map(),
  bubbleThemes: { defaultTheme: "", themes: [] },
  projectManagementMode: false,
  assetModal: {
    category: "backgrounds",
    query: "",
    mode: "background",
    targetMessageId: null,
    composeSticker: false,
    page: 0,
    stickerCategoryId: null,
    stickerOffset: 0,
    stickerLimit: 24,
  },
  saveTimer: null,
  saving: false,
  exportingPng: false,
  groupDraft: {
    mode: "create",
    groupId: null,
    name: "",
    memberIds: [],
    query: "",
    page: 0,
    submitting: false,
    deleteArmed: false,
  },
};

// 页面 DOM 缓存，避免在渲染过程中重复查询节点。
const elements = {
  projectList: document.getElementById("projectList"),
  projectManagementButton: document.getElementById("projectManagementButton"),
  saveButton: document.getElementById("saveButton"),
  saveState: document.getElementById("saveState"),
  previewTitle: document.getElementById("previewTitle"),
  previewContactName: document.getElementById("previewContactName"),
  previewRailAvatarButton: document.getElementById("previewRailAvatarButton"),
  previewRailAvatar: document.getElementById("previewRailAvatar"),
  contactList: document.getElementById("contactList"),
  phonePreview: document.getElementById("phonePreview"),
  chatPanel: document.querySelector(".momotalk-chat"),
  chatScroll: document.getElementById("chatScroll"),
  messageComposer: document.getElementById("messageComposer"),
  directMessageInput: document.getElementById("directMessageInput"),
  speakerPicker: document.getElementById("speakerPicker"),
  chatImageButton: document.getElementById("chatImageButton"),
  chatImageInput: document.getElementById("chatImageInput"),
  chatStickerButton: document.getElementById("chatStickerButton"),
  saveChatImageButton: document.getElementById("saveChatImageButton"),
  newGroupButton: document.getElementById("newGroupButton"),
  projectTitleInput: document.getElementById("projectTitleInput"),
  contactNameInput: document.getElementById("contactNameInput"),
  avatarPickerAvatar: document.getElementById("avatarPickerAvatar"),
  adminAvatarPickerButton: document.getElementById("adminAvatarPickerButton"),
  adminAvatarPickerImage: document.getElementById("adminAvatarPickerImage"),
  adminAvatarPickerLabel: document.getElementById("adminAvatarPickerLabel"),
  bubblePickerButton: document.getElementById("bubblePickerButton"),
  bubblePickerImage: document.getElementById("bubblePickerImage"),
  bubblePickerLabel: document.getElementById("bubblePickerLabel"),
  railBubbleButton: document.getElementById("railBubbleButton"),
  railBubbleImage: document.getElementById("railBubbleImage"),
  backgroundPickerButton: document.getElementById("backgroundPickerButton"),
  backgroundPickerImage: document.getElementById("backgroundPickerImage"),
  backgroundPickerLabel: document.getElementById("backgroundPickerLabel"),
  addMessageButton: document.getElementById("addMessageButton"),
  selectedMessageLabel: document.getElementById("selectedMessageLabel"),
  messageList: document.getElementById("messageList"),
  messageEditor: document.getElementById("messageEditor"),
  assetModal: document.getElementById("assetModal"),
  assetModalTitle: document.getElementById("assetModalTitle"),
  assetToolbar: document.getElementById("assetToolbar"),
  assetCategorySelect: document.getElementById("assetCategorySelect"),
  assetSearchInput: document.getElementById("assetSearchInput"),
  assetGrid: document.getElementById("assetGrid"),
  assetPagination: document.getElementById("assetPagination"),
  assetPrevPage: document.getElementById("assetPrevPage"),
  assetNextPage: document.getElementById("assetNextPage"),
  assetPageLabel: document.getElementById("assetPageLabel"),
  assetModalStatus: document.getElementById("assetModalStatus"),
  closeAssetModal: document.getElementById("closeAssetModal"),
  groupModal: document.getElementById("groupModal"),
  groupModalEyebrow: document.getElementById("groupModalEyebrow"),
  groupModalTitle: document.getElementById("groupModalTitle"),
  closeGroupModal: document.getElementById("closeGroupModal"),
  groupManagerRow: document.getElementById("groupManagerRow"),
  groupManagerSelect: document.getElementById("groupManagerSelect"),
  groupNameRow: document.getElementById("groupNameRow"),
  cancelGroupButton: document.getElementById("cancelGroupButton"),
  createGroupButton: document.getElementById("createGroupButton"),
  saveGroupButton: document.getElementById("saveGroupButton"),
  deleteGroupButton: document.getElementById("deleteGroupButton"),
  groupNameInput: document.getElementById("groupNameInput"),
  groupMemberSearch: document.getElementById("groupMemberSearch"),
  groupMemberList: document.getElementById("groupMemberList"),
  groupMemberPagination: document.getElementById("groupMemberPagination"),
  groupPrevPage: document.getElementById("groupPrevPage"),
  groupNextPage: document.getElementById("groupNextPage"),
  groupPageLabel: document.getElementById("groupPageLabel"),
  groupSelectedCount: document.getElementById("groupSelectedCount"),
  groupAvatarPreview: document.getElementById("groupAvatarPreview"),
  groupPreviewName: document.getElementById("groupPreviewName"),
  groupPreviewCount: document.getElementById("groupPreviewCount"),
  groupModalStatus: document.getElementById("groupModalStatus"),
  emptyMessageModal: document.getElementById("emptyMessageModal"),
  emptyMessageModalClose: document.getElementById("emptyMessageModalClose"),
  powerButton: document.getElementById("powerButton"),
  powerConfirmModal: document.getElementById("powerConfirmModal"),
  powerConfirmCancel: document.getElementById("powerConfirmCancel"),
  powerConfirmAccept: document.getElementById("powerConfirmAccept"),
  shutdownNotice: document.getElementById("shutdownNotice"),
  toast: document.getElementById("toast"),
};

function newId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
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
    const error = new Error(payload?.error?.message || payload?.message || `请求失败：${response.status}`);
    error.status = response.status;
    error.code = payload?.error?.code;
    throw error;
  }
  return payload;
}

function assetUrl(asset) {
  return asset?.thumbnail_url || asset?.file_url || asset?.url || "";
}

function assetFullUrl(asset) {
  return asset?.file_url || asset?.url || asset?.thumbnail_url || "";
}

function messageImageUrl(message) {
  const fileId = String(message?.file_id || "");
  if (!fileId) return "";
  return `/api/uploads/${encodeURIComponent(fileId)}`;
}

function cacheAsset(asset) {
  if (asset?.id) state.assetCache.set(asset.id, asset);
}

function cacheAssets(assets) {
  for (const asset of assets || []) cacheAsset(asset);
}

function findAsset(assetId) {
  if (!assetId) return null;
  const cached = state.assetCache.get(assetId);
  if (cached) return cached;
  for (const items of Object.values(state.assets)) {
    const found = items.find((item) => item.id === assetId);
    if (found) {
      cacheAsset(found);
      return found;
    }
  }
  return null;
}

function ensureMessageTimestamps(project) {
  if (!project) return;
  const groups = [
    ...Object.values(project.conversations || {}),
    Array.isArray(project.messages) ? project.messages : [],
  ];
  const total = groups.reduce((count, messages) => count + (messages?.length || 0), 0);
  let sequence = 0;
  const base = Date.now() - Math.max(total, 1) * 1000;
  for (const messages of groups) {
    for (const message of messages || []) {
      if (!message.created_at) message.created_at = new Date(base + sequence * 1000).toISOString();
      sequence += 1;
    }
  }
}

function messageCreatedAtMs(message) {
  const value = Date.parse(message?.created_at || "");
  return Number.isFinite(value) ? value : 0;
}

function conversationLatestMessageMs(project, contact) {
  const messages = String(contact?.id) === String(project?.contact?.contact_id)
    ? project.messages
    : activeConversationMessages(project, contact);
  return (messages || []).reduce((latest, message) => Math.max(latest, messageCreatedAtMs(message)), 0);
}

function sortedContacts() {
  return [...state.contacts].sort((left, right) => {
    const kindDelta = String(left.kind || "hero").localeCompare(String(right.kind || "hero"));
    if (kindDelta) return kindDelta;
    return String(left.name || "").localeCompare(String(right.name || ""), "zh-Hans-CN", {
      numeric: true,
      sensitivity: "base",
    });
  });
}

function heroContacts() {
  return sortedContacts().filter((contact) => contact.kind !== "group");
}

function findContact(contactId) {
  if (contactId === null || contactId === undefined || contactId === "") return null;
  return state.contacts.find((contact) => String(contact.id) === String(contactId)) || null;
}

function contactDisplayName(contact) {
  return String(contact?.name || "角色名").trim() || "角色名";
}

function projectContactDisplayName(project) {
  if (project?.contact_kind === "group") {
    const live = findContact(project.contact_id);
    if (live?.kind === "group") return contactDisplayName(live);
  }
  return project?.contact_name || project?.title || "未命名项目";
}

function isGroupContact(contact) {
  return contact?.kind === "group";
}

function contactMemberIds(contact) {
  return Array.isArray(contact?.member_ids)
    ? contact.member_ids
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value))
    : [];
}

function contactMembers(contact) {
  const byId = new Map(heroContacts().map((item) => [item.id, item]));
  return contactMemberIds(contact)
    .map((memberId) => byId.get(memberId))
    .filter(Boolean);
}

function groupDisplayName(name) {
  const text = String(name || "").trim();
  if (/[\u4e00-\u9fff]/.test(text)) return text;
  if (text) return "群";
  return "群";
}

function groupAvatarText(contact) {
  const displayName = contactDisplayName(contact);
  const match = displayName.match(/[\u4e00-\u9fff]/);
  return match ? match[0] : "群";
}

// 拼图参数对齐游戏内置群头像：格子 40.4%、四周留白 8%、间隙 3.2%。
const GROUP_AVATAR_TILE_SIZE = 0.404;
const GROUP_AVATAR_TILE_START = 0.08;
const GROUP_AVATAR_TILE_FAR = 1 - GROUP_AVATAR_TILE_START - GROUP_AVATAR_TILE_SIZE;
const GROUP_AVATAR_TILE_MIDDLE = (1 - GROUP_AVATAR_TILE_SIZE) / 2;

function groupAvatarTile(member, x, y) {
  return {
    member,
    x,
    y,
    width: GROUP_AVATAR_TILE_SIZE,
    height: GROUP_AVATAR_TILE_SIZE,
  };
}

function groupAvatarLayout(contact) {
  // 官方群（内置群）自带群头像资源时优先直接显示群头像，
  // 只有自定义群（asset_id / avatar_asset_id 为空）才按成员拼图。
  if (contactAvatarAsset(contact)) return { type: "asset", contact };

  const members = contactMembers(contact);
  if (!members.length) {
    return { type: "text", text: groupAvatarText(contact) };
  }
  if (members.length === 1) return { type: "single", members };

  const start = GROUP_AVATAR_TILE_START;
  const far = GROUP_AVATAR_TILE_FAR;
  const middle = GROUP_AVATAR_TILE_MIDDLE;

  if (members.length === 2) {
    return {
      type: "tiles",
      members,
      tiles: [
        groupAvatarTile(members[0], start, middle),
        groupAvatarTile(members[1], far, middle),
      ],
    };
  }
  if (members.length === 3) {
    return {
      type: "tiles",
      members,
      tiles: [
        groupAvatarTile(members[0], start, start),
        groupAvatarTile(members[1], start, far),
        groupAvatarTile(members[2], far, middle),
      ],
    };
  }
  // 游戏内置群头像最多展示 4 名成员，超出部分不参与拼图。
  const shown = members.slice(0, 4);
  return {
    type: "tiles",
    members: shown,
    tiles: [
      groupAvatarTile(shown[0], start, start),
      groupAvatarTile(shown[1], far, start),
      groupAvatarTile(shown[2], start, far),
      groupAvatarTile(shown[3], far, far),
    ],
  };
}

// 联系人头像与群组拼图逻辑。
function contactAvatarAsset(contact) {
  return findAsset(contact?.asset_id || contact?.avatar_asset_id);
}

function avatarImageMarkup(asset, name, className = "avatar") {
  if (asset) {
    return `<span class="${className} has-image" style="background-image: url(&quot;${escapeHtml(assetUrl(asset))}&quot;)" role="img" aria-label="${escapeHtml(name)}"></span>`;
  }
  return `<span class="${className}" role="img" aria-label="${escapeHtml(name)}">${escapeHtml(String(name || "?").slice(0, 1) || "?")}</span>`;
}

function groupAvatarMosaicHtml(contact, { loading = "" } = {}) {
  const layout = groupAvatarLayout(contact);
  if (layout.type === "text") {
    return `<div class="group-avatar-mosaic group-avatar-text" data-layout="text" aria-label="${escapeHtml(contactDisplayName(contact))}"><span>${escapeHtml(layout.text)}</span></div>`;
  }
  if (layout.type === "asset") {
    const asset = contactAvatarAsset(layout.contact || contact);
    return `
      <div class="group-avatar-mosaic" data-layout="asset" aria-label="${escapeHtml(contactDisplayName(contact))}">
        <img src="${escapeHtml(assetUrl(asset))}" alt=""${loading ? ` loading="${escapeHtml(loading)}"` : ""} />
      </div>
    `;
  }
  if (layout.type === "single") {
    const member = layout.members[0];
    const asset = contactAvatarAsset(member);
    const content = asset
      ? `<img src="${escapeHtml(assetUrl(asset))}" alt=""${loading ? ` loading="${escapeHtml(loading)}"` : ""} />`
      : `<span>${escapeHtml(groupAvatarText(member))}</span>`;
    return `<div class="group-avatar-mosaic" data-layout="single" aria-label="${escapeHtml(contactDisplayName(contact))}">${content}</div>`;
  }
  return `
    <div class="group-avatar-mosaic" data-layout="tiles" data-count="${layout.members.length}" aria-label="${escapeHtml(contactDisplayName(contact))}">
      ${layout.tiles
        .map((tile) => {
          const asset = contactAvatarAsset(tile.member);
          const style = [
            `left:${tile.x * 100}%`,
            `top:${tile.y * 100}%`,
            `width:${tile.width * 100}%`,
            `height:${tile.height * 100}%`,
          ].join(";");
          const content = asset
            ? `<img src="${escapeHtml(assetUrl(asset))}" alt=""${loading ? ` loading="${escapeHtml(loading)}"` : ""} />`
            : `<span>${escapeHtml(groupAvatarText(tile.member))}</span>`;
          return `<span class="group-avatar-tile" style="${style}">${content}</span>`;
        })
        .join("")}
    </div>
  `;
}

function contactAvatarHtml(contact, options = {}) {
  if (!contact) return avatarImageMarkup(null, "?", options.className || "avatar");
  if (isGroupContact(contact)) return groupAvatarMosaicHtml(contact, options);
  const asset = contactAvatarAsset(contact);
  return avatarImageMarkup(asset, contactDisplayName(contact), options.className || "avatar");
}

function renderAvatarNode(node, contact) {
  if (!node) return;
  if (isGroupContact(contact)) {
    const layout = groupAvatarLayout(contact);
    node.classList.remove("has-image");
    node.style.backgroundImage = "";
    node.innerHTML = groupAvatarMosaicHtml(contact, { className: "avatar" });
    node.dataset.groupLayout = layout.type;
    return;
  }
  delete node.dataset.groupLayout;
  const asset = contactAvatarAsset(contact);
  if (asset) {
    node.textContent = "";
    node.style.backgroundImage = `url("${assetUrl(asset)}")`;
    node.classList.add("has-image");
    return;
  }
  node.textContent = contactDisplayName(contact).slice(0, 1) || "?";
  node.style.backgroundImage = "";
  node.classList.remove("has-image");
}

function adminAvatarAssetId(project = state.project) {
  return project?.appearance?.admin_avatar_asset_id || DEFAULT_ADMIN_AVATAR_ASSET_ID;
}

function adminAvatarAsset(project = state.project) {
  return findAsset(adminAvatarAssetId(project));
}

function normalizeProjectBackgroundId(assetId) {
  if (!assetId || !CHAT_BACKGROUND_ASSET_IDS.has(assetId)) {
    return DEFAULT_CHAT_BACKGROUND_ASSET_ID;
  }
  return assetId;
}

function normalizeProjectBackground(project) {
  if (!project) return;
  const appearance = project.appearance || (project.appearance = {});
  appearance.background_asset_id = normalizeProjectBackgroundId(
    appearance.background_asset_id,
  );
}

function chatBackgroundAsset(project = state.project) {
  return (
    findAsset(normalizeProjectBackgroundId(project?.appearance?.background_asset_id)) ||
    findAsset(DEFAULT_CHAT_BACKGROUND_ASSET_ID) ||
    DEFAULT_CHAT_BACKGROUND_ASSET
  );
}

async function loadContactAvatars() {
  const assetIds = [
    ...new Set(
      [
        ...state.contacts.flatMap((contact) => [contact.asset_id, contact.avatar_asset_id]),
        ...state.contacts.flatMap((contact) => contactMembers(contact).flatMap((member) => [member.asset_id, member.avatar_asset_id])),
        ...ADMIN_AVATAR_ASSET_IDS,
      ].filter(Boolean),
    ),
  ];
  if (!assetIds.length) {
    state.assets.avatars = [];
    return;
  }
  const payload = await api(`/assets?ids=${encodeURIComponent(assetIds.join(","))}`);
  state.assets.avatars = payload.items || [];
}

function contactFromProject(project) {
  const contact = project?.contact;
  if (!contact) return null;
  const liveGroup = findContact(contact.contact_id);
  if (liveGroup?.kind === "group") {
    return { ...liveGroup, name: contactDisplayName(liveGroup) };
  }
  return {
    id: contact.contact_id,
    name: contactDisplayName(contact),
    kind: contact.kind || "hero",
    asset_id: contact.avatar_asset_id,
    member_ids: Array.isArray(contact.member_ids) ? contact.member_ids : [],
  };
}

function conversationKeyForContact(contact) {
  if (contact?.id !== null && contact?.id !== undefined && contact?.id !== "") {
    return String(contact.id);
  }
  return `${contact?.kind || "hero"}:${contactDisplayName(contact)}`;
}

function ensureConversations(project) {
  if (!project) return {};
  const conversations =
    project.conversations &&
    typeof project.conversations === "object" &&
    !Array.isArray(project.conversations)
      ? project.conversations
      : {};
  project.conversations = conversations;

  const activeKey =
    typeof project.active_conversation_id === "string" && project.active_conversation_id
      ? project.active_conversation_id
      : conversationKeyForContact(contactFromProject(project));
  const activeMessages = Array.isArray(conversations[activeKey])
    ? conversations[activeKey]
    : null;
  if (activeMessages) {
    project.messages = activeMessages;
  } else {
    conversations[activeKey] = [];
    project.messages = conversations[activeKey];
  }
  project.active_conversation_id = activeKey;
  return conversations;
}

function syncActiveConversation(project) {
  const conversations = ensureConversations(project);
  const activeKey = project.active_conversation_id || conversationKeyForContact(contactFromProject(project));
  project.active_conversation_id = activeKey;
  if (!Array.isArray(conversations[activeKey])) conversations[activeKey] = [];
  project.messages = conversations[activeKey];
  return conversations;
}

function activeConversationMessages(project, contact) {
  const conversations = ensureConversations(project);
  const key = conversationKeyForContact(contact);
  return Array.isArray(conversations[key]) ? conversations[key] : [];
}

function isBlankTextMessage(message) {
  return message?.type === "text" && !String(message.text || "").trim();
}

function pruneBlankMessages(project) {
  if (!project) return;
  const conversations = syncActiveConversation(project);
  for (const [key, messages] of Object.entries(conversations)) {
    conversations[key] = (Array.isArray(messages) ? messages : []).filter(
      (message) => !isBlankTextMessage(message),
    );
  }
  const activeKey = project.active_conversation_id || conversationKeyForContact(contactFromProject(project));
  project.active_conversation_id = activeKey;
  project.messages = conversations[activeKey] || [];
}

function currentSpeaker(project = state.project) {
  if (project && state.speakerContactId === ADMIN_SPEAKER_ID) return adminSpeaker(project);
  const projectContact = contactFromProject(project);
  if (!projectContact) return null;
  if (projectContact.kind !== "group") {
    return findContact(projectContact.id) || projectContact;
  }
  const selected = findContact(state.speakerContactId);
  const members = contactMembers(projectContact);
  if (selected && selected.kind !== "group" && members.some((member) => String(member.id) === String(selected.id))) {
    return selected;
  }
  return members[0] || projectContact;
}

function adminSpeaker(project = state.project) {
  return {
    id: ADMIN_SPEAKER_ID,
    name: "管理员",
    kind: "admin",
    asset_id: adminAvatarAssetId(project),
  };
}

function isAdminSpeaker(speaker) {
  return Boolean(speaker && String(speaker.id) === ADMIN_SPEAKER_ID);
}

function messageSpeaker(message, project = state.project) {
  if (isAdminMessage(message)) return adminSpeaker(project);
  const speakerContact = findContact(message?.speaker_id);
  const fallback = speakerContact || contactFromProject(project) || {
    id: null,
    name: "角色名",
    kind: "hero",
    asset_id: null,
  };
  return {
    id: message?.speaker_id ?? fallback.id,
    name: String(message?.speaker_name || fallback.name || "角色名"),
    kind: fallback.kind,
    asset_id: fallback.asset_id ?? message?.speaker_asset_id,
  };
}

function shouldShowSpeakerName(message, project = state.project) {
  if (isAdminMessage(message)) return false;
  if (message?.side === "right") return false;
  const speaker = messageSpeaker(message, project);
  const contact = contactFromProject(project);
  return Boolean(
    contact?.kind === "group" ||
    (speaker.name && contact?.name && speaker.name !== contact.name),
  );
}

function isAdminMessage(message) {
  return message?.side === "right";
}

function defaultMessage(type = "text", side = "left") {
  const base = {
    id: newId("msg"),
    type,
    side: ["text", "sticker", "image"].includes(type) ? side : "center",
    created_at: new Date().toISOString(),
  };
  if (type === "text") base.text = "";
  if (type === "sticker") base.asset_id = DEFAULT_STICKER_ASSET_ID;
  if (type === "image") {
    base.file_id = "";
    base.name = "";
    base.width = 0;
    base.height = 0;
  }
  if (type === "system") base.text = "系统提示";
  if (type === "recall") base.text = "对方撤回了一条消息";
  return base;
}

function markDirty() {
  elements.saveState.textContent = "未保存";
  elements.saveState.classList.add("dirty");
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    saveProject({ quiet: true });
  }, 900);
}

function markSaved() {
  elements.saveState.textContent = "已保存";
  elements.saveState.classList.remove("dirty");
}

function showToast(message, type = "info") {
  elements.toast.textContent = message;
  elements.toast.dataset.type = type;
  elements.toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.classList.add("hidden"), 2600);
}

async function loadAssets() {
  const backgrounds = await api("/assets?category=backgrounds&limit=200");
  state.assets.backgrounds = backgrounds.items;
  cacheAssets(state.assets.backgrounds);
}

async function hydrateProjectAssets(project) {
  if (!project) return;
  const assetIds = new Set([DEFAULT_CHAT_BACKGROUND_ASSET_ID]);
  const addAssetId = (assetId) => {
    if (assetId && !findAsset(assetId)) assetIds.add(assetId);
  };
  addAssetId(project.contact?.avatar_asset_id);
  addAssetId(project.appearance?.background_asset_id);
  addAssetId(project.appearance?.admin_avatar_asset_id);
  const messageGroups = [
    ...Object.values(project.conversations || {}),
    Array.isArray(project.messages) ? project.messages : [],
  ];
  for (const messages of messageGroups) {
    for (const message of messages || []) {
      addAssetId(message.asset_id);
    }
  }
  if (!assetIds.size) return;
  const params = new URLSearchParams({
    ids: [...assetIds].join(","),
    limit: String(Math.min(assetIds.size, 1000)),
  });
  const payload = await api(`/assets?${params.toString()}`);
  cacheAssets(payload.items);
}

// 首次加载和资源缓存。
async function loadContacts() {
  const payload = await api("/contacts");
  state.contacts = payload.items || [];
}

async function loadProjects() {
  const payload = await api("/projects");
  state.projects = payload.items;
  renderProjectList();
}

function renderProjectList() {
  const createRow = `
    <button id="projectCreateButton" class="project-item project-create-item" type="button" data-action="new-project">
      <span class="project-avatar" aria-hidden="true">+</span>
      <span class="project-copy">
        <strong>新建项目</strong>
        <small>创建新的聊天项目</small>
      </span>
    </button>
  `;
  const projectRows = state.projects
    .map(
      (project) => `
        <div class="project-item ${state.project?.id === project.id ? "active" : ""}" role="button" tabindex="0" data-project-id="${escapeHtml(project.id)}">
          <span class="project-avatar">${escapeHtml((projectContactDisplayName(project) || "?").slice(0, 1))}</span>
          <span class="project-copy">
            <strong>${escapeHtml(projectContactDisplayName(project))}</strong>
            <small>${escapeHtml(project.title)}</small>
          </span>
          ${state.projectManagementMode ? `<button class="project-delete-button" type="button" data-delete-project-id="${escapeHtml(project.id)}" title="删除项目" aria-label="删除项目">×</button>` : ""}
        </div>
      `,
    )
    .join("");
  elements.projectList.innerHTML = createRow + projectRows;
  elements.projectManagementButton?.classList.toggle("active", state.projectManagementMode);
}

async function deleteProject(projectId) {
  if (!projectId) return;
  if (!window.confirm("确定删除这个项目吗？")) return;
  await api(`/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
  const deletedActive = state.project?.id === projectId;
  await loadProjects();
  if (deletedActive) {
    if (state.projects.length) await openProject(state.projects[0].id);
    else await createProject();
  }
}

// 项目列表、创建、打开和保存。
async function openProject(projectId) {
  const project = await api(`/projects/${encodeURIComponent(projectId)}`);
  normalizeProjectBackground(project);
  await hydrateProjectAssets(project);
  ensureConversations(project);
  ensureMessageTimestamps(project);
  pruneBlankMessages(project);
  state.project = project;
  state.speakerContactId = ADMIN_SPEAKER_ID;
  localStorage.setItem(LAST_PROJECT_KEY, project.id);
  state.selectedMessageId = project.messages[0]?.id || null;
  renderAll();
}

async function createProject() {
  const project = await api("/projects", {
    method: "POST",
    body: JSON.stringify({ title: "未命名项目", contact_name: "角色名" }),
  });
  state.project = project;
  const initialContact = sortedContacts()[0];
  if (initialContact) {
    state.project.contact.contact_id = initialContact.id;
    state.project.contact.kind = initialContact.kind || "hero";
    state.project.contact.name = contactDisplayName(initialContact);
    state.project.contact.avatar_asset_id = initialContact.asset_id || null;
    state.project.contact.member_ids = contactMemberIds(initialContact);
    const conversationKey = conversationKeyForContact(initialContact);
    state.project.active_conversation_id = conversationKey;
    state.project.conversations = { [conversationKey]: [] };
    state.project.messages = state.project.conversations[conversationKey];
    state.speakerContactId = ADMIN_SPEAKER_ID;
  }
  await saveProject({ quiet: true });
  localStorage.setItem(LAST_PROJECT_KEY, project.id);
  state.selectedMessageId = null;
  await loadProjects();
  renderAll();
  showToast("已新建项目");
}

// 当前群组联系人改名及相关项目同步。
async function renameCurrentGroup(rawName) {
  const contact = contactFromProject(state.project);
  if (!contact || contact.kind !== "group") return;
  const name = String(rawName || "").trim();
  if (!name) {
    showToast("群名不能为空", "error");
    elements.contactNameInput.value = contactDisplayName(contact);
    return;
  }
  if (name === contactDisplayName(contact)) return;
  const updated = await api(`/groups/${encodeURIComponent(contact.id)}`, {
    method: "PUT",
    body: JSON.stringify({
      name,
      member_ids: contactMemberIds(contact),
    }),
  });
  const index = state.contacts.findIndex((item) => String(item.id) === String(updated.id));
  if (index >= 0) state.contacts[index] = { ...state.contacts[index], ...updated };
  state.projects = state.projects.map((project) => (
    String(project.contact_id) === String(updated.id)
      ? { ...project, contact_name: updated.name || name }
      : project
  ));
  updateProject((project) => {
    project.contact.name = updated.name || name;
    project.contact.member_ids = Array.isArray(updated.member_ids)
      ? updated.member_ids
      : project.contact.member_ids;
  }, { render: false });
  await loadProjects();
  renderAll();
  showToast("群名已更新");
}

async function saveProject(options = {}) {
  if (!state.project || state.saving) return;
  state.saving = true;
  try {
    pruneBlankMessages(state.project);
    const saved = await api(`/projects/${encodeURIComponent(state.project.id)}`, {
      method: "PUT",
      body: JSON.stringify(state.project),
    });
    state.project = saved;
    pruneBlankMessages(state.project);
    await loadProjects();
    markSaved();
    if (!options.quiet) showToast("项目已保存");
  } catch (error) {
    elements.saveState.textContent = "保存失败";
    elements.saveState.classList.add("dirty");
    showToast(error.message, "error");
  } finally {
    state.saving = false;
  }
}

function updateProject(mutator, options = {}) {
  if (!state.project) return;
  mutator(state.project);
  syncActiveConversation(state.project);
  if (options.render === false) {
    renderPreview();
    renderMessageList();
  } else {
    renderAll();
  }
  if (options.save !== false) markDirty();
}

function updateMessage(messageId, mutator, options = {}) {
  updateProject((project) => {
    const message = project.messages.find((item) => item.id === messageId);
    if (message) mutator(message);
  }, options);
}

function renderAll() {
  renderProjectList();
  renderEditor();
  renderPreview();
}

// 编辑器渲染与事件绑定。
function renderEditor() {
  const project = state.project;
  if (!project) {
    elements.projectTitleInput.value = "";
    elements.contactNameInput.value = "";
    elements.messageList.innerHTML = '<p class="empty-state">先新建或打开一个项目。</p>';
    elements.messageEditor.innerHTML = '<p class="empty-state">项目为空。</p>';
    return;
  }

  elements.projectTitleInput.value = project.title;
  elements.contactNameInput.value = project.contact.name;

  renderAvatarNode(elements.avatarPickerAvatar, contactFromProject(project) || project.contact);
  setPickerAsset(
    elements.adminAvatarPickerImage,
    elements.adminAvatarPickerLabel,
    adminAvatarAsset(project),
    "选择管理员头像",
  );
  const background = chatBackgroundAsset(project);
  setPickerAsset(elements.backgroundPickerImage, elements.backgroundPickerLabel, background, "选择背景");
  applyBubbleTheme(currentBubbleThemeId(project));

  renderMessageList();
  renderMessageEditor();
}

async function loadBubbleThemes() {
  try {
    const payload = await api("/bubble-themes");
    state.bubbleThemes = {
      defaultTheme: payload.default_theme || "",
      themes: Array.isArray(payload.themes) ? payload.themes : [],
    };
  } catch (error) {
    state.bubbleThemes = { defaultTheme: "", themes: [] };
  }
}

function bubbleThemeById(themeId) {
  return state.bubbleThemes.themes.find((theme) => String(theme.id) === String(themeId)) || null;
}

function bubbleThemeLabel(theme) {
  return String(theme?.name || theme?.id || "").trim() || "未命名气泡";
}

// 将主题同时应用到预览 CSS 变量和 PNG 导出配置。
function applyBubbleTheme(themeId) {
  const theme = bubbleThemeById(themeId) || bubbleThemeById(state.bubbleThemes.defaultTheme);
  if (!theme) return;
  const left = theme.variants && theme.variants.left;
  const right = theme.variants && theme.variants.right;
  if (!left || !right) return;
  const root = document.documentElement;
  root.style.setProperty("--momotalk-selected-bubble-left", `url("${left.url}")`);
  root.style.setProperty("--momotalk-selected-bubble-right", `url("${right.url}")`);
  const leftSlice = left.slice || right.slice;
  const rightSlice = right.slice || leftSlice;
  const applySlice = (suffix, slice) => {
    if (!slice) return;
    root.style.setProperty(`--momotalk-selected-bubble-slice-${suffix}`, `${slice.top} ${slice.right} ${slice.bottom} ${slice.left}`);
    const k = 0.0574;
    root.style.setProperty(
      `--momotalk-selected-bubble-edge-${suffix}`,
      `${(slice.top * k).toFixed(2)}cqw ${(slice.right * k).toFixed(2)}cqw ${(slice.bottom * k).toFixed(2)}cqw ${(slice.left * k).toFixed(2)}cqw`,
    );
  };
  applySlice("left", leftSlice);
  applySlice("right", rightSlice);
  if (leftSlice) BUBBLE_NINE_SLICE_LEFT = { ...leftSlice };
  if (rightSlice) BUBBLE_NINE_SLICE_RIGHT = { ...rightSlice };
  const leftText = (left.text_color) || "#303b4b";
  const rightText = (right.text_color) || leftText;
  root.style.setProperty("--momotalk-selected-text-left", leftText);
  root.style.setProperty("--momotalk-selected-text-right", rightText);
  BUBBLE_TEXT_COLOR_LEFT = leftText;
  BUBBLE_TEXT_COLOR_RIGHT = rightText;
  EXPORT_ASSET_URLS.selectedBubbleLeft = left.url;
  EXPORT_ASSET_URLS.selectedBubbleRight = right.url;
  setPickerAsset(elements.bubblePickerImage, elements.bubblePickerLabel, {
    url: right.url, label: bubbleThemeLabel(theme),
  }, "\u9009\u62e9\u6c14\u6ce1");
  if (elements.railBubbleImage) {
    elements.railBubbleImage.src = right.url;
    elements.railBubbleImage.alt = `\u6c14\u6ce1\u4e3b\u9898 ${bubbleThemeLabel(theme)}`;
  }
}

function currentBubbleThemeId(project) {
  return project?.appearance?.bubble_theme_id || state.bubbleThemes.defaultTheme;
}

function setPickerAsset(image, label, asset, emptyLabel) {
  if (asset) {
    image.src = assetUrl(asset);
    image.classList.remove("hidden");
    label.textContent = asset.label || asset.name || asset.id;
  } else {
    image.removeAttribute("src");
    image.classList.add("hidden");
    label.textContent = emptyLabel;
  }
}

function messageOptionLabel(message) {
  switch (message.type) {
    case "text":
      return message.text || "空文本";
    case "sticker":
      return "贴纸消息";
    case "image":
      return message.name || "图片消息";
    case "system":
      return message.text || "系统提示";
    case "recall":
      return message.text || "撤回消息";
    default:
      return message.type;
  }
}

function renderMessageList() {
  const project = state.project;
  if (!project || !project.messages.length) {
    elements.messageList.innerHTML = '<p class="empty-state">还没有消息，点击“添加消息”开始。</p>';
    elements.selectedMessageLabel.textContent = "未选中";
    return;
  }
  elements.messageList.innerHTML = project.messages
    .map((message, index) => {
      const active = message.id === state.selectedMessageId;
      const assetId = message.asset_id;
      const asset = findAsset(assetId);
      const thumb = message.type === "image"
        ? `<img src="${escapeHtml(messageImageUrl(message))}" alt="" />`
        : asset ? `<img src="${escapeHtml(assetUrl(asset))}" alt="" />` : "";
      return `
        <div class="message-list-item ${active ? "active" : ""}" data-message-id="${escapeHtml(message.id)}">
          <button class="message-select" type="button" data-action="select">
            <span class="message-index">${index + 1}</span>
            <span class="message-summary">
              <strong>${escapeHtml(messageTypeLabel(message.type))} · ${escapeHtml(sideLabel(message.side))}</strong>
              <small>${escapeHtml(messageOptionLabel(message).slice(0, 42))}</small>
            </span>
            ${thumb}
          </button>
          <div class="message-list-actions">
            <button type="button" title="上移" data-action="up" ${index === 0 ? "disabled" : ""}>↑</button>
            <button type="button" title="下移" data-action="down" ${index === project.messages.length - 1 ? "disabled" : ""}>↓</button>
            <button type="button" title="删除" data-action="delete">×</button>
          </div>
        </div>
      `;
    })
    .join("");
  const selected = project.messages.find((message) => message.id === state.selectedMessageId);
  elements.selectedMessageLabel.textContent = selected ? `已选第 ${project.messages.indexOf(selected) + 1} 条` : "未选中";
}

function messageTypeLabel(type) {
  return MESSAGE_TYPES.find(([value]) => value === type)?.[1] || type;
}

function sideLabel(side) {
  return { left: "左侧", right: "右侧", center: "居中" }[side] || side;
}

function renderMessageEditor() {
  const project = state.project;
  const message = project?.messages.find((item) => item.id === state.selectedMessageId);
  if (!message) {
    elements.messageEditor.innerHTML = '<p class="empty-state">选择一条消息进行编辑。</p>';
    return;
  }

  const sideDisabled = ["text", "sticker", "image"].includes(message.type) ? "" : "disabled";
  const editorTypes = MESSAGE_TYPES;
  elements.messageEditor.innerHTML = `
    <label>
      <span>消息类型</span>
      <select id="messageTypeSelect">
        ${editorTypes.map(([value, label]) => `<option value="${value}" ${message.type === value ? "selected" : ""}>${label}</option>`).join("")}
      </select>
    </label>
    <label>
      <span>方向</span>
      <select id="messageSideSelect" ${sideDisabled}>
        <option value="left" ${message.side === "left" ? "selected" : ""}>左侧</option>
        <option value="right" ${message.side === "right" ? "selected" : ""}>右侧</option>
      </select>
    </label>
    ${messageFieldsHtml(message)}
  `;
  bindMessageEditorEvents(message);
}

function messageFieldsHtml(message) {
  if (message.type === "text") {
    return `<label><span>文本</span><textarea id="messageTextInput" rows="5">${escapeHtml(message.text)}</textarea></label>`;
  }
  if (message.type === "image") {
    return `
      <div class="asset-picker-row">
        <span>图片</span>
        <button id="messageImageButton" class="asset-preview-button wide" type="button">
          <img src="${escapeHtml(messageImageUrl(message))}" alt="" />
          <span>${escapeHtml(message.name || "更换静态图片")}</span>
        </button>
      </div>
    `;
  }
  if (message.type === "sticker") {
    const asset = findAsset(message.asset_id);
    return `
      <div class="asset-picker-row">
        <span>贴纸素材</span>
        <button id="messageAssetButton" class="asset-preview-button wide" type="button">
          ${asset ? `<img src="${escapeHtml(assetUrl(asset))}" alt="" />` : ""}
          <span>${escapeHtml(asset?.label || asset?.name || message.asset_id || "选择贴纸")}</span>
        </button>
      </div>
    `;
  }
  if (["system", "recall"].includes(message.type)) {
    return `<label><span>文本</span><textarea id="messageTextInput" rows="3">${escapeHtml(message.text || "")}</textarea></label>`;
  }
  return "";
}

function bindMessageEditorEvents(message) {
  const typeSelect = document.getElementById("messageTypeSelect");
  typeSelect?.addEventListener("change", () => {
    const nextType = typeSelect.value;
    const previous = { ...message };
    const replacement = defaultMessage(nextType, message.side === "right" ? "right" : "left");
    replacement.id = message.id;
    if (["text", "system", "recall"].includes(nextType) && previous.text) {
      replacement.text = previous.text;
    }
    if (nextType === "sticker" && previous.asset_id) replacement.asset_id = previous.asset_id;
    updateProject((project) => {
      const index = project.messages.findIndex((item) => item.id === message.id);
      project.messages[index] = replacement;
    });
  });

  document.getElementById("messageSideSelect")?.addEventListener("change", (event) => {
    updateMessage(message.id, (item) => {
      item.side = event.target.value;
    }, { render: false });
  });
  document.getElementById("messageTextInput")?.addEventListener("input", (event) => {
    updateMessage(message.id, (item) => {
      item.text = event.target.value;
    }, { render: false });
  });
  document.getElementById("messageAssetButton")?.addEventListener("click", () => {
    openAssetModal("sticker", message.id);
  });
  document.getElementById("messageImageButton")?.addEventListener("click", () => {
    pickStaticImage({ kind: "message", messageId: message.id });
  });
}

function renderContactList(project) {
  if (!elements.contactList) return;
  const contacts = sortedContacts();
  if (!contacts.length) {
    elements.contactList.innerHTML = '<p class="empty-state">可会话角色加载中。</p>';
    return;
  }

  if (project) ensureConversations(project);
  if (project) ensureMessageTimestamps(project);
  const activeId = project?.contact?.contact_id ?? null;
  const orderedContacts = [...contacts].sort((left, right) => {
    const leftActive = String(left.id) === String(activeId);
    const rightActive = String(right.id) === String(activeId);
    if (leftActive !== rightActive) return leftActive ? -1 : 1;
    const timeDelta = conversationLatestMessageMs(project, right) - conversationLatestMessageMs(project, left);
    if (timeDelta) return timeDelta;
    return contactDisplayName(left).localeCompare(contactDisplayName(right), "zh-Hans-CN", {
      numeric: true,
      sensitivity: "base",
    });
  });
  const newGroupEntry = `
    <button
      class="side-entry side-entry-action"
      type="button"
      data-action="new-group"
      title="新建群组"
      aria-label="新建群组"
    >
      <span class="side-entry-avatar avatar-frame">
        <span class="avatar" aria-hidden="true">+</span>
      </span>
      <span class="side-entry-text">
        <strong>新建群组</strong>
        <small>创建多人聊天</small>
      </span>
    </button>
  `;
  elements.contactList.innerHTML =
    newGroupEntry +
    orderedContacts
      .map((contact) => {
        const displayName = contactDisplayName(contact);
        const active = String(contact.id) === String(activeId);
        const contactMessages = project
          ? active
            ? project.messages
            : activeConversationMessages(project, contact)
          : [];
        // 没有消息时不再回退到“群组 / 角色”类别文案，直接留空。
        const secondary = lastMessagePreview(contactMessages) || "";
        return `
          <button
            class="side-entry ${active ? "active" : ""}"
            type="button"
            role="option"
            aria-selected="${active ? "true" : "false"}"
            data-contact-id="${escapeHtml(contact.id)}"
            title="${escapeHtml(secondary ? `${displayName} · ${secondary}` : displayName)}"
          >
            <span class="side-entry-avatar avatar-frame">
              ${contactAvatarHtml(contact, { loading: "lazy" })}
            </span>
            <span class="side-entry-text">
              <strong>${escapeHtml(displayName)}</strong>
              <small>${escapeHtml(secondary)}</small>
            </span>
          </button>
        `;
      })
      .join("");
}

function lastMessagePreview(messages = []) {
  const message = [...messages].reverse().find(
    (item) => item && item.type !== "recall" && !isBlankTextMessage(item),
  );
  if (!message) return "";
  if (message.type === "sticker") return "[贴纸]";
  return String(message.text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function selectRole(contactId) {
  const contact = findContact(contactId);
  if (!contact || !state.project) return;
  state.speakerContactId = ADMIN_SPEAKER_ID;
  updateProject((project) => {
    syncActiveConversation(project);
    project.contact.contact_id = contact.id;
    project.contact.kind = contact.kind || "hero";
    project.contact.name = contactDisplayName(contact);
    project.contact.avatar_asset_id = contact.asset_id || null;
    project.contact.member_ids = contactMemberIds(contact);
    const conversations = ensureConversations(project);
    const conversationKey = conversationKeyForContact(contact);
    if (!Array.isArray(conversations[conversationKey])) conversations[conversationKey] = [];
    project.active_conversation_id = conversationKey;
    project.messages = conversations[conversationKey];
  }, { render: false });
  state.selectedMessageId = state.project.messages.find((message) => !isBlankTextMessage(message))?.id || null;
  renderAll();
  requestAnimationFrame(() => {
    const active = [...elements.contactList.querySelectorAll("[data-contact-id]")]
      .find((node) => node.dataset.contactId === String(contactId));
    active?.scrollIntoView({ block: "nearest" });
  });
}

function renderSpeakerPicker(project) {
  if (!elements.speakerPicker) return;
  if (!project) {
    elements.speakerPicker.innerHTML = '<option value="">角色名</option>';
    elements.speakerPicker.disabled = true;
    return;
  }

  const projectContact = contactFromProject(project);
  const options = projectContact?.kind === "group"
    ? contactMembers(projectContact)
    : [findContact(projectContact?.id) || projectContact].filter(Boolean);
  const speaker = currentSpeaker(project);
  if (!isAdminSpeaker(speaker) && speaker?.id !== null && speaker?.id !== undefined && !options.some((contact) => String(contact.id) === String(speaker.id))) {
    options.push(speaker);
  }
  const visibleOptions = options.length ? options : [projectContact].filter(Boolean);
  elements.speakerPicker.innerHTML = [
    `<option value="${ADMIN_SPEAKER_ID}">管理员</option>`,
    ...visibleOptions.map((contact) => `<option value="${escapeHtml(contact.id ?? "")}">${escapeHtml(contactDisplayName(contact))}</option>`),
  ].join("");
  elements.speakerPicker.value = String(speaker?.id ?? "");
  elements.speakerPicker.disabled = false;
}

function selectSpeaker(contactId) {
  if (contactId === ADMIN_SPEAKER_ID) {
    state.speakerContactId = ADMIN_SPEAKER_ID;
    renderSpeakerPicker(state.project);
    return;
  }
  const contact = findContact(contactId);
  if (!contact || contact.kind === "group") return;
  state.speakerContactId = contact.id;
  renderSpeakerPicker(state.project);
}

function renderPreview() {
  const project = state.project;
  applyChatBackground(project);
  if (!project) {
    elements.previewTitle.textContent = "未命名项目";
    elements.previewContactName.textContent = "角色名";
    renderContactList(null);
    setAvatarImage(elements.previewRailAvatar, null, "管理员");
    elements.chatScroll.innerHTML = "";
    renderSpeakerPicker(null);
    return;
  }

  elements.previewTitle.textContent = project.title;
  elements.previewContactName.textContent = project.contact.name || "角色名";
  elements.previewContactName.title = project.contact.name || "角色名";
  renderContactList(project);
  renderSpeakerPicker(project);
  const previewMessages = project.messages.filter((message) => !isBlankTextMessage(message));

  const adminAvatar = adminAvatarAsset(project);
  setAvatarImage(elements.previewRailAvatar, adminAvatar, "管理员");
  if (elements.previewRailAvatarButton) {
    elements.previewRailAvatarButton.title = "切换管理员头像";
    elements.previewRailAvatarButton.setAttribute("aria-label", "切换管理员头像");
  }

  elements.chatScroll.innerHTML = previewMessages
    .map(messagePreviewHtml)
    .join("");
  elements.chatScroll.scrollLeft = 0;
  requestAnimationFrame(() => {
    elements.chatScroll.scrollTop = elements.chatScroll.scrollHeight;
  });
}

function applyChatBackground(project = state.project) {
  const target = elements.chatPanel;
  if (!target) return;
  const background = chatBackgroundAsset(project);
  if (background) {
    target.style.setProperty("--chat-background", `url("${assetFullUrl(background)}")`);
    target.classList.add("has-background");
  } else {
    target.style.removeProperty("--chat-background");
    target.classList.remove("has-background");
  }
}

function setAvatarImage(node, asset, name) {
  if (!node) return;
  if (asset) {
    node.textContent = "";
    node.style.backgroundImage = `url("${assetUrl(asset)}")`;
    node.classList.add("has-image");
    return;
  }
  node.textContent = (name || "?").slice(0, 1) || "?";
  node.style.backgroundImage = "";
  node.classList.remove("has-image");
}

function messageAvatarHtml(message, project = state.project) {
  const speaker = messageSpeaker(message, project);
  const name = speaker.name || "角色名";
  return `<div class="message-avatar avatar-frame" aria-hidden="true">${contactAvatarHtml(speaker)}</div>`;
}

function messageSpeakerNameHtml(message) {
  if (message?.type === "image" || !shouldShowSpeakerName(message)) return "";
  const speaker = messageSpeaker(message);
  return `<span class="message-speaker">${escapeHtml(speaker.name)}</span>`;
}

function messageSpeakerAttributes(message, project = state.project) {
  const speaker = messageSpeaker(message, project);
  return [
    `data-speaker-id="${escapeHtml(speaker.id ?? "")}"`,
    `data-speaker-name="${escapeHtml(speaker.name ?? "")}"`,
    `data-speaker-asset-id="${escapeHtml(speaker.asset_id ?? "")}"`,
  ].join(" ");
}

// 聊天预览与消息展示。
function messagePreviewHtml(message) {
  const sideClass = message.side === "right" ? "right" : message.side === "center" ? "center" : "left";
  if (message.type === "text") {
    const longTextStack = String(message.text || "").length >= 60 ? " long-text-stack" : "";
    return `
      <div class="chat-row ${sideClass} text-row${isAdminMessage(message) ? " admin-message" : " character-message"}" ${messageSpeakerAttributes(message)}>
        ${messageAvatarHtml(message)}
        <div class="message-stack${longTextStack}">
          ${messageSpeakerNameHtml(message)}
          <div class="bubble"><span class="bubble-text">${escapeHtml(message.text).replaceAll("\n", "<br>")}</span></div>
        </div>
      </div>
    `;
  }
  if (message.type === "sticker") {
    const asset = findAsset(message.asset_id);
    return `
      <div class="chat-row ${sideClass} media-row sticker-row" ${messageSpeakerAttributes(message)}>
        ${messageAvatarHtml(message)}
        <div class="message-stack">
          ${messageSpeakerNameHtml(message)}
          <div class="sticker-frame">
            ${asset ? `<img class="chat-sticker" src="${escapeHtml(assetFullUrl(asset))}" alt="" />` : '<div class="missing-media">贴纸缺失</div>'}
          </div>
        </div>
      </div>
    `;
  }
  if (message.type === "image") {
    const imageUrl = messageImageUrl(message);
    const ratio = Number(message.width) > 0 && Number(message.height) > 0
      ? Number(message.width) / Number(message.height)
      : 1;
    return `
      <div class="chat-row ${sideClass} media-row image-row" ${messageSpeakerAttributes(message)}>
        ${messageAvatarHtml(message)}
        <div class="message-stack">
          ${messageSpeakerNameHtml(message)}
          ${imageUrl
            ? `<img class="chat-image" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(message.name || "图片")}" style="--image-ratio: ${ratio};" />`
            : '<div class="missing-media">图片缺失</div>'}
        </div>
      </div>
    `;
  }
  if (message.type === "system") {
    return `
      <div class="chat-row center system-row">
        <div class="system-line">${escapeHtml(message.text || "")}</div>
      </div>
    `;
  }
  if (message.type === "recall") {
    return `
      <div class="chat-row center system-row recall-row">
        <div class="system-line recall">${escapeHtml(message.text || "")}</div>
      </div>
    `;
  }
  return "";
}

function addMessage() {
  if (!state.project) return;
  const message = defaultMessage("system");
  message.text = "系统提示";
  state.selectedMessageId = message.id;
  updateProject((project) => {
    project.messages.push(message);
  });
  document.getElementById("messageTextInput")?.focus();
}

function deleteMessage(messageId) {
  if (!state.project) return;
  const index = state.project.messages.findIndex((message) => message.id === messageId);
  if (index < 0) return;
  const wasSelected = state.selectedMessageId === messageId;
  state.project.messages.splice(index, 1);
  if (wasSelected) {
    state.selectedMessageId =
      state.project.messages[index]?.id ||
      state.project.messages[index - 1]?.id ||
      null;
  }
  updateProject(() => {});
}

function moveMessage(messageId, offset) {
  updateProject((project) => {
    const index = project.messages.findIndex((message) => message.id === messageId);
    const nextIndex = index + offset;
    if (index < 0 || nextIndex < 0 || nextIndex >= project.messages.length) return;
    const [message] = project.messages.splice(index, 1);
    project.messages.splice(nextIndex, 0, message);
  });
  renderAll();
}

function openAssetModal(category, targetMessageId = null, options = {}) {
  const isMessageAsset = Boolean(targetMessageId);
  const composeSticker = Boolean(options.composeSticker);
  state.assetModal.category = category;
  state.assetModal.mode = composeSticker ? "composeSticker" : isMessageAsset ? "message" : category;
  state.assetModal.targetMessageId = targetMessageId;
  state.assetModal.composeSticker = composeSticker;
  state.assetModal.page = 0;
  state.assetModal.query = "";
  state.assetModal.stickerCategoryId = null;
  state.assetModal.stickerOffset = 0;
  elements.assetModalTitle.textContent = composeSticker
    ? "选择表情"
    : isMessageAsset
      ? "选择贴纸"
      : category === "adminAvatar"
        ? "选择管理员头像"
        : category === "bubble"
          ? "选择聊天气泡"
          : "选择背景";
  elements.assetSearchInput.value = "";
  // 管理员头像只有 7 个，不需要分类下拉与搜索栏。
  const showToolbar = !isMessageAsset && !composeSticker && category !== "adminAvatar";
  elements.assetPagination.classList.add("hidden");
  const categories = isMessageAsset || composeSticker
    ? []
    : category === "adminAvatar"
      ? [["admin_avatars", "管理员头像"]]
      : category === "bubble"
        ? [["bubble", "聊天气泡"]]
        : [["backgrounds", "聊天背景"]];
  elements.assetCategorySelect.innerHTML = categories.length
    ? categories
        .map(([value, label]) => `<option value="${value}">${label}</option>`)
        .join("")
    : "";
  state.assetModal.category = categories[0]?.[0] || category;
  elements.assetToolbar.classList.toggle("hidden", !showToolbar);
  elements.assetModal.classList.remove("hidden");
  renderAssetGrid();
}

function closeAssetModal() {
  elements.assetModal.classList.add("hidden");
}

async function renderAssetGrid() {
  if (!state.project) return;
  elements.assetGrid.innerHTML = '<p class="empty-state">素材加载中。</p>';
  elements.assetModalStatus.textContent = "";
  elements.assetPagination.classList.add("hidden");
  try {
    if (
      (state.assetModal.mode === "message" || state.assetModal.mode === "composeSticker") &&
      state.assetModal.category === "sticker"
    ) {
      await renderStickerGrid();
      return;
    }
    if (state.assetModal.category === "admin_avatars") {
      renderAdminAvatarGrid();
      return;
    }
    if (state.assetModal.category === "bubble") {
      renderBubbleThemeGrid();
      return;
    }
    const params = new URLSearchParams({
      category: state.assetModal.category,
      limit: "120",
    });
    if (state.assetModal.query) params.set("q", state.assetModal.query);
    const payload = await api(`/assets?${params.toString()}`);
    const items = state.assetModal.category === "backgrounds"
      ? payload.items.filter((asset) => CHAT_BACKGROUND_ASSET_IDS.has(asset.id))
      : payload.items;
    cacheAssets(items);
    if (!items.length) {
      elements.assetGrid.innerHTML = '<p class="empty-state">没有匹配素材。</p>';
      return;
    }
    elements.assetGrid.innerHTML = items
      .map(
        (asset) => `
          <button class="asset-card ${asset.id === chatBackgroundAsset()?.id ? "active" : ""}" type="button" data-asset-id="${escapeHtml(asset.id)}">
            <img src="${escapeHtml(assetUrl(asset))}" alt="" loading="lazy" />
            <span>${escapeHtml(asset.label || asset.name || asset.id)}</span>
          </button>
        `,
      )
      .join("");
    elements.assetModalStatus.textContent = `显示 ${items.length} 个可用聊天背景`;
  } catch (error) {
    elements.assetGrid.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
  }
}

function renderBubbleThemeGrid() {
  const themes = state.bubbleThemes.themes;
  if (!themes.length) {
    elements.assetGrid.innerHTML = '<p class="empty-state">\u6ca1\u6709\u53ef\u7528\u7684\u6c14\u6ce1\u4e3b\u9898\u3002</p>';
    return;
  }
  const activeId = currentBubbleThemeId(state.project);
  elements.assetGrid.innerHTML = themes
    .map((theme) => {
      const preview = (theme.variants && (theme.variants.right || theme.variants.left)) || null;
      if (!preview) return "";
      const incomplete = theme.composition_complete === false;
      const active = !incomplete && String(theme.id) === String(activeId) ? " active" : "";
      const label = preview.width + "\u00d7" + preview.height + (incomplete ? " \u00b7 \u7ec4\u4ef6\u5f85\u5408\u6210" : "");
      const themeName = bubbleThemeLabel(theme);
      return `
        <button class="asset-card${active}" type="button" data-bubble-theme-id="${escapeHtml(theme.id)}"${incomplete ? " disabled" : ""}>
          <img src="${escapeHtml(preview.url)}" alt="" loading="lazy" />
          <span>${escapeHtml(themeName)}</span>
          <small>${escapeHtml(`${theme.id} \u00b7 ${label}`)}</small>
        </button>
      `;
    })
    .join("");
  elements.assetModalStatus.textContent = `\u5171 ${themes.length} \u4e2a\u6c14\u6ce1\u4e3b\u9898`;
}

function chooseBubbleTheme(themeId) {
  if (!themeId) return;
  updateProject((project) => {
    project.appearance.bubble_theme_id = themeId;
  });
  applyBubbleTheme(themeId);
  closeAssetModal();
}

async function renderStickerGrid() {
  if (state.assetModal.stickerCategoryId === null) {
    await renderStickerCategoryGrid();
  } else {
    await renderStickerCategoryStickers();
  }
}

async function renderStickerCategoryGrid() {
  const payload = await api("/sticker-categories");
  const categories = (payload.items || []).filter((category) => !category.disabled);
  if (!categories.length) {
    elements.assetGrid.innerHTML = '<p class="empty-state">没有可用的表情分类。</p>';
    return;
  }
  elements.assetGrid.innerHTML = categories
    .map((category) => {
      const icon = category.icon;
      return `
        <button class="asset-card category-card" type="button" data-sticker-category-id="${escapeHtml(category.id)}">
          ${
            icon
              ? `<img src="${escapeHtml(assetUrl(icon))}" alt="" loading="lazy" />`
              : `<span class="asset-card-placeholder">?</span>`
          }
        </button>
      `;
    })
    .join("");
  elements.assetModalStatus.textContent = `显示 ${categories.length} 个表情分类`;
}

async function renderStickerCategoryStickers() {
  const params = new URLSearchParams({
    offset: String(state.assetModal.stickerOffset),
    limit: String(state.assetModal.stickerLimit),
  });
  const payload = await api(
    `/sticker-categories/${encodeURIComponent(state.assetModal.stickerCategoryId)}/stickers?${params.toString()}`,
  );
  const items = payload.items || [];
  cacheAssets(items);
  const backButton = `
    <button class="asset-card sticker-back-card" type="button" data-sticker-back>
      <span>返回分类</span>
    </button>
  `;
  if (!items.length) {
    elements.assetGrid.innerHTML = `${backButton}<p class="empty-state">这个分类暂时没有可用贴纸。</p>`;
    return;
  }
  elements.assetGrid.innerHTML =
    backButton +
    items
      .map(
        (asset) => `
          <button class="asset-card sticker-card" type="button" data-asset-id="${escapeHtml(asset.id)}">
            <img src="${escapeHtml(assetUrl(asset))}" alt="" loading="lazy" />
          </button>
        `,
      )
      .join("");
  updateStickerPagination(payload);
  const start = payload.total ? payload.offset + 1 : 0;
  const end = payload.offset + items.length;
  elements.assetModalStatus.textContent = `显示 ${start}-${end} / ${payload.total} 个贴纸`;
}

function updateStickerPagination(payload) {
  const total = Number(payload.total || 0);
  const offset = Number(payload.offset || 0);
  const limit = Number(payload.limit || state.assetModal.stickerLimit);
  const page = Math.floor(offset / limit) + 1;
  const pageCount = Math.max(1, Math.ceil(total / limit));
  elements.assetPagination.classList.toggle("hidden", total <= limit);
  elements.assetPageLabel.textContent = `第 ${page} / ${pageCount} 页`;
  elements.assetPrevPage.disabled = offset <= 0;
  elements.assetNextPage.disabled = offset + limit >= total;
}

function renderAdminAvatarGrid() {
  const query = String(state.assetModal.query || "").trim().toLowerCase();
  const assets = ADMIN_AVATAR_ASSET_IDS
    .map((assetId) => findAsset(assetId))
    .filter(Boolean)
    .filter((asset) => {
      if (!query) return true;
      return (
        String(asset.id || "").toLowerCase().includes(query) ||
        String(asset.label || asset.name || "").toLowerCase().includes(query)
      );
    });
  if (!assets.length) {
    elements.assetGrid.innerHTML = '<p class="empty-state">没有匹配的管理员头像。</p>';
    return;
  }
  elements.assetGrid.innerHTML = assets
    .map((asset, index) => {
      const selected = asset.id === adminAvatarAssetId();
      return `
        <button class="asset-card ${selected ? "active" : ""}" type="button" data-asset-id="${escapeHtml(asset.id)}">
          <img src="${escapeHtml(assetUrl(asset))}" alt="" loading="lazy" />
          <span>管理员 ${String(index + 1).padStart(2, "0")}</span>
        </button>
      `;
    })
    .join("");
  elements.assetModalStatus.textContent = `显示 ${assets.length} 个管理员头像`;
}

function chooseAsset(assetId) {
  if (!assetId) return;
  const modal = state.assetModal;
  if (modal.mode === "composeSticker") {
    sendStickerMessage(assetId);
  } else if (modal.mode === "message" && modal.targetMessageId) {
    updateMessage(modal.targetMessageId, (message) => {
      message.asset_id = assetId;
    });
  } else if (modal.mode === "adminAvatar") {
    updateProject((project) => {
      project.appearance.admin_avatar_asset_id = assetId;
    });
  } else if (modal.mode === "backgrounds") {
    updateProject((project) => {
      project.appearance.background_asset_id = assetId;
    });
  }
  closeAssetModal();
}

function resizeDirectMessageInput() {
  const input = elements.directMessageInput;
  if (!input) return;
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 112)}px`;
}

function showEmptyMessageModal() {
  if (!elements.emptyMessageModal) return;
  elements.emptyMessageModal.classList.remove("hidden");
  elements.emptyMessageModalClose?.focus();
}

function hideEmptyMessageModal() {
  if (!elements.emptyMessageModal) return;
  elements.emptyMessageModal.classList.add("hidden");
  elements.directMessageInput?.focus();
}

function groupContacts() {
  return sortedContacts().filter((contact) => contact.kind === "group");
}

function currentManagedGroup() {
  return findContact(state.groupDraft.groupId);
}

function groupDraftContact() {
  const managed = state.groupDraft.mode === "manage" ? currentManagedGroup() : null;
  const memberIds = state.groupDraft.memberIds
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value));
  return {
    id: managed?.id ?? "__group_draft__",
    name: managed?.name || state.groupDraft.name.trim() || groupDisplayName(state.groupDraft.name),
    kind: "group",
    asset_id: managed?.asset_id ?? null,
    member_ids: memberIds,
  };
}

function resetGroupDraft(mode = "create") {
  state.groupDraft.mode = mode;
  state.groupDraft.groupId = null;
  state.groupDraft.name = "";
  state.groupDraft.memberIds = [];
  state.groupDraft.query = "";
  state.groupDraft.page = 0;
  state.groupDraft.submitting = false;
  state.groupDraft.deleteArmed = false;
}

function loadManagedGroup(groupId) {
  const group = findContact(groupId);
  if (!group || group.kind !== "group") return;
  state.groupDraft.groupId = group.id;
  state.groupDraft.memberIds = contactMemberIds(group);
  state.groupDraft.query = "";
  state.groupDraft.page = 0;
  state.groupDraft.deleteArmed = false;
}

function openGroupCreate() {
  resetGroupDraft("create");
  if (elements.groupNameInput) elements.groupNameInput.value = "";
  if (elements.groupMemberSearch) elements.groupMemberSearch.value = "";
  elements.groupModalStatus.textContent = "";
  elements.groupModal.classList.remove("hidden");
  renderGroupModal();
  requestAnimationFrame(() => elements.groupNameInput?.focus());
}

function openGroupManager() {
  resetGroupDraft("manage");
  const groups = groupContacts();
  if (groups.length) loadManagedGroup(groups[0].id);
  if (elements.groupMemberSearch) elements.groupMemberSearch.value = "";
  elements.groupModalStatus.textContent = "";
  elements.groupModal.classList.remove("hidden");
  renderGroupModal();
  requestAnimationFrame(() => elements.groupManagerSelect?.focus());
}

function closeGroupModal() {
  elements.groupModal.classList.add("hidden");
  if (elements.newGroupButton) elements.newGroupButton.focus();
}

function filteredGroupMembers() {
  const query = state.groupDraft.query.trim().toLowerCase();
  return heroContacts().filter((contact) => {
    if (!query) return true;
    return (
      contactDisplayName(contact).toLowerCase().includes(query) ||
      String(contact.id ?? "").toLowerCase().includes(query)
    );
  });
}

function renderGroupMemberList() {
  const contacts = filteredGroupMembers();
  const pageCount = Math.max(1, Math.ceil(contacts.length / GROUP_MEMBER_PAGE_SIZE));
  state.groupDraft.page = Math.min(Math.max(state.groupDraft.page, 0), pageCount - 1);
  const page = state.groupDraft.page;
  const start = page * GROUP_MEMBER_PAGE_SIZE;
  const pageContacts = contacts.slice(start, start + GROUP_MEMBER_PAGE_SIZE);

  if (elements.groupMemberPagination) {
    elements.groupMemberPagination.classList.toggle("hidden", contacts.length <= GROUP_MEMBER_PAGE_SIZE);
    elements.groupPageLabel.textContent = `第 ${page + 1} / ${pageCount} 页`;
    elements.groupPrevPage.disabled = page <= 0;
    elements.groupNextPage.disabled = page >= pageCount - 1;
  }

  if (!contacts.length) {
    elements.groupMemberList.innerHTML = '<p class="empty-state">没有匹配成员。</p>';
    return;
  }
  const selected = new Set(state.groupDraft.memberIds.map(String));
  elements.groupMemberList.innerHTML = pageContacts
    .map((contact) => {
      const active = selected.has(String(contact.id));
      return `
        <button class="group-member-card ${active ? "active" : ""}" type="button" data-group-member-id="${escapeHtml(contact.id)}" aria-pressed="${active ? "true" : "false"}">
          <span class="group-member-avatar">${contactAvatarHtml(contact, { loading: "lazy" })}</span>
          <span class="group-member-name">${escapeHtml(contactDisplayName(contact))}</span>
          <span class="group-member-check" aria-hidden="true">${active ? "✓" : "+"}</span>
        </button>
      `;
    })
    .join("");
}

function changeGroupMemberPage(offset) {
  const pageCount = Math.max(1, Math.ceil(filteredGroupMembers().length / GROUP_MEMBER_PAGE_SIZE));
  const nextPage = Math.min(Math.max(state.groupDraft.page + offset, 0), pageCount - 1);
  if (nextPage === state.groupDraft.page) return;
  state.groupDraft.page = nextPage;
  renderGroupMemberList();
}

function renderGroupModal() {
  const managing = state.groupDraft.mode === "manage";
  const groups = groupContacts();
  const managedGroup = managing ? currentManagedGroup() : null;
  const draft = groupDraftContact();
  const selectedCount = state.groupDraft.memberIds.length;

  elements.groupModalEyebrow.textContent = managing ? "Group Management" : "New Group Chat";
  elements.groupModalTitle.textContent = managing ? "群聊管理" : "新建群聊";
  elements.groupNameRow?.classList.toggle("hidden", managing);
  elements.groupManagerRow?.classList.toggle("hidden", !managing);
  elements.createGroupButton?.classList.toggle("hidden", managing);
  elements.saveGroupButton?.classList.toggle("hidden", !managing);
  elements.deleteGroupButton?.classList.toggle("hidden", !managing);
  elements.cancelGroupButton.textContent = managing ? "关闭" : "取消";

  if (managing) {
    elements.groupManagerSelect.innerHTML = groups.length
      ? groups
          .map((group) => {
            const kindLabel = group.custom ? "自建" : "内置";
            return `<option value="${escapeHtml(group.id)}">${escapeHtml(`[${kindLabel}] ${contactDisplayName(group)}`)}</option>`;
          })
          .join("")
      : '<option value="">暂无群聊</option>';
    elements.groupManagerSelect.value = managedGroup ? String(managedGroup.id) : "";
    elements.groupManagerSelect.disabled = !groups.length || state.groupDraft.submitting;
  }

  elements.groupPreviewName.textContent = managedGroup
    ? contactDisplayName(managedGroup)
    : groupDisplayName(state.groupDraft.name);
  elements.groupPreviewCount.textContent = `已选择 ${selectedCount} 名成员`;
  elements.groupSelectedCount.textContent = `${selectedCount} 人`;
  renderAvatarNode(elements.groupAvatarPreview, draft);
  renderGroupMemberList();

  const invalid = selectedCount < MIN_GROUP_MEMBERS;
  elements.createGroupButton.disabled = state.groupDraft.submitting;
  elements.createGroupButton.textContent = state.groupDraft.submitting ? "创建中..." : "创建群聊";
  if (elements.saveGroupButton) {
    elements.saveGroupButton.disabled = state.groupDraft.submitting || !managedGroup;
    elements.saveGroupButton.textContent = state.groupDraft.submitting ? "保存中..." : "保存修改";
  }
  if (elements.deleteGroupButton) {
    elements.deleteGroupButton.disabled = state.groupDraft.submitting || !managedGroup;
    elements.deleteGroupButton.textContent = state.groupDraft.deleteArmed ? "确认删除" : "删除群聊";
    elements.deleteGroupButton.classList.toggle("armed", state.groupDraft.deleteArmed);
  }
}

function toggleGroupMember(contactId) {
  const id = String(contactId);
  const selected = new Set(state.groupDraft.memberIds.map(String));
  if (selected.has(id)) {
    selected.delete(id);
  } else {
    const contact = findContact(contactId);
    if (!contact || contact.kind === "group") return;
    selected.add(id);
  }
  state.groupDraft.memberIds = [...selected].map(Number);
  state.groupDraft.deleteArmed = false;
  elements.groupModalStatus.textContent = "";
  renderGroupModal();
}

async function submitGroupCreation() {
  if (state.groupDraft.submitting) return;
  const name = state.groupDraft.name.trim();
  if (!name) {
    elements.groupModalStatus.textContent = "群名不能为空";
    elements.groupNameInput?.focus();
    return;
  }
  if (state.groupDraft.memberIds.length < MIN_GROUP_MEMBERS) {
    elements.groupModalStatus.textContent = "至少选择两名成员";
    return;
  }
  state.groupDraft.submitting = true;
  renderGroupModal();
  try {
    const group = await api("/groups", {
      method: "POST",
      body: JSON.stringify({
        name,
        member_ids: state.groupDraft.memberIds,
      }),
    });
    await loadContacts();
    await loadContactAvatars();
    closeGroupModal();
    if (!state.project) {
      await createProject();
    } else {
      selectRole(group.id);
    }
    showToast(`已创建群聊：${contactDisplayName(group)}`);
  } catch (error) {
    elements.groupModalStatus.textContent = error.message;
  } finally {
    state.groupDraft.submitting = false;
    if (!elements.groupModal.classList.contains("hidden")) renderGroupModal();
  }
}

async function saveManagedGroup() {
  if (state.groupDraft.mode !== "manage" || !state.groupDraft.groupId || state.groupDraft.submitting) {
    return;
  }
  if (state.groupDraft.memberIds.length < MIN_GROUP_MEMBERS) {
    elements.groupModalStatus.textContent = "至少选择两名成员";
    return;
  }
  const groupId = state.groupDraft.groupId;
  state.groupDraft.submitting = true;
  elements.groupModalStatus.textContent = "";
  renderGroupModal();
  try {
    const updated = await api(`/groups/${encodeURIComponent(groupId)}`, {
      method: "PUT",
      body: JSON.stringify({ member_ids: state.groupDraft.memberIds }),
    });
    await loadContacts();
    await loadContactAvatars();
    state.groupDraft.groupId = updated.id;
    state.groupDraft.memberIds = contactMemberIds(updated);
    if (state.project && String(state.project.contact.contact_id) === String(updated.id)) {
      selectRole(updated.id);
    } else {
      renderAll();
    }
    renderGroupModal();
    elements.groupModalStatus.textContent = "群成员已保存";
    showToast(`已更新群聊：${contactDisplayName(updated)}`);
  } catch (error) {
    elements.groupModalStatus.textContent = error.message;
  } finally {
    state.groupDraft.submitting = false;
    if (!elements.groupModal.classList.contains("hidden")) renderGroupModal();
  }
}

async function deleteManagedGroup() {
  if (state.groupDraft.mode !== "manage" || !state.groupDraft.groupId || state.groupDraft.submitting) {
    return;
  }
  if (!state.groupDraft.deleteArmed) {
    state.groupDraft.deleteArmed = true;
    elements.groupModalStatus.textContent = "再次点击“确认删除”将删除该群聊。";
    renderGroupModal();
    return;
  }
  const groupId = state.groupDraft.groupId;
  const groupName = contactDisplayName(currentManagedGroup());
  state.groupDraft.submitting = true;
  renderGroupModal();
  try {
    await api(`/groups/${encodeURIComponent(groupId)}`, { method: "DELETE", body: "{}" });
    const wasActive = state.project && String(state.project.contact.contact_id) === String(groupId);
    await loadContacts();
    await loadContactAvatars();
    const remaining = groupContacts();
    if (wasActive) {
      const fallback = sortedContacts()[0];
      if (fallback) selectRole(fallback.id);
    }
    if (remaining.length) {
      loadManagedGroup(remaining[0].id);
      elements.groupModalStatus.textContent = `已删除群聊：${groupName}`;
      renderGroupModal();
    } else {
      closeGroupModal();
    }
    renderAll();
    showToast(`已删除群聊：${groupName}`);
  } catch (error) {
    elements.groupModalStatus.textContent = error.message;
  } finally {
    state.groupDraft.submitting = false;
    state.groupDraft.deleteArmed = false;
    if (!elements.groupModal.classList.contains("hidden")) renderGroupModal();
  }
}

function showPowerConfirm() {
  if (!elements.powerConfirmModal) return;
  elements.powerConfirmModal.classList.remove("hidden");
  elements.powerConfirmCancel?.focus();
}

function hidePowerConfirm() {
  if (!elements.powerConfirmModal) return;
  elements.powerConfirmModal.classList.add("hidden");
  elements.powerButton?.focus();
}

function showShutdownNotice() {
  elements.powerConfirmModal?.classList.add("hidden");
  elements.shutdownNotice?.classList.remove("hidden");
  document.body.classList.add("webui-closed");
}

async function confirmShutdown() {
  if (state.shuttingDown) return;
  state.shuttingDown = true;
  if (elements.powerConfirmAccept) elements.powerConfirmAccept.disabled = true;
  try {
    await saveProject({ quiet: true });
    const response = await fetch(`${API}/shutdown`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!response.ok) {
      throw new Error(`关闭失败（HTTP ${response.status}）`);
    }
    showShutdownNotice();
    showToast("WebUI 已关闭");
    // 浏览器只允许脚本关闭由脚本自己打开的窗口。
    // 如果关闭请求被拒绝，保持终止状态可见，避免误导用户。
    window.setTimeout(() => window.close(), 120);
  } catch (error) {
    state.shuttingDown = false;
    if (elements.powerConfirmAccept) elements.powerConfirmAccept.disabled = false;
    hidePowerConfirm();
    showToast(error.message, "error");
  }
}

function sendDirectMessage() {
  if (!state.project || !elements.directMessageInput) return;
  const text = elements.directMessageInput.value.trim();
  if (!text) {
    showEmptyMessageModal();
    return;
  }
  const speaker = currentSpeaker(state.project);
  const admin = isAdminSpeaker(speaker);
  const message = defaultMessage("text", admin ? "right" : "left");
  message.text = text;
  if (admin) {
    message.speaker_id = null;
    message.speaker_name = adminSpeaker().name;
  } else if (speaker) {
    message.speaker_id = speaker.id ?? null;
    message.speaker_name = contactDisplayName(speaker);
    message.speaker_asset_id = speaker.asset_id || null;
  }
  state.selectedMessageId = message.id;
  updateProject((project) => {
    project.messages.push(message);
  });
  elements.directMessageInput.value = "";
  resizeDirectMessageInput();
  elements.directMessageInput.focus();
}

function pickStaticImage(target) {
  if (!state.project || !elements.chatImageInput) return;
  state.imageUploadTarget = target;
  elements.chatImageInput.value = "";
  elements.chatImageInput.click();
}

function loadImageDimensions(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取图片，请更换静态图片"));
    };
    image.src = url;
  });
}

async function uploadStaticImage(file, dimensions) {
  const response = await fetch(`${API}/uploads/images`, {
    method: "POST",
    headers: {
      "Content-Type": file.type,
      "X-File-Name": encodeURIComponent(file.name || "image"),
    },
    body: file,
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || `图片上传失败：${response.status}`);
  }
  return { ...payload, ...dimensions };
}

function applyImageFields(message, uploaded) {
  message.file_id = uploaded.file_id;
  message.name = uploaded.name;
  message.width = uploaded.width;
  message.height = uploaded.height;
}

function sendImageMessage(uploaded) {
  if (!state.project) return;
  const speaker = currentSpeaker(state.project);
  const admin = isAdminSpeaker(speaker);
  const message = defaultMessage("image", admin ? "right" : "left");
  applyImageFields(message, uploaded);
  if (admin) {
    message.speaker_id = null;
    message.speaker_name = adminSpeaker().name;
  } else if (speaker) {
    message.speaker_id = speaker.id ?? null;
    message.speaker_name = contactDisplayName(speaker);
    message.speaker_asset_id = speaker.asset_id || null;
  }
  state.selectedMessageId = message.id;
  updateProject((project) => {
    project.messages.push(message);
  });
  showToast("图片已发送");
}

async function handleStaticImageSelection(file) {
  if (!file || !state.project) return;
  const target = state.imageUploadTarget || { kind: "composer" };
  try {
    if (!STATIC_IMAGE_MIME_TYPES.has(file.type)) {
      throw new Error("仅支持 PNG、JPG、JPEG 静态图片");
    }
    if (file.size > MAX_STATIC_IMAGE_BYTES) {
      throw new Error("图片不能超过 8 MiB");
    }
    const dimensions = await loadImageDimensions(file);
    if (!dimensions.width || !dimensions.height) {
      throw new Error("无法读取图片尺寸");
    }
    const uploaded = await uploadStaticImage(file, dimensions);
    if (target.kind === "message" && target.messageId) {
      updateMessage(target.messageId, (message) => {
        applyImageFields(message, uploaded);
      });
      showToast("图片已更新");
    } else {
      sendImageMessage(uploaded);
    }
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.imageUploadTarget = null;
    if (elements.chatImageInput) elements.chatImageInput.value = "";
  }
}

function sendStickerMessage(assetId) {
  if (!state.project || !assetId) return;
  const speaker = currentSpeaker(state.project);
  const admin = isAdminSpeaker(speaker);
  const message = defaultMessage("sticker", admin ? "right" : "left");
  message.asset_id = assetId;
  if (admin) {
    message.speaker_id = null;
    message.speaker_name = adminSpeaker().name;
  } else if (speaker) {
    message.speaker_id = speaker.id ?? null;
    message.speaker_name = contactDisplayName(speaker);
    message.speaker_asset_id = speaker.asset_id || null;
  }
  state.selectedMessageId = message.id;
  updateProject((project) => {
    project.messages.push(message);
  });
}

const canvasImageCache = new Map();

function loadCanvasImage(url) {
  if (!url) return Promise.resolve(null);
  if (!canvasImageCache.has(url)) {
    canvasImageCache.set(
      url,
      new Promise((resolve) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = url;
      }),
    );
  }
  return canvasImageCache.get(url);
}

function canvasTextLines(ctx, value, maxWidth) {
  const lines = [];
  const paragraphs = String(value ?? "").split(/\r?\n/);
  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    const characters = Array.from(paragraph);
    let current = "";
    for (const character of characters) {
      const candidate = current + character;
      if (current && ctx.measureText(candidate).width > maxWidth) {
        lines.push(current);
        current = character;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }
  return lines.length ? lines : [""];
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  const corner = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + corner, y);
  ctx.lineTo(x + width - corner, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + corner);
  ctx.lineTo(x + width, y + height - corner);
  ctx.quadraticCurveTo(x + width, y + height, x + width - corner, y + height);
  ctx.lineTo(x + corner, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - corner);
  ctx.lineTo(x, y + corner);
  ctx.quadraticCurveTo(x, y, x + corner, y);
  ctx.closePath();
}

function drawCanvasCover(ctx, image, x, y, width, height) {
  if (!image || image.naturalWidth <= 0 || image.naturalHeight <= 0) return;
  const sourceRatio = image.naturalWidth / image.naturalHeight;
  const targetRatio = width / height;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = image.naturalWidth;
  let sourceHeight = image.naturalHeight;
  if (sourceRatio > targetRatio) {
    sourceWidth = image.naturalHeight * targetRatio;
    sourceX = (image.naturalWidth - sourceWidth) / 2;
  } else {
    sourceHeight = image.naturalWidth / targetRatio;
    sourceY = (image.naturalHeight - sourceHeight) / 2;
  }
  ctx.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    x,
    y,
    width,
    height,
  );
}

function drawCanvasContain(ctx, image, x, y, width, height) {
  if (!image || image.naturalWidth <= 0 || image.naturalHeight <= 0) return;
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  ctx.drawImage(
    image,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

const DEFAULT_BUBBLE_NINE_SLICE = Object.freeze({ top: 57, right: 63, bottom: 30, left: 63 });
let BUBBLE_NINE_SLICE_LEFT = { ...DEFAULT_BUBBLE_NINE_SLICE };
let BUBBLE_NINE_SLICE_RIGHT = { ...DEFAULT_BUBBLE_NINE_SLICE };
let BUBBLE_TEXT_COLOR_LEFT = "#303b4b";
let BUBBLE_TEXT_COLOR_RIGHT = "#303b4b";

function bubbleNineSlice(side, speakerIsAdmin = true) {
  if (!speakerIsAdmin) return DEFAULT_BUBBLE_NINE_SLICE;
  return side === "left" ? BUBBLE_NINE_SLICE_LEFT : BUBBLE_NINE_SLICE_RIGHT;
}

function bubbleTextHorizontalPadding(side = "right", speakerIsAdmin = true) {
  const slice = bubbleNineSlice(side, speakerIsAdmin);
  return {
    left: Math.max(BUBBLE_TEXT_PADDING_X, Math.round(slice.left * 0.72)),
    right: Math.max(BUBBLE_TEXT_PADDING_X, Math.round(slice.right * 0.72)),
  };
}

function bubbleSpeakerHorizontalPadding(side = "left", speakerIsAdmin = true) {
  const slice = bubbleNineSlice(side, speakerIsAdmin);
  return Math.max(18, Math.round(slice.left * 0.68));
}

// PNG 导出绘制工具。
function drawNineSlice(ctx, image, x, y, width, height, slice) {
  if (!image || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    ctx.fillStyle = "#f3f5f7";
    roundedRectPath(ctx, x, y, width, height, 16);
    ctx.fill();
    return;
  }
  const spec = typeof slice === "number"
    ? { top: slice, right: slice, bottom: slice, left: slice }
    : slice;
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  const edgeLeft = Math.min(spec.left, sourceWidth / 2);
  const edgeRight = Math.min(spec.right, sourceWidth / 2);
  const edgeTop = Math.min(spec.top, sourceHeight / 2);
  const edgeBottom = Math.min(spec.bottom, sourceHeight / 2);
  const targetLeft = Math.min(edgeLeft, width / 2);
  const targetRight = Math.min(edgeRight, width / 2);
  const targetTop = Math.min(edgeTop, height / 2);
  const targetBottom = Math.min(edgeBottom, height / 2);
  const sourceMiddleWidth = Math.max(0, sourceWidth - edgeLeft - edgeRight);
  const sourceMiddleHeight = Math.max(0, sourceHeight - edgeTop - edgeBottom);
  const targetMiddleWidth = Math.max(0, width - targetLeft - targetRight);
  const targetMiddleHeight = Math.max(0, height - targetTop - targetBottom);
  const drawPart = (sx, sy, sw, sh, dx, dy, dw, dh) => {
    if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
    ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
  };
  const midDx = x + targetLeft;
  const midDy = y + targetTop;
  const midRightX = x + width - targetRight;
  const midBottomY = y + height - targetBottom;
  drawPart(0, 0, edgeLeft, edgeTop, x, y, targetLeft, targetTop);
  drawPart(sourceWidth - edgeRight, 0, edgeRight, edgeTop, midRightX, y, targetRight, targetTop);
  drawPart(0, sourceHeight - edgeBottom, edgeLeft, edgeBottom, x, midBottomY, targetLeft, targetBottom);
  drawPart(sourceWidth - edgeRight, sourceHeight - edgeBottom, edgeRight, edgeBottom, midRightX, midBottomY, targetRight, targetBottom);
  drawPart(edgeLeft, 0, sourceMiddleWidth, edgeTop, midDx, y, targetMiddleWidth, targetTop);
  drawPart(edgeLeft, sourceHeight - edgeBottom, sourceMiddleWidth, edgeBottom, midDx, midBottomY, targetMiddleWidth, targetBottom);
  drawPart(0, edgeTop, edgeLeft, sourceMiddleHeight, x, midDy, targetLeft, targetMiddleHeight);
  drawPart(sourceWidth - edgeRight, edgeTop, edgeRight, sourceMiddleHeight, midRightX, midDy, targetRight, targetMiddleHeight);
  drawPart(edgeLeft, edgeTop, sourceMiddleWidth, sourceMiddleHeight, midDx, midDy, targetMiddleWidth, targetMiddleHeight);
}
function drawExportAvatarContent(ctx, x, y, size, content) {
  const inset = size * AVATAR_FRAME_INSET_RATIO;
  const contentX = x + inset;
  const contentY = y + inset;
  const contentSize = Math.max(0, size - inset * 2);
  ctx.save();
  roundedRectPath(
    ctx,
    contentX,
    contentY,
    contentSize,
    contentSize,
    size * AVATAR_FRAME_CORNER_RADIUS_RATIO,
  );
  ctx.clip();
  if (content.type === "image") {
    drawCanvasCover(ctx, content.image, x, y, size, size);
  } else if (content.type === "tiles") {
    for (const tile of content.tiles) {
      const tileX = contentX + tile.x * contentSize;
      const tileY = contentY + tile.y * contentSize;
      const tileWidth = tile.width * contentSize;
      const tileHeight = tile.height * contentSize;
      if (tile.image) {
        drawCanvasCover(ctx, tile.image, tileX, tileY, tileWidth, tileHeight);
      } else {
        ctx.fillStyle = "#dfe2e6";
        ctx.fillRect(tileX, tileY, tileWidth, tileHeight);
        ctx.fillStyle = "#5b6675";
        ctx.font = `700 ${Math.round(Math.min(tileWidth, tileHeight) * 0.42)}px ${MOMO_SANS_FONT_FAMILY}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(tile.text || "?", tileX + tileWidth / 2, tileY + tileHeight / 2);
      }
    }
  } else {
    ctx.fillStyle = "#dfe6ef";
    ctx.fillRect(contentX, contentY, contentSize, contentSize);
    ctx.fillStyle = "#667386";
    ctx.font = `700 ${Math.round(contentSize * 0.36)}px ${MOMO_SANS_FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      String(content.text || "?").slice(0, 1) || "?",
      contentX + contentSize / 2,
      contentY + contentSize / 2,
    );
  }
  ctx.restore();
}

function exportContactAvatarContent(contact, images) {
  if (!isGroupContact(contact)) {
    const asset = contactAvatarAsset(contact);
    const image = asset ? images.byUrl.get(assetFullUrl(asset)) : null;
    return image
      ? { type: "image", image }
      : { type: "text", text: contactDisplayName(contact).slice(0, 1) || "?" };
  }
  const layout = groupAvatarLayout(contact);
  if (layout.type === "text") {
    return { type: "text", text: layout.text };
  }
  if (layout.type === "asset") {
    const asset = contactAvatarAsset(layout.contact || contact);
    const image = asset ? images.byUrl.get(assetFullUrl(asset)) : null;
    return image
      ? { type: "image", image }
      : { type: "text", text: groupAvatarText(contact) };
  }
  if (layout.type === "single") {
    const asset = contactAvatarAsset(layout.members[0]);
    const image = asset ? images.byUrl.get(assetFullUrl(asset)) : null;
    return image
      ? { type: "image", image }
      : { type: "text", text: groupAvatarText(layout.members[0]) };
  }
  return {
    type: "tiles",
    tiles: layout.tiles.map((tile) => {
      const asset = contactAvatarAsset(tile.member);
      const image = asset ? images.byUrl.get(assetFullUrl(asset)) : null;
      return {
        x: tile.x,
        y: tile.y,
        width: tile.width,
        height: tile.height,
        image,
        text: groupAvatarText(tile.member),
      };
    }),
  };
}

function exportSpeakerMeta(message, project) {
  const speaker = messageSpeaker(message, project);
  const admin = isAdminMessage(message);
  return {
    speakerIsAdmin: admin,
    speakerName: shouldShowSpeakerName(message, project) ? speaker.name : "",
    speaker,
  };
}

function exportableMessages(messages = state.project?.messages || []) {
  return (Array.isArray(messages) ? messages : []).filter(
    (message) => !isBlankTextMessage(message),
  );
}

function fitImageDimensions(sourceWidth, sourceHeight, maxWidth, maxHeight) {
  const width = Math.max(1, Number(sourceWidth) || 1);
  const height = Math.max(1, Number(sourceHeight) || 1);
  const ratio = width / height;
  let displayWidth = maxWidth;
  let displayHeight = displayWidth / ratio;
  if (displayHeight > maxHeight) {
    displayHeight = maxHeight;
    displayWidth = displayHeight * ratio;
  }
  return {
    width: Math.max(1, Math.round(displayWidth)),
    height: Math.max(1, Math.round(displayHeight)),
  };
}

function buildChatExportLayout(ctx, project, messages = project.messages) {
  const width = 956;
  const headerHeight = 80;
  const bodyPaddingX = 16;
  const bodyPaddingTop = 24;
  const bodyPaddingBottom = 24;
  const rowGap = 20;
  const avatarSize = 76;
  const avatarGap = 15;
  const maxBubbleWidth = width - 2 * (avatarSize + avatarGap);
  const items = [];

  for (const message of exportableMessages(messages)) {
    if (message.type === "text") {
      const speaker = exportSpeakerMeta(message, project);
      const bubbleSlice = bubbleNineSlice(message.side, speaker.speakerIsAdmin);
      const bubblePadding = bubbleTextHorizontalPadding(message.side, speaker.speakerIsAdmin);
      const textPaddingX = bubblePadding.left + bubblePadding.right;
      ctx.font = `400 ${MOMO_MESSAGE_FONT_SIZE}px ${MOMO_SANS_FONT_FAMILY}`;
      const lines = canvasTextLines(ctx, message.text, maxBubbleWidth - textPaddingX);
      const textWidth = Math.max(...lines.map((line) => ctx.measureText(line).width), 24);
      const minBubbleWidth = Math.max(96, bubbleSlice.left + bubbleSlice.right);
      const bubbleWidth = Math.min(maxBubbleWidth, Math.max(minBubbleWidth, textWidth + textPaddingX));
      const lineHeight = MOMO_MESSAGE_LINE_HEIGHT;
      const minBubbleHeight = Math.max(64, bubbleSlice.top + bubbleSlice.bottom);
      const bubbleHeight = Math.max(minBubbleHeight, lines.length * lineHeight + 32);
      const labelHeight = speaker.speakerName ? MOMO_SPEAKER_LABEL_HEIGHT : 0;
      items.push({
        type: "text",
        side: message.side,
        lines,
        lineHeight,
        bubbleWidth,
        bubbleHeight,
        labelHeight,
        ...speaker,
        height: Math.max(avatarSize, labelHeight + bubbleHeight + 4),
      });
      continue;
    }

    if (message.type === "sticker") {
      const speaker = exportSpeakerMeta(message, project);
      const asset = findAsset(message.asset_id);
      const ratio = Number(asset?.width) > 0 && Number(asset?.height) > 0
        ? Number(asset.width) / Number(asset.height)
        : 1;
      let stickerWidth = 201;
      let stickerHeight = stickerWidth / ratio;
      if (stickerHeight > 201) {
        stickerHeight = 201;
        stickerWidth = stickerHeight * ratio;
      }
      items.push({
        type: "sticker",
        side: message.side,
        asset,
        stickerWidth,
        stickerHeight,
        labelHeight: speaker.speakerName ? MOMO_SPEAKER_LABEL_HEIGHT : 0,
        ...speaker,
        height: Math.max(avatarSize, stickerHeight + (speaker.speakerName ? MOMO_SPEAKER_LABEL_HEIGHT : 0)),
      });
      continue;
    }

    if (message.type === "image") {
      const speaker = exportSpeakerMeta(message, project);
      const fitted = fitImageDimensions(message.width, message.height, 320, 240);
      items.push({
        type: "image",
        side: message.side,
        imageUrl: messageImageUrl(message),
        imageWidth: fitted.width,
        imageHeight: fitted.height,
        labelHeight: 0,
        ...speaker,
        speakerName: "",
        height: Math.max(avatarSize, fitted.height),
      });
      continue;
    }

    if (message.type === "system") {
      ctx.font = `400 22px ${MOMO_SANS_FONT_FAMILY}`;
      const lines = canvasTextLines(ctx, message.text || "", 760);
      const lineHeight = 30;
      const height = Math.max(52, lines.length * lineHeight + 38);
      items.push({ type: "system", lines, lineHeight, height });
      continue;
    }

    if (message.type === "recall") {
      ctx.font = `400 22px ${MOMO_SANS_FONT_FAMILY}`;
      items.push({
        type: "recall",
        lines: canvasTextLines(ctx, message.text || "", 760),
        lineHeight: 30,
        height: 52,
      });
      continue;
    }

  }

  const itemsHeight = items.reduce((total, item) => total + item.height, 0);
  const itemGaps = Math.max(0, items.length - 1) * rowGap;
  const bodyHeight =
    bodyPaddingTop +
    itemsHeight +
    itemGaps +
    bodyPaddingBottom;
  const height = Math.max(906, headerHeight + bodyHeight);

  return {
    width,
    height,
    headerHeight,
    bodyPaddingX,
    bodyPaddingTop,
    bodyPaddingBottom,
    rowGap,
    avatarSize,
    avatarGap,
    maxBubbleWidth,
    items,
  };
}

function drawChatExportItem(ctx, item, layout, images, y) {
  const contentLeft = layout.bodyPaddingX;
  const contentRight = layout.width - layout.bodyPaddingX;
  const contactAvatarSize = layout.avatarSize;
  if (item.type === "text") {
    const bubbleY = y + (item.labelHeight ? item.labelHeight + 2 : 4);
    const bubbleImage = item.speakerIsAdmin
      ? (item.side === "right" ? images.selectedBubbleRight : images.selectedBubbleLeft)
      : (item.side === "right" ? images.bubbleRight : images.bubbleLeft);
    let bubbleX = contentLeft + contactAvatarSize + layout.avatarGap;
    let avatarX = contentLeft;
    if (item.side === "right") {
      avatarX = contentRight - contactAvatarSize;
      bubbleX = contentRight - contactAvatarSize - layout.avatarGap - item.bubbleWidth;
    }
    drawExportAvatarContent(
      ctx,
      avatarX,
      y,
      contactAvatarSize,
      exportContactAvatarContent(item.speaker, images),
    );
    const bubbleSlice = bubbleNineSlice(item.side, item.speakerIsAdmin);
    const bubblePadding = bubbleTextHorizontalPadding(item.side, item.speakerIsAdmin);
    drawNineSlice(
      ctx,
      bubbleImage,
      bubbleX,
      bubbleY,
      item.bubbleWidth,
      item.bubbleHeight,
      bubbleSlice,
    );
    if (item.speakerName) {
      ctx.fillStyle = "#5f6b7b";
      ctx.font = `700 ${MOMO_SPEAKER_FONT_SIZE}px ${MOMO_SERIF_FONT_FAMILY}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(item.speakerName, bubbleX + bubbleSpeakerHorizontalPadding(item.side, item.speakerIsAdmin), y);
    }
    // 新气泡主题为完整单图，不再绘制独立装饰层。
    ctx.fillStyle = item.speakerIsAdmin
      ? (item.side === "right" ? BUBBLE_TEXT_COLOR_RIGHT : BUBBLE_TEXT_COLOR_LEFT)
      : "#6B6B6B";
    ctx.font = `400 ${MOMO_MESSAGE_FONT_SIZE}px ${MOMO_SANS_FONT_FAMILY}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const textBlockTop = bubbleY + (item.bubbleHeight - item.lines.length * item.lineHeight) / 2;
    const textX = bubbleX + bubblePadding.left;
    item.lines.forEach((line, lineIndex) => {
      ctx.fillText(line, textX, textBlockTop + item.lineHeight * (lineIndex + 0.5));
    });
    return;
  }

  if (item.type === "sticker") {
    const stickerX = item.side === "right"
      ? contentRight - contactAvatarSize - layout.avatarGap - item.stickerWidth
      : contentLeft + contactAvatarSize + layout.avatarGap;
    const avatarX = item.side === "right" ? contentRight - contactAvatarSize : contentLeft;
    drawExportAvatarContent(
      ctx,
      avatarX,
      y,
      contactAvatarSize,
      exportContactAvatarContent(item.speaker, images),
    );
    if (item.speakerName) {
      ctx.fillStyle = "#5f6b7b";
      ctx.font = `700 ${MOMO_SPEAKER_FONT_SIZE}px ${MOMO_SERIF_FONT_FAMILY}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(item.speakerName, stickerX + bubbleSpeakerHorizontalPadding(item.side, item.speakerIsAdmin), y + 1);
    }
    const assetImage = images.byUrl.get(assetFullUrl(item.asset));
    const stickerY = y + item.labelHeight;
    drawCanvasContain(ctx, assetImage, stickerX, stickerY, item.stickerWidth, item.stickerHeight);
    if (!assetImage) {
      ctx.fillStyle = "#eef1f5";
      roundedRectPath(ctx, stickerX, stickerY, item.stickerWidth, item.stickerHeight, 8);
      ctx.fill();
    }
    return;
  }

  if (item.type === "image") {
    const imageX = item.side === "right"
      ? contentRight - contactAvatarSize - layout.avatarGap - item.imageWidth
      : contentLeft + contactAvatarSize + layout.avatarGap;
    const avatarX = item.side === "right" ? contentRight - contactAvatarSize : contentLeft;
    drawExportAvatarContent(
      ctx,
      avatarX,
      y,
      contactAvatarSize,
      exportContactAvatarContent(item.speaker, images),
    );
    if (item.speakerName) {
      ctx.fillStyle = "#5f6b7b";
      ctx.font = `700 ${MOMO_SPEAKER_FONT_SIZE}px ${MOMO_SERIF_FONT_FAMILY}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(item.speakerName, imageX + bubbleSpeakerHorizontalPadding(item.side, item.speakerIsAdmin), y + 1);
    }
    const imageY = y + item.labelHeight;
    const image = images.byUrl.get(item.imageUrl);
    if (image) {
      drawCanvasContain(ctx, image, imageX, imageY, item.imageWidth, item.imageHeight);
    } else {
      ctx.fillStyle = "#eef1f5";
      roundedRectPath(ctx, imageX, imageY, item.imageWidth, item.imageHeight, 8);
      ctx.fill();
    }
    return;
  }

  if (item.type === "system") {
    ctx.fillStyle = "#6f7988";
    ctx.font = `400 22px ${MOMO_SANS_FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(item.lines.join(" "), layout.width / 2, y + item.height / 2);
    return;
  }

  if (item.type === "recall") {
    const text = item.lines.join(" ");
    const textWidth = Math.max(ctx.measureText(text).width, 120);
    const lineWidth = 68;
    const centerY = y + item.height / 2;
    if (images.recallLine) {
      ctx.drawImage(images.recallLine, layout.width / 2 - textWidth / 2 - lineWidth - 18, centerY - 4, lineWidth, 8);
      ctx.drawImage(images.recallLine, layout.width / 2 + textWidth / 2 + 18, centerY - 4, lineWidth, 8);
    }
    ctx.fillStyle = "#6f7988";
    ctx.font = `400 22px ${MOMO_SANS_FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, layout.width / 2, centerY);
    return;
  }

}

function drawChatExport(ctx, layout, images, project) {
  const fontFamily = MOMO_SANS_FONT_FAMILY;
  ctx.fillStyle = "#d3d6da";
  ctx.fillRect(0, 0, layout.width, layout.height);
  if (images.background) {
    drawCanvasCover(
      ctx,
      images.background,
      0,
      layout.headerHeight,
      layout.width,
      layout.height - layout.headerHeight,
    );
    ctx.fillStyle = "rgba(211, 214, 218, 0.52)";
    ctx.fillRect(0, layout.headerHeight, layout.width, layout.height - layout.headerHeight);
  }

  const headerGradient = ctx.createLinearGradient(0, 0, 0, layout.headerHeight);
  headerGradient.addColorStop(0, "rgba(232, 234, 238, 0.96)");
  headerGradient.addColorStop(1, "rgba(220, 223, 228, 0.96)");
  ctx.fillStyle = headerGradient;
  ctx.fillRect(0, 0, layout.width, layout.headerHeight);
  ctx.strokeStyle = "rgba(91, 100, 114, 0.22)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, layout.headerHeight - 0.5);
  ctx.lineTo(layout.width, layout.headerHeight - 0.5);
  ctx.stroke();

  ctx.fillStyle = "#2b3646";
  ctx.font = `600 34px ${fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(project.contact.name || "角色名", layout.width / 2, layout.headerHeight / 2);
  let cursorY = layout.headerHeight + layout.bodyPaddingTop;
  for (const item of layout.items) {
    drawChatExportItem(ctx, item, layout, images, cursorY);
    cursorY += item.height + layout.rowGap;
  }
}

async function loadChatExportImages(project, messages = project.messages) {
  const urls = new Set(Object.values(EXPORT_ASSET_URLS));
  const background = chatBackgroundAsset(project);
  if (background) urls.add(assetFullUrl(background));
  const projectContact = contactFromProject(project) || project.contact;
  for (const member of contactMembers(projectContact)) {
    const asset = contactAvatarAsset(member);
    if (asset) urls.add(assetFullUrl(asset));
  }
  for (const message of exportableMessages(messages)) {
    const speaker = messageSpeaker(message, project);
    const speakerAsset = contactAvatarAsset(speaker);
    for (const member of contactMembers(speaker)) {
      const asset = contactAvatarAsset(member);
      if (asset) urls.add(assetFullUrl(asset));
    }
    if (speakerAsset) urls.add(assetFullUrl(speakerAsset));
    if (message.type === "sticker") {
      const asset = findAsset(message.asset_id);
      if (asset) urls.add(assetFullUrl(asset));
    } else if (message.type === "image") {
      const imageUrl = messageImageUrl(message);
      if (imageUrl) urls.add(imageUrl);
    }
  }
  const entries = await Promise.all(
    [...urls].map(async (url) => [url, await loadCanvasImage(url)]),
  );
  const byUrl = new Map(entries);
  return {
    byUrl,
    bubbleLeft: byUrl.get(EXPORT_ASSET_URLS.bubbleLeft),
    bubbleRight: byUrl.get(EXPORT_ASSET_URLS.bubbleRight),
    selectedBubbleLeft: byUrl.get(EXPORT_ASSET_URLS.selectedBubbleLeft),
    selectedBubbleRight: byUrl.get(EXPORT_ASSET_URLS.selectedBubbleRight),
    recallLine: byUrl.get(EXPORT_ASSET_URLS.recallLine),
    background: background ? byUrl.get(assetFullUrl(background)) : null,
  };
}

function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("PNG 生成失败"));
    }, "image/png");
  });
}

function safeFilename(value) {
  return String(value || "momotalk_chat")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._]+|[._]+$/g, "")
    .slice(0, 80) || "momotalk_chat";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * 计算长图需要切成哪几段。
 * 每段高度不超过 maxHeight，最后一段为剩余高度。
 */
function chatExportSlices(totalHeight, maxHeight) {
  if (totalHeight <= maxHeight) return [{ top: 0, height: totalHeight }];
  const slices = [];
  for (let top = 0; top < totalHeight; top += maxHeight) {
    slices.push({ top, height: Math.min(maxHeight, totalHeight - top) });
  }
  return slices;
}

function chatExportStamp(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    "_",
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ].join("");
}

/**
 * 生成长图，并在超出单图高度上限时按高度切分为多张。
 *
 * 返回值中 slices 为每张图的裁剪区域（源画布像素坐标），
 * 当内容未超限时只有一张。
 */
async function renderChatExport(project, messages, images, layout, scale) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(layout.width * scale));
  canvas.height = Math.max(1, Math.round(layout.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawChatExport(ctx, layout, images, project);
  const blobs = [];
  const slices = [];
  for (const { top, height } of chatExportSlices(canvas.height, PNG_EXPORT_MAX_HEIGHT)) {
    const part = document.createElement("canvas");
    part.width = canvas.width;
    part.height = height;
    const partCtx = part.getContext("2d");
    partCtx.drawImage(canvas, 0, top, canvas.width, height, 0, 0, canvas.width, height);
    blobs.push(await canvasToPngBlob(part));
    slices.push({ top, height });
  }
  return { blobs, slices, width: canvas.width };
}

async function downloadChatPng() {
  if (!state.project || state.exportingPng) return;
  state.exportingPng = true;
  if (elements.saveChatImageButton) elements.saveChatImageButton.disabled = true;
  showToast("正在生成 PNG 长图");
  try {
    await saveProject({ quiet: true });
    if (document.fonts?.load) {
      await Promise.all([
        document.fonts.load(`400 ${MOMO_MESSAGE_FONT_SIZE}px ${MOMO_SANS_FONT_FAMILY}`),
        document.fonts.load(`700 ${MOMO_SPEAKER_FONT_SIZE}px ${MOMO_SERIF_FONT_FAMILY}`),
      ]);
    }
    const project = state.project;
    const messages = exportableMessages(project.messages).slice(-PNG_EXPORT_MESSAGE_LIMIT);
    const images = await loadChatExportImages(project, messages);
    const measurementCanvas = document.createElement("canvas");
    const measureContext = measurementCanvas.getContext("2d");
    const layout = buildChatExportLayout(measureContext, project, messages);
    const scale = layout.height * PNG_EXPORT_SCALE <= PNG_EXPORT_MAX_HEIGHT ? PNG_EXPORT_SCALE : 1;
    const result = await renderChatExport(project, messages, images, layout, scale);
    const total = result.blobs.length;
    const baseName = safeFilename(`momotalk_${project.contact.name}_${project.title}`);
    const stamp = chatExportStamp();
    for (let index = 0; index < total; index += 1) {
      const suffix = total > 1 ? `-${index + 1}` : "";
      downloadBlob(result.blobs[index], `${baseName}_${stamp}${suffix}.png`);
      if (index < total - 1) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
    showToast(
      total > 1
        ? `聊天长图已生成，内容过长已自动拆分为 ${total} 张`
        : "PNG 聊天长图已生成",
    );
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.exportingPng = false;

    if (elements.saveChatImageButton) elements.saveChatImageButton.disabled = false;
  }
}
// 全局事件绑定。
function bindEvents() {
  elements.projectManagementButton.addEventListener("click", () => {
    state.projectManagementMode = !state.projectManagementMode;
    renderProjectList();
  });
  elements.saveButton.addEventListener("click", () => saveProject());
  elements.saveChatImageButton.addEventListener("click", () => {
    downloadChatPng();
  });
  elements.newGroupButton.addEventListener("click", openGroupManager);
  elements.closeGroupModal.addEventListener("click", closeGroupModal);
  elements.cancelGroupButton.addEventListener("click", closeGroupModal);
  elements.createGroupButton.addEventListener("click", () => {
    submitGroupCreation();
  });
  elements.saveGroupButton?.addEventListener("click", saveManagedGroup);
  elements.deleteGroupButton?.addEventListener("click", deleteManagedGroup);
  elements.groupManagerSelect?.addEventListener("change", (event) => {
    loadManagedGroup(event.target.value);
    elements.groupModalStatus.textContent = "";
    renderGroupModal();
  });
  elements.groupNameInput.addEventListener("input", (event) => {
    if (state.groupDraft.mode !== "create") return;
    state.groupDraft.name = event.target.value;
    elements.groupModalStatus.textContent = "";
    renderGroupModal();
  });
  elements.groupMemberSearch.addEventListener("input", (event) => {
    state.groupDraft.query = event.target.value;
    state.groupDraft.page = 0;
    renderGroupMemberList();
  });
  elements.groupPrevPage?.addEventListener("click", () => changeGroupMemberPage(-1));
  elements.groupNextPage?.addEventListener("click", () => changeGroupMemberPage(1));
  elements.groupMemberList.addEventListener("click", (event) => {
    const card = event.target.closest("[data-group-member-id]");
    if (!card) return;
    toggleGroupMember(card.dataset.groupMemberId);
  });
  elements.groupModal.addEventListener("click", (event) => {
    if (event.target === elements.groupModal) closeGroupModal();
  });
  elements.messageComposer.addEventListener("submit", (event) => {
    event.preventDefault();
    sendDirectMessage();
  });
  elements.speakerPicker.addEventListener("change", (event) => {
    selectSpeaker(event.target.value);
  });
  elements.chatImageButton?.addEventListener("click", () => {
    pickStaticImage({ kind: "composer" });
  });
  elements.chatImageInput?.addEventListener("change", (event) => {
    handleStaticImageSelection(event.target.files?.[0]);
  });
  elements.chatStickerButton?.addEventListener("click", () => {
    if (!state.project) return;
    openAssetModal("sticker", null, { composeSticker: true });
  });
  elements.directMessageInput.addEventListener("input", resizeDirectMessageInput);
  elements.directMessageInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    sendDirectMessage();
  });
  elements.addMessageButton.addEventListener("click", addMessage);
  elements.projectTitleInput.addEventListener("input", (event) => {
    updateProject((project) => {
      project.title = event.target.value;
    }, { render: false });
    elements.previewTitle.textContent = event.target.value;
  });
  elements.contactNameInput.addEventListener("input", (event) => {
    updateProject((project) => {
      project.contact.name = event.target.value;
    }, { render: false });
    elements.previewContactName.textContent = event.target.value;
    renderSpeakerPicker(state.project);
  });
  elements.contactNameInput.addEventListener("change", (event) => {
    renameCurrentGroup(event.target.value).catch((error) => {
      showToast(error.message, "error");
      renderEditor();
    });
  });
  elements.adminAvatarPickerButton.addEventListener("click", () => openAssetModal("adminAvatar"));
  elements.previewRailAvatarButton.addEventListener("click", () => openAssetModal("adminAvatar"));
  elements.backgroundPickerButton.addEventListener("click", () => openAssetModal("backgrounds"));
  elements.bubblePickerButton.addEventListener("click", () => openAssetModal("bubble"));
  elements.railBubbleButton.addEventListener("click", () => openAssetModal("bubble"));
  elements.closeAssetModal.addEventListener("click", closeAssetModal);
  elements.assetModal.addEventListener("click", (event) => {
    if (event.target === elements.assetModal) closeAssetModal();
  });
  elements.assetCategorySelect.addEventListener("change", (event) => {
    state.assetModal.category = event.target.value;
    renderAssetGrid();
  });
  elements.assetSearchInput.addEventListener("input", (event) => {
    state.assetModal.query = event.target.value.trim();
    clearTimeout(renderAssetGrid.timer);
    renderAssetGrid.timer = setTimeout(renderAssetGrid, 220);
  });

  elements.projectList.addEventListener("click", (event) => {
    const deleteButton = event.target.closest("[data-delete-project-id]");
    if (deleteButton) {
      deleteProject(deleteButton.dataset.deleteProjectId).catch((error) => showToast(error.message, "error"));
      return;
    }
    if (event.target.closest('[data-action="new-project"]')) {
      createProject().catch((error) => showToast(error.message, "error"));
      return;
    }
    const item = event.target.closest("[data-project-id]");
    if (!item) return;
    openProject(item.dataset.projectId).catch((error) => showToast(error.message, "error"));
  });
  elements.contactList.addEventListener("click", (event) => {
    if (event.target.closest('[data-action="new-group"]')) {
      openGroupCreate();
      return;
    }
    const item = event.target.closest("[data-contact-id]");
    if (!item) return;
    selectRole(item.dataset.contactId);
  });
  elements.messageList.addEventListener("click", (event) => {
    const item = event.target.closest("[data-message-id]");
    if (!item) return;
    const messageId = item.dataset.messageId;
    const action = event.target.closest("[data-action]")?.dataset.action || "select";
    if (action === "select") {
      state.selectedMessageId = messageId;
      renderAll();
    } else if (action === "up") {
      moveMessage(messageId, -1);
    } else if (action === "down") {
      moveMessage(messageId, 1);
    } else if (action === "delete") {
      if (window.confirm("删除这条消息？")) deleteMessage(messageId);
    }
  });
  elements.assetGrid.addEventListener("click", (event) => {
    const categoryCard = event.target.closest("[data-sticker-category-id]");
    if (categoryCard) {
      state.assetModal.stickerCategoryId = categoryCard.dataset.stickerCategoryId;
      state.assetModal.stickerOffset = 0;
      renderAssetGrid();
      return;
    }
    if (event.target.closest("[data-sticker-back]")) {
      state.assetModal.stickerCategoryId = null;
      state.assetModal.stickerOffset = 0;
      renderAssetGrid();
      return;
    }
    const themeCard = event.target.closest("[data-bubble-theme-id]");
    if (themeCard) {
      chooseBubbleTheme(themeCard.dataset.bubbleThemeId);
      return;
    }
    const card = event.target.closest("[data-asset-id]");
    if (card) chooseAsset(card.dataset.assetId);
  });
  elements.assetPrevPage.addEventListener("click", () => {
    state.assetModal.stickerOffset = Math.max(
      0,
      state.assetModal.stickerOffset - state.assetModal.stickerLimit,
    );
    renderAssetGrid();
  });
  elements.assetNextPage.addEventListener("click", () => {
    state.assetModal.stickerOffset += state.assetModal.stickerLimit;
    renderAssetGrid();
  });
  elements.emptyMessageModalClose?.addEventListener("click", hideEmptyMessageModal);
  elements.emptyMessageModal?.addEventListener("click", (event) => {
    if (event.target === elements.emptyMessageModal) hideEmptyMessageModal();
  });
  elements.powerButton?.addEventListener("click", showPowerConfirm);
  elements.powerConfirmCancel?.addEventListener("click", hidePowerConfirm);
  elements.powerConfirmAccept?.addEventListener("click", () => {
    confirmShutdown();
  });
  elements.powerConfirmModal?.addEventListener("click", (event) => {
    if (event.target === elements.powerConfirmModal) hidePowerConfirm();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (elements.emptyMessageModal && !elements.emptyMessageModal.classList.contains("hidden")) {
      hideEmptyMessageModal();
      return;
    }
    if (elements.powerConfirmModal && !elements.powerConfirmModal.classList.contains("hidden")) {
      hidePowerConfirm();
      return;
    }
    if (elements.groupModal && !elements.groupModal.classList.contains("hidden")) {
      closeGroupModal();
      return;
    }
    closeAssetModal();
  });
}

// 应用启动入口。
async function init() {
  bindEvents();
  resizeDirectMessageInput();
  try {
    await loadContacts();
    await Promise.all([loadAssets(), loadContactAvatars(), loadBubbleThemes()]);
    await loadProjects();
    const lastProjectId = localStorage.getItem(LAST_PROJECT_KEY);
    if (lastProjectId && state.projects.some((project) => project.id === lastProjectId)) {
      await openProject(lastProjectId);
    } else if (state.projects.length) {
      await openProject(state.projects[0].id);
    } else {
      await createProject();
    }
    markSaved();
  } catch (error) {
    showToast(error.message, "error");
  }
}

init();





