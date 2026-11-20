# X6: reader mode, the design wave (run 2847)

The task note for wave 31 of the native Docs reader programme, for the coordinator to fold into the ledger. Docs only: the design spec and its leaf plan.

## What landed

- Spec: `docs/superpowers/specs/2026-11-20-native-docs-reader-mode-design.md`.
- Leaf plan: `docs/superpowers/plans/2026-11-20-native-docs-reader-mode.md`: waves XR1 (ccrc on the contract release, continuous scroll), LX6 (the library landing, designed here) and XR2 (ccrc adopts the release carrying LX6: the screen pages).

## For the ledger

- **Waves row.** X6, reader mode: the operator's request of 2026-11-19. Design wave 31, run 2847. The order is the coordinator's ruling on review 2933 F7, option (a):
  - the library lands L1 (X1's landing), its rename and L2 (X2's landing), and cuts the contract release;
  - X1's wave C re-pins ccrc to it; X2's P6 follows X1's host wave and P4, and X2's P5 then adopts the release;
  - XR1 follows on it, in continuous scroll;
  - LX6 joins the contract release if ready by the cut, otherwise the next release, and no cut waits for it;
  - XR2 follows on whichever release carries LX6.
- **Ask 656** (pages or scroll): screen pages, with scroll as a reader setting; the operator's answer, relayed 2026-11-20. Calm scroll and true book pages stay priced in the spec's §5.1.
- **Deviations defined** in the plan's `## Deviations found`: D-8803 (reader-overlay-commands, now XR2's), D-8804 (reader-mode-ops), D-8805 (progress-beyond-the-bar), and D-8831 (reader-mode-chrome-hidden, issued for review 2933 A1). No issued number is left unspent.
- **Library input.** LX6 lands after L2, as the waves row says. Proposed shares under test 8: frame 15 360 characters, total 59 392 (spec §7.4), recorded by a shares-only landing first. Test 9's record gains one entry (`reading` in `FRAME_ACCEPTS`, `reader` in `FRAME_OPS`). LX6.2 now also offsets a turn by the elements pinned at the top, and draws a bounded band over the cut bottom line (review 2933 F5); the shares are unchanged, and they are a ceiling.
- **Library input, layouts and pacing.** Reader mode reads in the default layout only, so LX6's cases name it, and the host never sends `reading` to another layout. The `reader` op has a fourth act, `active`, paced on its own window by `readerActiveMs` (60 000 ms).
- **Device item** for the coordinator to raise: FS-1 to FS-10 (spec §4.4):
  - the phone engines' element full screen;
  - Android Back in full screen;
  - desktop Esc (M-5);
  - activation (M-1);
  - the wake lock per engine;
  - FS-9: the layout remount's cost on the phones, whose reading can switch `READER_LAYOUT_RULE` to `default-only` in a one-constant follow-up;
  - FS-10: whether a tap on the frame's Aa blurs the window while the overlay shows.
- **Acceptance.** A proposed Task 17 row, AR-X6 (the plan's Acceptance row), run in full after XR2, in the default layout; it says what XR1 alone leaves on screen.
- **Measured.** Element full screen on headless Chromium 156: rows M-1, M-2, M-6, M-7 (the console's half) and M-8 held. M-3, M-4, M-5 and M-7's frame half are UNMEASURED; XR1.1 Step 0 and the device item take them. XR1.1 Step 0 also re-reads the 1.1.0 facts on the installed contract release before any code.
- **Refusals this wave**, each reported and answered before any retry:
  - the session hook, on an edit of the scratch measurement script after an unresolvable `cd`;
  - the account guard, on the first draft of that report, which quoted the refusal text;
  - the graph gate, on a source grep.

  The coordinator's rulings were followed as given.
- **Adversarial passes (Opus, high), 2026-11-20:**
  - before the first push: 14 important and 12 minor findings, all fixed;
  - after review 2933's fix round, on the changed sections: 4 important and 6 minor findings, all fixed;
  - after review 2947's fix round, on the changed sections: 8 important and 9 minor findings, all fixed.
- **Review 2933 (round 1):** F1 to F8 and A1 to A6, each fixed in its own commit except A2 and A5, which share one, and listed in the plan's Results. The judge's `pr1-files-invalid` for this note is accepted by the coordinator, as for X5.
- **Review 2947 (round 2):**
  - F1 to F4, with the coordinator's rulings on F2 (the overlay hides by touch, Kindle-like) and F3 (reader mode reads in the default layout, R21), and A-a to A-h;
  - committed as the plan's Results describe, which lists them.
- **Review 2953 (round 3, the last):** accepted at the cap on condition. The report's texts F1 to F8, A-a and A-c to A-g are applied verbatim, one commit each. A-b and A-h are not applied, being superseded by F3. The coordinator ruled on three texts that did not match exactly once, and added one correction of its own, XR2.1's hide test renamed after F3. New mutation rows X6.72 to X6.75. The plan's Results list each.
- **For XR2's brief:** from XR2 the overlay's top strip holds only the title, and Exit, the turn setting and Aa sit in the bottom strip (review 2953 F3). XR2.1 retires rows X6.21, X6.25, X6.35, X6.54 to X6.56, X6.66, X6.68 and X6.69 before its Step 1 (F6).
