// shared/update-move.ts (centralised-update programme wave 14, R15; D-4266) — the dispatcher's halt rule, its three
// capability clauses, autoPermits and moveRefusal's stamp-unread rule (D-4270), moved to L0 so the PWA's halt banner
// and skew advice ask the SAME predicates.
// These cases pin the L0 rules, that dispatch.ts answers through them rather than through a copy, and (the census at
// the end) that each is declared once.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUTO_MODES, UPDATE_CHANNELS, UPDATE_GATE_CAP, UPDATE_STATES, isReleaseTag } from '../../shared/api.js';
import { UPDATE_OP } from '../../shared/agent-protocol.js';
import {
  DETACH_CAP, agentPredatesUpdateOp, autoPermits, carriesDetachCap, carriesUpdateGate, isHaltingUpdate, stampUnread,
} from '../../shared/update-move.js';
import * as dispatch from '../src/update/dispatch.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DETAILS: (string | null)[] = [null, '', 'gate: unit not up', 'provenance:', 'provenance: unsigned bundle', 'Provenance: x',
  'PROVENANCE: x', ' provenance: x', 'x provenance: y'];

describe('isHaltingUpdate — spec §10 and D-3378', () => {
  it('reverted halts; failed halts unless its detail BEGINS provenance:; idle and every busy state never halt', () => {
    for (const state of UPDATE_STATES) {
      for (const detail of DETAILS) {
        const want = state === 'reverted' || (state === 'failed' && !(detail ?? '').startsWith('provenance:'));
        expect(isHaltingUpdate(state, detail), `${state} / ${JSON.stringify(detail)}`).toBe(want);
      }
    }
  });

  it('a state this build cannot name is not settled, so it does not halt', () => {
    expect(isHaltingUpdate('halted', null)).toBe(false);
    expect(isHaltingUpdate('', null)).toBe(false);
  });

  it('dispatch.ts\'s isHalting answers through it, over every state and detail', () => {
    for (const updateState of UPDATE_STATES) {
      for (const updateDetail of DETAILS) {
        expect(dispatch.isHalting({ updateState, updateDetail }), `${updateState} / ${JSON.stringify(updateDetail)}`)
          .toBe(isHaltingUpdate(updateState, updateDetail));
      }
    }
  });
});

describe('the capability clauses — moveRefusal\'s no-detach-cap, no-update-gate and agent-predates-update-op', () => {
  it('carriesDetachCap reads the one word, which dispatch.ts re-exports', () => {
    expect(DETACH_CAP).toBe('detach');
    expect(dispatch.DETACH_CAP).toBe(DETACH_CAP);
    expect(carriesDetachCap(['detach'])).toBe(true);
    expect(carriesDetachCap(['update-gate', 'rollback'])).toBe(false);
    expect(carriesDetachCap([])).toBe(false);
  });

  it('agentPredatesUpdateOp: NULL is the server\'s own row and is never checked; an agent must list the op', () => {
    expect(agentPredatesUpdateOp(null)).toBe(false);
    expect(agentPredatesUpdateOp([UPDATE_OP])).toBe(false);
    expect(agentPredatesUpdateOp(['tail', UPDATE_OP])).toBe(false);
    expect(agentPredatesUpdateOp([])).toBe(true);
    expect(agentPredatesUpdateOp(['tail'])).toBe(true);
  });

  it('carriesUpdateGate reads shared/api.ts\'s one gate word', () => {
    expect(carriesUpdateGate([UPDATE_GATE_CAP])).toBe(true);
    expect(carriesUpdateGate(['detach', 'rollback'])).toBe(false);
    expect(carriesUpdateGate([])).toBe(false);
  });

  it('dispatch.ts asks them, and spells no clause itself', () => {
    const src = readFileSync(path.join(here, '..', 'src', 'update', 'dispatch.ts'), 'utf8');
    expect(src).toContain("if (!carriesDetachCap(row.caps)) return 'no-detach-cap';");
    expect(src).toContain("if (move.source === 'auto' && !carriesUpdateGate(row.caps)) return 'no-update-gate';");
    expect(src).toContain("if (agentPredatesUpdateOp(row.agentOps)) return 'agent-predates-update-op';");
    expect(src).not.toMatch(/caps\.includes\(DETACH_CAP\)|caps\.includes\(UPDATE_GATE_CAP\)|agentOps\.includes\(UPDATE_OP\)/);
    expect(src).toContain('return isHaltingUpdate(row.updateState, row.updateDetail);');
    expect(src).toContain('if (stampUnread(row.stampRead, row.currentVersion)) return { kind: \'unread\' };');
    expect(src).not.toMatch(/stampRead !== 'ok'/);
  });
});

