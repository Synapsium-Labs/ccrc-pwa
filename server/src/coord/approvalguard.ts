import path from 'node:path';
import { isTmpRootId, type ChildMark } from '../../../shared/api.js';
import { isUserVariable } from './bash-variables.js';
import { APPROVAL_INPUT_MAX_BYTES } from './redact.js';

/**
 * THE APPROVAL CLASSIFIER (D-5299, coordinator-first routing spec 2026-10-17 §6.5): DEFAULT ESCALATE. Pure: no I/O,
 * no clock, no filesystem.
 *
 * It runs on the server box before any ruling on a child's permission prompt is signed, and the coordinator's word can
 * only narrow it. It answers one of three classes (`APPROVAL_CLASS_MAP`):
 *   - `forbidden`: what `CLAUDE.md`'s SAFETY section forbids to sessions, and the approval surface itself, matched
 *     ANYWHERE in the input. Never held, never mailed: straight to the operator.
 *   - `ordinary`: a Bash command EVERY token of which matches one of the strict grammar's enumerated shapes below,
 *     with every target strictly inside one of the child's own roots. Only this class can ever be allowed.
 *   - `escalate`: everything else. A coordinator may deny it or hand it over, never allow it.
 *
 * WHAT IT IS FOR (D-5360 round 8). Its main job is to mark the forbidden requests and send everything else to the
 * operator unless the coordinator denies it. The coordinator may allow only cd-free, in-root `rm` / `mkdir` / `touch`
 * cleanups and literal or `mktemp` assignments (with `true` / `:` and the `/dev/null` redirects around them).
 *
 * THE STRICT GRAMMAR (D-5360). Rounds 1 and 2 of the review each found bash semantics that a classifier modelling bash
 * in general had missed, so `ordinary` is a closed list of shapes, not a model of bash. Rounds 3 to 5 then each found
 * a read that printed a file it should not have (a relative climb, a content-recursive grep, `git diff`'s no-index
 * fallback over two directories, a `grep -e --` that hid its `-r`, a grep shim that reads a directory), while the
 * measured prompts (spec §2.2) gained nothing from reads being ordinary. So, by the coordinator's ruling after round
 * 5, THE GRAMMAR IS THE MEASURED CLEANUP WRITES ONLY, and EVERY READ OR INSPECTION COMMAND ESCALATES (`cat`, `head`,
 * `tail`, `wc`, `grep`, `ls`, `find`, `du`, `stat`, `test` / `[`, `date`, `sleep`, `echo` / `printf`, every `git`,
 * and everything else). A request is `ordinary` only when every statement is one of:
 *   - `rm` (`-r`, `-R`, `-f` in any cluster, `--recursive`, `--force`), `mkdir` (`-p`, `--parents`) or `touch` (no
 *     option), every target STRICTLY inside one of the child's own roots, never under `.git`, never an
 *     agent-instruction or hook file (`AGENT_FILE_PARTS`: `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `.mcp.json`,
 *     anything under `.claude/`, `.claude-plugin/`, `.cursor/`, `.husky/`, `.githooks/` or a `hooks/` directory, a
 *     `settings.json` / `settings.local.json`, a `session-hook.sh`, `GEMINI.md`, `.cursorrules`,
 *     `copilot-instructions.md`, `.gitattributes`, `.gitmodules`, round 9's `AGENT.md`, `.windsurfrules`,
 *     `.clinerules`), never read as an option (and no option-like word after the first operand, round 9: BSD getopt
 *     reads it as a file in the real cwd), and with NO `..`
 *     component at all (round 7: the kernel resolves `..` from where an in-root symlink really points), never ending in
 *     `/` or `/.` (round 8: `rm -rf ./link/` empties what the link points at); an `rm` glob
 *     only in the last component, under a parent strictly inside a root, with a `./` or directory before a leaf that
 *     starts with `*`, and with a leaf that can match neither `.git` nor one of those files;
 *   - an assignment of a USER VARIABLE (a name that is neither bash's own, `bash-variables.ts`, nor one a program
 *     reads from the environment), at most once, by a standalone `NAME=value` that opens a statement joined by `&&`
 *     alone; its value a literal (a leading `~/` allowed) or `$(mktemp)`, `$(mktemp -d)`, `$(mktemp [-d] -p <absolute
 *     dir inside a root>)`. A use is only a double-quoted `"$NAME"` / `"${NAME}"` at the start of a target, after
 *     its assignment (a mktemp from an earlier statement may also be the empty string, so only a whole-word `"$X"`
 *     survives there);
 *   - `true` or `:`, with no operand;
 *   - on any of those, only the redirects `>/dev/null`, `2>/dev/null`, `&>/dev/null` and `2>&1`.
 * Statements split on `;`, newlines, `&&` and `||`. No `cd`, `pushd` or `popd` (round 8: `cd -L` falls back to a
 * physical chdir when its logical target is gone, and an earlier `rm` in the statement can remove the in-root symlink
 * the logical path ran through), so every relative target resolves from the request's own `cwd`. No non-ASCII
 * character anywhere in the request (round 8: bash 3.2's locale-dependent `$NAME` bytes, and Unicode case folding on
 * a case-insensitive filesystem). No pipeline, subshell, brace group, compound command, background
 * job, here-document, here-string, input redirect, process substitution, unquoted expansion, backslash outside double
 * quotes or backtick. Words are safe unquoted characters (`A-Z a-z 0-9 _ . / : = , + @ % -`), quoted text, a leading
 * `~/` and an unquoted `*`; a word or an assignment's value never starts with an unquoted `=`. A word that held any
 * quoting (even an empty `''`) is never an assignment or a command name (round 7: bash runs `D''=x` as a command).
 *
 * THE SHELL IS BASH (D-5360 round 7). The grammar is bash's semantics; zsh gives other meanings to some of its words
 * (`=cmd` expands to a path, `path=` and `cdpath=` reorder lookups). Plan Task 15 pins a dispatched child's Bash tool
 * to bash, Task 13 checks it on the rig, and the server mints no ruling for a child whose spawn record lacks the pin.
 * As defence in depth, a leading unquoted `=` escalates, and zsh's own parameter names are no user variable.
 *
 * THE ROOTS are the child's own, derived by the server from its registry row (`rootsForChild`), never from the
 * request: its worktree, its own `$HOME/.cc-tmp/<id>` leaf (the `TMPDIR` a child is spawned with, `ccd`'s
 * `_child_tmpdir`), and its own Claude scratch leaf, which is `null` until a rig capture records that leaf's shape on
 * a verified version (plan Task 13); a `null` root admits nothing. `/`, `/tmp`, `/private/tmp`, Claude Code's tmp
 * root, `~/.cc-tmp`, `$HOME` and every ancestor of one are never a root, whatever `ctx` says (`admissibleRoot`).
 *
 * THE WORKING DIRECTORY is the request's `cwd` (or `null`), used only when absolute and normal: every relative target
 * resolves from it, and with no `cwd`, or a `cwd` outside the roots, a relative target escalates.
 *
 * CREDENTIAL PATHS (spec §6.5, D-5361): a mention escalates, printing one is forbidden.
 *
 * RESOLUTION IS LEXICAL: the server cannot see the fleet filesystem, so a symlink inside a root that points outside it
 * is outside the guard's reach (spec §6.1's accepted limit), and so is what a directory target holds: `rm -rf
 * ./server` removes a `server/CLAUDE.md` the classifier cannot see.
 *
 * SPAWN-SIDE ACCEPTED LIMIT (D-5360, review rounds 4 and 7): exported shell functions and options (`BASH_FUNC_rm%%`,
 * `SHELLOPTS`, `BASHOPTS`), which the child's spawn hands to bash, and Claude Code's shell snapshot
 * (`snapshot-….sh` under each `~/.claude…/shell-snapshots/`), which re-applies the user's rc ALIASES, FUNCTIONS and SETOPTS before
 * every command; this file sees neither, and an alias or function named like a grammar command runs instead of it.
 * Plan Task 13 records that the fleet snapshot defines no alias or function for `rm`, `mkdir`, `touch`, `cd`, `true`,
 * `:` or `mktemp`.
 *
 * A request over the stored cap (`APPROVAL_INPUT_MAX_BYTES`) escalates unread, and every pattern below it is linear in
 * the text's length. The hook carries a static bash copy of the `forbidden` match (plan Task 14), held equal to this
 * one by the corpus `server/test/fixtures/approvals/guard-corpus.json`, which both iterate.
 */


