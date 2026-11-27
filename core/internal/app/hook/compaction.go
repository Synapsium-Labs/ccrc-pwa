package hook

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"ccrc/core/internal/domain/attention"
	"ccrc/core/internal/kernel/vocab"
)

// The compaction arms (ccd/session-hook.sh, wave 2 inventory §2G; tail stages 1, 24 and 25, and the SessionStart(compact)
// serve): the stable row lock's family, PreCompact's refusal, set and card, the history scope marker and steer print,
// the events line, PostCompact's journal, and the card's serve and its served marker. attention decides each rule; this
// file measures and acts in the bash's order, under the bash's lock, and every failure is silent (exit 0).

// compact is one run's compaction state: the bash's CS_* globals (scope nil is `CS_SCOPE` unset, which the history
// arms read apart from set-but-empty), the refusal, and the serve lock retained across the SessionStart print.
type compact struct {
	scope      *attention.Scope
	rule       *attention.Scope // CS_RULE_SCOPE/CS_RULE_TRANSCRIPT: the rule's own answer, kept when overlap degrades it
	refused    bool             // CS_REFUSED
	serveHeld  Held             // COMPACT_SERVE_FD
	serveNonce string           // COMPACT_SERVE_NONCE
}

func (h *run) now() time.Time       { return time.UnixMilli(h.NowMs()) }
func (h *run) ccrc(n string) string { return filepath.Join(h.home, ".ccrc", n) }

// lstatFile is `[[ -f p && ! -L p ]]`.
func (h *run) lstatFile(p string) bool { return h.regular(p) }

// fileReadable is `[[ -f p && ! -L p && -r p ]]`.
func (h *run) fileReadable(p string) bool { return h.regular(p) && h.FS.Readable(p) }

// mtime is p's lstat modification time (`find p` names it).
func (h *run) mtime(p string) (time.Time, bool) {
	st, err := h.FS.Lstat(p)
	if err != nil {
		return time.Time{}, false
	}
	return st.ModTime(), true
}

// youngFind is `[ -n "$(find p -mmin -<mins>)" ]`.
func (h *run) youngFind(p string, mins int) bool {
	t, ok := h.mtime(p)
	return ok && attention.Younger(h.now(), t, mins)
}

// fresh is the bash's absent-name loop over `$REG/.<id>.<family>.<pid>.<r>.<r><tail>`, eight tries.
func (h *run) fresh(family, tail string) string {
	for i := 0; i < 8; i++ {
		p := h.p("." + h.id + "." + family + "." + strconv.Itoa(h.Pid) + "." + strconv.Itoa(h.Rand()) + "." + strconv.Itoa(h.Rand()) + tail)
		if !h.present(p) {
			return p
		}
	}
	return ""
}

// acquire is `_hook_lock_acquire <wait>`: nil on every refusal and on an absent mechanism (the hook's policy:
// attention.Lock*).
func (h *run) acquire(wait time.Duration) Held {
	if h.Lock == nil || !attention.LockMechanism(h.Found) {
		return nil
	}
	held, ok, _ := h.Lock.Acquire(h.reg, h.id, wait, h.vanished)
	if !ok {
		return nil
	}
	return held
}

// vanished is `_hook_lock_vanished`: its reads, and attention.LockVanished's verdict.
func (h *run) vanished() bool {
	alias := false
	names, _ := h.FS.ReadDirNames(h.reg)
	for _, n := range names {
		if strings.HasPrefix(n, "."+h.id+".compactions.lock-open.") {
			alias = true
			break
		}
	}
	proc := false
	if st, err := h.FS.Stat("/proc"); err == nil && st.IsDir() {
		proc = true
	}
	prefix := h.p("." + h.id + ".compactions.lock-open.")
	return attention.LockVanished(alias, h.present(h.p(h.id+".generation")), proc, h.Found("find"),
		func() bool { return h.Lock.ProcNames(prefix) })
}

// canonical is `_hook_lock_still_canonical`.
func (h *run) canonical(l Held) bool { return l.Same(h.p("." + h.id + ".compactions.lock")) }