describe('stampUnread — moveRefusal\'s stamp-unread clause, moved to L0 (D-4270)', () => {
  const STAMPS = ['ok', 'absent', 'unreadable', 'malformed', ''];
  const VERSIONS: (string | null)[] = [null, 'v0.0.9', 'v1.2.3', 'main', '0.0.9', 'v0.0.9-rc1', ''];

  it('a stamp that did not read, or a version that is not a release tag; a stamp that read with no version is not unread', () => {
    for (const stamp of STAMPS) {
      for (const version of VERSIONS) {
        const want = stamp !== 'ok' || (version !== null && !/^v\d+\.\d+\.\d+$/.test(version));
        expect(stampUnread(stamp, version), `${JSON.stringify(stamp)} / ${JSON.stringify(version)}`).toBe(want);
      }
    }
  });

  it('agrees with isReleaseTag, the one tag-shape guard', () => {
    for (const version of VERSIONS) {
      if (version === null) continue;
      expect(stampUnread('ok', version), JSON.stringify(version)).toBe(!isReleaseTag(version));
    }
  });

  it('moveRefusal answers stamp-unread through it, and only for an unread node', () => {
    const row: dispatch.DispatchRow = {
      nodeId: '0f0f0f0f-0000-4000-8000-00000000000f', role: 'fleet', label: 'fleet',
      currentVersion: 'v0.0.9', highestVersion: 'v0.0.9', floorRead: 'measured', stampRead: 'ok',
      caps: [DETACH_CAP, UPDATE_GATE_CAP], agentOps: [UPDATE_OP], reachable: true,
      updateState: 'idle', updateTarget: null, updateStartedAt: null, updateDetail: null, reportedUpdatedAt: null,
      channel: 'stable', desiredTag: null, provenance: 'verified', requestedTag: null, requestedKind: null, requestedAt: null,
    };
    const releases = [{ tag: 'v0.0.10', channel: 'stable' as const, bundleListed: true, yanked: false }];
    const refusal = (o: Partial<dispatch.DispatchRow>) => dispatch.moveRefusal(
      { row: { ...row, ...o }, auto: 'off', refusedTags: new Set<string>() },
      { kind: 'update', target: 'v0.0.10', source: 'request' }, releases, { haltedBy: [], leaseHeldBy: null });
    expect(refusal({ stampRead: 'unreadable' })).toBe('stamp-unread');
    expect(refusal({ stampRead: 'ok', currentVersion: 'main' })).toBe('stamp-unread');
    expect(refusal({ stampRead: 'ok', currentVersion: null })).not.toBe('stamp-unread');
    expect(refusal({})).toBeNull();
  });
});

describe('autoPermits — moved whole from dispatch.ts (D-4266)', () => {
  it('off never; stable only a node resolved to stable; channel any resolved channel, never an unresolved one', () => {
    for (const auto of AUTO_MODES) {
      for (const channel of [...UPDATE_CHANNELS, null]) {
        const want = auto === 'channel' ? channel !== null : auto === 'stable' ? channel === 'stable' : false;
        expect(autoPermits(auto, channel), `${auto} / ${String(channel)}`).toBe(want);
      }
    }
  });

  it('dispatch.ts re-exports the L0 function and declares none of its own', () => {
    expect(dispatch.autoPermits).toBe(autoPermits);
    const src = readFileSync(path.join(here, '..', 'src', 'update', 'dispatch.ts'), 'utf8');
    expect(src).not.toMatch(/function autoPermits\b/);
  });
});

