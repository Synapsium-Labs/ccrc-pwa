// The coordinator skill is prose a model follows unsupervised against a fleet
// it can destroy. These are the properties a review cannot hold in place:
// nine contract clauses, the routes it names, the refusal codes it promises,
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
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderEnvelope, type EnvelopeInput } from '../src/coord/envelope.js';
import { MAIL_REJECT_CODES, RUN_REFUSE_CODES, isRunRefuseCode } from '../../shared/api.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const skillDir = path.join(root, 'ccd/coordinator-skill');
const skill = readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
const refs = (name: string): string =>
  readFileSync(path.join(skillDir, 'references', name), 'utf8');
const allSkillText = [skill, refs('wave-lifecycle.md'), refs('mail-envelope.md')].join('\n');
/** SKILL.md + wave-lifecycle.md ONLY — the route-linkage scan's own corpus,
 *  deliberately excluding `mail-envelope.md`. That file's only route-shaped
 *  text is the worked example's `ack: POST /api/mail/<id>/ack` line, and the
 *  byte-identity test below requires it to be `renderEnvelope`'s REAL output
 *  — a concrete delivery id, never the literal `:id` fastify registers. Left
 *  in `allSkillText` (the ws-reap/ws-rm/ws-gc census still scans it — a
 *  worked example naming a destructive verb would be exactly as licensing as
 *  prose naming one), pulling it OUT of just the route harvest so a real
 *  numeric id never reads as a route this skill "names" and fails the
 *  literal-match check no server route can ever satisfy. */
const routeSkillText = [skill, refs('wave-lifecycle.md')].join('\n');

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

// The nine clauses, verbatim. Kept as a literal array rather than a regex per
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
];

describe('the coordinator skill: its contract', () => {
  it('carries all nine clauses verbatim', () => {
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
    ]);
    const named = skillRoutes();
    for (const r of registeredCoordRoutes()) {
      if (EXEMPT.has(r)) continue;
      expect(named.has(r), `${r} is registered in coord/routes.ts but never named anywhere ` +
        'in SKILL.md or references/wave-lifecycle.md').toBe(true);
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
    // needs to name it as a call outcome.
    const NOT_A_CALL_REFUSAL: ReadonlySet<string> = new Set(['undeliverable']);
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