// generationOK is `_hook_generation_ok`: this pane's generation equals the row's, read through a private alias.
func (h *run) generationOK() bool {
	want := h.Getenv("CCRC_SESSION_GENERATION")
	p := h.p(h.id + ".generation")
	if !attention.IsUUID(want) || !h.fileReadable(p) || !h.Found("link") || h.Lock == nil {
		return false
	}
	got, ok := h.Lock.Generation(h.reg, h.id)
	return ok && got == want
}

// scopeRule is `_hook_compact_scope <tp> <trig>`: the rule's reads, attention.CompactScope's verdict; it stands as
// this run's CS_SCOPE.
func (h *run) scopeRule(tp, trig string) attention.Scope {
	in := attention.ScopeIn{TP: tp, Trig: trig, Find: h.Found("find"), Now: h.now(), UTF8: h.utf8,
		LiveReadable: func(p string) bool {
			st, err := h.FS.Stat(p)
			return err == nil && st.Mode().IsRegular() && h.FS.Readable(p)
		}}
	if st, err := h.FS.Stat(tp); tp != "" && err == nil && st.Mode().IsRegular() && h.FS.Readable(tp) {
		in.TPReadable = true
	}
	if in.TPReadable && in.Find && trig != "manual" {
		dir := attention.SubagentsDir(tp)
		if st, err := h.FS.Stat(dir); err == nil && st.IsDir() {
			h.FS.Walk(dir, func(p string, t time.Time) { in.Agents = append(in.Agents, attention.Entry{Path: p, MTime: t}) })
		}
		in.TPMTime, in.TPMTimeOK = h.mtime(tp)
	}
	s := attention.CompactScope(in)
	h.compact.scope = &s
	return s
}

// scopeVerdict is `_hook_history_scope_verdict`: the payload's path and trigger (`// "auto"`), then the rule.
func (h *run) scopeVerdict(ps attention.Parsed) attention.Scope {
	tp, trig := attention.PayloadTPTrig(ps, "auto")
	return h.scopeRule(tp, trig)
}

// csScope is `${CS_SCOPE-}`, the verdict asked first when no arm reached one (`[[ -n "${CS_SCOPE+x}" ]] || …`).
func (h *run) csScope(ps attention.Parsed) attention.Scope {
	if h.compact.scope == nil {
		h.scopeVerdict(ps)
	}
	return *h.compact.scope
}

// ---------------------------------------------------------------------------------------------------- tail stage 1

// scopeTruncate is the history scope marker's early truncation: a main-thread PreCompact empties this id's marker
// before any exit can run, so an older `main` line never serves this compaction.
func (h *run) scopeTruncate(ps attention.Parsed) {
	if ps.Event != "PreCompact" || ps.Paid {
		return
	}
	dir := filepath.Join(h.home, ".ccrc", "history", vocab.ScopeDir)
	f := filepath.Join(dir, h.id)
	if h.lstatFile(f) && !h.isLink(dir) {
		_ = h.FS.WriteFile(f, nil, 0o666)
	}
}

// ---------------------------------------------------------------------------------------------------- tail 24 and 25

// compactTail is tail stages 24 and 25: PreCompact's five arms in the bash's order, or PostCompact's journal.
func (h *run) compactTail(ps attention.Parsed) {
	switch ps.Event {
	case "PreCompact":
		reserve := attention.HistoryCardReserve(true, h.isDirFollow(filepath.Join(h.home, ".ccrc", "history", vocab.CardDir)),
			h.exists(h.ccrc("history-off")))
		h.compact = compact{}
		h.compactRefuse(ps)
		h.compactPre(ps, reserve)
		sd := filepath.Join(h.home, ".ccrc", "history", vocab.ScopeDir)
		if !ps.Paid && h.isDirFollow(sd) && !h.isLink(sd) && !h.exists(h.ccrc("history-off")) {
			h.historyScope(ps)
		}
		h.historyPre(ps)
		if !h.compact.refused {
			h.preLine(ps, "pre")
		}
	case "PostCompact":
		h.compactPost(ps)
	}
}

func (h *run) isDirFollow(p string) bool { st, err := h.FS.Stat(p); return err == nil && st.IsDir() }

