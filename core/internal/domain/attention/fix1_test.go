package attention

import "testing"

func TestFixRound1Decisions(t *testing.T) {
	if !HashReadable(true, true, LoadsFileMax, true) || HashReadable(false, true, 1, true) || HashReadable(true, false, 1, true) ||
		HashReadable(true, true, LoadsFileMax+1, true) || HashReadable(true, true, 1, false) {
		t.Error("HashReadable: a regular file of at most 1 MiB under a timeout, else x")
	}
	if !LoadsKeepGoing("p:d", LoadsFile{T: "0", Off: "1", Tp: "/t"}) || LoadsKeepGoing("", LoadsFile{T: "0", Off: "1", Tp: "/t"}) || LoadsKeepGoing("p:d", LoadsFile{}) {
		t.Error("LoadsKeepGoing")
	}
	if StartLeft(1500, true) != 1500 || StartLeft(1500, false) != 0 {
		t.Error("StartLeft")
	}
	if AnchorSlot("start", "text", "t") != "t" || AnchorSlot("start", "live", "t") != "" || AnchorSlot("fork", "live", "") != ForkAnchorLine ||
		AnchorSlot("fork", "text", "t") != "" || AnchorSlot("start", "dark", "") != "" {
		t.Error("AnchorSlot")
	}
}
