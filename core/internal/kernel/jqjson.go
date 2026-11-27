package kernel

// The jq-faithful JSON reader and writer (wave 2 inventory §2B). hookstate.json, turn.json, the spool lines and the
// approval digest are bytes jq printed (`jq -c`, `-cS`, `-cSa`), and the server or a test reads them back byte for
// byte. encoding/json writes none of them: it escapes <>& and U+2028/9, has no ordered object, and spells numbers its
// own way. Held to real jq by testdata/gen-jq-golden.sh's goldens (jq 1.7 and 1.8 print the same bytes).

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

// KV is one member of an Obj.
type KV struct {
	K string
	V any
}

// Obj is a JSON object whose members keep the order they were built or read in, as jq's objects do. It holds each key
// once (JQParse keeps a repeated key's last value at its first place, as jq does).
type Obj []KV

// JQCompact is what `jq -c` prints for v, less the newline. v is built from a closed set: nil, bool, string, int,
// int64, float64 (a number jq computed: `floor`, `+`, `tonumber`), json.Number (a literal, printed as jq 1.7+ prints
// an unchanged literal), []any, []string and Obj; anything else panics, a programming error with no jq spelling here.
func JQCompact(v any) []byte { return jqValue(nil, v, false, false) }

// JQCompactSorted is `jq -cS`: object keys sorted by their bytes (code point order), at every depth.
func JQCompactSorted(v any) []byte { return jqValue(nil, v, true, false) }

// JQCompactSortedASCII is `jq -cSa`: sorted, and every character outside ASCII as a lowercase \u escape (a UTF-16
// surrogate pair above U+FFFF).
func JQCompactSortedASCII(v any) []byte { return jqValue(nil, v, true, true) }

func jqValue(b []byte, v any, sorted, ascii bool) []byte {
	switch v := v.(type) {
	case nil:
		return append(b, "null"...)
	case bool:
		return strconv.AppendBool(b, v)
	case string:
		return jqString(b, v, ascii)
	case int:
		return strconv.AppendInt(b, int64(v), 10)
	case int64:
		return strconv.AppendInt(b, v, 10)
	case json.Number:
		return append(b, jqLiteral(string(v))...)
	case float64:
		return append(b, JQDouble(v)...)
	case []string:
		b = append(b, '[')
		for i, s := range v {
			if i > 0 {
				b = append(b, ',')
			}
			b = jqString(b, s, ascii)
		}
		return append(b, ']')
	case []any:
		b = append(b, '[')
		for i, x := range v {
			if i > 0 {
				b = append(b, ',')
			}
			b = jqValue(b, x, sorted, ascii)
		}
		return append(b, ']')
	case Obj:
		if sorted {
			v = append(Obj(nil), v...)
			sort.SliceStable(v, func(i, j int) bool { return v[i].K < v[j].K })
		}
		b = append(b, '{')
		for i, kv := range v {
			if i > 0 {
				b = append(b, ',')
			}
			b = jqString(b, kv.K, ascii)
			b = append(b, ':')
			b = jqValue(b, kv.V, sorted, ascii)
		}
		return append(b, '}')
	}
	panic(fmt.Sprintf("kernel: %T has no jq spelling", v))
}

const hexDigits = "0123456789abcdef"

func appendU(b []byte, r rune) []byte {
	return append(b, '\\', 'u', hexDigits[r>>12&15], hexDigits[r>>8&15], hexDigits[r>>4&15], hexDigits[r&15])
}