/** The three classes, each with what it means for a ruling. */
export const APPROVAL_CLASS_MAP = {
  forbidden: 'a SAFETY-forbidden act or the approval surface: never held or mailed, straight to the operator',
  escalate: 'not a recognised safe shape: a coordinator may deny it or hand it over, never allow it',
  ordinary: 'every simple command is a recognised shape inside the child\'s own roots: a coordinator may allow it once',
} as const satisfies Record<string, string>;

export type ApprovalClass = keyof typeof APPROVAL_CLASS_MAP;

export function isApprovalClass(v: unknown): v is ApprovalClass {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(APPROVAL_CLASS_MAP, v);
}

/** The child's own roots, and the fleet box's `$HOME` that `~` and `$HOME` expand to. */
export interface ApprovalRoots {
  readonly worktree: string | null;
  readonly tmpRoot: string | null;
  readonly scratch: string | null;
  readonly home: string | null;
}

/** What `approvalClass` judges a request against: the roots, and the request's working directory. */
export interface ApprovalCtx extends ApprovalRoots {
  readonly cwd: string | null;
}

/** The forbidden `ccd` verbs (CLAUDE.md SAFETY). Plan Task 15 derives the children's deny rules from this list. One
 *  `|`-joined string, not eight quoted literals: the verb censuses (`ws-collect-wiring.test.ts` and its siblings)
 *  count a quoted verb as a composer of it, and this list composes nothing. */
export const FORBIDDEN_CCD_VERBS: readonly string[] =
  'ws-rm|ws-reap|ws-gc --prune|ws-archive|ws-restore|ws-reclaim|ws-expire|ws-collect'.split('|');

// ── roots ──────────────────────────────────────────────────────────────────

const isAbsNormal = (p: string): boolean => p.startsWith('/') && path.posix.normalize(p) === p && (p === '/' || !p.endsWith('/'));
const atOrInside = (p: string, root: string): boolean => p === root || p.startsWith(`${root}/`);
const strictlyInside = (p: string, root: string): boolean => p.startsWith(`${root}/`);

/** Whether `p` may be a root: absolute and normal, and neither one of the never-a-root paths nor an ancestor of one. */
export function admissibleRoot(p: string | null, home: string | null): p is string {
  if (p === null || !isAbsNormal(p) || p === '/') return false;
  if (/^\/(?:private\/)?tmp\/claude-[0-9]+$/.test(p)) return false;            // Claude Code's tmp root
  const never = ['/tmp', '/private/tmp', '/var/tmp'];
  if (home !== null) never.push(home, `${home}/.cc-tmp`);
  return !never.some((n) => atOrInside(n, p));                                 // never one, never above one
}

/** The child's own three roots, from its registry row, or `null` for a row that is not a child (spec §6.5). The
 *  scratch root is `null`: no verified version has recorded its shape yet (plan Task 13). */
export function rootsForChild(
  row: { readonly id: string; readonly workdir: string; readonly child: ChildMark }, home: string,
): ApprovalRoots | null {
  if (row.child.kind !== 'child') return null;
  if (!isAbsNormal(home) || home === '/' || !isTmpRootId(row.id)) return null;
  const tmpRoot = `${home}/.cc-tmp/${row.id}`;
  return {
    worktree: admissibleRoot(row.workdir, home) ? row.workdir : null,
    tmpRoot: admissibleRoot(tmpRoot, home) ? tmpRoot : null,
    scratch: null,
    home,
  };
}

// ── the forbidden match ────────────────────────────────────────────────────

