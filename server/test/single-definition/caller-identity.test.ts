// Gates A, review F6: the attribution adapter is composed once, in server.ts. A second construction could supply
// permissive attribution dependencies and mint actors without measurement. Scan parsed calls, not comments or strings.
// Known width: calls named attributionIdentity are pinned; an intentionally renamed import is outside this census.
import { describe, it, expect } from 'vitest';
import { ALL, rel } from './helpers.js';
import { parseSource, type ParsedFile } from '../scan/parse.js';
import { parsedFile } from '../scan/symbols.js';

const HOME = 'server/src/server.ts';
const constructions = (file: ParsedFile): number => file.calls.filter((c) => c.name === 'attributionIdentity').length;
const outsideHome = (file: string, parsed: ParsedFile): boolean => file !== HOME && constructions(parsed) > 0;

describe('CallerIdentity has one measured composition, in server.ts', () => {
  it('only server.ts constructs the attribution adapter, exactly once', () => {
    const files = ALL.map(rel).filter((f) => f.startsWith('server/src/'));
    expect(files.filter((f) => outsideHome(f, parsedFile(f)))).toEqual([]);
    expect(constructions(parsedFile(HOME))).toBe(1);
  });
  it('CONTROL: a planted second construction is refused outside the composition root', () => {
    const source = 'const identity = attributionIdentity({ attribute: async () => ({ ok: true }) });';
    const planted = 'server/src/auth/planted.ts';
    expect(outsideHome(planted, parseSource(source, planted))).toBe(true);
    expect(outsideHome(HOME, parseSource(source, HOME))).toBe(false);
    expect(outsideHome(planted, parseSource('// attributionIdentity(deps)\nconst text = "attributionIdentity(deps)";', planted))).toBe(false);
  });
});

// Gates B, carry of gates A review F4: the account gate is the one minter of an operator-strength account-gate actor, so the
// only `server/src` caller of `gateActorOf` is `accounts/gate.ts`, once.
const GATE_HOME = 'server/src/accounts/gate.ts';
const gateMints = (file: ParsedFile): number => file.calls.filter((c) => c.name === 'gateActorOf').length;

describe('the account gate is the one caller of gateActorOf in server/src', () => {
  it('only accounts/gate.ts calls gateActorOf, exactly once', () => {
    const files = ALL.map(rel).filter((f) => f.startsWith('server/src/') && f !== GATE_HOME);
    expect(files.filter((f) => gateMints(parsedFile(f)) > 0)).toEqual([]);
    expect(gateMints(parsedFile(GATE_HOME))).toBe(1);
  });
  it('CONTROL: a planted call elsewhere is counted', () => {
    expect(gateMints(parseSource("const a = gateActorOf('ccrc server', '');", 'server/src/planted.ts'))).toBe(1);
  });
});
