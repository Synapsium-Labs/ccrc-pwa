// Package mutation is ring L1 for C2 Fleet Mutation (ccd/contexts.tsv): pure deciders, no IO.
package mutation

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

const usageGuard = `[[ $# -eq 0 ]] || die "usage: ccd caps"`

var (
	echoes          = regexp.MustCompile(`^echo [a-z0-9:._-]+(\s*;\s*echo [a-z0-9:._-]+)*$`)
	trailingComment = regexp.MustCompile(`\s+#.*$`)
	semi            = regexp.MustCompile(`\s*;\s*`)
)

// CapsLines reads the body's own cmd_caps and answers what bash would print: the heredoc lines, every `echo <word>`
// word (lines split on `;`), and the taken arm of the one `if _pool_sync_installed` branch. Any other line is an
// error, so a new shape in cmd_caps turns the parity test red instead of drifting.
func CapsLines(text string, poolSyncInstalled bool) ([]string, error) {
	at := strings.Index(text, "\ncmd_caps() {")
	if at < 0 {
		return nil, errors.New("cmd_caps not found in the ccd body")
	}
	rest := text[at+1:]
	end := strings.Index(rest, "\n}\n")
	if end < 0 {
		return nil, errors.New("cmd_caps has no closing line in the ccd body")
	}
	var out []string
	heredoc := false
	branch := "" // "" outside the if, "take" or "skip" inside it
	for _, raw := range strings.Split(rest[:end], "\n")[1:] {
		if heredoc {
			if raw == "EOF" {
				heredoc = false
			} else {
				out = append(out, raw)
			}
			continue
		}
		t := strings.TrimSpace(trailingComment.ReplaceAllString(raw, ""))
		switch {
		case t == "" || strings.HasPrefix(t, "#") || t == usageGuard:
		case t == "cat <<'EOF'":
			heredoc = true
		case t == "if _pool_sync_installed; then":
			branch = map[bool]string{true: "take", false: "skip"}[poolSyncInstalled]
		case t == "else" && branch != "":
			branch = map[string]string{"take": "skip", "skip": "take"}[branch]
		case t == "fi" && branch != "":
			branch = ""
		case echoes.MatchString(t):
			if branch != "skip" {
				for _, w := range semi.Split(t, -1) {
					out = append(out, w[len("echo "):])
				}
			}
		default:
			return nil, fmt.Errorf("cmd_caps holds a line the go core cannot read: %s", t)
		}
	}
	return out, nil
}
