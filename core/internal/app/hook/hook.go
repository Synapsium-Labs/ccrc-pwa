// Package hook is ring L4 for the `hook` entry point, Claude Code's session hook (ccd/session-hook.sh): the event comes
// from stdin's hook_event_name, never from argv, and every path exits 0 (the bash's header contract). It decides
// nothing itself (domain/attention does) and never imports an adapter (spec 2026-11-24 §3): the composition root hands
// it the registry's files and the tmux question.
//
// The stages run in the bash's order, each gated by event as the bash gates it (wave 2 inventory §1, "Tail"). The arms
// are all here: the compaction arms (Task 8b) last, in compaction.go.
//
// D-TBD-go-hook-no-jq: the Go hook runs no `jq` on its own paths, so the bash's `command -v jq || exit 0` has no twin
// here (tests that remove or stub jq stay bash-only).
package hook

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"ccrc/core/internal/domain/attention"
)

// FS is the registry port the hook declares: the files under ~/.cc-sessions and ~/.ccrc, as a shell reaches them.
type FS interface {
	ReadFile(path string, max int) ([]byte, error) // at most max bytes (max <= 0: all); through a link
	Lstat(path string) (fs.FileInfo, error)
	Stat(path string) (fs.FileInfo, error)
	WriteFile(path string, data []byte, perm fs.FileMode) error // `>`, perm less the umask
	AppendFile(path string, data []byte) error                  // `>>`, one write
	Rename(oldpath, newpath string) error                       // `mv -f`
	Remove(path string) error                                   // `rm -f` of one name
	MkdirAll(path string, perm fs.FileMode) error
	Glob(pattern string) ([]string, error)
	// RotateLocked renames src onto dst under a non-blocking lock on src, only while src is still that inode and over
	// holds for its first readMax bytes (the join record's rotation); anything else skips.
	RotateLocked(src, dst string, readMax int, over func([]byte) bool)
	ReadDirNames(path string) ([]string, error) // every name but . and .., bytewise
	Searchable(path string) bool                // `-r p && -x p`
	// AppendRegular is the history spool's guarded append (regfs.OS.AppendRegular): one write to a descriptor it opened.
	AppendRegular(path string, data []byte) error
	ReadTail(path string, n int) ([]byte, error)         // `tail -c n path`
	ReadRange(path string, off, n int64) ([]byte, error) // `tail -c +<off+1> path | head -c n`
	Executable(path string) bool                         // `-x p`
	Rmdir(path string) error                             // `rmdir`: an empty directory only
	Symlink(target, link string) error                   // `ln -sn -- target link`
	Readlink(path string) (string, error)
	EvalSymlinks(path string) (string, error) // the physical path (`pwd -P` once there)
	// The compaction arms' (Task 8b):
	Link(oldpath, newpath string) error                    // POSIX `link`: exactly newpath, or nothing
	CreateExcl(path string, perm fs.FileMode) error        // `set -C; : > path`
	Touch(path string) error                               // `touch path`
	Walk(dir string, f func(path string, mtime time.Time)) // `find dir`, links not followed
	Readable(path string) bool                             // `-r path`
}

// Held is a descriptor the hook keeps open on a row file: the stable lock's, a PostCompact claim, a journal
// (adapter/lock.Held).
type Held interface {
	Same(path string) bool // `_hook_lock_same`: still one regular inode with path
	ReadAll() ([]byte, error)
	Close()
}

// Lock is the stable row lock (adapter/lock): the one mechanism ccd's bash takes too.
type Lock interface {
	// Acquire is the protocol past its mechanism probe: vanished is asked when canonical is absent. ok false is a
	// refusal; vanished true names it canonical-vanished.
	Acquire(reg, id string, wait time.Duration, vanished func() bool) (h Held, ok, vanishedWhy bool)
	Generation(reg, id string) (string, bool) // the row's generation through a private alias, re-proved
	Open(path string) (Held, error)           // `exec {fd}<"$path"`
	ProcNames(prefix string) bool             // a live descriptor names a target with this prefix (/proc)
	Mktemp(prefix string) (string, bool)      // `( umask 077; mktemp "<prefix>XXXXXX" )`
}

