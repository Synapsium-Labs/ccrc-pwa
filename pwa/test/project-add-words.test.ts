// Adding a project from the console (add-project spec 2026-11-04 §4 PWA): the sheet's pure half. What a filled form
// sends (or why it sends nothing), the name a repository prefills, every answer of `POST /api/projects` in its own
// sentence, and git's stderr in a short form.
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/apiError';
import {
  PROJECT_ADD_HINT, PROJECT_ADD_REFUSAL_TEXT, cloneFailureOf, formVerdict, prefillName, projectAddOutcomeUnknown,
  projectAddRefusalText, projectAddedText, projectOfferText, projectSearchOffer, type ProjectAddForm,
} from '../src/fleet/projectAddWords';
import { PROJECT_NAME_MAX } from '../../shared/projectAdd';
import { PROJECT_ADD_REFUSALS } from '../../shared/refusal';

const err = (status: number, body: unknown): ApiError => new ApiError(status, body);
const form = (over: Partial<ProjectAddForm> = {}): ProjectAddForm => ({ source: 'github', repo: '', name: '', ...over });

describe('prefillName: the name a repository suggests', () => {
  it.each([
    ['example/repo', 'repo'],
    ['https://github.com/example/repo.git', 'repo'],
    ['git@github.com:example/project-a.git', 'project-a'],
    ['  example/repo/  ', ''],
    ['example/', ''],
    ['https://gitlab.com/example/repo', ''],
    [`example/${'r'.repeat(PROJECT_NAME_MAX + 1)}`, ''],
  ])('%j -> %j', (repo, want) => {
    expect(prefillName(repo)).toBe(want);
  });
});

describe('formVerdict: what the form sends', () => {
  it('a GitHub repository sends the repo as typed (trimmed) and the name', () => {
    expect(formVerdict(form({ repo: ' example/repo ', name: 'repo' })))
      .toEqual({ kind: 'send', name: 'repo', body: { source: 'github', repo: 'example/repo', name: 'repo' } });
  });

  it('an empty project sends its name alone, and the repository field is not read', () => {
    expect(formVerdict(form({ source: 'empty', repo: 'not a repo', name: ' project-a ' })))
      .toEqual({ kind: 'send', name: 'project-a', body: { source: 'empty', name: 'project-a' } });
  });

  it('holds a repository that does not parse, and says which field', () => {
    expect(formVerdict(form({ repo: 'https://gitlab.com/example/repo', name: 'repo' })))
      .toEqual({ kind: 'hold', repo: PROJECT_ADD_HINT.repo, name: null });
  });

  it.each(['-lead', '.hidden', 'a/b', 'repo.git', 'n'.repeat(PROJECT_NAME_MAX + 1)])('holds the name %j', (name) => {
    expect(formVerdict(form({ source: 'empty', name }))).toEqual({ kind: 'hold', repo: null, name: PROJECT_ADD_HINT.name });
  });

  it('holds both fields at once, so a submit says everything that is wrong', () => {
    expect(formVerdict(form({ repo: 'nope', name: '-x' }))).toEqual({ kind: 'hold', repo: PROJECT_ADD_HINT.repo, name: PROJECT_ADD_HINT.name });
    expect(formVerdict(form({ repo: 'nope', name: '' }))).toEqual({ kind: 'hold', repo: PROJECT_ADD_HINT.repo, name: PROJECT_ADD_HINT.nameNeeded });
  });
});

describe('formVerdict: a clone whose name is left blank', () => {
  it('takes the name the repository suggests, the way the route would', () => {
    expect(formVerdict(form({ repo: 'example/repo', name: '  ' })))
      .toEqual({ kind: 'send', name: 'repo', body: { source: 'github', repo: 'example/repo', name: 'repo' } });
  });

  it('asks for a name, calmly, when the repository\'s own cannot be one', () => {
    expect(formVerdict(form({ repo: 'example/.github', name: '' })))
      .toEqual({ kind: 'hold', repo: null, name: PROJECT_ADD_HINT.nameNeeded });
    expect(formVerdict(form({ repo: 'example/.github', name: 'dot-github' })))
      .toEqual({ kind: 'send', name: 'dot-github', body: { source: 'github', repo: 'example/.github', name: 'dot-github' } });
  });

  it('an empty project with a blank name is told to name it, not that its name is malformed', () => {
    expect(formVerdict(form({ source: 'empty', name: ' ' }))).toEqual({ kind: 'hold', repo: null, name: PROJECT_ADD_HINT.nameNeeded });
  });
});

