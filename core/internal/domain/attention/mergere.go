package attention

import (
	"regexp"
	"strings"
	"sync"
)

// The merge deny's command-head grammar (ccd/session-hook.sh: GH_MERGE_RE, and the two EREs derived from its text by string
// surgery, GH_API_RE and CCD_DOOR_RE, D-8124). Wave 2 Task 5's deny uses them; they are spelled here, once, so the three
// never drift as they never drift in the bash: GhAPIRE and CcdDoorRE are cut from GhMergeRE's own text, as the bash cuts it
// with `${GH_MERGE_RE%%"$CUT"*}`, the part before the FIRST occurrence of the cut. All three are POSIX EREs read only
// for a match (the deny reads no capture), so they compile in Perl mode, as glibc runs them without REG_NEWLINE: ^ and $ the
// text's ends and [^…] taking a newline (TestMergeREsMultiLine; CompilePOSIX would make them line anchors).

// GhMergeRE is `<head>[ \t]+pr(<gh flags>)*[ \t]+merge<end>` (the bash's value, with its tab and newline characters).
const GhMergeRE = "(^|[;&|(\n]|\\$\\()[ \t]*(([!{]|if|then|do|else|elif|while|until|time|env|command|exec|nohup|sudo)[ \t]+|timeout[ \t]+([^[:space:];&|()]|\\$\\(\\(?[^;&|()\n]*\\)?\\))+[ \t]+|[A-Za-z_][A-Za-z0-9_]*=([^[:space:];&|()]|\\$\\(\\(?[^;&|()\n]*\\)?\\))*[ \t]+)*([^[:space:];&|()]*/)?gh([ \t]+-([^[:space:];&|()]|\\$\\(\\(?[^;&|()\n]*\\)?\\))+([ \t]+([^-[:space:];&|()]|\\$\\(\\(?[^;&|()\n]*\\)?\\))([^[:space:];&|()]|\\$\\(\\(?[^;&|()\n]*\\)?\\))*)?)*[ \t]+pr([ \t]+-([^[:space:];&|()]|\\$\\(\\(?[^;&|()\n]*\\)?\\))+([ \t]+([^-[:space:];&|()]|\\$\\(\\(?[^;&|()\n]*\\)?\\))([^[:space:];&|()]|\\$\\(\\(?[^;&|()\n]*\\)?\\))*)?)*[ \t]+merge([[:space:];&|()<>]|$)"

const (
	ghAPICut    = "[ \t]+pr("                       // GH_API_CUT: occurs once, right after the head
	ccdDoorCut  = "([^[:space:];&|()]*/)?gh("       // CCD_DOOR_CUT: the head's optional path prefix and the command word
	ghAPITail   = "[ \t]+api([[:space:];&|()<>]|$)" // `api` for `pr … merge`
	ccdDoorTail = "([^[:space:];&|()]*/)?ccd[ \t]+pr-admin-merge([[:space:];&|()<>]|$)"
)

// before is `${s%%"$cut"*}`: s up to the first occurrence of cut (all of s when it does not occur).
func before(s, cut string) string {
	if i := strings.Index(s, cut); i >= 0 {
		return s[:i]
	}
	return s
}

var (
	// GhAPIRE is GH_API_RE: the same head with `api` for `pr … merge`.
	GhAPIRE = before(GhMergeRE, ghAPICut) + ghAPITail
	// CcdDoorRE is CCD_DOOR_RE: the same head with `ccd pr-admin-merge` for `gh … pr … merge`.
	CcdDoorRE = before(GhMergeRE, ccdDoorCut) + ccdDoorTail
)

// The compiled forms, built when first asked: a hook call that never reads a merge pays nothing for them.
var (
	GhMerge = sync.OnceValue(func() *regexp.Regexp { return regexp.MustCompile(GhMergeRE) })
	GhAPI   = sync.OnceValue(func() *regexp.Regexp { return regexp.MustCompile(GhAPIRE) })
	CcdDoor = sync.OnceValue(func() *regexp.Regexp { return regexp.MustCompile(CcdDoorRE) })
)
