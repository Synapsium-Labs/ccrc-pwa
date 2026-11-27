// Docs settings, the pure half (X2 Native Docs parity, spec 2026-11-18 section 4.5 "Tracker links", row 5.4, section 7's
// `PUT /api/docs/settings` row): the tracker rule checker, the one place a rule runs (`resolveItemLink`), the strict
// shape check for a stored row or a PUT body, and the server's one widening decision.
//
// L0: this file imports only other `shared/*.ts` modules, because the PWA bundles it. It names no tracker product
// and no host: Settings starts empty, and a rule is the operator's data.
//
// The server validates rule semantics on PUT and decides whether a write widens. The Settings form does not
// validate rules before submitting; the Docs screen decodes settings reads. `resolveItemLink` RUNS a pattern against a
// document's item value, and nothing may do that on a main thread: in the console only the tracker job
// (`pwa/src/lib/trackerLinkJob.ts`, a later wave), which runs in the parse worker under its own 250 ms budget, may
// import it. The checkers compile a pattern and test it against the EMPTY STRING only, never against a document value.

import { SECRET_MASK, SECRET_MASK_TOO_LARGE } from './api.js';
import { DOCS_REF_MAX_CHARS, isDocsBareRef, isDocsProject, type DocsFailureBody } from './docs.js';

/** One tracker rule. `projects`, when present and not empty, names the projects the rule applies to. */
export interface TrackerRule {
  name: string;
  pattern: string;
  template: string;
  projects?: string[];
}

/** The docs settings row: the tracker rules, and a default branch per project (project name to branch name). */
export interface DocsSettings {
  rules: TrackerRule[];
  defaultBranches: Record<string, string>;
}

/** Settings start empty. Nothing names a tracker in code. */
export const EMPTY_DOCS_SETTINGS: DocsSettings = { rules: [], defaultBranches: {} };

/** A pattern is at most 200 characters (UTF-16 code units, as `String#length` counts them). */
export const TRACKER_PATTERN_MAX_CHARS = 200;
/** At most 20 rules; the first match wins. */
export const TRACKER_RULES_MAX = 20;
/** An item value is at most 100 characters; a longer one is never linked. */
export const TRACKER_ITEM_MAX_CHARS = 100;
/** At most 50 item values per document. */
export const TRACKER_ITEMS_MAX = 50;
/** A rule's name is 1 to 64 characters, with no control characters. */
export const TRACKER_NAME_MAX_CHARS = 64;
/** A template is at most 2048 characters. */
export const TRACKER_TEMPLATE_MAX_CHARS = 2048;
/** A rule names at most 64 projects. */
export const TRACKER_PROJECTS_MAX = 64;
/** The SHAPE bound on a pattern: 1000 characters, so a body with a 201-character pattern still parses and the rule
 *  checker answers `pattern-long`, the reason the console shows. A body past it is refused as malformed. */
export const TRACKER_PATTERN_PARSE_MAX_CHARS = 1000;
/** The SHAPE bound on the rule count: 100, for the same reason (the checker answers `too-many` for 21 to 100). */
export const TRACKER_RULES_PARSE_MAX = 100;
/** At most 500 default branches. */
export const DOCS_DEFAULT_BRANCHES_MAX = 500;

export type TrackerRuleWhy = 'pattern-long' | 'pattern-empty-match' | 'pattern-invalid' | 'template-scheme' | 'template-host';
const TRACKER_RULE_WHY_MAP: Record<TrackerRuleWhy, true> = {
  'pattern-long': true,
  'pattern-empty-match': true,
  'pattern-invalid': true,
  'template-scheme': true,
  'template-host': true,
};
/** Every reason `checkTrackerRule` answers, derived from the map beside its type (a new member is a compile error
 *  until it is listed). */
export const TRACKER_RULE_WHYS: readonly TrackerRuleWhy[] = Object.keys(TRACKER_RULE_WHY_MAP) as TrackerRuleWhy[];
export type TrackerRuleCheck = { ok: true } | { ok: false; why: TrackerRuleWhy };
export type TrackerRulesCheck = { ok: true } | { ok: false; why: TrackerRuleWhy | 'too-many'; index?: number };

