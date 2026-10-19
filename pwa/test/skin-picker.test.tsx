// The skin picker's seam (D-5096): the Layout fieldset in Settings →
// Appearance, and the one line under it that names the fonts and their
// licence (D-5095; its link waits for #402, D-5459).
//
// `skin-catalogue.test.ts` covers @ccrc/ui's pure half and `skin-boot.test.tsx`
// the boot stamp and the palette's door. This covers the CONTROL: it opens on
// the stored choice (AUTO included, not what AUTO resolves to), a pick stamps
// and stores it, and storage that throws still stamps it for the session.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AUTO, INSTRUMENT, REFINED, SKINS, SKIN_STORAGE_KEY } from '@ccrc/ui';
import { initSkin, setSkin } from '../src/lib/skin';
import { SkinFieldset } from '../src/screens/SkinFieldset';
import { AppearanceSection } from '../src/screens/SettingsScreen';

const root = document.documentElement;

// Boot as main.tsx does: `initSkin()` reads the stored choice the picker opens on.
beforeEach(() => { localStorage.clear(); root.removeAttribute('data-skin'); initSkin(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); root.removeAttribute('data-skin'); });

const radio = (name: RegExp): HTMLInputElement => screen.getByRole('radio', { name }) as HTMLInputElement;

describe('the Layout picker', () => {
  it('offers Match this device, then every skin, a preview marked as one', () => {
    render(<SkinFieldset />);
    const group = screen.getByRole('group', { name: 'Layout' });
    const names = within(group).getAllByRole('radio').map((r) => (r as HTMLInputElement).value);
    expect(names).toEqual([AUTO, ...SKINS.map((s) => s.id)]);
    // A layout is not a palette: no row previews one (data-theme="refined" is no palette).
    expect(group.querySelector('.settings-theme-swatch')).toBeNull();
    for (const s of SKINS) {
      const label = s.preview ? `${s.label} (preview)` : s.label;
      expect(within(group).getByText(label)).toBeInTheDocument();
      expect(within(group).getByText(s.note)).toBeInTheDocument();
    }
  });

  it('the picker opens on the stored choice; choosing one stamps and stores it; storage that throws still stamps it for the session', () => {
    // Nothing stored is AUTO: the picker shows the CHOICE, never its resolution.
    const first = render(<SkinFieldset />);
    expect(radio(/^Match this device/).checked).toBe(true);
    first.unmount();

    localStorage.setItem(SKIN_STORAGE_KEY, INSTRUMENT);
    initSkin();
    const second = render(<SkinFieldset />);
    expect(radio(/^Instrument/).checked).toBe(true);
    fireEvent.click(radio(/^Refined/));
    expect(root.getAttribute('data-skin')).toBe(REFINED);
    expect(localStorage.getItem(SKIN_STORAGE_KEY)).toBe(REFINED);
    expect(radio(/^Refined/).checked).toBe(true);
    fireEvent.click(radio(/^Match this device/));
    expect(localStorage.getItem(SKIN_STORAGE_KEY)).toBe(AUTO);
    expect(root.getAttribute('data-skin')).toBe(REFINED);
    second.unmount();

    // A private window: every read and write throws. The pick still applies.
    vi.stubGlobal('localStorage', {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
      removeItem() { throw new Error('denied'); },
      clear() {},
    });
    initSkin();
    render(<SkinFieldset />);
    expect(radio(/^Match this device/).checked).toBe(true);
    expect(() => fireEvent.click(radio(/^Instrument/))).not.toThrow();
    expect(root.getAttribute('data-skin')).toBe(INSTRUMENT);
    expect(radio(/^Instrument/).checked).toBe(true);
  });

  // D-5096: the palette's "Switch layout" (command/commands.ts) calls setSkin
  // from outside Settings. The radios follow the stored choice, not a copy
  // taken at mount, so the checked row is never stale and "Match this device"
  // can be picked straight back.
  it('follows a choice made outside it, and the stale row picks AUTO straight back', () => {
    render(<SkinFieldset />);
    expect(radio(/^Match this device/).checked).toBe(true);
    act(() => { setSkin(INSTRUMENT); });
    expect(radio(/^Instrument/).checked).toBe(true);
    expect(radio(/^Match this device/).checked).toBe(false);
    fireEvent.click(radio(/^Match this device/));
    expect(localStorage.getItem(SKIN_STORAGE_KEY)).toBe(AUTO);
    expect(root.getAttribute('data-skin')).toBe(REFINED);
    expect(radio(/^Match this device/).checked).toBe(true);
  });

  it('the Match this device note is true to the catalogue: preview now, the device rule once Instrument lands', () => {
    const first = render(<SkinFieldset />);
    expect(screen.getByText('Refined on every device while Instrument is a preview; Instrument at a desk once it lands.')).toBeInTheDocument();
    first.unmount();
    const entry = SKINS.find((s) => s.id === INSTRUMENT) as { preview: boolean } | undefined;
    expect(entry).toBeDefined();
    const was = entry!.preview;
    entry!.preview = false;
    try {
      render(<SkinFieldset />);
      expect(screen.getByText('Instrument at a desk with a mouse; Refined on a phone or a tablet.')).toBeInTheDocument();
    } finally {
      entry!.preview = was;
    }
  });

  it('is a radio group of its own, never joined to the theme rows', () => {
    render(<AppearanceSection />);
    const layout = within(screen.getByRole('group', { name: 'Layout' })).getAllByRole('radio') as HTMLInputElement[];
    const theme = within(screen.getByRole('group', { name: 'Theme' })).getAllByRole('radio') as HTMLInputElement[];
    const layoutNames = new Set(layout.map((r) => r.name));
    expect(layoutNames.size).toBe(1);
    for (const r of theme) expect(layoutNames.has(r.name)).toBe(false);
    // Checking a layout must leave the theme's checked row checked.
    const themeChecked = theme.find((r) => r.checked);
    expect(themeChecked).toBeDefined();
    fireEvent.click(layout[1]!);
    expect(themeChecked!.checked).toBe(true);
  });
});

describe('Appearance', () => {
  it('Appearance renders Layout above Theme', () => {
    render(<AppearanceSection />);
    const legends = [...document.querySelectorAll('legend')].map((l) => l.textContent);
    expect(legends).toEqual(['Layout', 'Theme']);
  });

  // The plan's "the fonts line links /licenses/Geist-OFL.txt" waits for #402:
  // an `<a href>` needs an entry in the control census, which #402 edits
  // (D-5459). What lands now is the line itself, and where it sits.
  it('the fonts line names Geist, Geist Mono and their licence, between Layout and Theme', () => {
    render(<AppearanceSection />);
    const line = screen.getByText('Fonts: Geist and Geist Mono, SIL Open Font License 1.1.');
    const layout = screen.getByRole('group', { name: 'Layout' });
    const theme = screen.getByRole('group', { name: 'Theme' });
    expect(layout.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line.compareDocumentPosition(theme) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
