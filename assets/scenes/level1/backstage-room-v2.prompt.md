# Backstage room v2 — recessed curtain entrance

Source PNG drafts are preserved under `docs/previews/issue86/sources/`; the approved runtime source is `assets/scenes/level1/backstage-room-v5.webp`.

Built-in `image_gen` local edit, 2026-11-08. Edit target: `backstage-room-v1.png`. The generated correction is composited only inside source rectangle (1190,700,137,255), clipped to the 1327px source width; outside that rectangle the original v1 RGBA pixels are retained exactly. The original v1 is preserved. Full-source dimensions (1327×1185) and 448×400 logical drawing rectangle are unchanged. This remains a composition candidate, not runtime art.

The corrected entrance exposes the passage recess, inner wood reveal and floor threshold, with blue cloth gathered inside the frame. The preview player is placed clear of the doorway at the existing arrival illustration. Game entities, collisions and saves are unchanged.

## Complete prompt

```text
Use case: precise-object-edit.
Edit target: the attached existing pixel-art dressing-room background. Make ONE LOCAL correction to the royal-blue curtained entrance at the far RIGHT edge near the LOWER horizontal walking aisle. Everything outside that doorway region must retain its exact current composition, geometry, colors, furniture and detail.
Problem: the existing entrance looks like a freestanding narrow front-facing curtained box pasted onto the east side wall, with its wooden canopy sticking out into the floor. Its perspective conflicts with the side wall.
Required correction: replace that little box with a convincing RECESSED SIDE-FACING backstage passage THROUGH THE EAST WALL, opening westward directly into the lower horizontal aisle. The passage must be physically integrated into the right wall thickness, with a coherent wooden jamb, visible dark interior reveal and a short continuation of the same wood floor into the threshold. Royal-blue stage fabric is gathered to the far/right inner jamb by a small gold tie, leaving a visible dark passage mouth and a clear walkable threshold. The curtain is inside the recess; no freestanding canopy, booth, cupboard, flat front-facing door panel, or drape pasted over unbroken wall.
Spatial constraint: work within the far-right lower-door region, roughly original image x1190..1327, y700..955 (image 1328x1184). Keep the wall above and below continuous, but interrupt the wall properly at the doorway. The doorway's floor must join the existing clear horizontal aisle, approximately y840..900 in the source image. No raised step, rug, obstacles, extra door, furniture, plant, or arrow in this passage. Do not change any of the twenty vanities, twenty stools, left storage or top decorations.
Scale and style: preserve original near-square canvas and same top-down orthographic RPG pixel perspective, warm wood joinery, crisp square pixels, royal blue cloth and small gold details. Adult characters will be 40 logical pixels high, equivalent to about119 source pixels: doorway head clearance around 150–180 source pixels, usable floor opening at least roughly96 source pixels along the north-south travel aperture. A small believable architectural opening, not a giant portal.
Constraints: environment-only opaque background. No characters, labels, text, arrows, glow, collectibles or changes to lighting outside this doorway. Keep exact image size and alignment; do not zoom, reframe or redraw the room.
```