// compactRefuse is `_hook_compact_refuse`: a main, automatic PreCompact refused once a turn while the route says
// refuse; the `refused` line first, under the lock, and the block printed only once it is written.
func (h *run) compactRefuse(ps attention.Parsed) {
	pf := h.p(h.id + ".precompact")
	in := attention.RefuseIn{Paid: ps.Paid, Msid: h.msid(ps)}
	if !ps.Paid && h.lstatFile(pf) {
		in.Precompact, _ = h.FS.ReadFile(pf, 4096)
		if in.Precompact == nil {
			in.Precompact = []byte{}
		}
	}
	in.TP, in.Trig = attention.PayloadTPTrig(ps, "")
	in.Scope = h.scopeRule
	if tf := h.p(h.id + ".turn.json"); h.lstatFile(tf) {
		in.TurnLine, _ = h.FS.ReadFile(tf, 0)
		if in.TurnLine == nil {
			in.TurnLine = []byte{}
		}
	}
	for _, n := range []string{".compactevents", ".compacteventsprev"} {
		var b []byte
		if f := h.p(h.id + n); h.lstatFile(f) {
			b, _ = h.FS.ReadFile(f, 0)
			if b == nil {
				b = []byte{}
			}
		}
		in.Events = append(in.Events, b)
	}
	refuse, _, _ := attention.RefuseVerdict(in)
	if !refuse || !h.preLine(ps, "refused") {
		return
	}
	h.compact.refused = h.print([]byte(attention.RefuseBlock+"\n")) == nil
}

// msid is the turn marker's session id: CLAUDE_CODE_SESSION_ID, else the payload's.
func (h *run) msid(ps attention.Parsed) string {
	if m := h.Getenv("CLAUDE_CODE_SESSION_ID"); m != "" {
		return m
	}
	return ps.Psid
}

// print writes what the run holds and b to stdout now, and answers the write's error (the refusal's block, the
// steer print and the SessionStart card each decide on it); later output is held again.
func (h *run) print(b []byte) error {
	h.out.Write(b)
	_, err := h.Stdout.Write(h.out.Bytes())
	h.out.Reset()
	return err
}

// preLine is `_hook_compact_pre_line [phase]`: one line on `.compactevents`, under the lock, rotated at
// PRECOMPACT_KEEP lines; true only for a line written. A written main `pre` line of an `auto` PreCompact owes the next
// prompt an anchor.
func (h *run) preLine(ps attention.Parsed, phase string) bool {
	f, prev, owe := h.p(h.id+".compactevents"), h.p(h.id+".compacteventsprev"), h.p(h.id+".anchor-owed")
	if h.compact.scope == nil {
		h.scopeVerdict(ps)
	}
	s, t := h.compact.scope.Scope, h.compact.scope.Transcript
	if h.compact.rule != nil {
		s, t = h.compact.rule.Scope, h.compact.rule.Transcript
	}
	line, ok := attention.PreLine(ps, h.NowMs(), s, t, phase)
	if !ok {
		return false
	}
	l := h.acquire(attention.CompactLockWait)
	if l == nil {
		return false
	}
	defer l.Close()
	if !h.generationOK() {
		return false
	}
	if h.isLink(prev) && h.canonical(l) {
		_ = h.rmf(prev)
	}
	okNode := func(p string) bool { return !h.present(p) || h.isRegularFollow(p) }
	written := false
	if !h.isLink(f) && !h.isLink(prev) && okNode(f) && okNode(prev) {
		n := 0
		if h.isRegularFollow(f) {
			b, _ := h.FS.ReadFile(f, 0)
			n = attention.FileLines(b)
		}
		rot := n >= attention.PrecompactKeep
		if rot && h.canonical(l) && h.FS.Rename(f, prev) == nil {
			rot = false
		}
		if !rot && h.canonical(l) && h.FS.AppendFile(f, []byte(line+"\n")) == nil {
			written = true
		}
		if written && attention.LineOwesAnchor(phase, line, ps) && !h.isLink(owe) && okNode(owe) {
			_ = h.FS.WriteFile(owe, []byte("0\n"), 0o666)
		}
	}
	return written
}

// isRegularFollow is `[[ -f p ]]`.
func (h *run) isRegularFollow(p string) bool {
	st, err := h.FS.Stat(p)
	return err == nil && st.Mode().IsRegular()
}

