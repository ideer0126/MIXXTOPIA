# Backstage room v1 — composition candidate, Issue #86

Source PNG drafts are preserved under `docs/previews/issue86/sources/`; the approved runtime source is `assets/scenes/level1/backstage-room-v5.webp`.

Generated 2026-11-08 using built-in `image_gen`, with `birthday-hall-v3.webp` as a style reference. Original generated PNG is preserved as `backstage-room-v1.png`; this candidate is not registered in game data or the runtime manifest. No existing art is replaced.

The intended world rectangle is 448×400 logical pixels (28×25 tiles), at world (40,3). The entire source image is sampled without cropping. `tools/preview-backstage86.html` draws the room at this scale and overlays actual `party.muses` frames via `Birthday.cachedFrames`, at the game's 40px adult height; no new character designs are generated. Portal uses the existing `star-portal-east-v1.webp` at 48×72px. Byeori retains the current game's guest sprite. The preview independently loads source assets and never boots the game, reads saves, or calls account APIs.

Review candidate: five north-wall stations, ten central back-to-back stations, five south stations, twenty stools. Two horizontal aisles and the left activity zone are reserved. Exact ground rectangles, upper-aisle clearance and foreground contours still require calibration against the accepted art before integration; overlays are proposed routes, not a collision validation result. Runtime export and source-size mapping will be added only after composition approval.

## Complete prompt

```text
Use case: stylized-concept.
Asset type: whole static background for a top-down pixel adventure RPG, MIXXTOPIA Level 1 backstage dressing room, NEW independently versioned art.
Reference image: birthday-hall-v3.webp is STYLE reference only: match its orthographic RPG view, fine square pixel density, crisp dark outlines, warm honey wood floor, cream plaster with wood wainscot, vivid royal blue fabric, pink/mint/cream accents and warm light. Do not duplicate the hall layout.
Primary request: create a complete lovingly detailed kindergarten birthday pageant backstage dressing room. Rectangular room viewed from above with front-facing north wall and visible furniture tops like reference, never isometric, never photographic. Composition fills a 28 by 25 tile world, aspect ratio 448:400. No HUD or frame labels.
Precise layout in normalized 448 by 400 layout units (the output may be larger, preserve relative positions):
- outer room walls x8..440, y8..392; top wall cream and timber y8..36; warm horizontal floorboards.
- right dressing area x160..416. EXACTLY TWENTY single-person vanity stations and TWENTY individual round padded stools, arranged as four bands of five. Each vanity footprint visual about 45 wide by 44 tall, so the row spans about 240 units. Five north-wall vanities at x166,214,262,310,358 and y38..82, with five stools centered y94. Each vanity has its OWN round mirror and wood drawer desk. Center island consists of two rows of five vanities BACK TO BACK, upper row facing north (mirror BACKS visible to viewer) around y162..205, lower row facing south (lit mirror FRONTS visible) around y206..250. Upper row stools centered y150, lower row stools centered y264. Bottom five vanities face north (rear wood mirror backs visible) at y332..376, with five stools centered y320. Respect this FOUR rows of five scheme.
- Keep two broad completely empty horizontal walking aisles y106..138 and y278..310 across the dressing area, at least 32 units clear between the outside furniture/stool silhouettes. Keep a clear vertical aisle x140..162.
- left third x18..138 is a comfortable EMPTY dialogue and star-portal activity area, joined to both aisles. Leave open floor around x48,88,128 at y145, and x48,88,128 at y313. These are future adult character ground positions; DO NOT draw people or placeholders.
- leave empty floor at x22..68,y176..250 for a separately rendered magical portal facing right, and at x78,y232 and x128,y232 for guide and reward. DO NOT DRAW ANY PORTAL, glowing floor ring, reward stars, characters or markers.
- show one recessed closed royal-blue entrance curtain on the EAST wall beside the lower aisle at x420..440,y272..310. It is a backstage arrival, no return exit or ordinary door anywhere.
- upper-left corner y40..96: compact garment rail with pageant costumes, tidy shoe boxes, folded blue ocean scenery; lower-left corner y350..378: compact prop trunk, a small storage trolley, rolled moon/wave stage scenery, all safely outside the open activity area. Costume rail height about 55 units, a human sprite will be 40 units high. Ordinary stool height about 16 units, vanity overall height about 44 units. Harmonize scale.
Materials and lived-in details: round mirror bulbs, varied small cosmetics, hairbrushes, ribbons, folded towels, a few small music and blue-whale posters on upper walls. Small differences in desk accessories and pastel stools, not twenty cloned pasted images. No extra loose chairs in aisles. No windows. Avoid excessive sparkles or confetti on floor. Bottom wall low cutaway, no foreground wall hiding the floor.
Constraints: STATIC ENVIRONMENT ONLY. No people, characters, faces in mirrors, text labels, speech bubbles, interactable collectibles, portal, stars on the floor, player sprite, watermark or diagram annotations. No stretching or blurred painterly gradients. Clean single unified scene with clear silhouettes and empty navigable floor. Keep same scale in X and Y. Generate landscape near-square 448:400 aspect.
```
