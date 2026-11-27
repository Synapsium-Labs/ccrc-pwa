package attention

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"strconv"
	"strings"
)

// The loads report (ccd/session-hook.sh, `_hook_loads_pend` and `_hook_start_loads`): the pending file's grammar and the
// decisions around the module `ccd/lib/transcript.jq`, which stays a jq process. L4 reads, runs and writes.
const (
	LoadsTries    = 5
	LoadsMaxBytes = 16777216
	LoadsFileMax  = 1048576
)

// IsDigits is `[[ x =~ ^[0-9]+$ ]]`.
func IsDigits(s string) bool { return allDigits.MatchString(s) }

// LoadsDue is the arm's gate: a main-thread Stop while a regular, unlinked `loadpending` stands.
func LoadsDue(event string, paid, regular bool) bool { return event == "Stop" && !paid && regular }

// LoadsWindowReadable says whether the transcript is read at all: a regular file of at most LoadsMaxBytes.
func LoadsWindowReadable(regular bool, size int64) bool { return regular && size <= LoadsMaxBytes }

// LoadsLast is `--argjson last`: 1 on the last try, which sends without waiting for the snapshot.
func LoadsLast(t string) string {
	if mustInt(t)+1 >= LoadsTries {
		return "1"
	}
	return "0"
}

// SendReady says whether a body is sent: there is one, and the window's end is a number.
func SendReady(body, we string) bool { return body != "" && IsDigits(we) }

// LoadPendLine is `_hook_loads_pend`'s file: the tries (0), the report id, the transcript's size now, the source and path.
func LoadPendLine(rid string, size int64, src, tp string) string {
	return "0\t" + rid + "\t" + itoa(size) + "\t" + src + "\t" + tp + "\n"
}

// LoadsFile is the pending file as the bash reads it: the first line's five fields (tries, report id, offset, source,
// path: the last takes the rest) and the second's two (the window's end and the body), the spooled report.
type LoadsFile struct {
	T, Rid, Off, Sc, Tp string
	We, Body            string
}

// ParseLoads is `IFS=tab read -r t rid off sc tp; IFS=tab read -r we body` over the file.
func ParseLoads(data []byte) LoadsFile {
	lines := strings.SplitN(NulFree(data), "\n", 3)
	line := func(i int) string {
		if i < len(lines) {
			return lines[i]
		}
		return ""
	}
	a, b := ifsFields(line(0), 5), ifsFields(line(1), 2)
	return LoadsFile{T: a[0], Rid: a[1], Off: a[2], Sc: a[3], Tp: a[4], We: b[0], Body: b[1]}
}

// Valid is the file's own test: numeric tries and offset and an absolute path, else the file is removed.
func (f LoadsFile) Valid() bool {
	return allDigits.MatchString(f.T) && allDigits.MatchString(f.Off) && strings.HasPrefix(f.Tp, "/")
}

var verShape = regexp.MustCompile(`\A[0-9][0-9A-Za-z.+-]{0,31}\z`)

// LoadsVer is the build's version, the base name of CLAUDE_CODE_EXECPATH when of the shape, else "".
func LoadsVer(execpath string) string {
	v := execpath[strings.LastIndex(execpath, "/")+1:]
	if verShape.MatchString(v) {
		return v
	}
	return ""
}

// LoadLast is `$REG/<id>.loadlast`'s six fields: the report id, the digest, the build, the begin and end offsets and the path.
type LoadLast struct{ Lr, Ld, Lb, Lo, Le, Lt string }

// ParseLoadLast is `IFS=tab read -r lr ld lb lo le lt` over its first line.
func ParseLoadLast(data []byte) LoadLast {
	l, _, _ := strings.Cut(NulFree(data), "\n")
	f := ifsFields(l, 6)
	return LoadLast{f[0], f[1], f[2], f[3], f[4], f[5]}
}