const WB = String.raw`(?:^|[\s;&|()\x60'"=/])`;                                  // a command word's left edge
const reEsc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CCD_HEAD = String.raw`${WB}ccd['"]?\s+(?:-\S+\s+)*`;
/** A Claude settings file, a `CLAUDE.md`, a hook script. */
const SENSITIVE_EDIT = String.raw`(?:CLAUDE\.md|settings(?:\.local)?\.json|session-hook\.sh|/hooks/)`;
/** spec §6.5's credential paths, and D-5361's credential stores (gh's `hosts.yml` and `config.yml`, docker's and
 *  kubectl's configs, `.npmrc`, `.pypirc`, `.netrc`, `.git-credentials`, `.aws/`, `.ssh/`, `.gnupg/`,
 *  `.config/gcloud/`), and, after review round 3, the private-key basenames (`id_rsa`, `id_dsa`, `id_ecdsa`,
 *  `id_ed25519`, any `*_rsa` / `*_dsa` / `*_ecdsa` / `*_ed25519`, `deploy_key`, `identity`, `ssh_host_*`), a `*.key`
 *  or `*.pem` file, any `.env*` and `*.env`, `.pgpass`, `.vault-token`, `rclone.conf`, `.s3cfg`, `.azure/`, `secrets.yaml` (and `.yml`, `.json`, `.toml`), a
 *  repository's `.git/config`, and Claude Code's own stores (`~/.claude.json`, each
 *  `~/.claude…/.credentials.json`), and, after review round 4, the security-key forms
 *  `*_ecdsa_sk` / `*_ed25519_sk`, keystores (`*.p12`, `*.pfx`, `*.jks`, `*.keystore`), `.htpasswd`, `.my.cnf`,
 *  `kubeconfig`, `*.tfstate`, `.boto`, `service-account*.json`, `token.json` and `.yarnrc.yml`: a mention escalates;
 *  printing one is forbidden. The list is best effort over names; since D-5360's round-6 ruling no read is ordinary,
 *  so it now decides only between `forbidden` and `escalate`. */
const CREDENTIAL = String.raw`(?:\.ssh(?![\w-])|\.cc-secrets|\.token(?![\w-])|\.env(?:rc|\.[\w.-]+)?(?![\w-])|credentials|auth\.json|\.netrc|\.pem(?![\w-])|\.key(?![\w.-])|agent\.env|gh/(?:hosts|config)\.yml|\.docker/config\.json|\.kube/config(?![\w-])|\.npmrc|\.pypirc|\.git-credentials|(?<![\w-])\.aws(?![\w-])|(?<![\w-])\.gnupg(?![\w-])|\.config/gcloud(?![\w-])|_(?:rsa|dsa|ecdsa|ed25519)(?![\w-])|deploy_key|(?<![\w.-])identity(?![\w.-])|ssh_host_|\.pgpass|\.vault-token|rclone\.conf|\.s3cfg|(?<![\w-])\.azure(?![\w-])|\.git/config(?![\w-])|\.claude\.json|(?<![\w-])secrets?\.(?:ya?ml|json|toml)(?![\w-])|_(?:ecdsa|ed25519)_sk(?![\w-])|\.(?:p12|pfx|jks|keystore)(?![\w-])|\.htpasswd|\.my\.cnf|kubeconfig|\.tfstate|(?<![\w-])\.boto(?![\w-])|service[-_]account[\w-]*\.json|token\.json(?![\w-])|\.yarnrc\.yml)`;
const CREDENTIAL_RE = new RegExp(CREDENTIAL);

/** Whether, inside one segment of `text` (split on `sep`), a `head` match lies wholly before a `tail` match: the
 *  shape `head[^sep]*?tail`, decided in LINEAR time (D-5299: a lazy scan per head is quadratic in the line, and a
 *  child can send a long line). The last tail start is found in one overlapping pass; the head is then searched for
 *  in what precedes it. This can only over-match, toward `forbidden`. */
function headBeforeTail(text: string, sep: RegExp, head: RegExp, tail: RegExp): boolean {
  for (const seg of text.split(sep)) {
    let last = -1;
    tail.lastIndex = 0;
    for (let m = tail.exec(seg); m !== null; m = tail.exec(seg)) { last = m.index; tail.lastIndex = m.index + 1; }
    if (last >= 0 && head.test(seg.slice(0, last))) return true;
  }
  return false;
}
const g = (re: string): RegExp => new RegExp(re, 'g');

/** Every forbidden shape, matched anywhere in a Bash command's text (spec §6.5 "forbidden"). Each test is linear in
 *  the text's length (D-5299). */
