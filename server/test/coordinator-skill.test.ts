// The coordinator skill is prose a model follows unsupervised against a fleet
// it can destroy. These are the properties a review cannot hold in place:
// fourteen contract clauses, the routes it names, the refusal codes it promises,
// the envelope it quotes and the template it ships. `wsaudit.test.ts` already
// established the idiom — harvest tokens out of a source and require the
// copy to match it in both directions.
//
// Reconciliation (plan's "Interfaces assumed from PR I", item 8): the real
// envelope module is `server/src/coord/envelope.ts` (not `server/src/mail/
// envelope.ts`, which PR J's own plan drafted before PR I actually shipped),
// and it renders an `EnvelopeInput` — a bespoke server-internal shape, not the
// wire `MailItem`/`MailSummary` (those diverge on `id`'s type alone: `number`
// on the wire's `MailSummary`, but `EnvelopeInput.id` is specifically the
// DELIVERY id, a different AUTOINCREMENT sequence — see that file's own
// docstring). This suite imports and fixtures the real thing.
import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { CCRC_API } from './ccdWsHelpers.js';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderEnvelope, type EnvelopeInput } from '../src/coord/envelope.js';
import { WORKER_KICKOFF_PREFIX } from '../src/coord/dispatch.js';
import type { DoneClaim } from '../src/coord/fingerprint.js';
import {
  ASK_REFUSE_CODES, MAIL_BODY_MAX_BYTES, MAIL_REJECT_CODES, RUN_REFUSE_CODES,
  isPrPhase, isRunRefuseCode, SUITE_WORDS, FAILURE_KINDS,
} from '../../shared/api.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const skillDir = path.join(root, 'ccd/coordinator-skill');
const skill = readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
const refs = (name: string): string =>
  readFileSync(path.join(skillDir, 'references', name), 'utf8');
/** Every reference this skill ships, FROM THE DIRECTORY — never a hand-typed
 *  list. `install-coordinator-skill.sh`'s `REQUIRED_REFS` is the other
 *  projection of this same directory and is pinned against it in
 *  `wrapper-roster-fixture.test.ts` (I8) for exactly this reason: "a literal
 *  array is a PROJECTION of something real that a future change can silently
 *  drift away from, and a comment asking a future author to keep them in sync
 *  is not a mechanism".
 *
 *  The two corpora below WERE that literal array until program-leverage wave 1
 *  (D-1000). The cost was not hypothetical: the census, the break-door
 *  prohibition and the untyped-refusal scan all read `allSkillText`, so a
 *  fifth reference file would have been skipped by every one of them in
 *  silence — while the spec that added `resume.md` named the census as the
 *  binding constraint on that very file. MEASURED red before this landed: the
 *  runbook's own sentence was absent from `allSkillText`. */
const REFERENCE_NAMES: readonly string[] =
  readdirSync(path.join(skillDir, 'references'))
    .filter((n) => n.endsWith('.md'))
    .sort();
const allSkillText = [skill, ...REFERENCE_NAMES.map(refs)].join('\n');

/** The route harvest's corpus: SKILL.md + every reference EXCEPT the ones
 *  named here — today only `mail-envelope.md`. That file's only route-shaped
 *  text is the worked example's `ack: POST /api/mail/<id>/ack` line, and the
 *  byte-identity test below requires it to be `renderEnvelope`'s REAL output
 *  — a concrete delivery id, never the literal `:id` fastify registers. It
 *  stays in `allSkillText` (the ws-reap/ws-rm/ws-gc census still scans it — a
 *  worked example naming a destructive verb would be exactly as licensing as
 *  prose naming one) and is pulled OUT of just the route harvest, so a real
 *  numeric id never reads as a route this skill "names" and fails the
 *  literal-match check no server route can ever satisfy.
 *
 *  Everything else is IN, in both parity directions — the reference cannot
 *  name a ghost route, and the routes it is the documented home for cannot
 *  silently lose their one mention. `peer-protocol.md` (Build 9 wave 8) for
 *  its call shapes and headings; `resume.md` (program-leverage wave 1) for the
 *  three coordination reads a revived coordinator makes. `resume.md` also
 *  names the PWA's revive door — deliberately WITHOUT a method, so it is not
 *  harvested here at all: see the foot-of-file describe and D-1001. */
const ROUTE_CORPUS_EXCLUDES: ReadonlySet<string> = new Set(['mail-envelope.md']);
const routeSkillText = [
  skill, ...REFERENCE_NAMES.filter((n) => !ROUTE_CORPUS_EXCLUDES.has(n)).map(refs),
].join('\n');

/** Every .ts under server/src, read once — the linkage test's corpus. */
const serverSources = (): string => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) out.push(readFileSync(p, 'utf8'));
    }
  };
  walk(path.join(root, 'server/src'));
  return out.join('\n');
};

// The fourteen clauses, verbatim. Kept as a literal array rather than a regex per
// clause: the point is that the SENTENCE is the contract, so a paraphrase must
// fail exactly as a deletion does.
//
// Clause 8 reads `claimed-by-another` — the REAL refusal `POST /api/runs`
// sends (`coord/routes.ts`, `coord/store.ts`) — not the plan-era `claimed`,
// which is not a member of `RunRefuseCode` and can never arrive; the skill's
// own worked refusal list (below, and in `references/wave-lifecycle.md`)
// already used the real code, so the contract clause was the one place left
// disagreeing with itself. Clause 9 pins the `/clear` rule the reconciliation
// added (item 6): dispatch is the ONE writer of `/clear`, and nothing else in
// this file — the SKILL's own prose, in ANY paragraph — may inject it.
const CONTRACT = [
  'Every act that changes fleet state goes through the ccrc server HTTP API. This session never runs `ccd` to change fleet state.',
  'The box token is read from `~/.cc-secrets/ccrc-mail.token` and sent as the `x-ccrc-mail-token` header. It is never printed, never pasted into a prompt, never committed.',
  'This session never reaps. `ccd ws-reap`, `ccd ws-rm` and `ccd ws-gc --prune` are not its verbs, at any wave, for any reason.',
  'This session never unpauses itself. `$REG/coordinator-paused` is the operator’s file; a dispatch refused `paused` is a stop, and the next act is a report, not a retry.',
  'A wave brief is written prose, reviewed like code. The template is the shape; the content is this session’s judgement, and a brief that is missing something the next wave needs is a defect in the ledger.',
  'A `wave-done` is a claim, not a fact. Re-measure it, then submit the fingerprint to `POST /api/runs/:id/advance` and believe the server’s answer over your own.',
  'This session does not poll in a loop. After a dispatch it ends its turn; mail wakes it.',
  'One coordinator per program. If `POST /api/runs` answers `claimed-by-another`, stop — another coordinator owns this program.',
  'This session never sends `/clear` to a worker directly, by any route, at any wave. `POST /api/runs/:id/dispatch` is the one writer of that step.',
  'This session allocates the program’s deviation block once, at run-open — `POST /api/ledger/deviations` — and names the block in every brief; a worker never calls the allocator mid-wave. Before splitting a wave across workers it reads `GET /api/claims?project=<project>`, and a wave that dispatches two workers onto overlapping claims is a defect in this session’s ledger, not in the workers.',
  'When a child of yours asks a question, you may answer it — POST /api/asks/:id/answer is the one route that does, and this session never types into another session’s pane by any other means. Rule only from what you can read: the spec, the plan, the ledger, the branch, and your own prior rulings. You cannot see the child’s reasoning — only its question and its options, and that is the entire evidence surface: no rationale, no chat history, no transcript. If answering would require guessing rather than reading, decline. Anything that would be a NEW decision — product intent, scope, a tradeoff nobody ruled on, anything irreversible — is the operator’s; decline it with POST /api/asks/:id/release so their notification fires at once rather than waiting out the window.',
  'A verified `wave-done` is READ by a review run, never by this session. Once `POST /api/runs/:id/advance` has moved the work run to `awaiting-review`, this session opens a run of `kind:\'review\'` naming it, dispatches the reviewer with `references/review-brief.md`, and ends its turn; when `review-done` arrives it closes the review run with the reviewer’s own `{reviewedTip, report}` and rules on the report the server accepted. This session does not read the diff itself, and a `stale-review` refusal means a fresh review run against the live tip, never a ruling on the old report.',
  'Every brief names the shape of the wave and the routing the matrix derives from it — class, effort, subagent class and workflow mode, and the subagent effort the worker is expected to name on its calls — read from `references/routing-matrix.md`; this session revises routing only on the evidence a wave returns, and records each change and why in the ledger before the next dispatch.',
  "The review brief names the held-out panel in `references/review-panel.md` as the review's shape, and the reviewer runs it as written: three Opus lenses and a Sonnet refute pass per finding, model and effort literal in the script, exempt from every routing field and from escalation and demotion. A lens that dies or returns nothing counts as unverified, never as approval, and no wave is accepted on a reading this session made alone.",
];

describe('the coordinator skill: its contract', () => {
  it('carries all fourteen clauses verbatim', () => {
    for (const clause of CONTRACT) {
      expect(skill, `missing contract clause: ${clause.slice(0, 48)}…`).toContain(clause);
    }
  });

  it('no longer tells the coordinator to review the handoff commit itself (design 2026-09-14 §4, §13)', () => {
    expect(skill).not.toContain('Review the handoff commit');
    expect(skill).not.toContain('review the handoff commit');
    expect(flat(skill)).toContain('never read by this session');
    expect(flat(refs('wave-lifecycle.md'))).not.toContain('Review the handoff commit the way you would review any commit.');
    expect(flat(refs('wave-lifecycle.md'))).not.toContain('your ordinary review');
  });

  // ── the COUNT, which the verbatim pin above structurally cannot see ──────
  //
  // D-2175: the loop above is a SUBSET check (`toContain`), so a twelfth
  // clause appended to SKILL.md left every assertion in this file green — the
  // contract could be extended with no pin at all, which is the one thing
  // "pinned verbatim" exists to prevent. `worker-skill.test.ts` already
  // carries this guard; this ports it, with two adaptations the worker's
  // version does not need. First, the coordinator states its count in prose as
  // "These fourteen sentences" (SKILL.md:67), not "clauses"/"lines" as the
  // worker skill says, so the in-file harvest is widened to accept all three.
  // Second, README.md's own mention line-wraps the count word onto the line
  // after "clauses" (measured — CLAUDE.md's does not), so the cross-file
  // marker scan matches across whitespace rather than a single literal space.
  // Third, unlike the worker skill, the contract is NOT the only ordered list
  // this file carries (measured — "## The wave lifecycle" numbers its own six
  // steps), so the in-file harvest is scoped to the "## The contract" section
  // rather than the whole document.

  /** Number words, index-addressed — the same idiom `worker-skill.test.ts` and
   *  `box-token-census.test.ts` use, aimed here at the one count this file's
   *  corpus spells out in prose three times (SKILL.md, README.md, CLAUDE.md). */
  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
    'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
    'eighteen', 'nineteen', 'twenty'];
  const COUNT_WORD = WORDS[CONTRACT.length];

  it('numbers exactly as many clauses as the CONTRACT pins, 1..N with no gaps', () => {
    // Scoped to the "## The contract" section alone (see the comment above):
    // "## The wave lifecycle" numbers a second, unrelated six-step list
    // further down the same file, and an unscoped `^\d+\. ` harvest would
    // append its 1..6 onto the contract's own 1..11 and red on every run.
    const contractStart = skill.indexOf('## The contract');
    expect(contractStart, 'SKILL.md should have a "## The contract" section').toBeGreaterThanOrEqual(0);
    const nextHeading = skill.indexOf('\n## ', contractStart + 1);
    const contractSection = skill.slice(contractStart, nextHeading === -1 ? undefined : nextHeading);
    const numbered = [...contractSection.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
    expect(numbered, 'SKILL.md numbers a different set of clauses than the CONTRACT pins')
      .toEqual(CONTRACT.map((_, i) => i + 1));
  });

  it('spells that same count, as one derived word, everywhere prose states it', () => {
    expect(COUNT_WORD, `${CONTRACT.length} clauses is past the end of WORDS — extend the array`)
      .toBeTruthy();
    // SKILL.md states it once in its own words ("These fourteen sentences").
    // HARVESTED, never matched literally, so a revert to "ten" fails with the
    // wrong word named rather than with a missing string. The filter against
    // WORDS is what keeps a stray "protocol sentences" (SKILL.md's own clause
    // 5 discussion) from counting as a hit.
    const stated = [...skill.matchAll(/\b([a-z]+) (?:clauses|lines|sentences)\b/g)]
      .map((m) => m[1]!).filter((w) => WORDS.includes(w));
    expect(stated.length, 'SKILL.md no longer states its own clause count in prose')
      .toBeGreaterThanOrEqual(1);
    for (const w of stated) {
      expect(w, `SKILL.md says ${w} where the CONTRACT pins ${CONTRACT.length}`).toBe(COUNT_WORD);
    }
    // README.md and CLAUDE.md each describe this skill BY PATH, with the count
    // in the same sentence. The sites are derived from that path rather than
    // listed by line number, so a moved paragraph does not silently stop being
    // checked.
    const marker = 'ccd/coordinator-skill/SKILL.md';
    for (const rel of ['README.md', 'CLAUDE.md']) {
      const text = readFileSync(path.join(root, rel), 'utf8');
      let hits = 0;
      for (let i = text.indexOf(marker); i >= 0; i = text.indexOf(marker, i + 1)) {
        const m = /\b([a-z]+)\s+clauses\b/.exec(text.slice(i, i + 160));
        expect(m, `${rel} names ${marker} without stating how many clauses it has`).not.toBeNull();
        expect(m![1], `${rel} says ${m![1]} clauses where the CONTRACT pins ${CONTRACT.length}`)
          .toBe(COUNT_WORD);
        hits++;
      }
      expect(hits, `${rel} no longer names ${marker} at all`).toBeGreaterThan(0);
    }
  });

  it('names the three destructive verbs ONLY inside the clause that forbids them', () => {
    // A skill that mentions `ws-reap` anywhere else has given a model a reason
    // to consider it. The forbidding clause is the one licensed mention.
    for (const verb of ['ws-reap', 'ws-rm', 'ws-gc']) {
      const hits = allSkillText.split(verb).length - 1;
      const licensed = CONTRACT[2]!.split(verb).length - 1;
      expect(hits, `${verb} appears ${hits}×; only the forbidding clause may name it`).toBe(licensed);
    }
  });

  it('tells the session how to learn its own id the ONE way that is actually its own', () => {
    // The bare derivation this replaced was measured on the fleet host three
    // times on 2026-09-02: with no TMUX_PANE it exits 0 naming the MOST RECENTLY
    // ACTIVE session — a different one on each run — so a session whose lookup
    // went wrong got another session's id and believed it. `ccrc-api whoami`
    // targets THIS pane and refuses instead.
    expect(skill).toContain('ccrc-api" whoami');
    expect(skill).toContain('cc-');
    expect(skill, 'the unchecked derivation is back')
      .not.toContain("tname=$(tmux display-message -p '#S')");
  });

  // Wave 3 §3.1. A coordinator writes a ledger and a brief that name the
  // worker's branch; before this wave the naming sweep could rename it 30
  // seconds later and every one of those references silently stopped resolving.
  // The mechanism is two rungs (FleetWatcher.sweepNames, ccd ws-rename); this
  // asserts the corpus a coordinator actually reads has been told about it,
  // because a guarantee nobody documented is a guarantee nobody relies on.
  it('tells the coordinator that a claimed workspace keeps its name for the life of the claim', () => {
    const wl = refs('wave-lifecycle.md');
    expect(wl).toContain('frozen for the life of the claim');
    // The two mechanisms, named — so a reader can check the promise rather than
    // trust it, and so deleting either rung leaves a documented claim visibly
    // unbacked.
    expect(wl).toContain('ws-rename');
    expect(wl.toLowerCase()).toContain('naming sweep');
  });

  it('has YAML frontmatter with a name and a description that says when NOT to use it', () => {
    expect(skill.startsWith('---\n')).toBe(true);
    const fm = skill.slice(4, skill.indexOf('\n---', 4));
    expect(fm).toContain('name: ccrc-coordinator');
    expect(fm).toMatch(/description:.+/);
    expect(fm.toLowerCase()).toContain('never use it to do a wave');
  });
});

