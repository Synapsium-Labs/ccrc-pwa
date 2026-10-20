/**
 * D-6048 (Task C0k; ARCH-12 (#552)), held in D-6045's shape (ARCH-04 (#545)): the exported literal unions in
 * `shared/*.ts` that have no runtime list yet, keyed `file:Name`. The set started at the merge-day count (31) minus
 * the three lists ARCH-12 added; it may only shrink. Each entry gives its reason in one line and the day it was
 * written; `exemption-age.data.ts` stamps the set's size, so a set left unchanged for 60 days goes red.
 */
import type { EntrySet } from './exemptions.js';

const since = '2026-10-20';

export const WIRE_TOTALITY_EXEMPTIONS: EntrySet = {
  'agent-protocol.ts:ReadFailure': { reason: 'merge-day debt: the agent read verbs\' failure word, built by the agent and read by the server; no list yet', since },
  'api.ts:IdentityField': { reason: 'merge-day debt: the registry identity triple, carried as `unmeasured`; read back only through `unmeasuredFields`; no list yet', since },
  'api.ts:TaskStatus': { reason: 'merge-day debt: Claude Code\'s own task-list status word, relayed as it reads; no list yet', since },
  'api.ts:PreconditionCell': { reason: 'merge-day debt: one precondition\'s cell in a server-built aggregate; no list yet', since },
  'api.ts:UnnamedSpawnWord': { reason: 'merge-day debt: the snapshot reviver\'s fold word for an unnamed spawn; no list yet', since },
  'api.ts:BuildAgreement': { reason: 'merge-day debt: the build-skew word of the divergence census; no list yet', since },
  'api.ts:SystemOrigin': { reason: 'merge-day debt: which system prompt started a turn, shown as a pill; no list yet', since },
  'api.ts:ProgramKickoffField': { reason: 'merge-day debt: the field a programme kickoff refusal names; no list yet', since },
  'api.ts:CollectArmedBy': { reason: 'merge-day debt: what armed the temp-root collector lane, as the resolver measured it; no list yet', since },
  'api.ts:DigestRowKind': { reason: 'merge-day debt: which table a digest line came from (its sibling `DigestLineKind` is derived from a tuple); no list yet', since },
  'api.ts:AccountOriginClass': { reason: 'merge-day debt: the origin class the accounts gate decides on; no list yet', since },
  'base-url.ts:BaseUrlRefusal': { reason: 'merge-day debt: why an endpoint was refused, one sentence each on the add sheet; no list yet', since },
  'docs.ts:DocsRetryClass': { reason: 'merge-day debt: the docs reader\'s retry class per failure; no list yet', since },
  'docs.ts:DocsFetchFailure': { reason: 'merge-day debt: the docs fetch failure words from ccd; no list yet', since },
  'docs.ts:DocsNotAFileKind': { reason: 'merge-day debt: why a docs path is not a regular file; no list yet', since },
  'docs.ts:DocsVerb': { reason: 'merge-day debt: the four docs verbs\' names on a ccd answer; no list yet', since },
  'docs.ts:DocContentClass': { reason: 'merge-day debt: how a docs leaf renders; no list yet', since },
  'docs.ts:EntryMode': { reason: 'merge-day debt: whether a docs page carries a ref; no list yet', since },
  'docs.ts:EntryBadge': { reason: 'merge-day debt: a docs tree row\'s draft badge; no list yet', since },
  'docs.ts:WithheldReason': { reason: 'merge-day debt: why a docs leaf body is withheld; no list yet', since },
  'docs.ts:DocsPageParseFailure': { reason: 'merge-day debt: why a docs page URL did not parse; no list yet', since },
  'poolrule.ts:PoolOrigin': { reason: 'merge-day debt: which source a pool answer measured; no list yet', since },
  'providers.ts:ConnectMethod': { reason: 'merge-day debt: a provider\'s connect methods, branched on only by the auth helper; no list yet', since },
  'providers.ts:ProbeKind': { reason: 'merge-day debt: what an account check asks of a lane; a hand array (`PROBE_KINDS`) lives in models.mjs, not a derived map', since },
  'roster.ts:RosterKind': { reason: 'merge-day debt: the roster lane kind; no list yet', since },
  'workflows.ts:WorkflowState': { reason: 'merge-day debt: where a workflow row stands; no list yet', since },
  'workflows.ts:WorkflowAgentState': { reason: 'merge-day debt: where a workflow agent stands; no list yet', since },
  'workflows.ts:WorkflowControlAct': { reason: 'merge-day debt: the workflow control acts; the server holds the measured table; no list yet', since },
};
