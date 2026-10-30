# Kyujin guitarist performance — built-in image_gen

The initial draft below was refined with this final editing prompt (the draft remains in the built-in generated-images directory):

Use case: precise-object-edit.
Edit target: this generated Kyujin guitarist sprite sheet.
Preserve the EXACT character face, hairstyle, proportions, costume, guitar design/colors and fully transparent alpha. The FIRST sprite's pose and illustration are the correct reference.
Make a corrected production animation atlas: square 1536x1536, FOUR equal 768x768 cells in a 2x2 grid. Each character is centered within its OWN cell, full head, twin ponytails, guitar tuning head and feet completely inside the cell with at least 80px transparent padding all sides. All heads identical scale, same relative x/y position within cells. No cropping of guitar tips. Feet at identical baseline relative to cells.
Frame order reading left to right, top to bottom:
1. Rest: exact first sprite pose from input, right picking hand ON the strings near pickups, left fretting hand wrapped around neck.
2. Upstroke: right picking wrist only a LITTLE higher, STILL over the guitar strings and ivory pickguard. Do not raise a fist to her chest, do not take hand off the instrument.
3. Downstroke: right picking wrist a LITTLE lower, STILL over strings/pickguard, with small corresponding elbow motion.
4. Return: right picking wrist back near rest. Movement in the HAND is subtle, about 1/20 of her head height total across frames. All four poses must clearly show fingers touching strings, and fretting hand holding the neck.
Keep guitar body, neck angle, strap, face, hair, legs and shoes FIXED in every cell. Do not change facial expressions or turn her head. Torso hardly moves.
Style: identical crisp detailed pixel art to input, intended for rendering at 40 logical pixels tall with a 60px detail buffer. REAL fully transparent background, no floor, shadows, gradient halos, checkerboard, text, labels, borders, or other objects.

## Initial draft prompt

Use case: identity-preserve.
Asset type: production transparent pixel-art game sprite sheet for MIXXTOPIA.
Input image 1 is the EXISTING character identity and rendering-style reference. Use ONLY the woman in the BOTTOM ROW: Kyujin, long black twin ponytails, dark navy/charcoal buttoned top, grey pleated skirt, dark tights and black shoes. Other rows must NOT appear.
Primary request: create a NEW dedicated guitarist performance sprite sheet with EXACTLY FOUR full-body sprites, one horizontal row, evenly spaced identical cells. Landscape canvas 1536x1024. Each sprite the SAME SCALE with same centered head x within its cell and same feet baseline. Leave generous transparent margin all sides, no overlap. Preserve the source character's big-head adult NPC game proportions, exact face, hair and clothing design, detailed chunky pixel-art shading and crisp pixel outlines. Do not simplify into stick figures, do not change to tall realistic adult proportions.
All four poses face toward the viewer with a very slight three-quarter turn, same slight top-down RPG view. A compact burgundy red electric guitar with ivory pickguard sits diagonally across her waist/lower torso, guitar body toward viewer-left and neck rising toward viewer-right. The guitar is appropriately sized for her body, with clear neck, strings, tuning head, and a narrow dark shoulder strap passing from her shoulder to the guitar. Left hand (viewer-right) wraps around the neck at chest height; right forearm (viewer-left) bends inward with hand ON the strings over the body. Both elbows visibly bend to PLAY the instrument; do not hang arms straight down.
Frame 1: resting playing-ready pose, picking hand gently rests on the strings, fretting hand grips neck. Frame 2: picking hand just above its rest position. Frame 3: picking hand a little below its rest position after a downstroke. Frame 4: picking hand returns upward. Tiny wrist-led motion only. Guitar body/neck and feet remain FIXED between all four frames. Head, face, hair, size and costume remain identical. Guitar fingers/hand stay attached to forearms throughout, fretting hand does not float away.
Scene/backdrop: REAL FULLY TRANSPARENT alpha background. No floor, no shadow below feet, no checkerboard, no background color, no text, no labels, no numbering, no panels. No sound flashes, no musical notes, no extra instruments. This sheet includes the guitar, strap, both hands and character as one coherent sprite.
