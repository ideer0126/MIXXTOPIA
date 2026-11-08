# Backstage room v4 — restore whale and wave posters

Source PNG drafts are preserved under `docs/previews/issue86/sources/`; the approved runtime source is `assets/scenes/level1/backstage-room-v5.webp`.

2026-11-08. User requested keeping the Taylor Swift poster and restoring the other two originals. Base: `backstage-room-v3.png`; restoration source: `backstage-room-v2.png`. Both originals are preserved.

The built-in image editor rejected the two-reference request with a public-figure moderation error; no generated result was used. Final art restores existing local poster artwork through Canvas, without regenerating a portrait. Source rectangle (685,37,155,70) maps to (685,37,155,80) for the whale; source (1101,49,100,57) maps to (1101,49,100,68) for the wave. These crops exclude the old round mirror tops; nearest-neighbor fitting fills the current poster frames. All pixels outside the two destination rectangles, including the left Taylor Swift poster, rectangular mirrors and revised entrance, are retained from v3. Dimensions remain 1327×1185, sampled whole into 448×400 logical pixels. This is still preview-only art.

## Attempted built-in edit prompt

```text
Use case: precise-object-edit.
Image 1 is edit target: current backstage-room-v3 pixel-art background with RECTANGULAR vanity mirrors and three singer posters.
Image 2 is restoration reference: backstage-room-v2 with the ORIGINAL whale and wave posters, but old ROUND mirrors. Use Image 2 ONLY as a source for the center and right poster contents.
Request: KEEP the LEFT Taylor Swift poster exactly unchanged. Restore the CENTER poster to the original blue whale swimming among light blue water bubbles from Image 2. Restore the RIGHT poster to the original stylized blue ocean wave and small sun from Image 2. Match those two original poster paintings and frames as closely as possible, including position, dimensions and colors. The center is the large landscape poster between the left portrait and central hanging star banner. The right is the small poster above the rightmost vanity.
Preserve every other part of Image 1, especially all TWENTY RECTANGULAR mirror faces/backs, the round stools, exact Taylor Swift portrait, the blue backstage entrance curtain with dark passage at lower right, the furniture, cream wall, costumes and floor. Do NOT restore Image 2's round mirrors or left musical-note poster. No other changes, no extra objects, no text, no characters. Same dimensions and exact pixel-art style. This is a two-poster restoration only.
```
