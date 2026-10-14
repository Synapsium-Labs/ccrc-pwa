#!@CCRC_PYTHON3@ -IS
# ccd — the INSTALLED DIRECT ENTRY (reclaim-entry-safety, D-3696).
#
# GENERATED ON THE BOX from the tracked template ccd/ccd-entry.py by `ccrc
# install`/`ccrc update` and by deploy/deploy.sh: the shebang names the box's own
# python3 — the PATH path when it is the interpreter probed in isolated mode,
# else its canonical path (D-3698) — and the digest below is the SHA-256 of the
# active Bash body at ~/.local/libexec/ccrc/ccd. Do not edit on the box.
#
# WHY A LAUNCHER AT ALL. Bash startup runs before line 1 of any Bash file: an
# inherited `BASH_ENV`, an exported `BASH_FUNC_<name>%%` or an inherited
# `SHELLOPTS`/`BASHOPTS` is consumed before ccd can guard anything, and an
# imported `find` that answers "no rows" turned R31's honest
# `containment-unproven` into `reclaimable` — a live child another registry row
# names, removed (D-3696). So the destructive argv shapes are decided HERE,
# before Bash exists, and started under `bash -p`: privileged mode reads no
# `BASH_ENV`/`ENV`, imports no function and ignores inherited
# `SHELLOPTS`/`BASHOPTS`/`CDPATH`/`GLOBIGNORE`. It is a startup boundary, not a
# privilege change, and not a sandbox.
#
# WHAT IS PROTECTED (the body re-classifies the exact shapes — plus whatever an
# inherited `nocasematch` folds — and a test runs one table against both):
#   ws-reclaim <any tail>                         — the body's parser owns the tail
#   ws-expire <any tail>                          — likewise (workspace lifecycle wave 3: the
#     server-composed teardown of an archived workspace, ws-reclaim's sibling)
#   ws-collect <any tail>                         — likewise (child reclamation wave 7: the
#     collector of a witnessed child temp root whose workspace is gone)
#   ws-audit --session <value> --reclaim [--defer-expired] — the token skeleton;
#   ws-audit --session <value> --expire           — the expiry's token skeleton;
#   ws-audit --session <value> --collect          — the collector's token skeleton;
#     <value> is any string here, and the body still validates it as a session id
# Each of those tokens is matched WITHOUT CASE, a deliberate superset: an inherited
# `nocasematch` folds the body's own entry guard and dispatcher (in a UTF-8 locale
# beyond ASCII: `İ` folds to `i`), so a case variant must start protected too,
# where `bash -p` drops that option and the body compares exactly again. An ASCII
# character is compared without case and any other character stands for any one
# character, counted in code points and in bytes, so no locale's fold escapes it.
# Protecting more than the body would is harmless: it only starts under `-p`.
# Every other argv is ORDINARY: the same Bash >= 4.4 scan, no `-p`, and the
# payload started with the environment this Python inherited, changed only by
# what Python's own startup adds before this file runs (D-3701): `LC_CTYPE` for
# a caller in the C or POSIX locale (PEP 538), and on Darwin
# `__CF_USER_TEXT_ENCODING` for every caller. Only the scan's PROBE runs
# startup-free (D-3702), so a caller's printing `BASH_ENV` cannot stop ccd
# starting at all.
#
# TRUST BOUNDARY. Runtime PATH and every executable it selects — this Python,
# the Bash below, and every external command ccd runs — are TRUSTED
# PREREQUISITES. Nothing here authenticates them: a PATH that leads to a lying
# `bash` or `find` is outside what this file claims to defeat. The digest is
# not authentication either: it detects a half-published or mismatched
# launcher/body pair; a same-user writer that replaces both files is not
# stopped by it, and the window between hashing the body and Bash opening it
# is not closed.
#
# STANDARD LIBRARY ONLY, and the shebang's `-IS` is load-bearing: isolated mode
# ignores every PYTHON* variable, user site-packages and the current directory,
# and `-S` imports no `site` (so no `sitecustomize` either). No bytecode is
# written: this file runs as `__main__`, which is never cached.
import sys

sys.dont_write_bytecode = True

import hashlib  # noqa: E402
import hmac  # noqa: E402
import os  # noqa: E402
import select  # noqa: E402
import stat  # noqa: E402
import subprocess  # noqa: E402
import time  # noqa: E402

BODY_SHA256 = '@CCRC_CCD_SHA256@'

ENTRY_SUFFIX = '/.local/bin/ccd'
BODY_SUFFIX = '/.local/libexec/ccrc/ccd'

# The launcher's own refusal: one stable class word per condition, on stderr as
# `ccd: refused (entry-<class>): …`, and this exit status. Nothing ran.
REFUSED_RC = 125