describe('cloneFailureOf: git\'s stderr in a short form', () => {
  it.each([
    ["Cloning into '.project-add.repo.1'...\nremote: Repository not found.\nfatal: repository 'https://github.com/example/repo.git/' not found\n", 'not-found'],
    ['git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.\n', 'no-access'],
    ["fatal: could not read Username for 'https://github.com': terminal prompts disabled\n", 'no-access'],
  ])('%j reads %s', (stderr, kind) => {
    expect(cloneFailureOf(stderr, 'github').kind).toBe(kind);
  });

  it('keeps the fatal line of anything else, its prefix and control characters dropped, bounded', () => {
    expect(cloneFailureOf('warning: x\nfatal: unable to access: \x1b[31mSSL\x1b[0m broke\n', 'github'))
      .toEqual({ kind: 'other', line: 'unable to access: [31mSSL [0m broke' });
    expect(cloneFailureOf(`fatal: ${'x'.repeat(400)}`, 'github')).toEqual({ kind: 'other', line: 'x'.repeat(160) });
    expect(cloneFailureOf('ccd project-add: no space left\n', 'github')).toEqual({ kind: 'other', line: 'ccd project-add: no space left' });
  });

  it('reads past ccd\'s own prefix and git\'s fatal: to the reason', () => {
    expect(cloneFailureOf("ccd: git clone failed for project-a: fatal: unable to access 'https://github.com/example/repo.git/': SSL broke\n", 'github'))
      .toEqual({ kind: 'other', line: "unable to access 'https://github.com/example/repo.git/': SSL broke" });
    expect(cloneFailureOf("ccd: git clone failed for repo: remote: Repository not found.\nfatal: repository 'x' not found\n", 'github').kind)
      .toBe('not-found');
  });

  it('a clone ccd stopped at its bound is its own reason', () => {
    expect(cloneFailureOf('ccd: git clone timed out for repo after 220s\n', 'github')).toEqual({ kind: 'timed-out' });
    expect(cloneFailureOf('ccd: git init timed out for project-a after 220s\n', 'empty')).toEqual({ kind: 'timed-out' });
    expect(projectAddRefusalText(err(502, { stderr: 'ccd: git init timed out for project-a after 220s' }), 'empty'))
      .toMatch(/^Creating the project folder took too long/);
  });

  it('git with nothing to say is silent, ccd\'s placeholder included', () => {
    expect(cloneFailureOf('ccd: git clone failed for repo: git gave no message\n', 'github')).toEqual({ kind: 'silent' });
  });

  it('only a GitHub clone is read as GitHub\'s answer', () => {
    expect(cloneFailureOf('ccd: git init failed for project-a: fatal: cannot mkdir project-a: Permission denied\n', 'empty'))
      .toEqual({ kind: 'other', line: 'cannot mkdir project-a: Permission denied' });
    expect(cloneFailureOf('ccd: git clone failed for repo: git: command not found\n', 'github'))
      .toEqual({ kind: 'other', line: 'git: command not found' });
  });

  it('says there was nothing for a blank or absent stderr', () => {
    expect(cloneFailureOf('  \n', 'github')).toEqual({ kind: 'silent' });
    expect(cloneFailureOf(undefined, 'github')).toEqual({ kind: 'silent' });
  });
});