/** `{0}` the whole match, `{1}` to `{9}` the captures. `{10}` is not a placeholder. */
const PLACEHOLDER_RE = /\{[0-9]\}/g;
const PLACEHOLDER_ONE_RE = /\{([0-9])\}/g;

// Two different sentinels, alphanumeric so that no URL parser rewrites one (a port sentinel is not a number, so a
// parse that has one in the port throws), and mixed case so a host's lower-casing would show.
const SENTINEL_A = 'ZqXsentinelA7';
const SENTINEL_B = 'KwVsentinelB3Yp';

function countOf(haystack: string, needle: string): number {
  let n = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n += 1;
  return n;
}

function tryParse(text: string): URL | null {
  try { return new URL(text); } catch { return null; }
}

/** The sentinel parse: true only when no placeholder can reach the scheme, userinfo, host or port.
 *  The template is parsed three ways, with every placeholder replaced by sentinel A, by sentinel B, and removed.
 *  Each parse must succeed with scheme `https:`; the userinfo, hostname and port must be the same in all three (a
 *  placeholder that extends the host, joins it, sits in the port or names the userinfo changes one of them, or makes
 *  a parse throw); no sentinel may appear in the userinfo, hostname or port; and every sentinel occurrence the
 *  template holds must be found in the pathname, search or hash, so none was absorbed anywhere else. */
function placeholdersStayOffTheHost(template: string): boolean {
  const placeholders = (template.match(PLACEHOLDER_RE) ?? []).length;
  const bare = tryParse(template.replace(PLACEHOLDER_RE, ''));
  if (bare === null || bare.protocol !== 'https:') return false;
  for (const sentinel of [SENTINEL_A, SENTINEL_B]) {
    const u = tryParse(template.replace(PLACEHOLDER_RE, sentinel));
    if (u === null || u.protocol !== 'https:') return false;
    if (u.hostname !== bare.hostname || u.port !== bare.port) return false;
    if (u.username !== bare.username || u.password !== bare.password) return false;
    const authority = u.username + '\u0000' + u.password + '\u0000' + u.hostname + '\u0000' + u.port;
    if (authority.includes(sentinel)) return false;
    if (countOf(u.pathname + '\u0000' + u.search + '\u0000' + u.hash, sentinel) !== placeholders) return false;
  }
  return true;
}

/** One rule, checked without ever running it against a document value. A pattern is at most 200 characters, compiles
 *  as `^(?:pattern)$` with flag `u` (and alone, so it cannot close the anchoring group itself, as `a)|(b` would),
 *  and does not match the empty string. A template is an absolute `https://` URL whose placeholders sit only in the
 *  path after the host, the query or the fragment. A template with no placeholder is allowed: it links one fixed URL. */
