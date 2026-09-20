# MimirTalk WebUI

编辑栏 UI 与功能需求记录：`mimirtalk_webui/EDITOR_REQUIREMENTS.md`。

Local MomoTalk / Mimir channel preview and export generator for AetherGazer.

## Phase 0

1. Extract the shared avatar pools:

```powershell
C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe `
  mimirtalk_webui\tools\extract_shared_heads.py
```

2. Build the deduplicated asset index:

```powershell
C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe `
  mimirtalk_webui\tools\build_asset_index.py
```

Outputs:

- `extract/aethergazer_momotalk_shared_heads/`
- `mimirtalk_webui/assets/avatars/` - project-local curated avatars, including
  the story portraits for 奥丁, 宁希达, and 望舒
- `tools/extract_aethergazer_fonts.py` extracts the game UI fonts
- `frontend/assets/fonts/noto-serif-sc-vf.ttf` is used for speaker names because
  the extracted Source Han Serif game subset omits common Chinese glyphs and
  would otherwise cause per-character fallback rendering
- `mimirtalk_webui/data/asset_index.json`
- `mimirtalk_webui/data/stage0_report.md`

## Phase 0.5 - Contact and avatar name map

Build the editable contact roster and general avatar name map:

```powershell
C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe `
  mimirtalk_webui\tools\build_contact_map.py
```

Outputs:

- `mimirtalk_webui/data/chat_contacts.json` - 79 selectable chat contacts (69 heroes, 10 system/group)
- `mimirtalk_webui/data/asset_names.json` - general avatar pool keyed by asset id
- `mimirtalk_webui/data/contact_map_report.md` - human readable mapping report
- `mimirtalk_webui/data/group_members.json` - local member mapping for built-in group contacts
- `mimirtalk_webui/data/custom_groups.json` - groups created from the WebUI

`chat_contacts.json` is the file to edit when adding a new selectable chat role.
Copy one record, fill `name` and `game_icon_path`, point `asset_id` at an id from
`asset_index.json`, or set `asset_id` to `null` when no avatar exists yet. New
avatar PNGs do not need to be pre-cropped: the WebUI and PNG export both crop
all avatar artwork to the MomoTalk avatar hole and hide the frame texture. The
Playwright check validates every rendered contact-list avatar, the header
avatar, message avatars, and export avatar with the same crop constants.

Validate the mapping files:

```powershell
C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe `
  mimirtalk_webui\tools\check_contact_map.py
```

Notes:

- `101701` is a variant of base id `1017`, not an avatar for `10170` (望舒).
- 望舒(`10170`), 奥丁(`1029`), 宁希达(`10066`) now use project-local story
  portraits copied into `mimirtalk_webui/assets/avatars/`.
- The general pool keeps the numeric asset id as the key when a name is unknown.

## Phase 1

The version 1 project format is documented by:

- `mimirtalk_webui/schema/project.schema.json`
- `mimirtalk_webui/examples/project-v1.json`

Validate project loading, migration, and save/reopen behavior:

```powershell
C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe `
  mimirtalk_webui\tools\check_project_store.py
```

## Phase 2

Run the local API:

```powershell
C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe `
  mimirtalk_webui\backend\app.py --host 127.0.0.1 --port 8765
```

Validate the API:

```powershell
C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe `
  mimirtalk_webui\tools\check_backend.py
