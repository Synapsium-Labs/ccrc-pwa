package registry

import (
	"strings"
	"testing"
)

func TestRosterRefusalFollowsBashsLadder(t *testing.T) {
	asked := 0
	user := func() string { asked++; return "u" }
	p := func() string { return "/h/.ccrc/accounts.sh" }
	cases := []struct {
		f    RosterFacts
		want string
	}{
		{RosterFacts{}, "no account roster at /h/.ccrc/accounts.sh — "},
		{RosterFacts{Exists: true}, "account roster /h/.ccrc/accounts.sh exists but is not a regular file — "},
		{RosterFacts{Exists: true, Regular: true}, "account roster /h/.ccrc/accounts.sh exists but is not readable by u — "},
	}
	for _, c := range cases {
		if got := RosterRefusal(p, c.f, user); !strings.HasPrefix(got, c.want) {
			t.Errorf("%+v: %q", c.f, got)
		}
	}
	if asked != 1 {
		t.Errorf("the user is asked on the unreadable rung only, asked %d times", asked)
	}
	if got := RosterRefusal(p, RosterFacts{true, true, true}, user); got != "" {
		t.Errorf("a readable regular roster is no refusal: %q", got)
	}
}