export const FORBIDDEN_PATTERNS: readonly { readonly why: string; readonly test: (text: string) => boolean }[] = [
  ...FORBIDDEN_CCD_VERBS.map((v) => {
    const [first, ...rest] = v.split(' ');
    if (rest.length === 0) {
      const re = new RegExp(`${CCD_HEAD}${reEsc(first)}(?![\\w-])`);
      return { why: `ccd ${v}`, test: (t: string) => re.test(t) };
    }
    // `ccd ws-gc … --prune`: the verb, then any words of its segment, then the flag.
    const head = new RegExp(`${CCD_HEAD}${reEsc(first)}(?=\\s|$)`);
    const tail = g(rest.map((r) => String.raw`\s${reEsc(r)}(?![\w-])`).join(''));
    return { why: `ccd ${v}`, test: (t: string) => headBeforeTail(t, /[;&|]/, head, tail) };
  }),
  ...[
    { why: 'tmux', re: new RegExp(`${WB}tmux(?=$|[\\s;&|)'"])`) },
    { why: 'a registry path', re: /\/\.(?:cc-sessions|cc-limits|ccrc)(?![\w.-])/ },
    { why: 'reboot or shutdown', re: new RegExp(`${WB}(?:reboot|shutdown|poweroff|halt)(?=$|[\\s;&|)'"])`) },
    { why: 'ccrc update or rollback', re: new RegExp(`${WB}ccrc['"]?\\s+(?:-\\S+\\s+)*(?:update|rollback)(?![\\w-])`) },
    { why: 'the approval surface', re: /(?:ccrc-api|\$\{?API\}?)['"]?\s+(?:-\S+\s+)*approvals(?![\w-])|\/api\/approvals(?![\w-])|approval-signing|approval-verify\.mjs/ },
  ].map(({ why, re }) => ({ why, test: (t: string) => re.test(t) })),
  ...[
    { why: 'a session unit or the tmux scope', sep: /\n/,
      head: new RegExp(`${WB}(?:systemctl|systemd-run|kill|pkill|killall)(?![\\w-])`), tail: g('claude-session@|ccrc|tmux') },
    { why: 'an edit to a settings file, a hook or a CLAUDE.md', sep: /[\n;&|]/,
      head: new RegExp(String.raw`>|\btee\b|\bsed\s+(?:-\S+\s+)*-i|\bperl\s+-\S*i|\bmv\b|\bcp\b|\bln\b|\btruncate\b|\brm\b`), tail: g(SENSITIVE_EDIT) },
    { why: 'printing a secret', sep: /[\n;&|]/,
      head: new RegExp(String.raw`${WB}(?:cat|head|tail|less|more|base64|xxd|strings|od|nl|bat)(?![\w-])`), tail: g(CREDENTIAL) },
  ].map(({ why, sep, head, tail }) => ({ why, test: (t: string) => headBeforeTail(t, sep, head, tail) })),
];

const isForbiddenText = (text: string): boolean => FORBIDDEN_PATTERNS.some((p) => p.test(text));

const PATH_FIELDS = ['file_path', 'path', 'notebook_path'] as const;
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const PATH_FORBIDDEN = /\/\.(?:cc-sessions|cc-limits|ccrc)(?![\w.-])|approval-signing|approval-verify\.mjs/;

function stringLeaves(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) stringLeaves(x, out);
  else if (v !== null && typeof v === 'object') for (const x of Object.values(v)) stringLeaves(x, out);
  return out;
}

/** A non-Bash tool is never `ordinary`; it is `forbidden` when it reaches a forbidden path. */
function nonBashClass(tool: string, input: Record<string, unknown>): ApprovalClass {
  if (tool.startsWith('mcp__') && stringLeaves(input).some(isForbiddenText)) return 'forbidden';
  for (const f of PATH_FIELDS) {
    const p = input[f];
    if (typeof p !== 'string') continue;
    if (PATH_FORBIDDEN.test(p)) return 'forbidden';
    if (EDIT_TOOLS.has(tool) && new RegExp(`(?:^|/)${SENSITIVE_EDIT}`).test(p)) return 'forbidden';
    if (tool === 'Read' && CREDENTIAL_RE.test(p)) return 'forbidden';
  }
  return 'escalate';
}

// ── the strict grammar (D-5360) ────────────────────────────────────────────

/** Any character past 7-bit ASCII (D-5360 round 8). */
const NON_ASCII = /[^\x00-\x7F]/;

/** Thrown anywhere below: the request is `escalate`. */
class Escalate extends Error {}
function esc(why: string): never { throw new Escalate(why); }

/** One piece of a word. A `var` is only ever a double-quoted `"$NAME"` / `"${NAME}"` of a user variable; a `tilde` is
 *  an unquoted `~` at the start of a word (or of an assignment's value); a `glob` is an unquoted `*`; a `mktemp` is
 *  `$(mktemp …)`, and only ever an assignment's whole value. */
type Seg =
  | { readonly k: 'lit'; readonly s: string; readonly q: boolean }
  | { readonly k: 'var'; readonly name: string }
  | { readonly k: 'tilde' }
  | { readonly k: 'glob' }
  | { readonly k: 'mktemp'; readonly args: readonly string[] };
type Word = readonly Seg[];
/** D-5360 round 6: `>`, `2>` and `&>` (to `/dev/null` only), and `dup`, which is `2>&1` alone. */
type RedirOp = '>' | '2>' | '&>' | 'dup';
type Tok =
  | { readonly t: 'word'; readonly w: Word }
  | { readonly t: 'op'; readonly v: ';' | '\n' | '&&' | '||' }
  | { readonly t: 'redir'; readonly op: RedirOp };

/** The characters a word may hold unquoted. Everything else unquoted (`$`, `` ` ``, `\`, `(`, `)`, `{`, `}`, `<`,
 *  `[`, `]`, `?`, `!`, `~` past the start, `&` alone, `^`, any non-ASCII byte) escalates. */
const SAFE_UNQUOTED = /^[A-Za-z0-9_./:=,+@%-]$/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NAME_AT = /[A-Za-z_][A-Za-z0-9_]*/y;
const ASSIGN_HEAD = /^([A-Za-z_][A-Za-z0-9_]*)=$/;
const MKTEMP_WORD = /^[A-Za-z0-9_./-]+$/;

function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let w: Seg[] = [];
  let started = false;
  let i = 0;
  /** Adds literal text; `q` marks it quoted. D-5360 round 7: an empty QUOTED piece always stands, so a word that held
   *  any quoting keeps it: bash reads `D''=x` as a command named `D=x`, never an assignment, and `r''m` is no plain
   *  command name, and neither may the grammar read them as one. */
  const lit = (s: string, q: boolean): void => {
    const last = w[w.length - 1];
    if (last !== undefined && last.k === 'lit' && last.q === q) w[w.length - 1] = { k: 'lit', s: last.s + s, q };
    else if (s !== '' || q) w.push({ k: 'lit', s, q });
    started = true;
  };
  /** Nothing but empty quoted pieces so far: the next unquoted character is the word's first. */
  const atWordStart = (): boolean => w.every((sg) => sg.k === 'lit' && sg.s === '');
  const flush = (): void => { if (started) toks.push({ t: 'word', w }); w = []; started = false; };
  const boundary = (j: number): boolean => j >= src.length || ' \t\n;&|'.includes(src[j]);
  /** The word so far is exactly an unquoted `NAME=`: what follows is an assignment's value. */
  const atValueStart = (): boolean => w.length === 1 && w[0].k === 'lit' && !w[0].q && ASSIGN_HEAD.test(w[0].s);
  /** `$(mktemp …)` at `j` (pointing at `$`); returns the index after `)`. */
  const mktemp = (j: number): number => {
    const e = src.indexOf(')', j + 2);
    if (e < 0) esc('an unclosed $(');
    const parts = src.slice(j + 2, e).trim().split(/[ \t]+/);
    if (parts[0] !== 'mktemp' || !parts.slice(1).every((p) => MKTEMP_WORD.test(p))) esc('a command substitution other than mktemp');
    w.push({ k: 'mktemp', args: parts.slice(1) }); started = true;
    return e + 1;
  };

  while (i < src.length) {
    const c = src[i];
    if (c === "'") {
      const e = src.indexOf("'", i + 1);
      if (e < 0) esc('an unclosed quote');
      lit(src.slice(i + 1, e), true); i = e + 1; continue;
    }
    if (c === '"') {
      i++;
      if (src.startsWith('$(', i) && atValueStart()) {                      // X="$(mktemp -d)"
        i = mktemp(i);
        if (src[i] !== '"') esc('more than a mktemp in a quoted value');
        i++; continue;
      }
      let any = false;
      while (i < src.length && src[i] !== '"') {
        const d = src[i];
        any = true;
        if (d === '\\') {
          const n = src[i + 1];
          if (n === '\n' || n === undefined) esc('a backslash-newline in quotes');
          if ('$`"\\'.includes(n)) { lit(n, true); i += 2; continue; }
          lit('\\', true); i++; continue;
        }
        if (d === '`') esc('backticks');
        if (d === '$') {
          let name: string;
          if (src[i + 1] === '{') {
            const e = src.indexOf('}', i + 2);
            if (e < 0) esc('an unclosed ${');
            name = src.slice(i + 2, e);
            if (!NAME.test(name)) esc('a ${…} operator');
            i = e + 1;
          } else {
            NAME_AT.lastIndex = i + 1;
            const m = NAME_AT.exec(src);
            if (m === null) esc('a $ that is not a plain variable');
            name = m![0]; i += 1 + name.length;
          }
          if (!isUserVariable(name)) esc(`the shell's own variable ${name}`);
          w.push({ k: 'var', name }); started = true; continue;
        }
        lit(d, true); i++;
      }
      if (i >= src.length) esc('an unclosed quote');
      if (!any) lit('', true);
      i++; continue;
    }
    if (c === ' ' || c === '\t') { flush(); i++; continue; }
    if (c === '\n') { flush(); toks.push({ t: 'op', v: '\n' }); i++; continue; }
    if (c === '#' && !started) { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === ';') { if (src[i + 1] === ';') esc(';;'); flush(); toks.push({ t: 'op', v: ';' }); i++; continue; }
    if (c === '&') {
      flush();
      if (src[i + 1] === '&') { toks.push({ t: 'op', v: '&&' }); i += 2; continue; }
      if (src[i + 1] === '>') {
        if (src[i + 2] === '>') esc('an appending redirect');
        toks.push({ t: 'redir', op: '&>' }); i += 2; continue;
      }
      esc('a background job');
    }
    if (c === '|') {
      flush();
      if (src[i + 1] === '|') { toks.push({ t: 'op', v: '||' }); i += 2; continue; }
      esc('a pipeline');
    }
    if (!started && c === '2' && src.startsWith('>&1', i + 1) && boundary(i + 4)) {
      toks.push({ t: 'redir', op: 'dup' }); i += 4; continue;                   // 2>&1, the one descriptor dup
    }
    if (!started && c === '2' && src[i + 1] === '>') {
      if (src[i + 2] === '>') esc('an appending redirect');
      toks.push({ t: 'redir', op: '2>' }); i += 2;
      if (src[i] === '&' || src[i] === '|' || src[i] === '(') esc('an unrecognised redirect');
      continue;
    }
    if (c === '>') {
      // A word of bare digits right before `>` is a descriptor (`3>`, `12>`), not an operand: not a shape.
      if (w.length === 1 && w[0].k === 'lit' && !w[0].q && /^[0-9]+$/.test(w[0].s)) esc('a numbered redirect');
      flush();
      const n = src[i + 1];
      if (n === '&' || n === '|' || n === '(') esc('an unrecognised redirect');
      if (n === '>') esc('an appending redirect');
      toks.push({ t: 'redir', op: '>' }); i++;
      continue;
    }
    if (c === '~') {
      if ((started && !atValueStart()) || !(src[i + 1] === '/' || boundary(i + 1))) esc('a ~ that is not a leading ~/');
      w.push({ k: 'tilde' }); started = true; i++; continue;
    }
    if (c === '*') { w.push({ k: 'glob' }); started = true; i++; continue; }
    // D-5360 round 7: zsh's EQUALS expansion turns a leading unquoted `=` (of a word, or of an assignment's value)
    // into a command's full path (`rm -f =claude`); bash leaves it alone. The grammar is bash's (plan Task 15 pins
    // the children's shell); this is defence in depth.
    if (c === '=' && (atWordStart() || atValueStart())) esc('a word or value that starts with an unquoted =');
    if (c === '$') {
      if (src[i + 1] === '(' && atValueStart()) { i = mktemp(i); continue; }   // X=$(mktemp -d)
      esc('an unquoted expansion');
    }
    if (!SAFE_UNQUOTED.test(c)) esc(`the unquoted character ${JSON.stringify(c)}`);
    lit(c, false); i++;
  }
  flush();
  return toks;
}