describe('the coordinator skill: linkage', () => {
  // fastify spells params `:id` and so does the skill, so the match is
  // character for character — the same trick that makes wsaudit's harvest a
  // two-line assertion instead of an allowlist. METHOD included on both
  // sides (fix, review finding 9): the pre-fix harvest matched the PATH
  // alone, so `GET /api/mail/:id/ack` (the wrong verb — that route is a
  // POST) would have passed on the string appearing ANYWHERE in server
  // sources, method unchecked.
  const skillRoutes = (): Set<string> => {
    const routes = new Set<string>();
    for (const m of routeSkillText.matchAll(/\b(GET|POST) (\/api\/[A-Za-z0-9/:._-]+)/g)) {
      routes.add(`${m[1]} ${m[2]!.replace(/[.,)]+$/, '')}`);
    }
    return routes;
  };

  // `coord/routes.ts` ONLY (fix, review finding 9) — not the whole server
  // tree `serverSources()` walks: that file is the coordinator's entire
  // domain by its own docstring ("MAIL LIVES HERE; RUN ROUTES ARE TASK 9's,
  // in this same file"), so it is the one place a route this skill OUGHT to
  // name can be added, renamed or deleted. Scoping the reverse direction to
  // the whole server would also flag every unrelated PWA route (`/api/
  // accounts`, `/api/notify`, …) that the coordinator has no business
  // knowing about.
  const registeredCoordRoutes = (): Set<string> => {
    const src = readFileSync(path.join(root, 'server/src/coord/routes.ts'), 'utf8');
    const routes = new Set<string>();
    for (const m of src.matchAll(/app\.(get|post)\(\s*'([^']+)'/g)) {
      routes.add(`${m[1]!.toUpperCase()} ${m[2]}`);
    }
    return routes;
  };

  it('names no route the server does not register', () => {
    const routes = skillRoutes();
    expect(routes.size, 'the skill should name the routes it calls').toBeGreaterThanOrEqual(6);
    const src = serverSources();
    for (const r of routes) {
      const [method, p] = r.split(' ') as [string, string];
      expect(src, `no server route registers ${r}`).toContain(`'${p}'`);
      expect(registeredCoordRoutes().has(r), `${p} is not registered as ${method}`).toBe(true);
    }
  });

  it('names every coordinator-domain route the server registers, method included (fix, review finding 9)', () => {
    // The idiom's OTHER direction, missing before this fix: the prior test
    // proved the skill invents nothing; nothing proved the skill OMITS
    // nothing. Deleting `GET /api/mail` or `POST /api/runs/:id/close` from
    // the docs — finding 9's own named example — left the suite green,
    // because completeness was asserted only as `routes.size >= 6`, a floor
    // any six mentions clear regardless of which six.
    const EXEMPT: ReadonlySet<string> = new Set([
      // The PWA's own /mail screen reads this (MailScreen.tsx) — not part
      // of the coordinator's protocol; the skill has no reason to call it
      // and naming it would be clutter, not linkage.
      'GET /api/feed',
      // BUILD 4 — the two OPERATOR routes (spec §4.1). These are exempt for a
      // stronger reason than clutter: naming them here would be an invitation
      // the skill's own contract forbids. `$REG/coordinator-paused` exists
      // precisely so the coordinator CANNOT unpause itself ("no verb, no
      // route, no way", `rundefs.ts`), and the abandon is the release valve
      // for a run wedged BY a stuck coordinator — a door the coordinator is
      // not the one to walk through. Both ride the PWA's unauthenticated
      // surface and carry `causedBy: 'operator'`; the coordinator's own close
      // (`POST /api/runs/:id/close`) is the one it is told about.
      'POST /api/coord/pause',
      'POST /api/runs/:id/abandon',
      // BUILD 9 (D16) — the abandon-door shape, third instance. Breaking a
      // claim is the operator's release valve for a wedge left by a dead or
      // stuck holder; naming it in the corpus would be an invitation the
      // skills' own contract forbids (a coordinator that breaks a worker's
      // claim has stopped coordinating). The claimant's own door is
      // POST /api/claims/:id/release, which IS named.
      'POST /api/claims/:id/break',
      // F5 (D-1123) — the abandon-door shape, FOURTH instance, and the one with
      // the sharpest reason to stay unnamed: this door rewrites `claimedBy`. A
      // coordinator told about it would be told how to reclaim its own program
      // from itself, which is a no-op it would spend a wave discovering, or how
      // to take someone else's, which is the thing clause 1 forbids. The
      // corpus-wide forbid-mention pin (the `/api/claims/:id/break` shape) is
      // what turns this permission-to-omit into a prohibition.
      'POST /api/runs/:id/reclaim',
      // WAVE 6 (D-1240) — the OPERATOR-dial shape, and the `POST
      // /api/coord/pause` argument one turn sharper. The caps bound how much a
      // coordinator may dispatch; a coordinator told about this route would be
      // told how to raise its own limit, which is not a door it is the one to
      // walk through — it is the cap's own defeat, the way unpausing itself
      // would be the pause marker's. Neither half is named: the READ is exempt
      // too, because a coordinator that can read the dial has no use for the
      // number it is not allowed to change, and naming it would only be the
      // first half of an invitation.
      'GET /api/coord/caps',
      'POST /api/coord/caps',
    ]);
    const named = skillRoutes();
    for (const r of registeredCoordRoutes()) {
      if (EXEMPT.has(r)) continue;
      // The corpus is DERIVED, so the message names what it actually read
      // rather than a two-file list that went stale when `peer-protocol.md`
      // joined and staler again with `resume.md`.
      expect(named.has(r), `${r} is registered in coord/routes.ts but is named nowhere in the route ` +
        `corpus (SKILL.md + ${REFERENCE_NAMES.filter((n) => !ROUTE_CORPUS_EXCLUDES.has(n)).join(', ')})`)
        .toBe(true);
    }
  });

  it('promises only real refusal codes, and explains each one in wave-lifecycle.md', () => {
    // SKILL.md's "How to call the API" section makes a specific promise: "The
    // refusals you will actually meet are …". Same kebab-token idiom
    // `mail-routes.test.ts` uses over server/src, aimed here at that ONE
    // sentence instead: every code it names must be real (a member of
    // `RunRefuseCode` or `MailRejectCode` — the two typed vocabularies these
    // routes actually draw from, never a stale or invented one like the
    // plan-era `claimed`) AND be explained somewhere in
    // `references/wave-lifecycle.md` — a code the skill promises but the
    // reference never defines is exactly as dangerous as one the server can
    // never send.
    //
    // MEASURED SURVIVOR, fixed here: the harvest regex used to require a
    // hyphen (`[a-z]+(?:-[a-z]+)+`), so a single-word code was invisible to
    // it — replacing `claimed-by-another` with the plan-era `claimed` right
    // here in SKILL.md's own sentence left this suite green. `paused` is a
    // real member of the list today and is equally single-word, so the
    // hyphen group is now OPTIONAL (`(?:-[a-z]+)*`) — every backticked
    // lowercase token in the sentence is harvested, single word or not.
    const marker = 'The refusals you will actually meet are';
    const start = skill.indexOf(marker);
    expect(start, 'SKILL.md should carry its refusal-list sentence').toBeGreaterThanOrEqual(0);
    const end = skill.indexOf('\n\n', start);
    const sentence = skill.slice(start, end === -1 ? undefined : end);
    const codes = [...sentence.matchAll(/`([a-z]+(?:-[a-z]+)*)`/g)].map((m) => m[1]!);
    expect(codes.length, 'the harvest should find the codes in the sentence').toBeGreaterThanOrEqual(14);
    const wl = refs('wave-lifecycle.md');
    for (const code of codes) {
      expect((MAIL_REJECT_CODES as readonly string[]).includes(code) || isRunRefuseCode(code),
        `${code} is not a declared MailRejectCode or RunRefuseCode — the skill promises a refusal ` +
          'the server can never send').toBe(true);
      expect(wl, `${code} is named in SKILL.md's refusal list but never explained in wave-lifecycle.md`)
        .toContain(code);
    }
  });

  it('mentions every declared MailRejectCode and RunRefuseCode SOMEWHERE in the skill (fix, review finding 9)', () => {
    // The prior test's own idiom is one-directional by its own admission —
    // it proves every code the ONE sentence NAMES is real, never that every
    // code a route can actually emit is named anywhere. That asymmetry is
    // what let finding 7's whole missing family (every `POST /api/mail`
    // code — `unknown-sender`, `unknown-recipient`, `oversize`,
    // `registry-unmeasurable`, `unauthenticated`) survive undetected: none
    // of the five ever needed to appear in SKILL.md's one pinned sentence,
    // because that sentence documents the RUN routes only.
    //
    // This test does not care WHERE a code is explained — SKILL.md's own
    // sentence, its new mail-routes paragraph, or wave-lifecycle.md's
    // tables and prose all count — only that it is explained SOMEWHERE in
    // the corpus a coordinator actually reads. `undeliverable` is excluded:
    // it is a DELIVERY-lane code (`watch.ts`, outside `server/src/coord`
    // entirely, by `MailRejectCode`'s own docstring) that only ever shows up
    // as a `MailSummary.state`/`rejectCode` value, never as a refusal a
    // coordinator's own API call receives — nothing in the skill's protocol
    // needs to name it as a call outcome. ('duplicate' and 'peer-quota' were
    // parked here as a wave-0 bridge; wave 8's `peer-protocol.md` is their
    // documented home, so the census now finds them in the corpus — the
    // foot-of-file describe re-pins both as declared.)
    const NOT_A_CALL_REFUSAL: ReadonlySet<string> =
      new Set(['undeliverable']);
    for (const code of MAIL_REJECT_CODES) {
      if (NOT_A_CALL_REFUSAL.has(code)) continue;
      expect(allSkillText, `${code} is a real MailRejectCode but is named nowhere in the skill`)
        .toContain(code);
    }
    for (const code of RUN_REFUSE_CODES) {
      expect(allSkillText, `${code} is a real RunRefuseCode but is named nowhere in the skill`)
        .toContain(code);
    }
  });

  it('names the untyped shapes a run route can also answer — bad-request, unsupported, not-configured, and the bare-502 no-code case (fix, review finding 9/17; I9)', () => {
    // `shared/api.ts`'s own `RunRefuseCode` docstring: `error:'unsupported'`,
    // `error:'bad-request'`, `error:'not-configured'` and a bare
    // `{ok:false,stderr}` are real, are not members of ANY typed vocabulary,
    // and are consequently invisible to both directions of the two tests
    // above — this is the completeness check for exactly the codes those two
    // cannot see by construction. `not-configured` (I9) is EVERY coordination
    // route's own answer with no store wired in (`routes.ts:172`) — not
    // run-route-specific like the other three, but untyped the same way and
    // just as absent from the skill before this fix.
    for (const token of ['bad-request', 'unsupported', 'not-configured', 'stderr']) {
      expect(allSkillText, `${token} is a real untyped refusal shape but is named nowhere in the skill`)
        .toContain(token);
    }
  });

  it('quotes an envelope byte-identical to what the delivery lane injects', () => {
    // `toId`/`artifacts` (fix, review finding 12): the shipped ingress always
    // resolves `toId` to the RECIPIENT'S REAL session id before this ever
    // renders (`routes.ts`'s `resolvedToId`) — no real envelope ever reads
    // `to: coordinator`, the literal role — and refuses any relative
    // `artifacts` entry `bad-kind` (`routes.ts` check 2) — no real envelope
    // this worker could actually have SENT carries a relative path either.
    // The old fixture quoted both, self-contradicting the very paragraph
    // below it that called this "a fixture message a WORKER already sent".
    const fixture: EnvelopeInput = {
      id: 7, fromId: 'ccrc-pwa-clear-cove', toId: 'ccrc-pwa-still-water',
      runId: 3, program: 'build4-transcript-surface', wave: 3, waveOf: null,
      kind: 'status', subject: 'wave-done',
      body: 'Wave 3 is on the branch. Handoff commit is the ledger update; PR #591 is green.',
      artifacts: ['/w/clear-cove/docs/superpowers/programs/build4-transcript-surface.md'],
    };
    const rendered = renderEnvelope(fixture);
    expect(refs('mail-envelope.md'),
      'the worked example must be exactly what renderEnvelope produces').toContain(rendered);
  });

  it('documents items on the dispatch body', () => {
    // Build 4, spec §3.1. The brief is prose the server never reads; the
    // items are the machine-readable half of the same wave plan, and the
    // skill must carry the pairing or a coordinator writes one without the
    // other.
    const lifecycle = refs('wave-lifecycle.md');
    expect(skill).toContain('"items"');
    expect(lifecycle).toContain('"items"');
    for (const fact of ['32', '200']) {
      expect(lifecycle, `the ${fact} cap is not stated`).toContain(fact);
    }
    // The two halves must be said to agree — a brief that names five units of
    // work and an `items` array with three is a ledger that lies on the board.
    expect(`${skill}\n${lifecycle}`).toMatch(/brief[\s\S]{0,400}?the server never reads/i);
  });

  it('documents route beside brief and items on the dispatch body (routing slice 4, Task 7)', () => {
    // `route` rides the SAME dispatch call as `brief` and `items` — a
    // coordinator reading only one of these two files must still see all
    // three keys named together, or it writes a body missing one.
    const lifecycle = refs('wave-lifecycle.md');
    // ALL FIVE writable fields, not four: the literal showed `class`, `effort`,
    // `subagent` and `workflow` while the paragraph below it named five, so a
    // coordinator copying the body omitted `compact` every time (slice 5's
    // deferred minor, closed by slice 6 Task 5).
    expect(lifecycle).toContain(
      '{"brief":"<the wave brief, prose>","items":["<title>", …],"route":{"class":"…","effort":"…","subagent":"…","workflow":"…","compact":"…"}}');
    expect(skill).toContain('{"brief": "<prose>", "items":\n   ["<title>", …], "route": {…}}');
    // The routing clause is 13 on the merged tree (R1) — the review-run clause
    // is 12, and this sentence must not renumber that one.
    expect(skill).toContain("`route` is the object clause 13's placement derives");
    // The §2 `route` paragraph itself: the five writable fields, the
    // wave-1-argv/wave-N-verb split, and the two omission events — this is
    // the sentence the mutation check (Step 5) deletes to prove this pin
    // reds without it.
    expect(lifecycle).toContain(
      "**`route` — the wave's placement, not a request.**");
    expect(lifecycle).toContain('`class`, `effort`, `subagent`,\n`workflow`, `compact`');
    expect(lifecycle).toContain('route-omitted:no-route-argv-cap');
    expect(lifecycle).toContain('route-omitted:no-route-v1-cap');
  });

  it('names the child-omitted run event a fresh dispatch journals on a box without child-argv-v1', () => {
    // Child-workspace reclamation wave 1. `dispatchRun` journals this row on
    // EVERY fresh dispatch to a box whose ccd predates `child-argv-v1` — far
    // more often than either `route-omitted` event — so the coordinator's
    // reference must say what it means before a run trail shows it one.
    const lifecycle = refs('wave-lifecycle.md');
    expect(lifecycle).toContain('`child-omitted:no-child-argv-cap`');
    expect(lifecycle).toContain('that workspace is simply not a child');
  });

  it('names POST /api/runs/:id/items after the re-measurement, never before', () => {
    const lifecycle = refs('wave-lifecycle.md');
    const settle = lifecycle.indexOf('POST /api/runs/:id/items');
    const advance = lifecycle.indexOf('POST /api/runs/:id/advance');
    expect(settle, 'the settle call is not documented at all').toBeGreaterThan(-1);
    expect(advance).toBeGreaterThan(-1);
    // ORDER is the contract: the settle is what the coordinator does once the
    // server has already believed the wave, never a step that could precede
    // it. Documented in §4, after the advance call it depends on.
    expect(settle).toBeGreaterThan(advance);
    expect(lifecycle).toMatch(/after[\s\S]{0,200}?advance[\s\S]{0,200}?(answers?|answered)\s+`?ok/i);
    // Both refusals carry their status and their instruction.
    expect(lifecycle).toContain('unknown-item');
    expect(lifecycle).toContain('item-terminal');
    expect(lifecycle).toMatch(/tally that moved backwards is a lie on the console/i);
  });

  it('still forbids the coordinator from settling on a worker\'s claim alone', () => {
    // The settle route is a WRITE authorised by the server's own
    // re-measurement — not by the wave-done mail that prompted it. Clause 6
    // is the sentence that says so and it must survive this addition
    // verbatim; and nothing in the corpus may tell a coordinator to settle
    // straight off a claim.
    expect(skill).toContain('A `wave-done` is a claim, not a fact.');
    const lifecycle = refs('wave-lifecycle.md');
    expect(lifecycle).toMatch(/never (?:off|on) (?:the|a) (?:worker'?s? )?claim(?:\s+alone)?/i);
    // And the ledger stays fixed at dispatch: no route adds an item later.
    expect(lifecycle).toMatch(/fixed at dispatch/i);
  });

  it('ships the ledger template byte-identical to the repo’s', () => {
    // D-7: the skill runs against projects that have no docs/superpowers, so it
    // must carry the template. Two copies exist; this is the mechanism that
    // stops them being two different templates.
    expect(refs('ledger-template.md')).toBe(
      readFileSync(path.join(root, 'docs/superpowers/programs/TEMPLATE.md'), 'utf8'));
  });
});

describe('the dispatch response documents that ok is not proof of a ready pane', () => {
  it('names adopted and spawnState, and says what adopted:true costs the coordinator', () => {
    const ref = refs('wave-lifecycle.md');
    expect(ref).toContain('adopted');
    expect(ref).toContain('spawnState');
    // The sentence that makes the fields actionable rather than decorative.
    expect(ref).toMatch(/ok.*(is not|no longer).*proof/i);
  });

  // The new passage introduces no mention of the destructive verbs, and that is
  // NOT re-asserted here. `names the three destructive verbs ONLY inside the
  // clause that forbids them` (above) pins hits === CONTRACT[2]'s own count
  // across SKILL.md and both references — strictly stronger than any check
  // written here, since a weaker duplicate would stay green on an extra
  // mention. It is the mechanism; it must stay green.

  it('names skillState and all three of its answers, and says absent does not refuse', () => {
    // program-leverage wave 2 (F2). The sibling test above is deliberately not
    // widened: it pins the TWO fields that shipped with section 1.5, and this
    // pins the third on its own terms, so deleting either passage reds a test
    // that names it.
    const wl = refs('wave-lifecycle.md');
    expect(wl, 'the dispatch-response table does not name skillState').toContain('skillState');

    // BLOCK-SCOPED: the three words must be inside the response block, not
    // merely somewhere in a 500-line file.
    const start = wl.indexOf('#### An `ok:true` dispatch is no longer proof');
    expect(start, 'the dispatch-response block is gone or renamed').toBeGreaterThan(-1);
    const block = flat(wl.slice(start, wl.indexOf('\n## ', start)));
    for (const word of ['present', 'absent', 'unmeasurable']) {
      expect(block, `the dispatch-response block omits skillState's '${word}' answer`)
        .toContain(word);
    }

    // The distinction is the whole feature: a reader who takes `unmeasurable`
    // for `absent` goes off to install a skill that is already there, and one
    // who takes `absent` for a refusal re-dispatches a wave that dispatched.
    expect(block, 'the block does not say unmeasurable is not absent')
      .toMatch(/unmeasurable[\s\S]{0,240}?(is not|never)[\s\S]{0,40}?absent/i);
    expect(block, 'the block does not say the preflight never refuses a dispatch')
      .toMatch(/never refuses|does not refuse|still dispatch/i);

    // ...and the OPERATOR GUIDANCE is pinned separately, scoped to the bullet
    // list. MEASURED: without this narrower slice, deleting the `unmeasurable`
    // bullet outright left every assertion above green, because the table row
    // three lines up satisfies the same regexes. A table entry says what the
    // value means; only the bullet says what to DO about it, which is the half
    // a coordinator acts on.
    const guide = flat(block.slice(block.indexOf('**What to do with them.**')));
    expect(guide, 'no operator guidance for skillState: absent')
      .toMatch(/`skillState: 'absent'`/);
    expect(guide, 'the absent bullet does not tell the coordinator to report it first')
      .toMatch(/report it to the operator before you treat the wave as briefed/i);
    expect(guide, 'no operator guidance for skillState: unmeasurable')
      .toMatch(/`skillState: 'unmeasurable'`/);
    // ...and its DO-half, not just its label. The absent bullet one line up has
    // had two assertions from the start; this one shipped with only its
    // backticked name, so a mutant that kept the label and INVERTED the
    // guidance — sending the coordinator hunting for an install, or telling it
    // to re-dispatch — stayed green (review round 1, minor 3).
    expect(guide, 'the unmeasurable bullet does not tell the coordinator to report it as an unknown')
      .toMatch(/say so as an unknown/i);
    expect(guide, 'the unmeasurable bullet does not forbid re-dispatching on an unknown')
      .toMatch(/do not re-dispatch/i);

    // The count sentence. Nothing else pins it, which is exactly why it became
    // a lie the moment a third field shipped (D-1014) — pinned both ways so
    // the NEXT field to land reds a suite instead of drifting.
    expect(block, 'the lead-in still promises two fields').not.toMatch(/\btwo fields\b/);
    expect(block, 'the lead-in does not say three fields').toMatch(/\bthree fields\b/);

    // The causes of `unmeasurable` are enumerated, and the enumeration is
    // COMPLETE. It shipped naming two — no config dir for that account, and a
    // read that would not complete — and read as exhaustive, while the tree has
    // a third: dispatch's resume arm tolerates a session absent from a listable
    // registry, so there is no wrapper to map and no read is attempted at all.
    // `shared/api.ts`'s own SkillState docstring names all three (review round
    // 1, minor 4).
    expect(block, 'the unmeasurable causes omit the session with no registry row')
      .toMatch(/registry row|no registry|not in the registry/i);

    // The run-event trail, documented the way `adopted` documents its own.
    expect(flat(wl), 'the run-event detail for the preflight is undocumented')
      .toContain('skill-preflight:');
  });
});

describe('the skill on `final:true` — a release is now conditional', () => {
  // Build 8 Wave 2. Both sentences became CONDITIONALLY FALSE the moment
  // `closeRun` started handing a claim over to a still-open sibling instead of
  // releasing it, and neither string was asserted anywhere — which is exactly
  // why they would have rotted silently. Neither is one of the NINE pinned
  // contract clauses, so this is additive text, not an edit to a clause.
  it('does not promise `final:true` releases the hold, full stop', () => {
    const lifecycle = refs('wave-lifecycle.md');
    expect(skill).not.toMatch(/`final:true` releases the\s+hold/);
    expect(lifecycle).not.toMatch(/and \*\*releases\*\* the hold\s*\n\(`ws-release`\) instead of re-holding/);
  });

  it('names `released` and says what `released:false` means', () => {
    const lifecycle = refs('wave-lifecycle.md');
    for (const text of [skill, lifecycle]) {
      expect(text).toMatch(/released/);
    }
    expect(lifecycle).toMatch(/released.*false|`released: false`/);
    // The consequence, in the coordinator's own terms: the program is NOT
    // done, and another run still owns the workspace.
    expect(lifecycle).toMatch(/another run still (owns|claims)/i);
  });

  // NO SECOND CENSUS ASSERTION HERE. `the coordinator skill: its contract`
  // above already pins it EXACTLY — `hits === CONTRACT[2].split(verb).length -
  // 1`, over SKILL.md plus both references — and a copy in this describe would
  // be a weaker duplicate of a guard that already exists, which is precisely
  // the mutation-table discipline this branch enforces everywhere else. The
  // constraint is real and binding on the prose above; the MECHANISM that
  // enforces it is the shipped test, and this file runs whole.
});

describe('the skill tells a SENDER what a blocked delivery obliges them to do', () => {
  // MEASURED at the frozen ref, not assumed: the corpus is NOT silent about
  // undeliverable mail — `undeliverable` ×3 and `rejected` ×4 across
  // mail-envelope.md and wave-lifecycle.md. Every one of those passages is
  // RECIPIENT-side, though: what becomes of mail addressed to YOU. The sender,
  // whose wave brief is the thing that cannot land, was told nothing at all.
  // Build 8 makes the block visible on the wire (`attempts`/`lastError`) and in
  // the tray (the sender notification); this is the procedure that goes with
  // it, so an earlier draft's "the corpus says nothing about blocked mail" is
  // the false premise this describe is written NOT to repeat.
  const envelope = (): string => refs('mail-envelope.md');

  it('names what lastError === draft-present means for the sender', () => {
    expect(allSkillText).toContain('draft-present');
    expect(allSkillText).toMatch(/input box/i);
  });

  it('names the attempt ceiling, so a first block reads differently from the last', () => {
    expect(envelope()).toMatch(/attempts?[^.]*\b6\b|\b6\b[^.]*attempts?/);
  });

  // DEVIATION FROM THE PLAN, and the reason is the rule this branch enforces
  // everywhere: the plan's assertion was `allSkillText.toContain('briefQueued')`,
  // and `briefQueued` ALREADY appears once in wave-lifecycle.md — in the
  // response line of §2, unexplained. That assertion passes at the frozen ref,
  // so it could never have gone red for the thing it claims to guard. It is
  // scoped to the file this task writes, and paired with the SEMANTIC claim
  // (queued is not delivered) that is the whole point of the passage.
  it('says a briefQueued dispatch is NOT a delivered brief', () => {
    expect(envelope()).toContain('briefQueued');
    expect(envelope()).toContain('clearError');
    expect(envelope()).toMatch(/`?briefQueued`?[^.]*\btrue\b[\s\S]{0,240}?(not|never)[\s\S]{0,80}?(delivered|has it)/i);
  });

  // The lane's auto-clear is PROVENANCE-GATED (Task 407, operator ruling): it
  // clears only a `/clear` this system can prove it typed and had swallowed.
  // A sentence promising an unconditional rescue would send a coordinator off
  // to wait for something that will never happen on an operator's own text —
  // and this repo's own worked example of a doc lie is a sentence with its
  // qualifier filed off, so the qualifier is what is pinned.
  it('does not promise an unconditional auto-clear of a stranded `/clear`', () => {
    const para = envelope().split('\n\n').find((p) => p.includes('stranded `/clear`'));
    expect(para, 'no paragraph in mail-envelope.md discusses a stranded `/clear`').toBeDefined();
    expect(para).toMatch(/prove|provenance|its own/i);
  });

  // A handover now puts the corpse's unacked ROLE mail in the heir's box as a
  // new delivery. Unsaid, the heir reads item 4 above, concludes the reports are
  // gone, and re-dispatches finished work — exactly the harm `resume.md`'s "read
  // outstanding mail before deciding anything" exists to prevent.
  //
  // ANCHORED ON A PHRASE THE PARAGRAPH OWNS, NOT ON THE ROUTE, and that is not a
  // style choice: the `never names the reclaim door` case at the foot of this
  // file forbids that route string corpus-wide, so a paragraph anchored on it
  // could not exist. The phrase is paren-free so it is also safe as a `-t`
  // pattern, and `find` returning `undefined` is what makes a deleted passage
  // red instead of silently passing.
  it('tells the heir a handover re-queues the reports the dead coordinator never acked', () => {
    const para = envelope().split('\n\n')
      .find((p) => p.includes('hands the program to a new coordinator'));
    expect(para,
      'no paragraph in mail-envelope.md says what a handover does to a parked report').toBeDefined();
    expect(para, 'the passage does not say the heir gets a NEW delivery').toMatch(/new delivery/i);
    // The distinction that must survive any rewrite: a NEW delivery, not the old
    // park reopened — item 4's own "the park is terminal" is still true and this
    // paragraph must not read as a retraction of it. One exact phrase, not a
    // disjunction with alternatives no prose here can satisfy.
    expect(para, 'the passage does not say the old park is left unreopened')
      .toContain('is not reopened');
  });

  // NO CENSUS ASSERTION HERE, and the reason is worth recording so it is not
  // re-added: this file ALREADY pins it exactly —
  //   `expect(hits).toBe(CONTRACT[2].split(verb).length - 1)`
  // — and `CONTRACT[2]` names each of ws-reap/ws-rm/ws-gc exactly ONCE. A
  // `toBeLessThanOrEqual(2)` beside it would PASS with an extra mention, i.e. a
  // guard that cannot red for the thing it claims to guard, which is the
  // mutation-table discipline this branch enforces everywhere else. The
  // constraint binds the prose; the MECHANISM is the shipped test, and this
  // file runs whole.
});

// ── The trim: the coordinator DELEGATES the standing protocol ──────────────
//
// Before this task, a brief was told to re-type the worker's protocol clause by
// clause; the protocol now ships as the `ccrc-worker` skill and dispatch names
// it in the prefix of every brief mail (`WORKER_KICKOFF_PREFIX`). The prose that
// says so is a MECHANISM only while something reds when it is reverted, and the
// obvious revert — restoring the old "The brief must say" block — deletes
// exactly the sentences pinned below.
//
// WHITESPACE-COLLAPSED, the `readme-holds.test.ts` idiom: both files wrap these
// sentences mid-clause (and SKILL.md indents its step-2 continuation lines by
// three spaces), so a literal `toContain` would pin the wrap point rather than
// the sentence and would red on a re-flow that changed nothing.
const flat = (s: string): string => s.replace(/\s+/g, ' ');

/** A named slice between two literal anchors — `single-definition.test.ts`'s
 *  `passage()`, copied for its REASON as much as its shape (this tree keeps the
 *  idiom per-file on purpose: it touches nothing shared, so a copy costs one
 *  helper and an import would cost a seam).
 *
 *  The bare `wl.slice(wl.indexOf(OPEN), wl.indexOf(CLOSE))` pair it replaces was
 *  the POSITIVE-assertion form of the runaway slice, which is the quieter half of
 *  the defect (D-1440). A lost OPENING anchor gives `''`; a lost CLOSING one gives
 *  `-1`, and `String.slice(a, -1)` means "to length - 1" — so the block silently
 *  becomes the whole rest of the file, a `> 0` floor is satisfied by anything at
 *  all, and a `toMatch` can then be answered by the phrase appearing ANYWHERE
 *  below. The assertion stops testing the block it names and stays green. So both
 *  anchors are asserted, the closing one is searched for AFTER the opening one and
 *  must follow it, and the floor is a real one rather than `> 0`. */
const passage = (name: string, text: string, from: string, to: string, floor: number): string => {
  const a = text.indexOf(from);
  expect(a, `${name}: the opening anchor is gone`).toBeGreaterThan(-1);
  const b = text.indexOf(to, a + from.length);
  expect(b, `${name}: the closing anchor is gone`).toBeGreaterThan(a);
  const out = text.slice(a, b);
  expect(out.length, `${name} is too short to be the passage`).toBeGreaterThan(floor);
  return out;
};

describe('the coordinator delegates the standing protocol to the worker skill', () => {
  /** The worker skill's own frontmatter `name:`, harvested — never typed here.
   *  `worker-skill.test.ts` binds that name to `WORKER_KICKOFF_PREFIX`; this
   *  binds the COORDINATOR's side of the same handshake to it, so a rename
   *  cannot leave the coordinator's docs pointing a brief at a ghost skill. */
  const WORKER_SKILL_NAME = ((): string => {
    const wsk = readFileSync(path.join(root, 'ccd/worker-skill/SKILL.md'), 'utf8');
    const m = /^name:\s*(\S+)\s*$/m.exec(wsk.slice(4, wsk.indexOf('\n---', 4)));
    if (!m) throw new Error('ccd/worker-skill/SKILL.md declares no `name:` — this pin is looking ' +
      'at the wrong file, or the skill lost the one field it is invoked by');
    return m[1]!;
  })();

  it('tells the coordinator the protocol rides the skill, not a re-typed paragraph', () => {
    // SKILL.md's step 2 and wave-lifecycle.md's brief block, each in its own
    // words — the two places a coordinator actually looks before writing a
    // brief. Restoring either file's pre-trim text reds this.
    expect(flat(skill)).toContain(
      'The standing protocol is not yours to re-type: dispatch prefixes every brief with the ' +
      `sentence that sends the worker to the \`${WORKER_SKILL_NAME}\` skill, and that skill IS the protocol`);
    expect(flat(refs('wave-lifecycle.md'))).toContain(
      'The standing worker protocol is a SKILL, not a paragraph you re-type every wave.');
    // And the brief's REPLACEMENT job is stated, not merely the deletion: a
    // coordinator told what to stop writing and not what to write instead ships
    // an empty brief.
    expect(flat(refs('wave-lifecycle.md'))).toContain('A brief carries what only THIS wave knows:');
    expect(flat(refs('wave-lifecycle.md'))).toMatch(
      /A brief carries what only THIS wave knows:[\s\S]{0,320}deviations already ledgered/);
  });

  it('names the worker skill by the name dispatch actually invokes', () => {
    // The delegation is only real if both halves agree on the string. The
    // prefix is IMPORTED (never harvested as text), so this is a rename
    // detector on the coordinator corpus, not a spelling test.
    expect(WORKER_KICKOFF_PREFIX).toContain(`the ${WORKER_SKILL_NAME} skill`);
    expect(routeSkillText, `the coordinator corpus never names the \`${WORKER_SKILL_NAME}\` skill it ` +
      'now delegates the whole standing protocol to').toContain(WORKER_SKILL_NAME);
  });

  it('KEEPS the branch-discipline sentence in every brief — belt and braces, not deletion', () => {
    // The one sentence the trim deliberately does NOT delegate: a skill reaches
    // a config dir only once its installer has run there, and a worker on a
    // home that has not had it has the brief and nothing else. F5 is what this
    // costs when it is missing, and `stale-tip` is the shape it arrives in.
    const wl = flat(refs('wave-lifecycle.md'));
    // STRAIGHT apostrophes throughout, and both reference files are measured to
    // carry no curly ones (`grep -c ’ wave-lifecycle.md` → 0): a curly
    // apostrophe pasted into either file is a different byte and would red
    // these pins without looking like an edit — D-104's constraint, met here by
    // the prose rather than by escaping.
    expect(wl).toContain(
      "commit on this workspace's own branch; do not create or switch to a separate feature branch.");
    expect(wl).toContain('One sentence from the protocol goes in every brief anyway');
    // T5 review F-3: this used to read `expect(wl).toContain('stale-tip')` over
    // the WHOLE file, which `stale-tip` satisfies three times over from the
    // reject table and the `no-handoff-commit` row alone — deleting the entire
    // branch-discipline block left it green, so it could not red for the thing
    // its own describe claims to guard. SCOPED to the block, and asserting the
    // whole causal claim rather than one token: the sentence is only load-
    // bearing BECAUSE of what it prevents, and a block that kept the
    // instruction while losing the reason is a rule a coordinator may talk
    // itself out of.
    const block = passage('the branch-discipline block', wl,
      'One sentence from the protocol goes in every brief anyway',
      "The workspace's name is frozen", 600);
    expect(block, 'the branch-discipline block no longer says what a feature branch costs')
      .toMatch(/refuses\s+`stale-tip` forever, with no non-abandon path to close a run/);
    expect(flat(skill)).toContain(
      "One sentence from that protocol still goes in every brief anyway: commit on this " +
      "workspace's own branch, never a separate feature branch");
    // Clause 5 is untouched and still pinned verbatim above; the reconciliation
    // that keeps this sentence OUT of "the content is this session's judgement"
    // has to survive the trim too, or the one non-negotiable sentence becomes
    // optional by omission.
    expect(wl).toContain(`clause 5's "the content is this session's judgement" does not cover it`);
  });
});

describe('the graph-card paragraph describes the card ccd/session-hook.sh actually prints', () => {
  // NOTHING under `server/test` read this paragraph when it landed, so it could
  // — and did — describe a two-state freshness the hook has not had since
  // D-1336, and a card that every session prints when the hook prints nothing at
  // all for a tree with no graph and no census row. That is the same class the
  // refusal-code cross-check above closes for SKILL.md: a doc that quotes
  // another file's vocabulary and is bound to nothing drifts silently. Every
  // word quoted here is HARVESTED from the writer, so the next hook change reds
  // this doc instead of orphaning it.
  const hook = readFileSync(path.join(root, 'ccd/session-hook.sh'), 'utf8');

  /** The paragraph itself, by its own opening — one blank-line-delimited block. */
  const para = (): string => {
    const wl = refs('wave-lifecycle.md');
    const start = wl.indexOf("**A brief may quote the worker's graph card");
    expect(start, 'wave-lifecycle.md carries no graph-card paragraph at all')
      .toBeGreaterThanOrEqual(0);
    const end = wl.indexOf('\n\n', start);
    return flat(wl.slice(start, end === -1 ? undefined : end));
  };

  /** Every freshness word the card can carry, harvested from the hook's own
   *  assignments, normalised over the count. Four arms, three words: `fresh`,
   *  `<n> commit(s) behind HEAD`, and D-1336's `freshness unmeasured` — the one
   *  the paragraph collapsed. */
  const FRESHNESS = ((): string[] => {
    // D-1613 moved these assignments out of `_hook_graph_card` and into
    // `_hook_graph_measure`, which the card and the R5 search gate both read,
    // and the locals became `GM_*` globals with them. The harvest follows the
    // spelling — it threw the error below on the rename, which is the mechanism
    // working: a doc pinned to words the hook no longer prints is the failure.
    const vals = [...hook.matchAll(/\bGM_FRESH="([^"]+)"/g)].map((m) => m[1]!);
    if (vals.length < 4) throw new Error('ccd/session-hook.sh assigns fewer than the four ' +
      'freshness words this pin was written against — the card was rewritten, or this harvest is ' +
      'looking at the wrong file');
    return [...new Set(vals.map((v) => v.replace(/^(?:\$behind|\d+) commits? /, '')))];
  })();

  /** Every QUALIFIER the card APPENDS to a freshness word, harvested from the
   *  hook's own `fresh+=` sites — the twin of `ccrc-install-graphify.test.ts`'s
   *  (D-1369), mirrored here for the reason D-1372 records: the harvest above
   *  COULD NOT SEE D-1368 LAND. That change made a squash-merged graph read
   *  `fresh — same content as HEAD`, which is exactly the case this paragraph
   *  went on promising would read `not an ancestor of HEAD`, and the pin stayed
   *  green over the drift twice over — the new `fresh="fresh"` assignment left
   *  the vocabulary SET identical after the de-dupe, and the qualifier is
   *  APPENDED, so `/\bfresh="([^"]+)"/` never matched it at all. A qualifier is
   *  deliberately not a state (nothing branches on it, which is why the
   *  FRESHNESS harvest is the right shape for the states), but it IS card text
   *  a coordinator quotes into a brief. Leading punctuation is stripped so the
   *  pin is on the words, not on the em dash that joins them. */
  const QUALIFIERS = ((): string[] => {
    // The qualifier's spelling followed the same D-1613 rename as the words
    // above: one measurement, `_hook_graph_measure`, read by the card and the gate.
    const vals = [...hook.matchAll(/\bGM_FRESH\+="([^"]+)"/g)]
      .map((m) => m[1]!.replace(/^[^A-Za-z0-9]+/, '').trim());
    if (vals.length < 1) throw new Error('ccd/session-hook.sh appends no freshness qualifier at ' +
      'all — the card was rewritten, and the graph-card paragraph that names one has to be ' +
      're-derived against it rather than left standing');
    return [...new Set(vals)];
  })();

  /** Word-BOUNDARY match, never a raw substring — the same hole as the worker
   *  suite's twin harvest (D-1342). `fresh` is a substring of `freshness
   *  unmeasured`, so a `toContain` arm for it passes on the longer word alone
   *  and can never fail; this paragraph carries NO verbatim pin, so that
   *  harvest is its only binding and a vacuous arm leaves it unbound. */
  const wordRe = (w: string): RegExp =>
    new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);

  it('names the qualifier the hook APPENDS, and scopes the ancestry words to a differing tree (D-1372)', () => {
    // DERIVED FROM ORDER, the same way the README's twin arm is: the card asks
    // a CONTENT predicate before it asks ancestry at all, so a graph whose
    // bytes are HEAD's reads `fresh` and never reaches the `not an ancestor of
    // HEAD` arm — which is what this paragraph promised for that very case
    // until D-1372. Nothing here pins a spelling of either predicate, only
    // which one decides first.
    const content = hook.indexOf('_hook_same_tree "$cwd"');
    const ancestry = hook.indexOf('rev-list --left-right --count "$GM_BUILT...HEAD"');
    expect(content, "ccd/session-hook.sh's card asks no content predicate at all — this pin is " +
      'looking at the wrong file').toBeGreaterThanOrEqual(0);
    expect(ancestry, 'ccd/session-hook.sh no longer asks the two-sided ancestry count — this pin ' +
      'is looking at the wrong file').toBeGreaterThanOrEqual(0);
    expect(content, 'ccd/session-hook.sh decides ancestry before content, so a graph whose tree ' +
      "IS HEAD's reads `not an ancestor of HEAD` again — D-1368 was reversed")
      .toBeLessThan(ancestry);
    for (const q of QUALIFIERS) {
      expect(para(), `the graph-card paragraph never names the \`${q}\` qualifier the hook ` +
        'appends to a freshness word — a coordinator quoting the card into a brief meets text ' +
        'this paragraph says the card cannot carry').toMatch(wordRe(q));
    }
    expect(para(), 'the graph-card paragraph enumerates the ancestry words without saying that ' +
      'CONTENT is asked first — a squash-merged graph reads `fresh` where this paragraph ' +
      'promises `not an ancestor of HEAD`').toMatch(/CONTENT decides that clause first/);
  });

  it('names every freshness state the hook can print, including the unmeasured one', () => {
    for (const word of FRESHNESS) {
      expect(para(), `the graph-card paragraph never names the \`${word}\` state the hook prints`)
        .toMatch(wordRe(word));
    }
  });

  it('does not promise a card for every session — the hook prints nothing for most trees', () => {
    // The no-graph arm returns SILENTLY unless the sweep census carries a row
    // for the tree, and prints a DIFFERENT sentence when it does. A coordinator
    // told every session prints a card reads a missing one as a fault.
    //
    // Anchored on the BUILDER assignment (`CARD_GRAPH="graphify: ..."`), not on
    // `_hook_emit_context` directly — Task 3's refactor moved this sentence from
    // an inline emit into `CARD_GRAPH`, composed with the rest of `CARD` and
    // emitted once, later, from a variable (`_hook_emit_context "$CARD"`, which
    // this regex cannot match). The sentence itself is unchanged; only the
    // statement holding it moved. If it moves again, move this anchor with it.
    const m = /CARD_GRAPH="graphify: ([^"$]+?) —/.exec(hook);
    expect(m, 'ccd/session-hook.sh emits no no-graph sentence — this pin is looking at the ' +
      'wrong file, or the refused-tree arm lost its one quotable line').not.toBeNull();
    expect(para(), 'the paragraph never quotes the line a refused tree gets instead of a card')
      .toContain(m![1]!);
    expect(para(), 'the paragraph does not say a tree can get NO card at all')
      .toMatch(/gets NOTHING/);
    // The regression itself, spelled: the sentence that made this paragraph
    // wrong is the one that generalised over every session.
    expect(para(), 'the paragraph is back to claiming every session prints a card')
      .not.toMatch(/Every session's `SessionStart` prints one line/);
  });
});

describe('the coordinator docs state the oversize ceiling the brief writer actually has', () => {
  // T3 review ⚠2. Since dispatch composes `WORKER_KICKOFF_PREFIX + brief` and
  // caps the COMPOSED body, a brief in (cap - prefix, cap] is refused without
  // itself exceeding the cap — and both of the coordinator's own sentences
  // still said "the wave brief itself". No suite went red on that drift: the
  // refusal-code scan above pins only that each promised code is EXPLAINED
  // somewhere, never what the explanation says.
  const wl = (): string => flat(refs('wave-lifecycle.md'));

  it('derives the stated ceiling from the two constants, not from a typed-in number', () => {
    const m = /the effective brief ceiling is \*\*(\d+)\*\* bytes today \(`MAIL_BODY_MAX_BYTES` (\d+) − the prefix's (\d+)\)/
      .exec(wl());
    expect(m, 'wave-lifecycle.md §2 states no effective brief ceiling in the pinned form').not.toBeNull();
    const [ceiling, cap, prefix] = [Number(m![1]), Number(m![2]), Number(m![3])];
    // Each number bound to its own source of truth, so raising the cap or
    // editing the kickoff sentence reds this instead of silently making the
    // documented ceiling a lie a coordinator trims against.
    expect(cap, 'the quoted cap is not MAIL_BODY_MAX_BYTES').toBe(MAIL_BODY_MAX_BYTES);
    expect(prefix, 'the quoted prefix size is not WORKER_KICKOFF_PREFIX\'s')
      .toBe(Buffer.byteLength(WORKER_KICKOFF_PREFIX, 'utf8'));
    expect(ceiling, 'the stated ceiling is not cap minus prefix').toBe(cap - prefix);
  });

  it('no longer says the BRIEF ITSELF is what exceeds the cap', () => {
    // The two drifted sentences, by their own words — the mutation this whole
    // describe exists for is someone restoring either of them.
    expect(refs('wave-lifecycle.md')).not.toMatch(/the wave brief itself exceeds/);
    expect(skill).not.toMatch(/when the wave brief itself is too long/);
    // And the corrected claim is actually made, in both places, rather than the
    // wrong sentence merely having been deleted.
    expect(wl()).toMatch(/COMPOSED mail/);
    expect(flat(skill)).toContain('what it measures is the COMPOSED mail, the worker kickoff prefix plus your brief');
  });
});

describe('the coordinator/worker handshake: shape in, detail out', () => {
  // T1 review F-2 and F-3, both of which are defects in THIS corpus rather than
  // in the worker skill: the worker is told to send four fingerprint fields and
  // no reference ever showed the body shape, and the worker's own
  // `pr-unmeasurable` bullet keys on a `reject.detail` the coordinator was
  // never instructed to forward.
  const workerSkill = readFileSync(path.join(root, 'ccd/worker-skill/SKILL.md'), 'utf8');

  /** The four fields, from `DoneClaim` itself — a fifth field added there
   *  forces a key in here (the tests directory is typechecked,
   *  `typecheck-tests.test.ts`) and then reds the worked example below, which a
   *  hand-written list of four strings structurally cannot do. */
  const CLAIM_FIELDS: Record<keyof DoneClaim, true> = {
    branchTip: true, prNumber: true, prPhase: true, handoffCommit: true,
  };

  it('shows ONE worked wave-done fingerprint, and it is a valid claim shape', () => {
    const lifecycle = refs('wave-lifecycle.md');
    const blocks = [...lifecycle.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]!)
      .filter((b) => b.includes('branchTip'));
    expect(blocks, 'wave-lifecycle.md carries no fenced JSON wave-done fingerprint').toHaveLength(1);
    const example = JSON.parse(blocks[0]!) as Record<string, unknown>;
    expect(Object.keys(example).sort()).toEqual(Object.keys(CLAIM_FIELDS).sort());
    // The shape `verifyDone` demands, minus the sha values themselves — those
    // are deliberately placeholders, and the prose says so.
    expect(typeof example.branchTip).toBe('string');
    expect(typeof example.handoffCommit).toBe('string');
    expect(typeof example.prNumber === 'number' || example.prNumber === null).toBe(true);
    expect(isPrPhase(example.prPhase as string),
      `the worked example's prPhase (${String(example.prPhase)}) is not a real PrPhase — the one ` +
      'example in the corpus must not teach the vocabulary error it warns about').toBe(true);
    expect(flat(lifecycle)).toMatch(/PLACEHOLDERS/);
  });

  it('tells the coordinator to forward reject.detail verbatim — the worker bullet keys on it', () => {
    // The SYSTEM fix for F-3: the worker skill reads the detail, so the
    // coordinator has to send it. Both halves asserted together, in one test,
    // because either alone is a half-protocol — a worker reading a field nobody
    // sends, or a coordinator sending one nobody reads.
    expect(flat(refs('wave-lifecycle.md'))).toContain(
      "Put `reject.detail` in that mail's body, verbatim.");
    expect(flat(skill)).toContain('mail the worker the rejection code **and its `detail`, verbatim**');
    expect(workerSkill, 'the worker skill no longer reads the detail this forward exists for')
      .toMatch(/`rejected: pr-unmeasurable`, with a detail that mentions `prPhase`/);
  });

  it('names the EXECUTION SKILL in the brief-content list — worker clause 6 keys on it (T5 review F-2)', () => {
    // The trim re-created, in one line, the very defect class the test above
    // fixes. Worker clause 6 says "Invoke the execution skill THE BRIEF NAMES
    // rather than improvising one" — and before this fix nothing in the whole
    // coordinator corpus told a coordinator to name one (grep for `execution
    // skill|executing-plans|subagent-driven` over `ccd/coordinator-skill/**`:
    // zero hits). That was survivable while brief content was open judgement
    // under clause 5; the trim turned this list into the AUTHORITATIVE
    // enumeration of what a brief carries, so an item missing from it is an
    // item a coordinator now has positive reason to omit.
    //
    // SCOPED TO THE LIST, not the file: the point is that the enumeration a
    // coordinator reads as complete IS complete. A mention three sections away
    // would satisfy a whole-file `toContain` and still leave the list wrong.
    const wl = flat(refs('wave-lifecycle.md'));
    const marker = 'A brief carries what only THIS wave knows:';
    const start = wl.indexOf(marker);
    expect(start, 'wave-lifecycle.md carries no positive brief-content list').toBeGreaterThan(-1);
    const list = wl.slice(start, wl.indexOf('One sentence from the protocol', start));
    expect(list.length, 'the brief-content list never closes').toBeGreaterThan(0);
    expect(list, 'the brief-content list omits the execution skill the worker is told to invoke')
      .toMatch(/execution skill/);
    // BOTH halves, one test, the `reject.detail` pin's own idiom: a coordinator
    // told to name a skill nobody invokes, or a worker told to invoke one
    // nobody names, are the same half-protocol wearing different clothes.
    expect(workerSkill, 'the worker clause this list item exists to satisfy is gone')
      .toContain('Invoke the execution skill the brief names rather than improvising one.');
  });
});

describe('the token is EXTRACTED, never cat-ed whole (first-program dogfood finding, 2026-08-20)', () => {
  // The token file ships in deploy/ccrc-mail.token.example's shape — a
  // `#`-comment preamble above one value line — and the server reads it with
  // coord/token.ts's extractToken. Both skills used to teach
  // `TOKEN=$(cat …)`, which sends the whole preamble as the header value:
  // not even a legal header, so every coordination write answered a bare 400
  // before any route logic ran. Found live, before the first program's first
  // dispatch — a worker following its own skill would have wedged on its
  // first ack. The rule must stay IDENTICAL to deploy/notify.sh's (that
  // file's own comment binds it to extractToken); this pin binds the skills
  // to the same pipeline.
  const workerSkill = readFileSync(
    path.join(skillDir, '..', 'worker-skill', 'SKILL.md'), 'utf8');
  const PIPELINE = "grep -v '^[[:space:]]*#' ~/.cc-secrets/ccrc-mail.token | grep -v '^[[:space:]]*$' | head -n1 | tr -d '[:space:]'";

  it('neither skill teaches the cat that can never authenticate', () => {
    for (const [name, text] of [['coordinator', skill], ['worker', workerSkill]] as const) {
      expect(text, `${name} SKILL.md regressed to cat-ing the token file whole`)
        .not.toContain('TOKEN=$(cat ~/.cc-secrets/ccrc-mail.token)');
    }
    expect(refs('wave-lifecycle.md')).not.toContain('$(cat ~/.cc-secrets/ccrc-mail.token)');
  });

  // RELOCATED, not relaxed. The extraction used to live in each SKILL.md
  // because each caller ran it by hand. `ccrc-api` reads the token file itself
  // now, so there is exactly ONE reader of it on a session box and the skills
  // carry no pipeline to drift — which is a stronger form of the same property,
  // not a weaker one. The pin follows the mechanism: it asserts the CLIENT
  // still matches notify.sh's rule, and that neither skill has grown a second
  // copy back.
  it("the client carries notify.sh's exact extraction pipeline, and the skills carry none", () => {
    const notify = readFileSync(path.join(root, 'deploy/notify.sh'), 'utf8');
    const client = readFileSync(CCRC_API, 'utf8');
    expect(notify).toContain("grep -v '^[[:space:]]*#'");
    expect(client, "ccrc-api's extraction drifted from notify.sh's rule")
      .toContain("grep -v '^[[:space:]]*#'");
    expect(client).toContain("head -n1 | tr -d '[:space:]'");
    for (const [name, text] of [['coordinator', skill], ['worker', workerSkill]] as const) {
      expect(text, `${name} SKILL.md grew a second token reader back`).not.toContain(PIPELINE);
    }
  });
});

describe('the server address is config, never a literal (operator ruling 2026-08-22)', () => {
  // The live lesson behind this pin: 3b rebound the server to loopback behind
  // Caddy, and every program died silently — the skills were curling a
  // hardcoded tailnet address that no longer answered. The base URL is now
  // DERIVED from ~/.ccrc/agent.env's CCRC_SERVER_URL (the key
  // `ccrc install --role fleet` writes), and an empty derivation is a
  // stop-and-report, never a fallback literal.
  const workerSkill = readFileSync(path.join(root, 'ccd/worker-skill/SKILL.md'), 'utf8');
  const corpus: ReadonlyArray<readonly [string, string]> = [
    ['coordinator SKILL.md', skill],
    ['worker SKILL.md', workerSkill],
    // DERIVED, same reason as `REFERENCE_NAMES` above (D-1003): this was the
    // THIRD hand-typed copy of the references directory in this file, so a new
    // reference file shipping with a hardcoded server address in it would have
    // been checked by nothing at all — the live lesson in this describe's own
    // header, arriving through a door the header did not cover.
    ...REFERENCE_NAMES.map((n) => [n, refs(n)] as const),
  ];

  it('no skill file carries a numeric server-host literal', () => {
    for (const [name, text] of corpus) {
      expect(text, `${name} regressed to a hardcoded server address`)
        .not.toMatch(/(?:https?|wss?):\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
    }
  });

  // RELOCATED for the same reason as the token pipeline above, and the live
  // lesson in this describe's header is exactly why the MEANING has to survive:
  // 3b rebound the server to loopback behind Caddy and every program died
  // silently, because the skills held a hardcoded address. The rule was "the
  // address is config, never a literal, and an empty derivation is a stop".
  // That rule is now enforced by `ccrc-api`, which refuses `no-server-url`
  // rather than falling back (pinned in `ccrc-api.test.ts`), so the skills
  // derive nothing — and MUST NOT, or there would be two derivations to rot.
  it('the client owns the address derivation, and both SKILL.md files defer to it', () => {
    const client = readFileSync(CCRC_API, 'utf8');
    expect(client, 'ccrc-api does not read CCRC_SERVER_URL from agent.env')
      .toContain("grep -E '^[[:space:]]*CCRC_SERVER_URL='");
    for (const [name, text] of [['coordinator', skill], ['worker', workerSkill]] as const) {
      expect(text, `${name} SKILL.md grew a second address derivation back`)
        .not.toContain(`CCRC_API=$(grep -E '^[[:space:]]*CCRC_SERVER_URL=' "$HOME/.ccrc/agent.env"`);
      expect(text, `${name} SKILL.md does not name the client`).toContain('ccrc-api');
      // `~/.local/bin` is not on the unit PATH, so naming it by bare name would
      // teach a call that cannot run. Measured 2026-08-26.
      expect(text, `${name} SKILL.md must invoke the client by explicit path`)
        .toContain('$HOME/.local/bin/ccrc-api');
      expect(text, `${name} SKILL.md must still say a missing address is a stop, not a guess`)
        .toMatch(/empty[^.]*stop|stop[^.]*empty|refus[^.]*rather than guess/i);
    }
  });
});

// ── Build 9 wave 8: the peer protocol (spec D9-D13, D17) ───────────────────
//
// The FIRST copy of the etiquette rides the route response itself
// (`PEER_ETIQUETTE`, L0) — D-107's lesson: a skill reaches a config dir only
// once its installer has run there. This reference is the long form, and
// these pins hold the parts a coordinator or worker will actually act on:
// the capture idiom, the 409-as-address reading, and losing a race.
describe('the peer protocol reference (Build 9 wave 8, D17)', () => {
  const pp = (): string => refs('peer-protocol.md');

  it('does not send a coordinator away to wait for a sweep that no longer gates it', () => {
    // wave 2, F2: the first allocation on a fresh project measures the floor
    // itself. Prose promising an hourly wait would send a coordinator away from
    // a door that is now open — and that stall was the whole point of the
    // feature, since a project with no live session was never swept at all.
    const p = flat(pp());
    expect(p, 'peer-protocol.md still promises an hourly floor sweep')
      .not.toMatch(/hourly floor sweep has not yet/);
    expect(p, 'peer-protocol.md does not say the allocator seeds the floor itself')
      .toMatch(/seeds? (its own |the )?floor|measures the floor itself/i);
    // The refusal NARROWED; it did not go away, and its standing instruction is
    // unchanged. `claims-envelope.test.ts` separately requires the producer.
    expect(p, 'the report-do-not-invent instruction was lost with the rewrite')
      .toMatch(/report it, do not invent/i);   // case-insensitive: it now opens a sentence
    // Both surviving conditions are named, so a reader can tell which one they
    // are holding.
    expect(p, 'the two not-seeded conditions are not distinguished for the reader')
      .toMatch(/could not be measured/i);
  });

  it('teaches reading the body, and invokes no curl at all', () => {
    // Same rule SKILL.md's own "How to call the API" states, in the new terms:
    // the body is the whole protocol — the 409 this file exists to teach the
    // reading of arrives as a 4xx JSON body — so the client prints the body on
    // stdout and exits 0 whatever the status. The `-w '\n%{http_code}'` capture
    // this used to pin existed only because curl could not hand back both.
    expect(pp()).toContain('body=$("$API"');
    expect(pp()).not.toMatch(/curl/);
  });

  it('carries no second copy of the token pipeline or the address derivation', () => {
    // Single definition: both live in SKILL.md's "How to call the API" and
    // are pinned there against notify.sh/extractToken. A third copy here is
    // a third thing to rot; the reference points instead.
    expect(pp()).toContain('How to call the API');
    expect(pp()).not.toContain('CCRC_SERVER_URL');
    expect(pp()).not.toContain("grep -v '^[[:space:]]*#'");
  });

  it('reads the 409 as an address — every conflicting path, the intent, the mailHint', () => {
    expect(pp()).toContain('mailHint');
    expect(pp()).toContain('EVERY conflicting path');
    expect(pp()).toMatch(/ADDRESS, not a rejection slip/);
  });

  it('teaches byId/byUuid on the claim curls — the mail lane\'s fromId/fromUuid 400s there (fix, post-9b review)', () => {
    // The landed routes destructure `byId`/`byUuid` (`POST /api/claims`,
    // `POST /api/claims/:id/release`, routes.ts) and answer 400 bad-request
    // to anything else; `fromId`/`fromUuid` is the MAIL ingress's shape. The
    // pre-fix reference taught the mail spelling in both claim curl bodies,
    // walking every reader into a 400. Positive: both example bodies carry
    // the escaped-JSON `byId`/`byUuid` spelling. Negative: no curl body in
    // this file spells `fromId`/`fromUuid` (prose may CONTRAST the two lanes
    // in backticks; the escaped `\"` spelling only ever appears inside a -d
    // body, so it is the exact regression surface).
    // The spelling is no longer backslash-escaped: a `--json -` heredoc carries
    // plain JSON, where curl's `-d "…"` needed every quote escaped. The CLAIM
    // this pins is unchanged — these two routes destructure `byId`/`byUuid` and
    // 400 anything else, and the pre-fix reference taught the mail lane's
    // `fromId`/`fromUuid` in both bodies, walking every reader into a 400.
    expect(pp()).toContain('"byId":"$id"');
    expect(pp()).toContain('"byUuid":"$uuid"');
    expect(pp()).not.toContain('"fromId":"$id"');
    expect(pp()).not.toContain('"fromUuid":"$uuid"');
  });

  it('the allocate fence names byId, in the spelling the claim fence already uses', () => {
    // The route takes `byId` optionally and stores `byId ?? ''`, so an omitted
    // field lands as no holder at all — measured 2026-09-02, at least 101 of
    // this project's allocations are in that state. This fence is the only
    // documented allocate body in either corpus, so it is where that started.
    // What makes it about THIS fence is ORDER, measured: both existing
    // `"byId":"$id"` spellings (`:42` and `:68` — the claims bodies the test above
    // pins, ~80 lines above the allocator section) sit BEFORE `ledger
    // allocate`, so with this fence's byId deleted even an unbounded
    // `[\s\S]*` fails to match. The 220 bound is the FORWARD guard: it stops a
    // `byId` added in some later section from satisfying this from a distance.
    expect(pp()).toMatch(/ledger allocate[\s\S]{0,220}"byId":"\$id"/);
  });

  it('no reference file carries a ${resp expansion — the client returns the body, and there is no second stream', () => {
    // A curl-era leftover: `resp` is assigned nowhere in either corpus, so the
    // line overwrote the captured body with the empty expansion of an unset
    // variable. A coordinator copying that fence lost the whole 409 answer —
    // the ADDRESS this section's own prose ("Reading a 409") teaches reading.
    //
    // WIDENED (D-1417, same number as the fix): this scanned `peer-protocol.md`
    // ALONE, so the identical clobber landing in a sibling reference — every
    // one of which ships copyable fences — was invisible to it. The corpus is
    // DERIVED from the directory, the `REFERENCE_NAMES` reason (D-1003): a
    // reference file added tomorrow is scanned without anyone remembering to
    // add it. SKILL.md is deliberately OUT of this scan and must stay out — its
    // its "stdout is the response body" paragraph names `${resp` in PROSE, as
    // the history of what the capture idiom
    // USED TO be, and that sentence is the reason a reader does not reinvent it.
    for (const name of REFERENCE_NAMES) {
      expect(refs(name), `${name} carries the curl-era \${resp clobber`)
        .not.toContain('${resp');
    }
  });

  it('tells the truth about which layer refuses a bad claim path (fix, post-9b review)', () => {
    // An empty path never reaches the store: route shape validation answers
    // 400 bad-request first (`routes.ts` POST /api/claims). `bad-path` is
    // the STORE's decision, said about `.`/whole-repo claims. The pre-fix
    // text folded both into `bad-path`, teaching a refusal code the empty
    // path can never actually receive.
    expect(pp()).toMatch(/empty path[\s\S]{0,200}`bad-request`/);
    expect(pp()).not.toMatch(/empty path is refused `bad-path`/);
  });

  it('teaches losing a race as the mechanism working, with the uncontested-paths step', () => {
    expect(pp()).toContain('Losing a race is the mechanism working');
    expect(pp()).toMatch(/uncontested/);
    expect(pp()).toContain('Never edit the contested path anyway');
  });

  it('explains the two peer-lane mail codes the census requires', () => {
    // `mentions every declared MailRejectCode` above iterates the L0 list —
    // once wave 1 added `duplicate`/`peer-quota`, THIS file became their
    // documented home (they are peer-lane codes; the coordinator's own mail
    // always carries a runId and never meets either).
    for (const code of ['duplicate', 'peer-quota'] as const) {
      expect((MAIL_REJECT_CODES as readonly string[]).includes(code),
        `${code} should be a declared MailRejectCode since wave 1`).toBe(true);
      expect(pp()).toContain(code);
    }
  });

  it('never names the caps dial — a door that would tell a coordinator how to lift its own cap', () => {
    // Wave 6's accounting, the same shape: EXEMPT above only PERMITS the
    // omission, and this is what forbids the mention. Both halves, because the
    // read is the first half of the invitation.
    expect(allSkillText).not.toContain('/api/coord/caps');
  });

  it('never names the break door — a door the claimant is not the one to walk through', () => {
    // D16's accounting: `POST /api/claims/:id/break` is EXEMPT (the
    // `/api/runs/:id/abandon` shape) and stays unnamed in EVERY corpus file.
    // EXEMPT alone only permits the omission; this is what FORBIDS the
    // mention.
    expect(allSkillText).not.toContain('/api/claims/:id/break');
  });
});

// ── program-leverage wave 1 (F1): the coordinator-resume runbook ───────────
//
// The runbook ships into a corpus whose whole-file assertions — the
// destructive-verb census, the break-door prohibition, the untyped-refusal
// census — read `allSkillText`. That const was a HAND-TYPED list of three
// reference files, so this file would have been invisible to every one of
// them: the spec that added it names the census as the binding constraint on
// this very file, and it would have bound nothing (D-1000). The corpus is
// derived from the directory now; this describe is what reds if anyone types
// the list back.
describe('the coordinator-resume runbook (program-leverage wave 1, spec S3 item 3)', () => {
  const rb = (): string => refs('resume.md');

  it('is INSIDE the corpus every whole-file assertion in this suite reads', () => {
    // Not a tautology: with a hand-maintained `allSkillText` this is exactly
    // the assertion that fails, and it fails for the right reason.
    expect(allSkillText, 'references/resume.md is not in allSkillText — the census, the break-door ' +
      'prohibition and the untyped-refusal scan all skip it')
      .toContain('`GET /api/runs` is the whole orientation.');
  });

  it('names the two id-preserving revives, and says whose act they are', () => {
    // The one-argument form is the whole point: the two-argument form mints a
    // second id for a live session (ccd:15265-15270, and
    // SessionActionsSheet.tsx:287-289 names the same operator).
    expect(rb()).toContain('ccd start <id>');
    expect(rb()).toContain('/api/sessions/:id/ensure');
    // Clause 1 survives the runbook: a revive is not a fleet act this session
    // performs. Without this sentence the file reads as a coordinator's todo.
    expect(flat(rb())).toContain("Both of these are the OPERATOR's act");
  });

  it('spells the revive route WITHOUT a method, and keeps the reason attached', () => {
    // `auth-passkey.test.ts`'s THE SWEEP requires every `METHOD /api/path` in
    // either skill corpus to be in EXEMPT, and this route deliberately is not
    // (`auth/gate.ts`) — it is the browser's cookie-bearing call. MEASURED
    // while this landed: spelling the method reds that suite with exactly
    // `["POST /api/sessions/:id/ensure"]` in `blocked`. So the method would
    // both break the build AND teach a call a fleet-host session cannot make.
    // The negative below is the mechanism; the positive keeps the reason in
    // the prose, because this repo's own worked example of a doc lie is a
    // sentence with its qualifier filed off.
    expect(rb(), 'a method in front of the revive path reads as "a call you make", and reds auth-passkey')
      .not.toMatch(/(GET|POST|PUT|PATCH|DELETE)\s+`?\/api\/sessions/);
    expect(flat(rb())).toContain("it is not on the armed gate's exempt list");
  });

  it('says why a revive under a different id wedges the program until an OPERATOR moves it', () => {
    expect(rb()).toContain('claimed-by-another');
    // MOVED, not softened (D-1124). The old literal — `nothing in the HTTP API
    // ever rewrites claimedBy` — was true the day this runbook shipped and is
    // false the moment this wave's operator door exists. The replacement is
    // scoped to what a COORDINATOR can reach, which is the only scope this
    // runbook was ever entitled to speak in: the door is real, it is the
    // operator's, and this corpus never names it. That last clause is what
    // makes the sentence self-maintaining — the UNGATED harvest below and the
    // corpus-wide forbid this wave adds are what keep "named in this corpus"
    // true, so the prose cannot rot into a lie without a suite going red first.
    expect(flat(rb())).toContain('no call named in this corpus ever rewrites `claimedBy`');
  });

  it('carries no copy of the pre-reclaim absolute, in EITHER corpus file', () => {
    // `allSkillText`, deliberately, not `rb()`: the same claim stood in TWO
    // places (resume.md:38 and SKILL.md:31, measured), and a per-file pin would
    // have let the survivor go on teaching a coordinator that the wedge has no
    // door at all — the D-1000 shape, one file at a time. Truncated before
    // `claimedBy` so it catches a re-added absolute in any wording that reaches
    // for "the HTTP API"; the positives in the test above and in the SKILL.md
    // describe are what stop a DELETION passing for a fix, which a negative
    // alone cannot.
    expect(allSkillText, 'the pre-reclaim absolute is back — "nothing in the HTTP API ever ' +
      'rewrites `claimedBy`" is false once the operator door exists')
      .not.toContain('nothing in the HTTP API ever rewrites');
  });

  it('carries a wave-N re-kickoff template, not the wave-1 text the machine hardcodes', () => {
    // `kickoff()` in `pwa/src/fleet/StartProgramSheet.tsx` is correct exactly
    // once per program; a revive briefed with it re-opens wave 1 on a program
    // at wave N, and `CoordStore.openRun`'s dedupe arm covers only a still-
    // `planned` row, so the second open is a second row rather than a no-op.
    // BY SYMBOL, no line numbers: this wave's own comment-only commit shifted
    // that file and made the first draft of THIS comment stale (review round 1,
    // M2) — D-1005's argument arriving by the shortest possible route.
    expect(rb()).toContain('open the run for wave <N>');
    expect(flat(rb())).toContain('do not open wave 1 again');
  });

  it('says the console sends the wave-N text, and names that door WITHOUT a method too', () => {
    // Wave 4 shipped the kickoff route and this wave widened it with
    // `runId`/`wave`, so "A revive is briefed by hand" was false in this file
    // one wave before anyone could act on it (D-1126). The path is spelled bare
    // for exactly the reason `/api/sessions/:id/ensure` is, four sections up:
    // it is the browser's own cookie-bearing call, it is not an `EXEMPT` key,
    // and a method in front of it reds `auth-passkey.test.ts`'s THE SWEEP. The
    // negative that enforces that is `spells the revive route WITHOUT a method`
    // above — its regex is `/api/sessions`-wide, so it already covers this new
    // path for free. THIS positive is what stops the mention being deleted to
    // satisfy it, and the `programResumeKickoff` mention is what makes the
    // template below checkable against its one source instead of trusted.
    expect(rb()).toContain('/api/sessions/:id/kickoff');
    expect(flat(rb())).toContain('the console sends exactly this text');
    expect(flat(rb())).toContain('`programResumeKickoff`');
  });

  it('splits the terminal recovery in two — the id that can be handed over, and the row that cannot', () => {
    // A program whose id can no longer be revived now has an operator door. A
    // program RE-OPENED under a second id does not: that is a second run row,
    // a second ledger the board renders, and rewriting `claimedBy` does not
    // merge rows. Folding the two would send a coordinator to report a fix that
    // does not exist for its actual case — which is worse than the old absolute,
    // not better, because it fails at the moment of a real wedge.
    expect(flat(rb())).toContain('a second run row is a second ledger, and no reassignment merges them');
    expect(flat(rb())).toContain('naming the run and the id it claims');
  });

  it('points at the reconstruction drill as the terminal recovery, and at the snapshot first', () => {
    // Order matters in the prose for the same reason it matters in
    // `coord/db.ts:145-149`: the newest deploy snapshot is the restore path,
    // and reconstruct is what is left when there is none.
    expect(rb()).toContain('CoordStore.reconstruct');
    expect(rb()).toContain('ccrc-backups');
  });

  it('tells a LIVE coordinator that the revive door is not its recovery for a dead worker', () => {
    // The one real hazard of naming a revive door in this corpus: a
    // coordinator reaching for it on a WORKER instead of re-dispatching.
    expect(rb()).toContain('A dead WORKER is not this door');
  });

  it('never names the reclaim door — the release valve for a wedge the coordinator IS', () => {
    // The fourth ungated door (D-1123), and the same accounting D16 gave the third:
    // the EXEMPT entry above only PERMITS the omission; this is what FORBIDS the
    // mention. Wider than the `resume.md` harvest below, which reads one reference
    // file — a door named in `SKILL.md`, or in any of the other six references,
    // passes that and fails here.
    expect(allSkillText).not.toContain('/api/runs/:id/reclaim');
  });

  it('names none of the ungated operator doors — the list DERIVED, not typed', () => {
    // `allSkillText` already forbids the break door corpus-wide; the others are
    // exempt-by-omission with no positive prohibition anywhere, and a
    // wedge-recovery runbook is the file most likely to reach for one.
    //
    // The list is HARVESTED from `coord-pause-route.test.ts`'s `UNGATED`, not
    // typed here (review round 1, M7). A typed copy would have been the fourth
    // projection-without-a-mechanism in this wave — the class D-1000 and
    // D-1003 exist to delete — and it would fail exactly when it matters:
    // F5 adds a FOURTH ungated door, and a hand-typed triple would go on
    // passing while the new door drifted straight past this prohibition.
    // `UNGATED` is the right source because that suite already pins it against
    // `coord/routes.ts` in BOTH directions, so this reads a literal something
    // else keeps honest rather than minting a rival copy.
    const src = readFileSync(path.join(root, 'server/test/coord-pause-route.test.ts'), 'utf8');
    const m = /UNGATED = new Set\(\[([^\]]*)\]\)/.exec(src);
    expect(m, "coord-pause-route.test.ts no longer declares `UNGATED = new Set([...])` — this " +
      'harvest is reading a shape that moved, and a silent empty list would pass everything').not.toBeNull();
    const doors = [...(m as RegExpExecArray)[1]!.matchAll(/'([^']+)'/g)].map((d) => d[1]!);
    expect(doors.length, 'the UNGATED harvest came back empty').toBeGreaterThanOrEqual(3);
    for (const door of doors) {
      expect(rb(), `resume.md names ${door} — a door the coordinator is not the one to walk through`)
        .not.toContain(door);
    }
  });
});

// ── program-leverage wave 1 (F1): the trigger names the RUN RECORD ─────────
//
// `ccd ws-hold` hard-refuses a non-workspace, and `isMainCheckoutOf`
// (`pwa/src/fleet/StartProgramSheet.tsx`) is how a PWA-started coordinator is
// matched — `workspace === null` — so the hold arm of the old trigger described a
// state half the coordinators this skill runs in can never reach. The WORKER's
// identical-looking arm is CORRECT and stays: dispatch places `program:` holds on
// worker workspaces. Not ALWAYS, though — a workspace-resident coordinator can be
// given one by hand, and `ledger-template.md` still tells an orchestrator to. That
// contradiction is D-1004, measured and deferred, and it is why the skill's own
// prose was softened in review round 1 (M5) rather than left as an absolute. The
// run record is the one fact both kinds of coordinator share, and `GET /api/runs`
// is EXEMPT-BUT-AUTHENTICATED (`auth/gate.ts`, D-149) precisely so a cookieless
// fleet-host session can read it. Anchors by SYMBOL — see M2 above.
describe('the ask-answer 409 contract distinguishes route/CAS guards from answerAsk refusals', () => {
  const ROUTE_CAS_409 = ['not-held', 'ask-moved', 'child-unmeasurable'] as const;

  /** Derive the downstream vocabulary from answerAsk's own return statements,
   *  then prove every token still belongs to the shared wire vocabulary. */
  const downstreamAnswerRefusals = (): string[] => {
    const source = readFileSync(path.join(root, 'server/src/inject/ask.ts'), 'utf8');
    const body = source.slice(source.indexOf('export async function answerAsk('));
    return [...new Set([...body.matchAll(/ok: false, error: '([^']+)'/g)].map((m) => m[1]!))].sort();
  };

  it('names the three pre-answer route/CAS 409s and every downstream refusal separately', () => {
    const lifecycle = refs('wave-lifecycle.md');
    // Guard on the INDEX, not the slice: `slice(-1)` on a missing heading hands
    // back the file's last character, so a `not.toBe('')` here can never fire and
    // a renamed heading would red several assertions later under a message about
    // a refusal code instead.
    const at = lifecycle.indexOf('## The ask lane');
    expect(at, 'wave-lifecycle.md no longer carries the ask lane').toBeGreaterThanOrEqual(0);
    const section = lifecycle.slice(at);

    const downstream = downstreamAnswerRefusals();
    expect(downstream, 'answerAsk no longer exposes the ten documented downstream refusals')
      .toHaveLength(10);
    for (const code of [...ROUTE_CAS_409, ...downstream]) {
      expect(ASK_REFUSE_CODES as readonly string[], `${code} is not a shared AskRefuseCode`)
        .toContain(code);
      expect(section, `the ask lane does not name ${code}`).toContain(`\`${code}\``);
    }

    expect(flat(section), 'the route/CAS refusals are not scoped before answerAsk')
      .toContain(flat('three route/CAS guards before `answerAsk` (`not-held`, `ask-moved`, or `child-unmeasurable`)'));
    expect(flat(section), 'the downstream refusal list is not identified as answerAsk output')
      .toContain(flat('Downstream `answerAsk` refusals include'));
    // The negative below only catches the literal phrasings; a paraphrase
    // ("limited to three", "one of three things") walks straight past it. So the
    // load-bearing pin is POSITIVE and ARITHMETIC: the section states the split
    // as digits derived from the two sources above, so dropping a downstream
    // refusal from `answerAsk` or rewriting the prose back to a three-condition
    // claim both red here rather than only in a phrasing the regex happens to know.
    expect(section, 'the ask lane no longer states the 409 split as its two derived halves')
      .toContain(`(${ROUTE_CAS_409.length} + ${downstream.length}) distinct codes`);
    expect(section, 'the ask lane regressed to one of the literal three-condition phrasings')
      .not.toMatch(/409[^.]{0,240}(?:only|is|has) three (?:possible )?(?:conditions|refusals)/i);
  });

  // D-2719 narrowed the CLIENT to `state=held` and left the prose promising the
  // caller's "open asks" — and open is `held` PLUS `answering` (`fleet.ts`), so
  // the sentence sent a coordinator looking for contradictory questions to a
  // call that cannot show it one another principal has already taken. The state
  // is HARVESTED from the client, so narrowing it again without saying so reds.
  it('describes the asks-list view as the state the client actually sends', () => {
    const client = readFileSync(path.join(root, 'ccd/ccrc-api'), 'utf8');
    const state = /query="parent=\$DERIVED_ID&fromUuid=\$DERIVED_UUID&state=([a-z]+)"/
      .exec(client)?.[1];
    expect(state, 'the client no longer builds the asks-list query this harvest knows')
      .toBeTruthy();

    // And the claim the prose makes ABOUT that state — that it is narrower than
    // the route's own open set — is measured, not asserted: `fleet.ts` is where
    // open is decided, and it names two states.
    const fleet = readFileSync(path.join(root, 'server/src/fleet.ts'), 'utf8');
    const openStates = /row\.state === '([a-z]+)' \|\| row\.state === '([a-z]+)'/.exec(fleet);
    expect(openStates, 'fleet.ts no longer decides open on two ask states').not.toBeNull();
    const [, first, second] = openStates!;
    expect([first, second], 'the open set no longer contains the client-sent state')
      .toContain(state);
    const omitted = [first, second].find((x) => x !== state);
    expect(omitted, 'the open set no longer has a state this view omits').toBeTruthy();

    const lifecycle = refs('wave-lifecycle.md');
    const at = lifecycle.indexOf("Read your own children's");
    expect(at, 'the ask lane no longer describes the asks-list read')
      .toBeGreaterThanOrEqual(0);
    const para = flat(lifecycle.slice(at, lifecycle.indexOf('\n\n', at + 1)));

    expect(para, `the asks-list paragraph does not name \`state=${state}\``)
      .toContain(`\`state=${state}\``);
    expect(para, 'the asks-list paragraph no longer says the view is narrower than open')
      .toContain('NARROWER than the open set');
    expect(para, `the asks-list paragraph does not name the omitted \`${omitted}\` state`)
      .toContain(`\`${omitted}\``);
  });
});

describe('the coordinator skill triggers and resumes on the RUN RECORD, not a hold', () => {
  const fm = (): string => skill.slice(4, skill.indexOf('\n---', 4));

  it('triggers on the run record and KEEPS the operator-designation arm', () => {
    expect(fm()).toContain('the operator said so');
    expect(fm()).toContain('`GET /api/runs` names this session id as the `claimedBy` of an open run');
    // The mutation this exists for: restoring the hold arm. Scoped to the
    // frontmatter, because the BODY legitimately discusses holds — the
    // worker's, placed at dispatch — and a whole-file negative would forbid
    // the true statements alongside the false one.
    expect(fm(), 'the frontmatter trigger describes a hold again').not.toMatch(/hold reads/);
  });

  it('does not over-correct into asserting the coordinator is a main checkout', () => {
    // The other way to get this wrong, and the reason the fix is a rewrite
    // rather than a swap: an operator-designated coordinator MAY be
    // workspace-resident (program-leverage's own is), so a trigger that says
    // "main checkout" excludes the live case exactly as the hold arm excluded
    // the PWA-started one. A regression guard on the fix, not a red-first
    // driver — the pre-fix text did not say it either.
    expect(fm()).not.toMatch(/main checkout/i);
  });

  it('states the resume constraint as the SESSION ID, not the workspace', () => {
    expect(flat(skill)).toContain('and it is the SESSION ID, not the workspace');
    // WHITESPACE-COLLAPSED like every sibling here, and for the reason `flat`
    // exists at all: SKILL.md wraps mid-sentence, so a re-added `same
    // workspace,\nsame id` reads as two lines and walks straight past a raw
    // `toContain`. A negative that the mutation it names can evade is not a
    // guard (review round 1, M1).
    expect(flat(skill), 'the workspace framing is back').not.toContain('same workspace, same id');
  });

  it('states the wedge as a stop for THIS session, not as a door that does not exist', () => {
    // The SKILL.md half of the same correction (D-1124), and the one the
    // corpus-wide negative alone would leave unbacked. `flat()` for the reason
    // every sibling in this describe uses it: SKILL.md hard-wraps mid-sentence,
    // so a raw `toContain` on a sentence this long can only match by accident
    // (review round 1, M1 — a negative its own mutation can evade is not a guard).
    expect(flat(skill)).toContain('no call named in this corpus ever rewrites `claimedBy`');
    expect(flat(skill)).toContain('Handing the program to a different session is an operator act');
  });

  it('does not count the hold among the things a fresh coordinator resumes from', () => {
    // D-1002 — the third site, and the most load-bearing of the three: this is
    // what a LIVE coordinator reads before deciding what it must write down.
    expect(flat(skill)).toContain('The hold is NOT one of them');
    expect(flat(skill), 'the three-things sentence lists the hold again')
      .not.toMatch(/Everything you know lives in the program ledger[\s\S]{0,200}the workspace's hold/);
  });

  it('points a dying coordinator at the runbook, by the path the skill installs it at', () => {
    expect(skill).toContain('`references/resume.md`');
  });
});

// ── cross-repo wave 2: the project boundary, in the skill (spec §3 F3) ───────
//
// Wave 1 made the boundary MECHANICAL (`project-mismatch`, `home-mismatch`) and
// named both codes in the refusal list. That is the server refusing; this is the
// coordinator knowing. The two are not the same guard and the difference is
// measurable: a coordinator that meets `project-mismatch` has already queued a
// brief onto the wrong repo's workspace in its own head, and the refusal is what
// stops the fleet — not what tells it what to do instead.
//
// Sentence-literal pins, the same mechanism `CONTRACT` uses and for the same
// reason: the SENTENCE is the instruction, so a paraphrase must fail exactly as
// a deletion does. Each row carries what it is FOR, so a red names the rule that
// went missing rather than a 90-character string.
describe('the coordinator learns the project boundary (cross-repo wave 2, spec §3 F3)', () => {
  const CROSSING: readonly (readonly [string, string])[] = [
    ['the reuse rule — a sessionId is a same-project idiom',
      'Reuse `sessionId` ONLY when the next wave stays in the same project.'],
    ['what a crossing wave does instead',
      'A wave that CHANGES project opens WITHOUT `sessionId` and spawns a fresh workspace in the target repo'],
    // NARROWED BY D-2803, and the pin narrows with it. Review-runs replaced the
    // cap's positive `state NOT IN ('done','failed')` with a DERIVED
    // `NOT IN (idle ∪ terminal)`, so four dispatched non-terminal states —
    // `planned`, `awaiting-review`, `merging`, `closing` — stopped consuming a
    // slot. The old sentence stayed here, agreeing with the skill text it pins,
    // for a day after the code moved: prose pinned against prose is green while
    // both are false, which is why the crossrepo pin that reads `store.ts`
    // caught it and this one did not.
    ['the running-worker cap counts dispatched ACTIVE runs, not merely non-terminal ones',
      'concurrency counts dispatched runs in an ACTIVE state'],
    ['the daily cap counts each actual dispatch',
      'each actual dispatch still consumes daily budget'],
    ['homeProject on every open',
      'Every `POST /api/runs` for this programme carries `homeProject`'],
    ['the brief carries the immutable-plan source tuple',
      'carries the three immutable-plan coordinates: `homeRepoRoot`, `planRepoPath`, and `planSha`'],
    ['producer-source provenance is conditional on a real interface dependency',
      'Only a consumer that depends on a producer interface carries the producer contract'],
    ['a no-dependency foreign wave carries no producer contract or excerpt',
      'A foreign-repo wave with no producer-interface dependency carries none of those producer fields and no invented excerpt.'],
    ['the producer contract includes its own repository root',
      '`producerRepoRoot`, `producerSourceRepoPath`, `producerSha`'],
    ['the brief inlines a required contract excerpt verbatim',
      'contract excerpt inlined verbatim from the merged file'],
    ['the named plan blob is read exactly',
      'git -C "$homeRepoRoot" show "$planSha:$planRepoPath"'],
    ['the named producer blob is read exactly',
      'git -C "$producerRepoRoot" show "$producerSha:$producerSourceRepoPath"'],

    ['same-project succession transfers the hold',
      'close the producer with `final:false` so its hold transfers'],
    ['cross-project succession releases the producer',
      'close the producer with `final:true` and require `released:true`'],
    ['the producer is verified after close through closed runs',
      'run `"$API" runs list --closed 1`'],
    ['the exact producer SHA is independently proven merged',
      'independently prove the producer interface PR merged at the exact `producerSha`'],
    ['deviations are minted against the home project',
      'minted against the HOME project'],
  ];

  it('carries the crossing section at all', () => {
    expect(skill).toContain('## When a wave crosses into another project');
  });

  it('executes the runs-open example and transmits the complete programme identity', () => {
    const blocks = [...skill.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]!)
      .filter((block) => block.includes('"$API" runs open --json'));
    expect(blocks, 'SKILL.md must carry exactly one executable runs-open example').toHaveLength(1);
    const body = /runs open --json - <<JSON\n(\{[^\n]+\})\nJSON/.exec(blocks[0]!);
    expect(body, 'the executable runs-open example has no one-line JSON body').not.toBeNull();
    const keys = [...body![1]!.matchAll(/"([A-Za-z]+)":/g)].map((m) => m[1]!).sort();
    expect(keys).toEqual([
      'claimedBy', 'homeProject', 'program', 'project', 'title', 'wave', 'waveOf',
    ]);
    expect(body![1], 'the executable body omits the immutable programme home')
      .toContain('"homeProject":"<home project>"');

    const fixture = mkdtempSync(path.join(os.tmpdir(), 'ccrc-runs-open-example-'));
    const calls = path.join(fixture, 'calls');
    const api = path.join(fixture, '.local/bin/ccrc-api');
    try {
      mkdirSync(path.dirname(api), { recursive: true });
      writeFileSync(api, '#!/bin/sh\nprintf \'%s\\n\' "$*" > "$CALLS"\ncat >> "$CALLS"\n',
        { mode: 0o755 });
      const executable = blocks[0]!
        .replace(/<slug>/g, 'fixture-program')
        .replace(/<title>/g, 'Fixture title')
        .replace(/<project>/g, 'consumer-project')
        .replace(/<home project>/g, 'home-project')
        .replace(/<M or null>/g, '3');
      execFileSync('bash', ['-c', executable], {
        env: { ...process.env, HOME: fixture, API: api, id: 'coordinator-id', CALLS: calls },
      });
      const [argv, json] = readFileSync(calls, 'utf8').split('\n', 2);
      expect(argv).toBe('runs open --json -');
      expect(JSON.parse(json!)).toEqual({
        program: 'fixture-program', title: 'Fixture title', project: 'consumer-project',
        homeProject: 'home-project', wave: 1, waveOf: 3, claimedBy: 'coordinator-id',
      });
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  // `flat` is this file's own helper (`const flat = (s: string) => s.replace(/\s+/g, ' ')`,
  // the `readme-holds.test.ts` idiom):
  // both corpora wrap mid-clause at 80 columns, so a raw `toContain` would pin
  // the WRAP POINT rather than the sentence and would red on a re-flow that
  // changed nothing. A paraphrase still fails exactly as a deletion does.
  it.each(CROSSING)('states %s', (_what, sentence) => {
    expect(flat(skill), `SKILL.md no longer states ${_what}`).toContain(flat(sentence));
  });

  // D-2717, on the surface that is always loaded. `wave-lifecycle.md` is read on
  // demand; SKILL.md is read every wave, and its step 6 states the two
  // successions as two arms. The CROSSING table above pins their sentences with
  // bare `toContain`s over the whole file — and the closed-row phrase occurs in
  // BOTH arms, so deleting it from either one left every row green. Measured per
  // arm, by index, so an arm that loses an act, or states it before the close it
  // is supposed to follow, reds where the arm is named.
  it('orders each SKILL.md succession arm independently: open, close, then the closed-row proof', () => {
    const start = skill.indexOf('6. **Rule on the report**');
    expect(start, 'SKILL.md no longer carries step 6').toBeGreaterThanOrEqual(0);
    const end = skill.indexOf('\n7. **Final merge:**', start + 1);
    expect(end, 'step 6 no longer ends where step 7 begins').toBeGreaterThan(start);
    const step6 = skill.slice(start, end);

    const sameAt = step6.indexOf('**Same project:**');
    const crossAt = step6.indexOf('**Different project:**');
    expect(sameAt, 'step 6 no longer has a same-project arm').toBeGreaterThanOrEqual(0);
    expect(crossAt, 'step 6 no longer has a cross-project arm').toBeGreaterThan(sameAt);

    const same = flat(step6.slice(sameAt, crossAt));
    const cross = flat(step6.slice(crossAt));

    for (const [name, arm, closeWith] of [
      ['the same-project arm', same, '`final:false`'],
      ['the cross-project arm', cross, '`final:true`'],
    ] as const) {
      const open = arm.indexOf('open wave N+1 first');
      const close = arm.indexOf(closeWith);
      const proof = arm.indexOf('runs list --closed 1');
      const done = arm.indexOf('require its own `state` to be `done`');
      expect(open, `${name} no longer opens the successor first`).toBeGreaterThanOrEqual(0);
      expect(close, `${name} no longer closes the producer with ${closeWith}`).toBeGreaterThan(open);
      expect(proof, `${name} no longer reads the closed run AFTER its own close`).toBeGreaterThan(close);
      expect(done, `${name} no longer requires the producer row's own state to be done`)
        .toBeGreaterThan(proof);
    }

    // D-2716's other half: merge proof belongs to the cross-project arm, and only
    // behind a real dependency. Deleting the condition makes it mandatory for
    // every crossing — green under every other assertion in this file.
    expect(same, 'the same-project arm now demands an interface merge proof')
      .not.toContain('merged at the exact `producerSha`');
    const cond = cross.indexOf('If the consumer depends on an interface from that producer,');
    const merge = cross.indexOf('merged at the exact `producerSha`');
    expect(cond, 'the cross-project merge proof is no longer conditional on a real dependency')
      .toBeGreaterThanOrEqual(0);
    expect(merge, 'the cross-project arm no longer names the exact-SHA merge proof')
      .toBeGreaterThan(cond);
  });

  // D-2824: dispatch is `planned`'s door only (transitionsFor); a send-back
  // arm that dispatches a run at `working` describes a call the server
  // refuses. This pin is the class the branch lacked — an instruction
  // checked against the transition table.
  it('sends the worker back by mail, never by dispatch, after advancing the run', () => {
    const step6 = skill.slice(skill.indexOf('6. **Rule on the report**'),
      skill.indexOf('\n7. **Final merge:**'));
    const start = step6.indexOf('**Send back:**');
    expect(start, 'step 6 lost its Send back arm').toBeGreaterThanOrEqual(0);
    const end = step6.indexOf('**Clean:**', start + 1);
    expect(end, 'the Send back arm no longer ends where the Clean arm begins').toBeGreaterThan(start);
    const sendBack = step6.slice(start, end);

    // Not a bare `not.toContain('runs dispatch')`: the corrected prose itself
    // names the banned call ("never by `runs dispatch`") to explain why not.
    // What must be absent is the INVOCATION — the exact call form the old
    // arm told the coordinator to make.
    expect(sendBack, 'the send-back arm still tells the coordinator to `runs dispatch <work run id>`')
      .not.toContain('runs dispatch <work run id>');
    expect(sendBack, 'the send-back arm no longer re-briefs the worker by mail')
      .toContain('mail send');
    expect(sendBack, 'the send-back arm no longer sends a `fix-round` mail')
      .toContain('fix-round');

    const advanceAt = sendBack.indexOf('runs advance');
    const mailAt = sendBack.indexOf('mail send');
    expect(advanceAt, 'the send-back arm no longer advances the run to working').toBeGreaterThanOrEqual(0);
    expect(mailAt, 'the mail send is no longer AFTER the advance that must precede it')
      .toBeGreaterThan(advanceAt);
  });

  // D-2730. The crossing section points BACK at step 6, and this branch rewrote
  // step 6 — so the pointer's claim ("nothing in it says so") was falsified by
  // the same commit that made it worth reading. A cross-reference is a claim
  // about another section, and nothing checked it: the CROSSING table pins only
  // the bolded lead sentence. Grounded in step 6's own arm markers, so rewriting
  // either section without the other reds here.
  it('describes step 6 as step 6 actually reads', () => {
    const start = skill.indexOf('## When a wave crosses into another project');
    const end = skill.indexOf('\n## ', start + 1);
    const section = flat(skill.slice(start, end === -1 ? undefined : end));

    const step6 = skill.slice(skill.indexOf('6. **Rule on the report**'),
      skill.indexOf('\n7. **Final merge:**'));
    for (const arm of ['**Same project:**', '**Different project:**']) {
      expect(step6, `step 6 lost its ${arm} arm`).toContain(arm);
      expect(section, `the crossing section does not name step 6's ${arm} arm`)
        .toContain(arm);
    }
    // The falsified claim itself, by the property rather than the wording: the
    // crossing section may not tell the reader step 6 is silent on this, because
    // step 6 is not.
    expect(section, 'the crossing section still claims step 6 does not distinguish the two')
      .not.toMatch(/nothing in it says so|step 6[^.]{0,80}does not say/i);
  });

  it('names BOTH new refusal codes where the rule that provokes them is stated', () => {
    // Not the refusal-list sentence (wave 1's, pinned by its own test above):
    // this is the section that tells a coordinator what it did to earn them, and
    // a rule stated without its refusal leaves the reader to guess which one
    // they are looking at.
    const start = skill.indexOf('## When a wave crosses into another project');
    expect(start, 'the crossing section is gone').toBeGreaterThanOrEqual(0);
    const end = skill.indexOf('\n## ', start + 1);
    const section = skill.slice(start, end === -1 ? undefined : end);
    for (const code of ['project-mismatch', 'home-mismatch']) {
      expect(section, `the crossing section never names ${code}`).toContain(code);
    }
    // And the caps it warns about are the real ones, spelled as the codes the
    // dispatch actually answers with.
    for (const cap of ['cap-concurrency', 'cap-daily']) {
      expect(section, `the crossing section never names ${cap}`).toContain(cap);
    }
  });

  // D-2686's caps paragraph tells a refused coordinator which numbers to read.
  // It named `running` for BOTH codes for one round, and only `cap-concurrency`
  // carries one — so the sentence sent a `cap-daily` reader after a field its
  // frame does not have. HARVESTED from the two refusal frames rather than
  // typed, so renaming a field, or adding a third cap, reds here.
  const capRefusalFields = (code: string): string[] => {
    const src = readFileSync(path.join(root, 'server/src/coord/dispatch.ts'), 'utf8');
    const at = src.indexOf(`code: '${code}',`);
    if (at < 0) throw new Error(`dispatch.ts sends no ${code} refusal — this harvest is stale`);
    const frame = src.slice(at, src.indexOf('};', at));
    return [...new Set([...frame.matchAll(/(\w+):/g)].map((m) => m[1]!))]
      .filter((f) => f !== 'code').sort();
  };

  it('tells a refused coordinator the fields its OWN cap frame carries', () => {
    const caps = refs('wave-lifecycle.md');
    // Anchor follows the heading D-2803 corrected: the paragraph is no longer
    // "runs, not holds" but "ACTIVE runs, not holds and not merely non-terminal".
    const start = caps.indexOf('**Caps count ACTIVE runs,');
    expect(start, 'wave-lifecycle.md no longer carries the caps paragraph')
      .toBeGreaterThanOrEqual(0);
    const para = flat(caps.slice(start, caps.indexOf('\n\n**', start + 1)));

    const concurrency = capRefusalFields('cap-concurrency');
    const daily = capRefusalFields('cap-daily');
    expect(concurrency, 'cap-concurrency no longer carries limit and running')
      .toEqual(['limit', 'running']);
    expect(daily, 'cap-daily no longer carries limit and used').toEqual(['limit', 'used']);

    for (const field of concurrency) {
      expect(para, `the caps paragraph never names cap-concurrency's \`${field}\``)
        .toContain(`\`${field}\``);
    }
    for (const field of daily) {
      expect(para, `the caps paragraph never names cap-daily's \`${field}\``)
        .toContain(`\`${field}\``);
    }
    // The whole point: the field `cap-daily` does NOT carry must be said to be
    // absent from it, not left for the reader to discover on a live refusal.
    const missing = concurrency.filter((f) => !daily.includes(f));
    expect(missing, 'the two cap frames no longer differ, so this pin is moot')
      .not.toEqual([]);
    for (const field of missing) {
      expect(para, `the paragraph does not say cap-daily never carries \`${field}\``)
        .toMatch(new RegExp(`cap-daily[^.]{0,160}never carries \`${field}\``));
    }
  });

  it('does not let the crossing section teach a second /clear writer or a reap', () => {
    // The census tests above count `ws-reap`/`ws-rm`/`ws-gc` over `allSkillText`
    // and clause 9 owns `/clear`; a new section is exactly where a well-meant
    // recovery sentence gets added. Asserted HERE too, scoped to the section, so
    // the failure names the section rather than a whole-file count.
    const start = skill.indexOf('## When a wave crosses into another project');
    const end = skill.indexOf('\n## ', start + 1);
    const section = skill.slice(start, end === -1 ? undefined : end);
    for (const forbidden of ['ws-reap', 'ws-rm', 'ws-gc', '/clear']) {
      expect(section, `the crossing section names ${forbidden}`).not.toContain(forbidden);
    }
  });

  // The reference is what a coordinator reads WHILE making the call — the
  // refusal tables wave 1 extended live here, three lines from the body being
  // typed. A boundary stated only in SKILL.md is a boundary read once, at
  // install time, by a session that had no run open yet.
  const LIFECYCLE: readonly (readonly [string, string])[] = [
    ['§1 — why sessionId is a same-project field',
      '`sessionId` reclaims a workspace, and a workspace lives in ONE repo'],
    ['§1 — the crossing open sends none',
      'a wave that changes project sends no `sessionId` at all'],
    ['§1 — homeProject rides the open body',
      '`"homeProject":"<the home project>"`'],
    ['§1 — the two response fields, and their null',
      'both are null while the stored home is null'],
    ['§1 — ledgerAbsPath is not a plan coordinate',
      '`ledgerAbsPath` is ONLY that home\'s programme ledger'],
    ['§2 — what a foreign-repo brief carries beyond the ordinary list',
      '`homeRepoRoot`, the absolute path to the home repository root; `planRepoPath`'],
    ['§2 — the named plan is read mechanically',
      'git -C "$homeRepoRoot" show "$planSha:$planRepoPath"'],
    ['§2 — producer-source provenance is conditional',
      'Only a consumer with a producer-interface dependency carries the producer contract'],
    ['§2 — no dependency means no producer fields or excerpt',
      'A foreign-repo wave with no such dependency carries none of these producer fields and no invented excerpt.'],
    ['§2 — the producer repository root is named',
      '`producerRepoRoot`, the absolute producer-repository root'],
    ['§2 — producer-source provenance is named',
      '`producerSourceRepoPath`, the producer source file\'s repository-relative path'],
    ['§2 — the named producer source is read mechanically',
      'git -C "$producerRepoRoot" show "$producerSha:$producerSourceRepoPath"'],
    ['§2 — plan failure cannot fall back to a mutable checkout',
      'If that repository, commit, or path cannot be resolved, it reports and stops.'],
    ['§2 — producer failure cannot fall back to consumer cwd',
      'If that producer repository, commit, or path cannot be resolved, it reports and stops.'],
    ['§5 — same-project close transfers the hold',
      'close the producer with `final:false`'],
    ['§5 — cross-project close releases the producer',
      'close the producer with `final:true` and require `released:true`'],
    ['§5 — the same-project producer is queried after its close',
      'After that same-project close, run `"$API" runs list --closed 1`'],
    ['§5 — the cross-project producer is queried after its close',
      'After that cross-project close, run `"$API" runs list --closed 1`'],
    ['§5 — a required merge is proved independently at the producer SHA',
      'If the consumer depends on an interface from this producer, independently prove the producer interface PR merged at the exact `producerSha`'],

  ];

  it.each(LIFECYCLE)('wave-lifecycle.md states %s', (_what, sentence) => {
    expect(flat(refs('wave-lifecycle.md')), `wave-lifecycle.md no longer states ${_what}`)
      .toContain(flat(sentence));
  });

  it('orders each succession branch independently before consumer dispatch', () => {
    const lifecycle = refs('wave-lifecycle.md');
    const boundary = lifecycle.slice(lifecycle.indexOf('## 5 — The boundary'),
      lifecycle.indexOf('## 6 — Final merge'));
    const sameStart = boundary.indexOf('**Same project:**');
    const crossStart = boundary.indexOf('**Different project:**');
    const commonStart = boundary.indexOf('\n   A missing/non-`done` producer row', crossStart);
    const dispatchAt = boundary.indexOf('Dispatch wave N+1');
    expect(sameStart).toBeGreaterThanOrEqual(0);
    expect(crossStart).toBeGreaterThan(sameStart);
    expect(commonStart).toBeGreaterThan(crossStart);
    expect(dispatchAt).toBeGreaterThan(commonStart);

    const same = boundary.slice(sameStart, crossStart);
    const sameOpen = same.indexOf('open wave N+1 first');
    const sameClose = same.indexOf('close the producer with `final:false`');
    const sameCheck = same.indexOf('"$API" runs list --closed 1');
    expect(sameOpen, 'same-project successor open is missing').toBeGreaterThanOrEqual(0);
    expect(sameClose, 'same-project close must follow its open').toBeGreaterThan(sameOpen);
    expect(sameCheck, 'same-project closed-row proof must follow its close').toBeGreaterThan(sameClose);

    const cross = boundary.slice(crossStart, commonStart);
    const crossOpen = cross.indexOf('open wave N+1 first');
    const crossClose = cross.indexOf('close the producer with `final:true`');
    const crossCheck = cross.indexOf('"$API" runs list --closed 1');
    const merge = cross.indexOf('independently prove the producer interface\n   PR merged');
    expect(crossOpen, 'cross-project successor open is missing').toBeGreaterThanOrEqual(0);
    expect(crossClose, 'cross-project close must follow its open').toBeGreaterThan(crossOpen);
    expect(crossCheck, 'cross-project closed-row proof must follow its close').toBeGreaterThan(crossClose);
    expect(merge, 'conditional exact-SHA merge proof must follow the cross-project row proof')
      .toBeGreaterThan(crossCheck);
  });

  // D-2728. The wave-3 plan prescribes BOTH a test and the prose that test runs
  // against, and nothing executes a plan document — so the two halves drifted
  // apart and the plan still declared "Expected: PASS". Measured against the
  // shipped plan before this guard: five of its prescribed assertions could not
  // match its prescribed prose, every one because the required phrase wraps
  // across a line or a window is too narrow. A worker transcribing both halves
  // as instructed gets a red suite and most naturally "fixes" the prose, which
  // was correct. This runs the load-bearing ones for real, against the plan's own
  // fenced markdown, so either half moving without the other reds HERE — in a
  // suite that does run — rather than in wave 3's first hour.
  describe("the wave-3 plan's prescribed assertions match its prescribed prose", () => {
    /** The markdown/text fenced blocks are the prose the plan tells wave 3 to
     *  WRITE; its `ts` blocks are the assertions it tells wave 3 to RUN. */
    const prescribedProse = (): string => {
      const plan = readFileSync(path.join(
        root, 'docs/superpowers/plans/2026-09-08-crossrepo-wave3-docs-flip.md'), 'utf8');
      const blocks: string[] = [];
      let inFence = false; let lang = ''; let buf: string[] = [];
      for (const line of plan.split('\n')) {
        const fence = /^```(\w*)\s*$/.exec(line);
        if (fence) {
          if (!inFence) { inFence = true; lang = fence[1]!; buf = []; }
          else { if (['markdown', 'md', 'text', ''].includes(lang)) blocks.push(buf.join('\n')); inFence = false; }
          continue;
        }
        if (inFence) buf.push(line);
      }
      expect(blocks.length, 'the wave-3 plan prescribes no prose at all').toBeGreaterThan(5);
      return blocks.join('\n\n');
    };

    const PRESCRIBED: readonly (readonly [string, RegExp])[] = [
      ['the producer tuple is conditional on a real dependency',
        /only[\s\S]{0,100}?depends on a producer interface[\s\S]{0,220}?producerRepoRoot[\s\S]{0,240}?inline/i],
      ['a no-dependency wave invents no producer evidence',
        /no producer-interface dependency[\s\S]{0,160}?no producer tuple[\s\S]{0,100}?no invented\s+excerpt/i],
      ['the named plan blob is the requirements authority',
        /plan blob[\s\S]{0,100}?requirements\s+authority/i],
      ['the programme feed read is the full archive',
        /feed[\s\S]{0,120}?full\s+(?:feed\s+|event\s+)?archive/i],
      ['cross-project succession omits the producer session',
        /without the producer's\s+`sessionId`/],
      ['the refusal-as-test rule survives',
        /`project-mismatch`\s+never fires in anger[\s\S]{0,80}?proof is a test/i],
      ['the dogfood reads the immutable producer blob',
        /reads[\s\S]{0,60}?immutable producer source blob/],
      ['the producer read is rooted at the producer repository',
        /git -C "\$producerRepoRoot" show "\$producerSha:\$producerSourceRepoPath"/],
    ];

    it.each(PRESCRIBED)('%s', (_what, re) => {
      expect(prescribedProse(), `the wave-3 plan prescribes an assertion its own prose cannot satisfy: ${_what}`)
        .toMatch(re);
    });

    // D-2729, in the same place and for the same reason: the plan cites the
    // coordinator's acceptance block, and a citation that drops its first number
    // reds a correct ledger. Derived from THIS plan's own narrative rather than
    // typed, so the block moving corrects both at once.
    it('cites the acceptance block the wave-2 plan actually defines', () => {
      const wave2 = readFileSync(path.join(
        root, 'docs/superpowers/plans/2026-09-08-crossrepo-wave2-skills-pwa.md'), 'utf8');
      const block = /thirty-third through fortieth — (D-\d{4}–D-\d{4})/.exec(wave2)?.[1];
      expect(block, 'the wave-2 plan no longer names the coordinator acceptance block').toBeTruthy();
      const [first] = block!.split('–');
      const wave3 = readFileSync(path.join(
        root, 'docs/superpowers/plans/2026-09-08-crossrepo-wave3-docs-flip.md'), 'utf8');
      expect(wave3, `the wave-3 plan cites a block other than ${block!}`).toContain(block!);
      const ledger = readFileSync(path.join(
        root, 'docs/superpowers/programs/crossrepo-programmes.md'), 'utf8');
      expect(ledger, `the ledger does not record ${first!}`).toContain(first!);
    });
  });

  it('keeps the superseded 2026-08-11 specification byte-identical to origin/main', () => {
    const historicalPath = 'docs/superpowers/specs/2026-08-11-crossrepo-programmes-design.md';
    const historical = readFileSync(path.join(root, historicalPath));
    const baseline = execFileSync('git', ['show', `origin/main:${historicalPath}`], { cwd: root });
    expect(historical).toEqual(baseline);

    // The comparison above is against a MOVING ref, and it says nothing about
    // WHAT the file holds: once this branch merges it compares the file to
    // itself, so from that moment it pins "unchanged since whatever main says"
    // rather than the ruling this document exists to preserve. The literals
    // below are the content half — Q1's refusal and Q2's requirement, the two
    // rulings every later wave cites — so an edit that lands on main and then
    // propagates here still reds.
    const text = historical.toString('utf8');
    for (const ruling of [
      '**Q1 — cross-run dependency edge: DISCIPLINE, not schema.**',
      'the door stays open additively (an optional `dependsOn` + one typed refusal)',
      '**Q2 — `homeProject`: EXPLICIT AND REQUIRED, soon.**',
      'Evidence\ndrives schema.',
    ]) {
      expect(text, `the 2026-08-11 ruling record no longer carries: ${ruling.slice(0, 56)}…`)
        .toContain(ruling);
    }
  });

  it('does not teach mutable-plan fallbacks or collapse ledger and plan paths', () => {
    const lifecycle = refs('wave-lifecycle.md');
    const brief = lifecycle.slice(lifecycle.indexOf('**Every brief for a wave in ANOTHER project'),
      lifecycle.indexOf('**The execution skill is the one list item'));
    expect(brief).not.toContain('cat "$planAbsPath"');
    expect(brief).not.toContain('show "HEAD:');
    expect(brief).not.toContain('the absolute path of the home plan');
    expect(flat(brief)).toContain('current checkout\'s plan is not authoritative');

    const plan = readFileSync(path.join(
      root, 'docs/superpowers/plans/2026-09-08-crossrepo-wave2-skills-pwa.md'), 'utf8');
    const task = plan.slice(plan.indexOf('## Task 1:'), plan.indexOf('## Task 2:'));
    expect(task).toContain('`ledgerAbsPath` names\nonly that programme ledger, never a plan coordinate');
    expect(task).toMatch(/`homeRepoRoot`[\s\S]{0,120}`planRepoPath`[\s\S]{0,120}`planSha`/);
    expect(task).not.toContain('`ledgerAbsPath` is\nthe path you build a plan citation from');
  });

  // §4. There are TWO roles now, and the asymmetry between them is the part a
  // coordinator gets wrong: `coordinator` has a fallback (the single active
  // programme) and `worker` cannot have one, because a worker is per RUN and
  // there is nothing to fall back to. Carry the runId always and the asymmetry
  // never bites — which is exactly why it has to be written where the send is.
  const ROLES: readonly (readonly [string, string])[] = [
    ['mail-envelope.md', 'There are two role names, `coordinator` and `worker`'],
    ['mail-envelope.md', 'a `worker` mail names the `runId` of the run whose worker it wants'],
    ['mail-envelope.md', 'a `worker` mail with no `runId` is refused `unknown-recipient`'],
    ['wave-lifecycle.md', 'carry the `runId` on every mail you send, whichever role you address'],
    ['wave-lifecycle.md', 'a `worker` mail with no `runId` is refused `unknown-recipient`'],
  ];

  it.each(ROLES)('%s carries the role rule: %s', (file, sentence) => {
    expect(flat(refs(file)), `${file} no longer states: ${sentence}`).toContain(flat(sentence));
  });

  it('SKILL.md tells the coordinator how to address a worker, in the crossing section', () => {
    expect(flat(skill)).toContain(
      flat("Address the worker as `toId: 'worker'` with this run's `runId`"));
  });

  it('keeps the resolved-recipient promise while adding the second role', () => {
    // The envelope's `to:` is still ALWAYS a session id. A second role is a
    // second thing the INGRESS resolves, never a second thing that can appear
    // on the face of a rendered envelope — and the byte-identity test above
    // (renderEnvelope's real output) is what would catch the alternative.
    const env = flat(refs('mail-envelope.md'));
    expect(env).toContain('**`to:` is always the resolved recipient.**');
    expect(env).toContain('resolveWorker');
  });
});

describe('the routing clauses (routing slice 2)', () => {
  it('clause 13 names the matrix reference, which ships, and step 2 sends the brief writer to it', () => {
    const c13 = CONTRACT[12]!;
    expect(c13).toContain('`references/routing-matrix.md`');
    expect(REFERENCE_NAMES).toContain('routing-matrix.md');
    // step 2's list of what a brief carries, in SKILL.md and in the reference
    // (anchored on step 2's own opening phrase, not clause 13's — clause 13
    // also contains "the shape of the wave and the routing" ~170 chars before
    // its own routing-matrix.md mention, which made that anchor self-satisfied)
    expect(flat(skill)).toMatch(/what only this wave knows[\s\S]{0,320}routing-matrix\.md/);
    expect(flat(refs('wave-lifecycle.md'))).toMatch(/A brief carries what only THIS wave knows:[\s\S]{0,900}routing-matrix\.md/);
  });

  it('clause 14 names the panel reference, which ships, and step 5 sends the REVIEWER to it', () => {
    // The merge of 2026-09-16: the panel is the review run's SHAPE, run by the
    // reviewer (clause 14), not something this session runs on the diff —
    // clause 12 (review runs, design 2026-09-14) forbids that reading, so the
    // SKILL.md anchor is step 5's `Lenses:` sentence rather than the deleted
    // "Review the handoff commit".
    const c14 = CONTRACT[13]!;
    expect(c14).toContain('`references/review-panel.md`');
    expect(c14).toContain('unverified, never as approval');
    expect(c14).toContain('the reviewer runs it as written');
    expect(REFERENCE_NAMES).toContain('review-panel.md');
    expect(flat(skill)).toMatch(/`Lenses:` line names the held-out panel[\s\S]{0,160}review-panel\.md/);
    expect(flat(refs('review-brief.md'))).toMatch(/Lenses:[\s\S]{0,120}review-panel\.md/);
    expect(flat(refs('wave-lifecycle.md'))).toMatch(/## 5 — The boundary[\s\S]{0,600}review-panel\.md/);
  });

  it('wave-lifecycle.md §4 documents the two signal lines with every word the vocabulary admits, and the signals section names the two new fields', () => {
    const wl = refs('wave-lifecycle.md');
    for (const w of SUITE_WORDS) expect(wl).toMatch(new RegExp(`suite: [^\\n]*\\b${w}\\b`));
    for (const k of FAILURE_KINDS) expect(wl).toMatch(new RegExp(`failure: [^\\n]*\\b${k}\\b`));
    expect(wl).toContain('waveDoneMails');
    expect(wl).toMatch(/`signals`/);
    // absent vs unrecognised — the reader is told the third answer exists
    expect(wl).toContain('unrecognised');
  });
});

describe('the routing door in the references (routing slice 5, Task 4)', () => {
  it('the "Reading ccd is fine" paragraph names the door, never the verb, as how this session changes a run\'s routing', () => {
    // Subject-bound (memory: a-substring-pin-binds-no-subject) — isolate the
    // paragraph itself rather than grepping the whole file for a bare
    // /never/ or /route/, so a sentence added anywhere else in SKILL.md
    // cannot satisfy this pin by accident.
    const readingCcd = skill.split('\n\n').find((p) => p.startsWith('**Reading ccd is fine.**'));
    expect(readingCcd, 'the "Reading ccd is fine" paragraph is gone from SKILL.md').toBeDefined();
    expect(readingCcd).toContain('POST /api/runs/:id/route');
    expect(readingCcd).toContain('ccrc-api runs route');
    expect(readingCcd).toMatch(/`ccd route` is never this session's call/);
  });

  it('does not add the door sentence inside a byte-pinned clause', () => {
    for (const clause of CONTRACT) expect(clause).not.toContain('ccrc-api runs route');
  });

  it('wave-lifecycle.md §4 carries the escalation example, the demotion guidance, and never `ccd route`', () => {
    // Bound to §4 itself (fix round 1, finding #1) — the paragraph lives in
    // §4 but below the advance bullets, so slice from the §4 heading to the
    // next `## ` heading the way the signals-section test below slices
    // between two headings, rather than asserting against the whole file
    // (which would stay green even if the paragraph moved into another
    // section entirely).
    const wl = refs('wave-lifecycle.md');
    const start = wl.indexOf('## 4 — Advance the run as the wave progresses');
    const end = wl.indexOf('## 5 — The boundary');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const section4 = wl.slice(start, end);
    expect(section4).toContain('"$API" runs route "$run_id" --json -');
    expect(section4).toMatch(/kind":"<shallow\|ceiling\|unclear>"/);
    expect(section4).toContain('**Demotion** is your judgement');
    expect(section4).toMatch(/Never `ccd route` \(clause 1\) and never `--apply`/);
    // Controller ruling S5-R10 (fix round 1, finding #3): a refusal records
    // neither a run event nor a journal row, so the mandated sentence is
    // qualified to calls that change a record. Subject-bound (memory:
    // a-substring-pin-binds-no-subject) — anchored on "Every call" so an
    // unrelated "records neither" elsewhere in the section cannot satisfy it.
    expect(flat(section4)).toMatch(
      /Every call that CHANGES a record is one run event and one journal row; a refusal — the ladder's answers included — records neither\./,
    );
    // Routing slice 6, Task 1: the run-scoped sentence final review left
    // here (D-2957) is CLOSED — `lastDemotion` and the same-kind count are
    // now derived from the target SESSION's event trail, across every run
    // it touches, not ONE run's events. §4 now says so where the
    // coordinator acts. Each claim is bound to its own subject rather than
    // one wide regex over the section (memory: a-substring-pin-binds-no-subject).
    const scope = flat(section4);
    expect(scope).toContain('The reversal follows the SESSION, across every wave.');
    expect(scope).toMatch(/demotion taken on wave N's run IS reversed by a failed check you report against wave N\+1's run, on the same session/);
    expect(scope).toMatch(/same-kind count carries forward with it rather than restarting at zero/);
    expect(scope).toMatch(/D-2957[\s\S]{0,80}CLOSED by routing slice 6/);
    // Finding #1: a class rung writes TWO fields, and the answer says which.
    expect(scope).toContain('A class rung is two fields in one write.');
    expect(scope).toMatch(/resets\s+effort in the SAME call[\s\S]{0,140}`auto` onto haiku/);
    expect(scope).toMatch(/`applied\.effortReset`[\s\S]{0,200}`null` when the call wrote a single field/);
  });

  it('wave-lifecycle.md\'s signals section names arm, routing, armUnparsed and routingUnparsed', () => {
    const wl = refs('wave-lifecycle.md');
    const start = wl.indexOf("## The run's own signals");
    const end = wl.indexOf('## The routing door');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const signalsSection = wl.slice(start, end);
    for (const field of ['`arm`', '`routing`', '`armUnparsed`', '`routingUnparsed`']) {
      expect(signalsSection, `the signals section does not name ${field}`).toContain(field);
    }
    // §6's reader rule, in one sentence
    expect(signalsSection).toMatch(/`routing` is non-empty[\s\S]{0,120}mid-flight/);
    // S5-R9 (fix round 1, finding #2): armUnparsed is what tells arm's two
    // `null` causes apart — no arm ever seeded vs. an unparseable arm event
    // excluded from its arm's mean. Named beside the `armUnparsed` field
    // itself so this cannot be satisfied by the field name alone.
    expect(signalsSection).toMatch(/armUnparsed === 0[\s\S]{0,200}armUnparsed > 0/);
  });
});
