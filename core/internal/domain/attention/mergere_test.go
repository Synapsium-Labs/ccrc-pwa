package attention

import (
	"os/exec"
	"strings"
	"testing"
)

// The three EREs are the bash's: the values its own shell computes (GH_MERGE_RE, and the two cut from its text) equal the
// Go constants, and each compiles as a POSIX ERE.
func TestMergeREsAreTheBashs(t *testing.T) {
	bash, err := exec.LookPath("bash")
	if err != nil {
		t.Skip("no bash")
	}
	script := `hook=` + "../../../../ccd/session-hook.sh" + `
for v in GH_MERGE_RE GH_API_CUT GH_API_RE CCD_DOOR_CUT CCD_DOOR_RE; do eval "$(grep -m1 "^$v=" "$hook")"; done
printf '%s\0%s\0%s\0%s\0%s' "$GH_MERGE_RE" "$GH_API_RE" "$CCD_DOOR_RE" "$GH_API_CUT" "$CCD_DOOR_CUT"`
	out, err := exec.Command(bash, "-c", script).Output()
	if err != nil {
		t.Fatal(err)
	}
	f := strings.Split(string(out), "\x00")
	if len(f) != 5 {
		t.Fatalf("bash answered %d values", len(f))
	}
	for i, c := range []struct{ name, got string }{{"GH_MERGE_RE", GhMergeRE}, {"GH_API_RE", GhAPIRE}, {"CCD_DOOR_RE", CcdDoorRE}, {"GH_API_CUT", ghAPICut}, {"CCD_DOOR_CUT", ccdDoorCut}} {
		if f[i] != c.got {
			t.Errorf("%s: Go %q, bash %q", c.name, c.got, f[i])
		}
	}
	// each cut occurs once, right after the head, so the derivations leave the head alone
	for _, cut := range []string{ghAPICut, ccdDoorCut} {
		if strings.Count(GhMergeRE, cut) != 1 {
			t.Errorf("%q occurs %d times in GH_MERGE_RE", cut, strings.Count(GhMergeRE, cut))
		}
	}
	for cmd, want := range map[string][3]bool{
		"gh pr merge 5": {true, false, false},
		"echo x; sudo /usr/bin/gh -R o/r pr merge": {true, false, false},
		"gh api repos/o/r/pulls/5/merge":           {false, true, false},
		"X=1 ccd pr-admin-merge 5":                 {false, false, true},
		"echo gh pr merge":                         {false, false, false},
		"gh pr view 5":                             {false, false, false},
	} {
		got := [3]bool{GhMerge().MatchString(cmd), GhAPI().MatchString(cmd), CcdDoor().MatchString(cmd)}
		if got != want {
			t.Errorf("%q: merge/api/door = %v, want %v", cmd, got, want)
		}
	}
}

// glibc matches without REG_NEWLINE; CompilePOSIX anchors per line. The merge EREs agree today only because every negated class also
// lists [:space:] or \n; these rows (measured on a glibc bash) pin it for Task 5.
func TestMergeREsMultiLine(t *testing.T) {
	for cmd, want := range map[string][3]bool{
		"echo hi\ngh pr merge 5":    {true, false, false},
		"echo a b\ngh api x":        {false, true, false},
		"x\n  ccd pr-admin-merge 4": {false, false, true},
		"echo gh\npr merge":         {false, false, false},
		"FOO=a\nb gh pr merge":      {false, false, false},
		"gh pr view\ngh pr merge 1": {true, false, false},
	} {
		got := [3]bool{GhMerge().MatchString(cmd), GhAPI().MatchString(cmd), CcdDoor().MatchString(cmd)}
		if got != want {
			t.Errorf("%q: merge/api/door = %v, want %v", cmd, got, want)
		}
	}
}