// jqString is jq's string printer: \" \\ \b \f \n \r \t, every other control character and U+007F as \u00xx, the
// rest raw (or escaped with ascii). A byte sequence that is not UTF-8 is U+FFFD, cut where jq cuts it (jqNextRune).
func jqString(b []byte, s string, ascii bool) []byte {
	b = append(b, '"')
	for i := 0; i < len(s); {
		r, n := jqNextRune(s[i:])
		i += n
		switch {
		case r == '"' || r == '\\':
			b = append(b, '\\', byte(r))
		case r == '\b':
			b = append(b, '\\', 'b')
		case r == '\f':
			b = append(b, '\\', 'f')
		case r == '\n':
			b = append(b, '\\', 'n')
		case r == '\r':
			b = append(b, '\\', 'r')
		case r == '\t':
			b = append(b, '\\', 't')
		case r < 0x20 || r == 0x7f:
			b = appendU(b, r)
		case r < 0x80:
			b = append(b, byte(r))
		case !ascii:
			b = utf8.AppendRune(b, r)
		case r > 0xffff:
			r -= 0x10000
			b = appendU(appendU(b, 0xd800|r>>10), 0xdc00|r&0x3ff)
		default:
			b = appendU(b, r)
		}
	}
	return append(b, '"')
}

// jqNextRune is jq's jvp_utf8_next: the next character of s and its length in bytes, U+FFFD for a sequence that is not
// UTF-8. Unlike Go's decoder, which replaces byte by byte, it takes a lead byte's whole run of continuation bytes as
// one bad character (a truncated or overlong sequence, or an encoded surrogate, is one U+FFFD).
func jqNextRune(s string) (rune, int) {
	c := s[0]
	var n int
	var r rune
	switch {
	case c < 0x80:
		return rune(c), 1
	case c < 0xc2 || c > 0xf4: // a continuation byte out of place, or a lead byte UTF-8 never uses
		return utf8.RuneError, 1
	case c < 0xe0:
		n, r = 2, rune(c&0x1f)
	case c < 0xf0:
		n, r = 3, rune(c&0x0f)
	default:
		n, r = 4, rune(c&0x07)
	}
	if n > len(s) {
		return utf8.RuneError, len(s)
	}
	for i := 1; i < n; i++ {
		if s[i]&0xc0 != 0x80 {
			return utf8.RuneError, i
		}
		r = r<<6 | rune(s[i]&0x3f)
	}
	if r < [...]rune{0, 0, 0x80, 0x800, 0x10000}[n] || (r >= 0xd800 && r <= 0xdfff) || r > 0x10ffff {
		return utf8.RuneError, n
	}
	return r, n
}

// jqLiteral is how jq 1.7+ prints a number literal it read and did not change: decNumber's to-scientific-string of the
// literal's coefficient and exponent, so 1.50 stays 1.50, 1e2 is 1E+2 and 0.1e-6 is 1E-7. s is a JSON number.
func jqLiteral(s string) string {
	var b strings.Builder
	if strings.HasPrefix(s, "-") {
		b.WriteByte('-')
		s = s[1:]
	}
	mant, exp := s, 0
	if i := strings.IndexAny(s, "eE"); i >= 0 {
		e, err := strconv.Atoi(s[i+1:])
		if err != nil { // shortcut: an exponent past int's range is printed as written; jq's decNumber clamps it
			return b.String() + s
		}
		mant, exp = s[:i], e
	}
	ip, frac, _ := strings.Cut(mant, ".")
	digits := strings.TrimLeft(ip+frac, "0")
	if digits == "" {
		digits = "0"
	}
	exp -= len(frac)
	adj := exp + len(digits) - 1
	switch p := len(digits) + exp; {
	case exp > 0 || adj < -6:
		b.WriteString(digits[:1])
		if len(digits) > 1 {
			b.WriteByte('.')
			b.WriteString(digits[1:])
		}
		b.WriteByte('E')
		if adj >= 0 {
			b.WriteByte('+')
		}
		b.WriteString(strconv.Itoa(adj))
	case exp == 0:
		b.WriteString(digits)
	case p > 0:
		b.WriteString(digits[:p] + "." + digits[p:])
	default:
		b.WriteString("0." + strings.Repeat("0", -p) + digits)
	}
	return b.String()
}

