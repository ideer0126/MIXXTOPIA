# 普通人物四向动作图集

内置 image_gen；旧 party-guests-v2.png 保留。成人蓝裙与蓝衣儿童沿用用户确认的动作预览图；黄开衫成人、粉衣女孩、黄衣男孩保留旧图集的服装与发型，补齐同一动作结构。每方向四帧，方向序下 / 右 / 上 / 左。PNG 均保存原输出，成人按 40px、儿童按 25px 渲染，不把低分辨率人物单独放大。

渲染时固定脚下锚点，并在原生尺寸缓存中修正正面和背面接触腿；该缓存不写回 PNG。预览中确认的节奏应用于玩家和巡游角色，Muse 使用独立固定站立图集。

## 保留造型的动作扩展：完整提示词

### 黄开衫成人

Production ORIGINAL NPC walk sprite atlas for MIXXTOPIA. Reference1 identifies the costume and hair to retain. Reference2 is the approved four-direction movement example; transfer its grounded walking mechanics, not its costume. Consistent small square pixel clusters matching game assets, not large doll illustrations. Genuine transparent alpha.
Exactly4columns x4rows, sixteen full-body poses of SAME person. Rows SOUTH(front), EAST(right profile), NORTH(back), WEST(left profile). Columns neutral passing with arms relaxed down / LEFT FOOT CONTACT / neutral passing / RIGHT FOOT CONTACT. Column2 and4 must have opposite contact foot and opposing arms. Front/back col2 left-side shoe on viewer's left lower, col4 viewer's RIGHT shoe lower. Side cols2/4 near leg and far leg alternate which goes forward; use light vs dark stocking shade for leg depth. Feet low, no high knees, hopping, running or skipping; stable head/shoulders and constant size. Uniform frame baseline and generous transparent gaps. All directions same body height. No clasped hands in walking poses. No text, labels, grid, background, scenery or shadows. Restricted palette2-3shades, sharp pixels, no smooth gradients or antialiasing.
ONLY the ADULT with short ash-brown bob hair from reference1 row2 first pair, mustard-yellow open cardigan over pale cream shirt, long BLUE TROUSERS and dark/pale low shoes. Keep this existing generic NPC design, adult body3.3heads tall; not a child, no skirt, no ponytail. Intended player/parent character.

### 粉衣女孩

Production ORIGINAL NPC walk sprite atlas for MIXXTOPIA. Reference1 identifies the costume and hair to retain. Reference2 is the approved four-direction movement example; transfer its grounded walking mechanics, not its costume. Consistent small square pixel clusters matching game assets, not large doll illustrations. Genuine transparent alpha.
Exactly4columns x4rows, sixteen full-body poses of SAME person. Rows SOUTH(front), EAST(right profile), NORTH(back), WEST(left profile). Columns neutral passing with arms relaxed down / LEFT FOOT CONTACT / neutral passing / RIGHT FOOT CONTACT. Column2 and4 must have opposite contact foot and opposing arms. Front/back col2 left-side shoe on viewer's left lower, col4 viewer's RIGHT shoe lower. Side cols2/4 near leg and far leg alternate which goes forward; use light vs dark stocking shade for leg depth. Feet low, no high knees, hopping, running or skipping; stable head/shoulders and constant size. Uniform frame baseline and generous transparent gaps. All directions same body height. No clasped hands in walking poses. No text, labels, grid, background, scenery or shadows. Restricted palette2-3shades, sharp pixels, no smooth gradients or antialiasing.
ONLY the PRESCHOOL GIRL from reference1 row3 last pair: brown twin small pigtails, PINK BOW, PINK SMOCK with white collar, dark/pink low shoes, short legs. Preserve existing kindergarten girl design. Child short body2.5heads tall, short gentle steps, not adult. No backpack substitution, no blue clothes.

### 黄衣男孩

