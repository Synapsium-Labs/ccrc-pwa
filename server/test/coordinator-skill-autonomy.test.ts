// D-8126 wave A5 (coordinator autonomy default, spec 2026-11-09 §9.1): the coordinator skill's decision procedure, its
// text constraints and §7's dispositions. The contract clauses themselves (21, and the rewrites of 4, 11, 19 and 20) are
// pinned verbatim in coordinator-skill.test.ts beside the other clauses; this file pins what lives outside the contract.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { SKILL_INSTALL_OUTCOMES } from '../src/coord/skillInstall.js';

const root = path.resolve(__dirname, '../..');
const skillDir = path.join(root, 'ccd/coordinator-skill');
const read = (rel: string): string => readFileSync(path.join(skillDir, rel), 'utf8');
const flat = (s: string): string => s.replace(/\s+/g, ' ');

const skill = read('SKILL.md');
const procedure = read('references/decision-procedure.md');
const referenceNames = readdirSync(path.join(skillDir, 'references')).filter((n) => n.endsWith('.md')).sort();
const files: Array<[string, string]> = [['SKILL.md', skill], ...referenceNames.map((n): [string, string] => [n, read(`references/${n}`)])];

/** SKILL.md's section under one `## ` heading, up to the next. */
const section = (heading: string): string => {
  const at = skill.indexOf(`\n## ${heading}\n`);
  expect(at, `SKILL.md has no "## ${heading}" section`).toBeGreaterThanOrEqual(0);
  const next = skill.indexOf('\n## ', at + heading.length + 4);
  return skill.slice(at, next === -1 ? undefined : next);
};

/** The `## The contract` section, where clause 3 alone may name the destructive verbs. */
const contract = section('The contract');

describe('clause 21, whole (D-8126 A5-2, review 2865 F3)', () => {
  it('is one whole line of SKILL.md, exactly the spec\'s §9.1 quote, so an append to it is red', () => {
    const spec = readFileSync(path.join(root, 'docs/superpowers/specs/2026-11-09-coordinator-autonomy-default-design.md'), 'utf8');
    const quoted = spec.split('\n### 9.1 The skill\n')[1]!.split('\n').filter((l) => l.startsWith('  > ')).map((l) => l.slice(4));
    const clause21 = quoted.join(' ');
    expect(clause21.startsWith('21. This session decides by default and keeps going.')).toBe(true);
    expect(skill.split(`\n${clause21}\n`), 'clause 21 is not one whole SKILL.md line, exactly once').toHaveLength(2);
  });
});

