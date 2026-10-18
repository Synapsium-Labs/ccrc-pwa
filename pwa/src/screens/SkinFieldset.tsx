// Settings → Appearance → Layout: the skin picker (D-5096), and under it the
// line that names the fonts and their licence (D-5095).
//
// THREE CHOICES (spec §7): Match this device, then the catalogue in its own
// order, a preview marked as one — the same three the palette's "Switch
// layout" offers (command/commands.ts). The catalogue is @ccrc/ui's; this file
// never names a skin.
//
// IT SHOWS THE CHOICE, NOT THE SKIN. AUTO is a stored choice that resolves to
// a skin; the picker opens on the choice (`storedSkin()`), so a desk on AUTO
// sees "Match this device" checked rather than whatever AUTO gave it. That is
// why this reads `storedSkin()` and not `useSkin()`, which answers with the
// resolution: `skin-identity.test.ts`'s useSkin registry stays empty.
//
// APPLY, THEN REMEMBER. `setSkin` stamps before it writes, so storage that
// throws (a private window, a preview) still leaves the pick on screen for
// the session; the radio follows local state, not a storage read, so it stays
// on the pick too. Switching re-renders in place: before W2 a skin is tokens
// only, so nothing remounts (spec §5.4), and the theme is a different axis.
//
// THE LICENCE LINE IS NOT YET A LINK (D-5459). The plan links it to
// `/licenses/Geist-OFL.txt` in a new tab. An `<a href>` is a hand-drawn
// control to `control-census.test.ts`, which must register it, and @ccrc/ui
// has no link primitive; that census is frozen while #402 is in flight
// (#402 edits it), so the anchor and its entry land after #402 merges. Until
// then the line names the faces and the licence, and the build still ships the
// notice beside the app (Task 7, `fonts.test.ts`).
import { useState } from 'react';
import type { ReactNode } from 'react';
import { AUTO, INSTRUMENT, SKINS } from '@ccrc/ui';
import { setSkin, storedSkin } from '../lib/skin';
import { AppearanceFieldset, AppearanceRow } from './AppearanceRow';

/** "Match this device", in words true to THIS build: while Instrument is a
 *  preview the device rule gives Refined everywhere (D-5096), and the note
 *  says so rather than promising a desk layout nobody gets yet. */
function matchDeviceNote(): string {
  const instrument = SKINS.find((s) => s.id === INSTRUMENT);
  return instrument !== undefined && !instrument.preview
    ? 'Instrument at a desk with a mouse; Refined on a phone or a tablet.'
    : 'Refined on every device while Instrument is a preview; Instrument at a desk once it lands.';
}

export function SkinFieldset(): ReactNode {
  const [current, setCurrent] = useState<string>(() => storedSkin());
  const pick = (id: string): void => { setSkin(id); setCurrent(id); };
  const choices = [
    { id: AUTO, label: 'Match this device', note: matchDeviceNote() },
    ...SKINS.map((s) => ({ id: s.id, label: s.preview ? `${s.label} (preview)` : s.label, note: s.note })),
  ];

  return (
    <>
      <AppearanceFieldset legend="Layout">
        {choices.map((c) => (
          <AppearanceRow key={c.id} choice={c} current={current} onPick={pick} group="settings-skin" swatch={false} />
        ))}
      </AppearanceFieldset>
      {/* Unlinked until #402 frees the control census (D-5459). */}
      <p className="settings-note mb-3">Fonts: Geist and Geist Mono, SIL Open Font License 1.1.</p>
    </>
  );
}
