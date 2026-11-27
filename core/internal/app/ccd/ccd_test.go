package ccd

import (
	"bytes"
	"testing"
)

func TestMainRefusesAnUnknownVerb(t *testing.T) {
	var out, errb bytes.Buffer
	rc := Main([]string{"nope"}, IO{Stdout: &out, Stderr: &errb})
	if rc != 125 || out.Len() != 0 || errb.String() != "ccd: the go core has no verb nope\n" {
		t.Fatalf("rc=%d out=%q err=%q", rc, out.String(), errb.String())
	}
	errb.Reset()
	if rc := Main(nil, IO{Stdout: &out, Stderr: &errb}); rc != 125 || errb.String() != "ccd: the go core has no verb (none)\n" {
		t.Fatalf("no verb: rc=%d err=%q", rc, errb.String())
	}
}
