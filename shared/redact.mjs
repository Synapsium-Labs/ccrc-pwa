// THE REDACTOR'S ONE RULE TABLE (D-5867, ARCH-66 (#801); spec 2026-10-19 K7's TS half, section 2.3's redaction row).
//
// One implementation, as `models.mjs` is: this file runs everywhere, `redact.d.mts` types it for TypeScript callers and
// `redact.ts` re-exports it. It is L0 and BROWSER-SAFE: it imports nothing, names no host global (no process object,
// no byte-buffer class, no module loader, no built-in module specifier) and runs nothing at load beyond building its
// table, because `shared/docs.ts` imports it and the PWA bundles `shared/docs.ts`. A CLI form for ccd's halves lives in
// its own file (W5), never here. `docs-shared.test.ts` runs the L0 refusal patterns over this file's every byte.
//
// A RULE is an id and a step: `make(shapes)` returns `(text, tally) => text`, and the step adds to `tally.masked` one
// for each span it replaced with a different text (`redactCount`; a span a pattern matches and gives back unchanged,
// such as an already masked value, is not counted). A rule that is one pattern and one replacement is built by `sub`;
// the three that need a loop (`secret-assigns`, `program-flags`, `token-segments`) are written as steps of their own.
// Rule ids are unique. A PROFILE is a plain frozen list of rule ids, in the order they run, and it lists every id it
// runs: no profile inherits another's rules, so reading one list tells what that profile does. `linear-egress` lists
// rules `egress` also lists; that is two lists naming one rule, not one profile inheriting another.
//
//   - `egress`: the command redactor for untrusted child input (D-5299, D-5360; coordinator-first routing spec
//     2026-10-17 section 6.7). Every mask is `[REDACTED]`. It is a security boundary: its output over the 196-row
//     corpus (`server/test/fixtures/approvals/redact-corpus.json`) is byte for byte what it was before this table.
//   - `docs`: the native Docs reader's redactor (docs W1, design 2026-10-01 section 2 (b)). Every mask is `***`. ccd's
//     python `REDACT_RULES` is a parity copy of its rows (`docs-parity.test.ts`).
//   - `linear-egress`: the redactor for prose a session sends to Linear (#1444): a title, a description, a comment body,
//     a search term. It lists only the credential-shape rules of `egress` (`jwt`, `header`, `bearer`, the two
//     URL-userinfo rules, `secret-assigns`, `known-token`), and leaves out `token-segments`, the flag rules,
//     `json-pair`, `yaml-secret`, `secret-word` and the program-scoped rules: those were built for command lines, and
//     over a ticket they would mask a commit SHA, a UUID or a dated spec path, or read prose as argv. Every mask is
//     `[REDACTED]`, and it takes the caller's `shapes` as `egress` does.
//   - `history-base` and `history-v2` (C1l PR 2; the history coordinator's ack, which names R11): ccrc history's layer 2,
//     the context rules `ccd/history/lib.mjs`'s redaction doors read. They are not text steps: a history rule is an id,
//     the slot of the rule set it fills and a pattern built in two forms, `field` (the field pass) and `final` (the
//     second belt's structure-safe form, D-4613), and `historyRules(profile)` builds a profile into the frozen
//     `{ field, final }` rule set lib reads; `redact` refuses a history profile. `history-base` is the rev 3.6 rules
//     (BELT_VERSION 1), R11's base, which every door reads first; `history-v2` is the widened rules, which every door reads
//     over the base's output (lib's `composeDoor`). The two list the same rules but one: the named value, whose field form
//     is v1's class in the base (`history-named-value-v1`) and the widened class in v2 (`history-named-value`, D-5745).
//     Both are built from one template, the history rows below, which lib held as `contextRules` before the move; lib
//     builds `BASE_RULES` and `CONTEXT_RULES` as one line each over these profiles and keeps no copy. A history rule's
//     bytes are part of every stored index text: changing one is a `BELT_VERSION` bump and a reindex, the history
//     programme's, never a change made here alone.
//
// The URL-userinfo rule differs between the two (the egress rule masks to the LAST `@` before the host, because a
// password may hold an `@`; the docs rule stops at the FIRST), so it is two rules with two ids and no profile shares
// it. No rule is unified across profiles.
//
// The egress and linear-egress profiles read two credential shapes, the generic `sk-` token and the JWT, from their
// caller as `shapes` (`{ genericSk, jwt }`): their one home is `CREDENTIAL_MASKS` in `shared/api.ts` (D-5513), and this
// file imports nothing. A caller that runs either profile passes them; the docs profile needs none.
//
// THE EGRESS SHAPES. A child's tool input is untrusted text, and it can carry a secret the child pasted into a command.
// Before any input is stored on an approval row, mailed to a coordinator, put in a digest or shown on a surface, the
// egress profile masks the token-shaped strings in it:
//   - `Authorization:` and `Cookie:` header values (and `Proxy-Authorization:`, `Set-Cookie:`), and the value of any
//     header named `...-Key`, `...-Token`, `...-Secret` or `...-Signature` (`X-Api-Key:`, `Private-Token:`), to the end
//     of the value (D-5360);
//   - `Bearer ...`;
//   - the value of an assignment to a name that holds `SECRET`, `TOKEN`, `PASSWORD`, `PASSWD`, `PASSPHRASE`,
//     `CREDENTIAL`, `AUTH` (not `AUTHOR`), `PWD` or `KEY` anywhere, or ends with `PASS` or `PAT` (any case; `TOKEN=...`,
//     `GH_TOKEN=...`, the glued `PGPASSWORD=...`, `BORG_PASSPHRASE=...`, a query's `auth=...` alike), the whole value as
//     bash joins it into one word (quoted, `$'...'`, escaped and unquoted pieces together); the next word after such a
//     name with an underscore in it (`aws configure set aws_secret_access_key ...`), never a word that starts with
//     `-`; and the next word after any long flag that is, or ends after a `-` in, `pass`, `password`, `passwd`,
//     `passphrase`, `secret`, `token`, `key`, `apikey` or `auth` (`--auth-token`, `--client-secret`,
//     `--http-password`, `--secret-access-key`, `--private-key`, `--auth`; not `--key-file`), never a following word
//     that starts with `<`, `>` or `-`, and after `--body` / `-b` in a `gh secret set` command (D-5360, rounds 5, 7);
//   - review round 4: the next word after a separate `-p` in a `docker`, `sshpass`, `mysql` or `mariadb` command and
//     after `-a` in a `redis-cli` one; `pass:<word>`; a quoted `-u` / `-p` value or quoted URL userinfo holding a
//     space, to its closing quote; a YAML-style `token: ...` / `password: ...` (and `passwd`, `secret`, `api_key`) to
//     the end of its value; a JSON `"password": "..."` (any key holding one of those words); a JWT (`eyJ....eyJ....`);
//   - a URL's userinfo, whole, to the last `@` before the host (`https://user:p@ss@host`, `https://token@host`), the
//     password of `-u` / `--user user:pass` (attached or not; with an empty user, `-u :token`, and the user side when
//     the password side is empty, `-u token:`), an attached `-p<password>` of four or more characters,
//     and a quoted attached `-p'<password>'` (D-5360);
//   - review round 8: the next word (or `=` value) after a single-dash long flag ending in `pass`, `password`,
//     `passwd`, `passphrase`, `token` or `secret` (`keytool -storepass`, `-keypass`, `-srcstorepass`, `tool
//     -password`), after a camelCase long flag ending in `Token`, `Secret`, `Password`, `Passwd`, `Pass`, `Key` or
//     `ApiKey` (`--accessToken`, `--clientSecret`), and after `--pw`, `--pwd`, `--...-bearer` and `--credentials`;
//     `-w` in an OpenLDAP client; `-p` in `mongosh` / `mongo` and the mongo tools; xfreerdp's `/p:`; and an attached
//     `-p<password>` is never read off a `-pass...` flag word (`-password` is never `-p` plus `assword`);
//   - review round 9: every secret-flag value (`secret-flag`, `single-dash-secret`, `camel-secret-flag`, and the
//     program-scoped `-p`, `-w`, `-a` and `--body`) is the whole word bash joins, as for an assignment (`--password
//     "hun"ter2`, `-storepass $'x'` mask whole, so every mask is idempotent), never a word starting with `<`, `>` or
//     `-`; a double-dash secret flag takes any `[A-Za-z0-9-]` prefix before its tail (`--dbpassword`, `--authtoken`,
//     `--authkey`, `--secretkey`; not `--bypass`, and `--key-file` / `--keyring` stay readable), and the tail gains
//     `creds` (`--creds`, `--src-creds`, `--dest-creds`); `-U` / `--proxy-user user:pw`; a scheme-less proxy userinfo
//     `-x` / `--proxy user:pw@host`; the passphrase after `:` in `--cert <file>:<pw>` and in curl's `-E <file>:<pw>`;
//     `-w` in `security add-*-password`; `-p` in `podman`, `buildah`, `nerdctl`, `twine` and `helm registry`; a
//     Hugging Face `hf_` token of 30 or more letters and digits;
//   - a known token by its prefix, at any length: `sk_live_`, `sk_test_`, `rk_live_`, `ghp_`, `gho_`, `ghu_`, `ghs_`,
//     `ghr_`, `github_pat_`, `glpat-`, `xox[abprs]-`, `xapp-`, `npm_`, `pypi-`, `AKIA...`, `ASIA...`, `AIza...`,
//     `sk-...` (D-5360), a Linear API key's `lin_api_` (#1444), and a Slack webhook's path and a Telegram bot token;
//   - every `/`-separated segment of 32 or more base64 or hex characters that holds a digit and a letter (spec section
//     6.7; D-5360): a segment is judged on its own, so a secret inside a URL path or a base64 value with a `/` in it is
//     masked, while a path whose segments are short or are words (`project-a-quiet-basin-with-a-long-name`) stays
//     readable.
// Each mask is the one word `[REDACTED]`, and the redactor is idempotent: a masked text redacts to itself.
//
// Masking is best effort over shapes (spec section 6.7), not a proof that no secret survives. Every shape still kept
// (round 9):
//   - positional passwords: `htpasswd -b file user PASS`, a netrc line's `password X`, `npm config set
//     //host/:_authToken X`, `heroku auth:token X`, `nmcli ... password X`, `mysqladmin ... password X`, `rabbitmqctl
//     add_user u X`, `mc alias set ... ACCESS SECRET`, `sqlplus user/pw@db`;
//   - short or program flags outside the scoped lists: `sqlcmd -P`, `az login -p`, `oras login -p`, `cf login -p`,
//     `oc login -p`, `zip -P`, `unzip -P`, `mosquitto_pub -P`, `openssl -k`, `ssh-keygen -P` / `-N`, `doctl auth init
//     -t`, `rar -hp<pw>`, `smbclient -U user%pw`, `lftp -u user,pw`, `wrangler secret put X --value X`,
//     `kubectl --from-literal=key=X`;
//   - token shapes with no prefix rule: a Discord bot token (three dot-separated parts, each under 32 characters), a
//     HashiCorp Vault token (`s....`, `hvs....`, `hvb....`), a `gsk_` token, a bare secret with no name in front of it
//     that is only short `/`-separated segments;
//   - names and headers: an assignment written with spaces around `=`, a secret name the name test does not hold
//     (`PW=`), an `X-Auth:`, `X-Password:` or `X-Api-Pass:` header, a header with no space after its colon whose name
//     has no `-Key` / `-Token` suffix (`apikey:X`, `token:X`), a `DSN=`, `?sig=` or `?signature=` value, a cookie
//     (`--cookie "session=..."`, `-b "sid=..."` outside `gh secret set`);
//   - flag forms: a flag value after a backslash-escaped space (`--secret-key\ X`), a value that starts with `-`, `<`
//     or `>`, an attached `-p` password that is itself all letters after `-pass` (`-passpass`), any single-dash
//     `-...pass` word read as a secret flag (`-bypass X` is masked: an over-mask);
//   - input the command does not hold: a here-string or piped secret (`<<< X`, `echo X | sudo -S`, `--password-stdin`).
//
// THE DOCS SHAPES. `_docs_py` runs the docs profile over every string derived from stderr or a traceback; the L3
// adapter runs it again over every such string field of a failure body. Each docs row is `[pattern, suffix]`, applied
// in order, globally; a match becomes group 1 (when the pattern has one) followed by `suffix`. That form needs no
// replacement-template syntax, which differs between python (`\1`) and JS (`$1`). Whitespace is the explicit ASCII
// class `[\t\n\v\f\r ]`, never `\s`: python's str `\s` also matches U+001C..U+001F and JS's matches U+FEFF, so one `\s`
// literal would redact differently on the two sides. The docs rows are pure ASCII.