# What Bash startup consumes from the environment, removed from the ONE
# environment a PROTECTED start uses for both its probe and its payload (D-3696,
# as tightened): `bash -p` ignores these for itself, but measured on bash 5.2 it
# still EXPORTS them — an imported-function string, `BASH_ENV`, `CDPATH` — to
# every child it starts, and an ordinary child Bash (a trusted PATH tool that is
# a Bash script) would consume them. `BASH_FUNC_` is matched as a PREFIX, so
# every exported-function spelling (`name%%`, the older `name()`) goes. An
# ORDINARY start's payload keeps its original environment, apart from D-3701's
# additions by Python's startup; its probe runs without these too (D-3702),
# because the probe's answer is one exact printed record, and a `BASH_ENV` that
# prints or an exported `printf` would otherwise refuse every ordinary verb as
# `entry-no-bash` — a cause it does not name.
#
# AND THE VARIABLES `bash -p` STILL HONOURS FROM THE ENVIRONMENT (D-3700,
# measured on bash 5.2): POSIXLY_CORRECT turns on posix mode, BASH_COMPAT a
# compat level, TMOUT=1 makes a `while read … < <(slow)` loop read nothing,
# FUNCNEST aborts the script mid-act, SECONDS rebases the clock, and
# BASH_XTRACEFD redirects the trace. Four more go AS A PRECAUTION, not against a
# measured effect: bash 5.2 applies neither an inherited GLOBIGNORE nor an
# inherited EXECIGNORE (it still exports both to every child), GLOBSORT is a
# Bash 5.3 variable, and BASH_LOADABLES_PATH is read only by `enable -f`.
STARTUP_VARS = (b'BASH_ENV', b'ENV', b'SHELLOPTS', b'BASHOPTS', b'CDPATH', b'GLOBIGNORE',
                b'POSIXLY_CORRECT', b'BASH_COMPAT', b'TMOUT', b'FUNCNEST', b'SECONDS', b'BASH_XTRACEFD',
                b'EXECIGNORE', b'GLOBSORT', b'BASH_LOADABLES_PATH')
FUNC_PREFIX = b'BASH_FUNC_'

# The one argv this file answers itself instead of passing to ccd: the
# installer's pre-publication self-test. No ccd verb is spelled like it.
SELFTEST_ARGV = '--ccrc-entry-self-test'

PROBE_TIMEOUT_S = 10.0
PROBE_MAX_BYTES = 256

# BUILTINS ONLY: `[[`, `((` and `printf`. A probe that ran an external command
# would be asking PATH a second question. Each prints its record only when the
# property holds, so a candidate that cannot satisfy it prints nothing.
_FLOOR = '(( BASH_VERSINFO[0] > 4 || ( BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4 ) ))'
PROBE_PRIVILEGED = '[[ $- == *p* ]] && ' + _FLOOR + ' && printf "ccd-entry-probe p %s\\n" "$1"'
PROBE_ORDINARY = _FLOOR + ' && printf "ccd-entry-probe - %s\\n" "$1"'


def refuse(cls, detail):
    # The STATUS is the contract; the message is best-effort. A caller that
    # closed stderr still gets 125, never a traceback's exit 1.
    try:
        sys.stderr.write('ccd: refused (entry-%s): %s\n' % (cls, detail))
        sys.stderr.flush()
    except Exception:
        pass
    os._exit(REFUSED_RC)


def folds_to(token, word):
    # True when `token` may BE `word` (lower-case ASCII) under a case-insensitive
    # match in any locale the body could inherit. An ASCII character compares
    # without case; any other character is a wildcard for one character of
    # `word`. Counted twice: in code points, as a multibyte locale reads the
    # token (U+0130 folds to `i` there, measured on bash 5.2 in C.UTF-8), and in
    # bytes, as a single-byte locale does.
    for units in (token, os.fsencode(token).decode('latin-1')):
        if len(units) == len(word) and all(ord(u) > 127 or u.lower() == w for u, w in zip(units, word)):
            return True
    return False


def is_protected(argv):
    # CASE-INSENSITIVE, A SUPERSET ON PURPOSE — see WHAT IS PROTECTED above.
    if argv[:1] and any(folds_to(argv[0], verb) for verb in ('ws-reclaim', 'ws-expire', 'ws-collect')):
        return True
    if len(argv) == 4 and folds_to(argv[0], 'ws-audit') and folds_to(argv[1], '--session') \
            and (folds_to(argv[3], '--expire') or folds_to(argv[3], '--collect')):
        return True
    return (len(argv) in (4, 5) and folds_to(argv[0], 'ws-audit') and folds_to(argv[1], '--session')
            and folds_to(argv[3], '--reclaim') and (len(argv) == 4 or folds_to(argv[4], '--defer-expired')))


def body_path():
    # The launcher's OWN location, never an inherited HOME: its CANONICAL path
    # first, so absolute, relative, PATH and symlinked spellings converge; then,
    # when ~/.local or ~/.local/bin is itself a link (the canonical path then
    # carries no `.local/bin`), the path the kernel was handed (D-3699). A copy
    # or a hard link anywhere else names no body, so it refuses rather than
    # guessing one — and whichever path names it, the body still has to match
    # the digest below.
    given = os.path.abspath(sys.argv[0])
    for me in (os.path.realpath(given), given):
        if me.endswith(ENTRY_SUFFIX):
            return me[:-len(ENTRY_SUFFIX)] + BODY_SUFFIX
    refuse('layout', '%s is not an installed direct entry (…%s), so it names no ccd body to run'
           % (os.path.realpath(given), ENTRY_SUFFIX))