// compactPre is `_hook_compact_pre`: the scope and the graph measured unlocked; under the lock the overlap verdict,
// the aged exact-family sweep and the set; the helper unlocked; under the lock again, the compare-and-swap of its
// stages onto the card and the set.
func (h *run) compactPre(ps attention.Parsed, reserve int) {
	if h.exists(h.ccrc("compact-card-off")) || h.compact.refused {
		return
	}
	set, cardf := h.p(h.id+".compactset"), h.p(h.id+".compactcard")
	mins := attention.CompactCardMaxAge / 60
	tp, ok := attention.PayloadRaw(ps, "transcript_path", nil)
	if !ok {
		return
	}
	trig, ok := attention.PayloadRaw(ps, "trigger", "auto")
	if !ok {
		trig = "auto"
	}
	s := h.scopeRule(tp, trig)
	if !s.OK {
		return
	}
	g, rc := attention.MeasureGraph(ps.Payload, h.graphIO())
	l := h.acquire(attention.CompactLockWait)
	if l == nil {
		return
	}
	if !h.generationOK() {
		l.Close()
		return
	}
	ovl := false
	if h.overlap(mins) {
		rule := s
		h.compact.rule = &rule
		s = attention.Scope{Scope: "ambiguous", LiveN: s.LiveN, ParentLive: s.ParentLive, OK: true}
		h.compact.scope = &s
		ovl = true
	}
	if !h.canonical(l) {
		l.Close()
		return
	}
	if s.Scope == "ambiguous" {
		_ = h.rmf(cardf)
	}
	aged := h.agedResidue(mins)
	if !h.canonical(l) {
		l.Close()
		return
	}
	for _, c := range aged {
		if attention.FamilySweepable(strings.TrimPrefix(filepath.Base(c), "."+h.id+".")) {
			_ = h.rmf(c)
		}
	}
	at := h.NowMs()
	nonce := attention.CompactNonce(at, h.Pid, h.Rand(), h.Rand())
	doc := attention.SetDoc(attention.SetIn{At: at, Nonce: nonce, S: s, Overlap: ovl, CWD: g.CWD, Built: g.Built, Fresh: g.Fresh})
	if !h.canonical(l) || !h.writeAtomic(set, nonce, doc) {
		l.Close()
		return
	}
	l.Close() // released before the helper runs, which must never hold the row's mutex
	if s.Scope == "ambiguous" || rc != 0 || !g.GateTree() {
		return
	}
	helper := filepath.Join(h.reg, "compact-card.mjs")
	if !h.isRegularFollow(helper) {
		return
	}
	setstage := h.p("." + h.id + ".compactset." + strconv.Itoa(h.Pid) + "." + nonce + ".stage")
	cardstage := h.p("." + h.id + ".compactcard." + strconv.Itoa(h.Pid) + "." + nonce + ".stage")
	hrc := 127
	if h.hasTimeout() {
		hrc = h.Run(attention.CompactHelperTimeout, nil, nil, false, "node",
			append([]string{helper}, attention.HelperCardArgs(s, g.CWD, g.Built, g.Fresh, setstage, cardstage, nonce, at, reserve)...)...).Rc
	}
	drop := func() {
		for _, p := range []string{cardstage, setstage, cardstage + ".part", setstage + ".part"} {
			_ = h.rmf(p)
		}
	}
	l = h.acquire(attention.CompactLockWait)
	if l == nil {
		return
	}
	defer l.Close()
	if !h.generationOK() || !h.fileReadable(set) {
		drop()
		return
	}
	head, _ := h.FS.ReadFile(set, 7*4096) // shortcut: 4,096 characters of up to six bytes (charLen); a set holding NUL bytes past the cap reads short, and no writer puts one there
	if !h.canonical(l) {
		drop()
		return
	}
	if n, ok := attention.HeadNonce(head, h.utf8); ok && n == nonce {
		switch hrc {
		case 0:
			_ = h.FS.Rename(cardstage, cardf)
			if !h.canonical(l) {
				drop()
				return
			}
			_ = h.FS.Rename(setstage, set)
		case 3:
			_ = h.FS.Rename(setstage, set)
		}
	}
	drop()
}

