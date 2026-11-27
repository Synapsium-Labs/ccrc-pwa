package attention

import (
	"strconv"
	"strings"
	"time"
)

// The network's one budget and the closed client's calls (ccd/session-hook.sh, `_hook_net_bound` and the sends): every
// read the hook makes in an invocation asks here first, and the deadline is one for the whole invocation.
const (
	NetBudgetMs    = 8000 // HOOK_NET_BUDGET_MS
	ReportTimeoutS = 3    // REPORT_TIMEOUT_S
	AnchorBoundMs  = 4000 // the anchor's and the roster card's own bound
	StartBudgetMs  = 4000 // START_BUDGET_MS
	LoadsBudgetMs  = 3000 // LOADS_BUDGET_MS
)

// Net is the invocation's budget: its deadline (set by the first ask) and whether a read has run out its bound.
type Net struct {
	DL   int64
	Hung bool // HOOK_NET_HUNG: a server that did not answer in time is not asked again
}

// Bound is `_hook_net_bound <max ms>`: the ms left for a read of at most max (what the smaller of its own bound and the
// deadline allows), and whether the read is to start: not once one hung, and not with under a second left.
func (n *Net) Bound(now, max int64) (left int64, ok bool) {
	if n.DL == 0 {
		n.DL = now + NetBudgetMs
	}
	left = n.DL - now
	if max < left {
		left = max
	}
	return left, !n.Hung && left >= 1000
}

// Seconds is NET_B, `<s>.<tenths>`, as a duration: a tenth of a second is its smallest step.
func Seconds(leftMs int64) time.Duration {
	return time.Duration(leftMs/1000)*time.Second + time.Duration(leftMs%1000/100)*100*time.Millisecond
}

// Left is `_hook_left`: the ms to a deadline, at least 100, in the same steps.
func Left(dl, now int64) time.Duration {
	l := dl - now
	if l <= 100 {
		l = 100
	}
	return Seconds(l)
}

// The sends' outcomes (`_hook_start_send`'s return codes; 6 and 7 are the callers').
const (
	SendTaken     = 0
	SendStale     = 1 // stale-uuid
	SendNoAnswer  = 2
	SendRefused   = 3 // refused for good
	SendKept      = 4 // kept and tried
	SendNoTime    = 5
	SendUnsent    = 6
	SendStaleElse = 7 // stale under a sender not this event's
)

// SendOutcome is what `_hook_start_send` makes of one send: rc is the client's exit status (merged output out). A local
// refusal (2) is kept and tried; a cut (124) or any other status is no answer; else the status line decides.
func SendOutcome(rc int, out string) int {
	switch rc {
	case 0:
	case 2:
		return SendKept
	default:
		return SendNoAnswer
	}
	switch {
	case strings.Contains(out, "http 202"):
		return SendTaken
	case strings.Contains(out, `"stale-uuid"`):
		return SendStale
	case hasStatus(out, "http 40", "14") || hasStatus(out, "http 5", "0123456789", "0123456789"):
		return SendKept
	case hasStatus(out, "http 4", "0123456789", "0123456789"):
		return SendRefused
	}
	return SendNoAnswer
}

// hasStatus is the glob `*'<prefix>'[<set>]…*`: the prefix followed by one character of each set.
func hasStatus(s, prefix string, sets ...string) bool {
	for i := 0; ; {
		j := strings.Index(s[i:], prefix)
		if j < 0 {
			return false
		}
		at := i + j + len(prefix)
		ok := at+len(sets) <= len(s)
		for k := 0; ok && k < len(sets); k++ {
			ok = strings.IndexByte(sets[k], s[at+k]) >= 0
		}
		if ok {
			return true
		}
		i += j + 1
	}
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }
