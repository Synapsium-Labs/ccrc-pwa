package mutation

import (
	"reflect"
	"strings"
	"testing"
)

const body = "x\ncmd_caps() {\n" +
	"  [[ $# -eq 0 ]] || die \"usage: ccd caps\"\n" +
	"  cat <<'EOF'\nalpha\nbeta\nEOF\n" +
	"  # a comment\n" +
	"  echo gamma ; echo delta   # trailing comment\n" +
	"  if _pool_sync_installed; then\n    echo pool-sync-installed\n  else\n    echo pool-sync-absent\n  fi\n" +
	"}\nafter() {\n}\n"

func TestCapsLines(t *testing.T) {
	got, err := CapsLines(body, false)
	want := []string{"alpha", "beta", "gamma", "delta", "pool-sync-absent"}
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("absent: %v %v", got, err)
	}
	got, _ = CapsLines(body, true)
	if got[len(got)-1] != "pool-sync-installed" {
		t.Fatalf("installed: %v", got)
	}
}

func TestCapsLinesRefusesWhatItCannotRead(t *testing.T) {
	b := "x\ncmd_caps() {\n  for v in a b; do echo $v; done\n}\n"
	if _, err := CapsLines(b, false); err == nil || !strings.Contains(err.Error(), "cannot read: for v in a b") {
		t.Fatalf("err = %v", err)
	}
	if _, err := CapsLines("no function here\n", false); err == nil {
		t.Fatal("a body without cmd_caps must be refused")
	}
	// The body ends inside cmd_caps: no "\n}\n" closes it, so what follows cannot be told from the function.
	if _, err := CapsLines("x\ncmd_caps() {\n  echo a\n}", false); err == nil || !strings.Contains(err.Error(), "no closing line") {
		t.Fatalf("an unclosed cmd_caps: err = %v", err)
	}
}
