# 深空之眼气泡资源解包审计

日期：2026-09-20
游戏版本：`v5.3.0`，build `313`

## 结论

- `ChatBubbleCfg.lua` 共记录 22 条气泡定义。
- 当前游戏 `AssetHash_Info.bytes` 中仅有 15 组完整 `TextureConfig/ChatBubble` 资源，共 30 张左右变体。
- 从 `widget/system/chat.ys` 额外恢复 5 组旧版气泡：`9016`、`9017`、`9019`、`9021`、`9022`。
- `9016`、`9017` 的主体底图是完整 sliced 单图，继续纳入 WebUI；UI 树中另有羽饰/动画子节点。
- `9019`、`9021`、`9022` 依赖运行时动态 UI 组件、Animator 和粒子/特效状态，静态 Sprite 烘焙无法忠实还原。经确认后不纳入 WebUI，也不生成派生单图。
- 项目可选气泡最终为 17 组：原有 15 组加 `9016`、`9017`。
- `9006`、`9009`、`9012`、`9101` 在当前游戏包中没有对应气泡图，无法可靠恢复。

## Unity UI 树与九宫格依据

- `TextureConfig/ChatBubble/*` 的 Sprite 本身带有 `m_Border`，这是官方九宫格边界。
- `widget/system/chat.ys` 中气泡主体 `bg` 的 `UnityEngine.UI.Image.m_Type = 1`，Unity 类型名就是 `Sliced`，不是 Simple 整图缩放。
- `9016` 的 UI 子树共有 17 个节点：`bg` sliced 主体、10 个 `Image`、3 个 `Animation`、1 个 `ParticleSystem`。
- `9017` 的 UI 子树共有 10 个节点：`bg` sliced 主体、5 个 `Image`、3 个 `Animation`。
- 因此 `9016`、`9017` 的“单图”只指主体底图；羽饰和粒子仍是独立动态节点。当前 WebUI 使用主体底图并保留静态可见装饰，不还原这些动态节点。
- 下表顺序为 `top / right / bottom / left`，直接来自 Unity `Sprite.m_Border`：

| 主题 | 左侧/默认 | 右侧 |
| --- | --- | --- |
| 9000 | `57/63/30/63` | `57/63/30/63` |
| 9001 | `57/63/30/63` | `59/31/28/96` |
| 9002 | `56/62/31/64` | `56/62/31/64` |
| 9003 | `54/61/33/61` | `54/61/33/61` |
| 9004 | `56/46/29/76` | `57/77/30/44` |
| 9005 | `56/46/29/76` | `56/46/29/76` |
| 9007 | `56/71/35/52` | `56/51/35/72` |
| 9008 | `57/65/31/58` | `57/62/31/61` |
| 9010 | `67/64/21/60` | `67/60/21/64` |
| 9011 | `53/52/34/71` | `53/71/34/52` |
| 9013 | `54/53/33/62` | `54/66/33/50` |
| 9014 | `61/55/30/72` | `61/72/30/55` |
| 9015 | `55/63/30/56` | `56/63/30/55` |
| 9016 | `57/63/30/63` | `56/41/29/47` |
| 9017 | `57/63/30/63` | `46/52/32/36` |
| 9018 | `52/62/30/61` | `52/61/30/62` |
| 9020 | `54/55/34/69` | `54/69/34/55` |

## 定向解包

命令：

```powershell
python tools\extract_aethergazer_momotalk.py `
  --out-dir extract\aethergazer_momotalk_bubbles_audit `
  --match "^textureconfig/chatbubble/" `
  --include-widget-chat `
  --overwrite
```

结果：

- 处理资源：72
- 保存图片：335
- 错误：0
- Manifest：`extract/aethergazer_momotalk_bubbles_audit/manifest.json`

## 动态组件主题

`widget/system/chat.ys` 中 `9019`、`9021`、`9022` 的主体与装饰由多个 `RectTransform`、`Image`、遮罩、Animator 和粒子/特效节点组成。装饰位置会随动画和运行时状态变化，不能仅按静态序列化坐标烘焙。

因此：

- 不生成 `derived_chatbubble_9019`、`derived_chatbubble_9021`、`derived_chatbubble_9022`。
- 不写入 `bubble_themes.json`。
- 不加入气泡选择器。
- 原始组件解包结果保留在 `extract/aethergazer_momotalk_bubbles_audit/`，仅用于资源审计。

## 组件清单

| 主题 | 类型 | 组件数 | 接入状态 |
| --- | --- | ---: | --- |
| 9016 | sliced 单图主体 + 动画子节点 | 17 | 主体已接入，动态层未接入 |
| 9017 | sliced 单图主体 + 动画子节点 | 10 | 主体已接入，动态层未接入 |
| 9019 | 动态复合 | 9 | 排除 |
| 9021 | 动态复合 | 13 | 排除 |
| 9022 | 动态复合 | 9 | 排除 |

- `9019`：主体、纸张、羽饰、遮罩和角落装饰。
- `9021`：主体、花朵、藤蔓、花瓣、粒子与遮罩节点。
- `9022`：主体、漫画贴片、羽饰、发光层与粒子节点。

## 仍缺失的主题

- `9006`：只有 `textureconfig/momotalk/9006.ys`，实际是群组头像资源，不是气泡。
- `9009`：只有 `textureconfig/momotalk/9009.ys`，实际是群组头像资源，不是气泡。
- `9012`：只有 Item 图标，没有完整气泡。
- `9101`：只有 Item 图标，没有完整气泡。

## 项目接入

- 主题清单：`mimirtalk_webui/data/bubble_themes.json`
- 差异报告：`mimirtalk_webui/data/bubble_extraction_report.json`
- 资源索引：`mimirtalk_webui/data/asset_index.json`
- API：`GET /api/bubble-themes`
- 当前主题数：17

如果需要重新扫描：

```powershell
& "C:\Users\ori\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" `
  mimirtalk_webui\tools\build_asset_index.py
```
