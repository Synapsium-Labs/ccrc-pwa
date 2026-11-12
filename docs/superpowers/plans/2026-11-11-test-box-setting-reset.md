# Test box card: Reset to default on each setting

- **D-8336 (2026-11-11)** — test box settings, Reset to default: each row of the connected card's Settings that a settings file sets carries Reset to default (one tap, then the card's sheet confirms); it sends the key alone as a new `unset` list of the existing `settings-fleet` and `settings-box` subs (`--unset=KEY`), which takes the key's line out of the file ccrc wrote (the fleet host's test box overlay, or the box's settings file before the installer's `--reapply`), so the key's own reader answers its declared default; the list is policed as the settings map is, and the deny list's reset needs the step-up as its edit does.

Refs #2438 (the card's settings, spec 2026-11-07-test-box-connect-design.md §2.6; plan 2026-11-10-test-box-connect.md TC8,
TC16, D-8166).

## Why

The connected card (D-8166 TC16) shows each setting's value, where it came from and, for a default row, that it is the default.
It had no way back to the default: the operator had to know the default and type it, and two box keys (the OS mirror and the
live probes' config directory) default to empty, which no `--set=KEY=VALUE` word can carry (the contract refuses an empty value).

## What changes

- `shared/testbox-admin.ts`: `settings-fleet` and `settings-box` take `settings`, `unset` or both; each field is marked `anyOf`
  (one of the two must be given; the bash table's third column says `+`). `unset` is a list of the sub's own keys (the twelve
  fleet-host keys; the box keys less the four pairing ones), each once, never a key the same call sets, written as one
  `--unset=KEY` word a key in the table's order. `testboxAdminNeedsStepUp` asks for the step-up when the list names
  `CCRC_TESTBOX_DENY_GLOBS`. No new sub, no new code.
- `ccd/ccrc-testbox-admin`: `_tba_fields` and `_tba_parse` are the twin. `settings-fleet` takes the key's line out of the overlay
  (`_tba_overlay_put` with a bare KEY), refuses `key-in-ccrc-env` for a key `ccrc.env` names (a key set there stays read-only and
  has no reset), and checks the key no longer reads from a file. `settings-box` takes the key's lines out of the box's current file
  in `_tba_cx_merge`, and the merged file passes the same whole check before the installer re-runs; a reset run-shaping key the
  file held marks parity stale. Its precheck holds a reset key's declared default (`_tba_box_default`) to `_tb_key_policy`, as a
  sent value is held.
- The server and the agent read the contract; neither changed.
- `pwa/src/fleet/TestBoxManage.tsx`: Reset to default under the input of a row whose source is `file` or `empty`; not on a
  default row, an unmeasured row, a pairing row, a key `ccrc.env` sets (learned from the route's `key-in-ccrc-env`), or the two
  box paths whose default the installer refuses (`BOX_SETTING_FORM_START`). The tap opens the card's one sheet (the setting, where
  ccrc takes it out, parity again for a run-shaping key, the runs note), whose Confirm sends `{unset: [key]}` (with `whenIdle` while
  runs are in progress, or after a `runs-in-progress` refusal) and needs the step-up for the deny list. Phone: the control full
  width under the input; laptop and wide: its own width at the field's start (`settings.css`).

## Deviations found

- D-8336 resets by taking the key out of the file instead of writing the declared default's text. The reader then answers the
  default itself (the row reads "(default)" again, and a later release's default follows), the empty defaults need no special
  word, and no second copy of the fleet-host defaults is kept in TypeScript.
- `CCRC_TESTBOX_ROOT` and `CCRC_TESTBOX_REPOS` have no reset: their declared defaults are `~/` paths the installer refuses as
  root's (the Connect form already starts them from absolute paths, `BOX_SETTING_FORM_START`). The verb refuses such a reset
  `box-value-refused` naming the key, before the box is asked.
