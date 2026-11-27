package attention

import "testing"

// The shape word (Task 7b): how many values jq reads from a payload, decided once in ParsePayload.
func TestPayloadShape(t *testing.T) {
	const v = `{"hook_event_name":"Stop"}`
	for _, c := range []struct {
		name, in string
		shape    Shape
		ok       bool
		values   int
	}{
		{"one", v, ShapeOne, true, 1},
		{"one, blanks after", v + " \n\t", ShapeOne, true, 1},
		{"two", v + "\n" + v, ShapeMany, true, 2},
		{"two on one line", v + v, ShapeMany, true, 2},
		{"trailing text", v + " garbage", ShapeTrailing, true, 1},
		{"trailing brace", v + "\n}", ShapeTrailing, true, 1},
		{"two then text", v + v + " x", ShapeTrailing, true, 2},
		{"empty", "", ShapeUnreadable, false, 0},
		{"blank", "  \n", ShapeUnreadable, false, 0},
		{"text", "not json", ShapeUnreadable, false, 0},
		{"scalar root", "42", ShapeOne, false, 1},
		{"null root", "null", ShapeOne, false, 1},
		// jq goes on after a value its program errors on: the first object (or null) is the one the parse reads
		{"scalar then object", `42 ` + v, ShapeMany, true, 2},
		{"array then object", `[1]` + v, ShapeMany, true, 2},
	} {
		p, ok := ParsePayload(c.in)
		if p.Shape != c.shape || ok != c.ok || len(p.Values) != c.values {
			t.Errorf("%s: shape %d ok %v values %d, want %d %v %d", c.name, p.Shape, ok, len(p.Values), c.shape, c.ok, c.values)
		}
	}
	// the event comes from the first value the program runs over, whatever follows
	if p, _ := ParsePayload(`{"hook_event_name":"Stop"}{"hook_event_name":"PreToolUse"}`); p.Event != "Stop" {
		t.Errorf("event %q", p.Event)
	}
}

// Lines is `jq -r` over every value: a line each, an error on a value is jq's exit 5 (the others still print), and text
// jq cannot read fails it after the whole values.
func TestPayloadLines(t *testing.T) {
	f := func(v any) ([]string, error) {
		t, err := path(v, "tool_name")
		return []string{rawOut(t)}, err
	}
	for _, c := range []struct {
		in, text string
		ok       bool
	}{
		{`{"tool_name":"a"}`, "a", true},
		{`{"tool_name":"a"}{"tool_name":"b"}`, "a\nb", true},
		{`{"tool_name":"a"} junk`, "a", false},
		{`{"tool_name":"a"}[1]{"tool_name":"b"}`, "a\nb", false},
	} {
		p, _ := ParsePayload(`{"hook_event_name":"Stop"}` + c.in) // the first value only gives the parse an event
		p.Values = p.Values[1:]
		if len(p.Values) == 0 {
			t.Fatal(c.in)
		}
		if text, ok := p.Lines(f); text != c.text || ok != c.ok {
			t.Errorf("%s: %q %v, want %q %v", c.in, text, ok, c.text, c.ok)
		}
	}
}

// What each classification site makes of a payload that is not one value, as the bash's jq does (measured, in
// server/test/hook-core-payload-shape.test.ts): PreToolUse, PermissionRequest and PostCompact exit on trailing text,
// SessionStart's source and PostToolUse's command fall back to "", two tool names are no tool, and two asks are two lines.
func TestClassifyPayloadShapes(t *testing.T) {
	cls := func(ev, in string) Class {
		p, _ := ParsePayload(in)
		return ClassifyPayload(ev, in, p)
	}
	pre := `{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"ls"}}`
	for _, ev := range []string{"PreToolUse", "PermissionRequest", "PostCompact"} {
		one := `{"hook_event_name":"` + ev + `","tool_name":"Bash","trigger":"manual"}`
		if c := cls(ev, one); c.Exit {
			t.Errorf("%s: one value exits", ev)
		}
		if c := cls(ev, one+" junk"); !c.Exit {
			t.Errorf("%s: trailing text must exit (bash `|| exit 0`)", ev)
		}
	}
	if c := cls("PreToolUse", pre+pre); c.Exit || c.Tool != "Bash\nBash" {
		t.Errorf("two tool names: %+v", c)
	}
	if c := cls("PreToolUse", `{"hook_event_name":"PreToolUse","tool_name":"Bash"}{"hook_event_name":"PreToolUse"}`); c.Tool != "Bash" {
		t.Errorf("one tool name among two values: %q", c.Tool)
	}
	ask := `{"hook_event_name":"PermissionRequest","tool_name":"AskUserQuestion","tool_input":{"questions":[]}}`
	if c := cls("PermissionRequest", ask); c.AskBad || c.Ask == nil {
		t.Errorf("one ask: %+v", c)
	}
	if c := cls("PermissionRequest", ask+`{"hook_event_name":"PermissionRequest"}`); !c.AskBad || c.Ask != nil || c.Tool != "AskUserQuestion" {
		t.Errorf("an ask in two lines: %+v", c)
	}
	if c := cls("PostCompact", `{"hook_event_name":"PostCompact","trigger":"manual"}{"hook_event_name":"PostCompact","trigger":"manual"}`); c.Trig != "manual\nmanual" || c.State != "working" {
		t.Errorf("two triggers are not manual: %+v", c)
	}
	if c := cls("SessionStart", `{"hook_event_name":"SessionStart","source":"compact"} junk`); c.Src != "" || c.Sessend || c.State != "done" {
		t.Errorf("source falls back to empty: %+v", c)
	}
	if c := cls("PostToolUse", `{"hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"command":"graphify q"}} junk`); c.Gcmd != "" {
		t.Errorf("command falls back to empty: %q", c.Gcmd)
	}
	if c := cls("StopFailure", `{"hook_event_name":"StopFailure","error":"rate_limit"} junk`); c.Err != "rate_limit" {
		t.Errorf("StopFailure has no fallback: %q", c.Err)
	}
}

// _hook_typed_model's `jq -e`: the status of the last value's output; text jq cannot read fails it.
func TestTypedModelPayloadShapes(t *testing.T) {
	nonce := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	typed := `{"hook_event_name":"UserPromptSubmit","prompt":"/model x"}`
	plain := `{"hook_event_name":"UserPromptSubmit","prompt":"hi"}`
	for _, c := range []struct {
		in   string
		want bool
	}{{typed, true}, {typed + " junk", false}, {plain + typed, true}, {typed + plain, false}, {"", false}} {
		p, _ := ParsePayload(c.in)
		if got := TypedModelPayload(nonce, c.in, p); got != c.want {
			t.Errorf("%q: %v, want %v", c.in, got, c.want)
		}
	}
}
