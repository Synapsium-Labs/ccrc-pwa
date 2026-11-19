// The untrusted-build item's control (approvals PR 2, review 2752 F4). The item carries no door of its own: its first step
// names `UNTRUSTED_BUILD_SETTINGS_PATH`, and the console draws a routed path in an item's text as a link (`linkRuns`), so the
// step opens Settings' Automation section, whose Test box build list holds the build's row and its Capture again. The
// server's step (`server/src/coord/untrustedBuildItem.ts`) is pinned by its own cases; this pins that the console links it.
import { describe, expect, it } from 'vitest';
import { UNTRUSTED_BUILD_SETTINGS_PATH } from '../../shared/ledgers';
import { linkRuns } from '../src/ledgers/ledgerLinks';
import { matchRoute } from '../src/lib/routes';

describe('the untrusted-build item\'s step links Settings', () => {
  it('the path is Settings\' Automation section, a routed page', () => {
    expect(UNTRUSTED_BUILD_SETTINGS_PATH).toBe('/settings/automation');
    expect(matchRoute(UNTRUSTED_BUILD_SETTINGS_PATH)?.route.id).toBe('settings-automation');
  });
  it('the item\'s step draws it as an in-console link', () => {
    const step = `Open ${UNTRUSTED_BUILD_SETTINGS_PATH} and find Claude Code 2.1.330 in the Test box's build list.`;
    expect(linkRuns(step, null)).toEqual([
      { kind: 'text', text: 'Open ' },
      { kind: 'link', text: '/settings/automation', href: '/settings/automation', external: false },
      { kind: 'text', text: ' and find Claude Code 2.1.330 in the Test box\'s build list.' },
    ]);
  });
});
