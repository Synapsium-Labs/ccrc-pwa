package vocab

import (
	"encoding/json"
	"regexp"
	"testing"
)

// The generator carries a RegExp as its source and a nested value as JSON text: each must still be what its reader
// takes, an RE2 expression or a JSON document.
func TestGeneratedSourcesAndJSONRead(t *testing.T) {
	for _, re := range []string{AgentIdRe, MailholdReBody, RegGenerationShape, TmuxSocketNameRe} {
		if _, err := regexp.Compile(re); err != nil {
			t.Errorf("%q is not RE2: %v", re, err)
		}
	}
	for _, j := range []string{AccountSubArgvJSON, HookCommonRulesJSON, HookEventRulesJSON, SwitchesJSON} {
		if !json.Valid([]byte(j)) {
			t.Errorf("not JSON: %.60s", j)
		}
	}
}