// JQDouble is how jq 1.7+ prints a number it computed (jv_dtoa_fmt): the shortest digits that read back as x, fixed
// unless the decimal point sits 4 or more places left of them or more than 15 places right of their end, else
// `d.ddde±XX` (two exponent digits at least); NaN is null and an infinity the largest double. Held to real jq by
// testdata/jq-double.golden.
func JQDouble(x float64) string {
	switch {
	case math.IsNaN(x):
		return "null"
	case math.IsInf(x, 1):
		return "1.7976931348623157e+308"
	case math.IsInf(x, -1):
		return "-1.7976931348623157e+308"
	case x == 0:
		if math.Signbit(x) {
			return "-0"
		}
		return "0"
	}
	sign := ""
	if x < 0 {
		sign, x = "-", -x
	}
	e := strconv.FormatFloat(x, 'e', -1, 64) // d.ddde±XX
	mant, exp, _ := strings.Cut(e, "e")
	digits := strings.Replace(mant, ".", "", 1)
	n, _ := strconv.Atoi(exp)
	decpt, nd := n+1, len(digits)
	switch {
	case decpt <= -4 || decpt > nd+15:
		out := digits[:1]
		if nd > 1 {
			out += "." + digits[1:]
		}
		es := "+"
		if n < 0 {
			es, n = "-", -n
		}
		if n < 10 {
			es += "0"
		}
		return sign + out + "e" + es + strconv.Itoa(n)
	case decpt <= 0:
		return sign + "0." + strings.Repeat("0", -decpt) + digits
	case decpt >= nd:
		return sign + digits + strings.Repeat("0", decpt-nd)
	}
	return sign + digits[:decpt] + "." + digits[decpt:]
}

// JQParseFirst reads the first JSON value of data as JQParse does and ignores what follows it: what a `jq` program
// over a file shows of its first input, the only one a reader of a hook file takes (`read` keeps its first lines).
// shortcut (D-TBD-go-hook-first-value): jq goes on to later inputs after one that errors; no hook file holds more than one value.
func JQParseFirst(data []byte) (any, error) {
	p := &jqParser{b: data}
	return p.value(0)
}

// JQParse reads one JSON value as jq reads it: objects as Obj in document order (a repeated key keeps its first place
// and takes its last value), numbers as json.Number (their literal), and a high surrogate escape with no low one after
// it refused, as jq refuses it. Each string is unescaped first and then made UTF-8 within its own end, as jq's parser
// does: a byte sequence that is not UTF-8 is cut where jqNextRune cuts it, so a lead byte whose sequence runs past the
// string's closing quote takes the rest of the string as one U+FFFD. Number spellings JSON does not have but jq reads (nan,
// Infinity, 01, +1, .5, 1.) are read as jq reads them (jqNumber); several values in a row are JQParseAll's.
func JQParse(data []byte) (any, error) {
	p := &jqParser{b: data}
	v, err := p.value(0)
	if err != nil {
		return nil, err
	}
	if p.ws(); p.i != len(p.b) {
		return nil, p.fail("more than one JSON value")
	}
	return v, nil
}

// JQParseAll reads data as jq reads its inputs (`jq <prog> <<<text`, `jq <prog> file`): each JSON value in turn,
// whitespace between, each read as JQParse reads one. It answers the values read before the first that does not parse,
// and that error: jq stops at a parse error, after running its program over the inputs before it.
func JQParseAll(data []byte) ([]any, error) {
	p := &jqParser{b: data}
	var vs []any
	for p.ws(); p.i < len(p.b); p.ws() {
		v, err := p.value(0)
		if err != nil {
			return vs, err
		}
		vs = append(vs, v)
	}
	return vs, nil
}

type jqParser struct {
	b []byte
	i int
}

// jqMaxDepth keeps the parser's stack finite; it is not measured against jq's own depth limit.
const jqMaxDepth = 10000

func (p *jqParser) fail(what string) error { return fmt.Errorf("kernel: %s at byte %d", what, p.i) }

func (p *jqParser) ws() {
	for p.i < len(p.b) && (p.b[p.i] == ' ' || p.b[p.i] == '\t' || p.b[p.i] == '\n' || p.b[p.i] == '\r') {
		p.i++
	}
}