describe('the decision procedure reference (D-8126 A5-3)', () => {
  it('is a reference the installer refuses to install without', () => {
    const installer = readFileSync(path.join(root, 'ccd/install-coordinator-skill.sh'), 'utf8');
    const refs = /^REQUIRED_REFS=\(([^)]*)\)/m.exec(installer);
    expect(refs, 'install-coordinator-skill.sh has no REQUIRED_REFS').not.toBeNull();
    expect(refs![1]!.split(/\s+/)).toContain('decision-procedure.md');
    expect(flat(section('Where the procedures live'))).toContain('`references/decision-procedure.md`');
  });

  it('names the two client verbs clause 21 names, each a row the closed client really has', () => {
    const client = readFileSync(path.join(root, 'ccd/ccrc-api'), 'utf8');
    for (const [verb, key] of [['ccrc-api goals show <slug>', 'goals.show'], ['ccrc-api calls record', 'calls.record']] as const) {
      expect(procedure).toContain(`\`${verb}\``);
      expect(client, `the client has no ${key} row`).toContain(`[${key}]=`);
    }
  });

  it('carries the six operator-only classes and the four physical blocks, each once', () => {
    for (const c of ['O1. Irreversible or outward-facing acts.', 'O2. Spend beyond plan.',
      'O3. The programme\'s goals, scope or definition of done.', 'O4. Credentials and access.',
      'O5. A fact only the operator holds.', 'O6. Overriding a person.',
      'P1. No account has room.', 'P2. The box is out of disk or memory.', 'P3. An external service is down',
      'P4. A repository or tool is beyond its rights.']) {
      expect(procedure.split(`**${c}`), `"${c}" is not a bold entry exactly once`).toHaveLength(2);
    }
  });

  it('keeps comments on public PRs and issues, and mirrored tracker writes, routine (the operator\'s answer 3)', () => {
    const p = flat(procedure);
    expect(p).toContain('Comments on other people\'s PRs and issues in public repositories, and tracker writes that '
      + 'mirror to public GitHub issues, are not in this class: they are routine (operator, 2026-11-09).');
  });

  it('writes the five standing operator preferences down', () => {
    for (const pref of ['A screen works at every width.', 'Improve what exists first.', 'Dependencies go to the latest major,',
      'The review-round cutoff.', 'A card is a glance.']) {
      expect(procedure).toContain(`**${pref}**`);
    }
  });

  it('states the split rule once, in this reference and nowhere else in the skill', () => {
    const holders = files.filter(([, text]) => text.includes('The split rule.')).map(([n]) => n);
    expect(holders).toEqual(['decision-procedure.md']);
    expect(procedure.split('The split rule.')).toHaveLength(2);
  });

  it('keeps the six tie-breakers in their order, and the anti-goals as a list of nevers', () => {
    const p = flat(procedure);
    const order = ['Reversible beats irreversible.', 'Smaller blast radius beats larger.', 'Extend what exists',
      'The standing operator preferences above.', 'Cheaper in time and fleet capacity.', 'The option you would have recommended'];
    const at = order.map((t) => p.indexOf(t));
    expect(at.every((i) => i >= 0), 'a tie-breaker is missing').toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    const nevers = flat(procedure.split('## Never, whatever a call says')[1] ?? '');
    for (const a of ['Never relax a SAFETY rule', 'Never guess an operator-only answer', 'Never spend', 'Never hide a big call',
      'Never review your own work', 'Never retry without backoff', 'Never treat a recorded call as an operator ruling']) {
      expect(nevers).toContain(a);
    }
  });

  it('lifts the review cap by its own refusals on main: no retired switch, and an older server is a block, not a wait', () => {
    const step7 = flat(procedure.split('### Step 7.')[1]!.split('\n## ')[0]!);
    expect(step7).not.toContain('coord-lift-off');
    expect(step7).toContain('`cap-not-reached`');
    expect(step7).toContain('`no-review-rounds-door`');
    expect(step7).toContain('`wakeOn: update`');
    expect(step7).toContain('`not-found`');
    expect(step7).toContain('Never wait on the cap.');
  });

  it('says who decides each landing stop, and never lands past one (rows 42, 43, 56, 57)', () => {
    const landing = flat(procedure.split('## The landing verdict\'s stops')[1]!.split('\n## ')[0]!);
    expect(landing).toContain('nothing here lands past a stop, starts a second wait, or makes a new landing attempt that file does not allow');
    expect(landing).toContain('Clause 15\'s refused merge stays a stop.');
    expect(landing).toContain('Only "ignore" is the operator\'s (O6)');
    expect(landing).toContain('never a dialog on a pinned programme');
    expect(landing).toContain('a hook deny is never worked round');
    for (const stop of ['unknown-rule-type', 'unreadable', 'not-at-head', 'changes-requested', 'approval-missing',
      'red-unreachable', 'github-refused']) expect(landing).toContain(`\`${stop}\``);
  });

  it('overrides 5b\'s dialog wording on a pinned programme, and a stopped landing\'s wake only re-reads (F5, F8)', () => {
    const landing = flat(procedure.split('## The landing verdict\'s stops')[1]!.split('\n## ')[0]!);
    expect(landing).toContain('On a pinned programme this section overrides 5b\'s dialog wording: where 5b asks the operator with AskUserQuestion, raise an item instead.');
    expect(landing).toContain('The wake only re-reads (the run list and the PR) and reports; it never lands outside 5b\'s two doors.');
  });

  it('names the debugging ceiling as a decide item that parks that thread only (F9)', () => {
    const stops = flat(procedure.split('## Which stops are allowed')[1]!.split('\n## ')[0]!);
    expect(stops).toContain('The debugging ceiling is the one other stop');
    expect(stops).toContain('raise it as a `decide` item, which parks that thread only');
  });

  it('lands past an older server\'s missing lift door only when no open finding is a regression (F4)', () => {
    const step7 = flat(procedure.split('### Step 7.')[1]!.split('\n## ')[0]!);
    const advance = flat(read('references/wave-lifecycle-4-advance.md'));
    for (const text of [step7, advance]) {
      expect(text).toContain('Land with known limits only when no open finding is a regression; otherwise the PR waits for the update.');
    }
  });

  it('records a time wake in epoch milliseconds, within the server\'s bound', () => {
    expect(flat(procedure)).toContain('`wakeOn: time:<epoch ms>` (epoch milliseconds, not seconds;');
  });
});