// overlap is `#@compact-pre-overlap-find`: an unconsumed canonical set, or a PostCompact claim, younger than the window.
// D-TBD-go-hook-overlap-claim-glob: the claim is matched by its prefix and suffix, so `.<id>.compactpost.claim` (the two
// overlapping, which find's `-name ".<id>.compactpost.*.claim"` refuses) counts here too. Stricter: such a name, which
// nothing writes, degrades this set to ambiguous where the bash would publish it whole; Go never publishes where the bash
// degrades (the id gate admits no glob character, so `-name` reads it literally).
func (h *run) overlap(mins int) bool {
	names, _ := h.FS.ReadDirNames(h.reg)
	for _, n := range names {
		if n == h.id+".compactset" || strings.HasPrefix(n, "."+h.id+".compactpost.") && strings.HasSuffix(n, ".claim") {
			if h.youngFind(h.p(n), mins) {
				return true
			}
		}
	}
	return false
}

// agedResidue is the sweep's `find "$REG" -maxdepth 1 -name ".<id>.*" -mmin +<mins>`.
func (h *run) agedResidue(mins int) []string {
	var out []string
	names, _ := h.FS.ReadDirNames(h.reg)
	for _, n := range names {
		if !strings.HasPrefix(n, "."+h.id+".") {
			continue
		}
		if t, ok := h.mtime(h.p(n)); ok && attention.Older(h.now(), t, mins) {
			out = append(out, h.p(n))
		}
	}
	return out
}

// historyScope is `_hook_history_scope`: `scope/<id>` holds `<scope> <psid> <ms>` when a verdict was reached, written
// only over a regular file or nothing.
func (h *run) historyScope(ps attention.Parsed) {
	f := filepath.Join(h.home, ".ccrc", "history", vocab.ScopeDir, h.id)
	if attention.Chars(h.id, h.utf8) > 224 || !attention.IsUUID(ps.Psid) {
		return
	}
	line, ok := attention.ScopeMarker(h.id, ps.Psid, h.csScope(ps).Scope, h.NowMs(), h.utf8)
	if !ok || h.special(f) {
		return
	}
	_ = h.FS.WriteFile(f, []byte(line), 0o666)
}

// historyPre is `_hook_history_pre`: the steer print on an armed, main PreCompact, then its receipt on the spool.
func (h *run) historyPre(ps attention.Parsed) {
	root := filepath.Join(h.home, ".ccrc", "history")
	text, leaf, ok := attention.Steer(attention.SteerIn{Paid: ps.Paid, Refused: h.compact.refused,
		Off: h.exists(h.ccrc("history-off")), SteerOff: h.exists(h.ccrc("history-steer-off")),
		Withheld: func() bool { return attention.RecallWithheld(h.id, ps.Psid, h.historyIO(), h.utf8) },
		ID:       h.id, Psid: ps.Psid, UTF8: h.utf8,
		SteerOn: h.lstatFile(filepath.Join(root, "steer-on", h.id)),
		Scope:   func() string { return h.csScope(ps).Scope },
		Read:    func() (string, string, bool) { return attention.SteerRead(h.steerFile(root, ps.Psid)) }})
	if !ok {
		return
	}
	role := h.roleCompactText()
	if h.print([]byte(attention.SteerPrint(role, text))) != nil {
		return
	}
	spool := filepath.Join(root, "spool")
	if !h.dirNoLink(spool) {
		return
	}
	j := attention.SteerReceipt(h.id, ps.Psid, leaf, h.Getenv("CCRC_SESSION_GENERATION"), h.NowMs())
	_ = h.FS.AppendRegular(filepath.Join(spool, h.id+".jsonl"), []byte("\n"+j+"\n"))
}

// steerFile is `_hook_history_steer_read`'s tests of the steer file, as it makes them.
func (h *run) steerFile(root, psid string) attention.SteerFile {
	d := filepath.Join(root, "steer")
	sd := filepath.Join(d, h.id)
	sf := filepath.Join(sd, psid+".txt")
	var f attention.SteerFile
	f.Link = h.isLink(d) || h.isLink(sd) || h.isLink(sf)
	bad := func(p string) bool { return h.exists(p) && !(h.isDirFollow(p) && h.FS.Executable(p)) }
	f.DirBad = bad(d) || bad(sd)
	if f.Link || f.DirBad {
		return f
	}
	if !h.exists(sf) {
		f.Absent = true
		return f
	}
	if h.isRegularFollow(sf) && h.FS.Readable(sf) {
		f.ReadableFile = true
		f.Bytes, _ = h.FS.ReadFile(sf, 8193)
	}
	return f
}

