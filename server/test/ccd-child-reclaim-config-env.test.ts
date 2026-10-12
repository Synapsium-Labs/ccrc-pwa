// Child reclamation wave 6, Task 1 (spec §5.6, F6): the OUTERMOST
// `_ws_reclaim_contained` unsets an inherited GIT_CONFIG_PARAMETERS,
// GIT_CONFIG and GIT_CONFIG_COUNT BEFORE it computes its own count, so its
// three pins are the only entries. Measured on git 2.43.0:
// GIT_CONFIG_PARAMETERS overrides the hooksPath pin; GIT_CONFIG redirects the
// containment's two `git config` reads (extensions.refStorage in
// `_ws_reclaim_keep_reflogs`, core.fileMode in the WIP commit); a caller's
// count carries entries to those same reads; and once the count is unset a
// stale KEY_<n>/VALUE_<n> does nothing. The variables reach ccd through the
// harness's explicit `env`, which the harness strip (Task 2) never touches.
// Every case runs in a fixture HOME; nothing here deletes anything.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
let repo: string;
beforeEach(() => { h = makeCcdHarness('ccrc-child-reclaim-config-env-'); repo = h.makeRepo('demo'); });
afterEach(() => { h.cleanup(); });

/** A config file that disagrees with the repository on every key the reads below ask. */
const altConfig = (): string => {
  const f = path.join(h.home, 'alt.gitconfig');
  fs.writeFileSync(f, '[extensions]\n\trefStorage = reftable\n[core]\n\tfileMode = false\n\thooksPath = /from-git-config\n');
  return f;
};
const PARAMETERS = (): Record<string, string> => ({
  GIT_CONFIG_PARAMETERS: "'core.hookspath'='/from-parameters' 'core.filemode'='false' 'extensions.refstorage'='reftable'",
});
const CONFIG_FILE = (): Record<string, string> => ({ GIT_CONFIG: altConfig() });
const COUNT = (): Record<string, string> => ({
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: 'extensions.refStorage', GIT_CONFIG_VALUE_0: 'reftable',
  GIT_CONFIG_KEY_1: 'core.fileMode', GIT_CONFIG_VALUE_1: 'false',
});
const INHERITED: Record<string, () => Record<string, string>> = {
  GIT_CONFIG_PARAMETERS: PARAMETERS,
  GIT_CONFIG: CONFIG_FILE,
  'GIT_CONFIG_COUNT and its entries': COUNT,
  'all three at once': () => ({ ...PARAMETERS(), ...CONFIG_FILE(), ...COUNT() }),
};

/** What a git beneath the containment inherits of the three, and the first entry. */
const SHOW = `bash -c 'printf "%s|%s|%s|%s=%s" "\${GIT_CONFIG_PARAMETERS-unset}" "\${GIT_CONFIG-unset}"`
  + ` "\${GIT_CONFIG_COUNT-unset}" "\${GIT_CONFIG_KEY_0-unset}" "\${GIT_CONFIG_VALUE_0-unset}"'`;

describe('F6: the outermost containment starts from no inherited config entry (spec §5.6)', () => {
  it.each(Object.keys(INHERITED))('inherited %s: the three pins are the only entries, and both config reads see the repository', (name) => {
    const env = INHERITED[name]!();
    expect(h.sh(`git -C "${repo}" config --bool --get core.fileMode`, env),
      'the CONTROL: uncontained, the inherited variable reaches the read').toBe('false');
    expect(h.sh(`_ws_reclaim_contained ${SHOW}`, env), 'what a git beneath the containment inherits')
      .toBe('unset|unset|3|core.hooksPath=/dev/null');
    expect(h.sh(`_ws_reclaim_contained git -C "${repo}" rev-parse --git-path hooks`, env), 'the hook pin').toBe('/dev/null');
    expect(h.sh(`_ws_reclaim_contained git -C "${repo}" config --bool --get core.fileMode`, env),
      'the WIP commit’s core.fileMode read').toBe('true');
    expect(h.sh(`_ws_reclaim_contained _ws_reclaim_keep_reflogs "${repo}" demo-f6; printf '%s|%s' "$?" "$_WS_KEEP_WHY"`, env),
      'the keep’s extensions.refStorage read').toBe('0|');
  }, 60_000);

  it('a stale GIT_CONFIG_KEY_<n>/VALUE_<n> past the count is inert — the count starts at 0', () => {
    const env = {
      GIT_CONFIG_COUNT: '4',
      GIT_CONFIG_KEY_0: 'ccrc.f6a', GIT_CONFIG_VALUE_0: '1', GIT_CONFIG_KEY_1: 'ccrc.f6b', GIT_CONFIG_VALUE_1: '1',
      GIT_CONFIG_KEY_2: 'ccrc.f6c', GIT_CONFIG_VALUE_2: '1', GIT_CONFIG_KEY_3: 'ccrc.f6stale', GIT_CONFIG_VALUE_3: 'live',
    };
    expect(h.sh(`git -C "${repo}" config --get ccrc.f6stale`, env), 'the CONTROL: the inherited entry is live').toBe('live');
    expect(h.sh(`_ws_reclaim_contained bash -c 'v=$(git -C "$0" config --get ccrc.f6stale); printf "%s|%s" "\${v:-absent}" "$GIT_CONFIG_COUNT"' "${repo}"`, env))
      .toBe('absent|3');
  }, 60_000);

  it('a NESTED containment appends its three to the outer’s three, and the outer’s pins hold after it returns', () => {
    const env = PARAMETERS();
    expect(h.sh(`inner() { _ws_reclaim_contained bash -c 'printf "%s|%s" "$GIT_CONFIG_COUNT" "\${GIT_CONFIG_PARAMETERS-unset}"'; };`
      + ' _ws_reclaim_contained inner', env)).toBe('6|unset');
    expect(h.sh(`outer() { _ws_reclaim_contained true; git -C "${repo}" rev-parse --git-path hooks; }; _ws_reclaim_contained outer`, env),
      'a nested containment took the outer’s count with it').toBe('/dev/null');
  }, 60_000);

  it('a caller’s LOCAL count is unset, never shadowed — and so is the exported one under it', () => {
    const env = { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'ccrc.f6a', GIT_CONFIG_VALUE_0: '1', GIT_CONFIG_KEY_1: 'ccrc.f6b', GIT_CONFIG_VALUE_1: '1' };
    expect(h.sh(`shadow() { local -x GIT_CONFIG_COUNT=1; _ws_reclaim_contained bash -c 'printf "%s" "$GIT_CONFIG_COUNT"'; }; shadow`, env))
      .toBe('3');
  }, 60_000);
});
