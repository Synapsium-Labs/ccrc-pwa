package attention

import (
	"regexp"
)

// The build rows (`bmatch`, D-5696, D-6063 to D-6066): their patterns hold UPRE, the deny file's upstream ids, so they are
// built per id list (buildFor) and compiled when first asked.

// never is `(?!)`: a class no character is in.
const never = `[^\x00-\x{10FFFF}]`

// flagWord is CFLAGS' flag, `PSTOP -NS*`, with PSTOP `(?!(?:-p|--print)(?=SP|$)|--print=)` folded into the word: a flag
// is always a whole word (a blank follows it), so the lookahead refuses exactly the words `-p`, `--print` and those
// starting `--print=`, and the rest of `-NS*` is spelled out as the regular language it leaves.
const flagWord = `-(?:[^` + wsc + `p-]` + ns + `*|p` + ns + `+|-(?:[^` + wsc + `p]` + ns + `*|p(?:[^` + wsc + `r]` + ns + `*|r(?:[^` + wsc + `i]` + ns +
	`*|i(?:[^` + wsc + `n]` + ns + `*|n(?:[^` + wsc + `t]` + ns + `*|t[^` + wsc + `=]` + ns + `*)?)?)?)?)?)?`

const (
	cflags = `(?:` + flagWord + `(?:` + sp + `+[^` + wsc + `-]` + ns + `*)?` + sp + `+){0,8}` // `(?!-)NS+` is `[^WS-]NS*`
	vend   = `(?:[^A-Za-z0-9_./-]|\z)`                                                        // VEND, NW then `(?![./])`
	cverb  = `(?:install|update|upgrade)` + vend
	vers   = `[0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9}`
	entw   = `[^` + wsc + "/;&|()<>`'\"" + `]{1,64}`
	verh   = `\.local` + sepp + `share` + sepp + `claude` + sepp + `versions` + sepp + entw
	exech  = `\$\{?CLAUDE_CODE_EXECPATH\}?`
	runh   = wb + `(?:npx|bunx|(?:pnpm|yarn)` + sp + `+dlx|(?:npm|pnpm)` + sp + `+exec)` + sp + `+(?:-` + ns + `*` + sp + `+){0,8}@anthropic-ai/claude-code(?:@` + ns + `{1,64})?`
	crun   = sp + `+(?:` + cflags + cverb + `|respawn` + vend + `)`
	tch    = `[A-Za-z0-9_.*?\[\]{},-]`
	tnc    = `claude-` + tch + `{1,64}`
	tnsC   = `(?:claude-roll-` + tch + `{1,64}|` + tch + `{1,128}\.(?:claude-canary|claude-build|deny-settings)|\.claude-roll\.lock|(?:child|account)-deny\.settings\.json|child-deny\.digests)`
	tns    = tnsC + btEnd
	tgl    = globw + `[*?\[{]` + globw + `/{0,8}` + endAny
	clop   = `claude(?:\z|[` + wsc + `/;&|)])`
	compE  = `(?:\z|[` + wsc + `/;&|)])`
)

type buildRes struct {
	buildx, trust, cli, claudeWord, expVerb, verw, cdVersd, cd5, cd6, cd7, cdHome, cdBin    func() *regexp.Regexp
	gate6, gateLocal, gateHome, binName, pdirLocal, compClaude, pdirCcrc, pdirSess, compTnc func() *regexp.Regexp
	compTns, cdCcrcR, cdSessR, gateCcrc, gateSess                                           func() *regexp.Regexp
	buildTail, trustTail, clopTail, localTail, homeTail, binTail, tncTail, tnsTail          lastStart
}

