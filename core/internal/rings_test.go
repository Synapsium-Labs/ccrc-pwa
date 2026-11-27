package internal

import (
	"os/exec"
	"strings"
	"testing"
)

func TestRingViolationsDetectsOutwardImports(t *testing.T) {
	bad := map[string][]string{
		"ccrc/core/internal/kernel":          {"os/exec"},
		"ccrc/core/internal/domain/mutation": {"os", "ccrc/core/internal/adapter/units"},
		"ccrc/core/internal/adapter/units":   {"ccrc/core/internal/app/ccd"},
		"ccrc/core/internal/app/ccd":         {"ccrc/core/internal/adapter/lock"},
	}
	for pkg, imps := range bad {
		if len(RingViolations(pkg, imps)) == 0 {
			t.Errorf("%s importing %v must be a violation", pkg, imps)
		}
	}
	for _, pkg := range []string{"ccrc/core/internal/util", "ccrc/core/internal/policy/x"} {
		if len(RingViolations(pkg, []string{"strings"})) == 0 {
			t.Errorf("%s is under internal/ in no ring: it must be a violation", pkg)
		}
	}
	good := map[string][]string{
		"ccrc/core/internal/kernel":          {"encoding/json", "sort"},
		"ccrc/core/internal/domain/mutation": {"errors", "regexp", "ccrc/core/internal/kernel"},
		"ccrc/core/internal/adapter/units":   {"os", "path/filepath", "ccrc/core/internal/kernel"},
		"ccrc/core/internal/app/ccd":         {"fmt", "io", "ccrc/core/internal/domain/mutation"},
		"ccrc/core/cmd/ccrc-core":            {"os", "ccrc/core/internal/adapter/units", "ccrc/core/internal/app/ccd"},
	}
	for pkg, imps := range good {
		if v := RingViolations(pkg, imps); len(v) != 0 {
			t.Errorf("%s: unexpected violations %v", pkg, v)
		}
	}
}

// The real module: every package's imports, as `go list` reports them, keep the rings.
func TestModuleKeepsTheRings(t *testing.T) {
	out, err := exec.Command("go", "list", "-f", "{{.ImportPath}}{{range .Imports}} {{.}}{{end}}", "ccrc/core/...").Output()
	if err != nil {
		t.Fatalf("go list: %v", err)
	}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		f := strings.Fields(line)
		for _, v := range RingViolations(f[0], f[1:]) {
			t.Error(v)
		}
	}
}
