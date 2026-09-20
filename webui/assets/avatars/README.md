# Curated WebUI Avatars

This directory is scanned by `mimirtalk_webui/tools/build_asset_index.py` in
addition to the extracted game asset directories. Files here are copied into
the project so the WebUI does not depend on an external extraction drive at
runtime.

## Story portraits

Source:

```text
D:\大眼解包图片资源\story_character0917\comsingle\textureconfig\story\character\
```

| Contact | Asset ID | Local file |
| --- | --- | --- |
| 奥丁 (1029) | `character_itemshead:story_comsingle:1029` | `character_itemshead/story_comsingle/sprite/1029.png` |
| 宁希达 (10066) | `character_itemshead:story_comsingle:10066` | `character_itemshead/story_comsingle/sprite/10066.png` |
| 望舒 (10170) | `character_itemshead:story_comsingle:10170` | `character_itemshead/story_comsingle/sprite/10170.png` |
| 克图格娅 (10183) | `character_itemshead:story_comsingle:10183` | `character_itemshead/story_comsingle/sprite/10183.png` |
| 长琴 (10169) | `character_itemshead:story_comsingle:10169` | `character_itemshead/story_comsingle/sprite/10169.png` |
| 泰逢 (10175) | `character_itemshead:story_comsingle:10175` | `character_itemshead/story_comsingle/sprite/10175.png` |
| 后土 (10176) | `character_itemshead:story_comsingle:10176` | `character_itemshead/story_comsingle/sprite/10176.png` |
| 尼娅 (10144) | `character_itemshead:story_comsingle:10144` | `character_itemshead/story_comsingle/sprite/10144.png` |
| 苍术 (10111) | `character_itemshead:story_comsingle:10111` | `character_itemshead/story_comsingle/sprite/10111.png` |

The source PNG files are `300x144`, with alpha. The WebUI crops every avatar to
the transparent inner hole of the game avatar frame (`10/108` inset,
`88/108` content, `6/88` content radius) and does not draw the frame texture in
preview or PNG export. New avatars should use the same rules; do not pre-crop
source files or add frame overlays for individual characters.