// roleCompactText is `_hook_role_compact_text`: the route's profile and window, then COMPACT_TEXT_JQ's answer over the
// launch-profile projection (the lib/ beside the core first, then the installed one).
func (h *run) roleCompactText() string {
	pf, wf := h.p(h.id+".profile"), h.p(h.id+".compactwindow")
	if !h.lstatFile(pf) || !h.lstatFile(wf) {
		return ""
	}
	pb, _ := h.FS.ReadFile(pf, 4096)
	wb, _ := h.FS.ReadFile(wf, 4096)
	p, ok := attention.RoleCompactProfile(pb, wb)
	if !ok {
		return ""
	}
	f := filepath.Join(h.LibDir, "launch-profiles.json")
	if h.LibDir == "" || !h.isRegularFollow(f) {
		f = filepath.Join(h.reg, "lib", "launch-profiles.json")
	}
	b, err := h.FS.ReadFile(f, 0)
	if err != nil {
		return ""
	}
	return attention.RoleCompactText(b, p)
}

// ---------------------------------------------------------------------------------------------------- PostCompact

// compactPost is `_hook_compact_post`: settle (claim the set by `link`, take its age, unlink canonical, stamp and
// snapshot the claim through its retained descriptor), measure unlocked, then under the reacquired lock commit one
// journal record by stage and rename; the claim and the served marker are consumed only on that commit.
func (h *run) compactPost(ps attention.Parsed) {
	if h.exists(h.ccrc("compact-card-off")) {
		return
	}
	set, journal := h.p(h.id+".compactset"), h.p(h.id+".compactions")
	summary, ok := attention.PayloadRaw(ps, "compact_summary", nil)
	if !ok || summary == "" {
		return
	}
	trig, ok := attention.PayloadRaw(ps, "trigger", "auto")
	if !ok || trig != "manual" && trig != "auto" {
		trig = "auto"
	}
	helper := filepath.Join(h.reg, "compact-card.mjs")
	if !h.Found("find") || !h.Found("touch") || !h.Found("mktemp") || !h.isRegularFollow(helper) {
		return
	}
	l := h.acquire(attention.CompactLockWait)
	if l == nil {
		return
	}
	if !h.generationOK() {
		l.Close()
		return
	}
	var claim, snap string
	var claimFD Held
	aged := false
	if h.present(set) {
		if claim, snap, claimFD, aged, ok = h.settle(l, set); !ok {
			l.Close()
			return
		}
	}
	l.Close()
	closeClaim := func() {
		if claimFD != nil {
			claimFD.Close()
			claimFD = nil
		}
	}
	norm := ""
	var snapBytes []byte
	if snap != "" {
		snapBytes, _ = h.FS.ReadFile(snap, 0)
		norm = attention.PostNorm(snapBytes, aged, trig)
	}
	args := []string{helper, "measure"}
	if snap != "" && norm == "" {
		args = append(args, "--set", snap)
	}
	args = append(args, "--trigger", trig)
	meas := ""
	if h.hasTimeout() {
		if r := h.Run(attention.CompactHelperTimeout, []byte(summary), nil, false, "node", args...); r.Rc == 0 {
			meas = r.Sub()
		}
	}
	if !attention.MeasOne(meas) {
		closeClaim()
		if snap != "" {
			_ = h.rmf(snap)
		}
		return
	}
	stage := ""
	fail := func() {
		closeClaim()
		if stage != "" {
			_ = h.rmf(stage)
		}
		if snap != "" {
			_ = h.rmf(snap)
		}
	}
	l = h.acquire(attention.CompactLockWait)
	if l == nil {
		closeClaim()
		if snap != "" {
			_ = h.rmf(snap)
		}
		return
	}
	defer l.Close()
	if !h.generationOK() {
		fail()
		return
	}
	served, nonce := false, ""
	if snap != "" {
		if cand, ok := attention.HeadNonce(snapBytes, h.utf8); ok && attention.SafeNonce(cand) {
			nonce = cand
			served = h.lstatFile(h.p("." + h.id + ".compactserved." + nonce))
		}
	}
	rec, ok := attention.Record(meas, snapBytes, snap != "" && norm == "", served, norm)
	if !ok || !attention.RecordOK(rec) {
		fail()
		return
	}
	if stage = h.fresh("compactions-stage", ".tmp"); stage == "" {
		fail()
		return
	}
	if h.FS.CreateExcl(stage, 0o600) != nil {
		stage = ""
		fail()
		return
	}
	if !h.lstatFile(stage) {
		fail()
		return
	}
	var jfd Held
	old := ""
	if h.present(journal) {
		if !h.fileReadable(journal) {
			fail()
			return
		}
		fd, err := h.Lock.Open(journal)
		if err != nil {
			fail()
			return
		}
		jfd = fd
		b, err := jfd.ReadAll()
		if err != nil || h.FS.WriteFile(stage, b, 0o600) != nil {
			jfd.Close()
			fail()
			return
		}
		old = strings.ReplaceAll(string(b), "\x00", "") // `$(cat …; printf x)` keeps no NUL byte
	}
	if h.FS.AppendFile(stage, []byte(rec+"\n")) != nil {
		if jfd != nil {
			jfd.Close()
		}
		fail()
		return
	}
	sb, _ := h.FS.ReadFile(stage, 0)
	if !attention.StageOK(sb, old, rec) {
		if jfd != nil {
			jfd.Close()
		}
		fail()
		return
	}
	if jfd != nil {
		same := jfd.Same(journal)
		jfd.Close()
		if !same {
			fail()
			return
		}
	} else if h.present(journal) {
		fail()
		return
	}
	if !h.canonical(l) || h.FS.Rename(stage, journal) != nil {
		fail()
		return
	}
	if claim != "" && claimFD != nil && claimFD.Same(claim) {
		_ = h.rmf(claim)
	}
	closeClaim()
	if snap != "" {
		_ = h.rmf(snap)
	}
	if nonce != "" {
		_ = h.rmf(h.p("." + h.id + ".compactserved." + nonce))
	}
}

