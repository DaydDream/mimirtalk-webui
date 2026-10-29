/*
 * 外壳层（B1.5）。
 *
 * 约束 §3.1 第 7 条：页面骨架、三页签导航与路由状态只允许出现在受控的外壳层。
 * 本模块只负责「外壳差异」：
 *   - 决定当前是桌面三栏外壳还是安卓聊天外壳；
 *   - 组织安卓外壳：顶部全局个人显示设置条 + 三页签（会话 / 联系人 / 设置）导航；
 *   - 把桌面外壳里的业务节点搬进安卓外壳的占位容器复用，不复制任何业务逻辑。
 *
 * 业务渲染、项目读写、联系人数据仍全部由 app.js（业务层）拥有；外壳只通过
 * window.MimirTalkApp 暴露的少量只读 / 渲染钩子与 document 事件调用它们。
 */
(function () {
  "use strict";

  const MODE_KEY = "mimirtalk_webui.android_mode";
  const THEME_KEY = "mimirtalk_webui.android_theme";
  const APP_EVENT = "mimirtalk:project-changed";
  const EXPORT_THUMB_CONCURRENCY = 2;
  const EXPORT_ZOOM_MIN = 1;
  const EXPORT_ZOOM_MAX = 4;
  const BACK_BRIDGE_PLUGIN = "MimirBackBridge";

  // 设置子页统一映射；主列表之外的视图都隐藏底部三页签。
  const SETTINGS_PAGES = {
    list: { id: "androidSettingsList", title: "设置" },
    projects: { id: "androidSettingsProjectsPage", title: "项目目录" },
    feedback: { id: "androidSettingsFeedbackPage", title: "意见反馈" },
    "update-info": { id: "androidSettingsUpdatePage", title: "关于与更新信息" },
    export: { id: "androidSettingsExportPage", title: "导出长图总览" },
  };
  const SETTINGS_PAGE_KEYS = Object.keys(SETTINGS_PAGES);
  const MAIN_VIEWS = new Set(["conversations", "contacts", "settings"]);
  // 联系人单击 / 双击消歧：首击延迟 300ms 打开信息页，第二击落在同一卡片
  // 且位移不超过 24px 时改走「加入会话并进入」。
  const CONTACT_TAP_DELAY = 300;
  const CONTACT_TAP_SLOP = 24;
  const SEARCH_DEFAULT_ROWS = 5;
  const SEARCH_MORE_ROWS = 5;
  const SEARCH_DEBOUNCE_MS = 120;

  const TAB_TITLES = {
    conversations: "弥弥尔通讯",
    contacts: "联系人",
    settings: "设置",
  };

  // 已记录在开发文档、但本轮尚未实现的入口：统一给出「开发中，敬请期待」提示，
  // 避免出现点击无反馈的死入口。功能落地后逐项替换为真实交互。
  const PLACEHOLDER_TOASTS = {
    profile: "个人资料开发中，敬请期待",
    "ai-endpoint": "AI 接口设置开发中，敬请期待",
    "check-update": "检查更新开发中，敬请期待",
  };

  const state = {
    kind: "desktop",
    view: "conversations",
    settingsPage: "list",
    // 安卓外壳唯一页面栈：只保存可序列化状态，不保存 DOM 或业务闭包。
    pageStack: [],
    drawerOpen: false,
    mode: "local",
    // 信息页（群组管理 / 角色信息）从哪个分页进入，返回按钮据此回退。
    infoParent: "contacts",
    infoTitle: "",
    infoContactId: "",
    // 全屏成员选择页（B1.6 §3.1）：标题由业务层随 view-request 传入，取消时回退到 parent。
    pickerTitle: "",
    pickerParent: "group-info",
  };
  let dom = null;
  let mounted = false;
  let pendingContactTap = null;
  let composerResizeObserver = null;
  const exportGallery = {
    token: 0,
    loading: false,
    loadedOnce: false,
    entries: [],
    queue: [],
    activeLoads: 0,
    observer: null,
    thumbnailUrls: new Set(),
    viewer: {
      open: false,
      token: 0,
      url: "",
      loading: false,
      scale: 1,
      x: 0,
      y: 0,
      pointers: new Map(),
      drag: null,
      pinch: null,
    },
  };
  const searchState = {
    query: "",
    token: 0,
    timer: null,
    result: null,
    error: "",
    opening: false,
    focusPending: false,
    expanded: { roles: 0, groups: 0, chats: 0 },
  };
  // 手势滑开抽屉后，抬手会补发一次落在遮罩上的 click；用它屏蔽这次误关闭。
  let drawerSwipeOpenedAt = 0;
  // 返回能力只同步最终状态；相同状态不重复跨桥，上报失败时允许下次重试。
  let lastReportedBackState = "";
  let backStateReportScheduled = false;

  // 右边缘左滑打开编辑抽屉。Android 手势导航会吃掉贴边约 24dp 的滑动（贴边左滑
  // 等于系统返回），所以判定带取右侧四分之一屏，只要横向左滑明显大于纵向滚动即
  // 打开抽屉；贴边的“编辑”把手始终可用，作为手势被系统接管时的兜底入口。
  const DRAWER_SWIPE_ZONE = 0.3;
  const DRAWER_SWIPE_MIN = 48;

  // 允许通过 ?shell=android|desktop 显式指定外壳，供自动化 UI 回归在桌面浏览器里
  // 验证安卓外壳；正常运行时不注入该参数，按平台能力判定。
  function requestedShell() {
    try {
      return new URLSearchParams(window.location.search).get("shell") || "";
    } catch (error) {
      return "";
    }
  }

  function resolveKind(context = {}) {
    const forced = requestedShell();
    if (forced === "android" || forced === "desktop") return forced;
    return context.kind === "android" ? "android" : "desktop";
  }

  function appApi() {
    return window.MimirTalkApp || null;
  }

  function viewNode(view) {
    return dom?.views.find((node) => node.dataset.androidView === view) || null;
  }

  function settingsPageNode(page) {
    const id = SETTINGS_PAGES[page]?.id;
    return id ? document.getElementById(id) : null;
  }

  function activeScrollNode(page = state) {
    if (!dom) return null;
    if (page.view === "settings") {
      if (page.settingsPage === "list") return dom.settingsList;
      const node = settingsPageNode(page.settingsPage);
      return (
        node?.querySelector(".android-settings-content, .android-project-host") ||
        node ||
        dom.settingsList
      );
    }
    if (page.view === "conversation") {
      return document.getElementById("chatScroll") || viewNode(page.view);
    }
    if (page.view === "search") return dom.searchResults;
    if (page.view === "conversations") {
      return document.getElementById("contactList") || viewNode(page.view);
    }
    return viewNode(page.view);
  }

  function capturePageState() {
    return {
      view: state.view,
      settingsPage: state.settingsPage,
      infoParent: state.infoParent,
      infoTitle: state.infoTitle,
      pickerParent: state.pickerParent,
      pickerTitle: state.pickerTitle,
      scrollTop: activeScrollNode()?.scrollTop || 0,
    };
  }

  function normalizePage(page) {
    const source = page && typeof page === "object" ? page : { view: page };
    const view = typeof source.view === "string" ? source.view : "conversations";
    const settingsPage =
      view === "settings" && SETTINGS_PAGE_KEYS.includes(source.settingsPage)
        ? source.settingsPage
        : view === "settings"
          ? "list"
          : "list";
    return {
      view,
      settingsPage,
      infoParent: typeof source.infoParent === "string" ? source.infoParent : "contacts",
      infoTitle: typeof source.infoTitle === "string" ? source.infoTitle : "",
      pickerParent: typeof source.pickerParent === "string" ? source.pickerParent : "group-info",
      pickerTitle: typeof source.pickerTitle === "string" ? source.pickerTitle : "",
      scrollTop: Number(source.scrollTop) || 0,
    };
  }

  function samePage(left, right) {
    return left.view === right.view && left.settingsPage === right.settingsPage;
  }

  function restoreScroll(page) {
    const top = Number(page.scrollTop) || 0;
    requestAnimationFrame(() => {
      const node = activeScrollNode(page);
      if (node) node.scrollTop = top;
    });
  }

  function applyPageState(page, options = {}) {
    if (!dom) return;
    const next = normalizePage(page);
    if (!(next.view === "settings" && next.settingsPage === "export")) {
      closeExportViewer();
    }
    const previousView = state.view;
    if (next.view !== "search") {
      clearSearchTimer();
      if (previousView === "search") dom.searchInput?.blur();
    }
    state.view = next.view;
    state.settingsPage = next.settingsPage;
    state.infoParent = next.infoParent;
    state.infoTitle = next.infoTitle;
    state.pickerParent = next.pickerParent;
    state.pickerTitle = next.pickerTitle;

    closeDrawer();
    if (next.view !== "conversation") appApi()?.closeConversationPanels?.();
    dom.views.forEach((node) => {
      node.classList.toggle("hidden", node.dataset.androidView !== next.view);
    });
    SETTINGS_PAGE_KEYS.forEach((name) => {
      const node = settingsPageNode(name);
      if (node) node.classList.toggle("hidden", next.view !== "settings" || name !== next.settingsPage);
    });
    if (next.view === "contacts") {
      const api = appApi();
      if (api && typeof api.renderEditorContacts === "function") api.renderEditorContacts();
    }
    if (next.view === "settings") {
      renderSettings();
    }
    updateChrome();
    if (options.restoreScroll !== false) restoreScroll(next);
    if (next.view === "search" && searchState.focusPending) {
      searchState.focusPending = false;
      requestAnimationFrame(() => {
        if (state.view !== "search") return;
        dom.searchInput?.focus();
      });
    }
    scheduleBackStateReport();
  }

  function navigateTo(page) {
    if (!dom) return;
    const next = normalizePage(page);
    if (samePage(state, next)) return;
    const previous = state.pageStack[state.pageStack.length - 1];
    if (previous && samePage(previous, next)) {
      state.pageStack.pop();
      applyPageState(previous);
      return;
    }
    // 成员选择页在业务成功后直接跳到会话等新页面，用替换避免把已关闭的
    // 临时选择页留在返回栈里。
    if (state.view !== "group-picker") state.pageStack.push(capturePageState());
    applyPageState(next);
  }

  function selectTab(view) {
    if (!MAIN_VIEWS.has(view) || !dom) return;
    clearPendingContactTap();
    state.pageStack = [];
    applyPageState({ view, settingsPage: "list" });
  }

  function backToPrevious(fallback) {
    if (state.pageStack.length) {
      applyPageState(state.pageStack.pop());
      return true;
    }
    applyPageState(fallback);
    return true;
  }

  function toast(message, type) {
    const api = appApi();
    if (api && typeof api.toast === "function") {
      api.toast(message, type);
      return;
    }
    console.info("[android-shell]", message);
  }

  function readMode() {
    try {
      const value = localStorage.getItem(MODE_KEY);
      return value === "ai" ? "ai" : "local";
    } catch (error) {
      return "local";
    }
  }

  function writeMode(mode) {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch (error) {
      /* 隐私模式下写入失败不影响当前会话。 */
    }
  }

  function readTheme() {
    try {
      return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
    } catch (error) {
      return "light";
    }
  }

  function applyTheme(theme) {
    const value = theme === "dark" ? "dark" : "light";
    if (value === "dark") document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem(THEME_KEY, value);
    } catch (error) {
      /* 存储不可用时仍保留当前会话内的切换效果。 */
    }
    if (dom?.themeToggle) {
      const dark = value === "dark";
      const label = dark ? "切换到浅色模式" : "切换到深色模式";
      dom.themeToggle.setAttribute("aria-pressed", dark ? "true" : "false");
      dom.themeToggle.setAttribute("aria-label", label);
      dom.themeToggle.setAttribute("title", label);
    }
  }

  function toggleTheme() {
    const next = readTheme() === "dark" ? "light" : "dark";
    applyTheme(next);
    toast(next === "dark" ? "已切换到深色模式" : "已切换到浅色模式");
  }

  function currentTitle() {
    const api = appApi();
    if (state.view === "conversation") {
      const title = api && typeof api.currentConversationName === "function" ? api.currentConversationName() : "";
      return title || "会话";
    }
    if (state.view === "group-picker") {
      return state.pickerTitle || "选择成员";
    }
    if (state.view === "group-info" || state.view === "character-info") {
      return state.infoTitle || (state.view === "group-info" ? "聊天信息" : "角色信息");
    }
    if (state.view === "settings") {
      return SETTINGS_PAGES[state.settingsPage]?.title || "设置";
    }
    if (state.view === "search") return "搜索";
    return TAB_TITLES[state.view] || "弥弥尔通讯";
  }

  function currentSubtitle() {
    if (state.view !== "conversation") return "";
    const api = appApi();
    return api && typeof api.currentConversationSubtitle === "function"
      ? api.currentConversationSubtitle() || ""
      : "";
  }

  // 会话详情把导出按钮收进应用栏右上角（视觉稿 ⑤），离开会话时放回输入区，
  // 以免影响桌面端布局。业务节点只有一个，这里只是搬位置。
  let saveButtonHome = null;

  function syncSaveButton() {
    const button = document.getElementById("saveChatImageButton");
    if (!button || !dom.appbarActions) return;
    if (!saveButtonHome) {
      saveButtonHome = { parent: button.parentNode, next: button.nextSibling };
    }
    const inConversation = state.view === "conversation";
    if (inConversation) {
      if (button.parentNode !== dom.appbarActions) dom.appbarActions.append(button);
      return;
    }
    if (saveButtonHome.parent && button.parentNode !== saveButtonHome.parent) {
      const anchor =
        saveButtonHome.next && saveButtonHome.next.parentNode === saveButtonHome.parent
          ? saveButtonHome.next
          : null;
      saveButtonHome.parent.insertBefore(button, anchor);
    }
  }

  function updateChrome() {
    if (!dom) return;
    dom.appbarTitle.textContent = currentTitle();
    const subtitle = currentSubtitle();
    if (dom.appbarSubtitle) {
      dom.appbarSubtitle.textContent = subtitle;
      dom.appbarSubtitle.classList.toggle("hidden", !subtitle);
    }
    const subpageView =
      state.view === "group-info" ||
      state.view === "character-info" ||
      state.view === "group-picker" ||
      (state.view === "settings" && state.settingsPage !== "list");
    const infoView = state.view === "group-info" || state.view === "character-info";
    dom.backButton.classList.toggle("hidden", state.view !== "conversation" && !subpageView && !infoView);
    dom.shell.dataset.androidView = state.view;
    dom.shell.dataset.androidMainView = MAIN_VIEWS.has(state.view) && !subpageView ? "true" : "false";
    if (dom.drawerButton) dom.drawerButton.classList.toggle("hidden", state.view !== "conversation");
    if (dom.addSystemMessageButton) {
      dom.addSystemMessageButton.classList.toggle("hidden", state.view !== "conversation");
    }
    syncSaveButton();
    dom.tabButtons.forEach((button) => {
      button.setAttribute("aria-selected", button.dataset.androidTab === state.view ? "true" : "false");
    });
  }

  function showView(view) {
    if (!dom || !viewNode(view)) return;
    navigateTo({ view });
  }

  function openConversation() {
    showView("conversation");
    closeDrawer();
  }

  // 联系人分页点一行：角色进角色信息页、群组进群组管理页。正文由业务层渲染，
  // 外壳只负责选宿主容器、切页与记录返回父页。
  function openContactInfo(contactId) {
    if (!dom) return;
    const api = appApi();
    if (!api || typeof api.openContactInfo !== "function") return;
    const result = api.openContactInfo(contactId, {
      groupHost: dom.groupInfoHost,
      characterHost: dom.characterInfoHost,
    });
    if (!result || !result.view) return;
    const parent = state.view === "search" ? "search" : "contacts";
    state.infoParent = parent;
    state.infoTitle = result.name || "";
    state.infoContactId = String(contactId);
    navigateTo({
      view: result.view,
      infoParent: parent,
      infoTitle: result.name || "",
    });
  }

  function clearPendingContactTap() {
    if (!pendingContactTap) return;
    window.clearTimeout(pendingContactTap.timer);
    pendingContactTap.card?.removeAttribute("data-tap-pending");
    pendingContactTap = null;
  }

  function openContactConversation(contactId) {
    const api = appApi();
    if (!api || typeof api.openContactConversation !== "function") return;
    Promise.resolve(api.openContactConversation(contactId))
      .then((opened) => {
        if (!opened) return;
        closeDrawer();
        navigateTo({ view: "conversation" });
      })
      .catch(() => {
        /* 业务层已给出失败提示，外壳停留在联系人页。 */
      });
  }

  // 联系人卡片点击：首次点击立即进入待定态，300ms 内没有第二击才打开信息页。
  function handleContactTap(card, event) {
    const contactId = card.dataset.editorContactId;
    if (!contactId) return;
    const now = Date.now();
    const point = {
      x: Number(event.clientX) || 0,
      y: Number(event.clientY) || 0,
    };
    const previous = pendingContactTap;
    if (
      previous &&
      previous.contactId === contactId &&
      now - previous.at <= CONTACT_TAP_DELAY &&
      Math.hypot(point.x - previous.x, point.y - previous.y) <= CONTACT_TAP_SLOP
    ) {
      clearPendingContactTap();
      openContactConversation(contactId);
      return;
    }

    clearPendingContactTap();
    card.setAttribute("data-tap-pending", "true");
    const tap = {
      contactId,
      at: now,
      x: point.x,
      y: point.y,
      card,
      timer: window.setTimeout(() => {
        if (pendingContactTap !== tap) return;
        pendingContactTap = null;
        card.removeAttribute("data-tap-pending");
        openContactInfo(contactId);
      }, CONTACT_TAP_DELAY),
    };
    pendingContactTap = tap;
  }

  // ---------- 会话编辑抽屉 ----------

  function setDrawer(open) {
    if (!dom || !dom.drawer) return;
    const next = Boolean(open);
    state.drawerOpen = next;
    dom.drawer.dataset.open = next ? "true" : "false";
    if (dom.conversationView) dom.conversationView.dataset.drawer = next ? "open" : "closed";
    dom.drawer.setAttribute("aria-hidden", next ? "false" : "true");
    dom.drawerHandle.setAttribute("aria-expanded", next ? "true" : "false");
    if (dom.drawerButton) dom.drawerButton.setAttribute("aria-expanded", next ? "true" : "false");
    if (dom.drawerScrim) dom.drawerScrim.dataset.open = next ? "true" : "false";
    scheduleBackStateReport();
  }

  function openDrawer() {
    if (state.view !== "conversation") return;
    setDrawer(true);
  }

  function closeDrawer() {
    setDrawer(false);
  }

  // 平台适配层保留的开关语义：preview 收起抽屉，edit 展开抽屉。
  function setPane(pane) {
    if (pane === "edit") openDrawer();
    else closeDrawer();
  }

  // ---------- 设置页：入口列表 / 功能子页 ----------

  function openSettingsPage(page) {
    const key = SETTINGS_PAGE_KEYS.includes(page) ? page : "list";
    navigateTo({ view: "settings", settingsPage: key });
  }

  function canCloseExportViewer() {
    return exportGallery.viewer.open;
  }

  function canCloseTopModal() {
    const api = appApi();
    return Boolean(api && typeof api.canCloseTopModal === "function" && api.canCloseTopModal());
  }

  function canCloseConversationPanels() {
    const api = appApi();
    return Boolean(
      api &&
        typeof api.canCloseConversationPanels === "function" &&
        api.canCloseConversationPanels(),
    );
  }

  function canGoBack() {
    if (!mounted || state.kind !== "android") return false;
    if (canCloseExportViewer()) return true;
    if (canCloseTopModal()) return true;
    if (state.drawerOpen) return true;
    if (canCloseConversationPanels()) return true;
    if (state.view === "group-picker") return true;
    if (state.view === "settings" && state.settingsPage !== "list") return true;
    if (state.view === "group-info" || state.view === "character-info") return true;
    if (state.view === "conversation") return true;
    if (state.view === "search") return true;
    if (state.view === "contacts" || state.view === "settings") return true;
    // 只有会话列表根页面允许交回 Activity 执行默认退出。
    return false;
  }

  function backBridgePlugin() {
    const plugin = window.Capacitor?.Plugins?.[BACK_BRIDGE_PLUGIN];
    return plugin && typeof plugin.setBackState === "function" ? plugin : null;
  }

  function reportBackState() {
    backStateReportScheduled = false;
    if (!mounted || state.kind !== "android") return;
    const plugin = backBridgePlugin();
    if (!plugin) return;
    const next = canGoBack() ? "can-go-back" : "root";
    if (next === lastReportedBackState) return;
    lastReportedBackState = next;
    let request;
    try {
      request = plugin.setBackState({ state: next });
    } catch (error) {
      lastReportedBackState = "";
      return;
    }
    Promise.resolve(request).catch(() => {
      // 上报失败不能把失败值当作已同步；下一次状态变化会重新尝试。
      if (lastReportedBackState === next) lastReportedBackState = "";
    });
  }

  // 外壳与业务层的所有导航相关变化都汇聚到这里；同一轮事件只上报最终状态。
  function scheduleBackStateReport() {
    if (backStateReportScheduled) return;
    backStateReportScheduled = true;
    Promise.resolve().then(reportBackState);
  }

  function goBack() {
    if (!mounted || state.kind !== "android") return false;
    if (canCloseExportViewer()) {
      closeExportViewer();
      return true;
    }
    const api = appApi();
    // 返回优先级：模态 / 素材弹窗 -> 编辑抽屉 -> 会话内联面板 -> 页面层级。
    if (canCloseTopModal()) {
      api?.closeTopModal?.();
      return true;
    }
    if (state.drawerOpen) {
      closeDrawer();
      return true;
    }
    if (canCloseConversationPanels()) {
      api?.closeConversationPanels?.();
      return true;
    }
    if (state.view === "group-picker") {
      api?.closeGroupPicker?.();
      return backToPrevious({
        view: state.pickerParent || "group-info",
        settingsPage: "list",
      });
    }
    if (state.view === "settings" && state.settingsPage !== "list") {
      return backToPrevious({ view: "settings", settingsPage: "list" });
    }
    if (state.view === "group-info" || state.view === "character-info") {
      return backToPrevious({
        view: state.infoParent || "contacts",
        settingsPage: "list",
      });
    }
    if (state.view === "conversation") {
      return backToPrevious({ view: "conversations", settingsPage: "list" });
    }
    if (state.view === "search") {
      clearSearchTimer();
      searchState.token += 1;
      return backToPrevious({ view: "conversations", settingsPage: "list" });
    }
    if (state.view === "contacts" || state.view === "settings") {
      selectTab("conversations");
      return true;
    }
    // 只有会话列表根页面允许交回 Activity 执行默认退出。
    return false;
  }

  function platformApi() {
    const api = appApi();
    if (api && typeof api.platform === "function") return api.platform();
    return window.MimirTalkAppPlatform || null;
  }

  function setMode(mode) {
    state.mode = mode === "ai" ? "ai" : "local";
    writeMode(state.mode);
    if (!dom) return;
    dom.modeButtons.forEach((button) => {
      button.setAttribute("aria-selected", button.dataset.androidMode === state.mode ? "true" : "false");
    });
  }

  function renderSettings() {
    if (!dom) return;
    if (dom.projectCount) {
      const rows = document.querySelectorAll("#projectList .project-item[data-project-id]").length;
      dom.projectCount.textContent = rows ? `${rows} 个` : "";
    }
    ensureExportGallery();
    updateExportFolderLabel();
    updateBugFolderLabel();
  }

  function updateExportFolderLabel() {
    if (!dom || !dom.exportFolderLabel) return;
    const api = platformApi();
    const render = () => {
      let label = "";
      try {
        label = api && typeof api.exportFolderLabel === "function" ? api.exportFolderLabel() : "";
      } catch (error) {
        label = "";
      }
      dom.exportFolderLabel.textContent = label
        ? `导出位置：${label}`
        : "导出位置：Pictures/MimirTalk";
    };
    // 原生文件夹名读取是异步的：先预热缓存，再同步渲染。
    if (api && typeof api.refreshExportFolderLabel === "function") {
      Promise.resolve(api.refreshExportFolderLabel()).then(render, render);
      return;
    }
    render();
  }

  function updateBugFolderLabel() {
    if (!dom || !dom.bugFolderValue) return;
    const api = platformApi();
    const render = () => {
      let label = "";
      try {
        label = api && typeof api.bugFolderLabel === "function" ? api.bugFolderLabel() : "";
      } catch (error) {
        label = "";
      }
      dom.bugFolderValue.textContent = label || "未设置";
    };
    if (api && typeof api.refreshBugFolderLabel === "function") {
      Promise.resolve(api.refreshBugFolderLabel()).then(render, render);
      return;
    }
    render();
  }

  async function refreshVersionInfo() {
    if (!dom) return;
    let version = null;
    try {
      const api = platformApi();
      version = api && typeof api.appVersion === "function" ? await api.appVersion() : null;
    } catch (error) {
      version = null;
    }
    const apkText = version?.versionName
      ? `${version.versionName} (${version.versionCode ?? "?"})`
      : "未知";
    if (dom.aboutApkVersion) dom.aboutApkVersion.textContent = apkText;
    if (dom.versionValue) dom.versionValue.textContent = version?.versionName || "未知";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // ---------- 导出长图画廊（B3B-REQ-016） ----------

  function exportImageTime(image) {
    const raw = String(image?.created_at || image?.modified_at || "");
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function exportDateParts(timestamp) {
    const date = new Date(timestamp);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return {
      key: `${date.getFullYear()}-${month}-${day}`,
      label: `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`,
    };
  }

  function groupExportImages(images) {
    const groups = new Map();
    images.forEach((image, order) => {
      const timestamp = exportImageTime(image);
      const parts = timestamp
        ? exportDateParts(timestamp)
        : { key: "unknown", label: "日期未知" };
      if (!groups.has(parts.key)) {
        groups.set(parts.key, { ...parts, items: [] });
      }
      groups.get(parts.key).items.push({
        image,
        timestamp,
        order,
        name: String(image?.name || ""),
      });
    });
    const result = Array.from(groups.values());
    result.sort((left, right) => {
      if (left.key === "unknown") return right.key === "unknown" ? 0 : 1;
      if (right.key === "unknown") return -1;
      return left.key < right.key ? 1 : left.key > right.key ? -1 : 0;
    });
    result.forEach((group) => {
      group.items.sort((left, right) => {
        if (left.timestamp !== right.timestamp) return left.timestamp - right.timestamp;
        return left.name.localeCompare(right.name) || left.order - right.order;
      });
    });
    return result;
  }

  function exportThumbPlaceholderHtml(broken) {
    const label = broken
      ? '<span class="android-export-thumb-label">无法预览</span>'
      : "";
    return `<span class="android-export-thumb-placeholder" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" focusable="false">
        <rect x="4" y="5" width="16" height="14" rx="1.5"></rect>
        <circle cx="9" cy="10" r="1.4"></circle>
        <path d="m5 17 4.5-4.5 3 3 2.5-2.5L20 17"></path>
      </svg>${label}
    </span>`;
  }

  function showExportGalleryEmpty(title, detail, options = {}) {
    if (!dom?.exportOverviewList) return;
    exportGallery.entries = [];
    const retry = options.retry
      ? '<button class="android-export-retry" type="button" data-export-retry>重新加载</button>'
      : "";
    dom.exportOverviewList.innerHTML = `<p class="android-export-empty"><strong>${escapeHtml(
      title,
    )}</strong><span>${escapeHtml(detail)}</span>${retry}</p>`;
    if (dom.exportCount) dom.exportCount.textContent = "0 个";
  }

  function showExportGalleryLoading() {
    if (!dom?.exportOverviewList) return;
    dom.exportOverviewList.innerHTML =
      '<p class="android-export-empty android-export-loading"><strong>正在加载长图</strong><span>请稍候</span></p>';
    if (dom.exportCount) dom.exportCount.textContent = "…";
  }

  function renderExportGallery(images) {
    if (!dom?.exportOverviewList) return;
    const groups = groupExportImages(images);
    const ordered = [];
    dom.exportOverviewList.innerHTML = groups
      .map((group) => {
        const cards = group.items
          .map((item) => {
            const index = ordered.length;
            ordered.push(item.image);
            const broken = item.image?.readable === false;
            return `<button class="android-export-thumb" type="button" data-export-index="${index}" data-export-state="${
              broken ? "broken" : "idle"
            }" aria-label="查看导出长图 ${index + 1}">${exportThumbPlaceholderHtml(broken)}</button>`;
          })
          .join("");
        return `<section class="android-export-day" data-export-date="${escapeHtml(
          group.key,
        )}"><h3 class="android-export-day-title">${escapeHtml(
          group.label,
        )}</h3><div class="android-export-grid">${cards}</div></section>`;
      })
      .join("");
    exportGallery.entries = ordered;
    if (dom.exportCount) dom.exportCount.textContent = `${ordered.length} 个`;
    observeExportThumbnails();
  }

  function ensureExportGallery() {
    if (!dom?.exportOverviewList) return;
    if (state.view !== "settings" || state.settingsPage !== "export") return;
    if (exportGallery.loading || exportGallery.loadedOnce) return;
    refreshExportGallery();
  }

  async function refreshExportGallery(options = {}) {
    if (!dom?.exportOverviewList) return;
    if (options.force) closeExportViewer();
    releaseExportThumbnails();
    const token = ++exportGallery.token;
    exportGallery.loading = true;
    exportGallery.loadedOnce = false;
    exportGallery.queue = [];
    exportGallery.observer?.disconnect();
    exportGallery.observer = null;
    showExportGalleryLoading();

    const api = platformApi();
    if (!api || typeof api.listExportImages !== "function") {
      exportGallery.loading = false;
      exportGallery.loadedOnce = true;
      showExportGalleryEmpty(
        "当前端不提供导出图片画廊",
        "导出长图只在安卓应用内按日期展示。",
      );
      return;
    }

    let result = null;
    try {
      result = await api.listExportImages();
    } catch (error) {
      result = { images: [], reason: "LIST_FAILED" };
    }
    if (token !== exportGallery.token) return;

    if (result?.folder_label && dom.exportFolderLabel) {
      dom.exportFolderLabel.textContent = `导出位置：${result.folder_label}`;
    }
    const reason = String(result?.reason || "");
    const images = (Array.isArray(result?.images) ? result.images : []).filter(
      (image) => image && typeof image.uri === "string" && image.uri,
    );

    exportGallery.loading = false;
    exportGallery.loadedOnce = true;
    if (images.length) {
      renderExportGallery(images);
      return;
    }
    if (reason === "NATIVE_UNAVAILABLE") {
      showExportGalleryEmpty(
        "当前端不提供导出图片画廊",
        "导出长图只在安卓应用内按日期展示。",
      );
    } else if (reason === "FOLDER_PERMISSION_REVOKED") {
      showExportGalleryEmpty(
        "导出目录暂不可用",
        "请检查系统存储权限后重试。",
        { retry: true },
      );
    } else if (reason === "LIST_FAILED") {
      showExportGalleryEmpty("读取导出目录失败", "请稍后重试。", { retry: true });
    } else {
      showExportGalleryEmpty(
        "还没有导出长图",
        "导出后的长图会按日期显示在这里。",
      );
    }
  }

  function observeExportThumbnails() {
    exportGallery.observer?.disconnect();
    exportGallery.observer = null;
    if (!dom?.exportOverviewList) return;
    const cards = Array.from(
      dom.exportOverviewList.querySelectorAll(
        '.android-export-thumb[data-export-state="idle"]',
      ),
    );
    if (!cards.length) return;
    const token = exportGallery.token;
    const request = (card) =>
      enqueueExportThumbnail(Number(card.dataset.exportIndex), card, token);
    if (typeof IntersectionObserver !== "function") {
      cards.forEach(request);
      return;
    }
    const observer = new IntersectionObserver(
      (entries, current) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          current.unobserve(entry.target);
          request(entry.target);
        });
      },
      {
        root: dom.exportOverviewList.parentElement || viewNode("settings"),
        rootMargin: "320px 0px",
      },
    );
    cards.forEach((card) => observer.observe(card));
    exportGallery.observer = observer;
  }

  function enqueueExportThumbnail(index, card, token) {
    if (!card || card.dataset.exportState !== "idle") return;
    card.dataset.exportState = "loading";
    exportGallery.queue.push({ index, card, token });
    pumpExportThumbnails();
  }

  function releaseExportThumbnails() {
    if (!exportGallery.thumbnailUrls.size) return;
    const api = platformApi();
    if (api && typeof api.releaseExportImage === "function") {
      for (const url of exportGallery.thumbnailUrls) {
        try {
          api.releaseExportImage(url);
        } catch (error) {
          /* 单个缩略图释放失败不阻塞列表刷新。 */
        }
      }
    }
    exportGallery.thumbnailUrls.clear();
  }

  function pumpExportThumbnails() {
    while (
      exportGallery.activeLoads < EXPORT_THUMB_CONCURRENCY &&
      exportGallery.queue.length
    ) {
      const job = exportGallery.queue.shift();
      if (
        job.token !== exportGallery.token ||
        !job.card.isConnected ||
        job.card.dataset.exportState !== "loading"
      ) {
        continue;
      }
      exportGallery.activeLoads += 1;
      loadExportThumbnail(job).finally(() => {
        exportGallery.activeLoads = Math.max(0, exportGallery.activeLoads - 1);
        pumpExportThumbnails();
      });
    }
  }

  function markExportThumbBroken(card) {
    if (!card) return;
    card.dataset.exportState = "broken";
    card.querySelector("img")?.remove();
    const placeholder = card.querySelector(".android-export-thumb-placeholder");
    if (placeholder && !placeholder.querySelector(".android-export-thumb-label")) {
      const label = document.createElement("span");
      label.className = "android-export-thumb-label";
      label.textContent = "无法预览";
      placeholder.append(label);
    }
  }

  async function loadExportThumbnail(job) {
    const image = exportGallery.entries[job.index];
    const api = platformApi();
    let result = null;
    if (image && api && typeof api.resolveExportImage === "function") {
      try {
        result = await api.resolveExportImage(image.uri, { size: "thumbnail" });
      } catch (error) {
        result = null;
      }
    }
    if (job.token !== exportGallery.token || !job.card.isConnected) {
      if (result?.url && typeof api?.releaseExportImage === "function") {
        try {
          api.releaseExportImage(result.url);
        } catch (error) {
          /* 过期缩略图请求释放失败不影响当前页面。 */
        }
      }
      return;
    }
    if (!result?.url) {
      markExportThumbBroken(job.card);
      return;
    }
    exportGallery.thumbnailUrls.add(result.url);
    const img = document.createElement("img");
    img.alt = "";
    img.decoding = "async";
    img.draggable = false;
    img.addEventListener(
      "load",
      () => {
        if (job.token !== exportGallery.token || !job.card.isConnected) return;
        job.card.dataset.exportState = "loaded";
      },
      { once: true },
    );
    img.addEventListener(
      "error",
      () => {
        if (job.token !== exportGallery.token) return;
        markExportThumbBroken(job.card);
      },
      { once: true },
    );
    job.card.append(img);
    img.src = result.url;
  }

  function exportViewerErrorMessage(reason) {
    if (reason === "IMAGE_TOO_LARGE") return "这张长图超过 32 MB，当前无法查看。";
    return "无法打开这张长图。";
  }

  function updateExportViewerTransform() {
    if (!dom?.exportViewerImage) return;
    const viewer = exportGallery.viewer;
    dom.exportViewerImage.style.transform = `translate3d(${viewer.x}px, ${viewer.y}px, 0) scale(${viewer.scale})`;
  }

  function clampExportViewerOffset() {
    const viewer = exportGallery.viewer;
    const stage = dom?.exportViewerStage;
    const image = dom?.exportViewerImage;
    if (!stage || !image) return;
    const limitX = Math.max(0, (image.offsetWidth * viewer.scale - stage.clientWidth) / 2);
    const limitY = Math.max(0, (image.offsetHeight * viewer.scale - stage.clientHeight) / 2);
    viewer.x = Math.min(limitX, Math.max(-limitX, viewer.x));
    viewer.y = Math.min(limitY, Math.max(-limitY, viewer.y));
  }

  function setExportViewerScale(nextScale) {
    const viewer = exportGallery.viewer;
    if (!viewer.open || viewer.loading || !viewer.url) return;
    viewer.scale = Math.min(
      EXPORT_ZOOM_MAX,
      Math.max(EXPORT_ZOOM_MIN, Number(nextScale) || EXPORT_ZOOM_MIN),
    );
    if (viewer.scale === EXPORT_ZOOM_MIN) {
      viewer.x = 0;
      viewer.y = 0;
    } else {
      clampExportViewerOffset();
    }
    updateExportViewerTransform();
  }

  function resetExportViewerZoom() {
    const viewer = exportGallery.viewer;
    viewer.scale = EXPORT_ZOOM_MIN;
    viewer.x = 0;
    viewer.y = 0;
    updateExportViewerTransform();
  }

  async function openExportViewer(index) {
    const image = exportGallery.entries[index];
    if (!image || !dom?.exportViewer) return;
    const api = platformApi();
    if (!api || typeof api.resolveExportImage !== "function") {
      toast("当前端不支持查看导出大图", "error");
      return;
    }
    closeExportViewer();
    const viewer = exportGallery.viewer;
    const token = ++viewer.token;
    viewer.open = true;
    viewer.loading = true;
    viewer.url = "";
    viewer.scale = EXPORT_ZOOM_MIN;
    viewer.x = 0;
    viewer.y = 0;
    viewer.pointers.clear();
    viewer.drag = null;
    viewer.pinch = null;
    scheduleBackStateReport();
    dom.exportViewer.classList.remove("hidden");
    dom.exportViewer.setAttribute("aria-hidden", "false");
    dom.exportViewerStage.dataset.state = "loading";
    dom.exportViewerImage.removeAttribute("src");
    dom.exportViewerImage.style.transform = "";
    dom.exportViewerStatus.textContent = "正在加载长图";
    dom.exportViewerStatus.classList.remove("hidden");

    let result = null;
    try {
      result = await api.resolveExportImage(image.uri, { size: "full" });
    } catch (error) {
      result = null;
    }
    if (!viewer.open || viewer.token !== token) {
      if (result?.url && typeof api.releaseExportImage === "function") {
        try {
          api.releaseExportImage(result.url);
        } catch (error) {
          /* 大图请求已过期，释放失败不影响当前页面。 */
        }
      }
      return;
    }
    if (!result?.url) {
      viewer.loading = false;
      dom.exportViewerStage.dataset.state = "error";
      dom.exportViewerStatus.textContent = exportViewerErrorMessage(result?.reason);
      return;
    }
    viewer.url = result.url;
    dom.exportViewerImage.src = result.url;
  }

  function closeExportViewer() {
    const viewer = exportGallery.viewer;
    if (!viewer.open) return false;
    viewer.open = false;
    viewer.loading = false;
    viewer.token += 1;
    viewer.pointers.clear();
    viewer.drag = null;
    viewer.pinch = null;
    viewer.scale = EXPORT_ZOOM_MIN;
    viewer.x = 0;
    viewer.y = 0;
    scheduleBackStateReport();
    dom?.exportViewer?.classList.add("hidden");
    dom?.exportViewer?.setAttribute("aria-hidden", "true");
    if (dom?.exportViewerStage) delete dom.exportViewerStage.dataset.state;
    dom?.exportViewerImage?.removeAttribute("src");
    if (dom?.exportViewerImage) dom.exportViewerImage.style.transform = "";
    if (dom?.exportViewerStatus) {
      dom.exportViewerStatus.textContent = "";
      dom.exportViewerStatus.classList.add("hidden");
    }
    const api = platformApi();
    if (viewer.url && api && typeof api.releaseExportImage === "function") {
      try {
        api.releaseExportImage(viewer.url);
      } catch (error) {
        /* 释放失败不阻塞关闭。 */
      }
    }
    viewer.url = "";
    return true;
  }

  function handleExportViewerPointerDown(event) {
    const viewer = exportGallery.viewer;
    if (!viewer.open || viewer.loading || !viewer.url) return;
    if (event.button !== undefined && event.button !== 0) return;
    try {
      dom.exportViewerStage.setPointerCapture(event.pointerId);
    } catch (error) {
      /* 某些 WebView 不支持指针捕获，仍按当前坐标处理拖动。 */
    }
    viewer.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (viewer.pointers.size === 1) {
      viewer.drag = {
        startX: event.clientX,
        startY: event.clientY,
        x: viewer.x,
        y: viewer.y,
      };
      viewer.pinch = null;
    } else if (viewer.pointers.size === 2) {
      const [left, right] = Array.from(viewer.pointers.values());
      viewer.drag = null;
      viewer.pinch = {
        distance: Math.hypot(right.x - left.x, right.y - left.y),
        scale: viewer.scale,
      };
    }
  }

  function handleExportViewerPointerMove(event) {
    const viewer = exportGallery.viewer;
    if (!viewer.pointers.has(event.pointerId)) return;
    viewer.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (viewer.pointers.size >= 2 && viewer.pinch) {
      const [left, right] = Array.from(viewer.pointers.values());
      const distance = Math.hypot(right.x - left.x, right.y - left.y);
      if (viewer.pinch.distance > 0) {
        setExportViewerScale(viewer.pinch.scale * (distance / viewer.pinch.distance));
      }
      return;
    }
    if (viewer.drag && viewer.scale > EXPORT_ZOOM_MIN) {
      viewer.x = viewer.drag.x + (event.clientX - viewer.drag.startX);
      viewer.y = viewer.drag.y + (event.clientY - viewer.drag.startY);
      clampExportViewerOffset();
      updateExportViewerTransform();
    }
  }

  function handleExportViewerPointerUp(event) {
    const viewer = exportGallery.viewer;
    if (!viewer.pointers.has(event.pointerId)) return;
    viewer.pointers.delete(event.pointerId);
    try {
      dom.exportViewerStage.releasePointerCapture(event.pointerId);
    } catch (error) {
      /* 指针未捕获时忽略。 */
    }
    if (viewer.pointers.size < 2) viewer.pinch = null;
    if (viewer.pointers.size === 1) {
      const point = Array.from(viewer.pointers.values())[0];
      viewer.drag = {
        startX: point.x,
        startY: point.y,
        x: viewer.x,
        y: viewer.y,
      };
    } else {
      viewer.drag = null;
    }
  }

  // ---------- 安卓全局搜索页（B3B-REQ-012） ----------

  function clearSearchTimer() {
    if (searchState.timer !== null) {
      window.clearTimeout(searchState.timer);
      searchState.timer = null;
    }
  }

  function resetSearchExpanded() {
    searchState.expanded = {
      roles: SEARCH_DEFAULT_ROWS,
      groups: SEARCH_DEFAULT_ROWS,
      chats: SEARCH_DEFAULT_ROWS,
    };
  }

  // 先在原文上分段，再分别转义，避免把用户输入当作 HTML 注入。
  function highlightHtml(value, query) {
    const source = String(value ?? "");
    const needle = String(query ?? "").toLocaleLowerCase();
    if (!needle) return escapeHtml(source);
    const lower = source.toLocaleLowerCase();
    let cursor = 0;
    let index = lower.indexOf(needle);
    let html = "";
    while (index >= 0) {
      html += escapeHtml(source.slice(cursor, index));
      html += `<mark>${escapeHtml(source.slice(index, index + needle.length))}</mark>`;
      cursor = index + needle.length;
      index = lower.indexOf(needle, cursor);
    }
    html += escapeHtml(source.slice(cursor));
    return html;
  }

  function searchRowHtml(options) {
    return `
      <button class="android-search-row" type="button" role="listitem" data-search-result="${options.type}"${options.attributes || ""}>
        <span class="android-search-avatar" aria-hidden="true">${options.avatarHtml || ""}</span>
        <span class="android-search-copy">
          <span class="android-search-name">${options.nameHtml}</span>
          <span class="android-search-meta">${options.metaHtml}</span>
          ${options.snippetHtml ? `<span class="android-search-snippet">${options.snippetHtml}</span>` : ""}
        </span>
        ${options.badge ? `<span class="android-search-badge">${escapeHtml(options.badge)}</span>` : ""}
      </button>
    `;
  }

  function renderSearchGroup(kind, title, rows, query) {
    if (!rows.length) return "";
    const shown = Math.min(searchState.expanded[kind] || SEARCH_DEFAULT_ROWS, rows.length);
    const remaining = rows.length - shown;
    return `
      <section class="android-search-group" data-search-group="${kind}">
        <h2 class="android-search-group-title">
          <span>${escapeHtml(title)}</span>
          <span class="android-search-group-count">${rows.length} 条</span>
        </h2>
        ${rows
          .slice(0, shown)
          .map((row) => {
            if (kind === "roles") {
              return searchRowHtml({
                type: "role",
                attributes: ` data-contact-id="${escapeHtml(row.id)}"`,
                avatarHtml: row.avatarHtml,
                nameHtml: highlightHtml(row.name, query),
                metaHtml: escapeHtml("角色"),
              });
            }
            if (kind === "groups") {
              const match = row.matchedMembers.length
                ? ` · 命中成员：${row.matchedMembers.join("、")}`
                : "";
              return searchRowHtml({
                type: "group",
                attributes: ` data-contact-id="${escapeHtml(row.id)}"`,
                avatarHtml: row.avatarHtml,
                nameHtml: highlightHtml(row.name, query),
                metaHtml: highlightHtml(`群组 · ${row.memberCount} 人${match}`, query),
              });
            }
            const speakers = row.matchedSpeakers.length
              ? ` · 命中角色：${row.matchedSpeakers.join("、")}`
              : "";
            return searchRowHtml({
              type: "chat",
              attributes: [
                ` data-project-id="${escapeHtml(row.projectId)}"`,
                ` data-contact-id="${escapeHtml(row.contactId)}"`,
                ` data-conversation-key="${escapeHtml(row.conversationKey)}"`,
                ` data-message-id="${escapeHtml(row.messageId)}"`,
              ].join(""),
              avatarHtml: row.avatarHtml,
              nameHtml: highlightHtml(row.contactName, query),
              metaHtml: highlightHtml(`${row.projectTitle} · ${row.count} 条匹配${speakers}`, query),
              snippetHtml: highlightHtml(row.snippet, query),
              badge: row.count > 1 ? `${row.count}` : "",
            });
          })
          .join("")}
        ${
          remaining > 0
            ? `<button class="android-search-more" type="button" data-search-more="${kind}">显示更多（剩余 ${remaining} 条）</button>`
            : ""
        }
      </section>
    `;
  }

  function renderSearch() {
    if (!dom?.searchResults) return;
    const query = searchState.query.trim();
    if (!query) {
      dom.searchResults.innerHTML =
        '<p class="android-search-empty">输入关键词，搜索角色、群组和聊天记录。</p>';
      return;
    }
    if (searchState.error) {
      dom.searchResults.innerHTML = `<p class="android-search-empty">${escapeHtml(
        searchState.error,
      )}</p>`;
      return;
    }
    const result = searchState.result;
    if (!result || result.query !== query) {
      dom.searchResults.innerHTML = '<p class="android-search-empty">正在搜索…</p>';
      return;
    }
    const roles = Array.isArray(result.roles) ? result.roles : [];
    const groups = Array.isArray(result.groups) ? result.groups : [];
    const chats = Array.isArray(result.chats) ? result.chats : [];
    if (!roles.length && !groups.length && !chats.length) {
      dom.searchResults.innerHTML = `<p class="android-search-empty">没有找到与「${escapeHtml(
        query,
      )}」相关的内容。</p>`;
      return;
    }
    dom.searchResults.innerHTML = [
      renderSearchGroup("roles", "角色", roles, query),
      renderSearchGroup("groups", "群组", groups, query),
      renderSearchGroup("chats", "聊天记录", chats, query),
    ].join("");
  }

  async function runSearch(query, token) {
    const api = appApi();
    if (!api || typeof api.searchLocal !== "function") {
      if (token !== searchState.token) return;
      searchState.error = "当前端不支持本机搜索。";
      renderSearch();
      return;
    }
    let result = null;
    let error = "";
    try {
      result = await api.searchLocal(query);
    } catch (caught) {
      error = caught?.message || "搜索失败，请重试。";
    }
    if (token !== searchState.token || state.view !== "search") return;
    if (error || !result) {
      searchState.error = error || "搜索失败，请重试。";
      searchState.result = null;
    } else {
      searchState.error = "";
      searchState.result = result;
      resetSearchExpanded();
    }
    renderSearch();
  }

  function scheduleSearch(input) {
    searchState.query = String(input?.value ?? "");
    dom.searchClear?.classList.toggle("hidden", !searchState.query);
    clearSearchTimer();
    const query = searchState.query.trim();
    const token = ++searchState.token;
    searchState.result = null;
    searchState.error = "";
    resetSearchExpanded();
    renderSearch();
    if (!query) return;
    searchState.timer = window.setTimeout(() => {
      searchState.timer = null;
      runSearch(query, token);
    }, SEARCH_DEBOUNCE_MS);
  }

  function clearSearchInput() {
    if (!dom?.searchInput) return;
    clearSearchTimer();
    searchState.token += 1;
    searchState.query = "";
    searchState.result = null;
    searchState.error = "";
    dom.searchInput.value = "";
    dom.searchClear?.classList.add("hidden");
    resetSearchExpanded();
    renderSearch();
  }

  function openSearchPage() {
    if (!dom) return;
    clearSearchInput();
    searchState.focusPending = true;
    navigateTo({ view: "search" });
  }

  async function openSearchChat(row) {
    if (searchState.opening) return;
    const api = appApi();
    if (!api || typeof api.openSearchChatResult !== "function") {
      toast("当前端不支持打开聊天结果", "error");
      return;
    }
    searchState.opening = true;
    try {
      const opened = await api.openSearchChatResult({
        projectId: row.dataset.projectId || "",
        contactId: row.dataset.contactId || "",
        conversationKey: row.dataset.conversationKey || "",
        messageId: row.dataset.messageId || "",
      });
      if (opened) navigateTo({ view: "conversation" });
    } catch (error) {
      toast(error?.message || "无法打开该会话", "error");
    } finally {
      searchState.opening = false;
    }
  }

  // 软键盘视口适配（B3-A-T3）：软键盘弹出时 visualViewport 变矮，把可视高度写进
  // --android-vv-height，外壳高度跟随可视高度，底部固定输入条随之上移，输入内容与
  // 发送按钮不被键盘遮挡。桌面壳不启用，桌面布局与交互保持原样。
  function setupViewport() {
    const root = document.documentElement;
    const composer = document.getElementById("messageComposer");
    const syncComposerHeight = () => {
      const height = composer?.getBoundingClientRect().height || 0;
      if (height > 0) {
        root.style.setProperty("--android-composer-height", `${Math.round(height * 100) / 100}px`);
      }
    };
    // 输入框换行、系统字体变化或安全区变化都会改变输入条高度，聊天滚动区必须跟着调整，
    // 不能再依赖一套固定 bottom 值。
    syncComposerHeight();
    if (composer && typeof ResizeObserver === "function") {
      composerResizeObserver?.disconnect();
      composerResizeObserver = new ResizeObserver(syncComposerHeight);
      composerResizeObserver.observe(composer);
    }
    window.addEventListener("resize", syncComposerHeight);

    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      root.style.setProperty("--android-vv-height", `${Math.round(vv.height)}px`);
      syncComposerHeight();
    };
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    apply();
  }

  // 把桌面外壳里的业务节点搬进安卓外壳占位容器：节点本身（含 id）保持唯一，
  // 业务层按 id 查到的引用继续有效，因此无需在安卓端复制一套业务实现。
  function relocateBusinessNodes() {
    // 会话分页：预览电话里的会话卡列表（图 1）整块搬出复用，保留 #contactList。
    const conversationList = document.getElementById("contactList");
    if (conversationList && dom.conversationsHost) dom.conversationsHost.append(conversationList);

    // 联系人分页：搜索 + 分类筛选 + 列表（图 3）。分页控件留在桌面，不搬。
    ["editorContactSearch", "editorContactFilters", "editorContactList"].forEach((id) => {
      const node = document.getElementById(id);
      if (node && dom.contactsHost) dom.contactsHost.append(node);
    });

    // 会话页：整块工作区（聊天预览 + 编辑面板）先搬入，再把编辑列拆进右侧抽屉。
    const workspace = document.querySelector("main.workspace");
    if (workspace && dom.conversationHost && workspace.parentElement !== dom.conversationHost) {
      dom.conversationHost.append(workspace);
    }
    const editorColumn = document.querySelector(".editor-column");
    if (editorColumn && dom.drawerHost && editorColumn.parentElement !== dom.drawerHost) {
      dom.drawerHost.append(editorColumn);
    }

    // 顶部全局个人显示设置条：搬入管理员头像 / 气泡两个业务按钮（保留原事件处理）。
    const avatarButton = document.getElementById("previewRailAvatarButton");
    if (avatarButton && dom.displayAvatarSlot && avatarButton.parentElement !== dom.displayAvatarSlot) {
      dom.displayAvatarSlot.append(avatarButton);
    }
    const bubbleButton = document.getElementById("railBubbleButton");
    if (bubbleButton && dom.displayBubbleSlot && bubbleButton.parentElement !== dom.displayBubbleSlot) {
      dom.displayBubbleSlot.append(bubbleButton);
    }

    // 设置页：项目管理（项目列表 + 保存）从桌面左侧栏搬入。
    const sidebar = document.querySelector(".sidebar");
    if (sidebar && dom.projectHost && sidebar.parentElement !== dom.projectHost) {
      dom.projectHost.append(sidebar);
    }
  }

  function bindEvents() {
    dom.tabButtons.forEach((button) => {
      button.addEventListener("click", () => selectTab(button.dataset.androidTab));
    });

    dom.backButton.addEventListener("click", () => goBack());

    // ---------- 会话编辑抽屉：点把手 / 应用栏按钮打开，点遮罩或关闭按钮收起 ----------
    if (dom.drawerHandle) dom.drawerHandle.addEventListener("click", () => openDrawer());
    if (dom.drawerButton) dom.drawerButton.addEventListener("click", () => openDrawer());
    if (dom.addSystemMessageButton) {
      dom.addSystemMessageButton.addEventListener("click", () => {
        const api = appApi();
        if (!api || typeof api.addSystemMessage !== "function") return;
        if (!api.addSystemMessage()) {
          toast("当前会话暂不能添加系统消息", "error");
          return;
        }
        openDrawer();
        window.requestAnimationFrame(() => {
          document.getElementById("messageTextInput")?.focus();
        });
      });
    }
    if (dom.drawerClose) dom.drawerClose.addEventListener("click", () => closeDrawer());
    if (dom.drawerScrim) {
      dom.drawerScrim.addEventListener("click", () => {
        if (Date.now() - drawerSwipeOpenedAt < 400) return;
        closeDrawer();
      });
    }

    // 右边缘向左滑打开抽屉；抽屉内向右滑收起。用 pointer 事件同时覆盖触摸与鼠标。
    if (dom.conversationView) {
      dom.conversationView.addEventListener("pointerdown", (event) => {
        if (state.view !== "conversation" || state.drawerOpen) return;
        const width = dom.conversationView.clientWidth || 0;
        if (event.clientX < width * (1 - DRAWER_SWIPE_ZONE)) return;
        dom.drawerSwipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
      });
      dom.conversationView.addEventListener("pointermove", (event) => {
        const swipe = dom.drawerSwipe;
        if (!swipe || swipe.id !== event.pointerId) return;
        const dx = swipe.x - event.clientX;
        const dy = Math.abs(event.clientY - swipe.y);
        if (dx >= DRAWER_SWIPE_MIN && dx > dy) {
          dom.drawerSwipe = null;
          drawerSwipeOpenedAt = Date.now();
          openDrawer();
        }
      });
      const endSwipe = () => {
        dom.drawerSwipe = null;
      };
      dom.conversationView.addEventListener("pointerup", endSwipe);
      dom.conversationView.addEventListener("pointercancel", endSwipe);
      dom.conversationView.addEventListener("pointerleave", endSwipe);
    }
    if (dom.drawer) {
      dom.drawer.addEventListener("pointerdown", (event) => {
        dom.drawerSwipe = { id: event.pointerId, x: event.clientX, y: event.clientY, close: true };
      });
      dom.drawer.addEventListener("pointermove", (event) => {
        const swipe = dom.drawerSwipe;
        if (!swipe || !swipe.close || swipe.id !== event.pointerId) return;
        // 抽屉内是纵向可滚动的编辑表单：只有横向位移明显大于纵向位移才算关闭手势，
        // 避免竖着滚动表单时被顺带关掉。
        const dx = event.clientX - swipe.x;
        if (dx >= 40 && dx > Math.abs(event.clientY - swipe.y)) {
          dom.drawerSwipe = null;
          closeDrawer();
        }
      });
    }

    // 设置页入口：项目目录等进入子页，未落地功能保留占位提示。
    dom.settingsEntries.forEach((entry) => {
      entry.addEventListener("click", () => openSettingsPage(entry.dataset.androidSettingsEntry));
    });
    dom.settingsBackButtons.forEach((button) => {
      button.addEventListener("click", () => goBack());
    });
    dom.settingsProjectsBack?.addEventListener("click", () => goBack());

    dom.feedbackCopyButtons.forEach((button) => {
      button.addEventListener("click", async () => {
        const value = button.dataset.feedbackCopy || "";
        try {
          if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
          else {
            const input = document.createElement("textarea");
            input.value = value;
            input.style.position = "fixed";
            input.style.opacity = "0";
            document.body.append(input);
            input.select();
            document.execCommand("copy");
            input.remove();
          }
          toast(`已复制：${value}`);
        } catch (error) {
          toast("复制失败，请长按选择文本", "error");
        }
      });
    });

    dom.exportOverviewList?.addEventListener("click", (event) => {
      const retry = event.target.closest("[data-export-retry]");
      if (retry) {
        refreshExportGallery({ force: true });
        return;
      }
      const thumb = event.target.closest(".android-export-thumb[data-export-index]");
      if (!thumb) return;
      openExportViewer(Number(thumb.dataset.exportIndex));
    });

    dom.exportViewerClose?.addEventListener("click", closeExportViewer);
    dom.exportViewerZoomIn?.addEventListener("click", () => {
      setExportViewerScale(exportGallery.viewer.scale * 1.5);
    });
    dom.exportViewerZoomOut?.addEventListener("click", () => {
      setExportViewerScale(exportGallery.viewer.scale / 1.5);
    });
    dom.exportViewerReset?.addEventListener("click", resetExportViewerZoom);
    dom.exportViewerStage?.addEventListener("pointerdown", handleExportViewerPointerDown);
    dom.exportViewerStage?.addEventListener("pointermove", handleExportViewerPointerMove);
    dom.exportViewerStage?.addEventListener("pointerup", handleExportViewerPointerUp);
    dom.exportViewerStage?.addEventListener("pointercancel", handleExportViewerPointerUp);
    dom.exportViewerStage?.addEventListener(
      "wheel",
      (event) => {
        if (!exportGallery.viewer.open) return;
        event.preventDefault();
        setExportViewerScale(exportGallery.viewer.scale * Math.exp(-event.deltaY * 0.0015));
      },
      { passive: false },
    );
    dom.exportViewerImage?.addEventListener("load", () => {
      if (!exportGallery.viewer.open) return;
      exportGallery.viewer.loading = false;
      dom.exportViewerStage.dataset.state = "ready";
      dom.exportViewerStatus.classList.add("hidden");
    });
    dom.exportViewerImage?.addEventListener("error", () => {
      if (!exportGallery.viewer.open) return;
      exportGallery.viewer.loading = false;
      dom.exportViewerStage.dataset.state = "error";
      dom.exportViewerStatus.textContent = "无法打开这张长图。";
      dom.exportViewerStatus.classList.remove("hidden");
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !closeExportViewer()) return;
      event.preventDefault();
    });

    dom.modeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        // AI 对话模式尚未实现：点击只给出「开发中」提示，不切走本地编辑模式。
        if (button.dataset.androidMode === "ai") {
          toast("AI 对话开发中，敬请期待");
          return;
        }
        if (button.dataset.androidMode === state.mode) return;
        setMode(button.dataset.androidMode);
        toast("已切换到本地编辑模式");
      });
    });

    dom.settingsActions.forEach((button) => {
      button.addEventListener("click", async () => {
        const action = button.dataset.androidAction;
        if (action === "theme") {
          toggleTheme();
          return;
        }
        if (action === "bug-folder") {
          const api = platformApi();
          if (!api || typeof api.chooseBugFolder !== "function") {
            toast("当前端未启用 Bug 记录文件夹", "error");
            return;
          }
          try {
            const result = await api.chooseBugFolder();
            if (result && result.cancelled) toast("已取消更换");
            else {
              updateBugFolderLabel();
              toast("Bug 记录文件夹已更新");
            }
          } catch (error) {
            toast(error.message || "更换失败", "error");
          }
          return;
        }
        if (action === "feedback") {
          openSettingsPage("feedback");
          return;
        }
        if (action === "update-info") {
          await refreshVersionInfo();
          openSettingsPage("update-info");
          return;
        }
        if (action === "export-overview") {
          exportGallery.loadedOnce = false;
          openSettingsPage("export");
          return;
        }
        toast(PLACEHOLDER_TOASTS[action] || "该功能开发中，敬请期待");
      });
    });

    // 会话分页的页内搜索进入独立全屏搜索页（B3B-REQ-012）。
    const globalSearch = dom.shell.querySelector('[data-hook="global-search"]');
    if (globalSearch) {
      globalSearch.addEventListener("click", () => openSearchPage());
    }

    dom.searchInput?.addEventListener("input", () => scheduleSearch(dom.searchInput));
    dom.searchClear?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      clearSearchInput();
      dom.searchInput?.focus();
    });
    dom.searchCancel?.addEventListener("click", () => goBack());
    dom.searchResults?.addEventListener("click", (event) => {
      const more = event.target.closest("[data-search-more]");
      if (more) {
        const kind = more.dataset.searchMore;
        if (kind === "roles" || kind === "groups" || kind === "chats") {
          searchState.expanded[kind] =
            (searchState.expanded[kind] || SEARCH_DEFAULT_ROWS) + SEARCH_MORE_ROWS;
          renderSearch();
        }
        return;
      }
      const row = event.target.closest("[data-search-result]");
      if (!row) return;
      if (row.dataset.searchResult === "chat") {
        openSearchChat(row);
        return;
      }
      if (
        row.dataset.searchResult === "role" ||
        row.dataset.searchResult === "group"
      ) {
        clearSearchTimer();
        openContactInfo(row.dataset.contactId);
      }
    });

    // 会话分页点条目进入会话：业务层已在 #contactList 上处理 selectRole，
    // 外壳只补一层页面导航（新建群组入口不导航）。
    dom.conversationsHost.addEventListener("click", (event) => {
      if (event.target.closest('[data-action="new-group"]')) return;
      if (event.target.closest('[data-action="remove-preview"]')) return;
      if (!event.target.closest("[data-contact-id]")) return;
      openConversation();
    });

    // 联系人分页点一行：单击进信息页，双击加入会话并直接进入。
    dom.contactsHost.addEventListener("click", (event) => {
      const card = event.target.closest("[data-editor-contact-id]");
      if (!card) return;
      handleContactTap(card, event);
    });

    document.addEventListener(APP_EVENT, () => {
      if (state.view === "conversation") updateChrome();
    });

    // 业务层改名成功后同步信息页应用栏；外壳只跟随名称事实源，不自行拼接群名。
    document.addEventListener("mimirtalk:contact-renamed", (event) => {
      const detail = event.detail || {};
      if (String(detail.id) !== String(state.infoContactId)) return;
      if (state.view !== "group-info" && state.view !== "character-info") return;
      state.infoTitle = typeof detail.name === "string" ? detail.name : state.infoTitle;
      updateChrome();
    });

    // 业务层请求切页（如解散群聊后回退到联系人页）：外壳只负责选页，不承载业务。
    document.addEventListener("mimirtalk:view-request", (event) => {
      const detail = event.detail || {};
      const view = detail.view;
      if (typeof view !== "string") return;
      if (view === "group-picker") {
        // 全屏选择页标题由业务层给出（邀请 / 创建 / 移除各不同），取消回退到 parent。
        state.pickerTitle = typeof detail.title === "string" ? detail.title : "选择成员";
        state.pickerParent = typeof detail.parent === "string" ? detail.parent : "group-info";
      }
      navigateTo({ view });
    });
  }

  function collectDom() {
    const shell = document.getElementById("androidShell");
    const views = Array.from(shell.querySelectorAll("[data-android-view]"));
    return {
      shell,
      app: document.getElementById("app"),
      appbarTitle: document.getElementById("androidAppbarTitle"),
      appbarSubtitle: document.getElementById("androidAppbarSubtitle"),
      appbarActions: document.getElementById("androidAppbarActions"),
      backButton: document.getElementById("androidBackButton"),
      viewContainer: shell.querySelector(".android-views"),
      views,
      tabButtons: Array.from(shell.querySelectorAll("[data-android-tab]")),
      modeButtons: Array.from(shell.querySelectorAll("[data-android-mode]")),
      settingsActions: Array.from(shell.querySelectorAll("[data-android-action]")),
      settingsEntries: Array.from(shell.querySelectorAll("[data-android-settings-entry]")),
      conversationsHost: document.getElementById("androidConversationsHost"),
      contactsHost: document.getElementById("androidContactsHost"),
      conversationHost: document.getElementById("androidConversationHost"),
      conversationView: document.getElementById("androidViewConversation"),
      groupInfoView: document.getElementById("androidViewGroupInfo"),
      characterInfoView: document.getElementById("androidViewCharacterInfo"),
      groupInfoHost: document.getElementById("androidGroupInfoHost"),
      characterInfoHost: document.getElementById("androidCharacterInfoHost"),
      groupPickerView: document.getElementById("androidViewGroupPicker"),
      groupPickerHost: document.getElementById("androidGroupPickerHost"),
      searchView: document.getElementById("androidViewSearch"),
      searchInput: document.getElementById("androidSearchInput"),
      searchClear: document.getElementById("androidSearchClear"),
      searchCancel: document.getElementById("androidSearchCancel"),
      searchResults: document.getElementById("androidSearchResults"),
      drawer: document.getElementById("androidConversationDrawer"),
      drawerHost: document.getElementById("androidConversationDrawerHost"),
      drawerButton: document.getElementById("androidDrawerButton"),
      addSystemMessageButton: document.getElementById("androidAddSystemMessageButton"),
      drawerHandle: document.getElementById("androidDrawerHandle"),
      drawerClose: document.getElementById("androidDrawerClose"),
      drawerScrim: document.getElementById("androidDrawerScrim"),
      settingsList: document.getElementById("androidSettingsList"),
      settingsProjectsPage: document.getElementById("androidSettingsProjectsPage"),
      settingsProjectsBack: document.getElementById("androidSettingsProjectsBack"),
      settingsBackButtons: Array.from(shell.querySelectorAll("[data-android-subpage-back]")),
      themeToggle: document.getElementById("androidThemeToggle"),
      feedbackCopyButtons: Array.from(shell.querySelectorAll("[data-feedback-copy]")),
      bugFolderValue: document.getElementById("androidBugFolderValue"),
      aboutApkVersion: document.getElementById("androidAboutApkVersion"),
      aboutWebuiVersion: document.getElementById("androidAboutWebuiVersion"),
      aboutHotupdateVersion: document.getElementById("androidAboutHotupdateVersion"),
      versionValue: document.getElementById("androidVersionValue"),
      exportOverviewList: document.getElementById("androidExportOverviewList"),
      exportFolderLabel: document.getElementById("androidExportFolderLabel"),
      exportViewer: document.getElementById("androidExportViewer"),
      exportViewerStage: document.getElementById("androidExportViewerStage"),
      exportViewerImage: document.getElementById("androidExportViewerImage"),
      exportViewerStatus: document.getElementById("androidExportViewerStatus"),
      exportViewerClose: document.getElementById("androidExportViewerClose"),
      exportViewerZoomIn: document.getElementById("androidExportViewerZoomIn"),
      exportViewerZoomOut: document.getElementById("androidExportViewerZoomOut"),
      exportViewerReset: document.getElementById("androidExportViewerReset"),
      displayAvatarSlot: document.getElementById("androidDisplayAvatarSlot"),
      displayBubbleSlot: document.getElementById("androidDisplayBubbleSlot"),
      projectHost: document.getElementById("androidProjectHost"),
      projectCount: document.getElementById("androidProjectCount"),
      exportCount: document.getElementById("androidExportCount"),
    };
  }

  function mount(context = {}) {
    const kind = resolveKind(context);
    state.kind = kind;
    if (kind !== "android") return state;
    if (mounted) return state;

    const collected = collectDom();
    if (!collected.shell || !collected.app || !collected.conversationsHost) return state;
    dom = collected;

    collected.app.classList.add("hidden");
    collected.shell.classList.remove("hidden");
    document.documentElement.dataset.shell = "android";

    // 联系人分页在安卓端走子目录分组（不分页），由业务层同一份渲染逻辑输出。
    const api = appApi();
    if (api && typeof api.setContactListLayout === "function") api.setContactListLayout("grouped");

    relocateBusinessNodes();
    // 输入条搬入会话页后再测量，隐藏状态下的桌面节点高度为 0。
    setupViewport();
    bindEvents();
    applyTheme(readTheme());
    setMode(readMode());
    renderSettings();
    refreshVersionInfo();
    state.pageStack = [];
    applyPageState({ view: "conversations", settingsPage: "list" }, { restoreScroll: false });
    mounted = true;
    scheduleBackStateReport();
    return state;
  }

  window.MimirTalkShell = {
    resolveKind,
    mount,
    getState: () => ({ ...state }),
    showView,
    selectTab,
    canGoBack,
    notifyNavigationChanged: scheduleBackStateReport,
    goBack,
    openConversation,
    setPane,
    openDrawer,
    closeDrawer,
    openSettingsPage,
    openSearchPage,
    setMode,
  };
})();
