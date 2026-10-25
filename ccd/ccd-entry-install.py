# ccd-entry-install.py — renders, self-tests and publishes the direct-entry PAIR
# (reclaim-entry-safety, D-3696): the Bash body at ~/.local/libexec/ccrc/ccd
# and the Python launcher at ~/.local/bin/ccd rendered from ccd/ccd-entry.py.
#
# ONE program for both install lanes — `ccrc install`/`ccrc update`
# (`_inst_ccd_pair` in ccd/ccrc) and the fallback deploy (deploy/deploy.sh, on
# the destination box) — so neither lane can grow its own idea of what a
# complete pair is. It runs FROM THE SHIPPED TREE, never from PATH, and only
# under the box's own canonical python3 in isolated mode:
#
#     <canonical python3> -IS <tree>/ccd/ccd-entry-install.py check
#     <canonical python3> -IS <tree>/ccd/ccd-entry-install.py install <tree> <home>
#
# `check` is the preflight a lane runs BEFORE it mutates anything: this
# interpreter is Python 3, isolated, environment-free, user-site-free and
# site-free, and the path its shebang will name (`shebang_path`: the PATH
# python3 when it IS this interpreter, else its canonical path — D-3698) can be
# a shebang (absolute, no whitespace or line break, the whole line within
# SHEBANG_MAX bytes). It prints that path.
#
# `install` re-checks all of that, then: renders the launcher with that same
# shebang path — the PATH python3's spelling when it resolves to this
# interpreter, else the canonical path (D-3698) — and the body's SHA-256
# (placeholder census before and after, compiled in memory, no bytecode
# written); asks every refusal a destination or the layout can raise BEFORE it
# creates, repairs or stages anything; stages each changed half as a sibling
# temporary of its destination; runs the launcher-to-be through the kernel in a
# throwaway copy of the final layout and requires its isolated flags record —
# on every run, a converged one included; and only then repairs a half whose
# bytes are right and whose mode is not, and publishes the body FIRST and the
# launcher LAST, each by one rename whose destination entry is inspected
# without following it beforehand and re-measured afterwards. A half already
# carrying the exact bytes and mode is left alone, so a converged box rewrites
# nothing.
#
# EXIT STATUS: 0 the pair is in place (published or already converged); 1
# refused, and no active file moved — neither half was replaced. That is all
# exit 1 proves: by the self-test, `~/.local/bin` and `~/.local/libexec/ccrc`
# may already have been created and this installer's own leftovers swept, and
# a refusal after it can follow an in-place mode repair of either half; 2 a
# half moved and the run failed before it reported a verified pair, and stderr
# names what moved and the state it left. A half whose re-measurement after its
# rename failed is UNVERIFIED: what stands there may start ccd or refuse. When
# the body moved and the launcher did not, and the launcher is not proved to
# carry this run's bytes and mode, what stands at ~/.local/bin/ccd may refuse
# every start (by digest, when it is an earlier launcher) or run an entry this
# run never verified. When every half that moved re-measured and the launcher
# carries what this run self-tested, only the run's own report failed after
# that (a closed stdout) and the pair stands as staged. Every way, a re-run
# converges the pair. No rollback is attempted across the two directories.
#
# A FAILING RUN KEEPS ITS STATUS. Once its stderr is written, an exit-1 or
# exit-2 run points fd 1 at /dev/null (`quiet_stdout`), so a report still
# buffered for a stdout whose reader has gone cannot fail Python's shutdown
# flush a second time — which would replace the status with 120.
#
# THE LIBRARY (D-6913, GitHub #1279). The body loads one more file,
# `lib/disk-retention.sh`, from the `lib/` directory beside it, and pins that
# file's SHA-256 in its own text (`__CCD_LIB_SHA256`). Like the body's stamp,
# the pin is written HERE, at install time, never committed: the committed
# line is the fixed placeholder `__CCD_LIB_SHA256=stamp-at-install`, and
# `render_lib_pin` writes the digest of the library this run publishes into
# the body BEFORE `stamp_body` stamps it, so the stamp (and the launcher's
# digest of the stamped bytes) covers the pin. The body skips its check only
# when BOTH placeholders still stand (a source checkout), which no body
# installed here can be. `install` publishes the library FIRST, by the same
# stage-and-rename as the body, and refuses a tree whose rendered pin is not
# the library it publishes BEFORE anything moves: a body published
# ahead of a library it cannot verify would refuse every ccd start. A body that
# stands from before the library existed does not read it, so publishing it first
# changes nothing for a ccd start until the new body lands. A standing body that
# already loads a library pins ITS digest: once a different library is renamed in,
# that body refuses every start (lib-digest) until the new body lands, so a run
# that stops between the two leaves ccd refusing until a re-run converges the pair
# or the previous library is restored (ccrc update's backup carries it as
# ccd-lib-disk-retention.sh).
#
# The library must end in exactly one newline and carry no NUL byte. The body
# hashes the file as bash reads it (`$(<file)` drops NULs and every trailing
# newline; the body adds one back), while this publisher hashes the raw bytes:
# only such a file reads as the same bytes to both, so any other file is
# refused here before anything moves.
#
# STANDARD LIBRARY ONLY. Nothing here trusts the environment: `-I` already
# ignores every PYTHON* variable, and the paths it writes come from argv.
import sys

