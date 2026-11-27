package hook

import (
	"strconv"
	"strings"

	"ccrc/core/internal/domain/attention"
)

// startSend is `_hook_start_send`: one report through the closed client within the deadline, as an outcome code.
func (h *run) startSend(body string, dl int64, verb string) int {
	left := dl - h.NowMs()
	if left < 1000 {
		return attention.SendNoTime
	}
	r := h.api(attention.Seconds(left), []byte(body+"\n"), true, []string{"CCRC_API_STATUS=line"}, "sessions", verb, h.id, "--json", "-")
	h.note(r)
	return attention.SendOutcome(r.Rc, r.Sub())
}

// startReport is tail stage 9, `_hook_start_report`: the fresh report of a main-thread, non-child SessionStart (a fork
// excepted) and a pass over the kept ones, both inside what the invocation's one budget has left.
func (h *run) startReport(ps attention.Parsed, c attention.Class) {
	f := h.p(h.id + ".startpending")
	child := h.p(h.id + ".child")
	if !attention.StartEligible(ps.Event, ps.Paid, h.id, h.isRegular(h.p(h.id+".generation")), h.isLink(f), h.exists(child), h.isLink(child)) {
		return
	}
	left := attention.StartLeft(h.net.Bound(h.NowMs(), attention.StartBudgetMs))
	now := h.NowMs()
	dl := now + left
	var after, drop int64
	var kept []attention.Kept
	if h.isRegular(f) {
		if b, err := h.FS.ReadFile(f, 0); err == nil {
			after, drop, kept = attention.ParsePending(b)
		}
	}
	p := attention.NewPass(after, drop, now, ps.Psid)
	body, rc := "", attention.SendUnsent
	if attention.FreshDue(ps.Event, c.Src) {
		rid := attention.Rid(now, h.Pid, h.Rand())
		if attention.LoadsPendDue(h.Getenv("CCRC_LAUNCH_PROFILE"), c.Src) {
			h.loadsPend(rid, ps, c.Src)
		}
		body = string(attention.StartBody(ps.Payload, h.id, rid, h.Getenv("CCRC_SESSION_GENERATION"), h.Getenv("CCRC_DOOR_NONCE_SHA256"), now))
		rc = h.startSend(body, dl, "start")
		p.Fresh(rc)
	}
	p.Resends(kept, ps.Psid, func(j string) int { return h.startSend(j, dl, "start") })
	if body != "" {
		p.Keep(0, body, rc)
	}
	text, remove := p.Finish(h.NowMs(), rc == attention.SendTaken)
	if remove {
		_ = h.FS.Remove(f)
		return
	}
	tmp := f + strconv.Itoa(h.Pid)
	if h.FS.WriteFile(tmp, []byte(text), 0o666) != nil || h.FS.Rename(tmp, f) != nil {
		_ = h.FS.Remove(tmp)
	}
	if !h.exists(h.p(h.id + ".generation")) { // a purge during the send: side (a); `_reg_purge` is side (b)
		_ = h.FS.Remove(f)
	}
}

// loadsPend is `_hook_loads_pend`: `$REG/<id>.loadpending`, written without the registry lock and looked at again.
func (h *run) loadsPend(rid string, ps attention.Parsed, src string) {
	path := attention.TranscriptPath(ps.Payload)
	if !strings.HasPrefix(path, "/") {
		return
	}
	var size int64
	if st, err := h.FS.Stat(path); err == nil && st.Mode().IsRegular() {
		size = st.Size()
	}
	f := h.p(h.id + ".loadpending")
	_ = h.FS.WriteFile(f, []byte(attention.LoadPendLine(rid, size, src, path)), 0o666)
	if !h.exists(h.p(h.id + ".generation")) {
		_ = h.FS.Remove(f)
	}
}

