// Single-definition scanners, one area of the guard (see ./helpers.ts for the doctrine and the shared walkers).
//
// The programme ledgers' console owners (desktop-polish carry C, D-7951, review 1437 A2; desktop-polish PL10, D-7952). Each
// name below is declared in ONE file of the four roots, so a second reader of the waiting list's wire shape, a second builder of
// a Docs address, a second link splitter or a second list of places cannot appear beside the first unnoticed. Code lines only
// (`stallCode`).
import { describe, expect, it } from 'vitest';
import { ALL, rel, stallCode, stallCodeText } from './helpers.js';

const holders = (re: RegExp): string[] => ALL.filter((f) => re.test(stallCode(f))).map(rel).sort();
const decl = (name: string): RegExp =>
  new RegExp(`\\bfunction\\s+${name}\\b|\\b(?:const|let|var)\\s+${name}\\s*[:=]`);

describe('the ledgers console has one owner of each reader, builder and list (carry C D-7951; PL10 D-7952)', () => {
  it('CONTROL: the pattern sees a declaration and passes over a use and a comment', () => {
    expect(decl('isGoalsFor').test('export function isGoalsFor(v: unknown, slug: string): v is GoalsView {')).toBe(true);
    expect(decl('PLACES').test('export const PLACES: readonly Place[] = [')).toBe(true);
    expect(decl('isGoalsFor').test("import { isGoalsFor } from './waitingView';")).toBe(false);
    expect(stallCodeText('// function isGoalsFor(v)\nconst x = 1;')).not.toMatch(decl('isGoalsFor'));
  });

  it('the waiting list and a Goals view are each recognised in waitingView.ts alone (review 1437 A2)', () => {
    for (const name of ['isWaitingView', 'isGoalsFor']) expect(holders(decl(name)), name).toEqual(['pwa/src/ledgers/waitingView.ts']);
  });

  it('every Docs address the ledgers draw, and the link splitter, are built in ledgerLinks.ts alone (PL10)', () => {
    for (const name of ['linkRuns', 'docHref', 'specHref', 'homeProjectOf', 'programmeSpecHref']) {
      expect(holders(decl(name)), name).toEqual(['pwa/src/ledgers/ledgerLinks.ts']);
    }
  });

  // Review 1466 F5 and F6 (PL10 fix round 1): the D28 boundary is ONE decider asked on both sides, so the console never draws
  // as a link what the routes would refuse. Its scanner, trim and decider are declared in shared/ledgers.ts alone, the console's
  // splitter reads its candidates and the decider from there, and the raise and return routes both refuse through it.
  it('the document-link boundary is declared once in shared/ledgers.ts, and both sides ask it (review 1466 F5, F6)', () => {
    for (const name of ['linkCandidates', 'trimLinkTail', 'linksDocumentOutside', 'outsideDocLink', 'LINK_CANDIDATE']) {
      expect(holders(decl(name)), name).toEqual(['shared/ledgers.ts']);
    }
    const splitter = stallCode(ALL.find((f) => rel(f) === 'pwa/src/ledgers/ledgerLinks.ts')!);
    // No second candidate pattern or trim of its own in the console's splitter, as it had until the fix round.
    for (const name of ['CANDIDATE', 'trimmed', 'TRAILING', 'CLOSER_OF']) expect(splitter, name).not.toMatch(decl(name));
    expect(splitter).toMatch(/\blinkCandidates\(text\)/);
    expect(splitter).toMatch(/\blinksDocumentOutside\(text\)/);
    const routes = stallCode(ALL.find((f) => rel(f) === 'server/src/coord/ledgersRoutes.ts')!);
    expect(routes.match(/\boutsideDocLink\(/g), 'the raise route and the return route').toHaveLength(2);
  });

  it("the console's places are listed in places.ts alone, and their badges decided in navBadges.ts alone (PL10)", () => {
    for (const name of ['PLACES', 'DESK_PLACES', 'phoneBarShown']) expect(holders(decl(name)), name).toEqual(['pwa/src/lib/places.ts']);
    expect(holders(decl('placeBadge'))).toEqual(['pwa/src/fleet/navBadges.ts']);
    // The list Refined's bar kept of its own until PL10 is gone, not kept beside the shared one.
    expect(holders(decl('TAB_IDS'))).toEqual([]);
  });
});