sys.dont_write_bytecode = True

import hashlib  # noqa: E402
import os  # noqa: E402
import re  # noqa: E402
import shutil  # noqa: E402
import stat  # noqa: E402
import subprocess  # noqa: E402
import tempfile  # noqa: E402

# The whole first line, `#!<python> -IS`, without its newline. 127 is the bound
# Linux kernels before 5.1 enforced (BINPRM_BUF_SIZE 128, newline included),
# well under 5.1+'s 256 and Darwin's 512 — the conservative bound that holds on
# every supported kernel.
SHEBANG_MAX = 127
SHEBANG_FLAGS = ' -IS'

LIB_PIN = re.compile(rb'^__CCD_LIB_SHA256=([0-9a-f]{64})$', re.M)
LIB_PIN_PLACEHOLDER = re.compile(rb'^__CCD_LIB_SHA256=stamp-at-install$', re.M)
PLACEHOLDER_PYTHON = '@CCRC_' + 'PYTHON3@'
PLACEHOLDER_DIGEST = '@CCRC_' + 'CCD_SHA256@'
RESIDUE = re.compile(r'@CCRC_[A-Z0-9_]+@')

STAGE_PREFIX = '.ccd.ccrc-stage.'
STAGE_RE = re.compile(r'^\.ccd\.ccrc-stage\.[0-9]+$')
SELFTEST_PREFIX = '.ccd-selftest.'
SELFTEST_RE = re.compile(r'^\.ccd-selftest\.[A-Za-z0-9_]+$')

SELFTEST_ARGV = '--ccrc-entry-self-test'
SELFTEST_WANT = b'ccd-entry-self-test 3 1 1 1 1\n'
SELFTEST_TIMEOUT_S = 30

BODY_MODE = 0o644
ENTRY_MODE = 0o755

# THE PAIR'S PATHS, NAMED ONCE: the two sources relative to <tree>, the two
# destinations relative to <home>. `install` uses these four lines and nothing
# else, and server/test/install-census.test.ts reads exactly these four lines to
# derive what this program places — so a fifth spelling anywhere is a drift that
# census cannot see.
BODY_SOURCE = 'ccd/ccd'
TEMPLATE_SOURCE = 'ccd/ccd-entry.py'
ENTRY_DEST = '.local/bin/ccd'
BODY_DEST = '.local/libexec/ccrc/ccd'
LIB_SOURCE = 'ccd/lib/disk-retention.sh'
LIB_DEST = '.local/libexec/ccrc/lib/disk-retention.sh'


# THE BODY'S PROVENANCE STAMP IS WRITTEN HERE, AT INSTALL TIME, NEVER COMMITTED.
# `shared/mark.mjs` defines the marker (`# ccrc:generated 1 sha256=<hex>`: line 2
# after a shebang, the sha256 of the text WITHOUT that line). ccd/ccd used to
# carry it committed, and since every edit to the file changes it, line 2
# conflicted in 85 of the 98 conflicted absorptions measured in 30 days. The
# committed file now holds one fixed placeholder line there; `stamp_body` swaps
# the marker in for it, in place, so the installed copy has the committed copy's
# line numbers. The launcher's digest is taken over the STAMPED bytes, so the
# integrity chain is the same one as before: the digest rendered into the
# launcher covers the marker too, and the marker covers the rest. A body with no
# placeholder (a fixture) or a legacy stamp is handled by the same rule:
# whatever sits at the marker position that is a placeholder or a marker is
# replaced, else the marker is inserted - byte for byte what markGenerated writes.
# server/test/ccd-install-stamp.test.ts pins this against shared/mark.mjs.
MARKER_PREFIX = b'# ccrc:generated 1 sha256='
MARKER_LINE = re.compile(rb'# ccrc:generated 1 sha256=[0-9a-f]{64}')
STAMP_PLACEHOLDER = '# ccrc:stamp-at-install \u2014 written into the installed copy by ccd/ccd-entry-install.py; never committed'.encode('utf-8')