```

Open the local editor at:

```text
http://127.0.0.1:8765/
```

## Phase 3

The editor is served by the same local service:

- `GET /` serves `frontend/index.html`
- `GET /src/app.js` serves the editor logic
- `GET /src/styles.css` serves the layout and preview styles
- `GET /assets/*` serves extracted static assets, including the game UI fonts

Validate the editor shell and API integration:

```powershell
C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe `
  mimirtalk_webui\tools\check_frontend.py
```

## Phase 4 - Chat stickers and pending checks

Build the official sticker catalog from the extracted Lua config:

```powershell
C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe `
  mimirtalk_webui\tools\extract_sticker_config.py
C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe `
  mimirtalk_webui\tools\build_sticker_categories.py
```

The editor loads sticker categories through `/api/sticker-categories`, then loads
one category page at a time through
`/api/sticker-categories/{category_id}/stickers?offset=&limit=`. Sticker names
and IDs are intentionally not shown in the picker.

Run the API and editor checks:

```powershell
C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe `
  mimirtalk_webui\tools\check_backend.py
C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe `
  mimirtalk_webui\tools\check_frontend.py
```

UI validation uses Playwright against a running local server. If Playwright is
not installed in the current project, point `NODE_PATH` at an existing local
Playwright installation:

```powershell
$env:MOMOTALK_URL = "http://127.0.0.1:8765"
$env:MOMOTALK_OUTPUT = "output/stage4"
$env:NODE_PATH = "C:\path\to\node_modules"
node mimirtalk_webui\tools\check_ui_playwright.js
```

`check_ui_playwright.js` validates the group dialog without writing data by
default. Set `MOMOTALK_GROUP_MUTATION=1` only when the server is using a
temporary `custom_groups.json`; the full path creates a group through the UI and
then verifies the contact list, speaker picker, and export avatar behavior.

Pending checks and reminders:

- Sticker selection is static-only. Dynamic sticker records and frame assets are
  excluded from `sticker_categories.json` and the sticker API; the full
  `asset_index.json` may still contain those frames for reference.
- Missing extracted assets in general are not validated yet. Collect every gap
  (static sticker groups, avatars, backgrounds, and MomoTalk image assets used
  for avatars) and fill them last.
- Single-image export covers the most recent 20 exportable messages. Measured
  layout heights at the 956px export width: 20 normal text messages = 5958px
  (2x = 11916px, fits), 20 long text messages = 26838px (falls back to 1x, fits),
  20 messages at the 2000-character max = 104268px (exceeds the 30000px cap at
  1x, export is blocked with a toast). The practical per-message budget before
  the cap is roughly 1500px of rendered height.
- Empty chat messages must show a centered modal prompt: input cannot be empty.
- Export format is PNG only, including long-image export. Other formats are out
  of scope.
- Export content rules: system prompts and recall notices are included in the
  PNG export as centered text rows. Choice messages are no longer supported.
- Static `image` messages are supported from the composer. Only PNG/JPG/JPEG
  files up to 8 MiB are accepted and uploaded to `data/uploads`; GIF and other
  formats are rejected with a system toast. `moment` remains out of scope and is
  dropped when old project JSON files are loaded and saved.
- The bottom-left power key in the phone UI asks for confirmation, then calls
  `POST /api/shutdown` to stop the local WebUI service and shows a "WebUI 已关闭"
  notice. `check_backend.py` covers the endpoint; the Playwright check covers the
  confirm/cancel dialog without stopping the shared dev server.
- "非法路径" (illegal asset paths) means any of: a path that resolves outside
  the workspace root (`..` or absolute paths), a path outside the allowed
  asset root, a non-`.png` file, or a file that does not exist on disk. These
  are rejected by `AssetIndex.asset_path`; missing-but-valid paths are still
  rendered as placeholders and are not blocked yet.

## 2026-09-19 Work Log

### Completed

- Finished the local MomoTalk / Mimir WebUI editing flow: shared avatar
  extraction, asset indexing, editable contact mapping, project schema,
  project save/reopen, local API, editor shell, live preview, and export.
- Built the selectable chat roster from `chat_contacts.json`: 79 contacts total
  (69 heroes and 10 system/group entries); the current editor also includes
  the administrator and any custom groups.
- Added administrator chat support:
  - Administrator name is fixed as `管理员`.
  - Administrator messages appear on the right side of the chat UI.
  - Administrator avatar can switch among `_head_01` through `_head_07`.
- Added speaker-aware output for generated chat records, including group-chat
  records where each message must show who is speaking.
- Added the bottom text input flow:
  - The input UI uses the leftmost phone base layout and stays within the
    existing boundary.
  - Empty input shows a centered modal prompt: `输入不能为空`.
  - The UI reserves space for the screenshot-save action.
- Added PNG-only screenshot export:
  - Single export covers the most recent 20 exportable messages.
  - Export prefers 2x scale, falls back to 1x over the 30000px cap, and blocks
    export with a toast if even 1x exceeds the cap.
  - Measured at 956px export width: 20 normal text messages render at 5958px
    (2x fits), 20 long text messages render at 26838px (1x fits), and 20
    messages at the 2000-character maximum render at 104268px (blocked).
- Added the MomoTalk_04 chat background:
  - New projects default to
    `backgrounds:texturebg_momotalk_momotalk_04:Momotalk_04`.
  - The background is applied to the chat panel rather than the full phone
    preview, and the preview/export use the same cover-cropping behavior.
  - Existing projects can still override it from the background picker.
- Updated preview and export layout:
  - The chat header renders only the centered contact name; no avatar is shown
    in the web preview or PNG export.
  - Message and export avatars use the current 956px export layout's `76px`
    size, not the full game message-avatar size.
  - Left and right text bubbles keep every wrapped line on the same left text
    edge while remaining vertically centered; preview and Canvas export share
    the same horizontal inset.
  - Long text bubbles may expand across the avatar-to-avatar message lane but
    never overlap either avatar.
  - Speaker labels share the bubble text inset and remain aligned to the message
    panel instead of drifting onto the avatar.
  - The chat scroll area keeps a bottom background reserve so the latest message
    does not visually collide with the composer.
  - The composer sticker button uses an inline SVG smile icon instead of the
    game's square plus asset.
  - Avatar artwork fills the transparent inner hole of the game avatar frame;
    the `Momotalk_26` frame texture is not drawn in preview or PNG export.
- Added project-local avatars for 奥丁 `1029`, 宁希达 `10066`, and 望舒
  `10170`, copied from `story_character0917/comsingle` and indexed as
  `character_itemshead:story_comsingle:<id>`.
- Added sticker selection:
  - Categories are loaded from the official extracted sticker catalog.
  - Pages load one category at a time through the sticker API.
  - Sticker names and IDs are intentionally hidden in the picker.
  - Only static stickers are selectable. Dynamic sticker records and frame
    assets stay out of the picker and API results.
  - Regression requests are around 247 asset files, avoiding the old
    727/1400+ one-shot request behavior.
- Added WebUI group management:
  - New groups are created only from the `新建群组` entry at the top of the
    contact list.
  - The toolbar button `群聊管理` selects any built-in or custom group, then
    allows adding or removing members and saving the result.
  - Groups can be deleted from the management dialog with a two-step
    confirmation. Built-in deletion is persisted as a tombstone in
    `group_members.json`; custom groups are removed from `custom_groups.json`.
  - Custom group IDs start at `9200` and use the smallest unused ID at or above
    that value. `9200` was verified as unused before implementation.
  - A group requires at least two members. Selecting fewer shows
    `至少选择两名成员`.
  - Group avatar layouts are: 1 member single image, 2 members left/right,
    3 members two stacked on the left plus one in the top-right cell, and
    4 members a 2x2 grid. More than four members use the first Chinese character
    in the group name; names without Chinese use `群`.
  - Built-in group members come from `group_members.json` because the official
    extraction does not provide a reliable group-member configuration source.
  - When a built-in group has no member mapping yet, its contact avatar uses the
    extracted `TextureConfig/Momotalk/<group id>` image. Text is only the final
    fallback when neither members nor a group avatar asset are available.
  - The contact list, speaker picker, group preview, and PNG export all use the
    same group-member mapping and avatar-layout rules.
- Added static image messages and removed `moment` from scope:
  - Message types are `text`, `sticker`, `image`, `system`, and `recall`.
  - The composer image button accepts only PNG/JPG/JPEG static files and stores
    them under `data/uploads`; the preview and PNG export render the same image.
  - Invalid formats and files larger than 8 MiB show an error toast.
  - Image messages render without a speaker label or added frame/background; the
    preview and export use aspect-fit bounds so large images cannot disrupt
    following text rows.
  - Legacy `moment` and `choice` records are dropped when old projects load.
  - Removed the unused `delay_ms` field from the editor, schema, and saved
    project JSON.
  - The chat background picker only exposes `Momotalk_03` and `Momotalk_04`;
    other background IDs normalize to `Momotalk_04`.
- Changed the bottom-left power key into a WebUI shutdown control:
  - It asks `确定关闭 WebUI 吗？`.
  - Confirm calls `POST /api/shutdown`; cancel, close, overlay click, and
    `Escape` cancel the dialog.
  - After shutdown the UI shows `WebUI 已关闭`.
- Continued reproducing the in-game Mimir communication UI from the provided
  screenshot, including the phone layout, contact/sidebar structure, chat
  bubbles, administrator placement, and sticker panel.

### Rules And Decisions

- Missing assets do not block selection or rendering for now; they use
  placeholders and will be filled during the final asset pass.
- Export format is PNG only, including long-image export.
- System prompts stay in exported content. Choice cards and recall notices stay
  in project files but are excluded from export.
- Dynamic stickers are not part of the input or output scope. Only static
  sticker PNG assets are offered by the picker and drawn into the PNG export.
- `moment` is removed from the implementation scope. `image` is a supported
  message type, but only PNG/JPG/JPEG static uploads are accepted.
- `chat_contacts.json` is the editable entry point for future selectable roles;
  `speaker_id` must stay an integer or `null`.
- `group_members.json` stores built-in group membership and deleted built-in
  group IDs; `custom_groups.json` stores user-created groups and their members.
  It starts assigning IDs from `9200`.
- Built-in and custom groups share the same member-management flow. Group name
  editing remains out of scope; membership and deletion are supported.
- Illegal asset paths are: paths outside the workspace root, paths outside the
  allowed asset root, non-`.png` files, or files that do not exist. Missing but
  valid paths are not treated as illegal yet.
- The old service on `127.0.0.1:8765` was left untouched. The current debug
  service is `127.0.0.1:8768`.

### Validation Used

- Python compile checks for backend and tool scripts.
- Node syntax checks for frontend logic and Playwright checks.
- `check_backend.py` for API routes, including shutdown.
- `check_frontend.py` for editor shell/API integration.
- Playwright UI checks for speaker choices, modal behavior, export flow,
  sticker loading, administrator display, default MomoTalk_04 background,
  avatar fill, and shutdown confirmation.
- Backend health check on the current debug service returned `200`.

### Pending Asset And Cleanup Work

- Static sticker assets are complete under the current catalog; dynamic sticker
  groups are intentionally excluded rather than reported as missing.
- The extracted general avatar gaps for 望舒 `10170`, 奥丁 `1029`, and
  宁希达 `10066` are covered by the project-local story portraits.
- Collect all remaining missing asset gaps across stickers, avatars,
  backgrounds, and MomoTalk images, then fill them together at the end.
- Keep missing-but-valid paths separate from illegal paths in the final asset
  validation report.
- Confirm final handling for 20 extra-long text messages that exceed the PNG
  height cap; current behavior is to block export and show a toast.

## Group Chat Management Contract

Confirmed for the implemented WebUI flow:

- `新建群组` only appears at the top of the contact list and remains the sole
  entry point for creating a group.
- The toolbar action `群聊管理` edits built-in or custom group membership and
  can delete either kind of group after confirmation.
- New groups exist so a user can generate chat history for additional
  conversable roles; existing project history is not automatically deleted when
  a group definition is removed.
- Custom IDs start at `9200` and increment to the next unused value.
- Avatar rules:
  - 1 member: single avatar.
  - 2 members: left and right, each full height.
  - 3 members: two stacked on the left and one in the top-right cell,
    matching the left tile size instead of filling the right column.
  - 4 members: 2x2 grid.
  - More than 4 members: first Chinese character of the group name, or `群`
    when the name has no Chinese character.
- A group needs at least two members.
- Built-in group membership uses the local `group_members.json` mapping until a
  reliable official source is available.
