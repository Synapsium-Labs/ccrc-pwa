package attention

import (
	"os"
	"regexp"
	"sort"
	"testing"

	"ccrc/core/internal/kernel"
	"ccrc/core/internal/kernel/vocab"
)

// modelSwitch are the two events Classify's default arm answers (its report is the network's, app/hook).
var modelSwitch = map[string]bool{"PreModelSwitch": true, "PostModelSwitch": true}

// The Go hook's dispatch is Classify's switch: its case labels, plus the model-switch events its default arm leaves to
// the network, are exactly vocab.HookEvents (the bash hook's `case "$event"` arms, which the installer's EVENTS_JSON and
// install-session-hooks.test.ts hold equal to the same list). A label added or dropped on one side goes red here.
func TestClassifyDispatchIsTheVocabularysEvents(t *testing.T) {
	src, err := os.ReadFile("classify.go")
	if err != nil {
		t.Fatal(err)
	}
	// Only Classify's own switch: from its `switch event {` to its `default:` arm.
	text := string(src)
	i := regexp.MustCompile(`(?m)^\tswitch event \{$`).FindStringIndex(text)
	j := regexp.MustCompile(`(?m)^\tdefault:`).FindStringIndex(text)
	if i == nil || j == nil || j[0] < i[1] {
		t.Fatal("classify.go: Classify's `switch event {` ... `default:` was not found")
	}
	got := map[string]bool{}
	for _, m := range regexp.MustCompile(`(?m)^\tcase ("[A-Za-z]+"(?:, "[A-Za-z]+")*):$`).FindAllStringSubmatch(text[i[1]:j[0]], -1) {
		for _, e := range regexp.MustCompile(`"([A-Za-z]+)"`).FindAllStringSubmatch(m[1], -1) {
			got[e[1]] = true
		}
	}
	for e := range modelSwitch {
		got[e] = true
	}
	var have, want []string
	for e := range got {
		have = append(have, e)
	}
	want = append(want, vocab.HookEvents...)
	sort.Strings(have)
	sort.Strings(want)
	if len(have) != len(want) {
		t.Fatalf("Classify names %v, vocab.HookEvents is %v", have, want)
	}
	for k := range have {
		if have[k] != want[k] {
			t.Fatalf("Classify names %v, vocab.HookEvents is %v", have, want)
		}
	}
}

// The behavioural half: every event but the two model switches is classified by an arm (not the default's Exit), and an
// unknown event is the default's.
func TestEveryVocabEventButTheModelSwitchesHasAnArm(t *testing.T) {
	for _, e := range vocab.HookEvents {
		c := Classify(e, "{}", kernel.Obj{})
		if c.Exit != modelSwitch[e] {
			t.Errorf("%s: Exit = %v, want %v", e, c.Exit, modelSwitch[e])
		}
	}
	if !Classify("NoSuchEvent", "{}", kernel.Obj{}).Exit {
		t.Error("an unknown event must take the default arm")
	}
}
