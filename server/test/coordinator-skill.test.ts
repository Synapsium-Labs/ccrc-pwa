// The coordinator skill is prose a model follows unsupervised against a fleet
// it can destroy. These are the properties a review cannot hold in place:
// ten contract clauses, the routes it names, the refusal codes it promises,
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
import { readFileSync } from 'node:fs';
import { CCRC_API } from './ccdWsHelpers.js';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderEnvelope, type EnvelopeInput } from '../src/coord/envelope.js';
import { WORKER_KICKOFF_PREFIX } from '../src/coord/dispatch.js';
import type { DoneClaim } from '../src/coord/fingerprint.js';
import {
  MAIL_BODY_MAX_BYTES, MAIL_REJECT_CODES, RUN_REFUSE_CODES, isPrPhase, isRunRefuseCode,
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

// The ten clauses, verbatim. Kept as a literal array rather than a regex per
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
];

describe('the coordinator skill: its contract', () => {
  it('carries all ten clauses verbatim', () => {
    for (const clause of CONTRACT) {
      expect(skill, `missing contract clause: ${clause.slice(0, 48)}…`).toContain(clause);
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

  it('tells the session how to learn its own id the ONE way that works on this box', () => {
    // ccd/session-hook.sh:15-19 — derived from tmux, never from a `from:`
    // field. Copied because the skill runs where the hook runs.
    expect(skill).toContain("tmux display-message -p '#S'");
    expect(skill).toContain('cc-');
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
    const block = wl.slice(wl.indexOf('One sentence from the protocol goes in every brief anyway'),
      wl.indexOf("The workspace's name is frozen"));
    expect(block.length, 'the branch-discipline block never closes').toBeGreaterThan(0);
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
    const vals = [...hook.matchAll(/\bfresh="([^"]+)"/g)].map((m) => m[1]!);
    if (vals.length < 4) throw new Error('ccd/session-hook.sh assigns fewer than the four ' +
      'freshness words this pin was written against — the card was rewritten, or this harvest is ' +
      'looking at the wrong file');
    return [...new Set(vals.map((v) => v.replace(/^(?:\$behind|\d+) commits? /, '')))];
  })();

  /** Word-BOUNDARY match, never a raw substring — the same hole as the worker
   *  suite's twin harvest (D-1342). `fresh` is a substring of `freshness
   *  unmeasured`, so a `toContain` arm for it passes on the longer word alone
   *  and can never fail; this paragraph carries NO verbatim pin, so that
   *  harvest is its only binding and a vacuous arm leaves it unbound. */
  const wordRe = (w: string): RegExp =>
    new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);

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
    const m = /_hook_emit_context "graphify: ([^"$]+?) —/.exec(hook);
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
    // second id for a live session (ccd:12118-12123, and
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
    // file — a door named in `SKILL.md`, or in any of the other four references,
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
