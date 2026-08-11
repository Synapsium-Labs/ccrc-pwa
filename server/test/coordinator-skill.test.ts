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
import { MAIL_REJECT_CODES, isRunRefuseCode } from '../../shared/api.js';

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
  it('names no route the server does not register', () => {
    // fastify spells params `:id` and so does the skill, so the match is
    // character for character — the same trick that makes wsaudit's harvest a
    // two-line assertion instead of an allowlist.
    const routes = new Set<string>();
    for (const m of routeSkillText.matchAll(/\b(?:GET|POST) (\/api\/[A-Za-z0-9/:._-]+)/g)) {
      routes.add(m[1]!.replace(/[.,)]+$/, ''));
    }
    expect(routes.size, 'the skill should name the routes it calls').toBeGreaterThanOrEqual(6);
    const src = serverSources();
    for (const r of routes) expect(src, `no server route registers ${r}`).toContain(`'${r}'`);
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

  it('quotes an envelope byte-identical to what the delivery lane injects', () => {
    const fixture: EnvelopeInput = {
      id: 7, fromId: 'ccrc-pwa-clear-cove', toId: 'coordinator',
      runId: 3, program: 'build4-transcript-surface', wave: 3, waveOf: null,
      kind: 'status', subject: 'wave-done',
      body: 'Wave 3 is on the branch. Handoff commit is the ledger update; PR #591 is green.',
      artifacts: ['docs/superpowers/programs/build4-transcript-surface.md'],
    };
    const rendered = renderEnvelope(fixture);
    expect(refs('mail-envelope.md'),
      'the worked example must be exactly what renderEnvelope produces').toContain(rendered);
  });

  it('ships the ledger template byte-identical to the repo’s', () => {
    // D-7: the skill runs against projects that have no docs/superpowers, so it
    // must carry the template. Two copies exist; this is the mechanism that
    // stops them being two different templates.
    expect(refs('ledger-template.md')).toBe(
      readFileSync(path.join(root, 'docs/superpowers/programs/TEMPLATE.md'), 'utf8'));
  });
});
