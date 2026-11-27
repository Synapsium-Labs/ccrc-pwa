// Package internal holds the rings guard of the Go core (spec 2026-11-24 §3); its test reads the real module.
package internal

import (
	"fmt"
	"strings"
)

const base = "ccrc/core/internal/"

func ringOf(pkg string) string {
	if !strings.HasPrefix(pkg, base) {
		return ""
	}
	return strings.SplitN(strings.TrimPrefix(pkg, base), "/", 2)[0]
}

// RingViolations names every import of pkg that points outward.
func RingViolations(pkg string, imports []string) []string {
	ring := ringOf(pkg)
	allowed := map[string][]string{
		"kernel":  {"kernel"},
		"domain":  {"kernel", "domain"},
		"adapter": {"kernel", "adapter"},
		"app":     {"kernel", "domain", "app"},
	}[ring]
	banned := map[string][]string{
		"kernel": {"os/exec"},
		"domain": {"os", "os/exec", "net", "net/http"},
	}[ring]
	var out []string
	if !strings.HasPrefix(pkg, base) {
		return nil // cmd/ccrc-core (L5) and the guard itself wire everything
	}
	if allowed == nil {
		// A package under internal/ in no ring the table names: its imports cannot be judged, so it is itself refused.
		return []string{fmt.Sprintf("%s is in no ring (%q): internal/ holds kernel, domain, adapter and app only", pkg, ring)}
	}
	for _, imp := range imports {
		if r := ringOf(imp); r != "" && !contains(allowed, r) {
			out = append(out, fmt.Sprintf("%s (%s) imports %s (%s)", pkg, ring, imp, r))
		}
		if contains(banned, imp) {
			out = append(out, fmt.Sprintf("%s (%s) imports %s", pkg, ring, imp))
		}
	}
	return out
}

func contains(xs []string, x string) bool {
	for _, y := range xs {
		if y == x {
			return true
		}
	}
	return false
}
