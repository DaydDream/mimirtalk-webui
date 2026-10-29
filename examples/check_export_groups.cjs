// A small example against the real planner, with a lightweight layout stand-in.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../webui/frontend/src/app.js'), 'utf8').replace(/\r\n/g, '\n');
function readFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Missing ${name}`);
  return source.slice(start, source.indexOf('\n}\n', start) + 2);
}
const context = vm.createContext({
  PNG_EXPORT_MESSAGES_PER_IMAGE: 20, PNG_EXPORT_MAX_HEIGHT: 30000, PNG_EXPORT_SCALE: 2,
  isBlankTextMessage: message => message.type === 'text' && !String(message.text || '').trim(),
  buildChatExportLayout: (_ctx, _project, messages) => ({ width: 956, height: 200 + messages.length * 100, headerHeight: 80 }),
});
vm.runInContext(readFunction('exportableMessages') + '\n' + readFunction('planChatExportPages'), context);
for (const count of [0, 1, 19, 20, 21, 40, 41]) {
  context.project = { messages: Array.from({ length: count }, (_, id) => ({ id, type: 'text', text: String(id) })) };
  const groups = vm.runInContext('planChatExportPages({}, project)', context);
  assert.equal(groups.length, Math.ceil(count / 20));
  assert.deepEqual(Array.from(groups.flatMap(group => group.messages), message => message.id), Array.from({ length: count }, (_, id) => id));
}
console.log('PASS: complete, ordered message groups (0/1/19/20/21/40/41).');
