package kernel

import (
	"reflect"
	"testing"
)

// The hook row is a mode, not a verb: in go mode it must never surface as go:hook in `ccd caps` or as a launcher route.
func TestGoVerbsNeverListsTheHookRow(t *testing.T) {
	table := []byte(`{"entries":{"caps":{"mode":{"windows":"go"}},"hook":{"mode":{"windows":"go"}}}}`)
	got, err := GoVerbs(table, "windows")
	if err != nil || !reflect.DeepEqual(got, []string{"caps"}) {
		t.Fatalf("got %v, %v", got, err)
	}
}

func TestGoVerbs(t *testing.T) {
	table := []byte(`{"entries":{"b":{"mode":{"windows":"go"}},"a":{"mode":{"windows":"go","linux":"bash"}},"c":{}}}`)
	got, err := GoVerbs(table, "windows")
	if err != nil || !reflect.DeepEqual(got, []string{"a", "b"}) {
		t.Fatalf("windows: got %v, %v", got, err)
	}
	got, err = GoVerbs(table, "linux")
	if err != nil || len(got) != 0 {
		t.Fatalf("linux: got %v, %v", got, err)
	}
	if _, err := GoVerbs(table, "plan9"); err == nil {
		t.Fatal("an unknown platform must be refused")
	}
	if _, err := GoVerbs([]byte(`{"entries":{"a":{"mode":{"windows":"node"}}}}`), "windows"); err == nil {
		t.Fatal("a mode other than bash or go must be refused")
	}
	if _, err := GoVerbs([]byte(`not json`), "windows"); err == nil {
		t.Fatal("an unreadable table must be refused")
	}
}