describe('the ring', () => {
  it('shared/update-move.ts imports only its shared siblings — the PWA bundles it', () => {
    const src = readFileSync(path.join(here, '..', '..', 'shared', 'update-move.ts'), 'utf8');
    const specs = [...src.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm)]
      .map((m) => m[1] ?? m[2]);
    expect(new Set(specs)).toEqual(new Set(['./api.js', './agent-protocol.js']));
    expect(/\brequire\(|import\(/.test(src)).toBe(false);
  });
});

// The holder census (centralised-update wave 14, R15; D-4266, D-4267). It lives HERE, not in single-definition.test.ts,
// because that file was another programme's claim when this wave was planned. The walk is single-definition's own: the
// same four roots, and the same `__`-prefix skip for a parallel suite's transient mutants. The home screen asks the
// dispatcher's own questions, so the answers live in L0 and `server/src/update/dispatch.ts` calls them; the Ack's gate
// lives in `pwa/src/fleet/updateAck.ts`, which the Settings screen re-exports.
const ccrcRoot = path.resolve(here, '..', '..');
const ROOTS = ['shared', 'server/src', 'pwa/src', 'agent/src'].map((r) => path.join(ccrcRoot, r));
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    if (e.startsWith('__')) continue; // a parallel suite's transient mutant (single-definition.test.ts says why)
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) { out.push(...sources(p)); continue; }
    if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}
const ALL = ROOTS.flatMap(sources);
const rel = (p: string): string => path.relative(ccrcRoot, p).split(path.sep).join('/');
const codeOnly = (f: string): string => readFileSync(f, 'utf8')
  .split('\n').map((l) => (/^\s*(\*|\/\*|\/\/)/.test(l) ? '' : l)).join('\n');

describe('centralised-update wave 14: the halt rule, the move predicates and the Ack gate are declared once', () => {
  const DETACH_DEF = /^\s*(?:export\s+)?(?:const|let|var)\s+DETACH_CAP\b/m;
  const DETACH_LITERAL = /(['"])detach\1/;

  it('CONTROL: the walk sees every root; the patterns see a declaration and a quoted copy, not a re-export or prose', () => {
    for (const r of ROOTS) expect(sources(r).length, rel(r)).toBeGreaterThan(0);
    expect(DETACH_DEF.test("export const DETACH_CAP = 'detach';")).toBe(true);
    expect(DETACH_DEF.test('export { DETACH_CAP };'), 'a re-export declares nothing').toBe(false);
    expect(DETACH_LITERAL.test("caps.includes('detach')")).toBe(true);
    expect(DETACH_LITERAL.test('carries no `detach` cap'), 'a backticked prose mention').toBe(false);
  });

  it('DETACH_CAP is declared, and the word quoted, in shared/update-move.ts alone — dispatch.ts re-exports it', () => {
    expect(ALL.filter((f) => DETACH_DEF.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/update-move.ts']);
    expect(ALL.filter((f) => DETACH_LITERAL.test(codeOnly(f))).map(rel)).toEqual(['shared/update-move.ts']);
  });

  it('each L0 predicate is declared in shared/update-move.ts alone', () => {
    for (const name of ['isHaltingUpdate', 'carriesDetachCap', 'carriesUpdateGate', 'agentPredatesUpdateOp', 'autoPermits', 'stampUnread']) {
      const re = new RegExp(`^\\s*(?:export\\s+)?(?:function|const)\\s+${name}\\b`, 'm');
      expect(ALL.filter((f) => re.test(readFileSync(f, 'utf8'))).map(rel), name).toEqual(['shared/update-move.ts']);
    }
  });

  it('the provenance exception to a halt is tested on a code line only where the census names it', () => {
    // `startsWith(PROVENANCE_DETAIL_PREFIX)` is the halt rule's exception (shared/update-move.ts), the store's own JS
    // form (`rowHalts`, coord/store.ts — residue: another programme's claim held it when wave 14 was drafted), and the
    // inventory's refusal recorder (update/inventory.ts — a different question: is this report a verdict on the
    // release). It pins THIS spelling only: a copy written another way (a 'provenance:' literal, `indexOf`, a bare
    // `failed || reverted`) is not seen here.
    const PREFIX_TEST = /startsWith\(PROVENANCE_DETAIL_PREFIX\)/;
    expect(ALL.filter((f) => PREFIX_TEST.test(codeOnly(f))).map(rel).sort()).toEqual([
      'server/src/coord/store.ts', 'server/src/update/inventory.ts', 'shared/update-move.ts',
    ]);
  });

  it('canAck is declared in pwa/src/fleet/updateAck.ts alone — SettingsScreen re-exports it', () => {
    const re = /^\s*export function canAck\b|^\s*function canAck\b|^\s*(?:export\s+)?const canAck\b/m;
    expect(ALL.filter((f) => re.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['pwa/src/fleet/updateAck.ts']);
  });
});
