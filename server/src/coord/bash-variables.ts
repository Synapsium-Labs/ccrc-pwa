/**
 * BASH'S OWN VARIABLES (D-5360, coordinator-first routing plan §Deviations found). Pure data.
 *
 * The approval classifier's strict grammar (`approvalguard.ts`) lets a command assign and use a variable only when
 * the name is the command's own: not one bash gives a meaning to, and not one the grammar's programs read from the
 * environment. Rounds 1 and 2 of the review each found a bash variable the hand-written list missed (`IFS`, `CDPATH`,
 * then `FUNCNAME`, `DIRSTACK`, `GROUPS`, which ignore an assignment and expand to something else), so this list is
 * not written from memory but from bash and its manual:
 *   - `BASH_STARTUP_VARIABLES`: exactly what `env -i bash --norc --noprofile -c 'compgen -v'` prints on bash 5.3.20.
 *     `approvalguard.test.ts` runs every bash on `PATH` the same way and fails when one prints a name that is not
 *     on `BASH_VARIABLES`, so a newer bash's variable cannot slip past unnoticed.
 *   - `BASH_DOCUMENTED_VARIABLES`: the bash 5.3 reference manual's "Bourne Shell Variables" (§5.1) and "Bash
 *     Variables" (§5.2), which include the ones `compgen -v` does not print because they are unset at startup
 *     (`FUNCNAME`, `BASH_REMATCH`, `COPROC`, `REPLY`, `TMPDIR`, …).
 *   - `ENV_VARIABLES` and `ENV_VARIABLE_FAMILIES`: names that bash leaves alone but that a program the grammar runs
 *     (`rm`, `mkdir`, `touch`, `mktemp`, `ls`, `cat`, `grep`, `find`, `git`, …), or the C library under it, reads
 *     from an already-exported variable: assigning one changes what a LATER command in the same request does.
 * POSIX's special parameters (`POSIX_SPECIAL_PARAMETERS`) are not names at all; the grammar's lexer refuses every
 * `$` that is not followed by a name.
 */

/** `env -i bash --norc --noprofile -c 'compgen -v'`, bash 5.3.20 (2026-10-17). */
export const BASH_STARTUP_VARIABLES: readonly string[] = (
  'BASH BASHOPTS BASHPID BASH_ALIASES BASH_ARGC BASH_ARGV BASH_ARGV0 BASH_CMDS BASH_COMMAND BASH_EXECUTION_STRING '
  + 'BASH_LINENO BASH_LOADABLES_PATH BASH_MONOSECONDS BASH_SOURCE BASH_SUBSHELL BASH_VERSINFO BASH_VERSION '
  + 'COMP_WORDBREAKS DIRSTACK EPOCHREALTIME EPOCHSECONDS EUID GROUPS HISTCMD HOSTNAME HOSTTYPE IFS LINENO MACHTYPE '
  + 'OPTERR OPTIND OSTYPE PATH PPID PS4 PWD RANDOM SECONDS SHELL SHELLOPTS SHLVL SRANDOM TERM UID _'
).split(' ');

/** The bash 5.3 manual's §5.1 "Bourne Shell Variables" and §5.2 "Bash Variables". */
export const BASH_DOCUMENTED_VARIABLES: readonly string[] = (
  // §5.1
  'CDPATH HOME IFS MAIL MAILPATH OPTARG OPTIND PATH PS1 PS2 '
  // §5.2
  + '_ BASH BASHOPTS BASHPID BASH_ALIASES BASH_ARGC BASH_ARGV BASH_ARGV0 BASH_CMDS BASH_COMMAND BASH_COMPAT BASH_ENV '
  + 'BASH_EXECUTION_STRING BASH_LINENO BASH_LOADABLES_PATH BASH_MONOSECONDS BASH_REMATCH BASH_SOURCE BASH_SUBSHELL '
  + 'BASH_TRAPSIG BASH_VERSINFO BASH_VERSION BASH_XTRACEFD CHILD_MAX COLUMNS COMP_CWORD COMP_KEY COMP_LINE COMP_POINT '
  + 'COMP_TYPE COMP_WORDBREAKS COMP_WORDS COMPREPLY COPROC DIRSTACK EMACS ENV EPOCHREALTIME EPOCHSECONDS EUID '
  + 'EXECIGNORE FCEDIT FIGNORE FUNCNAME FUNCNEST GLOBIGNORE GLOBSORT GROUPS histchars HISTCMD HISTCONTROL HISTFILE '
  + 'HISTFILESIZE HISTIGNORE HISTSIZE HISTTIMEFORMAT HOSTFILE HOSTNAME HOSTTYPE IGNOREEOF INPUTRC INSIDE_EMACS LANG '
  + 'LC_ALL LC_COLLATE LC_CTYPE LC_MESSAGES LC_NUMERIC LC_TIME LINENO LINES MACHTYPE MAILCHECK MAPFILE OLDPWD OPTERR '
  + 'OSTYPE PIPESTATUS POSIXLY_CORRECT PPID PROMPT_COMMAND PROMPT_DIRTRIM PS0 PS3 PS4 PWD RANDOM READLINE_ARGUMENT '
  + 'READLINE_LINE READLINE_MARK READLINE_POINT REPLY SECONDS SHELL SHELLOPTS SHLVL SRANDOM TIMEFORMAT TMOUT TMPDIR '
  + 'UID auto_resume TERM'
).split(' ');

