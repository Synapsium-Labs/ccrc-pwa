package attention

import (
	"strings"

	"ccrc/core/internal/kernel"
)

// ClassifyPayload is the classification over a whole payload. For one value it is Classify. For any other shape it is
// what the bash's per-site `jq … <<<"$payload"` makes of several values or of text jq cannot read: each site runs
// over every value, prints a line for each, and either exits at a failure (`|| exit 0`: PreToolUse, PermissionRequest,
// PostCompact) or falls back (`|| src=""`, `|| gcmd=""`, `|| ask_json="null"`), and StopFailure's has no fallback at
// all. The rest of the arms read the first value (what the one parse's first ten lines hold), as the bash's
// field reads do. Measured on the Linux bench with `server/test/hook-core-payload-shape.test.ts`, which holds every
// row of it in both hooks.
func ClassifyPayload(event, payload string, ps Parsed) Class {
	c := Classify(event, payload, ps.Payload)
	if ps.Shape == ShapeOne {
		return c
	}
	str := func(v any, empty bool) []string { // `.k // empty` (no line for null and false) or `.k // "x"`
		if empty && !truthy(v) {
			return nil
		}
		return []string{rawOut(v)}
	}
	switch event {
	case "PostToolUse":
		// the prefilter is Classify's: no jq at all without one of the three phrases
		c.Gcmd = ""
		if strings.Contains(payload, "graphify") || strings.Contains(payload, "peers list") || strings.Contains(payload, "claims take") {
			text, ok := ps.Lines(func(v any) ([]string, error) { // `if .tool_name == "Bash" then (.tool_input.command // "") else "" end`
				tn, err := path(v, "tool_name")
				if err != nil {
					return nil, err
				}
				if !equal(tn, "Bash") {
					return []string{""}, nil
				}
				cmd, err := path(v, "tool_input", "command")
				if err != nil {
					return nil, err
				}
				return []string{rawOut(or(cmd, ""))}, nil
			})
			if ok {
				c.Gcmd = text
			}
		}
	case "PostCompact":
		text, ok := ps.Lines(func(v any) ([]string, error) {
			t, err := path(v, "trigger")
			return []string{rawOut(or(t, "auto"))}, err
		})
		if !ok { // `|| exit 0`
			return Class{Exit: true, Bg: "-1", Crons: "-1"}
		}
		c.Trig = text
		c.State = "working"
		if text == "manual" {
			c.State = "done"
		}
	case "PreToolUse", "PermissionRequest":
		text, ok := ps.Lines(func(v any) ([]string, error) {
			t, err := path(v, "tool_name")
			return str(t, true), err
		})
		if !ok { // `|| exit 0`
			return Class{Exit: true, Bg: "-1", Crons: "-1"}
		}
		c.Tool, c.Ask, c.Apr, c.AskBad = text, nil, false, false
		c.State = "working"
		if event == "PermissionRequest" {
			c.State = "waiting"
		}
		if text == "AskUserQuestion" {
			c.State = "waiting"
			c.Ask, c.AskBad = shapedAsk(ps, func(v any) (any, error) {
				q, err := path(v, "tool_input", "questions")
				return kernel.Obj{{K: "questions", V: or(q, []any{})}}, err
			})
		} else if event == "PermissionRequest" {
			c.Apr = true
			c.Ask, c.AskBad = shapedAsk(ps, func(v any) (any, error) {
				s, err := AprSummary(v)
				return kernel.Obj{{K: "approval", V: kernel.Obj{{K: "tool", V: or(get(v, "tool_name"), "unknown")}, {K: "summary", V: s}}}}, err
			})
		}
	case "SessionStart":
		text, ok := ps.Lines(func(v any) ([]string, error) {
			t, err := path(v, "source")
			return str(t, true), err
		})
		c.Src, c.Sessend, c.State = "", false, ""
		if ok { // `|| src=""`
			c.Src = text
		}
		if c.Src == "compact" {
			c.Sessend = true
		} else {
			c.State = "done"
		}
	case "StopFailure":
		// no `||`: the text jq printed stands whatever its status
		c.Err, _ = ps.Lines(func(v any) ([]string, error) {
			if !accepted(v) {
				return nil, errJQ
			}
			e, _ := path(v, "error")
			return []string{cut(keep(tostring(or(e, "")), func(r rune) bool { return r >= 'a' && r <= 'z' || r == '_' }), 64)}, nil
		})
	}
	return c
}

// shapedAsk is `ask_json=$(jq -c <envelope> <<<"$payload") || ask_json="null"` over several values: a failure is the
// word null; two or more whole values are two or more lines, which the hookstate write's `--argjson` refuses (bad).
func shapedAsk(ps Parsed, f func(v any) (any, error)) (ask any, bad bool) {
	_, ok := ps.Lines(func(v any) ([]string, error) {
		_, err := f(v)
		return []string{""}, err
	})
	if !ok {
		return nil, false
	}
	return nil, len(ps.Values) > 1
}

// TypedModelPayload is `_hook_typed_model`'s `jq -e` over a whole payload: its status is that of the last value's
// output, and text jq cannot read after the values fails it (exit 2), so only a payload of whole values can be typed.
func TypedModelPayload(doorNonce, payload string, ps Parsed) bool {
	switch ps.Shape {
	case ShapeOne:
		return TypedModel(doorNonce, payload, ps.Payload)
	case ShapeMany:
		return TypedModel(doorNonce, payload, ps.Values[len(ps.Values)-1])
	}
	return false
}