// IO is what the composition root hands the hook.
type IO struct {
	Stdout      io.Writer
	Stderr      io.Writer                   // where a recovered panic is named, one line (nil: nowhere)
	Getenv      func(string) string         // os.Getenv
	LookupEnv   func(string) (string, bool) // os.LookupEnv (nil: a non-empty Getenv is set)
	FS          FS
	TmuxSession func(home, pane, tmuxEnv string) string                 // tmux's `#S` answer for the pane, as `$( )` keeps it
	NowMs       func() int64                                            // `_hook_epoch_ms`
	Pid         int                                                     // `$$`, in the temporary files' names
	GOOS        string                                                  // runtime.GOOS: the spool line's cap follows the platform ("" is linux)
	Git         func(dir string, args ...string) (string, bool)         // `git -C dir args…` as `$( )` keeps it, and whether it exited 0
	Classify    func(cmd string, bounded bool) string                   // `ccrc test --classify-shell -- cmd` (cut at 5 s when bounded), as `$( )` keeps it
	Found       func(name string) bool                                  // `command -v name`
	JQ          func(stdin []byte, args ...string) ([]byte, bool, bool) // `jq args… <<<stdin` through PATH: its raw stdout, whether it exited 0, and whether jq was asked at all (false: its --arg values could not be handed over)
	LibDir      string                                                  // the lib/ beside the core, read before ~/.cc-sessions/lib (ROSTER_CARD_LIB)
	// Run is `timeout <bound> name args...` (bound <= 0: none) with stdin given, stderr dropped or merged into the output,
	// and extra NAME=value entries in the environment: the closed client and jq's three modules (Task 6).
	Run  func(bound time.Duration, stdin []byte, extra []string, merge bool, name string, args ...string) RunResult
	Rand func() int // `$RANDOM`
	// RunWith is Run with data handed to the process as files (`<( )`): an argument that is exactly "@fd<N>" names input N.
	RunWith func(bound time.Duration, inputs [][]byte, name string, args ...string) RunResult
	// The approval wait's: Trap arms `trap 'exit 0' TERM INT HUP` (from then on each ends the process at once, exit 0,
	// printing nothing), Nonce is 16 random bytes as lowercase hex (the bash reads /dev/urandom through od), Sleep is a tick.
	Trap  func()
	Nonce func() (string, bool)
	Sleep func(time.Duration)
	// LocaleInstalled is host.LocaleInstalled: whether glibc would load a locale name (nil: every name loads).
	LocaleInstalled func(name string) bool
	Lock            Lock // the compaction arms' stable row lock
}

