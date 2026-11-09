// Adding a project from the console (add-project spec 2026-11-04 §4 PWA): what `AddProjectSheet` decides, and every
// sentence it says. L1: pure, no I/O. The name and repository rules are `shared/projectAdd.ts`'s, the ones the server's
// `planProjectAdd` parses with, so a form this file sends is a form the route reads the same way. The form's own verdict
// is `formVerdict`, a name of its own: the server's decider owns `planProjectAdd`.
//
// THE REFUSALS ARE A TABLE (`PROJECT_ADD_REFUSAL_TEXT`, read through `refusalText`), never a branch per word, so
// `refusal-literal-ratchet` does not grow. `outcome-unknown` is read first, at any status, and so is a 504 (a proxy's
// gateway timeout is the same unknown): the box may have added the project. After it, only two answers are read by
// STATUS: a 502, which is git's failure and is said from its stderr whatever word rides beside it, and a 404, a server
// older than the route.
import { ApiError } from '../lib/apiError';
import { refusalText } from '../lib/refusalWords';
import { isRecord } from '../lib/wire';
import {
  deriveProjectName, isNewProjectName, parseGithubRepo, PROJECT_NAME_MAX, type GithubRepo, type ProjectAddBody,
  type ProjectAddSource,
} from '../../../shared/projectAdd';
import type { ProjectAddRefusal, RouteRefusal } from '../../../shared/refusal';
import { BAD_REQUEST_TEXT } from './workspaceAddWords';

/** The sheet's labels. Short words only: a sentence lives in one of the tables below, once. */
export const PROJECT_ADD_TEXT = {
  /** The doors: the fleet screen's projects head, the first-run panel, the new-session sheet's row, the palette. */
  open: 'New project',
  /** The fleet screen's head over its project list, which carries the door. */
  projectsHead: 'Projects',
  /** The form's confirm. */
  add: 'Add project',
  /** The sheet's title. */
  title: 'Add a project',
  eyebrow: 'new project',
  /** The new-session sheet's way back from its inline form to its project list. */
  back: 'Back to projects',
  /** The success toast's action: a session in the project just added. */
  startSession: 'Start session',
  source: 'Start from',
  github: 'From GitHub',
  empty: 'Empty',
  repo: 'Repository',
  repoPlaceholder: 'owner/repo or a github.com link',
  name: 'Name',
  cloning: 'Cloning…',
  creating: 'Creating…',
  /** Under the fields while a clone runs: it can take minutes, and closing the sheet leaves it running (its answer is
   *  then a toast). */
  cloningNote: 'Cloning on the fleet box can take a few minutes. Closing this sheet leaves it running.',
  cancel: 'Cancel',
} as const;

/** The calm hint under a field the form will not send, shown only after a blur or a submit. */
export const PROJECT_ADD_HINT = {
  repo: "That isn't a GitHub repository. Use owner/repo or a github.com link.",
  name: `A name starts with a letter or digit, then letters, digits, dots, dashes or underscores, at most ${PROJECT_NAME_MAX}, and doesn't end in .git.`,
  /** A blank name the repository cannot fill (an empty project, or a repository like `.github` whose own name is not
   *  one a project may take): a request, not a fault. */
  nameNeeded: 'Give the project a name.',
} as const;

/** What the sheet holds. */
export interface ProjectAddForm { source: ProjectAddSource; repo: string; name: string }

/** The form's verdict: a body to send with the name it names, or the hint for each field that holds it back (`null`
 *  for a field that is fine). */
export type ProjectAddFormVerdict =
  | { kind: 'send'; name: string; body: ProjectAddBody }
  | { kind: 'hold'; repo: string | null; name: string | null };

/** The name a typed repository suggests, `''` while it suggests none (it does not parse yet, or its name is not one a
 *  new project may take). */
export function prefillName(repo: string): string {
  const parsed = parseGithubRepo(repo);
  return (parsed === null ? null : deriveProjectName(parsed)) ?? '';
}

/** A clone whose name is left blank takes the repository's own, as the route would; a blank name nothing fills is asked
 *  for (`nameNeeded`), and only a typed name that is not one is the rule's hint. */