describe('projectAddRefusalText: every answer in its own sentence', () => {
  const every: [string, unknown, ('github' | 'empty')?][] = [
    ['400 bad-request', err(400, { error: 'bad-request' })],
    ['400 bad-source', err(400, { error: 'bad-source' })],
    ['400 bad-project', err(400, { error: 'bad-project' })],
    ['409 project-exists', err(409, { error: 'project-exists' })],
    ['501 unsupported', err(501, { error: 'unsupported' })],
    ['502 not found', err(502, { ok: false, stderr: 'fatal: repository not found' })],
    ['502 no access', err(502, { ok: false, stderr: 'fatal: Could not read from remote repository.' })],
    ['502 other', err(502, { ok: false, stderr: 'fatal: disk full' })],
    ['502 silent', err(502, { ok: false })],
    ['502 timed out', err(502, { ok: false, stderr: 'ccd: git clone timed out for repo after 220s' })],
    ['502 an empty project\'s init', err(502, { ok: false, stderr: 'ccd: git init failed for project-a: fatal: Permission denied' }), 'empty'],
    ['502 an empty project, silent', err(502, { ok: false }), 'empty'],
    ['504 outcome-unknown', err(504, { ok: false, error: 'outcome-unknown' })],
    ['404, a server older than the route', err(404, { error: 'not-found' })],
    ['a thrown TypeError (offline)', new TypeError('Failed to fetch')],
    ['a status with no word', err(418, { error: 'teapot' })],
  ];

  it('has a sentence for every word of the route\'s own vocabulary, and for the three it reuses', () => {
    expect(Object.keys(PROJECT_ADD_REFUSAL_TEXT).sort())
      .toEqual([...new Set([...PROJECT_ADD_REFUSALS, 'bad-project', 'bad-request', 'unsupported', 'outcome-unknown'])].sort());
  });

  it('reads the table for each word the route sends', () => {
    for (const [code, text] of Object.entries(PROJECT_ADD_REFUSAL_TEXT)) {
      expect(projectAddRefusalText(err(400, { error: code }), 'github')).toBe(text);
    }
    expect(projectAddRefusalText(err(501, { error: 'unsupported' }), 'github')).toMatch(/Update the fleet box/);
  });

  it('a 502 is git\'s failure whatever word it carries, never a table sentence', () => {
    expect(projectAddRefusalText(err(502, { error: 'project-exists', stderr: 'fatal: disk full' }), 'github')).toMatch(/disk full/);
  });

  it('names git\'s short reason for a failed clone', () => {
    expect(projectAddRefusalText(every[5]![1], 'github')).toMatch(/no such repository/);
    expect(projectAddRefusalText(every[6]![1], 'github')).toMatch(/couldn't read the repository/);
    expect(projectAddRefusalText(every[7]![1], 'github')).toMatch(/: disk full$/);
  });

  it('no two answers read alike, and none is a prefix of another', () => {
    const said = every.map(([, e, source]) => projectAddRefusalText(e, source ?? 'github'));
    expect(new Set(said).size).toBe(said.length);
    for (const a of said) for (const b of said) if (a !== b) expect(b.startsWith(a), `${a} | ${b}`).toBe(false);
    expect(said.every((s) => s.length > 0 && !/undefined|null/.test(s))).toBe(true);
  });

  it('a clone that ran past its bound, or an answer lost on the way, says the project may be there', () => {
    const unknown = projectAddRefusalText(err(504, { ok: false, error: 'outcome-unknown' }), 'github');
    expect(unknown).toMatch(/may or may not have been added/);
    expect(unknown).toMatch(/check the project list/);
    // The word is read before the 502 arm, so it is the same sentence at whatever status it rides, and a 504 without
    // it (a proxy's gateway timeout) is the same unknown.
    expect(projectAddRefusalText(err(502, { ok: false, error: 'outcome-unknown' }), 'github')).toBe(unknown);
    expect(projectAddRefusalText(err(504, 'Gateway Timeout'), 'github')).toBe(unknown);
  });

  it('a timed-out clone and an empty project\'s failure have sentences of their own', () => {
    expect(projectAddRefusalText(err(502, { stderr: 'ccd: git clone timed out for repo after 220s' }), 'github')).toMatch(/took too long/);
    expect(projectAddRefusalText(err(502, { stderr: 'ccd: git init failed for project-a: fatal: Permission denied' }), 'empty'))
      .toBe("The fleet box couldn't create the project folder: Permission denied");
    expect(projectAddRefusalText(err(502, { stderr: 'fatal: Could not read from remote repository.' }), 'empty'))
      .not.toMatch(/GitHub/);
  });

  it('says the status of an answer it has no word for', () => {
    expect(projectAddRefusalText(err(418, { error: 'teapot' }), 'github')).toMatch(/418/);
  });
});

describe('projectAddOutcomeUnknown: the answers after which the project list is re-read', () => {
  it.each([
    ['a 504', err(504, { error: 'outcome-unknown' }), true],
    ['the word at another status', err(502, { error: 'outcome-unknown' }), true],
    ['no answer at all', new TypeError('Failed to fetch'), true],
    ['a refusal', err(409, { error: 'project-exists' }), false],
    ['a failed clone', err(502, { stderr: 'fatal: disk full' }), false],
  ])('%s -> %s', (_label, e, want) => {
    expect(projectAddOutcomeUnknown(e)).toBe(want);
  });
});

describe('projectAddedText', () => {
  it('a clone is "Added <name>"', () => {
    expect(projectAddedText('repo', 'github')).toBe('Added project repo');
  });

  it('an empty project takes sessions and workspaces now, and pull requests once it has a GitHub remote (D-8193)', () => {
    const said = projectAddedText('project-a', 'empty');
    expect(said.startsWith('Added project project-a.')).toBe(true);
    expect(said).toMatch(/sessions and workspaces now/);
    expect(said).toMatch(/pull requests once it has a GitHub remote/);
  });

});

describe('projectSearchOffer', () => {
  const names = [{ name: 'alpha' }, { name: 'ccrc-pwa' }, { name: 'repo' }];

  it('a blank search offers nothing', () => {
    expect(projectSearchOffer('', names)).toBeNull();
    expect(projectSearchOffer('   ', names)).toBeNull();
  });

  it.each([
    ['example/new-thing'],
    ['https://github.com/example/new-thing'],
    ['github.com/example/new-thing.git'],
    ['git@github.com:example/new-thing.git'],
    ['  example/new-thing  '],
  ])('%s reads as a repository to clone, as its own name', (q) => {
    const offer = projectSearchOffer(q, names);
    expect(offer).toMatchObject({ kind: 'clone', name: 'new-thing', repo: { owner: 'example', repo: 'new-thing' } });
  });

  it('a repository whose project is already here shows that project instead', () => {
    expect(projectSearchOffer('example/repo', names)).toEqual({ kind: 'existing', name: 'repo' });
    expect(projectSearchOffer('example/Repo', names)).toEqual({ kind: 'existing', name: 'repo' });
  });

  it('the repository a project was measured to be decides, whatever the project is called', () => {
    const rows = [
      { name: 'api-work', repo: { state: 'named', slug: 'acme/api' } as const },
      { name: 'api', repo: { state: 'named', slug: 'other/api' } as const },
      { name: 'web', repo: { state: 'unmeasured' } as const },
    ];
    // Cloned under another name: that project, not a second clone.
    expect(projectSearchOffer('https://github.com/ACME/api', rows)).toEqual({ kind: 'existing', name: 'api-work' });
    // A namesake measured to be another repository: a clone under the owner's name too, or none when that is taken.
    expect(projectSearchOffer('third/api', rows)).toMatchObject({ kind: 'clone', name: 'third-api', repo: { owner: 'third', repo: 'api' } });
    expect(projectSearchOffer('third/api', [...rows, { name: 'Third-API' }])).toMatchObject({ kind: 'clone', name: null });
    // A namesake nobody measured is taken for this repository.
    expect(projectSearchOffer('acme/web', rows)).toEqual({ kind: 'existing', name: 'web' });
  });

  it('a repository whose name cannot be a project\'s is offered with no name, for the form to ask', () => {
    expect(projectSearchOffer('example/.github', names)).toMatchObject({ kind: 'clone', name: null });
  });

  it('a new name nothing matches offers an empty project of that name', () => {
    expect(projectSearchOffer('fresh-idea', names)).toEqual({ kind: 'empty', name: 'fresh-idea' });
  });

  it('a search that matches a project by name, or is not a name a project may take, offers nothing', () => {
    expect(projectSearchOffer('ccrc', names)).toBeNull();
    expect(projectSearchOffer('ALPHA', names)).toBeNull();
    expect(projectSearchOffer('not a name', names)).toBeNull();
    expect(projectSearchOffer('-dash', names)).toBeNull();
    expect(projectSearchOffer('thing.git', names)).toBeNull();
    expect(projectSearchOffer('https://gitlab.com/example/thing', names)).toBeNull();
  });
});

describe('projectOfferText', () => {
  it('a clone names the repository and the project it makes', () => {
    const offer = projectSearchOffer('example/new-thing', [])!;
    expect(offer.kind).toBe('clone');
    expect(projectOfferText(offer as Exclude<typeof offer, { kind: 'existing' }>))
      .toEqual({ title: 'Clone example/new-thing', detail: 'From GitHub, as project new-thing' });
  });

  it('a clone with no name says one is needed, and an empty project says what it makes', () => {
    expect(projectOfferText({ kind: 'clone', repo: { owner: 'example', repo: '.github', url: '' }, name: null }).detail)
      .toMatch(/under a name you give it/);
    expect(projectOfferText({ kind: 'empty', name: 'fresh-idea' }))
      .toEqual({ title: 'Create empty project fresh-idea', detail: 'A new git repository on the fleet box' });
  });
});
