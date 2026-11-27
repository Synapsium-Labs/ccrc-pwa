package attention

import (
	"strconv"
	"strings"
	"unicode/utf8"
)

// The two Oniguruma deny arms of the PreToolUse stage (ccd/session-hook.sh): the worker merge deny and the child's
// approval-surface, forbidden-verb and build deny with the account, quiz and prune rows on every session. Each decides
// from the payload and the reads PreReads answers when asked, as the bash asks them.

// RegRead is `_ct_read <path>`'s inputs: rc 0 read (the bytes), 1 absent, 2 not a readable regular file.
type RegRead func(name string) ([]byte, int)

const (
	holdMax       = 127 // CCRC_HOLD_MAX
	idMax         = 128 // CCRC_ID_MAX
	projMax       = 64  // CCRC_PROJ_MAX
	apfStripMax   = 8192
	apfDenyBytes  = 65536
	holdWaveRESrc = `^program:[A-Za-z0-9._-]+ wave:[0-9]+(/[0-9]+)?( run:[0-9]+)?$`
	apfEnvRESrc   = `(^|[^A-Za-z0-9_.-])env([^A-Za-z0-9_.=-]|$)`
)

var (
	// glibc's ERE without REG_NEWLINE: `^` and `$` are the text's ends, which Go's Perl mode reads them as.
	holdWaveRE = re(holdWaveRESrc)
	apfEnvRE   = re(apfEnvRESrc)
)

// ctRead is `_ct_read`'s CT_V and CT_RAWN: at most CCRC_ID_MAX characters (bytes in a C locale), NUL bytes not read, then
// trimmed of [[:space:]] at both ends as bash's patterns read the class (glibcSpace).
func ctRead(b []byte, utf bool) (string, int) {
	s := Clip(strings.ReplaceAll(string(b), "\x00", ""), idMax, utf)
	n := Chars(s, utf)
	isSp := func(r rune) bool { return glibcSpace(r, utf) }
	return strings.TrimRightFunc(strings.TrimLeftFunc(s, isSp), isSp), n
}