// startLoads is tail stage 23, `_hook_start_loads` (D-TBD-go-hook-start-loads-seam: its suite moved from a `timeout` PATH
// shim to a `jq` shim plus a client that exits 124, which reaches the same `$? == 124` in both hooks):at a main-thread Stop while `loadpending` stands, the module
// `start_loads` (a jq process) reads the transcript, the instruction files are hashed, and the report is sent.
func (h *run) startLoads(ps attention.Parsed, payload string) {
	f := h.p(h.id + ".loadpending")
	if !attention.LoadsDue(ps.Event, ps.Paid, h.regular(f)) {
		return
	}
	lp := h.Getenv("CCRC_LAUNCH_PROFILE")
	if lp == "" {
		_ = h.FS.Remove(f)
		return
	}
	dl := h.NowMs() + attention.LoadsBudgetMs
	raw, _ := h.FS.ReadFile(f, 0)
	lf := attention.ParseLoads(raw)
	if !attention.LoadsKeepGoing(lp, lf) {
		_ = h.FS.Remove(f)
		return
	}
	off, _ := strconv.ParseInt(lf.Off, 10, 64)
	ver := attention.LoadsVer(h.Getenv("CLAUDE_CODE_EXECPATH"))
	we, body := lf.We, lf.Body
	lib := h.lib()
	if body == "" {
		var ll attention.LoadLast
		carried := false
		if h.isRegular(h.p(h.id + ".loadlast")) {
			if b, err := h.FS.ReadFile(h.p(h.id+".loadlast"), 0); err == nil {
				ll = attention.ParseLoadLast(b)
				carried = ll.Carried(lf.Sc, lf.Tp, lp, ver, off)
			}
		}
		out := ""
		if st, err := h.FS.Stat(lf.Tp); err == nil && attention.LoadsWindowReadable(st.Mode().IsRegular(), st.Size()) {
			out = h.loadsRead(lf, carried, ll, dl, lib)
		}
		if end, ok := attention.ReadyEnd(out); ok {
			we = strconv.FormatInt(off+end, 10)
			hs := h.loadsHashes(out, lib)
			wd := ""
			if h.isRegular(h.p(h.id + ".workdir")) { // `[[ -f ]]`: a FIFO is never opened
				if b, err := h.FS.ReadFile(h.p(h.id+".workdir"), 0); err == nil {
					wd = firstLine(b)
				}
			}
			cf := ""
			if carried {
				cf = ll.Lr
			}
			args := []string{"-L", lib, "-c", "--argjson", "o", out, "--arg", "id", h.id, "--arg", "rid", lf.Rid, "--arg", "lp", lp,
				"--arg", "rc", h.Getenv("CCRC_LAUNCH_RC"), "--arg", "ver", ver, "--arg", "wd", wd, "--arg", "cf", cf,
				"--argjson", "at", strconv.FormatInt(h.NowMs(), 10),
				`include "transcript"; loads_body($o; $ARGS.positional; $id; $rid; $lp; $rc; $ver; $wd; $cf; $at)`, "--args"}
			jb := h.Run(0, []byte(payload+"\n"), nil, false, "jq", append(args, hs...)...)
			body = jb.Sub()
			if jb.Rc != 0 {
				body = ""
			}
		}
	}
	r := attention.SendUnsent
	if attention.SendReady(body, we) {
		r = h.startSend(body, dl, "loads")
	}
	a := attention.LoadsEnd(lf, r, body, we, lp, ver)
	switch {
	case a.Remove:
		_ = h.FS.Remove(f)
		if a.LastLine != "" {
			_ = h.FS.WriteFile(h.p(h.id+".loadlast"), []byte(a.LastLine), 0o666)
		}
	default:
		_ = h.FS.WriteFile(f, []byte(a.Keep), 0o666)
	}
	if !h.exists(h.p(h.id + ".generation")) {
		_ = h.FS.Remove(f)
		_ = h.FS.Remove(h.p(h.id + ".loadlast"))
	}
}

// loadsRead is the module's `start_loads` run over the transcript's windows, within the deadline: its output as `$( )`
// keeps it, whatever the exit. The windows reach jq as files that are pipes where the platform has them.
func (h *run) loadsRead(lf attention.LoadsFile, carried bool, ll attention.LoadLast, dl int64, lib string) string {
	if !h.hasTimeout() {
		return ""
	}
	data, err := h.FS.ReadFile(lf.Tp, 0)
	if err != nil {
		return ""
	}
	off, _ := strconv.ParseInt(lf.Off, 10, 64)
	win := func(from, to int64) []byte { // tail -c +from+1 | head -c to-from
		n := int64(len(data))
		from, to = min(from, n), min(to, n)
		return data[from:max(from, to)]
	}
	var cwin []byte
	if carried {
		lo, _ := strconv.ParseInt(ll.Lo, 10, 64)
		le, _ := strconv.ParseInt(ll.Le, 10, 64)
		cwin = win(lo, le)
	}
	r := h.RunWith(attention.Left(dl, h.NowMs()), [][]byte{win(0, off), win(off, int64(len(data))), cwin}, "jq", "-L", lib, "-nc",
		"--rawfile", "h", "@fd0", "--rawfile", "w", "@fd1", "--rawfile", "c", "@fd2", "--arg", "s", lf.Sc, "--argjson", "last", attention.LoadsLast(lf.T),
		`include "transcript"; start_loads($h; $w; $c; $s; $last == 1)`)
	return r.Sub() // the bash's `$( )` here sets no HOOK_NET_HUNG
}

// loadsHashes is the loop over `loads_hash_items`: each listed instruction file hashed where it stands (a regular file of
// at most LoadsFileMax bytes, else `x`), each hook command by its text.
func (h *run) loadsHashes(out, lib string) []string {
	r := h.Run(0, []byte(out+"\n"), nil, false, "jq", "-L", lib, "-j", `include "transcript"; loads_hash_items`)
	var hs []string
	items := strings.Split(string(r.Out), "\x00")
	for _, e := range items[:len(items)-1] {
		if strings.HasPrefix(e, "F") {
			p := e[1:]
			st, err := h.FS.Stat(p)
			var size int64
			if err == nil {
				size = st.Size()
			}
			// `cat` under `_hook_timeout` and pipefail: no timeout binary, or a read that fails, digests as `x`
			// (D-TBD-go-hook-reads-unbounded: the read itself is not bounded here)
			if !attention.HashReadable(err == nil, err == nil && st.Mode().IsRegular(), size, h.hasTimeout()) {
				hs = append(hs, "x")
				continue
			}
			b, rerr := h.FS.ReadFile(p, 0)
			if rerr != nil {
				hs = append(hs, "x")
				continue
			}
			hs = append(hs, attention.Sha256Hex(b))
		} else {
			hs = append(hs, attention.Sha256Hex([]byte(strings.TrimPrefix(e, "C"))))
		}
	}
	return hs
}
