// Build capture runner spec docs/superpowers/specs/2026-11-22-build-capture-runner-design.md §2.2, Table 2, D3. L3: the
// production adapter of the capture lane's copy port (`buildCaptureLane.ts#BuildCopyTransport`). It runs ONE admin lane sub,
// `ccrc testbox-admin build-copy --version=<build>` (ccd/testbox-build-copy), through the one `TestboxAdminOps` arm the
// composition root chose, and maps what it came to onto the port's words. It never sequences a second op: when to copy is
// `shared/claudeBuildTrust.ts#captureNextAct`'s decision, carried out by the lane. A lane source of its own.
//
// THE MAPPING, every row (a copy sends no capture, so each failure is a not-sent word and counts no attempt):
//   - the verb exited cleanly with `ok: true`, the requested build and a digest ................. `copied`
//   - a refusal of the fleet's own copy (`build-not-on-fleet`, `build-not-regular`,
//     `build-too-large`): nothing reached the box, and trying again changes nothing ........... `copy-refused`
//   - a refusal that says no lane is there to carry it (`not-connected`, `no-access-key`) ..... `no-admin-lane`
//   - an agent or a server-side arm that has no such op (`unsupported`) ...................... `no-admin-lane`
//   - every other refusal (`build-hash-mismatch`, `build-store-refused`, `build-copy-failed`, `busy`, the lane's own
//     ssh codes such as `unreachable` or `host-key-changed`), an exit off the verb's grammar,
//     a builder refusal, a frame that never left, a deadline or a lost answer ................. `copy-failed`
// A copy whose answer says the box replaced a link at the build's name (`"replaced":"link"`, capture runner PR 3b's fix
// round 1) is `copied` like any other, and this adapter writes one server log line saying so.
// A lost answer may have placed the build after all: the next capture finds out, since the box answers `build-absent` only
// for a build it does not hold.
// THE FOLD, and why it is safe: the lane needs only whether to try again within the hour, which every not-sent word answers
// the same way, and it counts no attempt for any of them. What tells the operator why is the verb's own code, which this
// adapter writes into one server log line on every typed refusal (and the fleet host's admin log keeps with the box's word).
import type { BuildCopyAnswer, BuildCopyTransport } from './buildCaptureLane.js';
import type { TestboxAdminOps } from './testboxAdmin.js';

const REFUSED: ReadonlySet<string> = new Set(['build-not-on-fleet', 'build-not-regular', 'build-too-large']);
const NO_LANE: ReadonlySet<string> = new Set(['not-connected', 'no-access-key']);

/** A refusal code as the log line carries it: the verb's word when it is one, never free text from the answer. */
const codeWord = (code: string): string => (/^[a-z0-9-]{1,64}$/.test(code) ? code : 'unreadable');

/** The verb's last line: null if it does not describe this copy or a typed refusal. */
function answerLine(stdout: string, build: string): { readonly ok: true; readonly replacedLink: boolean } | { readonly ok: false; readonly code: string } | null {
  const text = stdout.trim();
  const last = text.slice(text.lastIndexOf('\n') + 1);
  try {
    const j: unknown = JSON.parse(last);
    if (typeof j !== 'object' || j === null || Array.isArray(j)) return null;
    const o = j as Record<string, unknown>;
    if (o['ok'] === true && o['build'] === build && typeof o['sha256'] === 'string' && /^[0-9a-f]{64}$/.test(o['sha256'])) {
      return { ok: true, replacedLink: o['replaced'] === 'link' };
    }
    if (o['ok'] === false && typeof o['code'] === 'string') return { ok: false, code: o['code'] };
  } catch { /* not the verb's line */ }
  return null;
}

/** The production adapter: `ops` is read at each call; absent (no arm chosen) answers `no-admin-lane`. Never rejects. */
export function testboxBuildCopy(ops: () => Pick<TestboxAdminOps, 'run'> | undefined): BuildCopyTransport {
  return {
    copy: async (job): Promise<BuildCopyAnswer> => {
      try {
        const arm = ops();
        if (arm === undefined) return 'no-admin-lane';
        const ran = await arm.run('build-copy', { version: job.build });
        if (ran.kind === 'unsupported') return 'no-admin-lane';
        if (ran.kind !== 'exited') return 'copy-failed';
        const line = answerLine(ran.stdout, job.build);
        if (line === null) return 'copy-failed';
        if (line.ok) {
          if (ran.code !== 0) return 'copy-failed';
          if (line.replacedLink) console.warn(`ccrc-server: build copy of ${job.build}: the test box replaced a link at the build's name with the build`);
          return 'copied';
        }
        const word: BuildCopyAnswer = REFUSED.has(line.code) ? 'copy-refused' : NO_LANE.has(line.code) ? 'no-admin-lane' : 'copy-failed';
        // The fold keeps the lane's one not-sent word; the verb's own code survives in this one line (and the admin log).
        console.warn(`ccrc-server: build copy of ${job.build} refused by the test box admin lane: ${codeWord(line.code)} (recorded as ${word})`);
        return word;
      } catch {
        return 'copy-failed';
      }
    },
  };
}