// MergeDeny is the worker merge deny (D-4934's sibling, landing-order R5 and D-7249): a Bash call whose payload names a
// merge, read through MERGE_STRIP_JQ (MergeStrip) and the three head EREs; the envelope, or "".
func MergeDeny(in PreIn, rd PreReads) string {
	p := in.Payload
	if in.Tool != "Bash" || !(strings.Contains(p, "merge") || strings.Contains(p, "Merge") || strings.Contains(p, "enqueuePullRequest")) {
		return ""
	}
	out, ok := MergeStrip(in.V)
	mout := ""
	if ok {
		mout = cmdSubst(out + "\n")
	}
	var mcmd, mover, mkinds, mflags string
	switch {
	case strings.HasPrefix(mout, "=") && strings.Contains(mout, "\x1f"):
		mflags, mcmd, _ = strings.Cut(mout, "\x1f")
		mflags = strings.TrimPrefix(mflags, "=")
	case strings.HasPrefix(mout, "!") && strings.Contains(mout, ":"):
		mover, mkinds, _ = strings.Cut(mout[1:], ":")
	}
	var mmerge, madmin, mapi bool
	if mover != "" {
		k := "," + mkinds + ","
		mmerge, madmin, mapi = strings.Contains(k, ",merge,"), strings.Contains(k, ",admin,"), strings.Contains(k, ",api,")
	} else if mcmd != "" {
		if GhMerge().MatchString(mcmd) {
			mmerge = true
			madmin = strings.Contains(mflags, "a")
		}
		if !mmerge && CcdDoor().MatchString(mcmd) {
			mmerge = true
		}
		mapi = (strings.Contains(mflags, "w") || strings.Contains(mflags, "p")) && GhAPI().MatchString(mcmd)
	}
	mbypass := madmin || mapi
	if !mmerge && !mbypass {
		return ""
	}
	mwhy := ""
	if mmerge {
		if b, rc := rd.Reg(in.ID + ".hold"); rc == 0 {
			if v, _ := ctRead(b, in.UTF8); Chars(v, in.UTF8) <= holdMax && holdWaveRE().MatchString(v) {
				mwhy = "this workspace's hold reads `" + v + "` — a programme wave's session"
			}
		}
		if mwhy == "" && rd.Exists(in.ID+".child") {
			mwhy = "this workspace carries the child marker — a dispatched child, whose run has let it go"
		}
	}
	cap := strconv.Itoa(MergeParseCap)
	switch {
	case mwhy != "" && mover != "":
		return DenyJSON("ccrc: this command is " + mover + " bytes, over the merge deny's " + cap + "-byte parse cap, and its raw text reads as a `gh … pr … merge` command, so the deny cannot read whether it runs one; " + mwhy + ", and a wave's session never merges (landing-order R5: the coordinator merges, workers never do)." +
			" Split it into commands of at most " + cap + " bytes, or rephrase it so its text does not read as a `gh … pr … merge` command (prose that names gh, pr and merge in that order reads as one, a mail or PR body that quotes it included): write a long mail body to a file with the Write tool and send it with `ccrc-api mail send --json <file>`, which keeps the command short, or a long PR body to a file for `gh pr create --body-file <file>`. A landing is the operator's, from their own shell.")
	case mwhy != "":
		return DenyJSON("ccrc: " + mwhy + ", and a wave's session never merges (landing-order R5: the coordinator merges, workers never do)." +
			" Report wave-done to your coordinator; it lands the PR.")
	case !mbypass:
		return ""
	}
	mallow := false
	if mover == "" && !mapi && strings.Contains(mflags, "s") {
		if b, rc := rd.Reg(in.ID + ".project"); rc == 0 {
			if v, rawn := ctRead(b, in.UTF8); v != "" && projClass(v) && Chars(v, in.UTF8) <= projMax && rawn < idMax && rd.AdminAllowed(v) {
				mallow = true
			}
		}
	}
	const door = " In a repository where the fleet's GitHub identity is an admin and no merge queue applies, a coordinator lands a PR stopped only by `approval-missing` through `ccd pr-admin-merge --repo <owner/repo> --pr <n> --head <sha>`, which checks every condition itself and journals the merge (D-8124)."
	if mover != "" {
		mread := ""
		if madmin {
			mread = "a `gh … pr … merge` command that names `--admin`"
		}
		if mapi {
			if mread != "" {
				mread += " and "
			}
			mread += "a `gh … api` command that names a merge mutation or `/merge`"
		}
		return DenyJSON("ccrc: `--admin` and `gh api` merges are refused in every session, and this command is " + mover + " bytes, over the deny's " + cap + "-byte parse cap, and its raw text holds " + mread + ": the hook cannot tell prose from a command over the cap, so it refuses the text." +
			" Split it into commands of at most " + cap + " bytes, or write the text with the Write tool and pass it as a file (`--body-file <file>` for `gh pr create`, `ccrc-api mail send --json <file>` for a mail), which keeps the command short." +
			" A landing is `gh pr merge <n> --match-head-commit <sha>`, which enqueues the PR; a bypass is R9's door, the operator's own shell or GitHub's UI." + door)
	}
	if mallow {
		return ""
	}
	r := "ccrc: `--admin` and `gh api` merges are refused in every session: the merge queue is how a PR lands, and a bypass of it is not a session's to take (landing-order spec §5.2)." +
		" Land a PR with `gh pr merge <n> --match-head-commit <sha>`, which enqueues it, and read whether it merged with `gh pr view <n> --json state,mergedAt`. A bypass is R9's door: the operator's own shell or GitHub's UI." + door
	if mapi {
		r += " A `gh api` call is refused when its command names a merge mutation (`mergePullRequest`, `enqueuePullRequest`, `enablePullRequestAutoMerge`, `mergeBranch`) or a merge path (`repos/<o>/<r>/pulls/<n>/merge`, `repos/<o>/<r>/merges`), by any method, a GET included: the hook cannot tell a read of the merge path from a write, so `gh pr view <n> --json state,mergedAt` is how a session asks whether a PR merged." +
			" Note that the whole command is read, quoted text included, once it holds a `gh api` or merge command, so a real `gh api` call and an unrelated mention of a mutation word or merge path in one command is refused too: run them as separate commands, name an output file another way, or pass a body with `-F body=@<file>`."
	} else {
		r += " Note that the whole command is read, quoted text included, once it holds a merge or api command, so a real `gh pr merge` and an unrelated `--admin` in one command is refused too: run them as separate commands."
	}
	return DenyJSON(r)
}

