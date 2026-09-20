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

function stage(message) {
  if (process.env.MOMOTALK_QUIET !== "1") console.error(`[ui-check] ${message}`);
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
  const contacts = (await loadEnabledContacts(page)).filter((contact) => contact.kind !== "group");
  if (contacts.length < 2) {
    issues.push(`Expected at least two hero contacts for conversation isolation, got ${contacts.length}.`);
    return null;
  }

  const [firstContact, secondContact] = contacts;
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
    const invalid = themes.filter((theme) => {
      const left = theme.variants?.left?.slice;
      const right = theme.variants?.right?.slice;
      return !left || !right || [left, right].some((slice) => (
        Number(slice.top) <= 0
        || Number(slice.right) <= 0
        || Number(slice.bottom) <= 0
        || Number(slice.left) <= 0
      ));
    }).map((theme) => theme.id);
    const legacy = themes.find((theme) => String(theme.id) === "9016");
    return {
      count: themes.length,
      invalid,
      legacyLeft: legacy?.variants?.left?.slice || null,
      legacyRight: legacy?.variants?.right?.slice || null,
      names: Object.fromEntries(
        themes.map((theme) => [String(theme.id), theme.name || String(theme.id)]),
      ),
    };
  });
  if (sliceAudit.count !== 17) issues.push(`Expected 17 bubble slice records, got ${sliceAudit.count}.`);
  if (sliceAudit.invalid.length) issues.push(`Bubble themes with invalid slices: ${sliceAudit.invalid.join(", ")}.`);
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
  if (ids.length < 17) issues.push(`Expected at least 17 bubble themes, got ${ids.length}.`);
  if (missing.length) issues.push(`Single-image legacy bubble themes missing from picker: ${missing.join(", ")}.`);
  if (unexpectedDynamic.length) issues.push(`Dynamic component bubble themes must stay out of the picker: ${unexpectedDynamic.join(", ")}.`);
  return { count: ids.length, integrated: required, missing, excludedDynamic, unexpectedDynamic, fonts, sliceAudit, renderedSlice };
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

async function verifyGroupManager(page, issues, contacts) {
  stage("group manager");
  const topButtonText = (await page.locator("#newGroupButton").textContent() || "").trim();
  if (topButtonText !== "群聊管理") {
    issues.push(`Expected top toolbar action to be 群聊管理, got "${topButtonText}".`);
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
  if (state.activeMemberCount !== expectedMembers) {
    issues.push(
      `Group manager selected ${state.activeMemberCount} members, expected ${expectedMembers}.`,
    );
  }
  const activeMembers = page.locator("#groupMemberList .group-member-card.active");
  const beforeToggle = await activeMembers.count();
  if (beforeToggle > 0) {
    await activeMembers.first().click();
    const afterToggle = await page.locator("#groupMemberList .group-member-card.active").count();
    if (afterToggle !== beforeToggle - 1) {
      issues.push(`Removing a group member in the manager changed ${beforeToggle} to ${afterToggle}.`);
    }
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
  if (!shell.editorScroll || shell.editorScroll.scrollHeight <= shell.editorScroll.clientHeight) {
    issues.push(`Desktop editor should scroll independently for long content: ${JSON.stringify(shell)}.`);
  }
  if (!["auto", "scroll"].includes(shell.editorScroll?.overflowY || "")) {
    issues.push(`Desktop editor should use independent vertical scrolling: ${JSON.stringify(shell)}.`);
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
  const groupUi = await verifyGroupModal(page, issues, enabledContacts);
  const groupManager = await verifyGroupManager(page, issues, enabledContacts);
  const groupExport = await verifyGroupExportMosaic(page, issues);
  const conversationIsolation = await verifyConversationIsolation(page, issues);
  if (ALLOW_GROUP_MUTATION) {
    enabledContacts = await loadEnabledContacts(page);
  }
  const expectedContactCount = enabledContacts.length;
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
  if (contactCount !== expectedContactCount) {
    issues.push(`Expected ${expectedContactCount} enabled contacts, got ${contactCount}.`);
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
  if (renderedContactAvatarCount !== expectedContactCount) {
    issues.push(
      `Expected every contact row to use the cropped avatar frame, got ${renderedContactAvatarCount}/${expectedContactCount}.`,
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
  const cleanup = await cleanupRunData(page, runTitle);

  const result = {
    baseUrl,
    output_dir: outputDir,
    fixture,
    chosen_assets: chosenAssets,
    title: runTitle,
    messages_before_reload: beforeReload.messageCount,
    message_deletion: messageDeletion,
    cleanup,
    messages_after_reload: afterReload.messageCount,
    contact_count: afterReload.contactCount,
    group_speaker_option_count: afterReload.speakerOptionCount,
    asset_file_request_count: assetFileRequests.length,
    direct_message_speaker: directSpeakerName,
    group_ui: groupUi,
    group_manager: groupManager,
    bubble_themes: bubbleThemes,
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

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