/** The egress mask. */
export const EGRESS_MASK = '[REDACTED]';
const R = EGRESS_MASK;

// ---- the egress patterns ----------------------------------------------------------------------------------------

/** Round 9: the name starts at a word's left edge (`\b` restarted the scan at every inner `-`, quadratic). */
const HEADER = /(?<![A-Za-z0-9-])((?:Proxy-)?Authorization|(?:Set-)?Cookie|[A-Za-z][A-Za-z0-9-]*-(?:Key|Token|Secret|Signature))(\s*:\s*)([^\r\n'"]*[^\s'"])/gi;
const BEARER = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi;
/** A secret name (D-5360, review rounds 3 to 5): one that holds `SECRET`, `TOKEN`, `PASSWORD`, `PASSWD`,
 *  `PASSPHRASE`, `CREDENTIAL`, `AUTH` (not `AUTHOR`, so `GIT_AUTHOR_NAME=` is kept), `PWD` or `KEY` ANYWHERE
 *  (`GH_TOKEN`, `PGPASSWORD`, `BORG_PASSPHRASE`, `SECRET_KEY_BASE`, `MYSQL_PWD`, a query's `auth=`), or ends with
 *  `PASS` or `PAT` (`SSHPASS`, `GH_PAT`; not anywhere, or `PATH=` would be masked), in any case. */
const SECRET_NAME_TEST = /SECRET|TOKEN|PASSWORD|PASSWD|PASSPHRASE|CREDENTIAL|AUTH(?!OR)|PWD|KEY|PASS$|PAT$/i;
/** `NAME=` at a name's left edge; the name is judged by `SECRET_NAME_TEST`, its value is `ASSIGN_VALUE`. */
const ASSIGN_HEAD = /(?<![A-Za-z0-9_])[A-Za-z0-9_]+=/g;
/** An assignment's value: a run of pieces, as bash joins them into one word (D-5360, review round 5): double-quoted
 *  text, single-quoted or `$'...'` text, a backslash escape (`a\ b`), unquoted characters (`pre"fix"`, `"hun"ter2`).
 *  Linear: each branch starts with a different character. */
const VALUE = String.raw`(?:"[^"]*"|\$?'[^']*'|\\.|[^\s;&|'"\\])+`;
const ASSIGN_VALUE = new RegExp(VALUE, 'y');
/** A secret-named word with an underscore, then its value as the next word (`aws_secret_access_key VALUE`). The
 *  next word never starts with `-` (D-5360, review round 5: in `gh secret set DEPLOY_KEY --body x` it is a flag). */
const SECRET_WORD = new RegExp(String.raw`(?<![A-Za-z0-9_])((?:[A-Za-z0-9]+_)+(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|PASS|PAT|PWD))([ \t]+)(?:"[^"]*"|'[^']*'|[^\s;&|'"=\[-][^\s;&|'"=\[]*)`, 'gi');
/** A URL's userinfo, to the LAST `@` before the host (spec section 6.7: a password may hold an `@`). */
const URL_USERINFO = /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/)[^/?#\s'"]*@/gi;
/** `-u user:pass`, the user side possibly empty (`-u :token`, D-5360 review round 5). */
const USER_FLAG = /(^|[\s'"])(-u|--user|-U|--proxy-user)(\s*|=)(['"]?)([^\s:'"]*):[^\s'"]+/g;
/** D-5360 round 9: a scheme-less proxy userinfo, `-x` / `--proxy user:pw@host` (a URL with a scheme is
 *  `URL_USERINFO`'s): the password side to the last `@`. */
const PROXY_USERINFO = /(^|[\s'"])(-x|--proxy)(\s*|=)(['"]?)([^\s:'"@/]*):(?!\/\/)[^\s'"]*@/g;
/** D-5360 round 9: a client certificate's passphrase, `--cert <file>:<pw>` (and curl's `-E`, in a curl segment). */
const CERT_PASS = /(^|[\s'"])(--cert)(\s+|=)(['"]?)([^\s:'"]+):[^\s'"]+/g;
const CURL_E_PASS = /(^|[\s'"])(-E)(\s*)(['"]?)([^\s:'"]+):[^\s'"]+/g;
const CURL_PROGRAMS = /(?<![\w-])curl(?![\w-])/;
/** `-u token:`, an empty password side: the user side is the secret. */
const USER_EMPTY_PASS = /(^|[\s'"])(-u|--user|-U|--proxy-user)(\s*|=)(['"]?)[^\s:'"]+:(?=$|[\s'"])/g;
/** An attached `-p<password>`. D-5360 round 8: never a secret word itself, so `-pass`, `-password`, `-passwd`,
 *  `-passphrase` and any other all-letter `-pass...` flag (`-passin`, `-passout`) are never read as `-p` plus a value
 *  (`SINGLE_DASH_SECRET` masks the word after the secret ones). */
const P_FLAG = /(^|[\s'"])-p(?![\s'"=-])(?!\[REDACTED\])(?!ass[A-Za-z]*(?=$|[\s'"=]))[^\s'"]{4,}/g;
/** A quoted attached `-p'<password>'` / `-p"<password>"` (D-5360 review round 3). */
const P_QUOTED = /(^|\s)-p(?:'[^']+'|"[^"]+")/g;
/** The next word after a long flag that is, or ends after a `-` in, `pass`, `password`, `passwd`, `passphrase`,
 *  `secret`, `token`, `key`, `apikey` or `auth` (`--password`, `--auth-token`, `--client-secret`, `--api-key`,
 *  round 7's `--http-password`, `--admin-password`, `--secret-access-key`, `--account-key`, `--private-key`, `--auth`;
 *  D-5360 review rounds 5 and 7), or its `=` value. `--key-file` / `--keyring` stay readable: the tail must end the
 *  flag. A following word that starts with `<`, `>` or `-` is never the value (`--with-token <<< x` masks no
 *  operator). */
const SECRET_FLAG = new RegExp(String.raw`(^|[\s'"])(--(?!bypass(?![A-Za-z0-9-]))[A-Za-z0-9-]*(?:pass|password|passwd|passphrase|secret|token|key|apikey|auth|pw|pwd|bearer|credentials?|creds))(\s+(?![<>-])|=)${VALUE}`, 'gi');
/** D-5360 round 8: a single-dash long flag that ends in `pass`, `password`, `passwd`, `passphrase`, `token` or
 *  `secret` (`keytool -storepass X`, `-keypass`, `-srcstorepass`, `-deststorepass`, `tool -password X`, `-token X`),
 *  its next word or its `=` value, on the same terms as `SECRET_FLAG`. */
const SINGLE_DASH_SECRET = new RegExp(String.raw`(^|[\s'"])(-(?!-)[A-Za-z0-9-]*(?:pass|password|passwd|passphrase|token|secret))(\s+(?![<>-])|=)${VALUE}`, 'gi');
/** D-5360 round 8: a camelCase long flag whose last part is `Token`, `Secret`, `Password`, `Passwd`, `Pass`, `Key` or
 *  `ApiKey` (`--accessToken X`, `--clientSecret X`, `--dbPassword=X`). Case-sensitive, so the tail is a capitalised
 *  part; `SECRET_FLAG` already takes the dashed and lower-case forms. */
const CAMEL_SECRET_FLAG = new RegExp(String.raw`(^|[\s'"])(--?[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)*?(?:Token|Secret|Password|Passwd|Pass|ApiKey|Key))(\s+(?![<>-])|=)${VALUE}`, 'g');
/** D-5360 round 8: xfreerdp's `/p:<password>`. */
const RDP_PASS = /(^|[\s'"])\/p:[^\s;&|'"]+/g;
const KNOWN_TOKEN_PREFIX = String.raw`(?<![A-Za-z0-9_-])(?:(?:sk|rk)_(?:live|test)_|gh[pousr]_|github_pat_|glpat-|lin_api_|xox[abprs]-|xapp-|npm_|pypi-)[A-Za-z0-9_-]+|(?<![A-Za-z0-9])(?:(?:AKIA|ASIA)[0-9A-Z]{16}|hf_[A-Za-z0-9]{30,}|AIza[0-9A-Za-z_-]{20,}|`;
const SLACK_HOOK = /(hooks\.slack\.com\/(?:services|workflows|triggers)\/)[^\s'"]+/gi;
const TELEGRAM_BOT = /\bbot[0-9]{5,}:[A-Za-z0-9_-]{20,}/g;
/** A base64 (standard or URL-safe) or hex run; hex is a subset of the class. Linear: one class, no nesting. */
const TOKEN_RUN = /[A-Za-z0-9+/_-]{32,}={0,2}/g;
const TOKEN_SEGMENT = /^(?=[^/]*[0-9])(?=[^/]*[A-Za-z])[A-Za-z0-9+_-]{32,}={0,2}$/;

/** D-5360, review round 4: the word after a separate `-p` in a `docker`, `sshpass`, `mysql` or `mariadb` command,
 *  and after `-a` in a `redis-cli` one, judged per command segment (split on `;`, `&`, `|` and newlines). */
const P_WORD_PROGRAMS = /(?<![\w-])(?:docker|podman|buildah|nerdctl|twine|helm\s+registry|sshpass|mysql|mariadb|mongo(?:sh|dump|restore|export|import)?)(?![\w-])/;
/** D-5360 round 8: `-w <password>` (spaced or attached) in an OpenLDAP client (`ldapsearch`, `ldapmodify`, `ldapadd`,
 *  `ldapdelete`, `ldapmodrdn`, `ldapcompare`, `ldappasswd`, `ldapwhoami`). */
const W_WORD_PROGRAMS = /(?<![\w-])(?:ldap(?:search|modify|add|delete|modrdn|compare|passwd|whoami)|security\s+add-[a-z]+-password)(?![\w-])/;
const W_WORD = new RegExp(String.raw`(^|\s)-w([ \t]+(?![<>-])|(?=[^\s'"-]))${VALUE}`, 'g');
const A_WORD_PROGRAMS = /(?<![\w-])redis-cli(?![\w-])/;
const P_WORD = new RegExp(String.raw`(^|\s)-p([ \t]+(?![<>-]))${VALUE}`, 'g');
const A_WORD = new RegExp(String.raw`(^|\s)-a([ \t]+(?![<>-]))${VALUE}`, 'g');
/** D-5360, review round 5: `gh secret set NAME --body VALUE` / `-b VALUE` / `--body=VALUE`. */
const GH_SECRET_SET = /(?<![\w-])gh\s+secret\s+set(?![\w-])/;
const BODY_WORD = new RegExp(String.raw`(^|\s)(--body|-b)([ \t]+(?![<>-])|=)${VALUE}`, 'g');
/** `pass:<word>` (`openssl ... -pass pass:...`). */
const PASS_ARG = /(?<![\w-])pass:[^\s;&|'"]+/g;
/** A quoted `-u` / `--user` value holding a space (`-u 'admin:S3cret Passw0rd'`): the password to the closing quote. */
const USER_QUOTED = /(^|\s)(-u|--user|-U|--proxy-user)(\s*|=)(?:'([^\s:']+):[^']*'|"([^\s:"]+):[^"]*")/g;
/** A quoted URL whose userinfo holds a space (`"https://user:pa ss@host/"`): to the last `@` before the host, inside
 *  the quotes. */
const URL_USERINFO_QUOTED = /(["'])([a-z][a-z0-9+.-]*:\/\/)[^/?#'"\n]*@/gi;
/** A YAML-style `token: ...` / `password: ...` (and `passwd`, `secret`, `api_key`, `apikey`), to the end of the value. */
const YAML_SECRET = /(?<![\w-])((?:[A-Za-z0-9]+_)*(?:token|password|passwd|secret|api_?key))(\s*:[ \t]+)[^\s'"](?:[^\r\n'"]*[^\s'"])?/gi;
/** A JSON `"password": "..."` (any key holding `password`, `passwd`, `passphrase`, `credential`, `auth` but not
 *  `author`, `secret`, `token` or `api_key` / `apikey`, and since round 7 `pwd`, `pass` and `private_key` /
 *  `privatekey`). */
const JSON_PAIR = /"([A-Za-z0-9_-]+)"(\s*:\s*)"(?:[^"\\\n]|\\.)*"/g;
const JSON_SECRET_KEY = /password|passwd|passphrase|pass|pwd|credential|auth(?!or)|secret|token|api_?key|private_?key/i;

/** `text.replace(re, fn)`, adding to `tally.masked` one for each match whose replacement differs from it. A string
 *  replacement is given as a function, so no `$` pattern in it is read. */
function replaceCounted(text, re, fn, tally) {
  return text.replace(re, (...args) => {
    const out = fn(...args);
    if (out !== args[0]) tally.masked += 1;
    return out;
  });
}

/** Masks the value of every assignment to a secret name. One left-to-right pass: a name that is not secret is skipped
 *  past its `=` only, so a secret assignment inside its value (`x=a,TOKEN=b`) is still seen. Linear. */
function maskSecretAssigns(text, tally) {
  let out = ''; let from = 0;
  ASSIGN_HEAD.lastIndex = 0;
  for (let m = ASSIGN_HEAD.exec(text); m !== null; m = ASSIGN_HEAD.exec(text)) {
    if (!SECRET_NAME_TEST.test(m[0].slice(0, -1))) continue;
    const at = m.index + m[0].length;
    ASSIGN_VALUE.lastIndex = at;
    const v = ASSIGN_VALUE.exec(text);
    if (v === null) continue;
    out += `${text.slice(from, at)}${R}`;
    if (v[0] !== R) tally.masked += 1;
    from = at + v[0].length;
    ASSIGN_HEAD.lastIndex = from;
  }
  return out + text.slice(from);
}

/** The program-scoped word masks, judged per command segment (split on `;`, `&`, `|` and newlines). */
function maskProgramFlags(text, tally) {
  return text.replace(/[^;&|\n]+/g, (seg) => {
    let out = seg;
    if (P_WORD_PROGRAMS.test(out)) out = replaceCounted(out, P_WORD, (_m, lead, gap) => `${lead}-p${gap}${R}`, tally);
    if (W_WORD_PROGRAMS.test(out)) out = replaceCounted(out, W_WORD, (_m, lead, gap) => `${lead}-w${gap}${R}`, tally);
    if (CURL_PROGRAMS.test(out)) {
      out = replaceCounted(out, CURL_E_PASS, (_m, lead, flag, gap, q, file) => `${lead}${flag}${gap}${q}${file}:${R}`, tally);
    }
    if (A_WORD_PROGRAMS.test(out)) out = replaceCounted(out, A_WORD, (_m, lead, gap) => `${lead}-a${gap}${R}`, tally);
    if (GH_SECRET_SET.test(out)) out = replaceCounted(out, BODY_WORD, (_m, lead, flag, gap) => `${lead}${flag}${gap}${R}`, tally);
    return out;
  });
}

// ---- the docs rows ----------------------------------------------------------------------------------------------

/** The docs profile's rows, `[pattern, suffix]` each, the form ccd's python `REDACT_RULES` holds. */
const DOCS_ROWS = {
  'docs-url-userinfo': [String.raw`(://)[^/@\t\n\v\f\r ]+@`, '***@'],
  'docs-query-token': [String.raw`([?&](?:access_token|token)=)[^&\t\n\v\f\r ]+`, '***'],
  'docs-gh-token': [String.raw`(gh[opsu]_)[A-Za-z0-9]{20,}`, '***'],
  /** A Linear API key by its prefix, at any length (#1444), as the egress `known-token` rule reads it. */
  'docs-linear-key': [String.raw`(lin_api_)[A-Za-z0-9_-]+`, '***'],
  'docs-authorization': [String.raw`(?<![^\n])[^\n]*Authorization:[^\n]*`, 'Authorization: ***'],
};

// ---- the history rows -------------------------------------------------------------------------------------------

/** The line ends a quoted value never crosses: CR, LF, U+2028 and U+2029, the last two built from their code points. */
const QUOTED_LINE_ENDS = String.raw`\r\n` + String.fromCharCode(0x2028, 0x2029);
/** D-5745 (history-redact-value-class-widened; closes D-5021's residual): the named rule's value in the FIELD form, read
 *  whole. v1's class `[^\s"'`,;&]` ended a value at `&`, `;`, `,` and either quote, so `password=abc&def`,
 *  `password="abc&def"` and `PASSWORD='a b c'` printed their tails. Three alternatives, group 1 the opening quote:
 *  - after `"` or `'` (the lookbehind reads group 1), the value runs to the same closing quote on the same line, which
 *    the backreference `\1` consumes; an empty quoted value matches and every caller reads it as no value;
 *  - unquoted, a value still ends at whitespace and the backtick. `&` ends it only before `NAME=` (a 256-character NAME,
 *    the head's own bound), and `,` `;` `"` `'` end it only before whitespace, a closer (`,` `;` `)` `}` `]`) or the end
 *    of the text, so `url?a=1&password=x&b=2`, `password=x; path=/` and `{"cmd":"password=x"}` keep their structure.
 *  An unclosed quote fails the quoted reading, and group 1 then backs off to empty, so the quote is read as the
 *  value's first character. Linear: each alternative's classes are disjoint, the lookaheads are bounded or one
 *  character, and a failed quoted reading costs its own line once. The final form keeps v1's class (D-4613's structure
 *  safety is unchanged). This is the prototype scope b2-redaction measured (R1). Every door reads it only over its rev
 *  3.6 door's output (R11, lib's composeDoor), so it never prints a value that door masks. */
const NAMED_VALUE_FIELD_SRC = String.raw`(["']?)((?<=")[^"${QUOTED_LINE_ENDS}]*|(?<=')[^'${QUOTED_LINE_ENDS}]*|(?:[^\s"'` + '`'
  + String.raw`,;&]|[,;"'](?![\s,;)}\]]|$)|&(?![A-Za-z_][A-Za-z0-9_.-]{0,255}=))+)\1`;
/** v1's named value class (rev 3.6): group 1 the opening quote or empty, group 2 the value. The final form also stops at a
 *  backslash, `<` and `>`. The base reads it in both forms, and the widened rules in their final form. */
const namedValueV1 = (final) => new RegExp(String.raw`(["']?)([^\s"'` + '`' + String.raw`,;&${final ? String.raw`\\<>` : ''}]+)`, 'y');
/** What a header value's class stops at in the final form. */
const headerStop = (final) => (final ? String.raw`\\<>&` : '');

/** The history rows (lib's `contextRules` template, moved here whole; C1l PR 2): each id names the slot of the rule set it
 *  fills and builds its pattern for one form. Layer 2's rules (the context layer), one definition each, built twice:
 *  `field` is the field pass, `final` the second belt's structure-safe form, D-4613
 *  (history-final-belt-layer2-structure-safe) (section 8.3, whole-branch review: the final pass runs over a serialised
 *  `--json` envelope and over the human page's frame). In the final form no value class consumes a backslash (a JSON
 *  escape is never split, so an escaped quote ends a value instead of being left bare), a line break (`\n`, `\r`: a value
 *  never crosses a line), `<` or `>` (nor a frame tag) or `&`; the JSON-form rule's value has no escape alternative, so an
 *  escaped quote ends it. The final form is the PER-SEGMENT primitive of the structure-aware belt (lib's redactFinalText,
 *  redactFinalJson): it is never run over serialised structure, so it needs no rule about a closing quote or a closer
 *  (round 2's `]` and `}` exclusion was that, and it made the form non-idempotent on the field pass's own marks:
 *  `TOKEN=[redacted]` read as `[redacted` and was masked again). The field form of `history-v2` is the rev 3.6 field
 *  form, byte for byte, except the named rule's value (D-5745); `history-base` is the rev 3.6 rules in both forms. */
const HISTORY_ROWS = {
  'history-json': ['json', (final) => new RegExp(String.raw`"([A-Za-z_][A-Za-z0-9_.-]{0,255})"(\s*:\s*)"(${final ? String.raw`[^"\\\n\r<>&]+` : String.raw`(?:[^"\\]|\\.)+`})"`, 'g')],
  // D-4614 (history-context-rule-rescans-after-a-plain-name): the named rule is TWO patterns lib scans by hand
  // (namedSpans). The head finds `NAME=` or `NAME: ` and the optional quote; the value (sticky) takes the value from
  // there. The value is read only for a secret NAME, so a plain name never consumes its value and the scan resumes right
  // after the separator: a context key inside it is seen, and a run of `a=a=a=` stays linear.
  'history-named-head': ['namedHead', () => new RegExp(String.raw`\b([A-Za-z_][A-Za-z0-9_.-]{0,255})(=|:[ \t]+)`, 'g')],
  // The NAME a value ends in (namedSpans' tail head): `NAME=` or `NAME:` at the end of a slice of at most 258 characters.
  'history-named-tail': ['namedTail', () => new RegExp(String.raw`\b([A-Za-z_][A-Za-z0-9_.-]{0,255})(=|:)$`)],
  // D-5745 (history-redact-value-class-widened): the value of the named rule. A caller's span is group 2's own, never the
  // whole match (the widened field form consumes a closing quote). The final form keeps v1's class; the field form reads a
  // value whole.
  'history-named-value': ['namedValue', (final) => (final ? namedValueV1(true) : new RegExp(NAMED_VALUE_FIELD_SRC, 'y'))],
  // The rev 3.6 named value (R11's base): v1's class in both forms.
  'history-named-value-v1': ['namedValue', (final) => namedValueV1(final)],
  'history-bearer': ['bearer', (final) => new RegExp(String.raw`(Authorization:[ \t]*Bearer[ \t]+)([^\s"'${headerStop(final)}]+)`, 'gi')],
  'history-mail-token': ['mailToken', (final) => new RegExp(String.raw`(x-ccrc-mail-token:[ \t]*)([^\s"'${headerStop(final)}]+)`, 'gi')],
  'history-bearer-sticky': ['bearerSticky', (final) => new RegExp(String.raw`(Authorization:[ \t]*Bearer[ \t]+)([^\s"'${headerStop(final)}]+)`, 'iy')],
  'history-mail-token-sticky': ['mailTokenSticky', (final) => new RegExp(String.raw`(x-ccrc-mail-token:[ \t]*)([^\s"'${headerStop(final)}]+)`, 'iy')],
  'history-query': ['query', (final) => new RegExp(String.raw`([?&]token=)([^&\s"'#${final ? String.raw`\\<>` : ''}]+)`, 'gi')],
};

// ---- the rule table ---------------------------------------------------------------------------------------------

/** A rule of one pattern and one replacement (a string, or a function of the match). */
const sub = (id, re, replacement) => {
  const fn = typeof replacement === 'string' ? () => replacement : replacement;
  return { id, make: () => (text, tally) => replaceCounted(text, re, fn, tally) };
};
/** A docs row: group 1 (when the pattern has one) followed by the suffix. */
const docsRule = (id) => {
  const [pattern, suffix] = DOCS_ROWS[id];
  const re = new RegExp(pattern, 'gu');
  return {
    id,
    make: () => (text, tally) => replaceCounted(text, re, (_match, ...rest) => {
      // With a capture group, the callback's second argument is group 1; without one, it is the match offset (a
      // number), so only a string is kept.
      const group1 = rest[0];
      return (typeof group1 === 'string' ? group1 : '') + suffix;
    }, tally),
  };
};
/** A history row: the slot it fills and its pattern for one form (`historyRules` reads them; it has no text step). */
const historyRule = (id) => {
  const [slot, form] = HISTORY_ROWS[id];
  return { id, slot, form };
};
/** The two shape rules (in the egress and linear-egress profiles) take their source from the caller's `shapes`. */
const needShape = (shapes, id) => {
  if (shapes === undefined || typeof shapes[id] !== 'string') throw new Error(`redact: this profile needs shapes.${id}`);
  return shapes[id];
};

const RULES = Object.freeze([
  sub('json-pair', JSON_PAIR, (m, key, sep) => (JSON_SECRET_KEY.test(key) ? `"${key}"${sep}"${R}"` : m)),
  sub('yaml-secret', YAML_SECRET, (_m, name, sep) => `${name}${sep}${R}`),
  {
    id: 'jwt',
    make: (shapes) => {
      const re = new RegExp(String.raw`(?<![A-Za-z0-9_-])` + needShape(shapes, 'jwt'), 'g');
      return (text, tally) => replaceCounted(text, re, () => R, tally);
    },
  },
  { id: 'secret-assigns', make: () => maskSecretAssigns },
  { id: 'program-flags', make: () => maskProgramFlags },
  sub('header', HEADER, (_m, name, sep) => `${name}${sep}${R}`),
  sub('bearer', BEARER, (_m, word) => `${word} ${R}`),
  sub('secret-word', SECRET_WORD, (_m, name, gap) => `${name}${gap}${R}`),
  sub('url-userinfo-quoted', URL_USERINFO_QUOTED, (_m, q, scheme) => `${q}${scheme}${R}@`),
  sub('url-userinfo', URL_USERINFO, (_m, scheme) => `${scheme}${R}@`),
  sub('user-quoted', USER_QUOTED, (_m, lead, flag, gap, u1, u2) =>
    (u1 !== undefined ? `${lead}${flag}${gap}'${u1}:${R}'` : `${lead}${flag}${gap}"${u2}:${R}"`)),
  sub('user-flag', USER_FLAG, (_m, lead, flag, gap, q, user) => `${lead}${flag}${gap}${q}${user}:${R}`),
  sub('proxy-userinfo', PROXY_USERINFO, (_m, lead, flag, gap, q, user) => `${lead}${flag}${gap}${q}${user}:${R}@`),
  sub('cert-pass', CERT_PASS, (_m, lead, flag, gap, q, file) => `${lead}${flag}${gap}${q}${file}:${R}`),
  sub('user-empty-pass', USER_EMPTY_PASS, (_m, lead, flag, gap, q) => `${lead}${flag}${gap}${q}${R}:`),
  sub('p-flag', P_FLAG, (_m, lead) => `${lead}-p${R}`),
  sub('p-quoted', P_QUOTED, (_m, lead) => `${lead}-p${R}`),
  sub('secret-flag', SECRET_FLAG, (_m, lead, flag, gap) => `${lead}${flag}${gap}${R}`),
  sub('single-dash-secret', SINGLE_DASH_SECRET, (_m, lead, flag, gap) => `${lead}${flag}${gap}${R}`),
  sub('camel-secret-flag', CAMEL_SECRET_FLAG, (_m, lead, flag, gap) => `${lead}${flag}${gap}${R}`),
  sub('rdp-pass', RDP_PASS, (_m, lead) => `${lead}/p:${R}`),
  sub('pass-arg', PASS_ARG, `pass:${R}`),
  sub('slack-hook', SLACK_HOOK, (_m, head) => `${head}${R}`),
  sub('telegram-bot', TELEGRAM_BOT, R),
  {
    id: 'known-token',
    make: (shapes) => {
      const re = new RegExp(KNOWN_TOKEN_PREFIX + needShape(shapes, 'genericSk') + ')', 'g');
      return (text, tally) => replaceCounted(text, re, () => R, tally);
    },
  },
  {
    // Each masked segment is a span of its own: a run of three secret segments counts three.
    id: 'token-segments',
    make: () => (text, tally) => text.replace(TOKEN_RUN, (run) => run.split('/').map((seg) => {
      if (!TOKEN_SEGMENT.test(seg)) return seg;
      tally.masked += 1;
      return R;
    }).join('/')),
  },
  ...Object.keys(DOCS_ROWS).map(docsRule),
  ...Object.keys(HISTORY_ROWS).map(historyRule),
]);

/** Every rule id, in table order. */
export const RULE_IDS = Object.freeze(RULES.map((r) => r.id));

/** The profiles: each a frozen list of the rule ids it runs, in order. No profile inherits another's. */
export const PROFILES = Object.freeze({
  egress: Object.freeze([
    'json-pair', 'yaml-secret', 'jwt', 'secret-assigns', 'program-flags', 'header', 'bearer', 'secret-word',
    'url-userinfo-quoted', 'url-userinfo', 'user-quoted', 'user-flag', 'proxy-userinfo', 'cert-pass',
    'user-empty-pass', 'p-flag', 'p-quoted', 'secret-flag', 'single-dash-secret', 'camel-secret-flag', 'rdp-pass',
    'pass-arg', 'slack-hook', 'telegram-bot', 'known-token', 'token-segments',
  ]),
  docs: Object.freeze([
    'docs-url-userinfo', 'docs-query-token', 'docs-gh-token', 'docs-linear-key', 'docs-authorization',
  ]),
  'linear-egress': Object.freeze([
    'jwt', 'header', 'bearer', 'url-userinfo-quoted', 'url-userinfo', 'secret-assigns', 'known-token',
  ]),
  'history-base': Object.freeze([
    'history-json', 'history-named-head', 'history-named-tail', 'history-named-value-v1', 'history-bearer',
    'history-mail-token', 'history-bearer-sticky', 'history-mail-token-sticky', 'history-query',
  ]),
  'history-v2': Object.freeze([
    'history-json', 'history-named-head', 'history-named-tail', 'history-named-value', 'history-bearer',
    'history-mail-token', 'history-bearer-sticky', 'history-mail-token-sticky', 'history-query',
  ]),
});

const BY_ID = new Map(RULES.map((r) => [r.id, r]));
const compiled = new Map();

/** The profiles that read the caller's two credential shapes. */
const SHAPED = new Set(['egress', 'linear-egress']);
/** The history profiles: rule sets `historyRules` builds, never text steps. */
const HISTORY = new Set(['history-base', 'history-v2']);

/** The steps of `profile`, built once per profile and pair of caller shapes. */
function stepsOf(profile, shapes) {
  if (!Object.hasOwn(PROFILES, profile)) throw new Error(`redact: unknown profile ${String(profile)}`);
  if (HISTORY.has(profile)) throw new Error(`redact: ${profile} is a history rule set, not text steps; build it with historyRules`);
  const ids = PROFILES[profile];
  const key = SHAPED.has(profile)
    ? `${profile}\0${needShape(shapes, 'genericSk')}\0${needShape(shapes, 'jwt')}`
    : profile;
  let steps = compiled.get(key);
  if (steps === undefined) {
    steps = ids.map((id) => BY_ID.get(id).make(shapes));
    compiled.set(key, steps);
  }
  return steps;
}

/** `text` with every rule of `profile` applied, in the profile's order, and `masked`, the number of spans the steps
 *  replaced with a different text (#1444: the Linear proxy answers it and journals it). The egress and linear-egress
 *  profiles take `shapes` (`{ genericSk, jwt }`, from `CREDENTIAL_MASKS`); the docs profile takes none. */
export function redactCount(profile, text, shapes) {
  const tally = { masked: 0 };
  let out = text;
  for (const step of stepsOf(profile, shapes)) out = step(out, tally);
  return { text: out, masked: tally.masked };
}

/** `text` with every rule of `profile` applied: `redactCount`'s text, so the two cannot disagree. Idempotent per
 *  profile. */
export function redact(profile, text, shapes) {
  return redactCount(profile, text, shapes).text;
}

/** The rule set a history profile names, as `ccd/history/lib.mjs` reads it: `{ field, final }`, each form a frozen object
 *  of `final` and one pattern per slot, in the profile's order. Every call builds fresh expressions, so no two callers
 *  share a global or sticky expression's `lastIndex`; lib calls it once per profile, at load. */
export function historyRules(profile) {
  if (!HISTORY.has(profile)) throw new Error(`redact: ${String(profile)} is not a history profile`);
  const build = (final) => {
    const set = { final };
    for (const id of PROFILES[profile]) {
      const { slot, form } = BY_ID.get(id);
      if (Object.hasOwn(set, slot)) throw new Error(`redact: ${profile} fills ${slot} twice`);
      set[slot] = form(final);
    }
    return Object.freeze(set);
  };
  return Object.freeze({ field: build(false), final: build(true) });
}

/** The docs profile's rows as `[pattern, suffix]`, in profile order: what `DOCS_REDACT_RULES` is. */
export function docsRuleRows() {
  return PROFILES.docs.map((id) => [...DOCS_ROWS[id]]);
}
