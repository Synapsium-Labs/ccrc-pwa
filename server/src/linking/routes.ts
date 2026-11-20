// The linking standard's routes (D-8147). L4: they own the reply and decide nothing; `policy.ts` parses the body and
// `coord/linkingStore.ts` is the table. Task 2 registers the operator's write; the session's read and the template
// pull request join it in this file. Task 3 adds the session's read, `GET /api/linking`; Task 5 the template pull request.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { LinkingShowAnswer, TeamCandidateWire, TeamConfirmAnswer, TeamConfirmBody, TeamSuggestionAnswer } from '../../../shared/linking.js';
import { teamEvidenceClause } from '../../../shared/linking.js';
import { LINEAR_TEAM_KEY_SHAPE, isLinearUuid } from '../../../shared/linear.js';
import { LINEAR_SYNC_PROGRAMME } from '../../../shared/plan.js';
import { isWsProject } from '../../../shared/slug.js';
import type { Bus } from '../bus.js';
import type { NoticeSink } from '../notice.js';
import { CALL_OPTIONS_MAX, CALL_OPTION_MAX, CALL_TEXT_MAX, CALL_WHY_MAX, callBodyOf } from '../coord/coordCalls.js';
import { announceBigCall } from '../coord/coordCallsRoute.js';
import type { overlordGateRun } from '../coord/overlordGateRun.js';
import type { AttributionRead } from '../coord/openRun.js';
import type { CoordStore } from '../coord/store.js';
import { MAIL_TOKEN_HEADER, checkMailToken, type BoxTokenHolder } from '../coord/token.js';
import { refuseRoute } from '../refuse.js';
import { measuredProjectOf, type SingleRead } from '../registry.js';
import { CCD_ARGV, ccdCan } from '../ccdargv.js';
import type { CcdArgv } from '../ccdargv.js';
import type { CcdResult } from '../lifecycle.js';
import type { FleetState } from '../fleetstate.js';
import { withoutCcdRefusal } from '../../../shared/ccd-refusal.js';
import { autoLinkAllowed } from './teamLink.js';
import { parseLinkingWrite, parseTeamSuggestion, suggestionReasonVerdict, workspaceAfterWrite } from './policy.js';
import { routableSlots, routableTeams, routeProjectTeam } from '../linear/route.js';
import type { LinearStoreRead } from '../linear/store.js';

export interface LinkingRouteOpts {
  /** The coordination store, or undefined on a server without one (a test, a script): the write answers `unavailable`. */
  coord: CoordStore | undefined;
  /** Who is writing: the device the request's session names (`server.ts`'s `pwaDec`). */
  by: (req: FastifyRequest) => string;
  now?: () => number;
  /** The box token, read at request time as every lane reads it; null is a server never given one (refuses every call). */
  mailToken?: () => string | BoxTokenHolder | null;
  /** The box-token lanes' sender check (`attributionVerdict` over the registry). Absent: the session read answers `unavailable`. */
  attribute?: (id: string, uuid: string) => Promise<AttributionRead>;
  /** The caller's registry record (`readSessionRecord`), the project it names being the one the read answers for. */
  readRecord?: (id: string) => Promise<SingleRead>;
  /** The ccd runner, and the fleet's verb list it is asked against: the template pull request's act. Absent: `unavailable`. */
  runCcd?: (argv: CcdArgv) => Promise<CcdResult>;
  fleetState?: () => Pick<FleetState, 'ccdVerbs'> | undefined;
  /** The Linear slot store (D-8808): which workspace holds a team key. Absent: read as unreadable, so a write naming a workspace
   *  answers `unavailable`. */
  readLinearStore?: () => Promise<LinearStoreRead>;
  /** The installer's private tracker keys (`CCRC_PRIVATE_TRACKER_KEYS`), which a suggestion's reason may not name. */
  privateTrackerKeys?: readonly string[];
  /** D-8809: the Overlord gate's runner (`overlordGateRun`, built once in `server.ts`). Absent: the confirm refuses `unavailable`. */
  gate?: ReturnType<typeof overlordGateRun>;
  /** D-8809: the big call's feed notice and the Waiting-on-you rebuild (`announceBigCall`). Absent: neither is raised. */
  notice?: NoticeSink;
  bus?: Bus;
  /** The server's build stamp the call records, as the call record's route records it; null where the build carries none. */
  build?: string | null;
}

