// The act catalogue held to its sources (Overlord W2, plan `docs/superpowers/plans/2026-11-16-overlord-w2/w2-act-catalogue.md`
// Task A3): D-8126 §3's act list (the plan's Table 9) as the class oracle, what never relaxes (§7.3, §7.1, the rules under
// the plan's Table 4), and the SAFETY scan. Each rule is a function over a table, run on the real catalogue (no violation)
// and, as a CONTROL, on a copy with one row changed (the plan's Step 5 mutations, kept as cases), so a rule that stopped
// biting is a red suite, not a comment.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLASS_COVERS, OVERLORD_ACT_KINDS, OVERLORD_ACT_KIND_LIST, type OverlordActRow, type OverlordClass,
} from '../../shared/overlord.js';
import { FORBIDDEN_CCD_VERBS } from '../src/coord/approvalguard.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
type Table = Readonly<Record<string, OverlordActRow>>;
const REAL: Table = OVERLORD_ACT_KINDS;
const edit = (kind: string, over: Partial<OverlordActRow>): Table => ({ ...REAL, [kind]: { ...REAL[kind]!, ...over } });

/** D-8126 §3's act list (the plan's Table 9), each act with its class and the kind that must carry at least that class, or
 *  `null`: no door, so no catalogue row, and no Overlord door can perform it. */
const TABLE_9: readonly { readonly act: string; readonly cls: Exclude<OverlordClass, 'unknown'>; readonly kind: string | null }[] = [
  { act: 'a SAFETY verb; reaping, removing, expiring or reclaiming workspaces; units or tmux; a Claude Code build; history writes; live box config', cls: 'O1', kind: 'live-box-act' },
  { act: 'account management', cls: 'O1', kind: 'account-management' },
  { act: 'deploys and rollouts', cls: 'O1', kind: 'deploy' },
  { act: 'publishing: a repository or package public, a release, a public page', cls: 'O1', kind: 'publish' },
  { act: 'messaging people', cls: 'O1', kind: 'message-people' },
  { act: 'usage credits, a model billed on credits, paid services, new accounts', cls: 'O2', kind: 'spend' },
  { act: 'approving a spec', cls: 'O3', kind: 'approve-spec' },
  { act: 'approving or changing the definition of done', cls: 'O3', kind: 'approve-dod' },
  { act: "changing a spec's goals or scope; starting work outside the definition of done", cls: 'O3', kind: 'widen-scope' },
  { act: 'dropping or cutting a definition-of-done item; accepting a known limit that leaves one unmet', cls: 'O3', kind: 'accept-limit' },
  { act: 'starting a new programme', cls: 'O3', kind: 'start-programme' },
  { act: 'choosing what the programme does next once its definition of done holds', cls: 'O3', kind: null },
  { act: "secrets; sign-ins and account auth; granting or removing people's access", cls: 'O4', kind: 'secret-or-access' },
  { act: 'sign-ins of an account (account management under O4)', cls: 'O4', kind: 'account-management' },
  { act: 'who may act on a programme (handing it to another session)', cls: 'O4', kind: 'reassign-programme' },
  { act: 'repository settings: rulesets, branch protection, merge methods, auto-merge', cls: 'O4', kind: null },
  { act: 'delegated worktrees: attaching a lease, saying one is not delegated, any act on one in conflict', cls: 'O4', kind: null },
  { act: 'a fact only the operator holds', cls: 'O5', kind: 'state-a-fact' },
  { act: "overriding a person: ignoring a reviewer's requested change or another person's ruling", cls: 'O6', kind: 'override-a-person' },
];

/** The oracle (F14): a mapped act's kind carries at least its class, and every classed kind is named by some entry. */
function oracleViolations(t: Table): string[] {
  const out: string[] = [];
  for (const e of TABLE_9) {
    if (e.kind === null) continue;   // no door: refused by its absence
    const row = t[e.kind];
    if (row === undefined) out.push(`${e.kind}: no row`);
    else if (!row.classes.includes(e.cls)) out.push(`${e.kind}: lower than ${e.cls}`);
  }
  const named = new Set(TABLE_9.map((e) => e.kind));
  for (const [k, r] of Object.entries(t)) if (r.classes.length > 0 && !named.has(k)) out.push(`${k}: classed, and no entry of D-8126's list names it`);
  return out;
}

const refusedEverywhere = (r: OverlordActRow): boolean => Object.values(r.rungs).every((c) => c === 'refuse');
const o3Alone = (r: OverlordActRow): boolean => r.classes.length === 1 && r.classes[0] === 'O3';