def stamp_body(data):
    lines = data.split(b'\n')
    idx = 1 if lines[0].startswith(b'#!') else 0
    if idx < len(lines) and (lines[idx] == STAMP_PLACEHOLDER or MARKER_LINE.fullmatch(lines[idx])):
        del lines[idx]
    lines.insert(idx, MARKER_PREFIX + hashlib.sha256(b'\n'.join(lines)).hexdigest().encode('ascii'))
    return b'\n'.join(lines)


def render_lib_pin(data, lib_digest):
    """The body with every pin placeholder line replaced, in place, by the library's digest (THE LIBRARY, above).
    `install` then requires exactly one pin, naming the library it publishes; this only renders."""
    return LIB_PIN_PLACEHOLDER.sub(b'__CCD_LIB_SHA256=' + lib_digest.encode('ascii'), data)


class Refused(Exception):
    pass


def say(msg):
    sys.stdout.write('install: ccd: %s\n' % msg)
    sys.stdout.flush()


def quiet_stdout():
    """Points fd 1 at /dev/null once a failing run has written its stderr.
    A report written to a stdout whose reader has gone (`ccrc install | head`)
    fails its flush and STAYS BUFFERED; the interpreter flushes stdout again at
    shutdown, fails again, and exits 120 in place of the status this run
    returned — which the lanes would read as a status they do not know. This is
    the Python documentation's own remedy for a BrokenPipeError (the `signal`
    module's note on SIGPIPE). Pending text is offered to a live stdout first.
    Failing to do any of it changes nothing: the run's status stands."""
    try:
        sys.stdout.flush()
    except Exception:
        pass
    try:
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
    except Exception:
        pass


def check_interpreter():
    """This interpreter's own canonical path, after proving it can be the
    launcher's shebang. Raises Refused naming the first property that fails."""
    f = sys.flags
    if sys.version_info[0] != 3:
        raise Refused('python3 reports Python %d, not 3' % sys.version_info[0])
    if not (f.isolated == 1 and f.ignore_environment == 1 and f.no_user_site == 1 and f.no_site == 1):
        raise Refused('this interpreter did not run isolated (-IS): isolated=%d ignore_environment=%d'
                      ' no_user_site=%d no_site=%d' % (f.isolated, f.ignore_environment, f.no_user_site, f.no_site))
    exe = sys.executable
    if not exe:
        raise Refused('this interpreter cannot name its own executable')
    chosen = shebang_path(os.path.realpath(exe))
    check_shebang_path(chosen)
    return chosen


def shebang_path(canon):
    """The interpreter path the launcher's shebang names (D-3698): the first
    `python3` on PATH, spelled as PATH spells it, when it resolves to THIS
    interpreter — the one that just proved -IS — so an upgrade that repoints
    that path (Homebrew's Cellar, an Ubuntu release's python3.N) moves the
    launcher with it rather than stranding every ccd start on a deleted file.
    A PATH python3 that is anything else (a shim script, another interpreter)
    is not what was probed, so the canonical path is named instead."""
    for d in os.environ.get('PATH', '').split(os.pathsep):
        if not d or not os.path.isabs(d):
            continue
        cand = os.path.join(d, 'python3')
        if os.path.isfile(cand) and os.access(cand, os.X_OK):
            if os.path.realpath(cand) != canon:
                return canon
            # Render the spelling that was COMPARED. `normpath` only tidies it,
            # and only when the tidy form still resolves to this interpreter:
            # it folds `<link>/..` lexically, which can name a different file
            # (review 216, F11).
            tidy = os.path.normpath(cand)
            return tidy if os.path.realpath(tidy) == canon else cand
    return canon