export function formVerdict(form: ProjectAddForm): ProjectAddFormVerdict {
  const repo = form.repo.trim();
  const parsed = form.source === 'github' ? parseGithubRepo(repo) : null;
  const typed = form.name.trim();
  const name = typed === '' && parsed !== null ? deriveProjectName(parsed) ?? '' : typed;
  const repoHint = form.source === 'github' && parsed === null ? PROJECT_ADD_HINT.repo : null;
  const nameHint = isNewProjectName(name) ? null : name === '' ? PROJECT_ADD_HINT.nameNeeded : PROJECT_ADD_HINT.name;
  if (repoHint !== null || nameHint !== null) return { kind: 'hold', repo: repoHint, name: nameHint };
  return { kind: 'send', name, body: form.source === 'github' ? { source: 'github', repo, name } : { source: 'empty', name } };
}

/** The route's refusal words, each in its own sentence: its own (`PROJECT_ADD_REFUSALS`, `shared/refusal.ts`), and the
 *  ones it reuses. A `Record`, so a word the vocabulary gains without a sentence is a compile error. Each is true
 *  whether or not the sheet is still open, so a refusal that lands after a dismissal is the same sentence as a toast. */
export const PROJECT_ADD_REFUSAL_TEXT: Readonly<Record<
  ProjectAddRefusal | Extract<RouteRefusal, 'bad-request' | 'bad-project' | 'unsupported' | 'outcome-unknown'>, string
>> = {
  'bad-request': BAD_REQUEST_TEXT,
  'bad-source': "The server didn't accept that repository, so nothing was added. Use owner/repo or a github.com link.",
  'bad-project': "The server didn't accept that name for a project, so nothing was added.",
  'project-exists': 'A project with that name is already on the fleet box, so nothing was added.',
  'unsupported': "The fleet box's ccd is too old to add a project. Update the fleet box.",
  'outcome-unknown': "The fleet box didn't answer in time, so the project may or may not have been added — check the project list.",
};

/** A failed clone or init, from ccd's `die` line (the 502's stderr): the reasons an operator acts on, or its one line.
 *  `not-found` and `no-access` are GitHub's answers, so only a clone is read for them. */
export type CloneFailure =
  | { kind: 'not-found' }
  | { kind: 'no-access' }
  | { kind: 'timed-out' }
  | { kind: 'other'; line: string }
  | { kind: 'silent' };

const CLONE_LINE_MAX = 160;
/** `cmd_project_add`'s die line around git's own words, and its stand-in for none (`ccd/ccd#cmd_project_add`). */
const CCD_GIT_PREFIX = /^ccd: git (?:clone|init) failed for [A-Za-z0-9._-]+: /;
const CCD_GIT_SILENT = /^git gave no message$/;
/** ccd's own bound on git (a clone or an init), below the exec's: it stopped git and removed its temp. */
const CCD_CLONE_TIMEOUT = /\bgit (?:clone|init) timed out for [A-Za-z0-9._-]+ after \d+s\b/;

export function cloneFailureOf(stderr: unknown, source: ProjectAddSource): CloneFailure {
  const lines = (typeof stderr === 'string' ? stderr : '').split('\n')
    .map((l) => l.replace(/[^\x20-\x7e]+/g, ' ').replace(/\s+/g, ' ').trim().replace(CCD_GIT_PREFIX, ''))
    .filter((l) => l !== '' && !CCD_GIT_SILENT.test(l));
  if (lines.length === 0) return { kind: 'silent' };
  const all = lines.join(' ');
  if (CCD_CLONE_TIMEOUT.test(all)) return { kind: 'timed-out' };
  if (source === 'github') {
    if (/\brepository\b.*\bnot found\b/i.test(all)) return { kind: 'not-found' };
    if (/could not read from remote|could not read username|permission denied|authentication failed/i.test(all)) return { kind: 'no-access' };
  }
  const line = lines.find((l) => /^fatal:/i.test(l)) ?? lines[0]!;
  return { kind: 'other', line: line.replace(/^fatal:\s*/i, '').slice(0, CLONE_LINE_MAX) };
}

