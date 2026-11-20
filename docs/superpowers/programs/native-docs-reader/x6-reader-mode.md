# X6: reader mode, the design wave (run 2847)

The task note for wave 31 of the native Docs reader programme, for the coordinator to fold into the ledger. Docs only: the design spec and its leaf plan.

## What landed

- Spec: `docs/superpowers/specs/2026-11-20-native-docs-reader-mode-design.md`.
- Leaf plan: `docs/superpowers/plans/2026-11-20-native-docs-reader-mode.md`: waves XR1 (ccrc on library 1.1.0), LX6 (the library landing, designed here) and XR2 (ccrc adopts it).

## For the ledger

- **Waves row.** X6, reader mode: the operator's request of 2026-11-19. Design wave 31, run 2847. XR1 waits for X1's host wave and X2's P5.3 (the popstate dispatcher and the places decider); XR2 waits for the release carrying LX6 and X2's P5 adoption. If P5.3's host half lands before the library release, XR1 can run ahead of it.
- **Ask 656** (pages or scroll): screen pages, with scroll as a reader setting; the operator's answer, relayed 2026-11-20. Calm scroll and true book pages stay priced in the spec's §5.1.
- **Deviations defined** in the plan's `## Deviations found`, the whole issued block: D-8803 (reader-overlay-commands), D-8804 (reader-mode-ops), D-8805 (progress-beyond-the-bar). No number left unspent.
- **Library input.** LX6 lands after the X1 and X2 landings of the library wave, in the same release if it is not cut yet, else the next minor. Proposed shares under test 8: frame 15 360 characters, total 59 392 (spec §7.4), recorded by a shares-only landing first. Test 9's record gains one entry (`reading` in `FRAME_ACCEPTS`, `reader` in `FRAME_OPS`).
- **Device item** for the coordinator to raise: FS-1 to FS-8 (spec §4.4), the phone engines' element full screen, Android Back in full screen, desktop Esc (M-5), activation (M-1), and the wake lock per engine.
- **Acceptance.** A proposed Task 17 row, AR-X6 (the plan's Acceptance row).
- **Measured.** Element full screen on headless Chromium 156: rows M-1, M-2, M-6, M-7 (the console's half) and M-8 held; M-3, M-4, M-5 and M-7's frame half are UNMEASURED, taken by XR1.1 Step 0 and the device item (spec §4.5).
- **Refusals this wave**, each reported and answered before any retry: the session hook on an edit of the scratch measurement script after an unresolvable `cd`; the account guard on the first draft of that report, which quoted the refusal text; the graph gate on a source grep. The coordinator's rulings were followed as given.
- **Adversarial pass (Opus, high), 2026-11-20:** 14 important and 12 minor findings; all fixed in the spec and plan before the push, the one sheet-portal finding by its own alternative (sheets always portal into the container). The fix commit lists them.