def check_shebang_path(canon):
    if not os.path.isabs(canon):
        raise Refused('the interpreter path %r is not absolute' % canon)
    if any(c.isspace() for c in canon):
        raise Refused('the interpreter path %r contains whitespace or a line break, which no shebang can carry'
                      % canon)
    try:
        line = ('#!' + canon + SHEBANG_FLAGS).encode('utf-8', 'strict')
    except UnicodeEncodeError:
        raise Refused('the interpreter path %r cannot be encoded into a shebang' % canon)
    if len(line) > SHEBANG_MAX:
        raise Refused('the shebang for %s is %d bytes, over the %d every supported kernel reads'
                      % (canon, len(line), SHEBANG_MAX))


def render(template, python, digest):
    for p in (PLACEHOLDER_PYTHON, PLACEHOLDER_DIGEST):
        n = template.count(p)
        if n != 1:
            raise Refused('the launcher template carries %d copies of %s, not exactly one' % (n, p))
    out = template.replace(PLACEHOLDER_PYTHON, python).replace(PLACEHOLDER_DIGEST, digest)
    if RESIDUE.search(out):
        raise Refused('the rendered launcher still carries a placeholder')
    if out.split('\n', 1)[0] != '#!' + python + SHEBANG_FLAGS:
        raise Refused('the rendered launcher does not open with #!%s%s' % (python, SHEBANG_FLAGS))
    try:
        compile(out, '<ccd direct entry>', 'exec', dont_inherit=True)
    except SyntaxError as e:
        raise Refused('the rendered launcher does not compile: %s' % e)
    return out.encode('utf-8')


def read_regular(path):
    """The bytes of a regular file reached WITHOUT following a final link."""
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_CLOEXEC', 0)
                 | getattr(os, 'O_NONBLOCK', 0))
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise Refused('%s is not a regular file' % path)
        chunks = []
        while True:
            c = os.read(fd, 1 << 16)
            if not c:
                break
            chunks.append(c)
        return b''.join(chunks)
    finally:
        os.close(fd)


def converged(dest, data, mode):
    """'same' when dest is already a regular file of these bytes and this mode;
    'mode' when only its mode differs; 'differ' otherwise. It only READS: a
    mode is repaired by `repair_mode`, after every refusal and the self-test."""
    try:
        st = os.lstat(dest)
    except FileNotFoundError:
        return 'differ'
    if not stat.S_ISREG(st.st_mode):
        return 'differ'
    try:
        if read_regular(dest) != data:
            return 'differ'
    except (OSError, Refused):
        return 'differ'
    return 'same' if stat.S_IMODE(st.st_mode) == mode else 'mode'


def repair_mode(dest, mode):
    """A half whose bytes are the shipped ones and whose mode is not: repaired
    IN PLACE through a non-following descriptor, never by rewriting the file."""
    fd = os.open(dest, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_CLOEXEC', 0) | getattr(os, 'O_NONBLOCK', 0))
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise Refused('%s stopped being a regular file before its mode could be repaired' % dest)
        os.fchmod(fd, mode)
    finally:
        os.close(fd)


def say_repaired(dest, mode):
    """The report of `repair_mode`, said by its caller AFTER it records the
    repair, so a report that fails is told apart from a repair that did."""
    say('%s: mode repaired to %o (its bytes were already the shipped ones)' % (dest, mode))


def destination_kind(dest):
    """What stands at dest, asked without following it: 'absent', 'file',
    'link-to-file', 'dangling-link' — each replaceable by one rename — or
    raises Refused for a directory, a link to one, or anything else."""
    try:
        st = os.lstat(dest)
    except FileNotFoundError:
        return 'absent'
    if stat.S_ISREG(st.st_mode):
        return 'file'
    if stat.S_ISDIR(st.st_mode):
        raise Refused('%s is a directory — refusing to move the new file into it' % dest)
    if stat.S_ISLNK(st.st_mode):
        try:
            target = os.stat(dest)
        except FileNotFoundError:
            return 'dangling-link'
        except OSError as e:
            raise Refused('%s is a link whose target cannot be examined: %s' % (dest, e.strerror))
        if stat.S_ISDIR(target.st_mode):
            raise Refused('%s is a link to a directory — refusing to move the new file into it' % dest)
        if stat.S_ISREG(target.st_mode):
            return 'link-to-file'
        raise Refused('%s is a link to something that is not a regular file' % dest)
    raise Refused('%s is neither a regular file nor a link (mode %o)' % (dest, st.st_mode))


def launcher_body_for(entry):
    """The body path ccd-entry.py's `body_path()` derives when started as
    `entry`: its canonical path when that carries the installed layout, else
    the path it was started by (a symlinked ~/.local or ~/.local/bin, D-3699);
    None when neither does."""
    entry_suffix = '/' + ENTRY_DEST
    body_suffix = '/' + BODY_DEST
    given = os.path.abspath(entry)
    for p in (os.path.realpath(given), given):
        if p.endswith(entry_suffix):
            return p[:-len(entry_suffix)] + body_suffix
    return None


def stage(directory, data, mode):
    path = os.path.join(directory, STAGE_PREFIX + str(os.getpid()))
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0)
                 | getattr(os, 'O_CLOEXEC', 0), mode)
    try:
        view = memoryview(data)
        while view:
            n = os.write(fd, view)
            view = view[n:]
        os.fchmod(fd, mode)
        os.fsync(fd)
    finally:
        os.close(fd)
    return path