function cloneFailureText(f: CloneFailure, source: ProjectAddSource): string {
  switch (f.kind) {
    case 'not-found': return "GitHub has no such repository, or it is private and the fleet box can't see it. Nothing was added.";
    case 'no-access': return "The fleet box couldn't read the repository from GitHub. A private repository needs the fleet box's git credentials. Nothing was added.";
    case 'timed-out': return source === 'github'
      ? 'The clone took too long, so the fleet box stopped it and nothing was added. A very large repository needs cloning on the fleet box by hand.'
      : 'Creating the project folder took too long, so the fleet box stopped it and nothing was added.';
    case 'other': return source === 'github' ? `The fleet box couldn't add the project: ${f.line}` : `The fleet box couldn't create the project folder: ${f.line}`;
    case 'silent': return source === 'github'
      ? "The fleet box couldn't add the project, and gave no reason."
      : "The fleet box couldn't create the project folder, and gave no reason.";
  }
}

/** Whether the project may stand on the box after this failure: no answer reached this device, or the server could not
 *  wait for ccd's. The sheet says so, and the plane re-reads the project list (`useProjectRows.addProject`). */
export function projectAddOutcomeUnknown(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true;
  return err.status === 504 || refusalText(err, PROJECT_ADD_REFUSAL_TEXT) === PROJECT_ADD_REFUSAL_TEXT['outcome-unknown'];
}

/** One sentence for whatever `api.projectAdd` threw, for the source the form sent. */
export function projectAddRefusalText(err: unknown, source: ProjectAddSource): string {
  if (!(err instanceof ApiError)) {
    return "Couldn't reach the server, so the project may not have been added. Check the project list before trying again.";
  }
  if (projectAddOutcomeUnknown(err)) return PROJECT_ADD_REFUSAL_TEXT['outcome-unknown'];
  if (err.status === 502) return cloneFailureText(cloneFailureOf(isRecord(err.body) ? err.body.stderr : undefined, source), source);
  const known = refusalText(err, PROJECT_ADD_REFUSAL_TEXT);
  if (known !== null) return known;
  if (err.status === 404) return "This server can't add a project yet. Update the server.";
  return `The project wasn't added (the server answered ${err.status}).`;
}

/** The success toast. An empty project can take a session in its main checkout at once, but no workspace until it has
 *  a GitHub `origin` (ccd's `ws-add` needs `origin/HEAD`), so its toast says both. Where to start that session is the
 *  toast's own action (`PROJECT_ADD_TEXT.startSession`), or the new-session sheet the project was added from. */
export function projectAddedText(name: string, source: ProjectAddSource): string {
  return source === 'empty'
    ? `Added project ${name}. It can take a session now, and workspaces once it has a GitHub remote.`
    : `Added project ${name}`;
}

/** What the new-session sheet's project search offers to ADD, beside the projects it matches:
 *  - `clone`: the search reads as a GitHub repository (`parseGithubRepo`), and the project it would make is not here
 *    yet. `name` is the project's (the repo's own), or `null` when the repo's name is not one a new project may take
 *    (`.github`), so the form must ask for one.
 *  - `existing`: the search reads as a repository whose project is already here; the sheet shows that project.
 *  - `empty`: the search is a name a new project may take and no project's name contains it.
 *  `null`: nothing to offer (a blank search, or one that matches a project by name). */
export type ProjectSearchOffer =
  | { kind: 'clone'; repo: GithubRepo; name: string | null }
  | { kind: 'existing'; name: string }
  | { kind: 'empty'; name: string }
  | null;

export function projectSearchOffer(query: string, names: readonly string[]): ProjectSearchOffer {
  const q = query.trim();
  if (q === '') return null;
  const repo = parseGithubRepo(q);
  if (repo !== null) {
    const name = deriveProjectName(repo);
    return name !== null && names.includes(name) ? { kind: 'existing', name } : { kind: 'clone', repo, name };
  }
  const needle = q.toLowerCase();
  if (!isNewProjectName(q) || names.some((n) => n.toLowerCase().includes(needle))) return null;
  return { kind: 'empty', name: q };
}

/** An offer row's two lines: what a tap does, and what it makes. */
export function projectOfferText(offer: Exclude<ProjectSearchOffer, null | { kind: 'existing' }>): { title: string; detail: string } {
  if (offer.kind === 'empty') return { title: `Create empty project ${offer.name}`, detail: 'A new git repository on the fleet box' };
  const title = `Clone ${offer.repo.owner}/${offer.repo.repo}`;
  return offer.name === null
    ? { title, detail: "From GitHub. Its name can't be a project's, so give it one" }
    : { title, detail: `From GitHub, as project ${offer.name}` };
}