Production ORIGINAL NPC walk sprite atlas for MIXXTOPIA. Reference1 identifies the costume and hair to retain. Reference2 is the approved four-direction movement example; transfer its grounded walking mechanics, not its costume. Consistent small square pixel clusters matching game assets, not large doll illustrations. Genuine transparent alpha.
Exactly4columns x4rows, sixteen full-body poses of SAME person. Rows SOUTH(front), EAST(right profile), NORTH(back), WEST(left profile). Columns neutral passing with arms relaxed down / LEFT FOOT CONTACT / neutral passing / RIGHT FOOT CONTACT. Column2 and4 must have opposite contact foot and opposing arms. Front/back col2 left-side shoe on viewer's left lower, col4 viewer's RIGHT shoe lower. Side cols2/4 near leg and far leg alternate which goes forward; use light vs dark stocking shade for leg depth. Feet low, no high knees, hopping, running or skipping; stable head/shoulders and constant size. Uniform frame baseline and generous transparent gaps. All directions same body height. No clasped hands in walking poses. No text, labels, grid, background, scenery or shadows. Restricted palette2-3shades, sharp pixels, no smooth gradients or antialiasing.
ONLY the PRESCHOOL BOY from reference1 bottom row first pair: short light-brown hair, pale MUSTARD YELLOW shirt over white collar, TEAL SHORTS, small dark backpack straps, white socks and dark low shoes. Keep his existing kindergarten design, short body2.5heads tall, short gentle steps. Not adult, no blue smock, no skirt.

## 蓝裙成人与蓝衣儿童：最终接触帧修正提示词

参考为上一版四向图集。两个角色分别调用同一修正提示词，附各自角色约束：成人保留蓝裙 / 棕色马尾，儿童保留蓝衣 / 黄色书包；不改变原图集方向、造型与布局。

Precise animation-frame correction, keep this EXACT same16sprite4x4sheet, character, head design, costume, row directions, palette, transparent background and layout. DO NOT redesign. The issue is that column2 and column4 walking contacts currently repeat the same leg. Correct ONLY column4 of each row, with small matching opposite arm adjustments. Columns1/2/3 remain identical to supplied image. Column2 and4 must visibly alternate legs.
FRONT row1: in column4 the shoe on the VIEWER'S RIGHT is now the forward/low contact foot. Extend that RIGHT-side shoe downward2 logicalpixels and bring LEFT-side shoe upward/back2pixels; right-side knee slightly forward, left-side calf partly behind. Column2 stays left-side shoe forward. Arms swing opposite to forward leg, shoulders remain same.
BACK row3: also alternate contacts: column4 lower/forward contact shoe on VIEWER'S RIGHT, left shoe raised/back; column2 opposite. Torso, head, hair and bag remain aligned.
RIGHT PROFILE row2: column2 is near/light leg forward to the RIGHT and far/darker leg backward LEFT. Column4 must have FAR/DARKER leg forward to the RIGHT, NEAR/LIGHT leg backward LEFT, with proper overlapping knee. Different cuff/stocking shade makes the leg swap readable. Near arm goes forward in one contact and backwards in the other.
LEFT PROFILE row4: mirror that locomotion: column4 far/darker leg forward LEFT, near/light leg backward RIGHT, opposite of column2. Same correct opposite arm pendulum.
Foot extension low and modest, no high knees, no jumping, no huge leg gap, no crossed broken joints. No change of body size between frames. Keep exactly16sprites with generous transparent gaps and no background, text or grid lines. Crisp low-resolution pixel art, consistent art-pixel grid.

成人附加约束：This is the ADULT WOMAN/teacher with blue dress and brown ponytail. Keep her adult proportions, skirt hem stable, do not recolor her hair or dress.

儿童附加约束：This is the CHILD BOY with blue smock, mustard backpack and brown short hair. Keep short child calves, tiny careful step, never exaggerated knee lift, and keep backpack aligned to torso.
