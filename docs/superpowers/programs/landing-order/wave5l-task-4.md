# Wave 5l, Task 4: the README

Run 3942, programme `landing-order`, wave 32. Plan section 8, with section 12's C3 and C4 (8.1 says "the entry" and
names the repair exception; 8.3 says "was read and did not prove").

## The packet

`README.md` is held by wave 5k's builder (claim 7303, run 3914). At the start of the wave I sent its holder the unified
diff of section 8 against `main` `ad52d25f4b7250f3dc27e179aac8fde04d52b073`: three hunks, 5926 bytes, sha256
`d663479bcdb258c5f95866c42046fb0202e8232463e5f9ff47f2f7a7d6271bb6`. The holder answered yes (delivery 37753): the diff
applies with no fuzz to `main` and to its own branch's README, its one hunk applies with no fuzz on top of mine, and both
orders give the same file. The file was untouched until that answer.

## The change

Section 4's script, run from the work tree with the six old and new texts saved under the session's temp root, printed
`README: three changes applied`: each old text occurred once before and each new text once after. The README it wrote
equals, byte for byte, the file the packet's diff produces (`cmp`).

## Not done here

- Step 3, the rendered README in GitHub's preview of the pull request at the two changed sections (the four-backtick
  fence of 8.2), is checked once the pull request exists; the result is in the wave-done mail.