// at answers whether the next byte, after whitespace, is c, and takes it when it is.
func (p *jqParser) at(c byte) bool {
	if p.ws(); p.i < len(p.b) && p.b[p.i] == c {
		p.i++
		return true
	}
	return false
}

func (p *jqParser) value(depth int) (any, error) {
	if depth > jqMaxDepth {
		return nil, p.fail("nesting too deep")
	}
	if p.ws(); p.i == len(p.b) {
		return nil, p.fail("no value")
	}
	switch c := p.b[p.i]; {
	case c == '[':
		p.i++
		arr := []any{}
		if p.at(']') {
			return arr, nil
		}
		for {
			v, err := p.value(depth + 1)
			if err != nil {
				return nil, err
			}
			arr = append(arr, v)
			if p.at(']') {
				return arr, nil
			}
			if !p.at(',') {
				return nil, p.fail("expected , or ]")
			}
		}
	case c == '{':
		p.i++
		obj := Obj{}
		if p.at('}') {
			return obj, nil
		}
		for {
			if p.ws(); p.i == len(p.b) || p.b[p.i] != '"' {
				return nil, p.fail("an object key must be a string")
			}
			k, err := p.str()
			if err != nil {
				return nil, err
			}
			if !p.at(':') {
				return nil, p.fail("expected :")
			}
			v, err := p.value(depth + 1)
			if err != nil {
				return nil, err
			}
			obj = obj.put(k, v)
			if p.at('}') {
				return obj, nil
			}
			if !p.at(',') {
				return nil, p.fail("expected , or }")
			}
		}
	case c == '"':
		return p.str()
	}
	return p.literal()
}

// literal reads what jq's lexer calls a literal: the run of characters up to a blank or one of `[]{},:"`, then judged
// whole (so `truex`, `nulll` and `1-1` are refused, as jq refuses them). true, false, null, or a number as jq reads one
// (jqNumber).
func (p *jqParser) literal() (any, error) {
	start := p.i
	for p.i < len(p.b) && !strings.ContainsRune(" \t\n\r[]{},:\"", rune(p.b[p.i])) {
		p.i++
	}
	tok := string(p.b[start:p.i])
	switch tok {
	case "":
		return nil, p.fail("not a JSON value")
	case "true":
		return true, nil
	case "false":
		return false, nil
	case "null":
		return nil, nil
	}
	if v, ok := jqNumber(tok); ok {
		return v, nil
	}
	return nil, p.fail("not a JSON value")
}

// jqNumber is jq 1.7's and 1.8's reading of a number token (decNumber's string syntax, less NaN payloads): an optional
// sign, then digits with an optional point and digits on either side of it (`01`, `.5`, `1.`), then an optional exponent;
// or `nan` or `snan` (a NaN, which prints as null), or `inf` or `infinity` (the largest double); every letter in either
// case. Measured on jq 1.7 and 1.8.1 alike (testdata/gen-jq-numbers.sh, jq-numbers.golden). A decimal keeps its literal
// (normalised to a JSON number), as jq keeps it.
func jqNumber(tok string) (any, bool) {
	s, neg := tok, false
	if s != "" && (s[0] == '+' || s[0] == '-') {
		neg, s = s[0] == '-', s[1:]
	}
	switch strings.ToLower(s) {
	case "nan", "snan":
		return math.NaN(), true
	case "inf", "infinity":
		if neg {
			return math.Inf(-1), true
		}
		return math.Inf(1), true
	}
	i := 0
	digits := func() string {
		j := i
		for ; i < len(s) && s[i] >= '0' && s[i] <= '9'; i++ {
		}
		return s[j:i]
	}
	ip := digits()
	frac, hasPoint := "", false
	if i < len(s) && s[i] == '.' {
		i++
		hasPoint, frac = true, digits()
	}
	if ip == "" && frac == "" {
		return nil, false
	}
	exp := ""
	if i < len(s) && (s[i] == 'e' || s[i] == 'E') {
		j := i
		i++
		if i < len(s) && (s[i] == '+' || s[i] == '-') {
			i++
		}
		if digits() == "" {
			return nil, false
		}
		exp = s[j:i]
	}
	if i != len(s) {
		return nil, false
	}
	ip = strings.TrimLeft(ip, "0")
	if ip == "" {
		ip = "0"
	}
	out := ip
	if hasPoint && frac != "" {
		out += "." + frac
	}
	if neg {
		out = "-" + out
	}
	return json.Number(out + strings.TrimPrefix(exp, "+")), true
}