/** The identity pair's grammar: the client's SAFE_RE, bounded as the Linear proxy bounds it. */
const IDENTITY_RE = /^[A-Za-z0-9_-]{1,128}$/;

const TOKEN_DETAIL = {
  legacy: `no box token presented: this lane takes the box token (${MAIL_TOKEN_HEADER}) and nothing else`,
  bad: 'wrong box token',
  unconfigured: 'no box token is configured on this server: this lane fails shut, it does not fail open',
} as const;

const CONFIRM_KEYS = ['byId', 'byUuid', 'project', 'team', 'workspace'];

/** D-8809: the confirm's body, closed: `byId`, `byUuid`, `project` (`isWsProject`), `team` (the Linear key shape, uppercased)
 *  and `workspace` (a slot id, `isLinearUuid`, or null for a candidate stored without one; required). A refusal names the field
 *  (`body` for the shape as a whole). Beside `parseTeamSuggestion`'s rules; it moves into `policy.ts` when that file is claimed. */
function confirmBodyOf(body: unknown): { ok: true; value: TeamConfirmBody } | { ok: false; field: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, field: 'body' };
  const o = body as Record<string, unknown>;
  if (Object.keys(o).some((k) => !CONFIRM_KEYS.includes(k))) return { ok: false, field: 'body' };
  const { byId, byUuid, project, team, workspace } = o;
  if (typeof byId !== 'string' || !IDENTITY_RE.test(byId)) return { ok: false, field: 'byId' };
  if (typeof byUuid !== 'string' || !IDENTITY_RE.test(byUuid)) return { ok: false, field: 'byUuid' };
  if (typeof project !== 'string' || !isWsProject(project)) return { ok: false, field: 'project' };
  if (typeof team !== 'string' || !LINEAR_TEAM_KEY_SHAPE.test(team.toUpperCase())) return { ok: false, field: 'team' };
  if (workspace !== null && !isLinearUuid(workspace)) return { ok: false, field: 'workspace' };
  return { ok: true, value: { byId, byUuid, project, team: team.toUpperCase(), workspace: workspace as string | null } };
}

/** One line of at most `max` characters: whitespace runs folded, a longer text cut with an ellipsis. */
const line = (text: string, max: number): string => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
};
/** A candidate as the call names it: the team's NAME and its workspace's display NAME, never a key. */
const teamPhrase = (c: TeamCandidateWire): string => line(c.workspaceId === undefined ? c.name
  : `${c.name} in ${c.workspaceName ?? 'a workspace whose name is unknown'}`, CALL_OPTION_MAX);

/** D-8809: the call body of the Overlord's link, in the call record's own shape (`callBodyOf` reads it as the call route reads a
 *  coordinator's): a big, reversible call naming the project, the team and workspace by name, and the candidate's evidence. The
 *  options are the project's current candidates (each once, the chosen one kept) and leaving it unlinked. */
function linkCallBody(project: string, chosen: TeamCandidateWire, candidates: readonly TeamCandidateWire[]): Record<string, unknown> {
  const pick = teamPhrase(chosen);
  const others = [...new Set(candidates.map(teamPhrase))].filter((p) => p !== pick).slice(0, CALL_OPTIONS_MAX - 2);
  return {
    class: 'big', reversible: true,
    question: line(`Which Linear team does ${project} link to?`, CALL_TEXT_MAX),
    options: [pick, ...others, line(`Leave ${project} unlinked`, CALL_OPTION_MAX)], chosen: pick,
    why: line(`The Overlord linked it on its evidence: ${teamEvidenceClause(chosen.evidence)}.`, CALL_WHY_MAX),
  };
}

