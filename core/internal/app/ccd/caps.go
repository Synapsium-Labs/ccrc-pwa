package ccd

import (
	"fmt"
	"strings"

	"ccrc/core/internal/domain/mutation"
)

// caps prints the body's own caps list (bash's cmd_caps), then one go:<verb> line per entry this platform runs in Go.
func caps(args []string, x IO) int {
	if len(args) != 0 {
		fmt.Fprint(x.Stderr, "ccd: usage: ccd caps\n")
		return 1
	}
	body, err := x.ReadFile(x.BodyPath)
	if err != nil {
		fmt.Fprintf(x.Stderr, "ccd: the ccd body could not be read: %v\n", err)
		return 1
	}
	lines, err := mutation.CapsLines(string(body), x.PoolSyncInstalled(x.Home))
	if err != nil {
		fmt.Fprintf(x.Stderr, "ccd: %v\n", err)
		return 1
	}
	for _, v := range x.GoVerbs {
		lines = append(lines, "go:"+v)
	}
	fmt.Fprint(x.Stdout, strings.Join(lines, "\n")+"\n")
	return 0
}
