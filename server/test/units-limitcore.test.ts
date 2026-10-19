// Accounts plan Task A8 (spec §13.2 "Units", G22; D-5513): no core dumps from the server or the agent. Both
// processes hold secrets in memory on their way to stdin (a pasted key, a sign-in code, the agent's bearer), and a
// core file is that memory written to disk, outside the 0600 file the secret's one path ends in.
//
// The units are FOUND BY CONTENT, never listed by hand: every tracked unit file whose `ExecStart=` runs the server's
// or the agent's entry point (`…/server/dist/server/src/index.js`, `…/agent/dist/agent/src/index.js`) is one, and so
// is every `deploy/<unit>` that `ccrc install` (`_inst_units`) or `deploy/deploy.sh` copies onto a box. A third unit
// that starts either process is in this sweep the day it lands.
//
// macOS (D-5622): `ccrc install`'s launchd job (`_inst_plist_server`, `ccd/ccrc`) is generated in a file a gating PR
// still holds, so it gains no explicit `Core` limit here. launchd starts a job with a soft core limit of 0, and the
// last case pins that the generated job raises no resource limit, so the platform's 0 stands until the plist carries
// its own.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENTRY_RE = /^ExecStart=.*\/(?:server\/dist\/server|agent\/dist\/agent)\/src\/index\.js\s*$/m;
const UNIT_SUFFIX_RE = /\.(?:service|conf)$/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.git')) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (UNIT_SUFFIX_RE.test(name)) out.push(p);
  }
  return out;
}

/** The `[Service]` section's own lines (up to the next section header). */
function serviceSection(text: string): string {
  const at = text.search(/^\[Service\]\s*$/m);
  if (at < 0) return '';
  const rest = text.slice(at).split('\n').slice(1);
  const end = rest.findIndex((l) => /^\[[A-Za-z]+\]\s*$/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

/** Every tracked unit that starts the server or the agent, by content. */
const byContent = ['deploy', 'ccd']
  .flatMap((d) => walk(path.join(REPO, d)))
  .filter((f) => ENTRY_RE.test(readFileSync(f, 'utf8')))
  .map((f) => path.relative(REPO, f))
  .sort();

/** Every `deploy/<x>.service` an installer copies onto a box: `_inst_units`' `role_unit` values and the files
 *  `deploy/deploy.sh` names. */
const ccrc = readFileSync(path.join(REPO, 'ccd', 'ccrc'), 'utf8');
const deploySh = readFileSync(path.join(REPO, 'deploy', 'deploy.sh'), 'utf8');
const installed = [...new Set([
  ...[...ccrc.matchAll(/\brole_unit=([A-Za-z0-9@.-]+\.service)\b/g)].map((m) => `deploy/${m[1]}`),
  ...[...deploySh.matchAll(/\bdeploy\/(ccrc[A-Za-z0-9@.-]*\.service)\b/g)].map((m) => `deploy/${m[1]}`),
])].sort();

describe('LimitCORE=0 on every server and agent unit (spec §13.2, G22)', () => {
  it('the sweep finds the server unit and the agent unit by content (the control: an empty sweep checks nothing)', () => {
    expect(byContent).toEqual(expect.arrayContaining(['deploy/ccrc.service', 'deploy/ccrc-agent.service']));
    expect(installed).toEqual(expect.arrayContaining(['deploy/ccrc.service', 'deploy/ccrc-agent.service']));
  });

  it('every unit an installer copies onto a box is one the sweep found, so none starts a process outside it', () => {
    for (const u of installed) expect(byContent, `${u} is installed but starts neither process`).toContain(u);
  });

  for (const unit of [...new Set([...byContent, ...installed])].sort()) {
    it(`${unit} carries LimitCORE=0 in its [Service] section`, () => {
      const service = serviceSection(readFileSync(path.join(REPO, unit), 'utf8'));
      expect(service, `${unit} has no [Service] section`).not.toBe('');
      expect(service, `${unit} lacks LimitCORE=0`).toMatch(/^LimitCORE=0\s*$/m);
      expect(service.match(/^LimitCORE=/gm)?.length, `${unit} sets LimitCORE twice`).toBe(1);
    });
  }

  it("no drop-in raises the agent's or the server's core limit back", () => {
    for (const f of walk(path.join(REPO, 'deploy')).filter((p) => /ccrc(?:-agent)?\.service\.d\//.test(p))) {
      expect(readFileSync(f, 'utf8'), path.relative(REPO, f)).not.toMatch(/^LimitCORE=(?!0\s*$)/m);
    }
  });

  it("macOS: the launchd job `ccrc install` writes raises no resource limit, so launchd's soft core limit of 0 stands (D-5622)", () => {
    const at = ccrc.indexOf('_inst_plist_server() {');
    expect(at, '_inst_plist_server not found').toBeGreaterThanOrEqual(0);
    const body = ccrc.slice(at, ccrc.indexOf('\n}\n', at));
    expect(body, 'the cut is the plist generator').toMatch(/<key>ProgramArguments<\/key>/);
    expect(body).not.toMatch(/ResourceLimits/);
  });
});