/** What never relaxes (§7.3, §7.1, the rules under the plan's Table 4), as data over a table. */
function neverRelaxesViolations(t: Table): string[] {
  const out: string[] = [];
  for (const [k, r] of Object.entries(t)) {
    if (r.reversibility === 'irreversible' && r.covers.length > 0) out.push(`${k}: an irreversible row has a cover`);
    if (r.covers.includes('grant') && r.classes.some((c) => c === 'O2' || c === 'O4' || c === 'O6')) out.push(`${k}: O2, O4 or O6 with grant`);
    for (const c of ['grant', 'operator-request'] as const) {
      if (r.covers.includes(c) && !(r.reversibility === 'compensable' && o3Alone(r))) out.push(`${k}: ${c} on a row that is not compensable O3 alone`);
    }
    for (const c of r.covers) if (!r.classes.some((m) => CLASS_COVERS[m].includes(c))) out.push(`${k}: ${c} covers none of its classes`);
    if (r.carrier && !r.answer) out.push(`${k}: a carrier that is not an answer`);
    if (r.carrier && r.covers.length > 0) out.push(`${k}: a carrier is never covered itself`);
    if ((r.mayCarry === 'question-effect') !== r.carrier) out.push(`${k}: the question's effect carried by a row that is not a carrier, or a carrier carrying a list`);
    if (!r.carrier && r.mayCarry !== 'question-effect' && r.mayCarry.length > 0 && k !== 'relay') out.push(`${k}: carries an effect, and only relay may`);
    if (refusedEverywhere(r) && r.leastStrength !== 'operator') out.push(`${k}: refused at every rung below the operator's strength`);
  }
  return out;
}

/** The SAFETY scan (plan question 5): `live-box-act` is O1, uncovered and refused everywhere; no row's `what` names `ccd`
 *  followed by a forbidden verb; the catalogue's source spells none of those verbs as a string literal. */
const reEscape = (s: string): string => s.replace(/[\\^$.*+?()[\]{}|-]/g, '\\$&');
/** The SAFETY list also names the fleet limit watchdog's two verbs as no session's (D-8123), and the approval guard's
 *  forbidden list does not carry them; that list is not this piece's file, so the two are listed here (review 4135 F6). */
const SAFETY_LIMIT_VERBS = ['limit-watchdog', 'limit-wait'] as const;
const SCANNED_VERBS: readonly string[] = [...FORBIDDEN_CCD_VERBS, ...SAFETY_LIMIT_VERBS];
const ccdVerb = (what: string): string | null => SCANNED_VERBS.find((v) => new RegExp(`\\bccd\\s+${reEscape(v.split(' ')[0]!)}(?![\\w-])`).test(what)) ?? null;
function safetyViolations(t: Table, source: string): string[] {
  const out: string[] = [];
  const box = t['live-box-act'];
  if (box === undefined) out.push('live-box-act: no row');
  else {
    if (!refusedEverywhere(box)) out.push('live-box-act: allowed at some rung');
    if (box.covers.length > 0) out.push('live-box-act: covered');
    if (!box.classes.includes('O1')) out.push('live-box-act: not O1');
  }
  for (const [k, r] of Object.entries(t)) { const v = ccdVerb(r.what); if (v !== null) out.push(`${k}: names ccd ${v}`); }
  const literals = [...source.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)].map((m) => m[1] ?? m[2]);
  for (const v of SCANNED_VERBS) if (literals.includes(v)) out.push(`the catalogue's source spells ${v} as a literal`);
  return out;
}
const SOURCE = readFileSync(path.join(REPO, 'shared/overlord.ts'), 'utf8');

describe('D-8126 §3\'s act list (F14)', () => {
  it('every mapped act\'s kind carries at least its class, and every classed kind is named', () => {
    expect(oracleViolations(REAL)).toEqual([]);
  });
  it('every kind the list names is a catalogue kind', () => {
    for (const e of TABLE_9) if (e.kind !== null) expect(OVERLORD_ACT_KIND_LIST as readonly string[], e.act).toContain(e.kind);
  });
  it('CONTROL: approve-spec with no class is red', () => {
    expect(oracleViolations(edit('approve-spec', { classes: [] }))).toEqual(['approve-spec: lower than O3']);
  });
  it('CONTROL: account-management without O4 is red', () => {
    expect(oracleViolations(edit('account-management', { classes: ['O1'] }))).toEqual(['account-management: lower than O4']);
  });
  it('CONTROL: a classed kind no entry names is red', () => {
    expect(oracleViolations(edit('relay', { classes: ['O3'] }))).toEqual(["relay: classed, and no entry of D-8126's list names it"]);
  });
});

