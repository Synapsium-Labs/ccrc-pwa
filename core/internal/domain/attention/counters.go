package attention

import (
	"regexp"
	"strconv"
)

// The R4 and R7 counters' patterns (ccd/session-hook.sh's GRAPH_QUERY_RE, GRAPH_ANSWER_RE, CCRC_PEERS_RE and
// CCRC_CLAIMS_RE), the same EREs in RE2: a boolean match, where leftmost-longest and leftmost-first agree.
var (
	graphQuery  = regexp.MustCompile("(^|[;&|(`\"'/[:space:]])graphify[\"']?[[:space:]]+(query|path|explain)([[:space:]]|$)")
	graphAnswer = regexp.MustCompile(`(^|\n)(Traversal: |NODE |EDGE |Shortest path \(|No path found between |Node: )`)
	ccrcPeers   = regexp.MustCompile(`(^|[;&|[:space:]])peers[[:space:]]+list([[:space:]]|$)`)
	ccrcClaims  = regexp.MustCompile(`(^|[;&|[:space:]])claims[[:space:]]+take([[:space:]]|$)`)
)

// Counters are the four reads the hookstate carries, as decimal text.
type Counters struct{ Gq, Gd, Cp, Cc string }

// Count is tail stage 11 over a PostToolUse's command line (Class.Gcmd): a graphify read counts only on an answer in
// its Bash response, `peers list` and `claims take` on the line alone.
func Count(c Counters, gcmd string, v any) Counters {
	if gcmd == "" {
		return c
	}
	inc := incText
	if graphQuery.MatchString(gcmd) {
		out := ""
		if r := get(v, "tool_response"); typeName(r) == "object" && get(r, "interrupted") != true {
			if s, ok := get(r, "stdout").(string); ok {
				out = subst(s)
			}
		}
		if graphAnswer.MatchString(out) {
			c.Gq = inc(c.Gq)
		}
	}
	if ccrcPeers.MatchString(gcmd) {
		c.Cp = inc(c.Cp)
	}
	if ccrcClaims.MatchString(gcmd) {
		c.Cc = inc(c.Cc)
	}
	return c
}

// incText is `$((n + 1))` over a decimal count.
func incText(s string) string {
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return s // shortcut: a count past int64 stands; bash's own arithmetic wraps there
	}
	return strconv.FormatInt(n+1, 10)
}