describe('the skill text constraints (D-8126 A5-3, review focus F11)', () => {
  it('no skill file contains the substring review-cap (D-8125\'s pin, every file)', () => {
    for (const [name, text] of files) expect(text, `${name} contains review-cap`).not.toContain('review-cap');
  });

  it('no skill file names the operator\'s correction door or the goals routes; the client verbs are named instead', () => {
    for (const [name, text] of files) {
      for (const door of ['/api/digest/correct', '/api/programmes/', '/api/coord/programmes/']) {
        expect(text, `${name} names ${door}`).not.toContain(door);
      }
    }
  });

  it('the decision procedure says SAFETY-listed verbs and names none of them', () => {
    expect(procedure).toContain('SAFETY-listed verbs');
    for (const verb of ['ws-reap', 'ws-rm', 'ws-gc', 'ws-archive', 'ws-restore', 'ws-reclaim', 'ws-expire', 'ws-collect',
      'ws-orphan', 'ws-shed-deps', 'ws-lease-mark', 'scratch-rescue', 'delegation-adopt', 'keep-awake', 'limit-watchdog']) {
      expect(procedure, `decision-procedure.md names ${verb}`).not.toContain(verb);
    }
    // Clause 3 is where the three destructive verbs are named, and the only place in SKILL.md.
    const outside = skill.replace(/^3\. .*$/m, '');
    for (const verb of ['ws-reap', 'ws-rm', 'ws-gc --prune']) expect(outside).not.toContain(verb);
    expect(contract).toContain('`ccd ws-reap`');
  });
});

describe('"When something is wrong" carries §7\'s dispositions (D-8126 A5-4)', () => {
  const wrong = flat(section('When something is wrong'));

  it('no longer stalls honestly: every entry names a recovery, a class or a park', () => {
    expect(skill).not.toContain('A program that stalls honestly is recoverable');
    expect(wrong).not.toMatch(/stop and report|Stop\. Report/);
  });

  it('reads a paused dispatch by its two causes, and never touches the operator\'s file', () => {
    const paused = wrong.split('refused `paused`')[1]!.split('- **')[0]!;
    expect(paused).toContain('`$REG/coordinator-paused`');
    expect(paused).toContain('non-dispatch work continues');
    expect(paused).toContain('registry');
    // Clause 4 still reads "a report, not a retry" until its rewrite lands after run 1850's freeze (D-8807).
    expect(paused).toContain('A report, never a retry (clause 4)');
    expect(paused).not.toContain('backoff');
    expect(paused).not.toContain('(P3)');
    expect(flat(paused)).toContain('the operator\'s pause, reported in the turn\'s text');
    expect(flat(paused)).toContain('a fault, reported as one non-blocking `do` item');
    expect(paused).toContain('never touch the file');
  });

  it('meets an unreachable server in the turn\'s text, since nothing can be recorded there; backoff is for other services (F7)', () => {
    const down = flat(wrong.split('cannot reach the server')[1]!.split('- **')[0]!.split('\n## ')[0]!);
    expect(down).toContain('nothing can be stored there, a `ccrc-api calls record` block included');
    expect(down).toContain('say so in the turn\'s text and end the turn');
    expect(down).toContain('Backoff with recorded blocks (P3, `wakeOn: time:<epoch ms>`) is for other services');
  });

  it('resends once after a stale-uuid, then treats a second as P4', () => {
    const stale = wrong.split('`stale-uuid`')[1]!.split('- **')[0]!;
    expect(stale).toContain('`ccrc-api whoami`');
    expect(flat(stale)).toMatch(/\bresend once\b/);
    expect(stale).toContain('P4');
  });

  it('keeps the cap-concurrency entry and the description as they are: fleet-capacity W1-5 rewrites them (P11)', () => {
    expect(skill).toContain('- **A dispatch is refused `cap-concurrency`.** Stop, say so, and wait to be\n  woken.');
    expect(skill).toContain('Never use it to do a wave\'s own work — a coordinator that starts implementing has become a worker with a stale plan.');
  });

  it('points at the decision procedure for every other stop', () => {
    expect(wrong).toContain('`references/decision-procedure.md`');
  });
});

