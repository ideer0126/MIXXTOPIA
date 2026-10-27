# 第一关场景美术

内置 image_gen 生成，2026-10-25。原始 PNG 完整保留；两份图集保留透明 alpha，运行时按 frame 取样。场景布局与碰撞依据 js/data.js，人物不在本次范围。

参考：用户提供的幼儿园文艺汇演照片，用于海洋蓝、鲸鱼、生日蛋糕与气球摆设；不识别或转绘照片中的人物。

## classroom-props-v1.png

```text
Use case: stylized-concept
Asset type: One transparent pixel-art environment prop atlas for a top-down birthday-party RPG.
Primary request: Production-ready richly detailed SNES-style pixel-art props for a nostalgic kindergarten birthday party at midnight. Warm cream, faded rose, mint, lavender and honey gold, tender dreamcore, absolutely no horror.
Composition/framing: EXACTLY 4 columns by 3 rows of equally sized square cells in one landscape 4:3 sheet. Every prop fits its own cell with transparent padding; no objects cross cell boundaries. Consistent three-quarter top-down RPG perspective, all base shadows at the bottom, lighting from upper left. No printed grid, no cell borders, no text.
Cell order left to right:
Row 1: a substantial pastel balloon arch with cascading ribbons and a completely open walk-through center; a cozy picture-book shelf filled with colorful books and paper stars; a pair of small mint-and-pink school lockers with bags and paper flowers; a freestanding wooden classroom blackboard with only chalk star and moon drawings.
Row 2: a birthday cake on a low wooden table with a white cloth and one unlit candle; a single charming mint plastic kindergarten chair, seat and back readable; a cluster of wrapped decorative birthday presents with satin bows; a large potted leafy plant in a terracotta pot with a paper-flower garland.
Row 3: a wide wall display of children's colorful drawings hung with wooden pegs; a moonlit arched classroom window with violet night sky, tiny stars, soft pink curtains; a little party reception table with a checkered cloth, cups and party hats; a small raised wooden theatre stage backdrop with rose velvet curtains, warm star-shaped fairy lights and an open center.
Style/medium: Genuine high-quality hand-placed pixel-art appearance, clean pixel clusters, tactile wood grain and cloth folds, soft contact shadows, elegant limited palette. Art should read well when each cell is reduced to 32 to 64 game pixels. Object silhouettes clear and uncluttered.
Constraints: Real transparent alpha everywhere outside props, isolated objects, no background scene, no characters, no photorealism, no typography, no watermark. All twelve props present and in the exact cells described.
```

## whale-mural-v1.png

```text
Use case: stylized-concept
Asset type: One environment mural background for the northern wall of a top-down pixel RPG.
Input images: Image 1 is a style, color, and stage-design reference only. Do not include the photographed people.
Primary request: Reinterpret the reference's kindergarten performance-stage backdrop as beautifully crafted pixel game scenery.
Scene/backdrop: A flat wide hand-painted ocean-blue stage mural: central cheerful blue whale wearing a green striped party hat, white striped belly, pink cheek; small colorful fish, pink coral, sea plants and sand; on one side a large illustrated two-tier pink-and-white birthday cake with three colored candles; short festive strings of star shapes above. Preserve the recognizable playful ocean birthday-party theme of the reference.
Style/medium: Detailed retro adventure-game pixel art, crisp square-pixel clusters, rich 1990s RPG background craft, tactile matte painted-board surface. Flat frontal mural, NO room perspective, NO isometric room, NO visible floor.
Composition/framing: Wide landscape about 3:1, mural fills edge to edge. Whale dominant, birthday cake secondary, no people, all details belong to the painted mural. A restrained navy frame around the outer edge.
Lighting/mood: Slightly dim indoor stage light, nostalgic, gentle dreamcore, colorful but not neon. Ocean cyan and royal blue, dark navy, dusty coral pink, cream, butter yellow.
Constraints: No text or lettering, no Korean banner, no logos, no real people, no UI or watermarks. Opaque rectangular mural. The reference photo is guidance for the design, not an edit target.
```

## ocean-party-v1.png

```text
Use case: stylized-concept
Asset type: One transparent 2 by 2 sprite atlas of ocean-themed birthday party decorations for a top-down RPG.
Input images: Image 1 is a design reference only for blue-white ocean birthday decorations. No people from the photo.
Primary request: Four beautifully detailed pixel-art scene props matching a nostalgic kindergarten performance birthday party with whale elements.
Composition: EXACTLY TWO equal columns and TWO equal rows on a square sheet. Each object is centered within its own square cell, has generous transparent padding, never overlaps another cell. No grid lines and no text.
Top left cell: A walk-through balloon arch of ocean-blue, baby-blue, white and pale-yellow balloons, silver-blue foil stars, little coral branches and one smiling small blue whale balloon, with an OPEN transparent central gap.
Top right cell: A large floor balloon bouquet with an expressive blue whale foil balloon as the main shape, a metallic blue star, orange smiling sea star, white coral branches and blue/white round balloons below.
Bottom left cell: A whimsical freestanding wooden welcome display shaped like a large smiling blue whale in a green striped birthday party hat, small fish and shells decorating its low stand. NO text and no lettering.
Bottom right cell: A party dessert table with a low wooden base and a cream-and-blue gingham cloth, a two-tier pink-and-white birthday cake with THREE UNLIT pastel candles, cups, party hats and wrapped small gifts.
Style: Detailed polished 1990s RPG pixel art, three-quarter elevated view of props suitable for a top-down room, crisp deliberate pixel clusters, rich material shading, delicate warm contact shadow, consistent upper-left light, restrained cream, navy, azure, pastel blue, dusty coral and warm honey wood palette. Readable when each object is rendered at 40 to 64 game pixels.
Constraints: Real transparent alpha around all four isolated objects, no scene background, no people, no labels, no logos or watermark. Keep EXACT 2x2 layout and correct item order.
```

新版告示牌、地毯、搬运礼物盒、圆形按钮、星光门、北向椅子与入口门见 [BACKSTAGE_PROMPTS.md](BACKSTAGE_PROMPTS.md)。