export function registerLinkingRoutes(app: FastifyInstance, opts: LinkingRouteOpts): void {
  const now = opts.now ?? Date.now;
  // A server built without the Overlord gate (a test, a script) refuses the confirm: it never links ungated.
  const gate: ReturnType<typeof overlordGateRun> = opts.gate ?? (async (_req, reply) => {
    void refuseRoute(reply, 'unavailable', { detail: 'this server has no Overlord gate' });
    return { kind: 'refused' };
  });

  /**
   * `POST /api/projects/:project/linking`: the operator sets a project's Linear team key and visibility override. NOT in
   * `auth/gate.ts`'s EXEMPT table: session-gated when armed, open dark, no box token (the pool route's stance). The project
   * name goes into a bound SQL parameter only and is not refused for a name the walk has not listed yet: an operator may
   * set a project's key before its first walk. The 200 is MEASURED, not echoed: the row is read back after the write.
   */
  app.post('/api/projects/:project/linking', async (req, reply) => {
    const { project } = req.params as { project: string };
    const parsed = parseLinkingWrite(req.body);
    if (!parsed.ok) return refuseRoute(reply, parsed.error);
    const coord = opts.coord;
    if (coord === undefined) return refuseRoute(reply, 'unavailable');
    try {
      // `private` on a repository ccrc last read as public is refused: it would turn the id-writing acts on there.
      // A stored `private` is not re-refused (saving the key re-sends it); `linkingMode` already reads such a row as public.
      const before = coord.linkingOf(project);
      const m = before.measured;
      if (parsed.write.override === 'private' && before.override !== 'private' && m.state === 'measured' && m.visibility === 'public') {
        return refuseRoute(reply, 'override-private-public');
      }
      // D-8808: the workspace stored beside the key, decided once (`workspaceAfterWrite`). The store is read only when the answer
      // can need it: a named workspace, or a stored one that a changed key must be checked against.
      const w = parsed.write;
      const needsStore = typeof w.workspace === 'string' || (w.workspace === undefined && before.teamWorkspace != null && w.teamKey !== before.teamKey);
      let store: LinearStoreRead | null = null;
      if (needsStore && opts.readLinearStore !== undefined) {
        try { store = await opts.readLinearStore(); } catch { store = null; }
      }
      const slots = store !== null && store.kind === 'listed' ? routableSlots(store) : null;
      const decided = workspaceAfterWrite({
        before: { teamKey: before.teamKey, workspace: before.teamWorkspace ?? null }, written: w,
        holds: (workspace, teamKey) => (slots === null ? 'unmeasured' : routeProjectTeam(slots, { teamKey, workspaceId: workspace }).kind === 'slot'),
      });
      if (!decided.ok) return refuseRoute(reply, decided.error);
      coord.setLinking(project, { ...w, workspace: decided.workspace }, opts.by(req), now());
      return { ok: true, linking: coord.linkingOf(project) };
    } catch (err) {
      return refuseRoute(reply, 'write-failed', { detail: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * `GET /api/linking?byId=&byUuid=`: a session reads its own project's linking row (the team key, the override, the
   * measured visibility and the mode that follows), through `ccrc-api linking show`. A box-token machine lane, an
   * `auth/gate.ts` EXEMPT entry: the token first (never the cookie, whatever the sign-in flag), then the identity pair's
   * shape, then the registry's attribution, then the caller's own record for its project, then the row. The project is
   * the RECORD's, never a query key: a session cannot read another project's row through this lane. A record naming no
   * project is `no-project` (404); an unreadable one is the registry's `registry-unmeasurable`, as the other lanes say.
   */
  app.get('/api/linking', {
    config: { rateLimit: { max: 1200, timeWindow: '1 minute' } },
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
      const verdict = checkMailToken(opts.mailToken?.() ?? null, req.headers[MAIL_TOKEN_HEADER], 'GET /api/linking');
      if (verdict !== 'ok') return refuseRoute(reply, 'unauthenticated', { detail: TOKEN_DETAIL[verdict] });
      return undefined;
    },
  }, async (req, reply) => {
    const q = (typeof req.query === 'object' && req.query !== null ? req.query : {}) as Record<string, unknown>;
    const id = q['byId'];
    if (typeof id !== 'string' || !IDENTITY_RE.test(id)) return refuseRoute(reply, 'bad-request', { detail: 'byId' });
    const uuid = q['byUuid'];
    if (typeof uuid !== 'string' || !IDENTITY_RE.test(uuid)) return refuseRoute(reply, 'bad-request', { detail: 'byUuid' });
    const coord = opts.coord;
    if (coord === undefined || opts.attribute === undefined || opts.readRecord === undefined) return refuseRoute(reply, 'unavailable');
    const attributed = await opts.attribute(id, uuid);
    if (!attributed.ok) return refuseRoute(reply, attributed.error, { detail: attributed.detail });
    const read = await opts.readRecord(id);
    if (read.kind === 'unlistable' || read.kind === 'unmeasurable') {
      return refuseRoute(reply, 'registry-unmeasurable', { detail: 'the caller\'s registry record could not be read: transient' });
    }
    const project = measuredProjectOf(read);
    if (project === null) return refuseRoute(reply, 'no-project', { detail: 'the registry record names no project' });
    const row = coord.linkingOf(project);
    const answer: LinkingShowAnswer = { ok: true, project, ...row };
    return answer;
  });

  /**
   * `POST /api/linking/suggest` (D-8808): a session suggests a Linear team (and optionally its workspace) for a project with no
   * key, with a reason. A candidate only: it never links, and the reason is shown in the console and never written to Linear.
   * A box-token machine lane (an `auth/gate.ts` EXEMPT entry): the token first (never the cookie), then the body's shape, then the
   * registry's attribution, then the store, then the row (`team-set` when it has a key), then the pair (a Linear store that
   * cannot be read is `unavailable`, never `team-unknown`), then the reason as PUBLIC text (the console may be mirrored), then
   * the write, which itself refuses a row that got a key in the meantime. The 200 is the caller's own stored suggestion only,
   * never the project's row (`GET /api/linking` lets a session read only its own project's).
   */
  app.post('/api/linking/suggest', {
    config: { rateLimit: { max: 1200, timeWindow: '1 minute' } },
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
      const verdict = checkMailToken(opts.mailToken?.() ?? null, req.headers[MAIL_TOKEN_HEADER], 'POST /api/linking/suggest');
      if (verdict !== 'ok') return refuseRoute(reply, 'unauthenticated', { detail: TOKEN_DETAIL[verdict] });
      return undefined;
    },
  }, async (req, reply) => {
    const parsed = parseTeamSuggestion(req.body);
    if (!parsed.ok) return refuseRoute(reply, 'bad-request', { detail: parsed.field });
    const s = parsed.value;
    const coord = opts.coord;
    if (coord === undefined || opts.attribute === undefined) return refuseRoute(reply, 'unavailable');
    const attributed = await opts.attribute(s.byId, s.byUuid);
    if (!attributed.ok) return refuseRoute(reply, attributed.error, { detail: attributed.detail });
    if (coord.linkingOf(s.project).teamKey !== null) return refuseRoute(reply, 'team-set');
    let store: LinearStoreRead | null = null;
    if (opts.readLinearStore !== undefined) {
      try { store = await opts.readLinearStore(); } catch { store = null; }
    }
    if (store === null || store.kind !== 'listed') return refuseRoute(reply, 'unavailable');
    const matches = routableTeams(store).filter((t) => t.key === s.team && (s.workspace === undefined || t.workspaceId === s.workspace));
    // The team's name comes from the first workspace holding the key: a key two workspaces share names the same team in
    // each, and a suggestion that names no workspace records none, so the first is as good as any and never a guess at a link.
    const first = matches[0];
    if (first === undefined) return refuseRoute(reply, 'team-unknown');
    const text = suggestionReasonVerdict(s.why, routableTeams(store).map((t) => t.key), opts.privateTrackerKeys ?? []);
    if (!text.ok) return refuseRoute(reply, text.word, { detail: text.class });
    try {
      const stored = {
        key: s.team, workspaceId: s.workspace === undefined ? null : first.workspaceId,
        workspaceName: s.workspace === undefined ? null : first.workspaceName, teamName: first.name, why: s.why, at: now(),
      };
      const wrote = coord.recordTeamSuggestion(s.project, { by: s.byId, ...stored });
      if (wrote === 'no-project') return refuseRoute(reply, 'no-project');
      if (wrote === 'team-set') return refuseRoute(reply, 'team-set');
      const answer: TeamSuggestionAnswer = { ok: true, project: s.project, suggestion: stored };
      return answer;
    } catch (err) {
      return refuseRoute(reply, 'write-failed', { detail: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * `POST /api/linking/confirm` (D-8809): the Overlord confirms one of a project's CURRENT team candidates (the pass's or a
   * coordinator's suggestion, matched by key and workspace), which links that team as a call made in the operator's name. A
   * box-token machine lane (an `auth/gate.ts` EXEMPT entry) and an Overlord door (`overlordDoors.ts`'s `link-team` row): the
   * token first (never the cookie), then the body's shape, then THE GATE (every step of the order: the Overlord alone, at the
   * `full` rung; below it `rung-below`, any other session `not-the-overlord`), then the store, the row (`no-project`, 404), the
   * pass's own rule (`autoLinkAllowed`: a key stored or the operator's decision is `team-set`), the pair (`team-unknown`), then
   * the call and the link in ONE transaction (`linkTeamOverlord`), whose rule refuses a row that changed meanwhile (`team-set`).
   * The big call is announced as the call record's route announces one (`announceBigCall`). The operator overturns it with their
   * own write, which makes the key `manual`. The 200 is the link and the call's id only, never the project's row.
   */
  app.post('/api/linking/confirm', {
    config: { rateLimit: { max: 1200, timeWindow: '1 minute' } },
    onRequest: async (req: FastifyRequest, reply: FastifyReply) => {
      const verdict = checkMailToken(opts.mailToken?.() ?? null, req.headers[MAIL_TOKEN_HEADER], 'POST /api/linking/confirm');
      if (verdict !== 'ok') return refuseRoute(reply, 'unauthenticated', { detail: TOKEN_DETAIL[verdict] });
      return undefined;
    },
  }, async (req, reply) => {
    const parsed = confirmBodyOf(req.body);
    if (!parsed.ok) return refuseRoute(reply, 'bad-request', { detail: parsed.field });
    const c = parsed.value;
    const g = await gate(req, reply, 'link-team', { sessionId: c.byId, uuid: c.byUuid, uuidField: 'byUuid' });
    if (g.kind === 'refused') return reply;
    // `others: 'refuse'` on the row: the gate never serves this door in the hook's group.
    if (g.kind !== 'pass') return refuseRoute(reply, 'unavailable', { detail: 'the gate did not pass the call' });
    const store = opts.coord;
    if (store === undefined) return refuseRoute(reply, 'unavailable');
    try {
      if (!store.linkingAll().has(c.project)) return refuseRoute(reply, 'no-project');
      const row = store.linkingOf(c.project);
      if (!autoLinkAllowed(row.teamKey, row.teamLink?.source ?? null)) return refuseRoute(reply, 'team-set', { detail: 'the project has a key, or the operator decided it' });
      const candidates = row.teamCandidates ?? [];
      const chosen = candidates.find((x) => x.key === c.team && (x.workspaceId ?? null) === c.workspace);
      if (chosen === undefined) return refuseRoute(reply, 'team-unknown', { detail: 'the pair is not one of the project\'s current candidates' });
      const at = now();
      const call = callBodyOf(linkCallBody(c.project, chosen, candidates), at);
      if (!call.ok) return refuseRoute(reply, 'write-failed', { detail: call.detail });
      const workspaceId = chosen.workspaceId ?? null;
      const callId = store.linkTeamOverlord(c.project, { key: chosen.key, name: chosen.name, evidence: chosen.evidence, workspace: workspaceId },
        { program: LINEAR_SYNC_PROGRAMME, madeBy: c.byId, call: call.call, build: opts.build ?? null }, at);
      if (callId === null) return refuseRoute(reply, 'team-set', { detail: 'the project got a key, or the operator decided it, meanwhile' });
      if (opts.notice !== undefined && opts.bus !== undefined) announceBigCall({ notice: opts.notice, bus: opts.bus }, LINEAR_SYNC_PROGRAMME, callId, call.call);
      const answer: TeamConfirmAnswer = {
        ok: true, project: c.project, callId,
        link: { key: chosen.key, teamName: chosen.name, workspaceId, workspaceName: workspaceId === null ? null : (chosen.workspaceName ?? null), evidence: chosen.evidence },
      };
      return answer;
    } catch (err) {
      return refuseRoute(reply, 'write-failed', { detail: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * `POST /api/projects/:project/pr-template` (no body): the operator's tap that opens a pull request adding the pull
   * request template to a PRIVATE project. NOT in `auth/gate.ts`'s EXEMPT table: session-gated when armed, open dark, no
   * box token. The route decides nothing but the order of its refusals (all from the stored row, before any ccd call):
   * no key stored, the mode public (an unmeasured project is read by ccd itself at the act). The act is `ccd pr-template`; ccd re-reads the
   * visibility itself and refuses a public repository and a template already on the default branch in its own words.
   * On success the stored reading's template cell is written `present` (a project never measured has no cell to update).
   */
  app.post('/api/projects/:project/pr-template', async (req, reply) => {
    const { project } = req.params as { project: string };
    const coord = opts.coord;
    if (coord === undefined || opts.runCcd === undefined) return refuseRoute(reply, 'unavailable');
    const row = coord.linkingOf(project);
    if (row.teamKey === null) return refuseRoute(reply, 'no-team-key');
    const mode = row.mode;
    // An unmeasured project (a fresh add: the visibility lane has not reached it) goes on to ccd, which reads the
    // visibility itself and refuses anything but a private or internal repository: fail-closed at the act.
    if (mode === 'public') return refuseRoute(reply, 'repo-public');
    if (!ccdCan(opts.fleetState?.(), 'prTemplate')) return refuseRoute(reply, 'unsupported');
    let argv: CcdArgv;
    try { argv = CCD_ARGV.prTemplate(project, row.teamKey); } catch { return refuseRoute(reply, 'bad-team-key'); }
    const res = await opts.runCcd(argv);
    // A call that never ran has no ccd refusal to read, only the runner's own words (D-6840).
    if (res.ran === false) return refuseRoute(reply, 'template-failed', { stderr: withoutCcdRefusal(res.stderr) });
    if (!res.ok) {
      const reason = ccdReason(res.stdout);
      if (reason === 'repo-public' || reason === 'template-exists') return refuseRoute(reply, reason);
      return refuseRoute(reply, 'template-failed', { stderr: withoutCcdRefusal(res.stderr) });
    }
    const url = openPrUrl(res.stdout);
    if (url === null) return refuseRoute(reply, 'template-failed', { stderr: 'ccd answered no open pull request' });
    const m = row.measured;
    if (m.state === 'measured') coord.recordLinkingReading(project, { ...m, template: 'present', at: now() });
    return { ok: true, url };
  });
}

/** The `{"reason":...}` ccd prints on a refusal, or null. */
function ccdReason(stdout: string): string | null {
  try {
    const v = JSON.parse(stdout.split('\n')[0] ?? '') as { reason?: unknown };
    return typeof v.reason === 'string' ? v.reason : null;
  } catch { return null; }
}

/** The first open pull request's https URL in the rows ccd printed, or null. */
function openPrUrl(stdout: string): string | null {
  try {
    const rows = JSON.parse(stdout.split('\n')[0] ?? '') as unknown;
    if (!Array.isArray(rows)) return null;
    for (const r of rows as Array<Record<string, unknown>>) {
      if (r['state'] === 'OPEN' && typeof r['url'] === 'string' && /^https:\/\/github\.com\/[^\s]+$/.test(r['url'])) return r['url'];
    }
  } catch { /* falls to null */ }
  return null;
}