// projClass is `case "$v" in *[!$CCRC_PROJ_CLASS]*) …`: every character in [A-Za-z0-9._-].
func projClass(v string) bool {
	for i := 0; i < len(v); i++ {
		c := v[i]
		if !(c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '.' || c == '_' || c == '-') {
			return false
		}
	}
	return true
}

var guardTools = map[string]bool{"Bash": true, "Write": true, "Edit": true, "MultiEdit": true, "NotebookEdit": true, "Read": true, "Grep": true, "Glob": true}

// AccountDeny is the child's deny (mode deny, a `$REG/<id>.child` row) and the account arm on every other session (mode
// account): the builtin prefilter over the payload's text, then APPROVAL_FORBIDDEN_JQ (Forbidden) with the deny file's
// text in deny mode; the envelope, or "".
func AccountDeny(in PreIn, rd PreReads) string {
	apf := in.Payload
	child := rd.Exists(in.ID + ".child")
	if in.Tool == "Bash" && strings.ContainsAny(apf, `'"\`) && (child || Chars(apf, in.UTF8) <= apfStripMax) {
		apf = strings.ReplaceAll(apf, `\\\n`, "")
		apf = strings.NewReplacer("'", "", `"`, "", `\`, "").Replace(apf)
	}
	c := func(w string) bool { return strings.Contains(apf, w) }
	quiz := quizWord(apf, in.UTF8)
	mode := "account"
	pass := false
	if child {
		mode = "deny"
		low := lower(apf, in.UTF8)
		pass = c("ccd") || c("ccrc") || c("approval") || c("install") || c("update") || c("upgrade") || c("respawn") ||
			c("anthropic-ai/claude-code") || strings.Contains(low, "downloads.claude.ai") || strings.Contains(low, "claude.ai/install") || c(".local") ||
			c(".cc-sessions") || c(".cc-secrets") || c("auth-scratch") || c("agent.env") || c("runtime.env") || c("printenv") || c("prune") ||
			c("account-op") || c("accounts.json") || c("accounts.sh") || quiz || c("quiz-record") || apfEnvRE().MatchString(apf)
	} else {
		pass = c("account") || c(".cc-secrets") || c("auth-scratch") || c("agent.env") || c("runtime.env") || c(".auth") || ccrcLinear(apf) ||
			c("operator-secrets") || c("operator-model.db") || c("privacy-journal") || c(".ccrc") || c(".door") || c("printenv") || c("prune") ||
			quiz || c("quiz-record") || apfEnvRE().MatchString(apf)
	}
	if !pass || !guardTools[in.Tool] {
		return ""
	}
	var deny *string
	if mode == "deny" {
		if b, ok := rd.DenyFile(); ok {
			if t, ok := DenyText(b); ok && t != "" {
				deny = &t
			}
		}
	}
	home := in.Home
	afw, ok := Forbidden(in.V, mode, deny, &home)
	if !ok {
		return ""
	}
	afw = cmdSubst(afw + "\n")
	cat, why, _ := strings.Cut(afw, "\t")
	if !strings.Contains(afw, "\t") {
		return ""
	}
	r := ""
	switch cat {
	case "verb":
		r = "ccrc: this call runs `" + why + "`, which a dispatched child never runs in any form (CLAUDE.md's SAFETY section; spec 2026-10-17 §6.6). It is the operator's act, and a top-level session's only after asking the operator." +
			" Report what you need to your coordinator instead."
	case "surface":
		r = "ccrc: this call reaches the approval surface (`ccrc-api approvals`, `/api/approvals`, a signing key or the verifier), which a dispatched child never calls, reads or writes: your coordinator rules on your permission prompts, and the operator on the rest." +
			" Carry on with your task; a prompt you raise reaches them by itself."
	case "account":
		r = "ccrc: this call is " + why + ": an account-management act no fleet session runs, in any form (CLAUDE.md's SAFETY section; spec 2026-10-18 §3.1; D-6202). Adding, signing in, checking, enabling, disabling or removing a fleet account, and reading its secrets, are the operator's, from the PWA's Accounts screen or their own shell. Switching accounts is never refused: `ccd swap-self <lane>`, `ccd prefer` and `ccd swap` stay open."
	case "quiz":
		r = "ccrc: this call runs `" + why + "`: the replay quiz's record, confirmation and status are the weekly timer's acts (`ccd-quiz-weekly.timer`), never a session's, in any form (the operator's ruling of 2026-11-22; review 3232 F1). A session reads the quiz on the Shadow lanes card; the Overlord coordinator's Live (`ccrc-api quiz live`) stays open. Text that only names it is refused too; reword it or write it through a file (`git commit -F <file>`)."
	case "prune":
		r = "ccrc: this call runs `git worktree prune`, which deletes git's records of every gone worktree of the repository at once, and ccd's cleanup reads those records: one prune holds the cleanup of every lane on this box (the cleanup un-wedge spec, section 5)." +
			" To remove one stale record, use `git -C <main> worktree remove <path>`; a dry run (`-n`) is allowed." +
			" If this is text you meant to pass, such as a commit message or a PR body, bash would still run a backticked or `$(...)` mention inside double quotes or an unquoted heredoc: put the text in a file and pass the file (`git commit -F <file>`, `gh pr create --body-file <file>`)."
	case "build":
		r = "ccrc: this call is " + why + ", which a dispatched child never does: rolling, installing and selecting a Claude Code build are the operator's acts and ccrc's own (CLAUDE.md's SAFETY section; spec 2026-10-18 §7.6; D-5696)." +
			" Report what you need to your coordinator instead."
	}
	if r == "" {
		return ""
	}
	return DenyJSON(r)
}

