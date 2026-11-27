// Package core holds the entry table the binary and the installer read (spec 2026-11-24 §4).
package core

import _ "embed"

//go:embed entries.json
var EntriesJSON []byte
