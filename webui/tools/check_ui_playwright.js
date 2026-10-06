/*
 * MimirTalk WebUI Playwright 回归脚本。
 * 覆盖编辑栏、项目、群聊、消息、气泡、字体、响应式布局和 PNG 导出。
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const baseUrl = process.env.MOMOTALK_URL || "http://127.0.0.1:8765";
const outputDir = path.resolve(process.env.MOMOTALK_OUTPUT || "output/stage4");
const repoRoot = path.resolve(__dirname, "..", "..");
const assetIndexPath = path.join(repoRoot, "mimirtalk_webui", "data", "asset_index.json");
const AVATAR_FRAME_INSET_RATIO = 10 / 108;
const AVATAR_FRAME_CONTENT_RATIO = 1 - AVATAR_FRAME_INSET_RATIO * 2;
const AVATAR_FRAME_CONTENT_RADIUS_PERCENT = ((6 / 88) * 100).toFixed(5);
const ALLOW_GROUP_MUTATION = process.env.MOMOTALK_GROUP_MUTATION === "1";

const LONG_CONTACT_NAME =
  "弥弥尔测试角色名称超长超长超长超长超长超长超长超长超长";
const LONG_URL =
  "https://example.com/aethergazer/momotalk/archive/2026/09/18/stage4-layout-regression-check?channel=mimir&mode=webui&payload=very-long-query-value";
const LONG_CHINESE =
  "这是一条用于验证超长中文换行和布局稳定性的消息。".repeat(8);
const SYSTEM_TEXT = "系统提示：" + LONG_CHINESE.slice(0, 70);
const RECALL_TEXT = "对方撤回了一条消息";
const DIRECT_MESSAGE_TEXT = "群聊发言人测试：" + LONG_CHINESE.slice(0, 36);
const ADMIN_MESSAGE_TEXT = "管理员发言测试：" + LONG_CHINESE.slice(0, 30);

const stageStartedAt = Date.now();

function stage(message) {
  if (process.env.MOMOTALK_QUIET !== "1") {
    const elapsed = ((Date.now() - stageStartedAt) / 1000).toFixed(1);
    console.error(`[ui-check +${elapsed}s] ${message}`);
  }
}

function loadFixtureAssets() {
  const index = JSON.parse(fs.readFileSync(assetIndexPath, "utf8"));
  const assets = Array.isArray(index.assets) ? index.assets : [];
  const pick = (predicate) => assets.find(predicate)?.id || null;
  const backgroundAsset =
    assets.find((asset) => asset.id === "backgrounds:texturebg_momotalk_momotalk_04:Momotalk_04") ||
    assets.find((asset) => asset.category === "backgrounds" && asset.name === "Momotalk_03");
  return {
    avatar:
      pick((asset) => asset.category === "momotalk_images" && asset.width === asset.height) ||
      pick((asset) => asset.category === "character_icon") ||
      assets[0]?.id,
    sticker:
      pick((asset) => asset.id.includes("chatsticker_icon_face_add")) ||
      pick((asset) => asset.category === "chat_stickers" && asset.width !== asset.height) ||
      pick((asset) => asset.category === "chat_stickers"),
    background: backgroundAsset?.id || null,
    uploadImagePath: backgroundAsset ? path.join(repoRoot, backgroundAsset.path) : null,
  };
}

async function loadEnabledContacts(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/contacts");
    if (!response.ok) throw new Error(`Failed to load contacts: ${response.status}`);
    const payload = await response.json();
    return Array.isArray(payload.items) ? payload.items : [];
  });
}

async function loadConversationContacts(page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/conversation-contacts");
    if (!response.ok) throw new Error(`Failed to load conversation contacts: ${response.status}`);
    const payload = await response.json();
    return {
      version: payload.version,
      contactIds: Array.isArray(payload.contact_ids) ? payload.contact_ids : [],
      previewIds: Array.isArray(payload.preview_ids) ? payload.preview_ids : [],
      previewItems: Array.isArray(payload.preview_items) ? payload.preview_items : [],
    };
  });
}

async function savePreviewIds(page, ids) {
  return page.evaluate(async (nextIds) => {
    const response = await fetch("/api/conversation-contacts", {
      method: "PUT",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ preview_ids: nextIds }),
    });
    if (!response.ok) throw new Error(`Failed to write preview ids: ${response.status}`);
    return response.json();
  }, ids);
}

function contactMemberIds(contact) {
  return Array.isArray(contact?.member_ids)
    ? contact.member_ids.map((value) => Number(value)).filter((value) => Number.isInteger(value))
    : [];
}

function assertGroupTiles(layout, expectedTiles, label, issues) {
  if (!layout || layout.layout !== "tiles" || layout.tiles.length !== expectedTiles.length) {
    issues.push(`${label}: expected ${expectedTiles.length} group avatar tiles, got ${JSON.stringify(layout)}.`);
    return;
  }
  for (let index = 0; index < expectedTiles.length; index += 1) {
    const actual = layout.tiles[index];
    const expected = expectedTiles[index];
    for (const key of ["left", "top", "width", "height"]) {
      if (Math.abs(actual[key] - expected[key]) > 0.1) {
        issues.push(
          `${label}: group tile ${index} ${key} is ${actual[key]}, expected ${expected[key]}.`,
        );
      }
    }
  }
}

async function readGroupPreviewLayout(page) {
  return page.locator("#groupAvatarPreview .group-avatar-mosaic").evaluate((node) => ({
    layout: node.getAttribute("data-layout") || "",
    count: Number(node.getAttribute("data-count") || 0),
    text: node.textContent.trim(),
    tiles: [...node.querySelectorAll(".group-avatar-tile")].map((tile) => ({
      left: Number.parseFloat(tile.style.left) || 0,
      top: Number.parseFloat(tile.style.top) || 0,
      width: Number.parseFloat(tile.style.width) || 0,
      height: Number.parseFloat(tile.style.height) || 0,
    })),
  }));
}

async function readConversationUi(page, contactId) {
  return page.evaluate((id) => {
    const row = [...document.querySelectorAll("#contactList [data-contact-id]")].find(
      (node) => node.getAttribute("data-contact-id") === String(id),
    );
    return {
      active: row?.classList.contains("active") || false,
      preview: row?.querySelector(".side-entry-text small")?.textContent.trim() || "",
      contactName: document.querySelector("#previewContactName")?.textContent.trim() || "",
      chatText: document.querySelector("#chatScroll")?.textContent || "",
      chatRows: document.querySelectorAll("#chatScroll .chat-row").length,
      editorRows: document.querySelectorAll(".message-list-item").length,
    };
  }, String(contactId));
}

// 验证角色会话隔离，避免不同联系人串消息。
async function verifyConversationIsolation(page, issues) {
  // 会话隔离改用默认会话清单里的条目：一个角色 + 一个内置群。
  const previews = await loadConversationContacts(page);
  const firstContact = previews.previewItems.find((contact) => contact.kind !== "group");
  const secondContact = previews.previewItems.find((contact) => contact.kind === "group");
  if (!firstContact || !secondContact) {
    issues.push(
      `Conversation isolation needs one hero and one group in the preview list, got ${JSON.stringify(previews.previewIds)}.`,
    );
    return null;
  }

  const firstText = `角色独立消息 ${Date.now()}`;
  const secondText = "系统提示";

  stage("conversation isolation");
  await page.click("#projectCreateButton");
  await page.waitForFunction(() => document.querySelector("#previewTitle")?.textContent === "未命名项目");
  await page.waitForSelector("#contactList [data-contact-id]");

  await page.click(`#contactList [data-contact-id="${firstContact.id}"]`);
  await page.waitForFunction(
    (name) => document.querySelector("#previewContactName")?.textContent === name,
    firstContact.name,
  );
  await page.click("#addMessageButton");
  await page.waitForSelector("#messageTextInput");
  await page.fill("#messageTextInput", firstText);
  await page.waitForFunction((text) => document.querySelector("#chatScroll")?.textContent.includes(text), firstText);

  await page.click(`#contactList [data-contact-id="${secondContact.id}"]`);
  await page.waitForFunction(
    (name) => document.querySelector("#previewContactName")?.textContent === name,
    secondContact.name,
  );
  const secondEmpty = await readConversationUi(page, secondContact.id);
  if (secondEmpty.chatRows !== 0 || secondEmpty.editorRows !== 0) {
    issues.push(`Switching to a new contact created or reused chat messages: ${JSON.stringify(secondEmpty)}.`);
  }
  if (secondEmpty.chatText.includes(firstText) || secondEmpty.preview.includes(firstText)) {
    issues.push(`New contact reused the previous contact chat: ${JSON.stringify(secondEmpty)}.`);
  }

  await page.click("#addMessageButton");
  await page.waitForSelector("#messageTypeSelect");
  const defaultType = await page.inputValue("#messageTypeSelect");
  const defaultText = await page.inputValue("#messageTextInput");
  if (defaultType !== "system") {
    issues.push(`Adding a message should default to system, got "${defaultType}".`);
  }
  if (defaultText !== secondText) {
    issues.push(`Adding a message should default to "${secondText}", got "${defaultText}".`);
  }
  const messageTypes = await page.locator("#messageTypeSelect option").evaluateAll((nodes) =>
    nodes.map((node) => node.value),
  );
  if (JSON.stringify(messageTypes) !== JSON.stringify(["text", "sticker", "image", "system", "recall"])) {
    issues.push(`Unexpected message type options: ${JSON.stringify(messageTypes)}.`);
  }
  if ((await page.locator("#messageDelayInput").count()) !== 0) {
    issues.push("Removed delay input is still present.");
  }
  if ((await page.locator("#choicePanel").count()) !== 0) {
    issues.push("Removed choice panel is still present.");
  }

  await page.click(`#contactList [data-contact-id="${firstContact.id}"]`);
  await page.waitForFunction(
    (name) => document.querySelector("#previewContactName")?.textContent === name,
    firstContact.name,
  );
  const firstRestored = await readConversationUi(page, firstContact.id);
  if (firstRestored.chatRows !== 1 || !firstRestored.chatText.includes(firstText)) {
    issues.push(`Returning to the first contact did not restore its conversation: ${JSON.stringify(firstRestored)}.`);
  }
  if (firstRestored.chatText.includes(secondText)) {
    issues.push(`The first contact inherited the second contact message: ${JSON.stringify(firstRestored)}.`);
  }

  await page.click("#saveButton");
  await page.waitForFunction(() => document.querySelector("#saveState")?.textContent.trim() === "已保存");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#contactList [data-contact-id]");
  await page.waitForFunction(
    (name) => document.querySelector("#previewContactName")?.textContent === name,
    firstContact.name,
  );
  const firstAfterReload = await readConversationUi(page, firstContact.id);
  if (firstAfterReload.chatRows !== 1 || !firstAfterReload.chatText.includes(firstText)) {
    issues.push(`First contact conversation did not persist after reload: ${JSON.stringify(firstAfterReload)}.`);
  }
  await page.click(`#contactList [data-contact-id="${secondContact.id}"]`);
  await page.waitForFunction(
    (name) => document.querySelector("#previewContactName")?.textContent === name,
    secondContact.name,
  );
  const secondAfterReload = await readConversationUi(page, secondContact.id);
  if (secondAfterReload.chatRows !== 1 || !secondAfterReload.chatText.includes(secondText)) {
    issues.push(`Second contact conversation did not persist after reload: ${JSON.stringify(secondAfterReload)}.`);
  }

  return {
    first: {
      id: firstContact.id,
      name: firstContact.name,
      rows: firstAfterReload.chatRows,
    },
    second: {
      id: secondContact.id,
      name: secondContact.name,
      rows: secondAfterReload.chatRows,
      default_text: defaultText,
    },
  };
}

function parsePageLabel(label) {
  const match = /第\s*(\d+)\s*\/\s*(\d+)\s*页/.exec(String(label || "").trim());
  return match ? { current: Number(match[1]), total: Number(match[2]) } : null;
}

async function readGroupMemberPage(page) {
  return page.evaluate(() => ({
    hidden: document.querySelector("#groupMemberPagination")?.classList.contains("hidden") ?? true,
    label: document.querySelector("#groupPageLabel")?.textContent.trim() || "",
    prevDisabled: document.querySelector("#groupPrevPage")?.disabled ?? true,
    nextDisabled: document.querySelector("#groupNextPage")?.disabled ?? true,
    selectedCount: document.querySelector("#groupSelectedCount")?.textContent.trim() || "",
    ids: [...document.querySelectorAll("#groupMemberList [data-group-member-id]")].map((node) =>
      node.getAttribute("data-group-member-id"),
    ),
  }));
}

async function verifyGroupMemberPagination(page, issues, firstPageMeta) {
  const firstPage = await readGroupMemberPage(page);
  const firstLabel = parsePageLabel(firstPage.label);
  if (firstPage.hidden || !firstLabel || firstLabel.total < 2) {
    return {
      mode: "single_page",
      label: firstPage.label,
      page_size: firstPage.ids.length,
    };
  }

  const firstPageIds = new Set(firstPage.ids.map(String));
  for (const member of firstPageMeta) {
    if (!firstPageIds.has(String(member.id))) {
      issues.push(`Group member pagination first page is missing expected member ${member.name}.`);
      break;
    }
  }
  if (firstPage.prevDisabled !== true) {
    issues.push(`Group member pagination first page should disable previous, got ${JSON.stringify(firstPage)}.`);
  }
  if (firstPage.ids.length !== 8) {
    issues.push(`Group member pagination first page should render 8 members, got ${firstPage.ids.length}.`);
  }

  await page.click("#groupNextPage");
  await page.waitForFunction(
    (expected) => document.querySelector("#groupPageLabel")?.textContent.trim().startsWith(`第 ${expected} /`),
    firstLabel.current + 1,
  );
  const secondPage = await readGroupMemberPage(page);
  const secondLabel = parsePageLabel(secondPage.label);
  if (!secondLabel || secondLabel.current !== 2) {
    issues.push(`Group member pagination did not move to page 2: ${JSON.stringify(secondPage)}.`);
  }
  if (secondPage.prevDisabled !== false) {
    issues.push(`Group member pagination second page should enable previous, got ${JSON.stringify(secondPage)}.`);
  }
  if (secondPage.ids.length !== 8) {
    issues.push(`Group member pagination second page should render 8 members, got ${secondPage.ids.length}.`);
  }
  if (secondPage.ids.some((id) => firstPageIds.has(String(id)))) {
    issues.push(`Group member pagination page 2 repeated first-page members: ${JSON.stringify(secondPage.ids)}.`);
  }
  if (!secondPage.ids.length) {
    issues.push("Group member pagination page 2 has no selectable members.");
    return {
      mode: "paged",
      first_label: firstPage.label,
      second_label: secondPage.label,
      page_size: firstPage.ids.length,
    };
  }

  const pageTwoMemberId = secondPage.ids[0];
  await page.locator(`#groupMemberList [data-group-member-id="${pageTwoMemberId}"]`).click();
  await page.waitForFunction(() => document.querySelector("#groupSelectedCount")?.textContent.trim() === "1 人");
  await page.click("#groupPrevPage");
  await page.waitForFunction(() => document.querySelector("#groupPageLabel")?.textContent.trim().startsWith("第 1 /"));
  const selectionAfterBack = await readGroupMemberPage(page);
  if (selectionAfterBack.selectedCount !== "1 人") {
    issues.push(`Group member selection was lost after paging back: ${JSON.stringify(selectionAfterBack)}.`);
  }
  await page.click("#groupNextPage");
  await page.waitForFunction(
    (memberId) =>
      document
        .querySelector(`#groupMemberList [data-group-member-id="${memberId}"]`)
        ?.getAttribute("aria-pressed") === "true",
    pageTwoMemberId,
  );
  await page.locator(`#groupMemberList [data-group-member-id="${pageTwoMemberId}"]`).click();
  await page.waitForFunction(() => document.querySelector("#groupSelectedCount")?.textContent.trim() === "0 人");

  await page.fill("#groupMemberSearch", "__no_matching_group_member__");
  await page.waitForFunction(() => document.querySelector("#groupPageLabel")?.textContent.trim().startsWith("第 1 /"));
  const searchResetLabel = await page.locator("#groupPageLabel").textContent();
  await page.fill("#groupMemberSearch", "");
  await page.waitForFunction(() => document.querySelectorAll("#groupMemberList [data-group-member-id]").length > 0);
  await page.waitForFunction(() => document.querySelector("#groupPageLabel")?.textContent.trim().startsWith("第 1 /"));

  return {
    mode: "paged",
    first_label: firstPage.label,
    second_label: secondPage.label,
    search_reset_label: (searchResetLabel || "").trim(),
    page_size: firstPage.ids.length,
  };
}

async function verifyGroupModal(page, issues, contacts) {
  const heroes = contacts.filter((contact) => contact.kind !== "group");
  if (heroes.length < 5) {
    issues.push(`Expected at least five hero contacts for the group modal check, got ${heroes.length}.`);
    return null;
  }

  stage("group modal");
  const gameNewGroupEntryCount = await page.locator('#contactList [data-action="new-group"]').count();
  if (gameNewGroupEntryCount !== 1) {
    issues.push(`Expected one in-game new-group entry, got ${gameNewGroupEntryCount}.`);
  }
  await page.click('#contactList [data-action="new-group"]');
  await page.waitForSelector("#groupModal:not(.hidden)");
  await page.waitForSelector("#groupMemberList [data-group-member-id]");
  const groupName = `界面联调群${Date.now()}`;
  await page.fill("#groupNameInput", groupName);

  const memberMeta = [];
  for (let index = 0; index < 5; index += 1) {
    const card = page.locator("#groupMemberList [data-group-member-id]").nth(index);
    memberMeta.push({
      id: await card.getAttribute("data-group-member-id"),
      name: ((await card.locator(".group-member-name").textContent()) || "").trim(),
    });
  }
  const pagination = await verifyGroupMemberPagination(page, issues, memberMeta);

  await page.locator(`#groupMemberList [data-group-member-id="${memberMeta[0].id}"]`).click();
  const oneMemberLayout = await readGroupPreviewLayout(page);
  if (oneMemberLayout.layout !== "single") {
    issues.push(`One-member group preview should use the single layout, got ${JSON.stringify(oneMemberLayout)}.`);
  }
  await page.click("#createGroupButton");
  await page.waitForFunction(
    () => document.querySelector("#groupModalStatus")?.textContent.trim() === "至少选择两名成员",
  );

  await page.locator(`#groupMemberList [data-group-member-id="${memberMeta[1].id}"]`).click();
  assertGroupTiles(
    await readGroupPreviewLayout(page),
    [
      { left: 8, top: 29.8, width: 40.4, height: 40.4 },
      { left: 51.6, top: 29.8, width: 40.4, height: 40.4 },
    ],
    "two-member group preview",
    issues,
  );

  await page.locator(`#groupMemberList [data-group-member-id="${memberMeta[2].id}"]`).click();
  assertGroupTiles(
    await readGroupPreviewLayout(page),
    [
      { left: 8, top: 8, width: 40.4, height: 40.4 },
      { left: 8, top: 51.6, width: 40.4, height: 40.4 },
      { left: 51.6, top: 29.8, width: 40.4, height: 40.4 },
    ],
    "three-member group preview",
    issues,
  );

  await page.locator(`#groupMemberList [data-group-member-id="${memberMeta[3].id}"]`).click();
  assertGroupTiles(
    await readGroupPreviewLayout(page),
    [
      { left: 8, top: 8, width: 40.4, height: 40.4 },
      { left: 51.6, top: 8, width: 40.4, height: 40.4 },
      { left: 8, top: 51.6, width: 40.4, height: 40.4 },
      { left: 51.6, top: 51.6, width: 40.4, height: 40.4 },
    ],
    "four-member group preview",
    issues,
  );

  await page.locator(`#groupMemberList [data-group-member-id="${memberMeta[4].id}"]`).click();
  // 游戏内置群头像最多展示 4 名成员，第 5 名成员不改变 4 格拼图。
  assertGroupTiles(
    await readGroupPreviewLayout(page),
    [
      { left: 8, top: 8, width: 40.4, height: 40.4 },
      { left: 51.6, top: 8, width: 40.4, height: 40.4 },
      { left: 8, top: 51.6, width: 40.4, height: 40.4 },
      { left: 51.6, top: 51.6, width: 40.4, height: 40.4 },
    ],
    "five-member group preview",
    issues,
  );

  await page.fill("#groupNameInput", groupName);
  await page.locator(`#groupMemberList [data-group-member-id="${memberMeta[4].id}"]`).click();
  await page.locator(`#groupMemberList [data-group-member-id="${memberMeta[3].id}"]`).click();
  assertGroupTiles(
    await readGroupPreviewLayout(page),
    [
      { left: 8, top: 8, width: 40.4, height: 40.4 },
      { left: 8, top: 51.6, width: 40.4, height: 40.4 },
      { left: 51.6, top: 29.8, width: 40.4, height: 40.4 },
    ],
    "three-member final group preview",
    issues,
  );

  if (!ALLOW_GROUP_MUTATION) {
    await page.click("#cancelGroupButton");
    await page.waitForSelector("#groupModal", { state: "hidden" });
    return {
      mode: "validation_only",
      one_member_layout: oneMemberLayout.layout,
      two_member_layout: "tiles",
      three_member_layout: "tiles",
      four_member_layout: "tiles",
      pagination,
    };
  }

  stage("create group through UI");
  await page.click("#createGroupButton");
  await page.waitForSelector("#groupModal", { state: "hidden" });
  await page.waitForFunction(
    (name) =>
      [...document.querySelectorAll("#contactList [data-contact-id]")].some(
        (node) => node.querySelector(".side-entry-text strong")?.textContent.trim() === name,
      ),
    groupName,
  );
  await page.waitForFunction(
    (count) => document.querySelectorAll("#speakerPicker option").length === count,
    memberMeta.slice(0, 3).length + 1,
  );

  const created = await page.evaluate((name) => {
    const row = [...document.querySelectorAll("#contactList [data-contact-id]")].find(
      (node) => node.querySelector(".side-entry-text strong")?.textContent.trim() === name,
    );
    const mosaic = row?.querySelector(".side-entry-avatar .group-avatar-mosaic");
    return {
      id: row?.getAttribute("data-contact-id") || "",
      active: row?.classList.contains("active") || false,
      contactName: document.querySelector("#previewContactName")?.textContent.trim() || "",
      speakerNames: [...document.querySelectorAll("#speakerPicker option")].map((option) =>
        option.textContent.trim(),
      ),
      avatarLayout: mosaic?.getAttribute("data-layout") || "",
      avatarCount: Number(mosaic?.getAttribute("data-count") || 0),
    };
  }, groupName);
  if (!created.id || Number(created.id) < 9200) {
    issues.push(`Created group did not appear with a custom id: ${JSON.stringify(created)}.`);
  }
  if (!created.active || created.contactName !== groupName) {
    issues.push(`Created group was not selected after creation: ${JSON.stringify(created)}.`);
  }
  if (created.speakerNames.length !== 4 || created.speakerNames[0] !== "管理员") {
    issues.push(`Created group speaker picker should contain 管理员 plus three members: ${JSON.stringify(created)}.`);
  }
  for (const member of memberMeta.slice(0, 3)) {
    if (!created.speakerNames.includes(member.name)) {
      issues.push(`Created group speaker picker is missing ${member.name}: ${JSON.stringify(created.speakerNames)}.`);
    }
  }
  if (created.avatarLayout !== "tiles" || created.avatarCount !== 3) {
    issues.push(`Created group contact avatar did not use the three-member mosaic: ${JSON.stringify(created)}.`);
  }

  return {
    mode: "created",
    id: created.id,
    name: groupName,
    speaker_names: created.speakerNames,
    avatar_layout: created.avatarLayout,
    avatar_count: created.avatarCount,
    pagination,
  };
}

async function verifyGroupExportMosaic(page, issues) {
  const result = await page.evaluate(async () => {
    const imageFromColor = (color) =>
      new Promise((resolve, reject) => {
        const source = document.createElement("canvas");
        source.width = 16;
        source.height = 16;
        const context = source.getContext("2d");
        context.fillStyle = color;
        context.fillRect(0, 0, source.width, source.height);
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Failed to build ${color} tile`));
        image.src = source.toDataURL("image/png");
      });
    const [red, green, blue] = await Promise.all([
      imageFromColor("#ff0000"),
      imageFromColor("#00ff00"),
      imageFromColor("#0000ff"),
    ]);
    const canvas = document.createElement("canvas");
    canvas.width = 108;
    canvas.height = 108;
    const context = canvas.getContext("2d");
    window.drawExportAvatarContent(context, 0, 0, 108, {
      type: "tiles",
      tiles: [
        { x: 0, y: 0, width: 0.5, height: 0.5, image: red },
        { x: 0, y: 0.5, width: 0.5, height: 0.5, image: green },
        { x: 0.5, y: 0, width: 0.5, height: 0.5, image: blue },
      ],
    });
    const sample = (x, y) => [...context.getImageData(x, y, 1, 1).data];
    return {
      outside: sample(1, 1),
      topLeft: sample(32, 32),
      bottomLeft: sample(32, 76),
      right: sample(76, 30),
    };
  });
  const expected = {
    topLeft: [255, 0, 0, 255],
    bottomLeft: [0, 255, 0, 255],
    right: [0, 0, 255, 255],
  };
  if (result.outside[3] !== 0) {
    issues.push(`Export group avatar leaked outside the crop hole: ${JSON.stringify(result)}.`);
  }
  for (const [key, color] of Object.entries(expected)) {
    const actual = result[key];
    if (!actual || color.some((channel, index) => Math.abs(actual[index] - channel) > 2)) {
      issues.push(`Export group avatar ${key} tile is incorrect: ${JSON.stringify(result)}.`);
    }
  }
  return {
    outside_alpha: result.outside[3],
    top_left: result.topLeft,
    bottom_left: result.bottomLeft,
    right: result.right,
  };
}

// 验证气泡主题、名称和官方九宫格切片。
async function verifyBubbleThemes(page, issues) {
  stage("bubble themes");
  const fonts = await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('400 29px "MomoTalk Sans"'),
      document.fonts.load('700 24px "MomoTalk Serif"'),
    ]);
    return {
      sans: document.fonts.check('400 29px "MomoTalk Sans"'),
      serif: document.fonts.check('700 24px "MomoTalk Serif"'),
    };
  });
  if (!fonts.sans || !fonts.serif) {
    issues.push(`Game fonts failed to load: ${JSON.stringify(fonts)}.`);
  }
  await page.click("#bubblePickerButton");
  await page.waitForSelector("#assetModal:not(.hidden)");
  await page.waitForSelector("#assetGrid [data-bubble-theme-id]");
  const cards = await page.locator("#assetGrid [data-bubble-theme-id]").evaluateAll((nodes) =>
    nodes.map((node) => ({
      id: node.getAttribute("data-bubble-theme-id") || "",
      disabled: node.disabled,
    })),
  );
  const ids = cards.map((card) => card.id);
  const sliceAudit = await page.evaluate(async () => {
    const payload = await fetch("/api/bubble-themes").then((response) => response.json());
    const themes = Array.isArray(payload.themes) ? payload.themes : [];
    const imagePathForUrl = (url) => {
      const path = String(url || "").split("?")[0];
      const marker = "/assets/";
      const index = path.indexOf(marker);
      return index >= 0 ? path.slice(index + marker.length) : "";
    };
    const loadImage = (url) => new Promise((resolve) => {
      if (!url) {
        resolve(null);
        return;
      }
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = url;
    });
    const centerSize = (slice, width, height) => ({
      width: width - Number(slice.left) - Number(slice.right),
      height: height - Number(slice.top) - Number(slice.bottom),
    });
    const clampAxis = (first, second, limit) => {
      let start = Number(first);
      let end = Number(second);
      while (start + end >= limit && start + end > 2) {
        if (start >= end && start > 1) {
          start -= 1;
        } else if (end > 1) {
          end -= 1;
        } else {
          break;
        }
      }
      return [start, end];
    };
    const invalid = [];
    const zeroCenter = [];
    const squareInvalid = [];
    const checked = [];
    const squareMismatch = [];
    for (const theme of themes) {
      const id = String(theme.id);
      for (const side of ["left", "right"]) {
        const variant = theme.variants?.[side] || null;
        const variantSlice = variant?.slice || null;
        if (
          !variantSlice
          || ["top", "right", "bottom", "left"].some((key) => Number(variantSlice[key]) <= 0)
        ) {
          invalid.push(`${id}:${side}`);
        } else {
          const image = await loadImage(variant.url);
          if (image && image.naturalWidth > 0 && image.naturalHeight > 0) {
            const center = centerSize(variantSlice, image.naturalWidth, image.naturalHeight);
            if (center.width < 1 || center.height < 1) {
              zeroCenter.push(`${id}:${side}:${center.width}x${center.height}`);
            }
            checked.push(`${id}:${side}:variant:${image.naturalWidth}x${image.naturalHeight}`);
          }
        }
        const expectedUrl = `/assets/bubbles/square_${id}_${side}.png`;
        const actualUrl = String(theme[`square_${side}`] || "");
        const slice = theme[`square_slice_${side}`];
        if (actualUrl !== expectedUrl) {
          squareMismatch.push(`${id}:${side}:${actualUrl || "<missing>"}`);
        }
        if (
          !slice
          || ["top", "right", "bottom", "left"].some((key) => Number(slice[key]) <= 0)
        ) {
          squareInvalid.push(`${id}:${side}`);
          continue;
        }
        const squareImage = await loadImage(actualUrl);
        if (!squareImage || squareImage.naturalWidth <= 0 || squareImage.naturalHeight <= 0) {
          squareInvalid.push(`${id}:${side}:<image>`);
          continue;
        }
        const width = squareImage.naturalWidth;
        const height = squareImage.naturalHeight;
        const [left, right] = clampAxis(slice.left, slice.right, width);
        const [top, bottom] = clampAxis(slice.top, slice.bottom, height);
        if (width - left - right < 1 || height - top - bottom < 1) {
          squareInvalid.push(`${id}:${side}:center`);
        }
        checked.push(`${id}:${side}:square:${width}x${height}`);
      }
    }
    const legacy = themes.find((theme) => String(theme.id) === "9016");
    return {
      count: themes.length,
      invalid,
      zeroCenter,
      squareMismatch,
      squareInvalid,
      checked,
      legacyLeft: legacy?.variants?.left?.slice || null,
      legacyRight: legacy?.variants?.right?.slice || null,
      names: Object.fromEntries(
        themes.map((theme) => [String(theme.id), theme.name || String(theme.id)]),
      ),
    };
  });
  if (sliceAudit.count !== 17) issues.push(`Expected 17 bubble slice records, got ${sliceAudit.count}.`);
  if (sliceAudit.invalid.length) issues.push(`Bubble themes with invalid slices: ${sliceAudit.invalid.join(", ")}.`);
  if (sliceAudit.zeroCenter.length) {
    issues.push(`Bubble theme slices collapse the nine-slice center: ${sliceAudit.zeroCenter.join(", ")}.`);
  }
  if (sliceAudit.squareMismatch.length) {
    issues.push(`Bubble themes with missing or unexpected square assets: ${sliceAudit.squareMismatch.join(", ")}.`);
  }
  if (sliceAudit.squareInvalid.length) {
    issues.push(`Bubble themes with invalid square slices: ${sliceAudit.squareInvalid.join(", ")}.`);
  }
  if (sliceAudit.checked.length !== sliceAudit.count * 4) {
    issues.push(`Expected ${sliceAudit.count * 4} measured bubble slice images, got ${sliceAudit.checked.length}.`);
  }
  if (JSON.stringify(sliceAudit.legacyLeft) === JSON.stringify(sliceAudit.legacyRight)) {
    issues.push("Bubble theme 9016 must use different left and right Sprite.m_Border slices.");
  }
  const expectedBubbleNames = {
    9000: "默认白",
    9001: "默认黑",
    9002: "岁序更新",
    9003: "愿祈佳语",
    9004: "稳定与唯一",
    9005: "9005",
    9007: "9007",
    9008: "海滨邹鲁",
    9010: "喷香美味吐司",
    9011: "雾中语",
    9013: "真心洞察",
    9014: "掌上星",
    9015: "紊中有序",
    9016: "她与我的花季",
    9017: "解心语",
    9018: "拼凑的字符",
    9020: "亲亲时刻",
  };
  for (const [id, expectedName] of Object.entries(expectedBubbleNames)) {
    if (sliceAudit.names[id] !== expectedName) {
      issues.push(`Bubble ${id} name mismatch: expected ${expectedName}, got ${sliceAudit.names[id]}.`);
    }
  }
  await page.click("#closeAssetModal");
  await page.waitForSelector("#assetModal", { state: "hidden" });
  await page.evaluate(() => {
    if (typeof applyBubbleTheme !== "function") {
      throw new Error("applyBubbleTheme is not available");
    }
    applyBubbleTheme("9016");
  });
  await page.waitForTimeout(150);
  const renderedSlice = await page.evaluate(() => {
    const row = document.createElement("div");
    row.className = "chat-row right admin-message text-row";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    const text = document.createElement("span");
    text.className = "bubble-text";
    text.textContent = "切片检查";
    bubble.append(text);
    row.append(bubble);
    document.body.append(row);
    const style = getComputedStyle(bubble, "::before");
    const result = {
      slice: style.borderImageSlice,
      source: style.borderImageSource,
    };
    row.remove();
    return result;
  });
  if (!renderedSlice) {
    issues.push("Could not create a bubble style probe.");
  } else {
    if (!renderedSlice.slice.startsWith("56 41 29 47")) {
      issues.push(`Right bubble did not use the official 9016 slice: ${renderedSlice.slice}.`);
    }
    if (!renderedSlice.source.includes("widgets_widget_system_chat_9016_1")) {
      issues.push(`Right bubble did not use the full 9016 texture: ${renderedSlice.source}.`);
    }
  }
  const required = ["9016", "9017"];
  const excludedDynamic = ["9019", "9021", "9022"];
  const missing = required.filter((id) => !ids.includes(id));
  const unexpectedDynamic = excludedDynamic.filter((id) => ids.includes(id));
  const disabledStatic = cards.filter((card) => required.includes(card.id) && card.disabled).map((card) => card.id);
  if (ids.length < 17) issues.push(`Expected at least 17 bubble themes, got ${ids.length}.`);
  if (missing.length) issues.push(`Single-image legacy bubble themes missing from picker: ${missing.join(", ")}.`);
  if (unexpectedDynamic.length) issues.push(`Dynamic component bubble themes must stay out of the picker: ${unexpectedDynamic.join(", ")}.`);
  if (disabledStatic.length) issues.push(`Static-only legacy bubble themes must be selectable: ${disabledStatic.join(", ")}.`);
  return { count: ids.length, integrated: required, missing, excludedDynamic, unexpectedDynamic, disabledStatic, fonts, sliceAudit, renderedSlice };
}

// 验证连续消息的首条尾部和导出一致性。
async function verifyContinuousBubbleTails(page, issues) {
  const result = await page.evaluate(async () => {
    await waitForBubbleSquareAssets();
    const squareThemeIds = [
      "9003",
      "9002",
      "9004",
      "9007",
      "9008",
      "9013",
      "9014",
      "9015",
      "9016",
      "9017",
      "9018",
      "9020",
    ];
    const squareThemeAudit = [];
    for (const id of squareThemeIds) {
      applyBubbleTheme(id);
      await waitForBubbleSquareAssets();
      const rootStyle = getComputedStyle(document.documentElement);
      squareThemeAudit.push({
        id,
        left: EXPORT_ASSET_URLS.selectedSquareBubbleLeft,
        right: EXPORT_ASSET_URLS.selectedSquareBubbleRight,
        leftSlice: BUBBLE_SELECTED_SQUARE_NINE_SLICE_LEFT,
        rightSlice: BUBBLE_SELECTED_SQUARE_NINE_SLICE_RIGHT,
        leftCss: rootStyle.getPropertyValue("--momotalk-selected-bubble-square-left").trim(),
        rightCss: rootStyle.getPropertyValue("--momotalk-selected-bubble-square-right").trim(),
      });
    }
    applyBubbleTheme("9016");
    await waitForBubbleSquareAssets();
    const messages = [
      { id: "a", type: "text", side: "right", text: "第一条", speaker_id: "__admin__" },
      { id: "b", type: "text", side: "right", text: "第二条", speaker_id: "__admin__" },
      { id: "c", type: "text", side: "right", text: "第三条", speaker_id: "__admin__" },
      { id: "d", type: "text", side: "left", text: "换边", speaker_id: 1 },
      { id: "e", type: "system", side: "center", text: "系统打断" },
      { id: "f", type: "text", side: "right", text: "系统后首条", speaker_id: "__admin__" },
      { id: "g", type: "text", side: "right", text: "系统后连续", speaker_id: "__admin__" },
      { id: "h", type: "sticker", side: "right", speaker_id: "__admin__", asset_id: "x" },
      { id: "i", type: "text", side: "right", text: "贴纸后首条", speaker_id: "__admin__" },
    ];
    const grouped = groupContinuousBubbles(messages, { contact: { id: 1, name: "测试" } });
    const html = grouped
      .map(({ message, showTail, bubbleVariant }) => messagePreviewHtml(message, { showTail, bubbleVariant }))
      .join("");
    const host = document.createElement("div");
    host.style.position = "absolute";
    host.style.visibility = "hidden";
    host.style.pointerEvents = "none";
    host.innerHTML = html;
    document.body.appendChild(host);
    const tailClasses = [...host.querySelectorAll(".chat-row.text-row")].map((row) => ({
      id: row.textContent.trim(),
      square: row.classList.contains("bubble-square"),
      tail: row.classList.contains("bubble-tail"),
      clip: getComputedStyle(row.querySelector(".bubble"), "::before").clipPath || "none",
      source: getComputedStyle(row.querySelector(".bubble"), "::before").borderImageSource || "",
    }));
    host.remove();
    const layout = buildChatExportLayout(
      document.createElement("canvas").getContext("2d"),
      { contact: { id: 1, name: "测试" }, messages },
      messages,
    );
    return {
      grouped: grouped.map(({ message, bubbleVariant }) => [message.id, bubbleVariant]),
      tailClasses,
      exportTails: layout.items
        .filter((item) => item.type === "text")
        .map((item) => item.bubbleVariant),
      squareThemeAudit,
      squareAssets: {
        left: EXPORT_ASSET_URLS.squareBubbleLeft,
        right: EXPORT_ASSET_URLS.squareBubbleRight,
        selectedLeft: EXPORT_ASSET_URLS.selectedSquareBubbleLeft,
        selectedRight: EXPORT_ASSET_URLS.selectedSquareBubbleRight,
      },
    };
  });

  const expected = [
    ["a", "tailed"],
    ["b", "square"],
    ["c", "square"],
    ["d", "tailed"],
    ["e", "tailed"],
    ["f", "tailed"],
    ["g", "square"],
    ["h", "tailed"],
    ["i", "tailed"],
  ];
  if (JSON.stringify(result.grouped) !== JSON.stringify(expected)) {
    issues.push(`Continuous bubble grouping is incorrect: ${JSON.stringify(result.grouped)}.`);
  }
  const textExpected = expected.filter(([id]) => !["e", "h"].includes(id));
  if (result.tailClasses.some((row, index) => (
    row.tail !== (textExpected[index]?.[1] === "tailed")
    || row.square !== (textExpected[index]?.[1] === "square")
  ))) {
    issues.push(`Continuous bubble preview classes are incorrect: ${JSON.stringify(result.tailClasses)}.`);
  }
  if (result.tailClasses.some((row) => row.clip !== "none")) {
    issues.push(`Continuous bubble variants must not clip the shared bubble frame: ${JSON.stringify(result.tailClasses)}.`);
  }
  const squareRows = result.tailClasses.filter((row) => row.square);
  if (!squareRows.length) {
    issues.push(`Continuous bubble check did not produce any square rows: ${JSON.stringify(result.tailClasses)}.`);
  }
  if (squareRows.some((row) => row.source.includes("data:image/png"))) {
    issues.push(`Continuous square bubbles still use a runtime data URL: ${JSON.stringify(squareRows)}.`);
  }
  if (squareRows.some((row) => !row.source.includes("/assets/bubbles/square_9016_right.png"))) {
    issues.push(`Continuous square bubbles did not use the explicit 9016 square asset: ${JSON.stringify(squareRows)}.`);
  }
  const expectedExportVariants = ["tailed", "square", "square", "tailed", "tailed", "square", "tailed"];
  if (JSON.stringify(result.exportTails) !== JSON.stringify(expectedExportVariants)) {
    issues.push(`PNG export did not reuse the continuous bubble grouping: ${JSON.stringify(result.exportTails)}.`);
  }
  const expectedDefaultSquare = {
    left: "/assets/bubbles/square_9000_left.png",
    right: "/assets/bubbles/square_9000_right.png",
  };
  if (result.squareAssets.left !== expectedDefaultSquare.left || result.squareAssets.right !== expectedDefaultSquare.right) {
    issues.push(`Default square bubble assets are incorrect: ${JSON.stringify(result.squareAssets)}.`);
  }
  if (
    result.squareAssets.selectedLeft !== "/assets/bubbles/square_9016_left.png"
    || result.squareAssets.selectedRight !== "/assets/bubbles/square_9016_right.png"
  ) {
    issues.push(`Selected square bubble assets are incorrect: ${JSON.stringify(result.squareAssets)}.`);
  }
  if (Object.values(result.squareAssets).some((url) => String(url).startsWith("data:image/png"))) {
    issues.push(`Square bubble assets must use explicit files, not runtime data URLs: ${JSON.stringify(result.squareAssets)}.`);
  }
  if (result.squareThemeAudit.length !== 12) {
    issues.push(`Expected 12 square theme audit records, got ${result.squareThemeAudit.length}.`);
  }
  for (const entry of result.squareThemeAudit) {
    const expectedLeft = `/assets/bubbles/square_${entry.id}_left.png`;
    const expectedRight = `/assets/bubbles/square_${entry.id}_right.png`;
    if (entry.left !== expectedLeft || entry.right !== expectedRight) {
      issues.push(`Square asset URLs were not updated for theme ${entry.id}: ${JSON.stringify(entry)}.`);
    }
    if (!entry.leftCss.includes(expectedLeft) || !entry.rightCss.includes(expectedRight)) {
      issues.push(`Square CSS variables were not updated for theme ${entry.id}: ${JSON.stringify(entry)}.`);
    }
    for (const slice of [entry.leftSlice, entry.rightSlice]) {
      if (
        !slice
        || ["top", "right", "bottom", "left"].some((key) => Number(slice[key]) <= 0)
      ) {
        issues.push(`Square slice is invalid for theme ${entry.id}: ${JSON.stringify(entry)}.`);
      }
    }
  }
  return result;
}

// 读取右侧编辑面板页签与联系人列表的当前状态。
async function readEditorContactState(page) {
  return page.evaluate(() => ({
    activeTab:
      document.querySelector('#editorTabs [data-editor-tab][aria-selected="true"]')?.dataset.editorTab || "",
    tabLabels: [...document.querySelectorAll("#editorTabs [data-editor-tab]")].map((node) =>
      node.textContent.trim(),
    ),
    editHidden: document.querySelector("#editorPanelEdit")?.classList.contains("hidden") ?? null,
    contactsHidden: document.querySelector("#editorPanelContacts")?.classList.contains("hidden") ?? null,
    cards: [...document.querySelectorAll("#editorContactList [data-editor-contact-id]")].map((node) => ({
      id: node.getAttribute("data-editor-contact-id"),
      name: node.querySelector(".editor-contact-name")?.textContent.trim() || "",
      badge: node.querySelector(".editor-contact-badge")?.textContent.trim() || "",
      tone: node.querySelector(".editor-contact-badge")?.dataset.tone || "",
      className: node.className,
    })),
    filters: [...document.querySelectorAll("#editorContactFilters [data-contact-category]")].map(
      (node) => ({
        id: node.dataset.contactCategory,
        label: node.querySelector(".editor-contact-filter-label")?.textContent.trim() || "",
        count: node.querySelector("[data-contact-count]")?.textContent.trim() || "",
        pressed: node.getAttribute("aria-pressed") === "true",
      }),
    ),
    emptyText: document.querySelector("#editorContactList .empty-state")?.textContent.trim() || "",
    pageLabel: document.querySelector("#editorContactPageLabel")?.textContent.trim() || "",
    paginationHidden:
      document.querySelector("#editorContactPagination")?.classList.contains("hidden") ?? null,
    prevDisabled: document.querySelector("#editorContactPrevPage")?.disabled ?? null,
    nextDisabled: document.querySelector("#editorContactNextPage")?.disabled ?? null,
    previewName: document.querySelector("#previewContactName")?.textContent.trim() || "",
    messageRows: document.querySelectorAll("#messageList .message-list-item").length,
    titleValue: document.querySelector("#projectTitleInput")?.value ?? null,
  }));
}

function parseEditorContactPage(label) {
  const match = /第\s*(\d+)\s*\/\s*(\d+)\s*页/.exec(label || "");
  return match ? { page: Number(match[1]), pageCount: Number(match[2]) } : null;
}

// 验证联系人列表页签：页签切换、分页、搜索、无选中态与编辑页签隔离。
async function verifyEditorContactTab(page, issues, expectedContactCount) {
  stage("editor contact tab");
  const result = {
    tab_labels: [],
    page_size: 0,
    page_count: 0,
    resized_page_size: 0,
    filtered_card_count: 0,
    shadow_classes: [],
  };

  const baseline = await readEditorContactState(page);
  result.tab_labels = baseline.tabLabels;
  if (baseline.activeTab !== "edit") {
    issues.push(`Expected "edit" as the default editor tab, got "${baseline.activeTab}".`);
  }
  if (JSON.stringify(baseline.tabLabels) !== JSON.stringify(["编辑", "联系人列表"])) {
    issues.push(`Editor tab labels were wrong: ${JSON.stringify(baseline.tabLabels)}.`);
  }
  if (baseline.editHidden !== false || baseline.contactsHidden !== true) {
    issues.push(`Default tab panels were wrong: ${JSON.stringify(baseline)}.`);
  }

  await page.click('#editorTabs [data-editor-tab="contacts"]');
  await page.waitForSelector("#editorPanelContacts:not(.hidden)");
  await page.waitForSelector("#editorContactList [data-editor-contact-id]");
  const switched = await readEditorContactState(page);
  if (switched.activeTab !== "contacts" || switched.editHidden !== true || switched.contactsHidden !== false) {
    issues.push(`Editor tab switch did not toggle panels: ${JSON.stringify(switched)}.`);
  }
  const firstPageSize = switched.cards.length;
  const pagination = parseEditorContactPage(switched.pageLabel);
  if (!firstPageSize) {
    issues.push("Contact list tab rendered no contact cards.");
  }
  if (firstPageSize > expectedContactCount) {
    issues.push(`Contact list tab rendered more cards (${firstPageSize}) than contacts (${expectedContactCount}).`);
  }
  if (!pagination || pagination.page !== 1) {
    issues.push(`Unexpected contact list page label: "${switched.pageLabel}".`);
  } else if (pagination.pageCount !== Math.max(1, Math.ceil(expectedContactCount / firstPageSize))) {
    issues.push(
      `Contact list page count was wrong: ${JSON.stringify(pagination)} for ${expectedContactCount} contacts.`,
    );
  }
  if (switched.prevDisabled !== true) {
    issues.push("Contact list previous-page button should be disabled on the first page.");
  }
  if (pagination && pagination.pageCount === 1 && switched.nextDisabled !== true) {
    issues.push("Contact list next-page button should be disabled on a single page.");
  }

  result.page_size = firstPageSize;
  result.page_count = pagination?.pageCount || 0;
  for (const card of switched.cards) {
    const classes = card.className.split(/\s+/).filter(Boolean);
    if (classes.some((name) => name !== "editor-contact-card")) {
      result.shadow_classes.push(card.className);
    }
  }
  if (result.shadow_classes.length) {
    issues.push(`Contact cards must not carry selection styling: ${JSON.stringify(result.shadow_classes)}.`);
  }

  // 分类筛选条：默认「全部」，四档标签与计数，切换后只渲染对应类别。
  result.filter_labels = switched.filters.map((filter) => filter.label);
  if (JSON.stringify(result.filter_labels) !== JSON.stringify(["全部", "角色", "群组", "自建群"])) {
    issues.push(`Editor contact filters were wrong: ${JSON.stringify(switched.filters)}.`);
  }
  const pressedFilters = switched.filters.filter((filter) => filter.pressed);
  if (pressedFilters.length !== 1 || pressedFilters[0].id !== "all") {
    issues.push(`Default contact filter should be "all": ${JSON.stringify(switched.filters)}.`);
  }
  if (Number(switched.filters.find((filter) => filter.id === "all")?.count) !== expectedContactCount) {
    issues.push(
      `Filter "all" count was wrong: ${JSON.stringify(switched.filters)} for ${expectedContactCount} contacts.`,
    );
  }
  const categoryExpectations = [
    { id: "hero", badges: ["角色"] },
    { id: "group", badges: ["内置群", "自建群"] },
    { id: "custom_group", badges: ["自建群"] },
  ];
  for (const expectation of categoryExpectations) {
    await page.click(`#editorContactFilters [data-contact-category="${expectation.id}"]`);
    await page.waitForFunction(
      (id) =>
        document
          .querySelector(`#editorContactFilters [data-contact-category="${id}"]`)
          ?.getAttribute("aria-pressed") === "true",
      expectation.id,
    );
    const filteredState = await readEditorContactState(page);
    const expectedFilteredCount = Number(
      filteredState.filters.find((filter) => filter.id === expectation.id)?.count ?? 0,
    );
    // 隔离环境可能没有自建群；有计数时才要求渲染出卡片。
    if (expectedFilteredCount > 0 && !filteredState.cards.length) {
      issues.push(
        `Contact filter "${expectation.id}" rendered no cards despite count ${expectedFilteredCount}.`,
      );
    }
    if (expectedFilteredCount === 0 && filteredState.cards.length) {
      issues.push(`Contact filter "${expectation.id}" rendered cards despite count 0.`);
    }
    if (filteredState.cards.some((card) => !expectation.badges.includes(card.badge))) {
      issues.push(
        `Contact filter "${expectation.id}" rendered unexpected cards: ${JSON.stringify(filteredState.cards)}.`,
      );
    }
    if (
      filteredState.cards.length > Number(
        filteredState.filters.find((filter) => filter.id === expectation.id)?.count,
      )
    ) {
      issues.push(`Contact filter "${expectation.id}" rendered more cards than its count.`);
    }
    if (parseEditorContactPage(filteredState.pageLabel)?.page !== 1) {
      issues.push(`Contact filter "${expectation.id}" did not reset pagination to page 1.`);
    }
  }
  await page.click('#editorContactFilters [data-contact-category="all"]');
  await page.waitForFunction(
    (size) => document.querySelectorAll("#editorContactList [data-editor-contact-id]").length === size,
    firstPageSize,
  );

  // 阶段 A 没有单击行为：点击卡片不应改变预览联系人，也不应出现选中态。
  await page.click(`#editorContactList [data-editor-contact-id="${switched.cards[0].id}"]`);
  await page.waitForTimeout(120);
  const afterClick = await readEditorContactState(page);
  if (afterClick.previewName !== switched.previewName) {
    issues.push(
      `Clicking a contact card must not change the preview contact: "${switched.previewName}" -> "${afterClick.previewName}".`,
    );
  }
  if (afterClick.cards.some((card) => card.className.split(/\s+/).some((name) => name !== "editor-contact-card"))) {
    issues.push("Clicking a contact card must not apply a selected state.");
  }

  // 搜索：单字符过滤 + 无匹配空态。
  const query = switched.cards[0].name.slice(0, 1);
  await page.fill("#editorContactSearch", query);
  await page.waitForFunction(
    (value) =>
      [...document.querySelectorAll("#editorContactList [data-editor-contact-id] .editor-contact-name")].every(
        (node) => node.textContent.includes(value),
      ),
    query,
  );
  const filtered = await readEditorContactState(page);
  result.filtered_card_count = filtered.cards.length;
  if (!filtered.cards.length) {
    issues.push(`Search "${query}" should still match the card it came from.`);
  }
  if (filtered.cards.length > firstPageSize) {
    issues.push(`Search "${query}" returned more cards than a page: ${filtered.cards.length}.`);
  }
  if (filtered.cards.some((card) => !card.name.includes(query))) {
    issues.push(`Search "${query}" rendered unrelated cards: ${JSON.stringify(filtered.cards)}.`);
  }
  if (parseEditorContactPage(filtered.pageLabel)?.page !== 1) {
    issues.push(`Search did not reset pagination to page 1: "${filtered.pageLabel}".`);
  }

  const noMatchQuery = "zzz-no-such-contact-zzz";
  await page.fill("#editorContactSearch", noMatchQuery);
  await page.waitForSelector("#editorContactList .empty-state");
  const noMatch = await readEditorContactState(page);
  if (noMatch.cards.length) {
    issues.push(`Search "${noMatchQuery}" should render no cards.`);
  }
  if (noMatch.paginationHidden !== true) {
    issues.push("Pagination must hide when the search matches nothing.");
  }
  if (noMatch.emptyText !== "没有匹配的联系人。") {
    issues.push(`Unexpected empty-state text: "${noMatch.emptyText}".`);
  }

  await page.fill("#editorContactSearch", "");
  await page.waitForFunction(
    (size) => document.querySelectorAll("#editorContactList [data-editor-contact-id]").length === size,
    firstPageSize,
  );

  // 翻页：下一页内容必须变化，最后一页禁用「下一页」，回到第一页还原。
  if (result.page_count > 1) {
    const firstPageIds = switched.cards.map((card) => card.id).join(",");
    await page.click("#editorContactNextPage");
    await page.waitForFunction(() => {
      const match = /第\s*(\d+)\s*\/\s*(\d+)\s*页/.exec(
        document.querySelector("#editorContactPageLabel")?.textContent || "",
      );
      return match ? Number(match[1]) === 2 : false;
    });
    const secondPage = await readEditorContactState(page);
    if (secondPage.cards.map((card) => card.id).join(",") === firstPageIds) {
      issues.push("Contact list next page rendered the same cards as page 1.");
    }
    if (secondPage.prevDisabled !== false) {
      issues.push("Contact list previous-page button should be enabled on page 2.");
    }
    for (let index = 2; index < result.page_count; index += 1) {
      await page.click("#editorContactNextPage");
    }
    await page.waitForFunction(
      (count) => {
        const match = /第\s*(\d+)\s*\/\s*(\d+)\s*页/.exec(
          document.querySelector("#editorContactPageLabel")?.textContent || "",
        );
        return match ? Number(match[1]) === count : false;
      },
      result.page_count,
    );
    const lastPage = await readEditorContactState(page);
    if (lastPage.nextDisabled !== true) {
      issues.push("Contact list next-page button should be disabled on the last page.");
    }
    if (!lastPage.cards.length) {
      issues.push("Contact list last page rendered no cards.");
    }
    for (let index = result.page_count - 1; index > 0; index -= 1) {
      await page.click("#editorContactPrevPage");
    }
    await page.waitForFunction(() => {
      const match = /第\s*(\d+)\s*\/\s*(\d+)\s*页/.exec(
        document.querySelector("#editorContactPageLabel")?.textContent || "",
      );
      return match ? Number(match[1]) === 1 : false;
    });
  }

  // 面板高度变化时页大小需要重算，窗口恢复后回到原页大小。
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.waitForFunction(
    (size) => {
      const count = document.querySelectorAll("#editorContactList [data-editor-contact-id]").length;
      return count > 0 && count !== size;
    },
    firstPageSize,
  );
  const resized = await page.evaluate(
    () => document.querySelectorAll("#editorContactList [data-editor-contact-id]").length,
  );
  result.resized_page_size = resized;
  if (resized >= firstPageSize) {
    issues.push(`Shrinking the editor panel should reduce the contact page size: ${resized} >= ${firstPageSize}.`);
  }
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.waitForFunction(
    (size) => document.querySelectorAll("#editorContactList [data-editor-contact-id]").length === size,
    firstPageSize,
  );

  // 切回编辑页签：原有编辑内容不得受影响。
  await page.click('#editorTabs [data-editor-tab="edit"]');
  await page.waitForSelector("#editorPanelEdit:not(.hidden)");
  const restored = await readEditorContactState(page);
  if (restored.activeTab !== "edit" || restored.editHidden !== false || restored.contactsHidden !== true) {
    issues.push(`Switching back to the edit tab failed: ${JSON.stringify(restored)}.`);
  }
  if (restored.messageRows !== baseline.messageRows) {
    issues.push(
      `Edit tab message rows changed after tab switching: ${baseline.messageRows} -> ${restored.messageRows}.`,
    );
  }
  if (restored.titleValue !== baseline.titleValue) {
    issues.push(`Edit tab title changed after tab switching: "${baseline.titleValue}" -> "${restored.titleValue}".`);
  }

  return result;
}

// 验证会话列表（preview_ids）管理：默认清单、双击加入、重复双击、移除入口与当前会话保护。
async function verifyConversationPreviewManagement(page, issues) {
  stage("conversation preview management");
  const result = {
    default_preview_ids: [],
    default_preview_count: 0,
    custom_group_in_default: false,
    added_id: null,
    duplicate_count: null,
    removed_id: null,
    restored: false,
    temporary_pin: null,
  };

  const contacts = await loadEnabledContacts(page);
  const previews = await loadConversationContacts(page);
  const originalPreviewIds = [...previews.previewIds];
  result.default_preview_ids = originalPreviewIds;
  result.default_preview_count = originalPreviewIds.length;

  const builtinGroupIds = contacts
    .filter((contact) => contact.kind === "group" && !contact.custom)
    .map((contact) => contact.id)
    .sort((left, right) => Number(left) - Number(right));
  const expectedDefault = [1084, ...builtinGroupIds];
  if (JSON.stringify(originalPreviewIds) !== JSON.stringify(expectedDefault)) {
    issues.push(
      `Default conversation list should be 薇儿丹蒂 + built-in groups: ${JSON.stringify(originalPreviewIds)} vs ${JSON.stringify(expectedDefault)}.`,
    );
  }
  const customInPreview = previews.previewItems.filter(
    (contact) => contact.kind === "group" && contact.custom,
  );
  result.custom_group_in_default = customInPreview.length > 0;
  if (customInPreview.length) {
    issues.push(
      `Custom groups must not appear in the default conversation list: ${JSON.stringify(customInPreview.map((contact) => contact.id))}.`,
    );
  }
  const renderedState = await page.evaluate(() => ({
    ids: [...document.querySelectorAll("#contactList [data-contact-id]")].map((node) =>
      node.getAttribute("data-contact-id"),
    ),
    activeId:
      document.querySelector("#contactList .side-entry.active")?.getAttribute("data-contact-id") || "",
  }));
  const renderedIds = renderedState.ids;
  const defaultKeys = expectedDefault.map(String);
  const expectedOrder = renderedState.activeId
    ? [renderedState.activeId, ...defaultKeys.filter((id) => id !== renderedState.activeId)]
    : defaultKeys;
  const renderedSet = new Set(renderedIds);
  const sameMembers =
    renderedIds.length === expectedOrder.length &&
    expectedOrder.every((id) => renderedSet.has(id));
  if (!sameMembers || JSON.stringify(renderedIds) !== JSON.stringify(expectedOrder)) {
    issues.push(
      `Rendered conversation list did not match the default ids with the active conversation pinned: ${JSON.stringify({ renderedIds, expectedOrder })}.`,
    );
  }

  const previewKeys = new Set(originalPreviewIds.map(String));
  const candidate = contacts.find(
    (contact) => contact.kind !== "group" && !previewKeys.has(String(contact.id)),
  );
  if (!candidate) {
    issues.push("No non-preview hero contact was available to test double-click joining.");
    return result;
  }
  result.added_id = candidate.id;

  try {
    const previewNameBefore = await page.evaluate(
      () => document.querySelector("#previewContactName")?.textContent.trim() || "",
    );
    await page.click('#editorTabs [data-editor-tab="contacts"]');
    await page.waitForSelector("#editorPanelContacts:not(.hidden)");
    await page.fill("#editorContactSearch", candidate.name);
    await page.waitForSelector(`#editorContactList [data-editor-contact-id="${candidate.id}"]`);

    // 单击既不加入也不切换会话。
    await page.click(`#editorContactList [data-editor-contact-id="${candidate.id}"]`);
    await page.waitForTimeout(120);
    const stillBefore = await page.evaluate(
      () => document.querySelector("#previewContactName")?.textContent.trim() || "",
    );
    if (stillBefore !== previewNameBefore) {
      issues.push(`Single click must not switch the conversation: "${previewNameBefore}" -> "${stillBefore}".`);
    }
    let apiState = await loadConversationContacts(page);
    if (apiState.previewIds.some((id) => String(id) === String(candidate.id))) {
      issues.push("Single click must not add the contact to the conversation list.");
    }

    // 双击加入并自动选中该会话。
    await page.dblclick(`#editorContactList [data-editor-contact-id="${candidate.id}"]`);
    await page.waitForFunction(
      (id) =>
        [...document.querySelectorAll("#contactList [data-contact-id]")].some(
          (node) => node.getAttribute("data-contact-id") === String(id),
        ),
      candidate.id,
    );
    await page.waitForFunction(
      (name) => document.querySelector("#previewContactName")?.textContent.trim() === name,
      candidate.name,
    );
    apiState = await loadConversationContacts(page);
    const addedIndex = apiState.previewIds.findIndex((id) => String(id) === String(candidate.id));
    if (addedIndex !== apiState.previewIds.length - 1) {
      issues.push(
        `Double-clicked contact should append to the conversation list: ${JSON.stringify(apiState.previewIds)}.`,
      );
    }
    const addedRow = await page.evaluate((id) => {
      const row = [...document.querySelectorAll("#contactList [data-contact-id]")].find(
        (node) => node.getAttribute("data-contact-id") === String(id),
      );
      return {
        active: row?.classList.contains("active") || false,
        removeButtons: row?.querySelectorAll('[data-action="remove-preview"]').length || 0,
      };
    }, candidate.id);
    if (!addedRow.active) {
      issues.push("Double-clicked contact should become the active conversation.");
    }
    if (addedRow.removeButtons !== 0) {
      issues.push("The active conversation row must not expose a remove button.");
    }

    // 再次双击不应重复加入。
    await page.dblclick(`#editorContactList [data-editor-contact-id="${candidate.id}"]`);
    await page.waitForTimeout(150);
    const afterDuplicate = await loadConversationContacts(page);
    result.duplicate_count = afterDuplicate.previewIds.filter(
      (id) => String(id) === String(candidate.id),
    ).length;
    if (result.duplicate_count !== 1) {
      issues.push(`Repeated double-click duplicated the contact: ${JSON.stringify(afterDuplicate.previewIds)}.`);
    }

    // 切到别的会话后，非当前会话卡片出现移除按钮，点击后移出清单。
    const otherId = originalPreviewIds[0];
    await page.click(`#contactList [data-contact-id="${otherId}"]`);
    await page.waitForFunction(
      (id) => {
        const row = [...document.querySelectorAll("#contactList [data-contact-id]")].find(
          (node) => node.getAttribute("data-contact-id") === String(id),
        );
        return Boolean(row?.querySelector('[data-action="remove-preview"]'));
      },
      candidate.id,
    );
    const activeRowHasRemove = await page.evaluate((id) => {
      const row = [...document.querySelectorAll("#contactList [data-contact-id]")].find(
        (node) => node.getAttribute("data-contact-id") === String(id),
      );
      return row?.querySelectorAll('[data-action="remove-preview"]').length || 0;
    }, otherId);
    if (activeRowHasRemove !== 0) {
      issues.push("The active conversation row must not expose a remove button after switching.");
    }
    await page.click(
      `#contactList [data-contact-id="${candidate.id}"] [data-action="remove-preview"]`,
    );
    await page.waitForFunction(
      (id) =>
        ![...document.querySelectorAll("#contactList [data-contact-id]")].some(
          (node) => node.getAttribute("data-contact-id") === String(id),
        ),
      candidate.id,
    );
    const afterRemove = await loadConversationContacts(page);
    result.removed_id = candidate.id;
    if (afterRemove.previewIds.some((id) => String(id) === String(candidate.id))) {
      issues.push("Removed contact is still present in the conversation list API.");
    }
    if (JSON.stringify(afterRemove.previewIds) !== JSON.stringify(originalPreviewIds)) {
      issues.push(
        `Removing the added contact did not restore the original list: ${JSON.stringify(afterRemove.previewIds)}.`,
      );
    }

    // 旧项目兼容：当前会话若不在 preview_ids 中，应当临时置顶显示且不回写清单。
    const activeForPin = await page.evaluate(
      () =>
        document.querySelector("#contactList .side-entry.active")?.getAttribute("data-contact-id") || "",
    );
    if (activeForPin && originalPreviewIds.some((id) => String(id) === String(activeForPin))) {
      const withoutActive = originalPreviewIds.filter((id) => String(id) !== String(activeForPin));
      await page.evaluate(async (ids) => {
        await window.saveConversationPreviewIds(ids);
      }, withoutActive);
      await page.waitForFunction(
        (id) =>
          document.querySelector("#contactList [data-contact-id]")?.getAttribute("data-contact-id") === id,
        activeForPin,
      );
      const pinnedState = await loadConversationContacts(page);
      const pinnedBack = pinnedState.previewIds.some((id) => String(id) === String(activeForPin));
      result.temporary_pin = { active_id: activeForPin, written_back: pinnedBack };
      if (pinnedBack) {
        issues.push("Temporary pinned conversation must not be written back into preview_ids.");
      }
    }
  } finally {
    // 会话清单是全局共享文件，测试结束后恢复原始顺序，避免污染后续运行。
    const current = await loadConversationContacts(page);
    if (JSON.stringify(current.previewIds) !== JSON.stringify(originalPreviewIds)) {
      await savePreviewIds(page, originalPreviewIds);
      result.restored = true;
    }
    await page.fill("#editorContactSearch", "");
    await page.click('#editorTabs [data-editor-tab="edit"]');
    await page.waitForSelector("#editorPanelEdit:not(.hidden)");
  }
  return result;
}

async function verifyStaticImageComposer(page, issues, fixture) {
  stage("static image composer");
  const layout = await page.evaluate(() => {
    const composer = document.querySelector("#messageComposer");
    const imageButton = document.querySelector("#chatImageButton");
    const stickerButton = document.querySelector("#chatStickerButton");
    if (!composer || !imageButton || !stickerButton) return null;
    const composerBox = composer.getBoundingClientRect();
    const imageBox = imageButton.getBoundingClientRect();
    const stickerBox = stickerButton.getBoundingClientRect();
    return {
      composer: { left: composerBox.left, right: composerBox.right, width: composerBox.width },
      image: { left: imageBox.left, right: imageBox.right, width: imageBox.width, height: imageBox.height },
      sticker: { left: stickerBox.left, right: stickerBox.right, width: stickerBox.width, height: stickerBox.height },
      childLeft: Math.min(...[...composer.children].filter((node) => getComputedStyle(node).display !== "none").map((node) => node.getBoundingClientRect().left)),
      childRight: Math.max(...[...composer.children].filter((node) => getComputedStyle(node).display !== "none").map((node) => node.getBoundingClientRect().right)),
      overflow: getComputedStyle(composer).overflow,
    };
  });
  if (!layout) {
    issues.push("Static image composer controls are missing.");
    return null;
  }
  const tolerance = 1;
  if (layout.childLeft < layout.composer.left - tolerance || layout.childRight > layout.composer.right + tolerance) {
    issues.push(`Static image controls exceed the composer bounds: ${JSON.stringify(layout)}.`);
  }
  if (layout.image.left >= layout.sticker.left) {
    issues.push(`Image button should be left of sticker button: ${JSON.stringify(layout)}.`);
  }
  if (layout.overflow !== "hidden") {
    issues.push(`Composer should clip decorative overflow, got overflow=${layout.overflow}.`);
  }

  await page.setInputFiles("#chatImageInput", {
    name: "wrong.gif",
    mimeType: "image/gif",
    buffer: Buffer.from("GIF89a", "ascii"),
  });
  await page.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("仅支持 PNG"));
  const wrongFormatMessage = (await page.locator("#toast").textContent() || "").trim();

  if (!fixture.uploadImagePath) {
    issues.push("No PNG fixture was available for static image upload.");
    return null;
  }
  await page.setInputFiles("#chatImageInput", fixture.uploadImagePath);
  await page.waitForSelector("#chatScroll .image-row .chat-image");
  const imageSrc = await page.locator("#chatScroll .image-row .chat-image").last().getAttribute("src");
  if (!imageSrc || !imageSrc.includes("/api/uploads/")) {
    issues.push(`Static image message did not use an upload URL: ${imageSrc}.`);
  }
  await page.waitForFunction(() => {
    const images = document.querySelectorAll("#chatScroll .image-row .chat-image");
    const image = images[images.length - 1];
    return Boolean(image && image.complete && image.naturalWidth > 0 && image.getBoundingClientRect().width > 0);
  });
  const imageCheck = await page.locator("#chatScroll .image-row .chat-image").last().evaluate((node) => {
    const image = node.getBoundingClientRect();
    const row = node.closest(".image-row")?.getBoundingClientRect();
    const scroll = node.closest(".chat-scroll")?.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      width: image.width,
      height: image.height,
      naturalWidth: node.naturalWidth,
      naturalHeight: node.naturalHeight,
      rowWidth: row?.width || 0,
      rowHeight: row?.height || 0,
      scrollWidth: scroll?.width || 0,
      scrollHeight: scroll?.height || 0,
      speakerLabelCount: node.closest(".image-row")?.querySelectorAll(".message-speaker").length || 0,
      backgroundImage: style.backgroundImage,
      boxShadow: style.boxShadow,
    };
  });
  if (imageCheck.naturalWidth <= 0 || imageCheck.naturalHeight <= 0) {
    issues.push(`Uploaded image did not decode: ${JSON.stringify(imageCheck)}.`);
  }
  if (imageCheck.width > imageCheck.scrollWidth * 0.62 || imageCheck.height > imageCheck.scrollHeight * 0.55) {
    issues.push(`Uploaded image exceeds the chat scaling bounds: ${JSON.stringify(imageCheck)}.`);
  }
  if (imageCheck.speakerLabelCount !== 0) {
    issues.push(`Image message should not render an administrator or speaker label: ${JSON.stringify(imageCheck)}.`);
  }
  if (imageCheck.backgroundImage !== "none" || imageCheck.boxShadow !== "none") {
    issues.push(`Image message should not have an added frame or background: ${JSON.stringify(imageCheck)}.`);
  }
  return {
    layout,
    wrongFormatMessage,
    uploadedUrl: imageSrc,
    imageMessageAdded: true,
    imageCheck,
  };
}

// 群聊管理的成员列表按 8 人分页；跨页收集选中状态，避免只校验第一页。
async function collectGroupMemberPages(page) {
  const pages = [];
  for (let guard = 0; guard < 50; guard += 1) {
    const snapshot = await page.evaluate(() => {
      const label = document.querySelector("#groupPageLabel")?.textContent || "";
      const cards = [...document.querySelectorAll("#groupMemberList .group-member-card")].map(
        (node) => ({
          id: node.getAttribute("data-group-member-id") || "",
          active: node.classList.contains("active"),
        }),
      );
      return { label, cards };
    });
    pages.push(snapshot.cards);
    const match = /第\s*(\d+)\s*\/\s*(\d+)\s*页/.exec(snapshot.label);
    const currentPage = match ? Number(match[1]) : 1;
    const pageCount = match ? Number(match[2]) : 1;
    if (currentPage >= pageCount) break;
    await page.click("#groupNextPage");
    await page.waitForFunction(
      (previous) => (document.querySelector("#groupPageLabel")?.textContent || "") !== previous,
      snapshot.label,
    );
  }
  return pages;
}

async function verifyGroupManager(page, issues, contacts) {
  stage("group manager");
  const topButtonText = (await page.locator("#newGroupButton").textContent() || "").trim();
  if (topButtonText !== "群聊管理") {
    issues.push(`Expected top toolbar action to be 群聊管理, got "${topButtonText}".`);
  }
  const addMessagePlacement = await page.evaluate(() => {
    const button = document.querySelector("#addMessageButton");
    return {
      text: (button?.textContent || "").trim(),
      inToolbar: Boolean(button?.closest(".toolbar-actions")),
      inEditorHeader: Boolean(button?.closest(".editor-header")),
    };
  });
  if (addMessagePlacement.text !== "添加消息") {
    issues.push(`Expected toolbar action to be 添加消息, got "${addMessagePlacement.text}".`);
  }
  if (!addMessagePlacement.inToolbar || addMessagePlacement.inEditorHeader) {
    issues.push(`Expected 添加消息 in the preview toolbar, got ${JSON.stringify(addMessagePlacement)}.`);
  }
  await page.click("#newGroupButton");
  await page.waitForSelector("#groupModal:not(.hidden)");
  const state = await page.evaluate(() => ({
    title: document.querySelector("#groupModalTitle")?.textContent || "",
    nameRowHidden: document.querySelector("#groupNameRow")?.classList.contains("hidden") || false,
    managerRowHidden: document.querySelector("#groupManagerRow")?.classList.contains("hidden") || false,
    createHidden: document.querySelector("#createGroupButton")?.classList.contains("hidden") || false,
    saveHidden: document.querySelector("#saveGroupButton")?.classList.contains("hidden") || false,
    deleteHidden: document.querySelector("#deleteGroupButton")?.classList.contains("hidden") || false,
    optionCount: document.querySelectorAll("#groupManagerSelect option").length,
    selectedGroupId: document.querySelector("#groupManagerSelect")?.value || "",
    activeMemberCount: document.querySelectorAll("#groupMemberList .group-member-card.active").length,
  }));
  const groups = contacts.filter((contact) => contact.kind === "group");
  if (state.title !== "群聊管理") issues.push(`Group manager title is wrong: ${state.title}.`);
  if (!state.nameRowHidden) issues.push("Group manager should hide the group-name input.");
  if (state.managerRowHidden) issues.push("Group manager should show the group selector.");
  if (!state.createHidden || state.saveHidden || state.deleteHidden) {
    issues.push(`Group manager action visibility is wrong: ${JSON.stringify(state)}.`);
  }
  if (state.optionCount !== groups.length) {
    issues.push(`Group manager options ${state.optionCount} did not match group count ${groups.length}.`);
  }
  const selectedGroup = groups.find((group) => String(group.id) === String(state.selectedGroupId));
  const expectedMembers = selectedGroup && Array.isArray(selectedGroup.member_ids)
    ? new Set(selectedGroup.member_ids.map(String)).size
    : 0;
  const memberPages = await collectGroupMemberPages(page);
  const memberCards = memberPages.flat();
  const activeMemberIds = memberCards.filter((card) => card.active).map((card) => card.id);
  const expectedMemberIds = selectedGroup
    ? [...new Set((selectedGroup.member_ids || []).map(String))]
    : [];
  const sortedActiveIds = [...activeMemberIds].sort();
  const sortedExpectedIds = [...expectedMemberIds].sort();
  if (
    sortedActiveIds.length !== sortedExpectedIds.length ||
    sortedActiveIds.some((id, index) => id !== sortedExpectedIds[index])
  ) {
    issues.push(
      `Group manager marked ${JSON.stringify(sortedActiveIds)} as selected, expected ${JSON.stringify(sortedExpectedIds)} (${expectedMembers}).`,
    );
  }
  const beforeToggle = activeMemberIds.length;
  if (beforeToggle > 0) {
    // 通过成员搜索定位到其中一个已选成员，避免分页导致的元素不可见。
    const toggleId = sortedActiveIds[0];
    await page.fill("#groupMemberSearch", toggleId);
    await page.waitForSelector(
      `#groupMemberList .group-member-card[data-group-member-id="${toggleId}"]`,
    );
    await page.click(
      `#groupMemberList .group-member-card[data-group-member-id="${toggleId}"]`,
    );
    const toggleState = await page.evaluate((id) => {
      const card = document.querySelector(
        `#groupMemberList .group-member-card[data-group-member-id="${id}"]`,
      );
      return {
        active: card?.classList.contains("active") || false,
        pressed: card?.getAttribute("aria-pressed") || "",
        selectedLabel: (document.querySelector("#groupSelectedCount")?.textContent || "").trim(),
      };
    }, toggleId);
    const selectedCountAfter = Number((toggleState.selectedLabel.match(/(\d+)/) || [])[1]);
    if (
      toggleState.active ||
      toggleState.pressed !== "false" ||
      selectedCountAfter !== beforeToggle - 1
    ) {
      issues.push(
        `Removing a group member in the manager changed ${beforeToggle} selected to ${toggleState.selectedLabel}: ${JSON.stringify(toggleState)}.`,
      );
    }
    await page.fill("#groupMemberSearch", "");
  } else {
    issues.push("Group manager did not mark any current members as selected.");
  }
  await page.click("#closeGroupModal");
  await page.waitForSelector("#groupModal", { state: "hidden" });
  return { ...state, groupCount: groups.length, beforeToggle };
}

async function verifyAvatarCentering(page, issues) {
  const avatars = await page.evaluate(() => {
    const selectors = [
      "#previewRailAvatar",
      "#chatScroll .message-avatar > .avatar",
    ];
    const nodes = selectors.flatMap((selector) =>
      [...document.querySelectorAll(selector)].map((node) => ({ selector, node })),
    );
    return nodes.map(({ selector, node }) => {
      const box = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      const parent = node.parentElement?.getBoundingClientRect();
      return {
        selector,
        className: node.className,
        width: Math.round(box.width),
        height: Math.round(box.height),
        centerOffsetX: parent ? Math.round(box.left + box.width / 2 - (parent.left + parent.width / 2)) : 0,
        centerOffsetY: parent ? Math.round(box.top + box.height / 2 - (parent.top + parent.height / 2)) : 0,
        backgroundImage: style.backgroundImage,
        backgroundPositionX: style.backgroundPositionX,
        backgroundPositionY: style.backgroundPositionY,
        backgroundRepeat: style.backgroundRepeat,
        backgroundSize: style.backgroundSize,
      };
    });
  });

  for (const avatar of avatars) {
    if (avatar.width <= 0 || avatar.height <= 0) {
      issues.push(`Avatar centering target has non-positive size: ${JSON.stringify(avatar)}.`);
      continue;
    }
    if (Math.abs(avatar.centerOffsetX) > 1 || Math.abs(avatar.centerOffsetY) > 1) {
      issues.push(`Avatar content is not centered inside its frame: ${JSON.stringify(avatar)}.`);
    }
    if (avatar.backgroundImage !== "none") {
      const centeredX = avatar.backgroundPositionX === "50%" || avatar.backgroundPositionX === "center";
      const centeredY = avatar.backgroundPositionY === "50%" || avatar.backgroundPositionY === "center";
      if (!centeredX || !centeredY || avatar.backgroundRepeat !== "no-repeat") {
        issues.push(`Avatar background image is not centered/cropped: ${JSON.stringify(avatar)}.`);
      }
      if (avatar.backgroundSize !== "cover") {
        issues.push(`Avatar background image should use cover sizing: ${JSON.stringify(avatar)}.`);
      }
    }
  }
  return {
    count: avatars.length,
    samples: avatars.slice(0, 4),
  };
}

async function verifyHeaderAndBubbleAlignment(page, issues) {
  const result = await page.evaluate(() => {
    const center = (node) => {
      const box = node.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2, width: box.width, height: box.height };
    };
    const header = document.querySelector(".chat-header");
    const name = document.querySelector("#previewContactName");
    const headerCenter = header ? center(header) : null;
    const nameCenter = name ? center(name) : null;
    const bubbles = [...document.querySelectorAll("#chatScroll .text-row .bubble")].map((bubble) => {
      const textNode = bubble.querySelector(".bubble-text");
      const bubbleBox = bubble.getBoundingClientRect();
      const textBox = textNode?.getBoundingClientRect();
      const row = bubble.closest(".chat-row");
      const rowBox = row?.getBoundingClientRect();
      const avatarBox = row?.querySelector(".message-avatar")?.getBoundingClientRect();
      const speakerBox = row?.querySelector(".message-speaker")?.getBoundingClientRect();
      const gap = row ? Number.parseFloat(getComputedStyle(row).gap) || 0 : 0;
      const laneLeft = rowBox && avatarBox ? rowBox.left + avatarBox.width + gap : Number.NEGATIVE_INFINITY;
      const laneRight = rowBox && avatarBox ? rowBox.right - avatarBox.width - gap : Number.POSITIVE_INFINITY;
      const isLeft = row?.classList.contains("left") || false;
      const isRight = row?.classList.contains("right") || false;
      return {
        side: isLeft ? "left" : isRight ? "right" : "center",
        laneLeft,
        laneRight,
        laneWidth: laneRight - laneLeft,
        textLength: textNode?.textContent?.length || 0,
        avatarWidth: avatarBox?.width || 0,
        speakerLeftOffset: speakerBox ? speakerBox.left - bubbleBox.left : null,
        anchorGap: avatarBox
          ? isLeft
            ? bubbleBox.left - avatarBox.right
            : isRight
              ? avatarBox.left - bubbleBox.right
              : 0
          : Number.POSITIVE_INFINITY,
        textAlign: textNode ? getComputedStyle(textNode).textAlign : "",
        centerOffsetX: textBox
          ? textBox.left + textBox.width / 2 - (bubbleBox.left + bubbleBox.width / 2)
          : Number.POSITIVE_INFINITY,
        centerOffsetY: textBox
          ? textBox.top + textBox.height / 2 - (bubbleBox.top + bubbleBox.height / 2)
          : Number.POSITIVE_INFINITY,
        bubbleBoxLeft: bubbleBox.left,
        bubbleBoxRight: bubbleBox.right,
        bubbleWidth: Math.round(bubbleBox.width),
        bubbleHeight: Math.round(bubbleBox.height),
      };
    });
    const scroll = document.querySelector("#chatScroll");
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
    const lastRow = scroll?.querySelector(".chat-row:last-of-type");
    const scrollBox = scroll?.getBoundingClientRect();
    const lastRowBox = lastRow?.getBoundingClientRect();
    const bottomReserve = scrollBox && lastRowBox ? scrollBox.bottom - lastRowBox.bottom : Number.POSITIVE_INFINITY;
    const icon = document.querySelector("#chatStickerButton .composer-sticker-icon svg");
    const iconBox = icon?.getBoundingClientRect();
    return {
      headerAvatarCount: document.querySelectorAll(".chat-header .contact-avatar, .chat-header #previewAvatar").length,
      headerNameOffsetX: headerCenter && nameCenter ? nameCenter.x - headerCenter.x : Number.POSITIVE_INFINITY,
      headerNameOffsetY: headerCenter && nameCenter ? nameCenter.y - headerCenter.y : Number.POSITIVE_INFINITY,
      bottomReserve,
      bubbles,
      stickerIconCount: icon ? 1 : 0,
      stickerIcon: iconBox
        ? { width: Math.round(iconBox.width), height: Math.round(iconBox.height) }
        : null,
      stickerIconBackground: document.querySelector("#chatStickerButton .composer-sticker-icon")
        ? getComputedStyle(document.querySelector("#chatStickerButton .composer-sticker-icon")).backgroundImage
        : "",
    };
  });

  if (result.headerAvatarCount !== 0) {
    issues.push(`Chat header should not render an avatar, got ${result.headerAvatarCount}.`);
  }
  if (Math.abs(result.headerNameOffsetX) > 1 || Math.abs(result.headerNameOffsetY) > 1) {
    issues.push(`Chat header name is not centered: ${JSON.stringify(result)}.`);
  }
  if (!result.bubbles.length) issues.push("No text bubbles were available for center-alignment checks.");
  if (!result.bubbles.some((bubble) => bubble.side === "left") || !result.bubbles.some((bubble) => bubble.side === "right")) {
    issues.push("Both left and right text bubbles are required for side-anchoring checks.");
  }
  if (result.bottomReserve < 20) {
    issues.push(`Chat scroll bottom reserve is too small: ${result.bottomReserve}.`);
  }
  for (const [index, bubble] of result.bubbles.entries()) {
    if (!new Set(["start", "left"]).has(bubble.textAlign)) {
      issues.push(`Text bubble ${index} does not keep all wrapped lines on the left edge: ${JSON.stringify(bubble)}.`);
    }
    if (Math.abs(bubble.centerOffsetX) > 1 || Math.abs(bubble.centerOffsetY) > 1) {
      issues.push(`Text bubble ${index} content is not centered: ${JSON.stringify(bubble)}.`);
    }
    if (bubble.anchorGap < -1 || bubble.anchorGap > 20) {
      issues.push(`Text bubble ${index} is not anchored to its ${bubble.side} side: ${JSON.stringify(bubble)}.`);
    }
    if (bubble.bubbleBoxLeft < bubble.laneLeft - 1 || bubble.bubbleBoxRight > bubble.laneRight + 1) {
      issues.push(`Text bubble ${index} crosses the avatar-to-avatar lane: ${JSON.stringify(bubble)}.`);
    }
    if (bubble.speakerLeftOffset !== null && Math.abs(bubble.speakerLeftOffset) > 2) {
      issues.push(`Speaker label ${index} box is not aligned to the message panel: ${JSON.stringify(bubble)}.`);
    }
    if (bubble.textLength >= 120 && bubble.side === "right" && bubble.bubbleWidth < bubble.laneWidth - 6) {
      issues.push(`Long right bubble did not expand to the left lane boundary: ${JSON.stringify(bubble)}.`);
    }
  }
  if (result.stickerIconCount !== 1) {
    issues.push(`Expected one smile sticker SVG icon, got ${result.stickerIconCount}.`);
  } else if (result.stickerIcon.width <= 8 || result.stickerIcon.height <= 8) {
    issues.push(`Sticker SVG icon is too small: ${JSON.stringify(result.stickerIcon)}.`);
  }
  if (result.stickerIconBackground !== "none") {
    issues.push(`Sticker icon should not use the old background image: ${result.stickerIconBackground}.`);
  }
  return result;
}

async function verifyDesktopShellLayout(page, issues) {
  const shell = await page.evaluate(() => {
    const rect = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const box = node.getBoundingClientRect();
      return {
        left: Math.round(box.left),
        top: Math.round(box.top),
        right: Math.round(box.right),
        bottom: Math.round(box.bottom),
        width: Math.round(box.width),
        height: Math.round(box.height),
      };
    };
    const scroll = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const style = window.getComputedStyle(node);
      return {
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        overflowY: style.overflowY,
      };
    };
    const preview = rect(".phone-preview");
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    return {
      viewport: { width: viewportWidth, height: viewportHeight },
      bodyScrollHeight: document.body.scrollHeight,
      documentScrollHeight: document.documentElement.scrollHeight,
      bodyOverflow: window.getComputedStyle(document.body).overflow,
      appShell: rect(".app-shell"),
      sidebar: rect(".sidebar"),
      previewColumn: rect(".preview-column"),
      phoneStack: rect(".phone-stack"),
      preview,
      editor: rect(".editor-column"),
      editorScroll: scroll(".editor-column"),
      editorPanelScroll:
        scroll("#editorPanelEdit:not(.hidden)") || scroll("#editorPanelContacts:not(.hidden)"),
      sidebarSectionScroll: scroll(".sidebar-section"),
      previewCenterX: preview ? preview.left + preview.width / 2 : 0,
      viewportCenterX: viewportWidth / 2,
    };
  });

  if (shell.documentScrollHeight > shell.viewport.height + 2 || shell.bodyScrollHeight > shell.viewport.height + 2) {
    issues.push(`Desktop shell should not scroll the document: ${JSON.stringify(shell)}.`);
  }
  if (shell.bodyOverflow !== "hidden") {
    issues.push(`Desktop body overflow should be hidden to keep the game UI centered: ${JSON.stringify(shell)}.`);
  }
  for (const [name, box] of Object.entries({
    appShell: shell.appShell,
    sidebar: shell.sidebar,
    previewColumn: shell.previewColumn,
    editor: shell.editor,
    preview: shell.preview,
  })) {
    if (!box || box.width <= 0 || box.height <= 0) {
      issues.push(`Desktop shell ${name} has a non-positive size: ${JSON.stringify(box)}.`);
      continue;
    }
    if (box.top < -2 || box.bottom > shell.viewport.height + 2) {
      issues.push(`Desktop shell ${name} is not vertically contained: ${JSON.stringify(box)}.`);
    }
  }
  if (Math.abs(shell.previewCenterX - shell.viewportCenterX) > 4) {
    issues.push(`Desktop game UI is not centered in the viewport: ${JSON.stringify(shell)}.`);
  }
  // 页签布局下由当前页签面板承担滚动，编辑栏本身只负责裁剪。
  if (!shell.editorScroll) {
    issues.push(`Desktop editor column is missing: ${JSON.stringify(shell)}.`);
  } else if (shell.editorScroll.overflowY !== "hidden") {
    issues.push(`Desktop editor column should clip instead of scrolling: ${JSON.stringify(shell)}.`);
  }
  if (
    !shell.editorPanelScroll
    || shell.editorPanelScroll.scrollHeight <= shell.editorPanelScroll.clientHeight
  ) {
    issues.push(`Desktop editor panel should scroll independently for long content: ${JSON.stringify(shell)}.`);
  }
  if (!["auto", "scroll"].includes(shell.editorPanelScroll?.overflowY || "")) {
    issues.push(`Desktop editor panel should use independent vertical scrolling: ${JSON.stringify(shell)}.`);
  }
  return shell;
}

// Playwright 回归主流程。
async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  stage("load fixture assets");
  const fixture = loadFixtureAssets();
  if (!fixture.avatar) throw new Error("Asset index is empty; no avatar fixture is available.");
  if (!fixture.sticker) throw new Error("Asset index has no chat sticker fixture.");

  stage("launch browser");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(90000);
  const issues = [];
  const consoleErrors = [];
  const assetFileRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("request", (request) => {
    const url = request.url();
    if (/\/api\/assets\/.+\/(file|thumbnail)(\?|$)/.test(url)) assetFileRequests.push(url);
  });

  stage("open editor");
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(document.querySelector('#phonePreview[data-ui="momotalk"]')));
  await page.waitForFunction(() => Boolean(document.querySelector(".project-item, #projectList .empty-state")));
  await page.waitForFunction(() => Boolean(document.querySelector("#contactList [data-contact-id]")));
  let enabledContacts = await loadEnabledContacts(page);
  if (!enabledContacts.length) throw new Error("No enabled contacts are available.");
  const defaultPreview = await loadConversationContacts(page);
  const groupUi = await verifyGroupModal(page, issues, enabledContacts);
  const groupManager = await verifyGroupManager(page, issues, enabledContacts);
  const groupExport = await verifyGroupExportMosaic(page, issues);
  const conversationIsolation = await verifyConversationIsolation(page, issues);
  if (ALLOW_GROUP_MUTATION) {
    enabledContacts = await loadEnabledContacts(page);
  }
  const expectedContactCount = enabledContacts.length;
  const builtinGroupIds = enabledContacts
    .filter((contact) => contact.kind === "group" && !contact.custom)
    .map((contact) => contact.id)
    .sort((left, right) => Number(left) - Number(right));
  const expectedPreviewIds = [1084, ...builtinGroupIds];
  if (JSON.stringify(defaultPreview.previewIds) !== JSON.stringify(expectedPreviewIds)) {
    issues.push(
      `Default conversation list should be 薇儿丹蒂 + built-in groups: ${JSON.stringify(defaultPreview.previewIds)} vs ${JSON.stringify(expectedPreviewIds)}.`,
    );
  }
  const defaultCustomGroups = defaultPreview.previewItems.filter(
    (contact) => contact.kind === "group" && contact.custom,
  );
  if (defaultCustomGroups.length) {
    issues.push(
      `Default conversation list must not include custom groups: ${JSON.stringify(defaultCustomGroups.map((contact) => contact.id))}.`,
    );
  }
  const expectedPreviewCount =
    defaultPreview.previewIds.length + (groupUi?.mode === "created" ? 1 : 0);
  const groupContact =
    (groupUi?.mode === "created"
      ? enabledContacts.find((contact) => String(contact.id) === String(groupUi.id))
      : null) || enabledContacts.find((contact) => contact.kind === "group");
  const selectedContact = groupContact || enabledContacts[0];
  const expectedSpeakerOptionCount =
    selectedContact.kind === "group" ? 1 + Math.max(1, contactMemberIds(selectedContact).length) : 2;

  stage("create project");
  const runTitle = `阶段4 UI 验证 ${Date.now()}`;
  await page.click("#projectCreateButton");
  await page.waitForFunction(() => document.querySelector("#previewTitle")?.textContent === "未命名项目");
  await page.waitForSelector("#contactList [data-contact-id]");
  const defaultBackground = await page.locator(".momotalk-chat").evaluate((node) => ({
    hasClass: node.classList.contains("has-background"),
    background: window.getComputedStyle(node).getPropertyValue("--chat-background"),
    backgroundImage: window.getComputedStyle(node).backgroundImage,
  }));
  if (
    !defaultBackground.hasClass ||
    !defaultBackground.background.includes("backgrounds_texturebg_momotalk_momotalk_04_Momotalk_04")
  ) {
    issues.push(`Expected Momotalk_04 as the default chat background, got ${JSON.stringify(defaultBackground)}.`);
  }
  const gameChrome = await page.evaluate(() => {
    const rail = document.querySelector(".momotalk-rail");
    const side = document.querySelector(".momotalk-side");
    const card = document.querySelector("#contactList [data-contact-id].side-entry");
    const activeCard = document.querySelector("#contactList [data-contact-id].side-entry.active");
    return {
      railBackground: rail ? window.getComputedStyle(rail).backgroundImage : "",
      sideBackground: side ? window.getComputedStyle(side).backgroundImage : "",
      cardBackground: card ? window.getComputedStyle(card).backgroundImage : "",
      activeCardBackground: activeCard ? window.getComputedStyle(activeCard).backgroundImage : "",
      historyButtonCount: document.querySelectorAll(".history-button").length,
      railChangeCount: document.querySelectorAll(".rail-change").length,
    };
  });
  if (!gameChrome.railBackground.includes("backgrounds_texturebg_momotalk_momotalk_06_Momotalk_06")) {
    issues.push(`Expected Momotalk_06 rail chrome, got ${JSON.stringify(gameChrome)}.`);
  }
  if (gameChrome.sideBackground.includes("backgrounds_texturebg_momotalk_momotalk_03_Momotalk_03")) {
    issues.push(`Contact panel should no longer use Momotalk_03 chrome, got ${JSON.stringify(gameChrome)}.`);
  }
  if (gameChrome.cardBackground !== "none" && !gameChrome.cardBackground.includes("rgba(0, 0, 0, 0)")) {
    issues.push(`Expected contact rows to stop using role-card backgrounds, got ${JSON.stringify(gameChrome)}.`);
  }
  if (gameChrome.activeCardBackground !== "none" && !gameChrome.activeCardBackground.includes("rgba(0, 0, 0, 0)")) {
    issues.push(`Expected active contact rows to stop using role-card backgrounds, got ${JSON.stringify(gameChrome)}.`);
  }
  if (gameChrome.historyButtonCount !== 0 || gameChrome.railChangeCount !== 0) {
    issues.push(`Removed in-game icon placeholders are still present: ${JSON.stringify(gameChrome)}.`);
  }
  const contactCount = await page.locator("#contactList [data-contact-id]").count();
  if (contactCount !== expectedPreviewCount) {
    issues.push(
      `Expected ${expectedPreviewCount} conversation-list rows, got ${contactCount}.`,
    );
  }
  const renderedContactAvatarCount = await page
    .locator("#contactList [data-contact-id] .side-entry-avatar.avatar-frame")
    .evaluateAll(
      (frames) =>
        frames.filter(
          (frame) =>
            frame.querySelector(":scope > .avatar") ||
            frame.querySelector(":scope > .group-avatar-mosaic"),
        ).length,
    );
  if (renderedContactAvatarCount !== expectedPreviewCount) {
    issues.push(
      `Expected every conversation row to use the cropped avatar frame, got ${renderedContactAvatarCount}/${expectedPreviewCount}.`,
    );
  }
  await page.click(`#contactList [data-contact-id="${selectedContact.id}"]`);
  await page.waitForFunction(
    (name) => document.querySelector("#previewContactName")?.textContent === name,
    selectedContact.name,
  );
  const speakerOptionCount = await page.locator("#speakerPicker option").count();
  if (speakerOptionCount !== expectedSpeakerOptionCount) {
    issues.push(
      `Expected ${expectedSpeakerOptionCount} speaker options for ${selectedContact.name}, got ${speakerOptionCount}.`,
    );
  }
  const defaultSpeaker = await page.locator("#speakerPicker option:checked").textContent();
  if (defaultSpeaker !== "管理员") {
    issues.push(`Expected "管理员" as the default speaker, got "${defaultSpeaker}".`);
  }
  const staticImageComposer = await verifyStaticImageComposer(page, issues, fixture);
  const bubbleThemes = await verifyBubbleThemes(page, issues);
  const continuousBubbleTails = await verifyContinuousBubbleTails(page, issues);
  const editorContactTab = await verifyEditorContactTab(page, issues, expectedContactCount);
  stage("composer sticker modal");
  const composerStickerButtonCount = await page.locator("#chatStickerButton").count();
  if (composerStickerButtonCount !== 1) {
    issues.push(`Expected one in-game composer sticker button, got ${composerStickerButtonCount}.`);
  }
  await page.click("#chatStickerButton");
  await page.waitForSelector("#assetModal:not(.hidden)");
  const composerStickerTitle = ((await page.locator("#assetModalTitle").textContent()) || "").trim();
  if (composerStickerTitle !== "选择表情") {
    issues.push(`Expected composer sticker modal title "选择表情", got "${composerStickerTitle}".`);
  }
  await page.waitForSelector("#assetModal:not(.hidden) .category-card");
  await page.click("#closeAssetModal");
  await page.waitForSelector("#assetModal", { state: "hidden" });
  const adminAvatarAssetId = await pickFirstAsset(page, "#previewRailAvatarButton", 1);
  const adminAvatarUrlPart = adminAvatarAssetId.replaceAll(":", "_");
  const railAvatarBackground = await page.locator("#previewRailAvatar").evaluate((node) => node.style.backgroundImage);
  if (!railAvatarBackground.includes(adminAvatarUrlPart)) {
    issues.push(`Expected rail avatar to use ${adminAvatarAssetId}, got "${railAvatarBackground}".`);
  }
  await page.fill("#directMessageInput", ADMIN_MESSAGE_TEXT);
  await page.press("#directMessageInput", "Enter");
  await page.waitForFunction((text) => document.querySelector("#chatScroll")?.textContent.includes(text), ADMIN_MESSAGE_TEXT);
  const adminRow = page.locator("#chatScroll .chat-row.right", { hasText: ADMIN_MESSAGE_TEXT });
  if ((await adminRow.count()) < 1) issues.push("Admin composer message was not rendered on the right side.");
  if ((await adminRow.locator(".message-avatar").count()) !== 1) {
    issues.push("Admin composer message should render an administrator avatar.");
  }
  if ((await adminRow.locator(".message-speaker").count()) !== 0) {
    issues.push("Admin composer message should not render the administrator name label.");
  }
  const adminRowAssetId = await adminRow.getAttribute("data-speaker-asset-id");
  if (adminRowAssetId !== adminAvatarAssetId) {
    issues.push(`Admin composer message should use ${adminAvatarAssetId}, got "${adminRowAssetId}".`);
  }
  await page.selectOption("#speakerPicker", { index: Math.min(2, expectedSpeakerOptionCount - 1) });
  const directSpeakerName = await page.locator("#speakerPicker option:checked").textContent();
  await page.fill("#directMessageInput", DIRECT_MESSAGE_TEXT);
  await page.press("#directMessageInput", "Enter");
  await page.waitForFunction((text) => document.querySelector("#chatScroll")?.textContent.includes(text), DIRECT_MESSAGE_TEXT);
  const directSpeakerRowCount = await page.locator(`#chatScroll .chat-row[data-speaker-name="${directSpeakerName}"]`).count();
  if (directSpeakerRowCount < 1) issues.push("Direct composer message did not store speaker metadata.");
  await page.fill("#projectTitleInput", runTitle);
  // 记录被改名群组的原始名称，跑完（含断言失败）后自动还原，避免污染真实数据。
  if (selectedContact.kind === "group") {
    groupRenameRestore.id = selectedContact.id;
    groupRenameRestore.name = selectedContact.name;
  }
  await page.fill("#contactNameInput", LONG_CONTACT_NAME);

  stage("fill project appearance");
  await page.click("#backgroundPickerButton");
  await page.waitForSelector("#assetModal:not(.hidden) .asset-card");
  const backgroundIds = await page.locator("#assetGrid .asset-card").evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-asset-id") || ""),
  );
  const allowedBackgroundIds = new Set([
    "backgrounds:texturebg_momotalk_momotalk_03:Momotalk_03",
    "backgrounds:texturebg_momotalk_momotalk_04:Momotalk_04",
  ]);
  if (
    backgroundIds.length !== 2 ||
    backgroundIds.some((id) => !allowedBackgroundIds.has(id))
  ) {
    issues.push(`Background picker must only expose 03/04, got ${JSON.stringify(backgroundIds)}.`);
  }
  await page.click("#closeAssetModal");
  await page.waitForSelector("#assetModal", { state: "hidden" });
  if ((await page.locator("#avatarPickerButton").count()) !== 0) {
    issues.push("Contact avatar selector button is still present.");
  }
  if ((await page.locator("#avatarPickerAvatar").count()) !== 1) {
    issues.push("Read-only contact avatar display is missing.");
  }
  const chosenAssets = {
    avatar: "display-only",
    adminAvatar: adminAvatarAssetId,
    background: await pickFirstAsset(page, "#backgroundPickerButton"),
  };

  stage("add message fixtures");
  await addMessage(page, "text", "left", `长链接：\n${LONG_URL}\n后面继续输入中文。`);
  await addMessage(page, "text", "right", LONG_CHINESE);
  stage("add sticker message");
  chosenAssets.sticker = await addMessage(page, "sticker", "left");
  stage("add centered message fixtures");
  await addMessage(page, "system", "center", SYSTEM_TEXT);
  await addMessage(page, "recall", "center", RECALL_TEXT);

  stage("empty message modal");
  await page.fill("#directMessageInput", "");
  await page.focus("#directMessageInput");
  await page.keyboard.press("Enter");
  await page.waitForSelector("#emptyMessageModal:not(.hidden)", { timeout: 5000 });
  const emptyModalText = (await page.locator("#emptyMessageModalText").textContent() || "").trim();
  if (emptyModalText !== "输入不能为空") {
    issues.push(`Empty message modal text mismatch: "${emptyModalText}".`);
  }
  const emptyModalCentered = await page.locator("#emptyMessageModal").evaluate((node) => {
    const panel = node.querySelector(".chat-alert-panel");
    if (!panel) return false;
    const host = node.getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    const hostCenterX = host.left + host.width / 2;
    const hostCenterY = host.top + host.height / 2;
    const panelCenterX = box.left + box.width / 2;
    const panelCenterY = box.top + box.height / 2;
    return Math.abs(hostCenterX - panelCenterX) < 4 && Math.abs(hostCenterY - panelCenterY) < 4;
  });
  if (!emptyModalCentered) issues.push("Empty message modal panel is not centered in the chat area.");
  await page.click("#emptyMessageModalClose");
  await page.waitForFunction(() =>
    document.querySelector("#emptyMessageModal")?.classList.contains("hidden") === true,
  );
  const blockAfterModal = await page.locator("#chatScroll .chat-row").count();
  if (blockAfterModal < 1) issues.push("Chat rows disappeared after dismissing the empty message modal.");

  stage("power confirm modal");
  await page.click("#powerButton");
  await page.waitForSelector("#powerConfirmModal:not(.hidden)", { timeout: 5000 });
  const powerModalCentered = await page.locator("#powerConfirmModal").evaluate((node) => {
    const panel = node.querySelector(".panel-alert-panel");
    if (!panel) return false;
    const host = node.getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    return (
      Math.abs(host.left + host.width / 2 - (box.left + box.width / 2)) < 4 &&
      Math.abs(host.top + host.height / 2 - (box.top + box.height / 2)) < 4
    );
  });
  if (!powerModalCentered) issues.push("Power confirm modal panel is not centered in the phone UI.");
  await page.click("#powerConfirmCancel");
  await page.waitForFunction(() =>
    document.querySelector("#powerConfirmModal")?.classList.contains("hidden") === true,
  );
  if (await page.locator("#shutdownNotice:not(.hidden)").count() > 0) {
    issues.push("Cancelling the power confirm should not trigger shutdown.");
  }

  stage("save and export");
  const avatarFill = await page.evaluate((expectedInsetRatio) => {
    const frames = [
      ...document.querySelectorAll("#contactList .side-entry-avatar.avatar-frame"),
      ...document.querySelectorAll("#chatScroll .message-avatar.avatar-frame"),
    ].filter(Boolean);
    return frames.map((frame) => {
      const avatar = frame.querySelector(".avatar");
      const groupMosaic = frame.querySelector(":scope > .group-avatar-mosaic");
      const content = groupMosaic || avatar;
      if (!content) return { frameClass: frame.className, missingAvatar: true };
      const frameBox = frame.getBoundingClientRect();
      const avatarBox = content.getBoundingClientRect();
      const avatarStyle = window.getComputedStyle(content);
      const frameClipPath = window.getComputedStyle(frame).clipPath;
      const frameAfter = window.getComputedStyle(frame, "::after");
      return {
        frameClass: frame.className,
        groupMosaic: Boolean(groupMosaic),
        insetLeftRatio: (avatarBox.left - frameBox.left) / frameBox.width,
        insetTopRatio: (avatarBox.top - frameBox.top) / frameBox.height,
        contentWidthRatio: avatarBox.width / frameBox.width,
        contentHeightRatio: avatarBox.height / frameBox.height,
        borderRadius: avatarStyle.borderRadius,
        overflow: avatarStyle.overflow,
        frameClipPath,
        frameAfterBackground: frameAfter.backgroundImage,
        expectedInsetRatio,
      };
    });
  }, AVATAR_FRAME_INSET_RATIO);
  for (const item of avatarFill) {
    if (
      item.missingAvatar ||
      Math.abs(item.insetLeftRatio - item.expectedInsetRatio) > 0.01 ||
      Math.abs(item.insetTopRatio - item.expectedInsetRatio) > 0.01 ||
      Math.abs(item.contentWidthRatio - AVATAR_FRAME_CONTENT_RATIO) > 0.01 ||
      Math.abs(item.contentHeightRatio - AVATAR_FRAME_CONTENT_RATIO) > 0.01
    ) {
      issues.push(`Avatar is not cropped to the game frame hole: ${JSON.stringify(item)}`);
    }
    if (item.frameClipPath !== "none") {
      issues.push(`Avatar frame wrapper should be transparent, got a clip path: ${JSON.stringify(item)}`);
    }
    if (item.borderRadius !== `${AVATAR_FRAME_CONTENT_RADIUS_PERCENT}%`) {
      issues.push(`Avatar crop radius is incorrect: ${JSON.stringify(item)}`);
    }
    if (item.frameAfterBackground !== "none") {
      issues.push(`Avatar frame overlay is still drawn: ${JSON.stringify(item)}`);
    }
  }
  const exportAvatarCrop = await page.evaluate((insetRatio) => {
    const source = document.createElement("canvas");
    source.width = 108;
    source.height = 108;
    const sourceContext = source.getContext("2d");
    sourceContext.fillStyle = "#ff0000";
    sourceContext.fillRect(0, 0, source.width, source.height);

    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 108;
        canvas.height = 108;
        const context = canvas.getContext("2d");
        window.drawExportAvatarContent(context, 0, 0, 108, { type: "image", image });
        const outside = context.getImageData(1, 1, 1, 1).data;
        const center = context.getImageData(54, 54, 1, 1).data;
        const edge = Math.ceil(108 * insetRatio);
        const justInside = context.getImageData(edge + 1, 54, 1, 1).data;
        resolve({
          outsideAlpha: outside[3],
          center,
          justInside,
          edge,
        });
      };
      image.onerror = () => reject(new Error("Failed to build synthetic avatar image"));
      image.src = source.toDataURL("image/png");
    });
  }, AVATAR_FRAME_INSET_RATIO);
  if (
    exportAvatarCrop.outsideAlpha !== 0 ||
    exportAvatarCrop.center[0] !== 255 ||
    exportAvatarCrop.center[3] !== 255 ||
    exportAvatarCrop.justInside[0] !== 255 ||
    exportAvatarCrop.justInside[3] !== 255
  ) {
    issues.push(`Export avatar crop is incorrect: ${JSON.stringify(exportAvatarCrop)}`);
  }
  await page.waitForTimeout(250);
  await page.click("#saveButton");
  await page.waitForFunction(() => document.querySelector("#saveState")?.textContent === "已保存");

  const beforeReload = await collectState(page);
  validateState(beforeReload, "before reload", issues);
  await page.screenshot({ path: path.join(outputDir, "desktop-editor.png"), fullPage: true });
  await page.locator(".phone-preview").screenshot({ path: path.join(outputDir, "desktop-phone.png") });
  const exportPath = path.join(outputDir, "export-admin-avatar.png");
  const downloadPromise = page.waitForEvent("download");
  await page.click("#saveChatImageButton");
  const download = await downloadPromise;
  await download.saveAs(exportPath);
  if (!fs.existsSync(exportPath) || fs.statSync(exportPath).size < 1024) {
    issues.push("Administrator avatar export did not produce a valid PNG.");
  }
  const exportedMessageTypes = await page.evaluate(() =>
    exportableMessages().map((message) => message.type),
  );
  if (!exportedMessageTypes.includes("recall")) {
    issues.push(`Recall message was excluded from PNG export: ${JSON.stringify(exportedMessageTypes)}.`);
  }
  const avatarCentering = await verifyAvatarCentering(page, issues);
  const headerAndBubbleAlignment = await verifyHeaderAndBubbleAlignment(page, issues);
  const desktopShell = await verifyDesktopShellLayout(page, issues);
  const desktopLayout = await collectLayout(page, issues, "desktop");

  stage("reload and verify persistence");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".message-list-item");
  await page.waitForFunction((title) => document.querySelector("#previewTitle")?.textContent === title, runTitle);
  const afterReload = await collectState(page);
  const reloadedSpeaker = await page.locator("#speakerPicker option:checked").textContent();
  if (reloadedSpeaker !== "管理员") {
    issues.push(`Expected "管理员" as the default speaker after reload, got "${reloadedSpeaker}".`);
  }
  const reloadedRailBackground = await page.locator("#previewRailAvatar").evaluate((node) => node.style.backgroundImage);
  if (!reloadedRailBackground.includes(adminAvatarUrlPart)) {
    issues.push(`Expected selected admin avatar to persist after reload, got "${reloadedRailBackground}".`);
  }
  validateState(afterReload, "after reload", issues);

  stage("verify mobile layout");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outputDir, "mobile-editor.png"), fullPage: true });
  await page.locator(".phone-preview").screenshot({ path: path.join(outputDir, "mobile-phone.png") });
  const mobileLayout = await collectLayout(page, issues, "mobile");

  if (beforeReload.title !== runTitle) issues.push(`Unexpected title before reload: ${beforeReload.title}`);
  if (afterReload.title !== runTitle) issues.push(`Unexpected title after reload: ${afterReload.title}`);
  if (beforeReload.messageCount !== 8) issues.push(`Expected 8 messages before reload, got ${beforeReload.messageCount}`);
  if (afterReload.messageCount !== 8) issues.push(`Expected 8 messages after reload, got ${afterReload.messageCount}`);
  if (beforeReload.previewText !== afterReload.previewText) issues.push("Preview text changed after reload.");
  if (afterReload.previewText.includes(LONG_URL) !== true) issues.push("Long URL text was not preserved in the preview.");
  if (afterReload.previewText.includes("长链接：") !== true) issues.push("Text line breaks were not preserved in the preview.");
  if (afterReload.previewText.includes(LONG_CHINESE.slice(0, 20)) !== true) issues.push("Long Chinese text was not preserved in the preview.");
  if (afterReload.previewText.includes(DIRECT_MESSAGE_TEXT) !== true) issues.push("Direct composer message was not preserved.");
  if (!afterReload.speakerRows.some((row) => row.name === directSpeakerName)) {
    issues.push(`Direct composer message speaker was not restored: ${directSpeakerName}`);
  }
  if (consoleErrors.length) issues.push(`Console errors: ${consoleErrors.join(" | ")}`);
  if (assetFileRequests.length > 1000) {
    issues.push(`Too many asset file requests: ${assetFileRequests.length}.`);
  }

  const messageDeletion = await verifyMessageDeletion(page, issues);
  const conversationPreview = await verifyConversationPreviewManagement(page, issues);
  const cleanup = await cleanupRunData(page, runTitle);
  const groupNameRestore = await restoreRenamedGroupName();

  const result = {
    baseUrl,
    output_dir: outputDir,
    fixture,
    chosen_assets: chosenAssets,
    title: runTitle,
    messages_before_reload: beforeReload.messageCount,
    message_deletion: messageDeletion,
    cleanup,
    group_name_restore: groupNameRestore,
    messages_after_reload: afterReload.messageCount,
    contact_count: afterReload.contactCount,
    group_speaker_option_count: afterReload.speakerOptionCount,
    asset_file_request_count: assetFileRequests.length,
    direct_message_speaker: directSpeakerName,
    group_ui: groupUi,
    group_manager: groupManager,
    bubble_themes: bubbleThemes,
    continuous_bubble_tails: continuousBubbleTails,
    editor_contact_tab: editorContactTab,
    conversation_preview: conversationPreview,
    static_image_composer: staticImageComposer,
    group_export: groupExport,
    conversation_isolation: conversationIsolation,
    avatar_centering: avatarCentering,
    header_and_bubble_alignment: headerAndBubbleAlignment,
    desktop_shell: desktopShell,
    counts: afterReload.counts,
    scroll_widths: afterReload.scrollWidths,
    desktop_layout: desktopLayout,
    mobile_layout: mobileLayout,
    issues,
    screenshots: [
      path.join(outputDir, "desktop-editor.png"),
      path.join(outputDir, "desktop-phone.png"),
      path.join(outputDir, "mobile-editor.png"),
      path.join(outputDir, "mobile-phone.png"),
      exportPath,
    ],
  };

  stage("finish");
  await browser.close();
  console.log(JSON.stringify(result, null, 2));
  if (issues.length) throw new Error(issues.join("\n"));
}

async function pickFirstAsset(page, buttonSelector, index = 0) {
  await page.click(buttonSelector);
  await page.waitForSelector("#assetModal:not(.hidden) .asset-card");
  await page.waitForTimeout(120);
  const card = page.locator("#assetGrid .asset-card").nth(index);
  const assetId = await card.getAttribute("data-asset-id");
  await card.click();
  await page.waitForSelector("#assetModal", { state: "hidden" });
  await page.waitForTimeout(80);
  return assetId;
}

async function addMessage(page, type, side, text = "", option = "") {
  await page.click("#addMessageButton");
  await page.waitForSelector("#messageTypeSelect");
  await page.selectOption("#messageTypeSelect", type);
  await page.waitForTimeout(80);
  if (type === "text") {
    await page.selectOption("#messageSideSelect", side === "right" ? "right" : "left");
    await page.fill("#messageTextInput", text);
  } else if (type === "sticker") {
    stage("sticker: open modal");
    await page.selectOption("#messageSideSelect", side === "right" ? "right" : "left");
    await page.click("#messageAssetButton");
    await page.waitForSelector("#assetModal:not(.hidden) .category-card");
    await page.waitForTimeout(120);
    stage("sticker: choose category");
    await page.locator("#assetGrid .category-card").first().click();
    await page.waitForSelector("#assetModal:not(.hidden) .sticker-card");
    await page.waitForTimeout(120);
    const card = page.locator("#assetGrid .sticker-card").first();
    const assetId = await card.getAttribute("data-asset-id");
    stage("sticker: choose asset");
    await card.click();
    await page.waitForSelector("#assetModal", { state: "hidden" });
    stage("sticker: closed");
    return assetId;
  } else if (type === "system" || type === "recall") {
    await page.fill("#messageTextInput", text);
  }
  return null;
}

// 验证消息删除和保存后的持久化。
async function verifyMessageDeletion(page, issues) {
  stage("message deletion");
  const items = page.locator(".message-list-item");
  const before = await items.count();
  if (before < 2) {
    issues.push(`Message deletion needs at least two messages, got ${before}.`);
    return { before, after: before, deleted: false };
  }
  const target = items.nth(1);
  const messageId = await target.getAttribute("data-message-id");
  if (!messageId) {
    issues.push("Message deletion target did not expose a message id.");
    return { before, after: before, deleted: false };
  }
  page.once("dialog", (dialog) => dialog.accept());
  await target.locator('[data-action="delete"]').click();
  await page.waitForFunction(
    (expected) => document.querySelectorAll(".message-list-item").length === expected,
    before - 1,
  );
  const remainingIds = await page.locator(".message-list-item").evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-message-id") || ""),
  );
  if (remainingIds.includes(messageId)) {
    issues.push(`Deleted message ${messageId} is still present in the editor.`);
  }
  await page.click("#saveButton");
  await page.waitForFunction(() => document.querySelector("#saveState")?.textContent === "已保存");
  const persisted = await page.evaluate(async (id) => {
    const projectId = localStorage.getItem("mimirtalk_webui.last_project_id");
    if (!projectId) return null;
    return fetch(`/api/projects/${encodeURIComponent(projectId)}`).then((response) => response.json());
  }, messageId);
  const persistedMessages = persisted
    ? Object.values(persisted.conversations || {}).flat()
    : [];
  if (persistedMessages.some((message) => message.id === messageId)) {
    issues.push(`Deleted message ${messageId} was restored after save/reload.`);
  }
  return { before, after: remainingIds.length, deleted: !remainingIds.includes(messageId) };
}

// 清理本轮 UI 回归创建的项目和上传文件。
async function cleanupRunData(page, title) {
  const list = await fetch(`${baseUrl}/api/projects`).then((response) => response.json());
  const targets = (list.items || []).filter((item) => item.title === title);
  const deletedProjects = [];
  const deletedUploads = [];
  for (const target of targets) {
    const project = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(target.id)}`).then(
      (response) => response.json(),
    );
    const fileIds = [
      ...new Set(
        Object.values(project.conversations || {})
          .flat()
          .filter((message) => message.type === "image" && message.file_id)
          .map((message) => message.file_id),
      ),
    ];
    const deleted = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(target.id)}`, {
      method: "DELETE",
    }).then((response) => response.json());
    if (deleted.deleted) deletedProjects.push(target.id);
    for (const fileId of fileIds) {
      const removed = await fetch(`${baseUrl}/api/uploads/${encodeURIComponent(fileId)}`, {
        method: "DELETE",
      }).then((response) => response.json());
      if (removed.deleted) deletedUploads.push(fileId);
    }
  }
  return { deletedProjects, deletedUploads };
}

// 本次运行中通过编辑栏改名过的内置群，跑后自动还原，避免污染真实数据。
const groupRenameRestore = { id: null, name: null };

async function restoreRenamedGroupName() {
  if (groupRenameRestore.id === null) return null;
  const { id, name } = groupRenameRestore;
  groupRenameRestore.id = null;
  groupRenameRestore.name = null;
  const response = await fetch(`${baseUrl}/api/groups/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    throw new Error(`Failed to restore group name for ${id}: ${response.status}`);
  }
  return response.json();
}

// 收集页面状态和布局数据，供回归断言使用。
async function collectState(page) {
  return page.evaluate(() => {
    const textOverflow = (selector) =>
      [...document.querySelectorAll(selector)].map((node) => {
        const style = window.getComputedStyle(node);
        return {
          selector,
          text: node.textContent || node.getAttribute("aria-label") || "",
          clientWidth: node.clientWidth,
          scrollWidth: node.scrollWidth,
          textOverflow: style.textOverflow,
          overflow: style.overflow,
          whiteSpace: style.whiteSpace,
        };
      });
    const maxScrollWidth = (selector) =>
      [...document.querySelectorAll(selector)].reduce(
        (max, node) => Math.max(max, node.scrollWidth - node.clientWidth),
        0,
      );
    return {
      title: document.querySelector("#previewTitle")?.textContent || "",
      contactName: document.querySelector("#previewContactName")?.textContent || "",
      contactNameTitle: document.querySelector("#previewContactName")?.getAttribute("title") || "",
      messageCount: document.querySelectorAll(".message-list-item").length,
      previewText: document.querySelector("#chatScroll")?.textContent || "",
      contactCount: document.querySelectorAll("#contactList [data-contact-id]").length,
      speakerOptionCount: document.querySelectorAll("#speakerPicker option").length,
      speakerRows: [...document.querySelectorAll("#chatScroll .chat-row[data-speaker-name]")].map((node) => ({
        id: node.getAttribute("data-speaker-id") || "",
        name: node.getAttribute("data-speaker-name") || "",
        assetId: node.getAttribute("data-speaker-asset-id") || "",
      })),
      counts: {
        rows: document.querySelectorAll("#chatScroll .chat-row").length,
        avatars: document.querySelectorAll("#chatScroll .message-avatar").length,
        stacks: document.querySelectorAll("#chatScroll .message-stack").length,
        stickerFrames: document.querySelectorAll("#chatScroll .sticker-frame").length,
        stickerImages: document.querySelectorAll("#chatScroll .sticker-frame img.chat-sticker").length,
        imageImages: document.querySelectorAll("#chatScroll .image-row img.chat-image").length,
        systemRows: document.querySelectorAll("#chatScroll .system-row").length,
        recallRows: document.querySelectorAll("#chatScroll .recall").length,
        readRows: document.querySelectorAll("#chatScroll .read-row").length,
      },
      scrollWidths: {
        list: maxScrollWidth(".message-list"),
        preview: maxScrollWidth("#chatScroll"),
        bubbles: maxScrollWidth(".bubble"),
        system: maxScrollWidth(".system-line"),
      },
      textOverflow: [
        ...textOverflow(".contact-name"),
        ...textOverflow(".project-copy strong"),
        ...textOverflow(".message-summary strong"),
        ...textOverflow(".message-summary small"),
      ],
      frameSizes: [...document.querySelectorAll(".sticker-frame")].map((node) => ({
        className: node.className,
        width: Math.round(node.getBoundingClientRect().width),
        height: Math.round(node.getBoundingClientRect().height),
      })),
    };
  });
}

function validateState(state, label, issues) {
  if (state.contactName !== LONG_CONTACT_NAME) issues.push(`${label}: contact name was not applied.`);
  if (state.contactNameTitle !== LONG_CONTACT_NAME) issues.push(`${label}: contact name title is missing.`);
  const expected = {
    rows: 8,
    avatars: 6,
    stacks: 6,
    stickerFrames: 1,
    stickerImages: 1,
    imageImages: 1,
    systemRows: 2,
    recallRows: 1,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (state.counts[key] !== value) issues.push(`${label}: expected ${key}=${value}, got ${state.counts[key]}.`);
  }
  if (state.scrollWidths.preview > 1) issues.push(`${label}: preview has horizontal scroll overflow (${state.scrollWidths.preview}px).`);
  for (const item of state.textOverflow) {
    const clipsWithEllipsis =
      item.selector.includes("small") ||
      item.textOverflow === "ellipsis" ||
      (item.overflow === "hidden" && item.whiteSpace === "nowrap");
    if (item.scrollWidth > item.clientWidth + 1 && !clipsWithEllipsis) {
      issues.push(`${label}: ${item.selector} overflows without an ellipsis: ${item.scrollWidth} > ${item.clientWidth}.`);
    }
  }
  for (const frame of state.frameSizes) {
    if (frame.width <= 0 || frame.height <= 0) issues.push(`${label}: ${frame.className} has a non-positive size.`);
  }
}

async function collectLayout(page, issues, label) {
  const layout = await page.evaluate(() => {
    const rect = (node) => {
      const box = node.getBoundingClientRect();
      return {
        left: Math.round(box.left),
        right: Math.round(box.right),
        top: Math.round(box.top),
        bottom: Math.round(box.bottom),
        width: Math.round(box.width),
        height: Math.round(box.height),
      };
    };
    const bySelector = (selector) =>
      [...document.querySelectorAll(selector)].map((node) => ({
        className: node.className,
        box: rect(node),
      }));
    const inside = (child, parent) =>
      child.left >= parent.left - 2 &&
      child.right <= parent.right + 2 &&
      child.top >= parent.top - 2 &&
      child.bottom <= parent.bottom + 2;
    const intersects = (a, b) =>
      a.left < b.right - 1 &&
      a.right > b.left + 1 &&
      a.top < b.bottom - 1 &&
      a.bottom > b.top + 1;
    const rows = bySelector("#chatScroll .chat-row");
    const overlaps = [];
    for (let index = 0; index < rows.length; index += 1) {
      for (let next = index + 1; next < rows.length; next += 1) {
        if (intersects(rows[index].box, rows[next].box)) {
          overlaps.push(`${rows[index].className} overlaps ${rows[next].className}`);
        }
      }
    }
    const previewBox = document.querySelector(".phone-preview")
      ? rect(document.querySelector(".phone-preview"))
      : null;
    const chatBox = document.querySelector("#chatScroll")
      ? rect(document.querySelector("#chatScroll"))
      : null;
    const rawBox = (node) => {
      const box = node.getBoundingClientRect();
      return {
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      };
    };
    const panelNode = document.querySelector(".momotalk-panel");
    const panelBox = panelNode ? rawBox(panelNode) : null;
    const designScale = panelBox ? panelBox.width / 1680 : null;
    const designRect = (selector) => {
      const node = document.querySelector(selector);
      if (!node || !panelBox || !designScale) return null;
      const box = rawBox(node);
      return {
        left: (box.left - panelBox.left) / designScale,
        top: (box.top - panelBox.top) / designScale,
        width: box.width / designScale,
        height: box.height / designScale,
      };
    };
    const relativeDesignRect = (childSelector, parentSelector) => {
      const child = document.querySelector(childSelector);
      const parent = document.querySelector(parentSelector);
      if (!child || !parent || !designScale) return null;
      const childBox = rawBox(child);
      const parentBox = rawBox(parent);
      return {
        left: (childBox.left - parentBox.left) / designScale,
        top: (childBox.top - parentBox.top) / designScale,
        width: childBox.width / designScale,
        height: childBox.height / designScale,
      };
    };
    const preview = document.querySelector(".phone-preview")?.getBoundingClientRect();
    const viewport = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    const items = {
      rows,
      bubbles: bySelector("#chatScroll .bubble"),
      avatars: bySelector("#chatScroll .message-avatar"),
      stickers: bySelector("#chatScroll .sticker-frame"),
      systems: bySelector("#chatScroll .system-line"),
    };
    const overflow = [];
    if (previewBox) {
      for (const [name, nodes] of Object.entries(items)) {
        for (const node of nodes) {
          if (!node.box || node.box.width <= 0 || node.box.height <= 0) continue;
          const margin = name === "rows" ? 160 : 80;
          const horizontallyInside =
            node.box.left >= previewBox.left - margin &&
            node.box.right <= previewBox.right + margin;
          // 手机预览是缩放后的 Unity 画布。
          // 在 390px 移动视口下，图标线条和头像低于 20 CSS 像素属于正常情况。
          const hasRenderableSize = node.box.width >= 8 && node.box.height >= 6;
          if (!horizontallyInside || !hasRenderableSize) {
            overflow.push(`${name} outside preview: ${JSON.stringify(node.box)}`);
            break;
          }
        }
      }
    }
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      preview: previewBox,
      chat: chatBox,
      rows,
      overlaps,
      overflow,
      design: {
        sideList: designRect(".side-list"),
        chat: designRect(".momotalk-chat"),
        header: designRect(".chat-header"),
        chatScroll: designRect(".chat-scroll"),
        sideEntryAvatar: relativeDesignRect(".side-entry-avatar", ".side-entry"),
        sideEntryName: relativeDesignRect(".side-entry-text strong", ".side-entry"),
        sideEntryMessage: relativeDesignRect(".side-entry-text small", ".side-entry"),
        messageAvatar: relativeDesignRect(".message-avatar", ".chat-row"),
      },
      insideViewport: items.rows.every((row) => inside(row.box, viewport)),
    };
  });

  if (layout.documentWidth > layout.viewport.width + 2) {
    issues.push(`${label}: horizontal document overflow ${layout.documentWidth} > ${layout.viewport.width}.`);
  }
  for (const box of [layout.preview, layout.chat]) {
    if (!box || box.width <= 0 || box.height <= 0) issues.push(`${label}: preview/chat has a non-positive size.`);
  }
  if (layout.preview && layout.preview.height > layout.viewport.height + 2) {
    issues.push(`${label}: phone preview exceeds viewport height.`);
  }
  if (layout.preview) {
    const previewRatio = layout.preview.width / layout.preview.height;
    const expectedRatio = 1680 / 906;
    if (Math.abs(previewRatio - expectedRatio) > 0.01) {
      issues.push(
        `${label}: phone preview aspect ratio ${previewRatio.toFixed(3)} does not match ${expectedRatio.toFixed(3)}.`,
      );
    }
  }
  const designTargets = {
    sideList: { left: 112, top: 29, width: 640, height: 836.43 },
    chat: { left: 719, top: 12, width: 956, height: 880 },
    header: { left: 742, top: 37.245, width: 908, height: 80 },
    chatScroll: { left: 752, top: 117.01, width: 877.783, height: 664.8 },
    sideEntryAvatar: { left: 43.88, top: 15.88, width: 114.24, height: 114.24 },
    sideEntryName: { left: 178, top: 17.28, width: 352.638, height: 45.44 },
    sideEntryMessage: { left: 178, top: 74, width: 352.638, height: 45.44 },
  };
  const designTolerance = label === "mobile" ? 6 : 2.5;
  for (const [name, expected] of Object.entries(designTargets)) {
    const actual = layout.design?.[name];
    if (!actual) {
      issues.push(`${label}: missing game-layout rect for ${name}.`);
      continue;
    }
    for (const dimension of ["left", "top", "width", "height"]) {
      const delta = Math.abs(actual[dimension] - expected[dimension]);
      if (delta > designTolerance) {
        issues.push(
          `${label}: ${name}.${dimension} is ${actual[dimension].toFixed(1)} design px, expected ${expected[dimension]} (±${designTolerance}).`,
        );
      }
    }
  }
  const messageAvatar = layout.design?.messageAvatar;
  if (!messageAvatar) {
    issues.push(`${label}: missing game-layout rect for messageAvatar.`);
  } else if (
    Math.abs(messageAvatar.width - 112) > designTolerance ||
    Math.abs(messageAvatar.height - 112) > designTolerance
  ) {
    issues.push(
      `${label}: messageAvatar is ${messageAvatar.width.toFixed(1)}x${messageAvatar.height.toFixed(1)} design px, expected 112x112 (±${designTolerance}).`,
    );
  }
  if (layout.overlaps.length) issues.push(`${label}: overlapping rows: ${layout.overlaps.join("; ")}`);
  if (layout.overflow.length) issues.push(`${label}: content outside preview: ${layout.overflow.slice(0, 8).join("; ")}`);
  return layout;
}

main().catch(async (error) => {
  // 断言失败或异常中断时也要把改名的内置群还原，避免污染真实数据。
  try {
    await restoreRenamedGroupName();
  } catch (restoreError) {
    console.error(restoreError.stack || restoreError.message);
  }
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