def postcondition(dest, data, mode, label):
    """The exact destination entry, re-measured after its rename: a regular
    file — not a link — of the staged mode and bytes."""
    st = os.lstat(dest)
    if not stat.S_ISREG(st.st_mode) or stat.S_IMODE(st.st_mode) != mode or read_regular(dest) != data:
        raise Refused('after publishing the %s, %s is not the regular file of mode %o just staged' % (label, dest, mode))


def self_test(home, launcher_src, body_src, live=()):
    """The launcher-to-be, executed by the KERNEL through its shebang, from a
    throwaway copy of the final layout (<tmp>/.local/bin/ccd beside
    <tmp>/.local/libexec/ccrc/ccd): it must derive that body, match its
    digest, and print its isolated-flags record — without starting Bash. A
    staged half is hard-linked (the very file that will be renamed); a LIVE
    half (`live` names it) is copied at the mode it will have once repaired,
    so the test never touches a live file and never fails on a mode the run
    is about to fix."""
    local = os.path.join(home, '.local')
    tmp = tempfile.mkdtemp(prefix=SELFTEST_PREFIX, dir=local)
    try:
        entry = os.path.join(tmp, '.local', 'bin', 'ccd')
        body = os.path.join(tmp, '.local', 'libexec', 'ccrc', 'ccd')
        os.makedirs(os.path.dirname(entry))
        os.makedirs(os.path.dirname(body))
        for src, dst, mode in ((launcher_src, entry, ENTRY_MODE), (body_src, body, BODY_MODE)):
            try:
                if src in live:
                    raise OSError('a live half is copied, never linked')
                os.link(src, dst)
            except OSError:
                shutil.copyfile(src, dst)
                os.chmod(dst, mode)
        env = {'PATH': '/usr/bin:/bin', 'HOME': tmp}
        try:
            r = subprocess.run([entry, SELFTEST_ARGV], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, env=env, cwd=tmp, timeout=SELFTEST_TIMEOUT_S)
        except (OSError, subprocess.SubprocessError) as e:
            raise Refused('the staged launcher could not be executed through the kernel: %s' % e)
        if r.returncode != 0 or r.stdout != SELFTEST_WANT:
            raise Refused('the staged launcher\'s kernel self-test answered rc %d %r %r — nothing was published'
                          % (r.returncode, r.stdout[:200], r.stderr[:300]))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def sweep(directory, pattern, is_dir):
    """Removes this installer's OWN leftovers from an aborted run — names it
    alone mints — and nothing else."""
    try:
        names = os.listdir(directory)
    except OSError:
        return
    for n in names:
        if not pattern.match(n):
            continue
        p = os.path.join(directory, n)
        try:
            st = os.lstat(p)
        except OSError:
            continue
        if is_dir and stat.S_ISDIR(st.st_mode):
            shutil.rmtree(p, ignore_errors=True)
        elif not is_dir and stat.S_ISREG(st.st_mode):
            try:
                os.unlink(p)
            except OSError:
                pass


