// D-7578 (plan docs/superpowers/plans/2026-10-30-consolidation-increment7-watcher-store-port.md, Task WP1; increment 7).
// The census of what the watcher and its lane files reach on the coordination store: `scan/parse.ts#storeReach`, a
// type-checked walk (the plan's §What the measurement found, item 3). The CONTROL rows hold each rule exactly on a
// fixture program, so a rule mutant reds one. The two real-tree rows below them hold at every step of the series. The
// three REPORT rows print the real tree's counts and every member or key that differs from the record (the reach
// row's is the port's own list, `coord/ports.ts#WatcherCoordMember`, since D-7579; the other two's are in
// `watcher-store-port.data.ts`), and pass: before WP10 a census reports and never reds (spec §5.1 rule 3 rev 2). With
// `WATCHER_PORT_STRICT=1` (the series' own red-first steps and mutation runs; CI never sets it) they assert exactly.
import { beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { parseFile, storeReach, type StoreReach } from '../scan/parse.js';
import { REPO } from './walkSrc.js';
import { WATCHER_WHOLE_HANDOFFS, WATCHER_WHOLE_REACH } from './watcher-store-port.data.js';

const STRICT = process.env['WATCHER_PORT_STRICT'] === '1';
const DATA = 'server/test/rings/watcher-store-port.data.ts';
const PORTS_FILE = 'server/src/coord/ports.ts';

const STORE = `export class CoordStore {
  constructor(readonly db: number) {}
  alpha(): number { return 1; }
  beta(): number { return 2; }
  gamma(): number { return 3; }
  delta(): number { return 4; }
  epsilon(): number { return 5; }
  zeta(): number { return 6; }
  eta(): number { return 7; }
  run(id: string): number { return this.runs().length + id.length + this.alpha(); }
  runs(): number[] { return [this.beta()]; }
  adopt(other: CoordStore): number { return other.gamma(); }
  private secret(): number { return this.eta(); }
}
`;
const PORTS = `import type { CoordStore } from './store.js';
export type WatcherCoordPort = Pick<CoordStore, 'alpha' | 'beta'>;
`;
const STORE_IMPORT = "import type { CoordStore } from './coord/store.js';\n";

/** The census over a fixture program: the store and the port, plus `files`; the scope is `watch.ts`. */
const fixture = (files: Record<string, string>): StoreReach => storeReach({
  files: { 'coord/store.ts': STORE, 'coord/ports.ts': PORTS, ...files },
  scope: ['watch.ts', '*Lane.ts', 'lane*.ts'],
  store: { file: 'coord/store.ts', name: 'CoordStore' },
  port: { file: 'coord/ports.ts', name: 'WatcherCoordPort' },
});
const view = (r: StoreReach): Partial<StoreReach> => ({ diagnostics: r.diagnostics, reach: r.reach,
  wholeReach: r.wholeReach, portReach: r.portReach, wholeHandoffs: r.wholeHandoffs, chains: r.chains,
  portEntries: r.portEntries });
const none = { diagnostics: [], wholeHandoffs: {}, chains: {}, portEntries: {} };

describe('the store census on fixtures (CONTROL, exact)', () => {
  it('a direct read on the whole store is reached, and the result is plain data', () => {
    const r = fixture({ 'watch.ts': `${STORE_IMPORT}export class FleetWatcher {
  constructor(private readonly coord: CoordStore) {}
  tick(): number { return this.coord.alpha() + this.coord.db; }
}
` });
    expect(r).toEqual({ diagnostics: [], files: ['watch.ts'],
      units: { 'watch.ts#FleetWatcher.constructor': [], 'watch.ts#FleetWatcher.tick': ['alpha', 'db'] },
      reach: ['alpha', 'db'], wholeReach: ['alpha', 'db'], portReach: [], portMembers: ['alpha', 'beta'],
      wholeHandoffs: {}, chains: {}, portEntries: {}, bareAnnotations: { 'watch.ts#FleetWatcher.constructor': 1 } });
  });

  it('a narrow slot reaches its type\'s members: a Pick parameter, and a typed local', () => {
    const r = fixture({
      'coord/use.ts': `import type { CoordStore } from './store.js';
export function useNarrow(p: Pick<CoordStore, 'beta' | 'gamma'>): number { return p.beta(); }
`,
      'watch.ts': `${STORE_IMPORT}import { useNarrow } from './coord/use.js';
export class FleetWatcher {
  constructor(private readonly coord: CoordStore) {}
  viaParam(): number { return useNarrow(this.coord); }
  viaLocal(): number { const n: Pick<CoordStore, 'delta'> = this.coord; return n.delta(); }
}
` });
    expect(view(r)).toEqual({ ...none, reach: ['beta', 'delta', 'gamma'], wholeReach: ['beta', 'delta', 'gamma'],
      portReach: [] });
    expect(r.units['watch.ts#FleetWatcher.viaParam']).toEqual(['beta', 'gamma']);
  });

  it('an object-literal property, plain and shorthand, into a narrow field of a parameter or an annotated variable', () => {
    const r = fixture({
      'coord/lanes.ts': `import type { CoordStore } from './store.js';
export interface StopDeps { coord: Pick<CoordStore, 'alpha'>; project: string }
export interface HibernateDeps { coord: Pick<CoordStore, 'beta'> }
export interface RollDeps { readonly coord: Pick<CoordStore, 'gamma'> }
export const stopDone = (d: StopDeps): string => d.project;
export const hibernate = (d: HibernateDeps): number => d.coord.beta();
`,
      'watch.ts': `${STORE_IMPORT}import { hibernate, stopDone, type RollDeps } from './coord/lanes.js';
export class FleetWatcher {
  constructor(private readonly coord: CoordStore) {}
  stop(): string { return stopDone({ coord: this.coord, project: 'project-a' }); }
  hib(): number { const coord = this.coord; return hibernate({ coord }); }
  roll(): number { const d: RollDeps = { coord: this.coord }; return d.coord.gamma(); }
}
` });
    expect(view(r)).toEqual({ ...none, reach: ['alpha', 'beta', 'gamma'], wholeReach: ['alpha', 'beta', 'gamma'],
      portReach: [] });
    expect([r.units['watch.ts#FleetWatcher.stop'], r.units['watch.ts#FleetWatcher.hib']]).toEqual([['alpha'], ['beta']]);
  });

  it('the same in a return object whose declared return type\'s field is narrow, plain and shorthand', () => {
    const r = fixture({
      'coord/collect.ts': `import type { CoordStore } from './store.js';
export interface CollectDeps { coord: Pick<CoordStore, 'delta'>; lane: string }
export interface CollectPort { coord: Pick<CoordStore, 'epsilon'> }
`,
      'watch.ts': `${STORE_IMPORT}import type { CollectDeps, CollectPort } from './coord/collect.js';
export class FleetWatcher {
  constructor(private readonly coord: CoordStore) {}
  collectDeps(): CollectDeps { return { coord: this.coord, lane: 'lane-a' }; }
  collectPort(): CollectPort { const coord = this.coord; return { coord }; }
}
` });
    expect(view(r)).toEqual({ ...none, reach: ['delta', 'epsilon'], wholeReach: ['delta', 'epsilon'], portReach: [] });
  });

  it('an interface whose every property names a store member is a structural narrow slot', () => {
    const r = fixture({
      'coord/dispatch.ts': `export interface DispatchPort { zeta(): number; eta(): number }
export const dispatchOnce = (p: DispatchPort): number => p.zeta();
`,
      'watch.ts': `${STORE_IMPORT}import { dispatchOnce } from './coord/dispatch.js';
export class FleetWatcher {
  constructor(private readonly coord: CoordStore) {}
  dispatch(): number { return dispatchOnce(this.coord); }
}
` });
    expect(view(r)).toEqual({ ...none, reach: ['eta', 'zeta'], wholeReach: ['eta', 'zeta'], portReach: [] });
  });

  const ROUTES = `import type { CoordStore } from './store.js';
export interface CoordRoutesHandle { withSweep(coord: CoordStore, id: string): number }
export function registerRoutes(): CoordRoutesHandle {
  const withSweep: CoordRoutesHandle['withSweep'] = (coord, id) => coord.alpha() + id.length;
  return { withSweep };
}
`;
  const SERIAL_WATCH = (body: string, imports = ''): string => `${STORE_IMPORT}import type { CoordRoutesHandle } from './coord/routes.js';
${imports}export class FleetWatcher {
  constructor(private readonly coord: CoordStore, private readonly serial: CoordRoutesHandle['withSweep']) {}
${body}
}
`;

  it('a call through an interface method signature, on an indexed-type field, follows its implementation', () => {
    const r = fixture({ 'coord/routes.ts': ROUTES,
      'watch.ts': SERIAL_WATCH("  act(): number { return this.serial(this.coord, 'a'); }") });
    const key = 'watch.ts#FleetWatcher.act -> coord/routes.ts#CoordRoutesHandle.withSweep';
    expect(view(r)).toEqual({ ...none, reach: ['alpha'], wholeReach: ['alpha'], portReach: [],
      wholeHandoffs: { [key]: 1 }, chains: { [key]: ['coord/routes.ts#registerRoutes.withSweep'] } });
  });

  it('a call through a type-literal property filled from that field follows the same implementation', () => {
    const r = fixture({ 'coord/routes.ts': ROUTES,
      'coord/abandon.ts': `import type { CoordStore } from './store.js';
export interface AbandonDeps { coord: CoordStore; serial: (coord: CoordStore, id: string) => number }
export function abandonDead(deps: AbandonDeps): number { return deps.coord.beta() + deps.serial(deps.coord, 'b'); }
`,
      'watch.ts': SERIAL_WATCH('  step(): number { return abandonDead({ coord: this.coord, serial: this.serial }); }',
        "import { abandonDead } from './coord/abandon.js';\n") });
    const key = 'watch.ts#FleetWatcher.step -> coord/abandon.ts#abandonDead';
    expect(view(r)).toEqual({ ...none, reach: ['alpha', 'beta'], wholeReach: ['alpha', 'beta'], portReach: [],
      wholeHandoffs: { [key]: 1 },
      chains: { [key]: ['coord/routes.ts#registerRoutes.withSweep', 'coord/abandon.ts#abandonDead'] } });
  });

  it('a call through a signature with no implementation is reported unresolved', () => {
    const r = fixture({
      'coord/lone.ts': `import type { CoordStore } from './store.js';
export interface LoneHandle { lone(coord: CoordStore): number }
`,
      'watch.ts': `${STORE_IMPORT}import type { LoneHandle } from './coord/lone.js';
export class FleetWatcher {
  constructor(private readonly coord: CoordStore, private readonly handle: LoneHandle) {}
  ask(): number { return this.handle.lone(this.coord); }
}
` });
    const key = 'watch.ts#FleetWatcher.ask -> UNRESOLVED coord/lone.ts#LoneHandle.lone';
    expect(view(r)).toEqual({ ...none, reach: ['UNRESOLVED coord/lone.ts#LoneHandle.lone'],
      wholeReach: ['UNRESOLVED coord/lone.ts#LoneHandle.lone'], portReach: [], wholeHandoffs: { [key]: 1 },
      chains: { [key]: [] } });
  });

  it('a whole hand-off is followed through a function, `new` of a class, a carrier and a thunk, counted per site', () => {
    const r = fixture({
      'coord/mail.ts': `import type { CoordStore } from './store.js';
export function queueMail(coord: CoordStore): number { return coord.alpha(); }
export class JournalMirror {
  constructor(private readonly store: CoordStore) {}
  read(): number { return this.store.beta(); }
}
export function viaDeps(deps: { coord?: CoordStore; lane: string }): number { return deps.coord?.gamma() ?? 0; }
export class OrphanBeat {
  constructor(private readonly deps: () => { coord?: CoordStore }) {}
  beat(): number { return this.deps().coord?.delta() ?? 0; }
}
`,
      'watch.ts': `${STORE_IMPORT}import { JournalMirror, OrphanBeat, queueMail, viaDeps } from './coord/mail.js';
export interface WatchDeps { coord?: CoordStore; lane: string }
export class FleetWatcher {
  readonly orphanBeat = new OrphanBeat(() => this.deps);
  constructor(private readonly deps: WatchDeps) {}
  mail(): number { const coord = this.deps.coord!; return queueMail(coord) + queueMail(coord); }
  mirror(): JournalMirror { return new JournalMirror(this.deps.coord!); }
  carrier(): number { return viaDeps(this.deps); }
}
` });
    expect(view(r)).toEqual({ ...none, reach: ['alpha', 'beta', 'delta', 'gamma'],
      wholeReach: ['alpha', 'beta', 'delta', 'gamma'], portReach: [],
      wholeHandoffs: {
        'watch.ts#FleetWatcher.carrier -> coord/mail.ts#viaDeps': 1,
        'watch.ts#FleetWatcher.mail -> coord/mail.ts#queueMail': 2,
        'watch.ts#FleetWatcher.mirror -> coord/mail.ts#JournalMirror': 1,
        'watch.ts#FleetWatcher.orphanBeat -> coord/mail.ts#OrphanBeat': 1,
      },
      chains: {
        'watch.ts#FleetWatcher.carrier -> coord/mail.ts#viaDeps': ['coord/mail.ts#viaDeps'],
        'watch.ts#FleetWatcher.mail -> coord/mail.ts#queueMail': ['coord/mail.ts#queueMail'],
        'watch.ts#FleetWatcher.mirror -> coord/mail.ts#JournalMirror': ['coord/mail.ts#JournalMirror'],
        'watch.ts#FleetWatcher.orphanBeat -> coord/mail.ts#OrphanBeat': ['coord/mail.ts#OrphanBeat'],
      } });
    expect(r.bareAnnotations).toEqual({ 'watch.ts#WatchDeps': 1 });
  });

  it('a chain two functions deep is followed, and listed bottom-up', () => {
    const r = fixture({
      'coord/chain.ts': `import type { CoordStore } from './store.js';
export function outer(coord: CoordStore): number { return coord.alpha() + inner(coord); }
export function inner(coord: CoordStore): number { return coord.beta(); }
`,
      'watch.ts': `${STORE_IMPORT}import { outer } from './coord/chain.js';
export class FleetWatcher {
  constructor(private readonly coord: CoordStore) {}
  sweep(): number { return outer(this.coord); }
}
` });
    const key = 'watch.ts#FleetWatcher.sweep -> coord/chain.ts#outer';
    expect(view(r)).toEqual({ ...none, reach: ['alpha', 'beta'], wholeReach: ['alpha', 'beta'], portReach: [],
      wholeHandoffs: { [key]: 1 }, chains: { [key]: ['coord/chain.ts#inner', 'coord/chain.ts#outer'] } });
  });

  const PORT_MAIL = `import type { WatcherCoordPort } from './ports.js';
export function portMail(coord: WatcherCoordPort): number { return coord.alpha(); }
`;

  it('a hand-off to a port-typed parameter is followed, and what it reaches is port reach', () => {
    const r = fixture({ 'coord/portmail.ts': PORT_MAIL,
      'watch.ts': `import type { WatcherCoordPort } from './coord/ports.js';
import { portMail } from './coord/portmail.js';
export class FleetWatcher {
  constructor(private readonly coord: WatcherCoordPort) {}
  mail(): number { return portMail(this.coord) + this.coord.beta(); }
}
` });
    expect(view(r)).toEqual({ ...none, reach: ['alpha', 'beta'], wholeReach: [], portReach: ['alpha', 'beta'] });
  });

  it('a whole value whose contextual type is the port is a port entry and reaches nothing itself', () => {
    const r = fixture({ 'coord/portmail.ts': PORT_MAIL,
      'watch.ts': `${STORE_IMPORT}import type { WatcherCoordPort } from './coord/ports.js';
import { portMail } from './coord/portmail.js';
export class FleetWatcher {
  constructor(private readonly coord: CoordStore) {}
  enter(): boolean { const port: WatcherCoordPort = this.coord; return port !== undefined; }
  handIn(): number { return portMail(this.coord); }
}
` });
    expect(view(r)).toEqual({ ...none, reach: ['alpha'], wholeReach: [], portReach: ['alpha'],
      portEntries: { 'watch.ts#FleetWatcher.enter -> <slot>': 1,
        'watch.ts#FleetWatcher.handIn -> coord/portmail.ts#portMail': 1 } });
    expect(r.units['watch.ts#FleetWatcher.enter']).toEqual([]);
  });

  it('a call into the store class\'s own method is not followed', () => {
    const r = fixture({ 'watch.ts': `${STORE_IMPORT}export class FleetWatcher {
  constructor(private readonly coord: CoordStore) {}
  read(): number { return this.coord.run('a') + this.coord.adopt(this.coord); }
}
` });
    expect(view(r)).toEqual({ ...none, reach: ['adopt', 'run'], wholeReach: ['adopt', 'run'], portReach: [] });
  });

  it('a computed element access on a store value is reported as the member [<expr>]', () => {
    const r = fixture({ 'watch.ts': `${STORE_IMPORT}export class FleetWatcher {
  constructor(private readonly coord: CoordStore) {}
  read(k: 'alpha' | 'beta'): number { return this.coord[k]() + this.coord['gamma'](); }
}
` });
    expect(view(r)).toEqual({ ...none, reach: ['[k]', 'gamma'], wholeReach: ['[k]', 'gamma'], portReach: [] });
  });
});

describe('the store census on the real tree (D-7578)', () => {
  let census: StoreReach;
  beforeAll(() => {
    census = storeReach({
      tsconfig: path.join(REPO, 'server/tsconfig.json'), base: path.join(REPO, 'server/src'),
      scope: ['watch.ts', '*Lane.ts', 'lane*.ts'],
      store: { file: 'coord/store.ts', name: 'CoordStore' },
      port: { file: 'coord/ports.ts', name: 'WatcherCoordPort' },
    });
  });

  it('the program type-checks under the scanner\'s parser', () => {
    expect(census.diagnostics, 'the census reads types from a program TypeScript 6 cannot check').toEqual([]);
  });

  it('the walk covers the watcher and every lane file', () => {
    expect(census.files.length).toBeGreaterThanOrEqual(12);
    expect(census.files).toContain('watch.ts');
    expect(Object.keys(census.units).length).toBeGreaterThanOrEqual(150);
    expect(Object.keys(census.units)).toContain('watch.ts#FleetWatcher.tick');
  });

  /** Prints the census's set against the record and, under WATCHER_PORT_STRICT=1, asserts it exactly. */
  const reportSet = (what: string, got: readonly string[], record: readonly string[], name: string,
    where: string = DATA): void => {
    const added = got.filter((m) => !record.includes(m));
    const gone = record.filter((m) => !got.includes(m));
    console.log(`${what}: ${got.length} (record ${record.length}); new: ${added.join(', ') || 'none'}; `
      + `gone: ${gone.join(', ') || 'none'}`);
    if (STRICT) {
      expect({ new: added, gone }, `${what}: the census differs from ${name}; a series task writes what it `
        + `measures into ${where} (${name})`).toEqual({ new: [], gone: [] });
    }
  };

  it('report: what the watcher and its lane files reach, against WatcherCoordPort\'s members', () => {
    const sum = (r: Record<string, number>): number => Object.values(r).reduce((a, b) => a + b, 0);
    console.log(`port reach: ${census.portReach.length}; port members: ${census.portMembers.length}; port entries: `
      + `${sum(census.portEntries)}; bare CoordStore annotations in scope: ${sum(census.bareAnnotations)}`);
    // D-7579 (WP2): the record is the port's own member list, read by the checker. `new` is a reached member the port
    // lacks; `gone` is a port member nothing reaches; with the port absent, every reached member is `new`.
    reportSet(census.portMembers.length === 0 ? 'reach (the port is absent)' : 'reach', census.reach,
      census.portMembers, 'WatcherCoordMember', PORTS_FILE);
  });

  it('WatcherCoordMember is sorted and has no duplicate', () => {
    const alias = parseFile(path.join(REPO, PORTS_FILE)).exportedTypeAliases
      .find((a) => a.name === 'WatcherCoordMember');
    const members = alias?.literals ?? null;
    expect(members, `${PORTS_FILE} declares no WatcherCoordMember literal union`).not.toBeNull();
    const sorted = [...new Set(members)].sort();
    expect(members, `WatcherCoordMember (${PORTS_FILE}) is out of order or holds a duplicate`).toEqual(sorted);
  });

  it('report: what they reach through Deps.coord\'s whole store, against WATCHER_WHOLE_REACH', () => {
    reportSet('whole reach', census.wholeReach, WATCHER_WHOLE_REACH, 'WATCHER_WHOLE_REACH');
  });

  it('report: where they hand the whole store on, against WATCHER_WHOLE_HANDOFFS', () => {
    const got = census.wholeHandoffs;
    const keys = [...new Set([...Object.keys(got), ...Object.keys(WATCHER_WHOLE_HANDOFFS)])].sort();
    const differs = keys.filter((k) => got[k] !== WATCHER_WHOLE_HANDOFFS[k])
      .map((k) => `${k}: ${WATCHER_WHOLE_HANDOFFS[k] ?? 0} -> ${got[k] ?? 0}`);
    const sites = Object.values(got).reduce((a, b) => a + b, 0);
    console.log(`whole hand-offs: ${sites} sites in ${Object.keys(got).length} keys (record `
      + `${Object.values(WATCHER_WHOLE_HANDOFFS).reduce((a, b) => a + b, 0)} in `
      + `${Object.keys(WATCHER_WHOLE_HANDOFFS).length}); differs: ${differs.join('; ') || 'none'}`);
    if (STRICT) {
      expect(differs, `whole hand-offs differ from WATCHER_WHOLE_HANDOFFS (record -> census); a series task writes `
        + `what it measures into ${DATA}`).toEqual([]);
    }
  });
});