// ── the statement grammar ──────────────────────────────────────────────────

interface Redir { readonly op: RedirOp; readonly target: Word | null }
interface Assign { readonly name: string; readonly value: Word }
interface Simple { readonly words: readonly Word[]; readonly redirs: readonly Redir[]; readonly assign: Assign | null }
/** One statement: simple commands joined by `&&` and `||` (no pipeline: the lexer refuses `|`). */
interface AndOr { readonly cmds: readonly Simple[]; readonly ops: readonly ('&&' | '||')[] }

/** A word made of literal pieces only, as its text; `null` otherwise. */
const litText = (w: Word): string | null =>
  (w.every((s) => s.k === 'lit') ? w.map((s) => (s as { s: string }).s).join('') : null);

/** The statements, split on `;` and newlines; each an and-or list of simple commands. Nothing else: no pipeline, no
 *  subshell, no group, no compound command, no background job. */
function parse(toks: Tok[]): AndOr[] {
  let p = 0;
  const isOp = (v: string): boolean => { const t = toks[p]; return t !== undefined && t.t === 'op' && t.v === v; };
  const skipNl = (): void => { while (isOp('\n')) p++; };
  const simple = (): Simple => {
    const words: Word[] = []; const redirs: Redir[] = [];
    for (let t = toks[p]; t !== undefined && t.t !== 'op'; t = toks[p]) {
      p++;
      if (t.t === 'redir') {
        if (t.op === 'dup') { redirs.push({ op: 'dup', target: null }); continue; }
        const target = toks[p];
        if (target === undefined || target.t !== 'word') esc('a redirect with no target');
        p++; redirs.push({ op: t.op, target: (target as { w: Word }).w }); continue;
      }
      words.push(t.w);
    }
    if (words.length === 0) esc('an empty command');
    const head = words[0][0];
    const m = head.k === 'lit' && !head.q ? /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(head.s) : null;
    if (m === null) return { words, redirs, assign: null };
    if (words.length > 1 || redirs.length > 0) esc('an env-prefixed command, or an assignment with more');
    if (!isUserVariable(m[1])) esc(`an assignment to the shell's own variable ${m[1]}`);
    const rest = (head as { s: string }).s.slice(m[0].length);
    return { words: [], redirs, assign: { name: m[1], value: [...(rest === '' ? [] : [{ k: 'lit', s: rest, q: false } as const]), ...words[0].slice(1)] } };
  };
  const script: AndOr[] = [];
  for (;;) {
    while (isOp('\n') || isOp(';')) p++;
    if (p >= toks.length) break;
    const cmds = [simple()]; const ops: ('&&' | '||')[] = [];
    for (let t = toks[p]; t !== undefined && t.t === 'op' && (t.v === '&&' || t.v === '||'); t = toks[p]) {
      p++; ops.push(t.v); skipNl(); cmds.push(simple());
    }
    script.push({ cmds, ops });
    if (p < toks.length && !isOp(';') && !isOp('\n')) esc('unexpected syntax');
  }
  if (script.length === 0) esc('an empty command');
  return script;
}

