// Package kernel is ring L0 of the Go core: vocabulary and primitives, importing nothing else from internal/.
package kernel

import (
	"encoding/json"
	"fmt"
	"sort"
)

var platforms = map[string]bool{"linux": true, "darwin": true, "windows": true}

// HookEntry is the table's row for the session hook. It is not a ccd verb: Claude Code starts the hook from settings.json
// (the installer's HOOK_CMD), never through the launcher, so GoVerbs never lists it (`ccd caps` would print go:hook and
// the launcher would route `ccd hook` to the core). Its mode reaches the installer through the launcher's hook-mode answer.
const HookEntry = "hook"

// GoVerbs answers which entries core/entries.json puts in go mode on goos, sorted, the hook row excepted (HookEntry). An
// absent entry or platform is bash.
func GoVerbs(table []byte, goos string) ([]string, error) {
	if !platforms[goos] {
		return nil, fmt.Errorf("entries: no platform %q (linux, darwin or windows)", goos)
	}
	var t struct {
		Entries map[string]struct {
			Mode map[string]string `json:"mode"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(table, &t); err != nil {
		return nil, fmt.Errorf("entries: unreadable table: %w", err)
	}
	var out []string
	for name, e := range t.Entries {
		for p, m := range e.Mode {
			if !platforms[p] || (m != "bash" && m != "go") {
				return nil, fmt.Errorf("entries: %s has mode %q on %q", name, m, p)
			}
		}
		if name != HookEntry && e.Mode[goos] == "go" {
			out = append(out, name)
		}
	}
	sort.Strings(out)
	return out, nil
}