/** Read from the environment by a program the grammar runs, or by the C library under it. */
export const ENV_VARIABLES: readonly string[] = (
  'TMP TEMP TEMPDIR TZ LANGUAGE NLSPATH LOCPATH GCONV_PATH HOSTALIASES RES_OPTIONS LOCALDOMAIN USER LOGNAME '
  + 'PAGER EDITOR VISUAL LESS LESSOPEN LESSCLOSE LESSKEY MORE MANPAGER BLOCKSIZE BLOCK_SIZE DF_BLOCK_SIZE '
  + 'DU_BLOCK_SIZE LS_BLOCK_SIZE TIME_STYLE QUOTING_STYLE LS_COLORS LSCOLORS CLICOLOR CLICOLOR_FORCE COLORTERM '
  + 'GREP_OPTIONS GREP_COLOR GREP_COLORS TABSIZE SIMPLE_BACKUP_SUFFIX VERSION_CONTROL POSIX_ME_HARDER '
  + 'SSH_ASKPASS SSH_AUTH_SOCK GPG_TTY GNUPGHOME EMAIL PREFIX'
).split(' ');

/** Whole families: bash's own prefixes, and the loader's, git's, the locale's, XDG's and the allocator's. */
export const ENV_VARIABLE_FAMILIES = /^(?:BASH|COMP|HIST|READLINE_|LC_|LD_|DYLD_|GIT_|XDG_|MALLOC_|GLIBC_|GREP_|LESS|SSH_|GPG|GNUPG|_)/;

/** POSIX's special parameters (`$*`, `$@`, `$#`, `$?`, `$-`, `$$`, `$!`, `$0`) and the positional ones. */
export const POSIX_SPECIAL_PARAMETERS: readonly string[] = '* @ # ? - $ ! 0 1 2 3 4 5 6 7 8 9'.split(' ');

/** D-5360 round 7, DEFENCE IN DEPTH: the grammar is bash's (a child's Bash tool runs bash, plan Task 15), but a zsh
 *  child would give these names a meaning (`path=./bin` reorders the command search, `cdpath=/` moves a `cd`). The
 *  startup set is exactly what `env -i zsh -f -c 'print -l ${(k)parameters}'` prints on zsh 5.9, less POSIX's special
 *  parameters; `approvalguard.test.ts` runs every zsh on `PATH` the same way. */
export const ZSH_STARTUP_VARIABLES: readonly string[] = (
  'aliases ARGC argv builtins cdpath CDPATH COLUMNS commands CPUTYPE dirstack dis_aliases dis_builtins dis_functions '
  + 'dis_functions_source dis_galiases dis_patchars dis_reswords dis_saliases EGID EUID fignore FIGNORE fpath FPATH '
  + 'funcfiletrace FUNCNEST funcsourcetrace funcstack functions functions_source functrace galiases GID histchars '
  + 'HISTCHARS HISTCMD history historywords HISTSIZE HOME HOST IFS jobdirs jobstates jobtexts KEYBOARD_HACK keymaps '
  + 'KEYTIMEOUT LINENO LINES LISTMAX LOGNAME MACHTYPE MAILCHECK mailpath MAILPATH manpath MANPATH module_path '
  + 'MODULE_PATH modules nameddirs NULLCMD OLDPWD OPTARG OPTIND options OSTYPE parameters patchars path PATH '
  + 'pipestatus PPID prompt PROMPT PROMPT2 PROMPT3 PROMPT4 PS1 PS2 PS3 PS4 psvar PSVAR PWD RANDOM READNULLCMD reswords '
  + 'saliases SAVEHIST SECONDS SHLVL signals SPROMPT status termcap terminfo TIMEFMT TMPPREFIX TRY_BLOCK_ERROR '
  + 'TRY_BLOCK_INTERRUPT TTY TTYIDLE UID userdirs usergroups USERNAME VENDOR watch WATCH widgets WORDCHARS ZSH_ARGZERO '
  + 'zsh_eval_context ZSH_EVAL_CONTEXT ZSH_EXECUTION_STRING ZSH_NAME ZSH_PATCHLEVEL zsh_scheduled_events ZSH_SUBSHELL '
  + 'ZSH_VERSION'
).split(' ');

/** zsh 5.9's `zshparam(1)` names that are unset at startup, so `${(k)parameters}` does not print them. */
export const ZSH_DOCUMENTED_VARIABLES: readonly string[] = (
  'ZDOTDIR STTY TMOUT REPORTTIME REPORTMEMORY ZBEEP POSTEDIT PROMPT_EOL_MARK PERIOD DIRSTACKSIZE HISTFILE BAUD '
  + 'TERMINFO TERMINFO_DIRS match mbegin mend MATCH MBEGIN MEND reply REPLY RPS1 RPS2 RPROMPT RPROMPT2 SAVEHIST '
  + 'ERRNO CORRECT_IGNORE CORRECT_IGNORE_FILE'
).split(' ');

/** zsh's own prefixes. */
export const ZSH_VARIABLE_FAMILIES = /^(?:ZSH_|ZLE_|zsh_|ZDOT)/;

/** Every name bash itself defines or documents: the startup set and the manual's two sections, one set; and, since
 *  round 7, zsh's. */
export const BASH_VARIABLES: ReadonlySet<string> = new Set([...BASH_STARTUP_VARIABLES, ...BASH_DOCUMENTED_VARIABLES]);
export const ZSH_VARIABLES: ReadonlySet<string> = new Set([...ZSH_STARTUP_VARIABLES, ...ZSH_DOCUMENTED_VARIABLES]);

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Whether `name` may be a command's own variable (D-5360): a shell name that is neither bash's nor zsh's (by the
 *  lists above or by one of their prefixes) nor one a program the grammar runs reads from the environment. */
export function isUserVariable(name: string): boolean {
  return NAME.test(name) && !BASH_VARIABLES.has(name) && !ENV_VARIABLES.includes(name) && !ENV_VARIABLE_FAMILIES.test(name)
    && !ZSH_VARIABLES.has(name) && !ZSH_VARIABLE_FAMILIES.test(name);
}