// ── variables: assigned once, at the head of a statement ───────────────────

interface Var { readonly stmt: number; readonly values: readonly string[]; readonly mktemp: boolean }
interface At { readonly stmt: number; readonly elem: number }
type Vars = ReadonlyMap<string, Var>;

/** `mktemp`, `mktemp -d`, `mktemp -p <absolute dir inside a root>`, with `-q` allowed, and no template (a template
 *  without `-p` is relative to the working directory). The path it creates. */
function mktempPath(args: readonly string[], ctx: ApprovalCtx): string {
  let dir: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-d' || a === '-q' || a === '-dq' || a === '-qd') continue;
    if (a === '-p') {
      const d = args[++i] ?? esc('mktemp -p with no directory');
      if (!d.startsWith('/') || !isAbsNormal(d)) esc('a mktemp -p directory that is not absolute and normal');
      if (!insideRoots(d, ctx, false) || hasGit(d)) esc('mktemp -p outside the roots');
      if (agentPath(d)) esc('mktemp -p into an agent-instruction or hook directory');   // D-5360 round 7
      dir = d; continue;
    }
    esc(`the mktemp word ${a}`);
  }
  if (dir === null) {
    if (ctx.tmpRoot === null || !admissibleRoot(ctx.tmpRoot, ctx.home)) esc('no TMPDIR leaf');
    dir = ctx.tmpRoot;
  }
  return `${dir}/tmp.XXXXXXXXXX`;
}

/** Every assignment in the script. Each user variable is assigned at most once, by a standalone `NAME=value` that is
 *  the first element of its statement, in a statement joined by `&&` alone; its value is a literal (a leading `~/`
 *  allowed) or `$(mktemp …)`. */
function collectVars(script: readonly AndOr[], ctx: ApprovalCtx): Vars {
  const vars = new Map<string, Var>();
  script.forEach((ao, stmt) => ao.cmds.forEach((c, elem) => {
    if (c.assign === null) return;
    if (elem > 0) esc('an assignment after the start of a statement');
    if (ao.ops.some((o) => o !== '&&')) esc('an assignment heading a statement joined by ||');
    if (vars.has(c.assign.name)) esc(`${c.assign.name} assigned twice`);
    const v = c.assign.value;
    if (v.length === 1 && v[0].k === 'mktemp') { vars.set(c.assign.name, { stmt, values: [mktempPath(v[0].args, ctx)], mktemp: true }); return; }
    let text = '';
    v.forEach((sg, idx) => {
      if (sg.k === 'lit') text += sg.s;
      else if (sg.k === 'tilde' && idx === 0) text += ctx.home ?? esc('no home for ~');
      else esc('an assignment whose value is not a literal or a mktemp');
    });
    if (CREDENTIAL_RE.test(text)) esc('a credential path in an assignment');
    vars.set(c.assign.name, { stmt, values: [text], mktemp: false });
  }));
  return vars;
}

/** The values `$NAME` can have where it is used: a literal from any earlier statement or earlier in its own `&&`
 *  statement; a mktemp path earlier in its own `&&` statement (the `&&` proves it succeeded), or, from an earlier
 *  statement, that path or the empty string (a failed `mktemp` assigns nothing but the empty string). */
function valuesAt(name: string, at: At, vars: Vars): readonly string[] {
  const v = vars.get(name) ?? esc(`$${name} is not assigned in the command`);
  if (v.stmt === at.stmt && at.elem > 0) return v.values;
  if (v.stmt < at.stmt) return v.mktemp ? [...v.values, ''] : v.values;
  return esc(`$${name} is used before it is assigned`);
}

// ── words and paths ────────────────────────────────────────────────────────

const rootsOf = (ctx: ApprovalCtx): string[] =>
  [ctx.worktree, ctx.tmpRoot, ctx.scratch].filter((r): r is string => admissibleRoot(r, ctx.home));
const insideRoots = (p: string, ctx: ApprovalCtx, strict: boolean): boolean =>
  rootsOf(ctx).some((r) => (strict ? strictlyInside(p, r) : atOrInside(p, r)));
/** Any `.git` component, in any case (a case-insensitive filesystem reads `.GIT` as `.git`). */
const hasGit = (p: string): boolean => p.split('/').some((c) => c.toLowerCase() === '.git');
const wdKnown = (cwd: string | null, ctx: ApprovalCtx): cwd is string => cwd !== null && insideRoots(cwd, ctx, false);

/** A path's text from the working directory: absolute as it stands; relative only from a known directory inside a
 *  root. */
function resolvePath(text: string, cwd: string | null, ctx: ApprovalCtx): string {
  if (text.startsWith('/')) return path.posix.normalize(text).replace(/(.)\/$/, '$1');
  if (!wdKnown(cwd, ctx)) return esc('a relative path with no known working directory inside the roots');
  return path.posix.resolve(cwd, text);
}

interface Expanded { readonly text: string; readonly globs: readonly number[] }

/** Every value a word can take. A variable only at the very start, a `~` only at the very start, `*` anywhere (the
 *  caller decides whether a glob may stand), nothing else. */
