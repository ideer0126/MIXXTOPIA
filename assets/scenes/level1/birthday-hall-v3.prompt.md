# Smaller stage bass — built-in image_gen local edit

Reference/edit target: the 180×155 crop at (820,150) in `birthday-hall-v2.png`, enlarged four times for editing. Only the returned region corresponding to original pixels x843–902 / y180–284 is used in `birthday-hall-v3.png`; pixels outside this rectangle retain the exact original RGB bytes. The original v2 remains in the repository. The black amplifier is outside the replacement rectangle.

## Complete prompt

Use case: precise-object-edit.
Edit target: this cropped section of an existing pixel-art birthday stage. It contains a large RED ELECTRIC GUITAR standing to the left of a black amplifier.
Primary request: replace ONLY that red electric guitar with a SMALLER FOUR-STRING ELECTRIC BASS on a discreet dark floor stand. Keep the instrument's feet/bottom at the SAME floor level, in the SAME spot to the left of the amplifier. The bass must be about 75 percent of the old guitar's total displayed height and 65 percent of its body width, so it reads as a smaller stored spare instrument rather than competing with the performing character.
Bass: slim asymmetrical burgundy-red body, a simple small ivory pickguard, visibly LONG slim wooden neck relative to its compact body, exactly FOUR strings and FOUR tuning pegs. Recognizable electric bass silhouette, not the original six-string guitar. Bass body leans a few degrees right on its small unobtrusive black support.
Preserve: exact composition, camera, pixel-art style, native square-pixel texture, colors and pixel density of the scene. The black amplifier and all its knobs must remain completely unchanged. Do not move or resize the amplifier. Preserve all stage floor boards, empty floor, blue whale mural fragments, curtains and gramophone fragments at the crop edges. Remove the old guitar completely including its tall neck, and naturally reconstruct the tiny patch of floor/wall it previously covered. No new cables or accessories beyond the small bass support.
Canvas: keep EXACT same image layout and aspect ratio as input. This is a LOCAL background correction, not a new scene. Opaque RGB scene, no transparency, no characters, no text or labels. No changes to anything except the one guitar being replaced by a smaller bass.
