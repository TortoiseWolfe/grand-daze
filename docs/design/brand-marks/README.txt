Grand Daze logo — SVG exports
================================

grand-daze-gear.svg            The gear, with the ring wordmark
grand-daze-script-tags.svg     The < > brackets
grand-daze-printing-mallet.svg The mallet
grand-daze-lockup.svg          All three assembled

All files are 400 x 400 with a 0 0 400 400 viewBox.

BEFORE PRODUCTION USE — outline the ring text
---------------------------------------------
grand-daze-gear.svg and grand-daze-lockup.svg contain LIVE TEXT for
"GRANDDAZE.COM", set in Oswald 700 and pulled in with a remote @import.

That works in a browser. It does NOT work in Illustrator, Figma, Inkscape,
or inside an <img> tag — those will substitute a default sans and then
squeeze it to textLength="300", which visibly mangles the letterforms.

Fix once, in any vector editor:
  1. Open the file (install Oswald first: fonts.google.com/specimen/Oswald)
  2. Select the two text objects
  3. Type > Create Outlines  (Illustrator) / Outline Stroke + Flatten (Figma)
     / Path > Object to Path (Inkscape)
  4. Delete the <style>@import ...</style> block
  5. Save as grand-daze-gear-outlined.svg

The other two files have no text and are safe as-is.

Colours
-------
Steel, face      #B6BEC6
Steel, body      #2E353B
Brass, lit       #EBB042
Brass, shadow    #9A6418
Beech, top face  #E6CB99
Beech, front     #C9A470
Beech, shadow    #9C7844
Beech, handle    #B08F5E
Beech, handle sh #7E6038

These are fixed brand colours. They do not follow the DaisyUI theme.