function expandWord(w: Word, at: At, vars: Vars, ctx: ApprovalCtx): Expanded[] {
  let outs: { text: string; globs: number[] }[] = [{ text: '', globs: [] }];
  w.forEach((sg, idx) => {
    if (sg.k === 'mktemp') esc('a command substitution outside an assignment');
    if ((sg.k === 'var' || sg.k === 'tilde') && idx > 0) esc('an expansion after the start of a word');
    if (sg.k === 'var') { outs = valuesAt(sg.name, at, vars).map((v) => ({ text: v, globs: [] })); return; }
    const s = sg.k === 'tilde' ? (ctx.home ?? esc('no home for ~')) : sg.k === 'glob' ? '*' : sg.s;
    outs = outs.map((o) => ({
      text: o.text + s,
      globs: sg.k === 'glob' ? [...o.globs, o.text.length] : o.globs,
    }));
  });
  return outs;
}

/** D-5361: the credential match on what every word EXPANDS to, not only on the raw text, where quoting or a
 *  variable can split a path (`X=~/.s; cat "$X"sh/id_rsa`, `cat ~/'.ss'h/id_rsa`). */
function noCredential(c: Simple, at: At, vars: Vars, ctx: ApprovalCtx): void {
  for (const w of [...c.words.slice(1), ...c.redirs.flatMap((r) => (r.target === null ? [] : [r.target]))]) {
    for (const e of expandWord(w, at, vars, ctx)) if (CREDENTIAL_RE.test(e.text)) esc('a credential path');
  }
}

/** D-5360 round 6: the agent-instruction and hook files a target may never be, nor lie under, matched on every path
 *  component in any case: a child that writes or removes one changes what a later session is told or runs. It holds
 *  the forbidden class's `SENSITIVE_EDIT` names too (that class still catches `rm CLAUDE.md` first). `.git`, and so
 *  `.git/hooks/`, is `hasGit`'s. */
const AGENT_FILE_PARTS: ReadonlySet<string> = new Set(['claude.md', 'claude.local.md', 'agents.md', '.mcp.json', '.claude',
  '.husky', '.githooks', 'hooks', 'settings.json', 'settings.local.json', 'session-hook.sh',
  // round 7: other agents' instructions and plugin dirs, and the git files that change what git does in the tree.
  '.claude-plugin', 'gemini.md', '.cursor', '.cursorrules', 'copilot-instructions.md', '.gitattributes', '.gitmodules',
  // round 9: more agents' instruction files.
  'agent.md', '.windsurfrules', '.clinerules']);
const agentPath = (p: string): boolean => p.split('/').some((c) => AGENT_FILE_PARTS.has(c.toLowerCase()));
/** Whether an `rm` glob's leaf (its `*` the only wildcard) can match one of those names. A bare `*` is the directory's
 *  whole contents, the same lexical limit as `rm -rf <dir>` (which removes a `<dir>/CLAUDE.md` it cannot see), so
 *  only a leaf with a literal part (`*.md`, `CLAUDE*`, `hook*`) is judged: one that can match names it by shape. */
function globMatchesAgentFile(leaf: string): boolean {
  if (/^\*+$/.test(leaf)) return false;
  const re = new RegExp(`^${leaf.split('*').map(reEsc).join('.*')}$`, 'i');
  return [...AGENT_FILE_PARTS].some((n) => re.test(n));
}

/** A target that `rm`, `mkdir` or `touch` writes: strictly inside a root, never under `.git`, never an agent-instruction
 *  or hook file (`AGENT_FILE_PARTS`); a glob only in the last component (for `rm`), with its parent strictly inside a
 *  root and a leaf that can match neither `.git` nor one of those files. A whole-word `"$X"` that may be empty is
 *  harmless (`rm -rf ''` removes nothing). */
function checkTarget(w: Word, at: At, vars: Vars, ctx: ApprovalCtx, allowGlob: boolean): void {
  const wholeVar = w.length === 1 && w[0].k === 'var';
  for (const e of expandWord(w, at, vars, ctx)) {
    if (e.text === '') { if (wholeVar) continue; esc('an empty target'); }
    // D-5360 round 7: the kernel resolves a `..` from wherever the component before it really is, and an in-root
    // symlink that points inside the root (`server/node_modules/ccrc-agent -> ../../agent`) makes that differ from
    // the text. With no `..` in a write target, the text and the kernel agree except through a symlink that points
    // outside (the accepted limit). Literal, after a variable or leading: every `..` escalates.
    if (/(?:^|\/)\.\.(?:\/|$)/.test(e.text)) esc('a .. component in a write target');
    if (e.text.startsWith('-')) esc('a target that reads as an option');
    // D-5360 round 8: a target ending in `/` (or in a `/.` or `.` last component) follows a symlink to its target:
    // GNU `rm -rf ./link/` empties the directory the link points at, where `rm -rf ./link` only unlinks it.
    if (e.text.endsWith('/') || /(?:^|\/)\.$/.test(e.text)) esc('a target ending in / or /.');
    const lastSlash = e.text.lastIndexOf('/');
    if (e.globs.length > 0) {
      if (!allowGlob) esc('a glob in a target');
      if (e.globs.some((g) => g < lastSlash)) esc('a glob before the last path component');
      // round 7: a bare leaf `*…` with no directory can expand to a file named `-i`, read as an option.
      if (lastSlash < 0 && e.text.startsWith('*')) esc('a glob leaf that starts with * and has no ./ or directory');
      if (e.text.slice(lastSlash + 1).startsWith('.')) esc('a glob that can match .git');
      const parent = lastSlash < 0 ? '.' : (lastSlash === 0 ? '/' : e.text.slice(0, lastSlash));
      const pp = resolvePath(parent, ctx.cwd, ctx);
      if (!insideRoots(pp, ctx, true) || hasGit(pp)) esc('a glob whose parent is not strictly inside a root');
      if (agentPath(pp) || globMatchesAgentFile(e.text.slice(lastSlash + 1))) esc('a glob that can reach an agent-instruction or hook file');
      continue;
    }
    const p = resolvePath(e.text, ctx.cwd, ctx);
    if (!insideRoots(p, ctx, true)) esc('a target outside the roots');
    if (hasGit(p)) esc('a target under .git');
    if (agentPath(p)) esc('an agent-instruction or hook file');
  }
}

/** A command's options: `words` exactly; `letters` as one cluster (`-rf`). Nothing else that starts with `-` passes.
 *  `--` ends the options, and so does the first operand: an option-like word after it escalates (round 9). */
interface OptSpec {
  readonly words?: readonly string[];
  readonly letters?: string;
}