export function checkTrackerRule(r: TrackerRule): TrackerRuleCheck {
  if (typeof r.pattern !== 'string') return { ok: false, why: 'pattern-invalid' };
  if (r.pattern.length > TRACKER_PATTERN_MAX_CHARS) return { ok: false, why: 'pattern-long' };
  let anchored: RegExp;
  try {
    new RegExp(r.pattern, 'u'); // alone: a balanced pattern cannot close the group below early
    anchored = new RegExp('^(?:' + r.pattern + ')$', 'u');
  } catch {
    return { ok: false, why: 'pattern-invalid' };
  }
  if (anchored.test('')) return { ok: false, why: 'pattern-empty-match' };
  if (typeof r.template !== 'string' || !/^https:\/\//i.test(r.template)) return { ok: false, why: 'template-scheme' };
  if (!placeholdersStayOffTheHost(r.template)) return { ok: false, why: 'template-host' };
  return { ok: true };
}

/** The list: more than 20 is `too-many`; otherwise the first failing rule's reason and its index. */
export function checkTrackerRules(rules: readonly TrackerRule[]): TrackerRulesCheck {
  if (rules.length > TRACKER_RULES_MAX) return { ok: false, why: 'too-many' };
  for (let i = 0; i < rules.length; i += 1) {
    const c = checkTrackerRule(rules[i]!);
    if (!c.ok) return { ok: false, why: c.why, index: i };
  }
  return { ok: true };
}

/** The link for one item value, or null. Null for an empty value or one over 100 characters. The first rule, in
 *  order, that applies to `project` (no `projects`, an empty list, or one naming it) and whose anchored pattern
 *  matches the whole value wins; its template is filled once, `{0}` with the whole match and `{n}` with capture n
 *  (an absent capture is the empty string), each through `encodeURIComponent`, so a capture holding `/`, `?` or `#`
 *  stays inside the placeholder's component. A rule that fails `checkTrackerRule` is skipped. Never throws.
 *  Runs a rule's pattern against a document value: only the tracker job may import it (see the header). */
export function resolveItemLink(rules: readonly TrackerRule[], project: string, value: string): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > TRACKER_ITEM_MAX_CHARS) return null;
  for (const r of rules) {
    if (r.projects !== undefined && r.projects.length > 0 && !r.projects.includes(project)) continue;
    if (!checkTrackerRule(r).ok) continue;
    let m: RegExpExecArray | null;
    try { m = new RegExp('^(?:' + r.pattern + ')$', 'u').exec(value); } catch { continue; }
    if (m === null) continue;
    const groups = m;
    try {
      return r.template.replace(PLACEHOLDER_ONE_RE, (_all, d: string) => encodeURIComponent(groups[Number(d)] ?? ''));
    } catch {
      return null; // An ill-formed Unicode capture has no URL representation.
    }
  }
  return null;
}

// ---- the shape check -------------------------------------------------------------------------------------------

export type DocsSettingsParse = { ok: true; settings: DocsSettings } | { ok: false; why: string };

const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;

function isPlainObject(x: unknown): x is Record<string, unknown> {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x) as unknown;
  return proto === Object.prototype || proto === null;
}

/** True when the object's own keys are all in `allowed` and every key in `required` is present. `__proto__` is never
 *  allowed (a JSON body can carry it as an own key). */