// put is o with k set to v: a key already there keeps its place and takes v, as jq's objects do.
func (o Obj) put(k string, v any) Obj {
	for i := range o {
		if o[i].K == k {
			o[i].V = v
			return o
		}
	}
	return append(o, KV{K: k, V: v})
}

// str takes a string: its escapes undone into bytes, then those bytes made UTF-8 within the string (jqRepair).
func (p *jqParser) str() (string, error) {
	p.i++ // the opening quote
	var raw []byte
	for {
		if p.i == len(p.b) {
			return "", p.fail("an unterminated string")
		}
		c := p.b[p.i]
		p.i++
		switch {
		case c == '"':
			return jqRepair(raw), nil
		case c < 0x20:
			return "", p.fail("a control character in a string")
		case c != '\\':
			raw = append(raw, c)
			continue
		}
		if p.i == len(p.b) {
			return "", p.fail("an unterminated string")
		}
		e := p.b[p.i]
		p.i++
		switch e {
		case '"', '\\', '/':
			raw = append(raw, e)
		case 'b':
			raw = append(raw, '\b')
		case 'f':
			raw = append(raw, '\f')
		case 'n':
			raw = append(raw, '\n')
		case 'r':
			raw = append(raw, '\r')
		case 't':
			raw = append(raw, '\t')
		case 'u':
			r, ok := p.hex4()
			if !ok {
				return "", p.fail("a bad unicode escape")
			}
			if r >= 0xd800 && r <= 0xdbff {
				lo := rune(-1)
				if p.i+1 < len(p.b) && p.b[p.i] == '\\' && p.b[p.i+1] == 'u' {
					p.i += 2
					lo, _ = p.hex4()
				}
				if lo < 0xdc00 || lo > 0xdfff {
					return "", p.fail("a high surrogate escape with no low one after it")
				}
				r = 0x10000 + (r-0xd800)<<10 + (lo - 0xdc00)
			}
			if r >= 0xdc00 && r <= 0xdfff { // a lone low surrogate: its three bytes, as jq encodes it, for jqRepair to cut
				raw = append(raw, byte(0xe0|r>>12), byte(0x80|r>>6&0x3f), byte(0x80|r&0x3f))
			} else {
				raw = utf8.AppendRune(raw, r)
			}
		default:
			return "", p.fail("an invalid escape")
		}
	}
}

func (p *jqParser) hex4() (rune, bool) {
	if p.i+4 > len(p.b) {
		return -1, false
	}
	n, err := strconv.ParseUint(string(p.b[p.i:p.i+4]), 16, 32)
	if err != nil {
		return -1, false
	}
	p.i += 4
	return rune(n), true
}

// jqRepair is one string's bytes as UTF-8, cut as jq cuts them, with the string's own end as the end.
func jqRepair(raw []byte) string {
	if utf8.Valid(raw) { // Go's validity is jq's (no overlong form, no surrogate, nothing past U+10FFFF)
		return string(raw)
	}
	var out []byte
	for s := string(raw); s != ""; {
		r, n := jqNextRune(s)
		out = utf8.AppendRune(out, r)
		s = s[n:]
	}
	return string(out)
}

// JQRepair is a text jq is handed as a string (`--arg`), made UTF-8 as jq makes it: each byte sequence that is not
// UTF-8 cut and replaced where jqNextRune cuts it.
func JQRepair(raw []byte) string { return jqRepair(raw) }