/** The operands, after every option word is matched against `spec`. */
function options(args: readonly Word[], spec: OptSpec, at: At, vars: Vars, ctx: ApprovalCtx): Word[] {
  const operands: Word[] = [];
  let dashdash = false;
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    const t = litText(w);
    // D-5360 round 9: options only before the first operand. BSD getopt (macOS rm, mkdir, touch) and GNU with
    // POSIXLY_CORRECT stop at the first operand, so a later `-p`, `-rf`, `--recursive` or `--` is a file name
    // resolved from the shell's real cwd, outside what this classifier resolves.
    if (operands.length > 0 && t !== null && (t === '--' || (t.length > 1 && t.startsWith('-')))) esc(`the option-like word ${t} after an operand`);
    if (!dashdash && t === '--') { dashdash = true; continue; }
    if (!dashdash && t !== null && t.length > 1 && t.startsWith('-')) {
      if (spec.words?.includes(t)) continue;
      if (spec.letters !== undefined && /^-[A-Za-z0-9]+$/.test(t) && [...t.slice(1)].every((ch) => spec.letters!.includes(ch))) continue;
      esc(`the option ${t}`);
    }
    if (!dashdash && t === null) for (const e of expandWord(w, at, vars, ctx)) if (e.text.startsWith('-')) esc('an expansion that reads as an option');
    operands.push(w);
  }
  return operands;
}

// ── the commands ───────────────────────────────────────────────────────────

/** The write commands of the grammar and their option words (D-5360 round 6: the measured cleanup writes only). */
const WRITES: Readonly<Record<string, OptSpec>> = {
  rm: { letters: 'rRf', words: ['--recursive', '--force'] },
  mkdir: { letters: 'p', words: ['--parents'] },
  touch: {},
};

/** The command word: one unquoted literal (a quoted or path-qualified name is not the grammar's). */
function commandName(w: Word): string {
  return w.length === 1 && w[0].k === 'lit' && !w[0].q ? w[0].s : esc('a command word that is not a plain name');
}

/** D-5360 round 6: the only redirects are `>/dev/null`, `2>/dev/null`, `&>/dev/null` and `2>&1`. */
function checkRedirs(c: Simple): void {
  for (const r of c.redirs) {
    if (r.target === null) continue;                                           // 2>&1
    if (litText(r.target) !== '/dev/null') esc('a redirect to anything but /dev/null');
  }
}

/** One simple command. Every read or inspection command escalates (D-5360 round 6), and so does every directory
 *  change (round 8): only the writes, an assignment, `true` and `:` are shapes. */
function simpleCommand(c: Simple, at: At, vars: Vars, ctx: ApprovalCtx): void {
  checkRedirs(c);
  if (c.assign !== null) return;                                              // judged by collectVars
  noCredential(c, at, vars, ctx);
  const name = commandName(c.words[0]);
  const args = c.words.slice(1);
  if (Object.prototype.hasOwnProperty.call(WRITES, name)) {
    const targets = options(args, WRITES[name], at, vars, ctx);
    if (targets.length === 0) esc(`${name} with no target`);
    for (const t of targets) checkTarget(t, at, vars, ctx, name === 'rm');
    return;
  }
  // D-5360 round 8: `cd`, `pushd` and `popd` are no shape. bash's `cd -L` falls back to a physical chdir when its
  // logical target is gone, and an earlier `rm` in the same statement can remove the in-root symlink the logical path
  // ran through (round 7's verifier: bash then ran two levels above where the text said, at `$HOME`). Every target
  // resolves from the request's trusted `cwd` only.
  if (name === 'cd' || name === 'pushd' || name === 'popd') esc(`${name}: a directory change is no shape`);
  if (name === 'true' || name === ':') {
    if (args.length) esc(`${name} with operands`);
    return;
  }
  esc(`the command ${name}: a read, an inspection or anything else outside the cleanup writes`);
}

/** The whole script: every statement, every element, in order. No element changes the working directory (round 8), so
 *  every relative target resolves from the request's `cwd`. */
function walk(script: readonly AndOr[], vars: Vars, ctx: ApprovalCtx): void {
  script.forEach((ao, stmt) => ao.cmds.forEach((c, elem) => simpleCommand(c, { stmt, elem }, vars, ctx)));
}

// ── the classifier ─────────────────────────────────────────────────────────

/** One request's class (spec §6.5). Default escalate: only a Bash command every token of which is one of the strict
 *  grammar's enumerated shapes (D-5360), inside the child's own roots, is `ordinary`. */
export function approvalClass(tool: string, input: Record<string, unknown>, rawCtx: ApprovalCtx): ApprovalClass {
  // D-5299: no regex runs on a request longer than the stored cap; it goes to the operator unread.
  if (stringLeaves(input).reduce((n, s) => n + s.length, 0) > APPROVAL_INPUT_MAX_BYTES) return 'escalate';
  if (tool !== 'Bash') return nonBashClass(tool, input);
  const command = input.command;
  if (typeof command !== 'string') return 'escalate';
  if (Buffer.byteLength(command, 'utf8') > APPROVAL_INPUT_MAX_BYTES) return 'escalate';
  if (isForbiddenText(command)) return 'forbidden';
  // D-5360 round 8: any non-ASCII character anywhere in the request escalates. macOS /bin/bash 3.2 reads a byte that
  // isalnum() accepts in a UTF-8 or Latin-1 locale as part of a `$NAME` (`"$Xú/etc"` expands an unset `$Xú`), and a
  // case-insensitive filesystem folds `ſ` to `s` (`AGENTſ.md` opens `AGENTS.md`).
  if (stringLeaves(input).some((s) => NON_ASCII.test(s))) return 'escalate';
  if (CREDENTIAL_RE.test(command)) return 'escalate';
  // D-5299: a cwd that is not absolute and normal is no known directory (`<wt>/../..` passed the prefix test).
  const ctx: ApprovalCtx = { ...rawCtx, cwd: rawCtx.cwd !== null && isAbsNormal(rawCtx.cwd) ? rawCtx.cwd : null };
  if (command.includes('\0')) return 'escalate';                                // bash cannot be handed a NUL
  try {
    const script = parse(lex(command));
    walk(script, collectVars(script, ctx), ctx);
    return 'ordinary';
  } catch {
    return 'escalate';                                                         // every doubt goes to the operator
  }
}