// Carried says whether a resume carries instructions and hooks from the last reported startup: the same transcript, the
// same digest and build, and a window that ends inside the one now being read.
func (l LoadLast) Carried(sc, tp, lp, ver string, off int64) bool {
	if sc != "resume" || l.Lt != tp || l.Ld != Digest(lp) || ver == "" || l.Lb != ver ||
		!allDigits.MatchString(l.Lo) || !allDigits.MatchString(l.Le) {
		return false
	}
	lo, _ := strconv.ParseInt(l.Lo, 10, 64)
	le, _ := strconv.ParseInt(l.Le, 10, 64)
	return lo <= le && le <= off
}

// Digest is `${lp#*:}`: the profile past its first colon, or the whole of it.
func Digest(lp string) string {
	if i := strings.Index(lp, ":"); i >= 0 {
		return lp[i+1:]
	}
	return lp
}

// ReadyEnd is the module's answer test, `^{"state":"ready","end":([0-9]+),`: the window's end past the offset.
var readyRe = regexp.MustCompile(`\A\{"state":"ready","end":([0-9]+),`)

func ReadyEnd(out string) (int64, bool) {
	m := readyRe.FindStringSubmatch(out)
	if m == nil {
		return 0, false
	}
	n, err := strconv.ParseInt(m[1], 10, 64)
	return n, err == nil
}

// LoadsAfter is what a send's outcome r does to the pending file: its action, and the text to write for a kept one.
type LoadsAfter struct {
	Remove   bool   // rm the file
	LastLine string // r == 0 on a startup: the loadlast line to write ("" otherwise)
	Keep     string // the file's next text when it stays
}

// LoadsEnd is the arm's last step: a 202 removes the file (and a startup records its window), a refusal for good or the
// last try removes it, and anything else counts a try and spools the body.
func LoadsEnd(f LoadsFile, r int, body, we, lp, ver string) LoadsAfter {
	switch {
	case r == SendTaken:
		a := LoadsAfter{Remove: true}
		if f.Sc == "startup" {
			a.LastLine = f.Rid + "\t" + Digest(lp) + "\t" + ver + "\t" + f.Off + "\t" + we + "\t" + f.Tp + "\n"
		}
		return a
	case r == SendRefused || mustInt(f.T)+1 >= LoadsTries:
		return LoadsAfter{Remove: true}
	}
	spool := ""
	if body != "" {
		spool = we + "\t" + body
	}
	return LoadsAfter{Keep: strconv.FormatInt(mustInt(f.T)+1, 10) + "\t" + f.Rid + "\t" + f.Off + "\t" + f.Sc + "\t" + f.Tp + "\n" + spool + "\n"}
}

func mustInt(s string) int64 { n, _ := strconv.ParseInt(s, 10, 64); return n }

// Sha256Hex is `_apr_sha256`: the digest as 64 lowercase hex.
func Sha256Hex(b []byte) string { s := sha256.Sum256(b); return hex.EncodeToString(s[:]) }

// TranscriptPath is `jq -r '.transcript_path | strings'` read as `$( )` keeps it: the path when a string, else "".
func TranscriptPath(v any) string {
	s, _ := get(v, "transcript_path").(string)
	return strings.TrimRight(strings.ReplaceAll(s, "\x00", ""), "\n")
}

// HashReadable says whether an instruction file is read to be hashed: a regular file of at most LoadsFileMax bytes under a
// `timeout` to run `cat` in. Anything else digests as `x`, as does a read that fails (the bash's pipefail: the substitution is
// then non-zero and `h=x`).
func HashReadable(statOK, regular bool, size int64, hasTimeout bool) bool {
	return statOK && regular && size <= LoadsFileMax && hasTimeout
}

// LoadsKeepGoing is the arm's two early removals: no launch profile, or a file that is not of the grammar, removes the file.
func LoadsKeepGoing(profile string, f LoadsFile) bool { return profile != "" && f.Valid() }

// StartLeft is the start report's budget in ms: what the one budget has left when the read may start, else none.
func StartLeft(left int64, ok bool) int64 {
	if !ok {
		return 0
	}
	return left
}