def check_body(body):
    if len(BODY_SHA256) != 64 or any(c not in '0123456789abcdef' for c in BODY_SHA256):
        refuse('unrendered', 'this launcher carries no rendered body digest — it is the template, not an install')
    try:
        st = os.lstat(body)
    except FileNotFoundError:
        refuse('body-absent', 'the ccd body %s is absent — re-run ccrc update (or ccrc install)' % body)
    except OSError as e:
        refuse('body-unreadable', 'the ccd body %s could not be examined: %s' % (body, e.strerror))
    if not stat.S_ISREG(st.st_mode):
        refuse('body-type', 'the ccd body %s is not a regular file (a link, a directory or a device is never run)'
               % body)
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_CLOEXEC', 0) | getattr(os, 'O_NONBLOCK', 0)
    digest = hashlib.sha256()
    try:
        fd = os.open(body, flags)
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                refuse('body-type', 'the ccd body %s is not a regular file' % body)
            while True:
                chunk = os.read(fd, 1 << 16)
                if not chunk:
                    break
                digest.update(chunk)
        finally:
            os.close(fd)
    except OSError as e:
        refuse('body-unreadable', 'the ccd body %s could not be read: %s' % (body, e.strerror))
    if not hmac.compare_digest(digest.hexdigest(), BODY_SHA256):
        refuse('body-digest', 'the ccd body %s is not the one this launcher was rendered for — an install or'
               ' update is incomplete; re-run ccrc update (or ccrc install)' % body)


def startup_free_env():
    return {k: v for k, v in os.environb.items() if k not in STARTUP_VARS and not k.startswith(FUNC_PREFIX)}


def probe(bash, privileged, env):
    nonce = os.urandom(16).hex()
    argv = [bash] + (['-p'] if privileged else []) + ['-c', PROBE_PRIVILEGED if privileged else PROBE_ORDINARY,
                                                      'ccd-entry-probe', nonce]
    want = ('ccd-entry-probe %s %s\n' % ('p' if privileged else '-', nonce)).encode()
    try:
        proc = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, env=env, close_fds=True)
    except OSError:
        return False
    out = b''
    ok = True
    deadline = time.monotonic() + PROBE_TIMEOUT_S
    fd = proc.stdout.fileno()
    while True:
        left = deadline - time.monotonic()
        if left <= 0:
            ok = False
            break
        ready, _, _ = select.select([fd], [], [], left)
        if not ready:
            ok = False
            break
        chunk = os.read(fd, 4096)
        if not chunk:
            break
        out += chunk
        if len(out) > PROBE_MAX_BYTES:
            ok = False
            break
    if not ok:
        proc.kill()
    try:
        rc = proc.wait(timeout=PROBE_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        proc.kill()
        rc = proc.wait()
    proc.stdout.close()
    return ok and rc == 0 and out == want


def select_bash(privileged, env):
    # PATH IN ORDER, every distinct canonical `<dir>/bash`, the first one whose
    # PROBE proves the property — and that exact path is the one exec'd. Never
    # the first `bash` by name: a macOS job PATH puts /bin/bash 3.2 ahead of a
    # Homebrew 5.x.
    seen = set()
    for comp in os.environ.get('PATH', '').split(os.pathsep):
        if not comp or not os.path.isabs(comp):
            continue
        cand = os.path.realpath(os.path.join(comp, 'bash'))
        if cand in seen:
            continue
        seen.add(cand)
        if not (os.path.isfile(cand) and os.access(cand, os.X_OK)):
            continue
        if probe(cand, privileged, env):
            return cand
    return None


def main():
    argv = sys.argv[1:]
    body = body_path()
    check_body(body)
    if argv == [SELFTEST_ARGV]:
        # THE INSTALLER'S PRE-PUBLICATION KERNEL SELF-TEST (ccd-entry-install.py):
        # the layout derived and the body's digest matched above; report the
        # flags this kernel's reading of the shebang produced, and start nothing.
        f = sys.flags
        sys.stdout.write('ccd-entry-self-test %d %d %d %d %d\n'
                         % (sys.version_info[0], f.isolated, f.ignore_environment, f.no_user_site, f.no_site))
        return
    protected = is_protected(argv)
    # `os.environb` already carries Python's PEP 538 locale coercion: under a C
    # or POSIX LC_CTYPE, isolated-mode Python sets LC_CTYPE to a UTF-8 locale
    # before this file runs, so every start below inherits it; on Darwin it
    # also carries `__CF_USER_TEXT_ENCODING`, added for every caller (D-3701).
    clean = startup_free_env()
    env = clean if protected else os.environb
    bash = select_bash(protected, clean)
    if bash is None:
        refuse('no-bash', 'no bash on PATH proved Bash >= 4.4%s — ccd was not started'
               % (' in privileged mode (-p)' if protected else ''))
    os.execve(bash, [bash] + (['-p'] if protected else []) + ['--', body] + argv, env)


if __name__ == '__main__':
    try:
        main()
    except OSError as e:
        refuse('exec', 'ccd could not be started: %s' % e)