function keysAre(o: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean {
  const keys = Object.keys(o);
  for (const k of keys) {
    if (k === '__proto__') return false;
    if (!required.includes(k) && !optional.includes(k)) return false;
  }
  return required.every((k) => Object.hasOwn(o, k));
}

function parseRule(x: unknown): TrackerRule | string {
  if (!isPlainObject(x)) return 'rule-not-object';
  if (!keysAre(x, ['name', 'pattern', 'template'], ['projects'])) return 'rule-keys';
  const { name, pattern, template } = x;
  if (typeof name !== 'string' || name.length < 1 || name.length > TRACKER_NAME_MAX_CHARS || CONTROL_RE.test(name)) return 'rule-name';
  if (typeof pattern !== 'string' || pattern.length > TRACKER_PATTERN_PARSE_MAX_CHARS) return 'rule-pattern';
  if (typeof template !== 'string' || template.length > TRACKER_TEMPLATE_MAX_CHARS) return 'rule-template';
  const out: TrackerRule = { name, pattern, template };
  if (Object.hasOwn(x, 'projects')) {
    const projects = x.projects;
    if (!Array.isArray(projects) || projects.length > TRACKER_PROJECTS_MAX) return 'rule-projects';
    const copy: string[] = [];
    for (const p of projects as unknown[]) {
      if (typeof p !== 'string' || !isDocsProject(p)) return 'rule-projects';
      copy.push(p);
    }
    out.projects = copy;
  }
  return out;
}

/** A strict shape check for a stored row or a PUT body: a plain object with exactly `rules` (an array) and
 *  `defaultBranches` (a plain object); each rule exactly `name`, `pattern`, `template` and optionally `projects`,
 *  strings within the bounds above, project names and branch names valid by `shared/docs.ts`; a `__proto__` key
 *  anywhere refused. It answers fresh plain objects. It runs no pattern: the semantic checks (`checkTrackerRules`)
 *  are separate, so a body with a 201-character pattern or 21 rules parses and the checker names the reason. */
export function parseDocsSettings(x: unknown): DocsSettingsParse {
  if (!isPlainObject(x)) return { ok: false, why: 'not-object' };
  if (!keysAre(x, ['rules', 'defaultBranches'], [])) return { ok: false, why: 'keys' };
  const { rules, defaultBranches } = x;
  if (!Array.isArray(rules) || rules.length > TRACKER_RULES_PARSE_MAX) return { ok: false, why: 'rules' };
  if (!isPlainObject(defaultBranches)) return { ok: false, why: 'default-branches' };
  const outRules: TrackerRule[] = [];
  for (let i = 0; i < rules.length; i += 1) {
    const r = parseRule((rules as unknown[])[i]);
    if (typeof r === 'string') return { ok: false, why: r + ':' + i };
    outRules.push(r);
  }
  const keys = Object.keys(defaultBranches);
  if (keys.length > DOCS_DEFAULT_BRANCHES_MAX) return { ok: false, why: 'default-branches' };
  const outBranches: Record<string, string> = {};
  for (const k of keys) {
    const v = defaultBranches[k];
    if (k === '__proto__' || !isDocsProject(k)) return { ok: false, why: 'default-branch-project' };
    if (typeof v !== 'string' || v.length > DOCS_REF_MAX_CHARS || !isDocsBareRef(v)) return { ok: false, why: 'default-branch-name' };
    outBranches[k] = v;
  }
  return { ok: true, settings: { rules: outRules, defaultBranches: outBranches } };
}

/** The default branch set for `project`, or undefined: an own entry only, so a project named `constructor` is not
 *  answered `Object`'s member. */
export function defaultBranchOf(settings: DocsSettings, project: string): string | undefined {
  return Object.hasOwn(settings.defaultBranches, project) ? settings.defaultBranches[project] : undefined;
}

// ---- the widening decision -------------------------------------------------------------------------------------

function sameProjects(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((p, i) => p === b[i]);
}

function sameRule(a: TrackerRule, b: TrackerRule): boolean {
  return a.name === b.name && a.pattern === b.pattern && a.template === b.template && sameProjects(a.projects, b.projects);
}

/** The ONE decision both the server (the account gate's step-up, refused while sign-in is dark) and the console (the
 *  step-up before it saves) use. A write is NOT widening only when it only removes: `after.rules` is a subsequence of
 *  `before.rules` (same order, each rule equal to a `before` rule, `projects` compared as ordered arrays) and every
 *  `after.defaultBranches` entry exists in `before` with the same value. Everything else is widening: adding a rule,
 *  changing any field of one (its host, pattern, name or projects), reordering (the first match wins, so order
 *  decides where a link leads), and setting or changing a default branch. Removing a rule or unsetting a branch is
 *  not. */
export function settingsWidening(before: DocsSettings, after: DocsSettings): boolean {
  let j = 0;
  for (const rule of before.rules) {
    if (j < after.rules.length && sameRule(rule, after.rules[j]!)) j += 1;
  }
  if (j !== after.rules.length) return true;
  for (const k of Object.keys(after.defaultBranches)) {
    if (!Object.hasOwn(before.defaultBranches, k) || before.defaultBranches[k] !== after.defaultBranches[k]) return true;
  }
  return false;
}

// ---- the stored row ---------------------------------------------------------------------------------------------
//
// The vocabulary of the `docs_settings` row (spec 2026-11-18 section 4.5 "Storage"), declared HERE so neither the
// coordination store (its one writer) nor the docs routes (its reader and caller) import the other: the store answers
// these shapes, the doors take them as two plain functions, and this file's decoder says what a row means.

/** A row as read, no row, or a failed read. An unreadable store is not "no settings". */
export type DocsSettingsStored =
  | { kind: 'row'; body: unknown; updatedAt: unknown }
  | { kind: 'absent' }
  | { kind: 'unreadable'; detail: string };

/** The synchronous writer measures the current row and authorizes widening in its transaction. */
export type DocsSettingsStoreWrite = { kind: 'written' } | { kind: 'denied' } | { kind: 'unreadable' };

/** No coordination store is wired: neither door can measure or change the row. */
export const DOCS_SETTINGS_UNAVAILABLE = {
  read: (): DocsSettingsStored => ({ kind: 'unreadable', detail: 'coordination store unavailable' }),
  write: (): DocsSettingsStoreWrite => ({ kind: 'unreadable' }),
};

export type DocsSettingsDecoded = { ok: true; settings: DocsSettings } | { ok: false; why: 'unreadable' };

/** A missing row is empty; an unreadable read or malformed body is never folded into empty. */
export function docsSettingsFromStored(s: DocsSettingsStored): DocsSettingsDecoded {
  if (s.kind === 'absent') return { ok: true, settings: { rules: [], defaultBranches: {} } };
  if (s.kind === 'unreadable' || typeof s.body !== 'string') return { ok: false, why: 'unreadable' };
  let json: unknown;
  try { json = JSON.parse(s.body); } catch { return { ok: false, why: 'unreadable' }; }
  const parsed = parseDocsSettings(json);
  return parsed.ok ? { ok: true, settings: parsed.settings } : { ok: false, why: 'unreadable' };
}

// ---- the doors' bodies -----------------------------------------------------------------------------------------
//
// What `GET` and `PUT /api/docs/settings` answer. They are built HERE (pure, L0) because the docs L4 file quotes no
// failure word (`docs-ring.test.ts`) and the docs L1 file imports `shared/docs.ts` alone (`docs-policy.test.ts`): the door
// applies what these return and decides nothing.

/** The ok answer of both doors, and the parsed whole-settings PUT body. */
export interface DocsSettingsResponse { ok: true; settings: DocsSettings }
export type DocsSettingsPutParse = { ok: true; settings: DocsSettings } | DocsFailureBody;

/** A `bad-query` body: `why`, and `key` when it names the field. Never echoes a value the caller sent. */
function badSettings(why: string, key?: string): DocsFailureBody {
  return key === undefined ? { ok: false, failure: 'bad-query', why } : { ok: false, failure: 'bad-query', key, why };
}

/** The PUT body has exactly `settings`, checked before a store call; the rule checker names its reason and index. */
export function parseDocsSettingsPut(body: unknown): DocsSettingsPutParse {
  if (!isPlainObject(body)) return badSettings('body');
  for (const k of Object.keys(body)) if (k !== 'settings') return badSettings('unknown');
  if (!Object.hasOwn(body, 'settings')) return badSettings('body', 'settings');
  const parsed = parseDocsSettings(body.settings);
  if (!parsed.ok) return badSettings(parsed.why, 'settings');
  const checked = checkTrackerRules(parsed.settings.rules);
  if (!checked.ok) return badSettings(checked.why, checked.index === undefined ? undefined : `rules.${checked.index}`);
  return { ok: true, settings: parsed.settings };
}

/** Refuse to store settings that would read differently through egress. Also refuse the masker's own notice if
 *  it comes back from a row whose text became recognized after it was stored. Neither reply echoes the text. */
export function docsSettingsMaskRefusal(settings: DocsSettings, changedByMask: boolean): DocsFailureBody | null {
  if (!changedByMask) {
    const text = JSON.stringify(settings);
    if (!text.includes(SECRET_MASK) && !text.includes(SECRET_MASK_TOO_LARGE)) return null;
  }
  return badSettings('settings-masked', 'settings');
}

/** The refusal for a store that cannot be read, or a row that is not settings: the word of an unreadable registry, with
 *  the reason `settings-store`. It never carries the driver's detail (a path), and it is never empty settings. */
export function docsSettingsUnreadableBody(): DocsFailureBody {
  return { ok: false, failure: 'unreadable', reason: 'settings-store' };
}
