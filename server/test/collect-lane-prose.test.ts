// Child reclamation wave 9: what the operator documents say about the temp-root collector's lane (spec 2026-09-22
// §5.10, §8). The lane ships shadowed, so every sentence that said nothing composes the verb is gone, and the arming
// checklist stands where the operator reads it. Run 358's prose pins (`expiry-lane-prose`, `dead-coordinator-prose`)
// own the cleanup-pause sentences this wave extends; this wave runs them and never edits them.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const flat = (f: string): string => readFileSync(path.join(root, f), 'utf8').replace(/\s+/g, ' ');
const SPEC = 'docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md';

describe('README: the temp-root collector', () => {
  const readme = flat('README.md');
  it('no sentence says the verb is inert or that nothing composes it', () => {
    for (const gone of ['shipped inert).**', 'no server code composes the verb until', 'nothing composes it yet',
      'nothing composes it in this build']) expect(readme, gone).not.toContain(gone);
  });
  it('says the lane composes it, shadowed behind a file nothing in the tree writes', () => {
    expect(readme).toContain("**The collector's lane (child reclamation wave 9) ships shadowed.**");
    expect(readme).toContain('until the operator touches that file by hand in the registry the server reads');
    expect(readme).toContain('and never composes `ws-collect`');
    expect(readme).toContain('only after two audits at least a sweep interval apart minted the same token');
    expect(readme).toContain('`$REG/reclaim-paused` stops the lane, shadow included');
    expect(readme).toContain('runs at most two learning audits and one act job');
    expect(readme).toContain('no act job, shadow included, is offered in the first eight minutes after the server starts');
  });
  it('carries the three-item checklist before arming', () => {
    expect(readme).toContain('**Before arming it**, read the shadow feed rows, and arm only when:');
    expect(readme).toContain('every "would collect" names an orphan whose run is closed;');
    expect(readme).toContain('except the one for temp roots whose runs the coordination database cannot vouch for, which may stand once you have read it');
    expect(readme).toContain('you know that any process of this uid can touch `$REG/collect-lane-live`');
  });
  it('names the collector among what the cleanup pause stops, keeping run 358’s pinned words', () => {
    expect(readme).toContain('and the expiry of archived workspaces stops too, as does the dead-coordinator lane, and so does the temp-root collector’s lane');
    expect(readme).toContain('`ws-reclaim` and `ws-collect`, each token-gated the same way, are composed by the server alone');
  });
});

describe('the design spec', () => {
  const s = flat(SPEC);
  it('§5.10 describes the lane as built, and the inert sentences are gone', () => {
    expect(s).toContain("**The server's lane (wave 9), as built.**");
    expect(s).toContain('`$REG/collect-lane-live`');
    for (const gone of ['Wave 7 ships it inert, and no lane composes it until wave 9', 'a builder that nothing calls',
      'the lane audits every pass', "arried to wave 9's pre-flight list", "on every pass for the child's life"]) {
      expect(s, gone).not.toContain(gone);
    }
  });
  it('the audit budget pays one grace: about 73 seconds, 78 at the widest (as built, wave 9)', () => {
    expect(s).not.toContain('about 79 seconds');
    expect(s).toContain('about 73 seconds, or 78 at the widest grace');
  });
  it('states the offer order, the start hold-off at the offer, the flat hold and the restart residual (as built, wave 9)', () => {
    expect(s).toContain("No act job, shadow's would-collect included, is offered within eight minutes of the lane's start.");
    expect(s).toContain('Each pass offers the act job first, to the earliest ripe id by its ripening instant and then id');
    expect(s).toContain('The pass never awaits a call it queued.');
    expect(s).toContain('A hold waits one ceiling flat.');
    expect(s).toContain('about eight extra journaled terminal audits or failing acts per such id');
  });
  it('Appendix A cites the presence constants at the lines that hold them', () => {
    const m = /`PRESENCE_REFRESH_MS = 15_000`, `PRESENCE_TTL_MS = 45_000` \(`shared\/api\.ts:(\d+)-(\d+)`\)/.exec(s);
    expect(m, 'the citation is gone').not.toBeNull();
    const api = readFileSync(path.join(root, 'shared/api.ts'), 'utf8').split('\n');
    expect(api[Number(m![1]) - 1]).toContain('export const PRESENCE_REFRESH_MS = 15_000;');
    expect(api[Number(m![2]) - 1]).toContain('export const PRESENCE_TTL_MS = 45_000;');
  });
});

describe('the programme’s rulings file', () => {
  it('carries the wave’s as-built note, naming slugs and no number', () => {
    const c = readFileSync(path.join(root, 'docs/superpowers/programs/child-reclamation-contract.md'), 'utf8');
    const at = c.indexOf('### §16 as built (wave 9, run 380)');
    expect(at, 'the as-built note is missing').toBeGreaterThan(-1);
    expect(c.slice(at)).not.toMatch(/\bD-\d/);
  });
});