func newBuildRes(upre string) *buildRes {
	up := never
	if upre != "" {
		up = `(?:` + upre + `)`
	}
	cupr := `(?:claude|` + up + `)`
	// BUILDX: LOC (`(?:SEPP|(?<![^WS=:'"]))\.local SEPP`) and three tails, the lookbehind taken as lbDanc
	bxBody := `\.local` + sepp + `(?:share` + sepp + `claude` + sepp + `versions` + btEnd + `|share` + sepp + `claude(?:` + sepp + globw + `[*?\[{]` + globw + `)?/{0,8}` + endAny +
		`|bin` + sepp + cupr + btEnd + `)`
	bx := tailAlts{{"", sepp + bxBody}, {lbDanc, bxBody}}
	tr := dancAlts(`\.ccrc` + sepp + `(?:` + tnc + `|` + tgl + `)`)
	tr = append(tr, dancAlts(`\.cc-sessions`+sepp+`(?:`+tns+`|`+tgl+`)`)...)
	pdir := func(d string) string { return dancT + d + `(?:/\.?){0,8}` + endAny }
	comp := func(n string) string { return `(?:\A|[` + wsc + `/=])` + n + compE }
	lbop := `bin` + sepp + cupr + endCmd
	localG := `(?:share` + sepp + clop + `|` + lbop + `)`
	return &buildRes{
		buildx:     re(bx.test()),
		trust:      re(tr.test()),
		cli:        re(`(?:` + wb + `claude[A-Za-z0-9-]*|` + wb + up + `|` + sepp + `\.local` + sepp + `bin` + sepp + `[a-z][a-z0-9-]{0,31}|` + verh + `|` + exech + `|` + runh + `)` + crun),
		claudeWord: re(wb + cupr + nwEnd),
		expVerb:    re(wb + exp + sp + `+(?:` + flags + `(?:install|update)` + nwEnd + `|` + cflags + cverb + `|respawn` + vend + `)`),
		verw:       re(`(?:\A|[` + wsc + `(])(?:\./{1,8}` + entw + `|` + vers + `)` + crun),
		cdVersd:    re(cdt(`\.local` + sepp + `share` + sepp + `claude` + sepp + `versions`)),
		cd5:        re(cdt(`\.local` + sepp + `share` + sepp + `claude(?:` + sepp + `versions)?`)),
		cd6:        re(cdt(`\.local` + sepp + `share`)),
		cd7:        re(cdt(`\.local`)),
		gate6:      re(lbTest(lbOpw) + clop),
		cdHome:     re(`(?:\A|[` + wsc + `(])(?:cd|pushd)` + sp + `+(?:-[PLe]{1,3}` + sp + `+){0,2}(?:~|\$\{?HOME\}?)/{0,8}` + endCmd + `|(?:\A|[` + wsc + `(])cd` + sp + `*\z`),
		cdBin:      re(cdt(`\.local` + sepp + `bin`)),
		binName:    re(lbTest(lbOpw) + cupr + endCmd),
		gateHome:   re(`\.local` + sepp + localG),
		pdirLocal:  re(pdir(`\.local(?:` + sepp + `(?:share|bin))?`)),
		pdirCcrc:   re(pdir(`\.ccrc`)),
		pdirSess:   re(pdir(`\.cc-sessions`)),
		compTnc:    re(comp(tnc)),
		compTns:    re(comp(tnsC)),
		gateLocal:  re(localG),
		cdCcrcR:    re(cdt(`\.ccrc`)),
		cdSessR:    re(cdt(`\.cc-sessions`)),
		gateCcrc:   re(lbTest(lbOpw) + tnc),
		gateSess:   re(lbTest(lbOpw) + tns),
		buildTail:  newLastStart(bx),
		trustTail:  newLastStart(tr),
		clopTail:   newLastStart(tailAlts{{lbOpw, clop}}),
		localTail:  newLastStart(tailAlts{{lbOpw, localG}}),
		homeTail:   newLastStart(tailAlts{{lbOpw, `\.local` + sepp + localG}}),
		binTail:    newLastStart(tailAlts{{lbOpw, cupr + endCmd}}),
		tncTail:    newLastStart(tailAlts{{lbOpw, tnc}}),
		tnsTail:    newLastStart(tailAlts{{lbOpw, tns}}),
		compClaude: re(comp(cupr)),
	}
}