// quizWord is `[[ $apf == *quiz[[:space:]tn\\]* ]]`.
func quizWord(s string, utf bool) bool {
	for i := 0; ; {
		k := strings.Index(s[i:], "quiz")
		if k < 0 {
			return false
		}
		j := i + k + 4
		if j < len(s) {
			r, _ := utf8.DecodeRuneInString(s[j:])
			if glibcSpace(r, utf) || r == 't' || r == 'n' || r == '\\' {
				return true
			}
		}
		i = i + k + 1
	}
}

// ccrcLinear is `[[ $apf == *.ccrc*linear* ]]`.
func ccrcLinear(s string) bool {
	k := strings.Index(s, ".ccrc")
	return k >= 0 && strings.Contains(s[k+5:], "linear")
}

// DenyText is `_hook_deny_text`: the file's bytes up to its first NUL, when at most APF_DENY_BYTES of them come before
// one (ok false: no `--arg deny`). b is what L4 read, at most APF_DENY_BYTES+1 bytes.
func DenyText(b []byte) (string, bool) {
	s := string(b)
	if i := strings.IndexByte(s, 0); i >= 0 {
		s = s[:i]
	}
	if len(s) > apfDenyBytes {
		return "", false
	}
	return s, true
}

// DenyReadMax is what L4 reads of the deny file: one byte past the cap, as `read -n` does.
const DenyReadMax = apfDenyBytes + 1