def install(tree, home):
    python = check_interpreter()
    lib_data = read_regular(os.path.join(tree, *LIB_SOURCE.split('/')))
    if b'\0' in lib_data or not lib_data.endswith(b'\n') or lib_data.endswith(b'\n\n'):
        raise Refused('%s must end in exactly one newline and contain no NUL byte: the body hashes the file as bash reads it,'
                      ' which drops NULs and trailing newlines, so any other file is one the body would refuse; fix the file'
                      ' in the source tree' % LIB_SOURCE)
    lib_digest = hashlib.sha256(lib_data).hexdigest()
    # The pin first, then the stamp over it, then the launcher's digest over both (THE LIBRARY, above).
    pinned = render_lib_pin(read_regular(os.path.join(tree, *BODY_SOURCE.split('/'))), lib_digest)
    pins = LIB_PIN.findall(pinned)
    if len(pins) != 1 or pins[0].decode('ascii') != lib_digest:
        raise Refused('%s is not the library %s pins once rendered (%d pin line(s)): a body published ahead of a library it'
                      ' cannot verify would refuse every ccd start; %s must carry exactly one `__CCD_LIB_SHA256=stamp-at-install`'
                      ' line, which this install renders' % (LIB_SOURCE, BODY_SOURCE, len(pins), BODY_SOURCE))
    body_data = stamp_body(pinned)
    template = read_regular(os.path.join(tree, *TEMPLATE_SOURCE.split('/'))).decode('utf-8')
    digest = hashlib.sha256(body_data).hexdigest()
    entry_data = render(template, python, digest)

    entry_dest = os.path.join(home, *ENTRY_DEST.split('/'))
    body_dest = os.path.join(home, *BODY_DEST.split('/'))
    lib_dest = os.path.join(home, *LIB_DEST.split('/'))
    bindir = os.path.dirname(entry_dest)
    libexec = os.path.dirname(body_dest)
    libdir = os.path.dirname(lib_dest)
    # EVERY REFUSAL FIRST, before anything is created, repaired, staged or
    # moved (review 216, F4). THE LAUNCHER MUST FIND THIS BODY (D-3699): asked
    # exactly as the launcher will ask it, started by its installed path —
    # never discovered only once every ccd start refuses `entry-layout` after a
    # "successful" install. Then what stands at each destination: a directory,
    # or a link to one.
    derived = launcher_body_for(entry_dest)
    if derived is None or os.path.realpath(derived) != os.path.realpath(body_dest):
        raise Refused('%s resolves to %s, whose launcher would look for its body at %s, not at %s — this'
                      ' ~/.local layout cannot host the direct entry' % (entry_dest, os.path.realpath(entry_dest), derived, body_dest))
    for dest in (lib_dest, body_dest, entry_dest):
        destination_kind(dest)
    for d in (bindir, libexec, libdir):
        os.makedirs(d, mode=0o755, exist_ok=True)
    sweep(bindir, STAGE_RE, False)
    sweep(libexec, STAGE_RE, False)
    sweep(libdir, STAGE_RE, False)
    sweep(os.path.join(home, '.local'), SELFTEST_RE, True)

    lib_state = converged(lib_dest, lib_data, BODY_MODE)
    body_state = converged(body_dest, body_data, BODY_MODE)
    entry_state = converged(entry_dest, entry_data, ENTRY_MODE)

    staged_lib = staged_body = staged_entry = None
    moved = []
    # What this run has PROVED stands at each destination, so a failure after
    # a half moved names the state it left. The body is proved once its rename
    # re-measured; the launcher when it already carried these bytes and mode,
    # once its mode is repaired, or once its rename re-measured. What fails
    # after both are proved is only a report (stdout), and the pair stands.
    body_proved = False
    entry_proved = entry_state == 'same'
    try:
        staged_lib = stage(libdir, lib_data, BODY_MODE) if lib_state == 'differ' else None
        staged_body = stage(libexec, body_data, BODY_MODE) if body_state == 'differ' else None
        staged_entry = stage(bindir, entry_data, ENTRY_MODE) if entry_state == 'differ' else None
        # The pair the self-test runs is the pair that will be live: each half
        # either its staged replacement or the file already there, at the mode
        # it will have. On EVERY run — a converged pair is not "in place" until
        # the kernel has started its launcher (review 216, F4).
        self_test(home, staged_entry or entry_dest, staged_body or body_dest,
                  live=tuple(d for d, s in ((entry_dest, staged_entry), (body_dest, staged_body)) if s is None))
        if staged_lib is None and staged_body is None and staged_entry is None and lib_state == body_state == entry_state == 'same':
            say('converged — the launcher, the body and the library already carry these bytes')
            return 0
        # The library goes FIRST: the body that lands next pins it. A standing body from before the library does not read it;
        # one that loads a library pins the old one and refuses starts until the new body lands (see THE LIBRARY above).
        if lib_state == 'mode':
            repair_mode(lib_dest, BODY_MODE)
            say_repaired(lib_dest, BODY_MODE)
        if staged_lib is not None:
            kind = destination_kind(lib_dest)
            os.replace(staged_lib, lib_dest)
            staged_lib = None
            moved.append('library')
            postcondition(lib_dest, lib_data, BODY_MODE, 'library')
            say('library published at %s (replaced: %s)' % (lib_dest, kind))
        if body_state == 'mode':
            repair_mode(body_dest, BODY_MODE)
            say_repaired(body_dest, BODY_MODE)
        if staged_body is not None:
            kind = destination_kind(body_dest)
            os.replace(staged_body, body_dest)
            staged_body = None
            moved.append('body')
            postcondition(body_dest, body_data, BODY_MODE, 'body')
            body_proved = True
            say('body published at %s (replaced: %s)' % (body_dest, kind))
        if entry_state == 'mode':
            repair_mode(entry_dest, ENTRY_MODE)
            entry_proved = True
            say_repaired(entry_dest, ENTRY_MODE)
        if staged_entry is not None:
            kind = destination_kind(entry_dest)
            os.replace(staged_entry, entry_dest)
            staged_entry = None
            moved.append('launcher')
            postcondition(entry_dest, entry_data, ENTRY_MODE, 'launcher')
            entry_proved = True
            say('launcher published at %s for %s (replaced: %s)' % (entry_dest, python, kind))
        return 0
    except (OSError, Refused) as e:
        if not moved:
            raise
        if moved == ['library']:
            state = ('the library was renamed into place (re-measured or not: a re-run says); the body and the launcher did not'
                     ' move. A body that stands from before the library does not read it, and one that pins this very library'
                     ' starts as it did; but a standing body that pins a DIFFERENT library now refuses every ccd start'
                     ' (lib-digest) until the new body lands. Re-run this install to converge the pair, or restore the'
                     ' previous library (ccrc update\'s backup carries it as ccd-lib-disk-retention.sh)')
        elif 'launcher' in moved and entry_proved:
            state = ('the launcher was renamed into place and re-measured as the file just staged, so what stands'
                     ' at %s is the launcher this run self-tested and the pair stands as staged; only the run\'s'
                     ' report failed after that, and a re-run converges without moving anything' % entry_dest)
        elif 'launcher' in moved:
            state = ('the launcher was renamed into place and did not re-measure as the file just staged, so what'
                     ' stands at %s is unverified until a re-run converges the pair' % entry_dest)
        elif not body_proved:
            state = ('the body was renamed into place and did not re-measure as the file just staged, so what'
                     ' stands at %s is unverified until a re-run converges the pair; the launcher did not move'
                     % body_dest)
        elif entry_proved:
            state = ('the body was renamed into place and re-measured as the file just staged, and the launcher at'
                     ' %s carries the bytes and mode this run self-tested beside it, so the pair stands as staged;'
                     ' only the run\'s report failed after that, and a re-run converges without moving anything'
                     % entry_dest)
        else:
            state = ('the launcher did not move, so what stands at %s is not proved to be the launcher this run'
                     ' self-tested beside this body: until a re-run converges the pair, a ccd start through it may'
                     ' refuse (by digest, when it is an earlier launcher) or run an entry this run did not verify'
                     % entry_dest)
        sys.stderr.write('install: ccd: refused after the %s moved: %s — %s\n' % (' and the '.join(moved), e, state))
        quiet_stdout()
        return 2
    finally:
        for p in (staged_lib, staged_body, staged_entry):
            if p is not None:
                try:
                    os.unlink(p)
                except OSError:
                    pass


def main(argv):
    try:
        if argv[:1] == ['check'] and len(argv) == 1:
            sys.stdout.write('%s\n' % check_interpreter())
            return 0
        if argv[:1] == ['install'] and len(argv) == 3:
            return install(argv[1], argv[2])
        sys.stderr.write('usage: ccd-entry-install.py check | install <tree> <home>\n')
        quiet_stdout()
        return 1
    except Refused as e:
        sys.stderr.write('install: ccd: refused: %s\n' % e)
        quiet_stdout()
        return 1
    except OSError as e:
        sys.stderr.write('install: ccd: refused: %s\n' % e)
        quiet_stdout()
        return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