// settle is the PostCompact settlement under the held lock: the set claimed by `link` (never precreated), its age
// measured before anything stamps it, canonical unlinked, the claim stamped, and a private snapshot copied from the
// claim's retained descriptor. ok false returns at once, the lock to be released by the caller; on a failed stamp the
// canonical set is restored by no-clobber `link` only.
func (h *run) settle(l Held, set string) (claim, snap string, fd Held, aged, ok bool) {
	if !h.fileReadable(set) {
		return "", "", nil, false, false
	}
	if claim = h.fresh("compactpost", ".claim"); claim == "" {
		return "", "", nil, false, false
	}
	if h.FS.Link(set, claim) != nil {
		return "", "", nil, false, false
	}
	if !h.sameFile(claim, set) {
		_ = h.rmf(claim)
		return "", "", nil, false, false
	}
	aged = !h.youngFind(set, attention.CompactCardMaxAge/60)
	if !h.canonical(l) {
		_ = h.rmf(claim)
		return "", "", nil, false, false
	}
	if h.rmf(set) != nil {
		_ = h.rmf(claim)
		return "", "", nil, false, false
	}
	if !h.canonical(l) {
		return "", "", nil, false, false
	}
	if h.FS.Touch(claim) != nil {
		if h.canonical(l) && h.FS.Link(claim, set) == nil && h.sameFile(claim, set) {
			_ = h.rmf(claim)
		}
		return "", "", nil, false, false
	}
	fd, err := h.Lock.Open(claim)
	if err != nil {
		return "", "", nil, false, false
	}
	if snap = h.fresh("compactions-snapshot", ".tmp"); snap == "" || h.FS.CreateExcl(snap, 0o600) != nil || !h.lstatFile(snap) {
		fd.Close()
		return "", "", nil, false, false
	}
	b, err := fd.ReadAll()
	if err != nil || h.FS.WriteFile(snap, b, 0o600) != nil {
		fd.Close()
		_ = h.rmf(snap)
		return "", "", nil, false, false
	}
	return claim, snap, fd, aged, true
}

