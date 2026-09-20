const fs = require("fs");

const files = {
  app: "mimirtalk_webui/frontend/src/app.js",
  css: "mimirtalk_webui/frontend/src/styles.css",
  html: "mimirtalk_webui/frontend/index.html",
  contacts: "mimirtalk_webui/data/chat_contacts.json",
  groups: "mimirtalk_webui/data/group_members.json",
  custom: "mimirtalk_webui/data/custom_groups.json",
  assets: "mimirtalk_webui/data/asset_index.json",
};

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function printMatches(label, text, needle, before = 500, after = 1400, limit = 20) {
  let index = 0;
  let count = 0;
  while (count < limit) {
    index = text.indexOf(needle, index);
    if (index === -1) break;
    console.log(`\n--- ${label} :: ${needle} @ ${index} ---`);
    console.log(text.slice(Math.max(0, index - before), Math.min(text.length, index + after)));
    index += needle.length;
    count += 1;
  }
  if (!count) {
    console.log(`\n--- ${label} :: ${needle} not found ---`);
  }
}

function printLines(label, text, predicate, limit = 400) {
  console.log(`\n--- ${label} lines ---`);
  const lines = text.split(/\r?\n/);
  let count = 0;
  lines.forEach((line, i) => {
    if (predicate(line, i)) {
      console.log(`${i + 1}: ${line}`);
      count += 1;
    }
  });
  if (!count) console.log("(none)");
}

function printRange(label, text, startLine, endLine) {
  console.log(`\n--- ${label} lines ${startLine}-${endLine} ---`);
  const lines = text.split(/\r?\n/);
  const start = Math.max(0, startLine - 1);
  const end = Math.min(lines.length, endLine);
  for (let i = start; i < end; i += 1) {
    console.log(`${i + 1}: ${lines[i]}`);
  }
}

const app = read(files.app);
const css = read(files.css);
const html = read(files.html);
const contacts = JSON.parse(read(files.contacts));
const groups = JSON.parse(read(files.groups));
const custom = JSON.parse(read(files.custom));
const assets = JSON.parse(read(files.assets));

const mode = process.argv[2] || "all";

if (mode === "all" || mode === "app") {
  printRange("app group avatar helpers", app, 280, 470);
  printRange("app contact list", app, 1000, 1165);
  printRange("app preview/avatar background", app, 1175, 1310);
  printRange("app group draft logic", app, 1640, 1800);
  printRange("app event binding", app, 2608, 2805);
}

if (mode === "all" || mode === "css") {
  printRange("css root and rail", css, 1, 60);
  printRange("css side cards", css, 380, 800);
  printRange("css chat and bubbles", css, 860, 1180);
  printRange("css group modal", css, 1650, 1910);
}

console.log("\n--- contacts duplicate names ---");
const byName = new Map();
for (const contact of contacts.contacts || []) {
  const list = byName.get(contact.name) || [];
  list.push(contact);
  byName.set(contact.name, list);
}
for (const [name, list] of byName) {
  if (list.length > 1) {
    console.log(name, list.map((item) => `${item.id}:${item.enabled}`).join(", "));
  }
}

if (mode === "all" || mode === "data") {
  console.log("\n--- custom group ids ---");
  console.log({ id_start: custom.id_start, ids: (custom.groups || []).map((group) => group.id) });

  console.log("\n--- group ids ---");
  console.log(Object.keys(groups.groups || {}));
}

if (mode === "all" || mode === "assets") {
  console.log("\n--- widget_system_chat and Momotalk assets ---");
  for (const asset of assets.assets || []) {
    const text = `${asset.identity || ""} ${asset.path || ""} ${asset.name || ""}`;
    if (/widget_system_chat|Momotalk_/i.test(text)) {
      console.log(
        [
          asset.id,
          asset.name,
          asset.width,
          asset.height,
          asset.kind,
          asset.path,
        ].join(" | "),
      );
    }
  }
}
