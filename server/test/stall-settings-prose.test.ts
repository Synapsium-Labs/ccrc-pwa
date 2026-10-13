/**
 * STALL WATCH SETTINGS, the documents (design 2026-10-05, §1's Related block, §18's W1 edit lists, §20). W1 Task 7.
 *
 * README, CLAUDE.md and the parent stall-watch spec each say what a level and a quiet time chosen in Settings do to the
 * markers they describe. Every number below is derived from the constant it names, never typed, so a change to the
 * constant reds the sentence that states it (`readme-holds.test.ts`'s founding lesson). Every marker name comes from
 * its definer's export, as in `stall-settings.test.ts`, so this file is never a second holder of a marker spelling.
 *
 * The helpers are local, for the reason `crossrepo-prose.test.ts` gives: `server/test` is not one of
 * `single-definition.test.ts`'s four roots, and a shared slicer would couple unrelated ratchets.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECK_UNDELIVERED_MS, FAILED_REPEAT_MS, STALL_BACKOFF_CEILING_MS, STALL_MARKERS, STALL_QUIET_MS } from '../src/coord/stall.js';
import { STALL_QUIET_MAX_MS, STALL_QUIET_MIN_MS } from '../src/coord/stallsettings.js';
import { MAIL_GATE_BUSY_MARKER, MAIL_GATE_STRICT_MARKER } from '../src/turnidle.js';
import { MAIL_DISABLED_MARKER } from '../src/coord/rundefs.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(path.join(REPO, rel), 'utf8');

/** Hard-wrapped prose read as one line, so a re-wrap never reds a row and a row never depends on a wrap. */
const flat = (s: string): string => s.replace(/\s+/g, ' ');

/** A named window of a document, from one distinctive marker to the next, so a match elsewhere in a long file cannot
 *  satisfy a row about this passage. Both anchors are asserted with their own message. */
const passage = (name: string, text: string, from: string, to: string): string => {
  const a = text.indexOf(from);
  expect(a, `${name}: the opening anchor is gone`).toBeGreaterThan(-1);
  const b = text.indexOf(to, a + from.length);
  expect(b, `${name}: the closing anchor is gone`).toBeGreaterThan(a);
  return flat(text.slice(a, b));
};

const [KILL, LIVE, ESCALATE, W2LIVE] = STALL_MARKERS as [string, string, string, string];
const STRICT = MAIL_GATE_STRICT_MARKER;
const BUSY = MAIL_GATE_BUSY_MARKER;
const MAIL_OFF = MAIL_DISABLED_MARKER;

const hours = (ms: number): string => {
  expect(ms % 3_600_000, `${ms} ms is not a whole number of hours`).toBe(0);
  return `${ms / 3_600_000} h`;
};
const minutes = (ms: number): string => {
  expect(ms % 60_000, `${ms} ms is not a whole number of minutes`).toBe(0);
  return `${ms / 60_000} min`;
};

/** The quiet time's one definition in prose: the built-in, then the range the server accepts. */
const QUIET_DEFINED = `for the quiet time (${hours(STALL_QUIET_MS)} unless Settings sets another, `
  + `${minutes(STALL_QUIET_MIN_MS)} to ${hours(STALL_QUIET_MAX_MS)})`;
/** The precedence the resolver keeps (§6.3), stated once for the documents. */
const NEVER_OVER = `never \`${KILL}\`, \`${MAIL_OFF}\` or \`${STRICT}\``;
/** §18's qualifying clause for a runbook `rm` whose marker a chosen level overrides. */
const WHILE_FOLLOWING = 'while Settings follows the fleet box\'s files; otherwise lower the level in Settings, or on the '
  + `fleet box touch \`${STRICT}\` (busy delivery) or \`${KILL}\` (the whole lane)`;
/** The built-in quiet time, standing alone: not the tail of `12 h` or of `12.5 h`. */
const BUILT_IN_ALONE = new RegExp(`(?<![\\d.])${hours(STALL_QUIET_MS)}\\b`, 'g');

const README = read('README.md');
const STALL = passage('README, the stall watch', README, '**The stall watch.**', '**What the skills do with the watch');
const GATE = passage('README, the mail gate', README, `\`touch $REG/${STRICT}\` on the fleet host`, '`/api/mail` (and its ack route)');
const WAVE2 = passage('README, the stall watch wave 2', README, '**The stall watch, wave 2.**', '**The honest boundary.**');

describe('README: the stall watch paragraph says the quiet time is chosen in Settings (§7, §18)', () => {
  it('r1 names the quiet time once, with the built-in and the range derived from the constants', () => {
    expect(STALL).toContain(`its main loop has sat \`idle\` or \`shell\` ${QUIET_DEFINED} with no mail either way`);
  });

  it('the dialog cap and the two check-rate sentences say the quiet time, and no other built-in 2 h is left', () => {
    expect(STALL).toContain('push per dialog after the quiet time)');
    expect(STALL).toContain('at least once per quiet time keeps r1 from ever falling due');
    expect(STALL).toContain('draws a check about once per quiet time');
    expect(STALL.match(BUILT_IN_ALONE), 'the built-in quiet time is spelled only inside its definition').toHaveLength(1);
  });

  it('the backoff names its peak, the ceiling, and no longer the old 8 h', () => {
    expect(STALL).toContain(`doubles it, then doubles it again, never past ${hours(STALL_BACKOFF_CEILING_MS)},`);
    expect(STALL).not.toContain('8 h at most');
  });

  it('a level chosen in Settings overrides the arming markers, never the three that win over it', () => {
    expect(STALL).toContain('A level chosen in Settings (`/api/coord/stall-watch`) overrides the arming markers (');
    expect(STALL).toContain(NEVER_OVER);
  });
});