describe('what never relaxes (§7.3)', () => {
  it('the real rows break no rule', () => { expect(neverRelaxesViolations(REAL)).toEqual([]); });
  it('CONTROL: spend with the cover grant is red', () => {
    expect(neverRelaxesViolations(edit('spend', { covers: ['grant'] }))).toEqual(expect.arrayContaining(['spend: an irreversible row has a cover', 'spend: O2, O4 or O6 with grant']));
  });
  it('CONTROL: secret-or-access with the cover operator-request is red', () => {
    expect(neverRelaxesViolations(edit('secret-or-access', { covers: ['operator-request'] }))).toEqual(expect.arrayContaining(['secret-or-access: operator-request on a row that is not compensable O3 alone']));
  });
  it('CONTROL: grant on a compensable row that is not O3 alone is red', () => {
    expect(neverRelaxesViolations(edit('deploy', { covers: ['grant'] }))).toEqual(expect.arrayContaining(['deploy: grant on a row that is not compensable O3 alone']));
  });
  it('CONTROL: close-request carrying widen-scope is red', () => {
    expect(neverRelaxesViolations(edit('close-request', { mayCarry: ['widen-scope'] }))).toEqual(['close-request: carries an effect, and only relay may']);
  });
  it('CONTROL: a carrier that is not an answer, and a non-carrier carrying the question\'s effect, are red', () => {
    expect(neverRelaxesViolations(edit('answer-ask', { answer: false }))).toEqual(['answer-ask: a carrier that is not an answer']);
    expect(neverRelaxesViolations(edit('state-a-fact', { mayCarry: 'question-effect' }))).toEqual(expect.arrayContaining([expect.stringContaining('state-a-fact: the question\'s effect')]));
  });
  it('CONTROL: a row refused at every rung under the operator\'s strength is red', () => {
    expect(neverRelaxesViolations(edit('publish', { leastStrength: 'attributed' }))).toEqual(["publish: refused at every rung below the operator's strength"]);
  });
  it('CONTROL: a cover that covers none of a row\'s classes is red', () => {
    expect(neverRelaxesViolations(edit('relay', { covers: ['command'] }))).toEqual(['relay: command covers none of its classes']);
  });
});

describe('the SAFETY scan (plan question 5)', () => {
  it('CONTROL: the scan has verbs to read, and the source was read', () => {
    expect(FORBIDDEN_CCD_VERBS.length).toBeGreaterThan(10);
    expect(SOURCE).toContain('OVERLORD_ACT_KIND_MAP');
    // The two limit verbs are scanned beside the guard's list because the guard does not hold them; when it does, drop them here.
    for (const v of SAFETY_LIMIT_VERBS) expect(FORBIDDEN_CCD_VERBS as readonly string[], v).not.toContain(v);
  });
  it('CONTROL: a row naming ccd and either limit verb is red, and either spelled as a literal is red', () => {
    for (const v of SAFETY_LIMIT_VERBS) {
      expect(safetyViolations(edit('propose-retire', { what: `wait with ccd ${v} first` }), SOURCE)).toEqual([`propose-retire: names ccd ${v}`]);
      expect(safetyViolations(REAL, `${SOURCE}\nconst x = '${v}';`)).toEqual([`the catalogue's source spells ${v} as a literal`]);
    }
  });
  it('live-box-act is O1, uncovered and refused at every rung; no row names a forbidden verb; the source spells none', () => {
    expect(safetyViolations(REAL, SOURCE)).toEqual([]);
  });
  it('CONTROL: a planted row whose what names ccd and the list\'s first verb is red', () => {
    const first = FORBIDDEN_CCD_VERBS[0]!;
    expect(safetyViolations(edit('propose-retire', { what: `run ccd ${first} on the workspace` }), SOURCE)).toEqual([`propose-retire: names ccd ${first}`]);
  });
  it('CONTROL: ccd and the archive verb in propose-retire\'s what is red', () => {
    const archive = FORBIDDEN_CCD_VERBS.find((v) => v.endsWith('-archive'))!;
    expect(safetyViolations(edit('propose-retire', { what: `retire it with ccd ${archive}` }), SOURCE)).toEqual([`propose-retire: names ccd ${archive}`]);
  });
  it('CONTROL: live-box-act allowed at full, or covered, or without O1, is red; a literal verb in the source is red', () => {
    expect(safetyViolations(edit('live-box-act', { rungs: { chat: 'refuse', advise: 'refuse', full: 'allow' } }), SOURCE)).toEqual(['live-box-act: allowed at some rung']);
    expect(safetyViolations(edit('live-box-act', { covers: ['command'] }), SOURCE)).toEqual(['live-box-act: covered']);
    expect(safetyViolations(edit('live-box-act', { classes: ['O4'] }), SOURCE)).toEqual(['live-box-act: not O1']);
    const first = FORBIDDEN_CCD_VERBS[0]!;
    expect(safetyViolations(REAL, `${SOURCE}\nconst x = '${first}';`)).toEqual([`the catalogue's source spells ${first} as a literal`]);
  });
});
