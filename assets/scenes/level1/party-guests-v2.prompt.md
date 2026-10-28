# party-guests-v2.png

生成方式：内置 image_gen，透明背景；2026-10-28。参考图：用户确认的最后一版礼堂预览。
输出保留原始 RGBA。实际输出没有严格遵循等距格子，所以运行时使用逐帧主体取样框（`level.party.sprites`），不按等分图集猜测坐标。成人/儿童分别以 40px/25px 高度绘制；占地仍由脚下 16px 瓦片定义。两帧为待机/迈步。

完整生成提示词：

Asset type: transparent game character sprite atlas matching the supplied MIXXTOPIA birthday hall. The reference is ONLY for pixel-art style, proportions, color and character designs. Output ONLY isolated sprites on genuine transparent alpha, no room or furniture, no floor, no baked shadows or text.
Produce exactly FOUR columns and FOUR rows in a uniform 4x4 grid, sixteen equal square cells. All cells same size. Each character fits within middle 65 percent of its cell, feet at 85 percent of cell height; do not cross cell boundaries. All characters in top-down cozy farming RPG perspective facing south/front, full body.
Arrangement, each pair is SAME CHARACTER, column one idle, column two one walking-step pose; columns three/four another character idle/step.
ROW1: columns1/2 young ADULT woman with brown ponytail and blue welcome dress, original greeter in reference; columns3/4 young ADULT woman with long dark violet hair and blue stage dress, musician, no instrument.
ROW2: columns1/2 young ADULT woman with brown bob hair and mustard cardigan with blue trousers, booth attendant; columns3/4 young ADULT woman with wavy brown hair and pale pink cardigan/long skirt, teacher.
ROW3: columns1/2 preschool BOY with dark brown hair, pale blue smock and small yellow backpack; columns3/4 preschool GIRL with brown pigtails, pink smock and pink bow.
ROW4: columns1/2 preschool BOY with brown hair, yellow shirt and teal shorts; columns3/4 preschool GIRL with dark violet bob, mint smock and small backpack.
Adults have visibly taller 1:2.5 head-to-body proportions, longer limbs; children visibly shorter about 65 percent adult height with larger head-to-body ratio and short limbs. Adults are young adults, not older children. Identical relative scale across all cells: children do NOT get enlarged to fill cells. Keep all feet aligned at85percentcell.
CRISP LOW RESOLUTION PIXEL ART. Adult sprite conceived around16x30 logical pixels; child around12x20. Large square clusters matching reference intermediate pixel scale, limited3-shade palettes, dark muted outlines, no antialiasing, no blurred edges, no painterly detail. Exact matching of idle and walking pairs, small leg and arm step only. No portraits, no extra sprites, no labels, no outline cell grid lines, no props, no background, genuine transparent alpha.