describe('README: the mail gate paragraph and the runbooks say a chosen level can stand behind a marker (§18, §20)', () => {
  it('strict\'s runbook says removing it lets a held choice apply, not merely that it goes back', () => {
    expect(GATE).not.toContain(`\`touch $REG/${STRICT}\` on the fleet host restores the idle-only gate; \`rm\` it to go back.`);
    expect(GATE).toContain('`rm` it to lift it: under a level chosen in Settings, whatever of that level it held back');
  });

  it('the busy gate sits behind two more markers or a level chosen in Settings', () => {
    expect(GATE).toContain('only behind two more markers, touched and removed by hand and written by nothing in the '
      + 'tree, or a level chosen in Settings.');
  });

  it('the override sentence names the busy markers it overrides and the three it never does', () => {
    expect(GATE).toContain('A level chosen in Settings (`/api/coord/stall-watch`) overrides both busy markers');
    expect(GATE).toContain(NEVER_OVER);
  });

  it('the busy runbook\'s rm is qualified with §18\'s clause', () => {
    expect(GATE).toContain(`\`rm ${BUSY}\` goes back ${WHILE_FOLLOWING}.`);
  });

  it('the wave-2 runbook\'s rm is qualified with the same clause', () => {
    expect(WAVE2).toContain(`before touching \`${W2LIVE}\``);
    expect(WAVE2).toContain(`\`rm\` it to go back to wave 1's ladder ${WHILE_FOLLOWING}.`);
  });

  it('CONTROL: the two fixed 2 h constants stay fixed sentences, untouched by the quiet time', () => {
    expect(WAVE2).toContain(`a second within ${hours(FAILED_REPEAT_MS)} goes to the coordinator`);
    expect(WAVE2).toContain(`the check sits undelivered for ${hours(CHECK_UNDELIVERED_MS)};`);
  });
});

describe('CLAUDE.md: the override and the loss list (§18)', () => {
  const CLAUDE = read('CLAUDE.md');

  it('the mail-gate bullet says a level chosen in Settings overrides the arming markers, and the markers keep no writer', () => {
    const bullet = passage('CLAUDE.md, the mail-gate bullet', CLAUDE,
      "- **The mail gate's idle includes `shell`, and a stall watch backs it**", '- **Done-fingerprint re-measures');
    expect(bullet).toContain('A level chosen in Settings (`/api/coord/stall-watch`, the operator\'s control) overrides the '
      + `arming markers, but ${NEVER_OVER}; the markers still have no writer.`);
  });

  it('the coord.db bullet lists the stall-watch settings choice among what a lost database loses', () => {
    const bullet = passage('CLAUDE.md, the coord.db bullet', CLAUDE, '- `~/.ccrc/coord.db`:', '- **Zero new ccd verbs');
    expect(bullet).toContain('mail, claims, asks, central pool edges, update intents, the stall-watch settings choice — is '
      + 'gone without the snapshot');
  });
});

describe('the parent stall-watch spec: the pointer and the three amended passages (§1 Related, §18)', () => {
  const PARENT = read('docs/superpowers/specs/2026-09-29-worker-stall-watch-design.md');
  const STATUS = passage('the parent spec, its status block', PARENT, '**Status:**', '**Date:**');

  it('the status block points at the settings design', () => {
    expect(STATUS).toContain('Amended 2026-10-05 by `2026-10-05-stall-watch-settings-design.md`');
  });

  it('§4.2: no marker gains a writer, and a level chosen in Settings can override the arming markers', () => {
    const s42 = passage('the parent spec §4.2', PARENT, '### 4.2 The run-worker stall lane', '## 5. Wave 2');
    expect(s42).toContain(`Every marker is touched and removed by hand on the fleet box, the \`${MAIL_OFF}\` precedent`);
    expect(s42).toContain('No marker gains a writer, but a level chosen in Settings can now override the arming markers');
    expect(s42).toContain(NEVER_OVER);
  });

  it('§10: the PWA renders none of the constants but the quiet time, and both kill rules are qualified', () => {
    const s10 = passage('the parent spec §10', PARENT, '## 10. Measurement, targets, and sequencing', '## 11. Decisions');
    expect(s10).not.toContain('`MAIL_ARMED_HOLD_MS`; the PWA renders none):');
    expect(s10).toContain('the PWA renders none of them but the quiet time, which Settings shows and sets');
    expect(s10).toContain(`\`rm ${LIVE}\` ${WHILE_FOLLOWING}`);
    expect(s10).toContain(`\`rm ${ESCALATE}\` ${WHILE_FOLLOWING}`);
  });
});