// sameFile is `[[ a -ef b ]]`.
func (h *run) sameFile(a, b string) bool {
	x, err1 := h.FS.Stat(a)
	y, err2 := h.FS.Stat(b)
	return err1 == nil && err2 == nil && os.SameFile(x, y)
}

// ---------------------------------------------------------------------------------------------------- SessionStart

// compactCard is `_hook_compact_card`: under the serve lock, the card claimed and served once to its set; the lock is
// retained past the return only when a card is going to be printed (serveHeld).
func (h *run) compactCard() string {
	if h.exists(h.ccrc("compact-card-off")) {
		return ""
	}
	l := h.acquire(attention.CompactLockWaitServe)
	if l == nil {
		return ""
	}
	if !h.generationOK() {
		l.Close()
		return ""
	}
	body := h.compactCardLocked(l)
	if body != "" {
		h.compact.serveHeld = l
		return body
	}
	l.Close()
	return ""
}

// compactCardLocked is `_hook_compact_card_locked`.
func (h *run) compactCardLocked(l Held) string {
	f, set := h.p(h.id+".compactcard"), h.p(h.id+".compactset")
	if !h.fileReadable(f) || !h.Found("find") {
		return ""
	}
	if !h.youngFind(f, attention.CompactCardMaxAge/60) {
		if h.canonical(l) {
			_ = h.rmf(f)
		}
		return ""
	}
	if !h.fileReadable(set) {
		return ""
	}
	head, _ := h.FS.ReadFile(set, 7*4096) // shortcut: 4,096 characters of up to six bytes (charLen); a set holding NUL bytes past the cap reads short, and no writer puts one there
	nonce, ok := attention.HeadNonce(head, h.utf8)
	if !ok || !attention.SafeNonce(nonce) {
		return ""
	}
	claim := h.p("." + h.id + ".compactcard." + strconv.Itoa(h.Pid) + "." + nonce + ".session-claim.tmp")
	if h.FS.CreateExcl(claim, 0o666) != nil {
		return ""
	}
	if !h.canonical(l) {
		_ = h.rmf(claim)
		return ""
	}
	if h.FS.Rename(f, claim) != nil {
		_ = h.rmf(claim)
		return ""
	}
	raw, _ := h.FS.ReadFile(claim, 7*(attention.CompactCardMaxChars+64)) // shortcut: as the head read above; the helper writes no NUL
	body, serve, _ := attention.ServeCard(raw, nonce, h.utf8)
	if !serve {
		if !h.canonical(l) {
			return "" // the claim is retained: the only copy of the card's bytes
		}
		_ = h.FS.Link(claim, f)
		_ = h.rmf(claim)
		return ""
	}
	_ = h.rmf(claim)
	h.compact.serveNonce = nonce
	return body
}

// markServed is `_hook_compact_mark_served`: after the print, inside the retained section, the served marker
// published by `link` off a private source (no-clobber: a same-nonce marker stands).
func (h *run) markServed() {
	n := h.compact.serveNonce
	if n == "" || !h.generationOK() || !h.Found("mktemp") {
		return
	}
	src, ok := h.Lock.Mktemp(h.p("." + h.id + ".compactserved-source." + n + "."))
	if !ok {
		return
	}
	if h.lstatFile(src) {
		_ = h.FS.Link(src, h.p("."+h.id+".compactserved."+n))
	}
	_ = h.rmf(src)
}

// serveEnd is `_hook_compact_serve_end`: the retained serve lock's one release, on every SessionStart.
func (h *run) serveEnd() {
	if h.compact.serveHeld != nil {
		h.compact.serveHeld.Close()
		h.compact.serveHeld = nil
	}
}

// rmf is `rm -f p` of one name: nothing standing there is success, a directory is refused (rm without -r), anything
// else is unlinked.
func (h *run) rmf(p string) error {
	st, err := h.FS.Lstat(p)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return err
	}
	if st.IsDir() {
		return errors.New("rm: is a directory")
	}
	if err := h.FS.Remove(p); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}