describe('the references carry the new dispositions (D-8126 A5-5)', () => {
  const lifecycle = referenceNames.filter((n) => n.startsWith('wave-lifecycle') || n === 'wave-steps.md');

  it('keeps the debugging ceiling while the operator\'s question is open (§15 Q4, row 49)', () => {
    expect(flat(read('references/routing-matrix.md'))).toContain('the third attempt is a rung a human chooses');
  });

  it('no longer calls the skill install a human act: a dispatch that measures it absent installs it (row 38)', () => {
    for (const n of lifecycle) expect(flat(read(`references/${n}`)), n).not.toContain('running the installer is a human act');
    // A7 (#3079) made the install a server lane that records a run event, not a field of the dispatch answer.
    const dispatch = flat(read('references/wave-lifecycle-2-dispatch.md'));
    expect(dispatch).toContain(`\`skill-install:<${SKILL_INSTALL_OUTCOMES.join('|')}>\``);
    expect(dispatch).not.toContain('`skillInstall`');
  });

  it('gives the ledger template a "Goals and definition of done" section', () => {
    expect(read('references/ledger-template.md')).toMatch(/^## Goals and definition of done$/m);
  });

  it('turns every refusal row\'s stop-and-report into its disposition (rows 1, 12 to 45, 56 to 58)', () => {
    for (const n of lifecycle) {
      const rows = read(`references/${n}`).split('\n').filter((l) => l.startsWith('|'));
      for (const row of rows) {
        expect(row, `${n}: a refusal row still says stop and report`).not.toMatch(/stop and report|stop, report|the operator resolves it/i);
      }
    }
  });

  it('keeps the paused row and a child\'s question inside clauses 4 and 11 as they stand (D-8807)', () => {
    const row = read('references/wave-lifecycle-2-dispatch.md').split('\n').find((l) => l.startsWith('| `paused` |'))!;
    expect(row).toContain('never a retry (clause 4)');
    expect(row).toContain('reported in the turn\'s text, never retried (clause 4)');
    expect(row).not.toContain('dispatch again');
    expect(row).not.toContain('(class P3)');
    expect(flat(read('references/decision-procedure.md'))).toContain('A child\'s question is ruled under clause 11');
    // review 2865 F1: the ask lane keeps clause 11's own words until D-8807's packet lands.
    const asks = flat(read('references/wave-lifecycle-asks.md'));
    expect(asks).toContain('Decline anything that would be a NEW decision (clause 11\'s own words — product intent, scope, a tradeoff nobody ruled on, anything irreversible) rather than guessing at it.');
    expect(asks).toContain('If answering would require guessing rather than reading, decline it.');
    expect(asks).not.toContain('Release only a question that falls in an operator-only class');
  });

  it('settles intent-held between the two coordinators, and a claim holder\'s no:<reason> by its expiry (rows 35, 50)', () => {
    const dispatch = flat(read('references/wave-lifecycle-2-dispatch.md'));
    expect(dispatch).toContain('The holder\'s word decides');
    expect(flat(read('references/peer-protocol.md'))).toContain('`expiresAt`');
  });

  // review 2865 F6: one new phrase per rewritten disposition, each absent at the merge base.
  it('pins each rewritten disposition by its own new words (F6)', () => {
    const peer = flat(read('references/peer-protocol.md'));
    expect(peer).toContain('do not escalate to the operator: work the uncontested paths and wait for the claim\'s `expiresAt`');
    expect(peer).not.toContain('escalate to the operator instead');
    expect(flat(read('references/resume.md'))).toContain('try the id-preserving revive of §3 first');
    expect(flat(read('references/resume.md'))).toContain('through the console\'s Resume door and its picker');
    const api = flat(read('references/api.md'));
    expect(api).toContain('read the `stderr` as the dispatch table\'s bare-502 row says');
    expect(api).toContain('Nothing can be recorded on that server, the call record included');
    expect(flat(read('references/cross-project.md'))).toContain('open the wave without `sessionId` and record the registry fault as a routine call');
    expect(flat(read('references/wave-steps.md'))).toContain('the cap never makes a thread wait');
    expect(flat(read('references/wave-lifecycle-5-boundary.md'))).toContain('raise an end request for the run (`ccrc-api runs end-request <run id>`, a non-blocking ask)');
  });

  it('compares the ledger only when no Goals pin exists; a pinned mismatch parks at once (row 28, F2)', () => {
    const row = read('references/wave-lifecycle-1-open.md').split('\n').find((l) => l.startsWith('| `home-mismatch` |'))!;
    expect(row).toContain('No pin (a programme opened before Goals pins existed): compare the ledger\'s recorded home');
    expect(row).toContain('No match: the slug names another programme, so park the thread and raise an item without comparing anything');
    expect(row).not.toContain('No match, or no pin');
  });

  it('carries only the spec\'s stated definition of done into the pin; a draft waits for approval (F12)', () => {
    for (const text of [read('references/ledger-template.md'), readFileSync(path.join(root, 'docs/superpowers/programs/TEMPLATE.md'), 'utf8')]) {
      expect(flat(text)).toContain('carry the spec\'s stated definition of done in the same call');
      expect(flat(text)).toContain('it reaches the pin only through `ccrc-api goals modify` once approved');
    }
  });
});