// Main runs the hook once over its payload and answers 0, always. What it prints is held until it ends: a panic
// (which would exit 2, a blocking answer to Claude Code) is recovered and prints nothing at all.
func Main(stdin io.Reader, x IO) (rc int) {
	var out bytes.Buffer
	defer func() {
		if p := recover(); p != nil {
			// one line on stderr, stdout still empty and the status still 0: a panic in a deny arm allows where the bash
			// would answer, so it must not pass unseen (final review finding 10). Goroutines outside Main (RunWith's
			// writers, bindGroup's AfterFunc) are not covered by this recover; nothing they run today can panic.
			if x.Stderr != nil {
				// one line whatever the value holds: its newlines escaped, and the backslash, so the escape reads back
				v := strings.NewReplacer(`\`, `\\`, "\n", `\n`, "\r", `\r`).Replace(fmt.Sprint(p))
				_, _ = fmt.Fprintf(x.Stderr, "ccrc-core: hook panic: %s\n", v)
			}
			rc = 0
			return
		}
		_, _ = x.Stdout.Write(out.Bytes())
	}()
	h := &run{IO: x, out: &out}
	h.main(stdin)
	return 0
}

type run struct {
	IO
	out       *bytes.Buffer
	home, reg string
	id        string
	utf8      bool
	locales   map[string]bool // localeInstalled's answers
	net       attention.Net   // the invocation's one network budget
	compact                   // the compaction arms' run state (compaction.go)
}

func (h *run) p(name string) string { return filepath.Join(h.reg, name) }

func (h *run) exists(p string) bool { _, err := h.FS.Stat(p); return err == nil }

// regular is `[[ ! -L p && -f p ]]`.
func (h *run) regular(p string) bool {
	st, err := h.FS.Lstat(p)
	return err == nil && st.Mode().IsRegular()
}

// special is a positive non-regular type at p, link included (`-L || -d || -p || -S || -b || -c`).
func (h *run) special(p string) bool {
	st, err := h.FS.Lstat(p)
	return err == nil && !st.Mode().IsRegular()
}

func (h *run) main(stdin io.Reader) {
	h.home = h.Getenv("HOME")
	if h.home == "" { // bash: [[ -n $HOME ]] || exit 0
		return
	}
	h.reg = filepath.Join(h.home, ".cc-sessions")
	raw, err := io.ReadAll(stdin)
	if err != nil { // bash: payload=$(cat) || exit 0
		return
	}
	payload := attention.Payload(raw)
	if h.id = h.identity(); h.id == "" || !attention.ValidID(h.id) {
		return
	}
	if st, err := h.FS.Stat(h.reg); err != nil || !st.IsDir() {
		return
	}
	h.utf8 = attention.UTF8Units(h.Getenv, h.localeInstalled)
	// The bash then requires jq on PATH (`command -v jq || exit 0`); the Go hook runs no jq (plan Global Constraints).
	// The delegation spool's gate and the parse's lines 6 to 10 are Task 3's.
	ps, ok := attention.ParsePayload(payload)
	if !ok {
		return
	}
	h.session(ps, payload, h.buildSpool(ps, payload))
}

// identity is "which session this is": the pane's tmux session `cc-<id>`, else, with no pane, the job marker's
// session id matched against a registry row's `.uuid` (D-4953).
func (h *run) identity() string {
	if pane := h.Getenv("TMUX_PANE"); pane != "" {
		return attention.SessionFromPane(h.TmuxSession(h.home, pane, h.Getenv("TMUX")))
	}
	sid := h.Getenv("CLAUDE_CODE_SESSION_ID")
	if h.Getenv("CLAUDE_JOB_DIR") == "" || sid == "" {
		return ""
	}
	if st, err := h.FS.Stat(h.reg); err != nil || !st.IsDir() {
		return ""
	}
	rows, _ := h.FS.Glob(filepath.Join(h.reg, "*.uuid"))
	for _, u := range rows {
		if st, err := h.FS.Stat(u); err != nil || !st.Mode().IsRegular() {
			continue
		}
		b, _ := h.FS.ReadFile(u, 4*1024)
		if attention.UUIDLine(b) == sid {
			return strings.TrimSuffix(filepath.Base(u), ".uuid")
		}
	}
	return ""
}

// session runs the classification and the tail for one identified session.
func (h *run) session(ps attention.Parsed, payload string, sp built) {
	ev := ps.Event
	if ev == "UserPromptSubmit" && attention.TypedModelPayload(h.Getenv("CCRC_DOOR_NONCE_SHA256"), payload, ps) {
		h.modelReport("typed-refused", ps)
		h.out.Write(append(attention.TypedModelBlock(), '\n'))
		return
	}
	c := attention.ClassifyPayload(ev, payload, ps)
	if c.Exit {
		if ev == "PostModelSwitch" {
			h.modelReport("switched", ps)
		}
		return
	}
	if ev == "SessionStart" {
		cards, word := h.cards(ps, c.Src)
		if cards.Any() {
			// the served marker follows a print that went out with a compact subject (@compact-arm-emit-call)
			err := h.print(append(attention.EmitContext(cards, h.utf8), '\n'))
			if errors.Is(err, syscall.EPIPE) {
				// The bash's emit is untrapped: a reader gone kills it at this printf, so nothing after it runs (no
				// marker, no tail). The Go hook stops here too, releasing what it holds, and exits 0 where the bash dies
				// of SIGPIPE: the wave's exit-0 contract (D-TBD-go-hook-sigpipe-status, the one difference left).
				h.serveEnd()
				return
			}
			if err == nil && cards.Compact != "" {
				h.markServed()
			}
		}
		// A start the door answered owes no prompt anchor, whatever its source.
		if word != "" {
			_ = h.FS.Remove(h.p(h.id + ".anchor-owed"))
		}
		h.serveEnd() // the retained serve lock ends here, on every SessionStart
	}
	h.scopeTruncate(ps) // tail stage 1
	hcat := h.capture(ev, c.Src, payload)
	msid := h.Getenv("CLAUDE_CODE_SESSION_ID")
	if msid == "" {
		msid = ps.Psid
	}
	hts, tmsub := h.turn(ps, c, msid, hcat)
	h.historySpool(ps, c)
	h.delegationSpool(sp)
	if sp.row != "" && !tmsub {
		h.launchRecord(sp)
	}
	h.startReport(ps, c)
	if c.Stopfail || c.Sessend {
		return
	}
	h.state(ps, c, hts, payload, tmsub)
}

// capture is tail stage 2: a session whose id ends -hookcap copies each event (but a compact SessionStart) to one 0600
// file in a 0700 directory, at most 200; it answers the stamp it took ("" when it took none).
func (h *run) capture(ev, src, payload string) string {
	if !strings.HasSuffix(h.id, "-hookcap") || src == "compact" {
		return ""
	}
	dir := filepath.Join(h.home, ".ccrc", "hook-capture", h.id)
	_ = h.FS.MkdirAll(dir, 0o700)
	if st, err := h.FS.Stat(dir); err != nil || !st.IsDir() {
		return ""
	}
	if caps, _ := h.FS.Glob(filepath.Join(dir, "*.cap")); len(caps) >= attention.CaptureMax {
		return ""
	}
	at := strconv.FormatInt(h.NowMs(), 10)
	pid := strconv.Itoa(h.Pid)
	tmp := filepath.Join(dir, "."+ev+"."+pid+".capture.tmp")
	if h.FS.WriteFile(tmp, attention.Capture(h.Getenv("CLAUDE_CODE_SESSION_ID"), payload), 0o600) != nil ||
		h.FS.Rename(tmp, filepath.Join(dir, ev+"-"+at+"-"+pid+".cap")) != nil {
		_ = h.FS.Remove(tmp)
	}
	return at
}

// turn is tail stages 3 to 5: the join record on a SubagentStart, the membership test, and the main thread's turn
// marker. It answers the stamp the marker took ("" when none was due) and whether the agent is a joined subagent.
func (h *run) turn(ps attention.Parsed, c attention.Class, msid, hcat string) (hts string, tmsub bool) {
	gen := h.p(h.id + ".generation")
	if ps.Event == "SubagentStart" && ps.Aid != "" && h.exists(gen) {
		h.join(ps.Aid, gen)
	}
	if ps.Paid && ps.Aid != "" {
		for _, f := range []string{h.p(h.id + ".joined"), h.p(h.id + ".joinedprev")} {
			if !tmsub && h.regular(f) {
				b, _ := h.FS.ReadFile(f, attention.JoinReadMax)
				tmsub = attention.Joined(b, ps.Aid)
			}
		}
	}
	if tmsub || !h.exists(gen) {
		return "", tmsub
	}
	mf := h.p(h.id + ".turn.json")
	prev := ""
	if b, err := h.FS.ReadFile(mf, 0); err == nil {
		prev = firstLine(b)
	}
	kind := attention.TurnKind(ps.Event, c.Src, prev, msid)
	if kind == "" {
		return "", false
	}
	hts = hcat
	if hts == "" {
		hts = strconv.FormatInt(h.NowMs(), 10)
	}
	at, _ := strconv.ParseInt(hts, 10, 64)
	line, ok := attention.TurnMark(attention.Mark{Prev: prev, Kind: kind, Sid: msid, Event: ps.Event, At: at,
		Bg: c.Bg, Crons: c.Crons, Bgk: c.Bgk, Bgi: c.Bgi, Err: c.Err})
	if ok {
		h.writeAtomic(mf, "turn-"+hts, line)
	}
	return hts, false
}

// firstLine is `IFS= read -r line < f`: up to the first newline, NUL bytes dropped.
func firstLine(b []byte) string {
	s := strings.ReplaceAll(string(b), "\x00", "")
	s, _, _ = strings.Cut(s, "\n")
	return s
}

// writeAtomic is `_hook_write_atomic`: a private temporary file, then a rename; nothing left behind on a failure.
func (h *run) writeAtomic(path, nonce string, text []byte) bool {
	base := strings.TrimPrefix(filepath.Base(path), h.id+".")
	tmp := h.p("." + h.id + "." + base + "." + strconv.Itoa(h.Pid) + "." + nonce + ".hook-write.tmp")
	if h.FS.WriteFile(tmp, append(text, '\n'), 0o666) != nil || h.FS.Rename(tmp, path) != nil {
		_ = h.FS.Remove(tmp)
		return false
	}
	return true
}

// join is `_hook_join_record`: one appended line, the rotation past JOIN_ROTATE_AT lines, and a look at the row after
// the write (a row purged under it keeps no join file).
func (h *run) join(aid, gen string) {
	jf, jp := h.p(h.id+".joined"), h.p(h.id+".joinedprev")
	if h.special(jf) {
		return
	}
	orphan := func() {
		if !h.exists(gen) {
			_ = h.FS.Remove(jf)
			_ = h.FS.Remove(jp)
		}
	}
	if h.FS.AppendFile(jf, []byte(aid+"\n")) != nil {
		orphan()
		return
	}
	if cur, _ := h.FS.ReadFile(jf, attention.JoinReadMax); attention.JoinOverCap(cur) && !h.special(jp) {
		h.FS.RotateLocked(jf, jp, attention.JoinReadMax, attention.JoinOverCap)
	}
	orphan()
}

// localeInstalled asks the probe once per name: the decision asks it per category, twelve times over one LANG.
func (h *run) localeInstalled(name string) bool {
	if h.LocaleInstalled == nil {
		return true
	}
	if v, ok := h.locales[name]; ok {
		return v
	}
	if h.locales == nil {
		h.locales = map[string]bool{}
	}
	h.locales[name] = h.LocaleInstalled(name)
	return h.locales[name]
}
