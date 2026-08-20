# Stage 3a — the session gate: auth on every route, behind a flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every HTTP route and websocket on the ccrc server sits behind a server-side session gate — passphrase login (scrypt), HttpOnly cookie, rate-limited, optional WebAuthn passkeys, `ccrc passwd` recovery — with the whole mechanism dark behind `CCRC_AUTH` (default off) until the operator flips it, and the exempt set (`/health`, the box-token machine lanes, login, the PWA shell) provably enumerated and pinned in both directions.

**Architecture:** ONE `app.addHook('onRequest', gate)` in `buildServer` covers all 49 routes, the `@fastify/static` wildcard, the SPA fallback, and all three websocket upgrades (the upgrade dispatches through normal fastify routing, so a 401 short-circuits before any hijack — no special-casing). The gate is L4 delivery; every decision it makes is a pure L1 verdict (`authVerdict(session, now)`, `loginVerdict(rateState, now)`). No new dependency: scrypt/timingSafeEqual/randomBytes/createVerify/createPublicKey are all in the node ≥22.13 floor; WebAuthn assertion needs zero library code (DER signature verified natively) and registration needs zero CBOR (the client sends SPKI via `getPublicKey()`); cookies are ~20 lines of hand-rolled get/set, not `@fastify/cookie`. Sessions live in `~/.ccrc/sessions.json` (0600, tmp+rename, NotifyLog-style write serialization, `sha256(token)` stored, generation-stamped) — NOT coord.db, because coord.db's backup/rollback would resurrect sessions `ccrc passwd` invalidated, and a corrupt sessions table must log one operator out, not take the whole server down. The passphrase hash lives in `~/.ccrc/auth.scrypt` as a self-describing PHC-ish line (`scrypt$N=65536,r=8,p=1$<salt-b64>$<hash-b64>$gen=<n>`), read with `coord/token.ts`'s full discipline but the opposite polarity (absent + flag on = fail SHUT). `ccrc passwd` is the SOLE writer, tty-required, hashing via a shipped node helper.

**Tech Stack:** TypeScript ESM (node ≥22.13, Fastify 5, @fastify/websocket 11), node:crypto only, bash (ccd/ccrc), React 19 PWA, vitest. **No new dependencies in any package.json.**

## Global Constraints

- **Security-sensitive slice: fail SHUT, never open.** Every ambiguous auth state (missing hash file with flag on, unreadable session store, expired session, unparseable cookie) denies access. The one paid lesson is `coord/token.ts:170-205` (D-39: `'unconfigured'` folded into `'ok'` ran the mail lane unauthenticated) — invert that polarity here.
- **Dark by default.** `CCRC_AUTH` defaults off (the `config.ts:159` enumerated-positive-test idiom: `env.CCRC_AUTH === 'on' ? 'on' : 'off'`, using `||` not `??` per the `:133-140` bare-`KEY=` lesson). With the flag off the gate is a no-op passthrough — the deploy ships the mechanism without turning it on; the live box stays exactly as it is until the operator sets the flag AND runs `ccrc passwd`.
- **No new dependency.** Proven feasible by survey B: assertion via `createVerify('SHA256')` (DER-native), key import via `createPublicKey({format:'jwk'})`, registration via the client's `getPublicKey()` SPKI (zero CBOR), cookies hand-rolled. If any task believes a dep is unavoidable, it is BLOCKED — report, do not add.
- **Ring discipline (`CLAUDE.md:71-78`):** `shared/` (L0) imports nothing, not even `node:*` — auth wire types + derived code-unions live there. The verdict functions are L1 pure policy (`(state, now) → verdict`), never touching `reply`/`fs`/`crypto`-side-effects where avoidable. The gate hook, cookie I/O, and the store's disk writes are L4. **No overloaded null at a seam:** auth verdicts are typed unions (`'ok'|'wrong'|'unconfigured'|'locked-out'|'expired'|'no-session'`), never booleans, so the login route can say "no passphrase set — run `ccrc passwd`" distinctly from "wrong password".
- **The secret-file house pattern is `server/src/coord/token.ts`** — read it whole before writing the passphrase reader: extract-skipping-comments; PRESENT-but-unusable throws uncaught (boot refusal); the shipped placeholder refused byte-for-byte (or ship NO example so there is none); ENOENT ≠ every other errno; `timingSafeEqual` with length-check-first; never log the presented value (`server.ts:443-446`). Perms: 0700 dir / 0600 file; `_inst_atomic` chmods the temp BEFORE the rename.
- **Wire discipline:** do NOT bump `FLEET_PROTO`/`FLEET_PROTO_MIN` (auth is not a fleet-frame change). New shared types declared once, imported by server AND pwa (single-definition scans four TS roots). Runtime code-unions derived from a map (`PR_REASONS = Object.keys(PR_REASON_MAP)` shape), never hand-maintained.
- **The gate test is a source-scanner + a runtime sweep + a mutation** (`coord-pause-route.test.ts:152-211` and `verb-gate.test.ts` are the templates): every route path found in server/src is either in a named `EXEMPT` set (each entry naming its reason) or answers 401 under `inject`/`injectWS` with no cookie; the exempt set is checked in BOTH directions (every name resolves to a real route); a meta-test that the scanner matches something; and deleting the hook goes RED (measured, not commented).
- **`ccrc passwd`** joins the verb table (usage regex at `ccrc-cli.test.ts:152` edited by design); registers/exit-table unchanged (stdout results, stderr refusals exit 1, usage exit 2, no `set -e`); reads the passphrase with `read -rs`, refuses a non-tty, restores echo on SIGINT via trap, never puts the secret in argv, probes `node` by name before hashing.
- TDD red-first; mutation-measured guards; foreground vitest ≥600000ms, never npx, never background; all three suites green before done. `~/.ccrc/auth.scrypt` and `~/.ccrc/sessions.json` spelled ONCE each in their reader (a variable), and once in ccrc — single-definition scans the bash corpus too.

## File structure

- `shared/api.ts` — auth wire types + derived unions (Task 1).
- `server/src/auth/secret.ts` — the passphrase-file reader + scrypt verify (Task 2).
- `server/src/auth/sessions.ts` — the flat-file session store (Task 3).
- `server/src/auth/ratelimit.ts` — the pure fixed-window policy (Task 4).
- `server/src/auth/cookie.ts` — hand-rolled cookie get/set (Task 5).
- `server/src/auth/gate.ts` — the onRequest verdict + the hook wiring helper (Task 5).
- `server/src/auth/webauthn.ts` — registration + assertion via node:crypto (Task 8).
- `server/src/server.ts` — the hook + `/api/auth/*` routes (Tasks 5, 8).
- `server/src/config.ts` — `CCRC_AUTH`, `CCRC_RP_ID`, `CCRC_ORIGIN`, cookie-secure (Task 10).
- `deploy/gen-auth-hash.mjs` — the node hashing helper `ccrc passwd` shells to (Task 9).
- `ccd/ccrc` — `cmd_passwd`, the doctor `auth` check, the install next-steps line (Task 9).
- `pwa/src/lib/api.ts` + a login screen component + ws clients — the 401 story (Task 7).
- Tests beside each; `server/test/auth-gate.test.ts` (the sweep), `deploy/ccrc.env.example`, the VM-gate runbook + README (Task 10).

---

### Task 1: The auth wire vocabulary (L0)

**Files:** Modify `shared/api.ts`; test `server/test/single-definition.test.ts` awareness (the types land once).

**Interfaces produces:** `LoginRequest {passphrase}`; `LoginResponse` (empty 204 on success — the cookie IS the response); `AuthStatus {authed: boolean, passkeysEnrolled: number, mode: 'off'|'passphrase'|'locked-out'}`; `AUTH_VERDICTS` union derived from an `AUTH_VERDICT_MAP` (`'ok'|'wrong'|'unconfigured'|'locked-out'|'expired'|'no-session'`) + `isAuthVerdict`; WebAuthn wire types (`PasskeyRegisterStart/Finish`, `PasskeyAssertStart/Finish` — the client→server shapes carrying base64url SPKI + authenticatorData + clientDataJSON + signature). NO `FLEET_PROTO` bump.

- [ ] Step 1: RED — a shared-type contract test (the `AccountsResponse` precedent) asserting the union derives from the map and the request/response shapes exist. Step 2: GREEN — declare them. Step 3: single-definition + module-format green (new `shared` type is covered automatically). Commit `feat(auth): the wire vocabulary — verdicts derived, no proto bump`.

### Task 2: The passphrase file — reader, scrypt verify, generation (L2)

**Files:** Create `server/src/auth/secret.ts`; test `server/test/auth-secret.test.ts`.

**Interfaces:** `readAuthSecret(path): AuthSecret | null` (null = ENOENT only; every other errno throws `AuthSecretUnusable`, uncaught → boot refusal); `AuthSecret {n,r,p,saltB64,hashB64,generation}` parsed from the PHC-ish line; `verifyPassphrase(secret, presented): Promise<boolean>` (async `crypto.scrypt`, `timingSafeEqual`, length-check-first); `hashLine(passphrase, params): Promise<string>` (used by the node helper AND testable here). A placeholder-detection refusal if any `auth.scrypt.example` ever ships (recommend: ship none).

- [ ] Steps: RED per state (absent→null; garbled→throws; wrong-length hash→throws; correct passphrase→true; wrong→false; a lower-N old line still verifies and is flagged for rehash); GREEN mirroring `token.ts`'s errno discipline with the inverted polarity documented; scrypt params `N=65536,r=8,p=1,keylen=32,maxmem=96MiB`, 16-byte salt; mutations: collapse EACCES→null (red); drop the length check (red). Commit `feat(auth): the passphrase file reads like the mail token but fails shut`.

### Task 3: The session store (L2/L3)

**Files:** Create `server/src/auth/sessions.ts`; test `server/test/auth-sessions.test.ts`.

**Interfaces:** `SessionStore` over `~/.ccrc/sessions.json` (0600, tmp+rename, NotifyLog flush-chain serialization); `create(label, generation): token` (256-bit `randomBytes`, stores `sha256(token)` never the token); `verify(token, currentGeneration, now): AuthVerdict` (`timingSafeEqual` on the hash; generation mismatch → `'expired'`; absolute+idle TTL); `revokeAll()`; a sweep on load and on a minutes-cadence timer. `lastSeenAt` held in memory, persisted on create/delete + periodic flush (a restart falls back to absolute TTL — documented).

- [ ] Steps: RED (create→verify roundtrip; sha256 stored not token; generation bump → all `'expired'`; absolute TTL expiry; corrupt file → the store refuses ONE caller, never throws to boot; concurrent create/delete lands both, no torn rename — the NotifyLog hazard); GREEN; mutations: store the raw token (red — the "never the token" test); skip generation compare (red). Commit `feat(auth): sessions are a flat file whose loss is free`.

### Task 4: The rate limiter (L1 pure policy)

**Files:** Create `server/src/auth/ratelimit.ts`; test `server/test/auth-ratelimit.test.ts`.

**Interfaces:** `loginVerdict(state, now): {ok, state, retryAfter?}` — a pure global fixed-window over FAILURES (reset on success), ~8/60s, escalating window optional; the L4 lifetime (the single in-memory `{windowStart,count}`, `fleet.ts:149`'s in-memory-per-process idiom) is a thin wrapper. Counts failures not attempts; the KDF is the real brake (documented threat paragraph).

- [ ] Steps: RED (under-limit ok; over-limit locked with retryAfter; window rollover resets; success resets); GREEN, pure function no `Date.now()` inside (now injected); mutation: count attempts instead of failures (red — the fat-finger-then-succeed test). Commit `feat(auth): a global fixed window brakes login; the KDF does the rest`.

### Task 5: The gate hook, cookies, and the login/logout/status routes (L4) — THE CORE

**Files:** Create `server/src/auth/cookie.ts`, `server/src/auth/gate.ts`; modify `server/src/server.ts` (the hook + `/api/auth/login|logout|status`); create `server/test/auth-gate.test.ts`, `server/test/auth-routes.test.ts`.

**Interfaces:** `authVerdict(req, deps, now): {allow: boolean, verdict: AuthVerdict}` (pure over the exempt set + cookie + session store + flag); `installGate(app, deps)` adds the single onRequest hook; `parseCookies`/`serializeCookie` (HttpOnly, `SameSite=Lax`, `Secure` from `deps.cfg.cookieSecure`, `Path=/`, `Max-Age`). Login: rate-limit → verify passphrase → mint session → Set-Cookie → 204. Logout: revoke this session, clear cookie. Status: the `AuthStatus`.

- [ ] Step 1: RED — the SWEEP: source-scan every `app.(get|post|...)('...')` in server.ts + coord/routes.ts into a table; the named `EXEMPT` set (health, the 9 box-token lanes + notify, `/api/auth/login`, the static/SPA login surface); assert every non-exempt route answers 401 with no cookie (`inject`) and every websocket answers 401 (`injectWS` — first repo use); assert EXEMPT is complete in both directions; a scanner-matches-something meta-test.
- [ ] Step 2: RED — the flag: with `CCRC_AUTH=off` the gate is passthrough (every route reachable, the pre-slice behavior); with `on` and no cookie, 401; with a valid cookie, through.
- [ ] Step 3: GREEN — the hook reads `request.ws` (the plugin sets it) to answer a bare 401 on upgrades vs JSON on HTTP; the exempt check is a set membership on the routerPath, not the raw url (so `/api/mail/:id` matches its param route); scrypt async in the login route.
- [ ] Step 4: the cookie attributes pinned (Secure driven by config, measured both ways); the login rate-limit path; logout revocation; status shape.
- [ ] Step 5: MUTATIONS — delete the hook → the sweep reds (the load-bearing measurement); make the exempt check compare raw url → a param-route test reds; derive Secure from `req.protocol` → the behind-proxy test reds. Record all.
- [ ] Step 6: full server suite; commit `feat(auth): one hook gates every route and socket; login mints a cookie session`.

### Task 6: (folded into Task 5 — cookie.ts ships there)

### Task 7: The PWA learns it can be logged out

**Files:** Modify `pwa/src/lib/api.ts` (the `request` funnel), create a login screen (the `BlockScreen` sibling pattern), modify `pwa/src/lib/ws.ts` + `TerminalDrawer.tsx` (the rejected-upgrade signal); tests beside.

- [ ] Step 1: RED — `request` on a 401 sets a module auth-lost signal (not a throw the callers must each catch); a login screen mounts as an `app.tsx` sibling above the shell (the `BlockScreen` mount) when auth-lost; submitting the passphrase calls `/api/auth/login` and, on 204, clears the signal and reconnects the sockets. The two ws paths (`ReconnectingSocket` + the bare pty `WebSocket`) surface a rejected upgrade as auth-lost rather than reconnect-looping forever.
- [ ] Step 2: GREEN, minimal — same-origin cookies ride automatically (no send-side change); the login screen is inside the SPA (the service-worker `navigateFallback` trap avoided); a 401 anywhere → one full-screen login, not per-call toasts.
- [ ] Step 3: mutation — remove the 401 branch → the login-screen-appears test reds. Commit `feat(pwa): a 401 raises the login screen, not an endless reconnect`.

### Task 8: WebAuthn passkeys, builtin-crypto only

**Files:** Create `server/src/auth/webauthn.ts` (+ credential storage in the session store's file or a sibling), the `/api/auth/passkey/*` routes, PWA enroll/assert; tests.

- [ ] Registration (after first passphrase login, behind the session gate): server issues a challenge; client `navigator.credentials.create` with `attestation:'none'`; client sends `getPublicKey()` SPKI + `getAuthenticatorData()` + the client-parsed alg; server stores `{credentialId, spkiDer, rpId, origin, signCount, enrolledAt}` — rpId/origin from `CCRC_RP_ID`/`CCRC_ORIGIN` config, RECORDED per credential so a 3b rename fails loudly ("enrolled for localhost — re-enroll"). Trust caveat documented (attestation none + behind-session-gate + single-user).
- [ ] Assertion: challenge → `navigator.credentials.get` → server verifies `createVerify('SHA256').verify(createPublicKey({key:spkiDer,format:'der',type:'spki'}), authenticatorData ‖ sha256(clientDataJSON), derSignature)`; checks rpIdHash, origin (full `https://host:port`), UP/UV flags, challenge, signCount monotonic; mints a session on success. Rate-limited (looser than passphrase — free CPU oracle otherwise).
- [ ] The PSL hazard recorded: rpId is the registrable domain (`tailnet-example.ts.net` or `<name>.duckdns.org`, never a bare public suffix); configured, not derived by label-stripping.
- [ ] Mutations: accept a signature over the wrong message (red); accept a stale signCount (red — replay); wrong-origin assertion (red). Commit `feat(auth): passkeys with node:crypto — no CBOR, no library, origin-bound`.

### Task 9: `ccrc passwd`, the hashing helper, the doctor check

**Files:** Create `deploy/gen-auth-hash.mjs`; modify `ccd/ccrc` (`cmd_passwd`, usage, dispatch, the `auth` doctor check, the install next-steps line); modify `server/test/ccrc-cli.test.ts` (verb regex), `server/test/ccrc-doctor.test.ts`.

- [ ] `cmd_passwd`: `[ -t 0 ]` or die; `read -rs` twice + confirm; min-length; `trap 'stty echo' EXIT INT TERM`; probe `node` by name (the cmd_install idiom); pipe the passphrase on stdin (never argv) to `gen-auth-hash.mjs` which hashes (scryptSync is fine in this one-shot) and writes `~/.ccrc/auth.scrypt` atomically 0600, bumping `generation`; a success line naming that the gate needs `CCRC_AUTH=on` too.
- [ ] The `auth` doctor check: `off (no ~/.ccrc/auth.scrypt)` → WARN with `ccrc passwd` remedy when the flag is off; FAIL when `CCRC_AUTH=on` but the file is absent (the fail-shut state made visible before a login ever 500s).
- [ ] `cmd_install`'s landing block gains one next-steps line (install writes NO passphrase — the seed-once/no-prompt doctrine; `curl|bash` stdin hazard). Mutations: verb missing from usage (red); doctor check absent (bijection red); passwd reads a piped passphrase (red — the non-tty refusal test). Commit `feat(ccrc): passwd sets the box passphrase; doctor reports the gate`.

### Task 10: Config, docs, and close-out

**Files:** `server/src/config.ts` (`CCRC_AUTH`, `CCRC_RP_ID`, `CCRC_ORIGIN`, `cookieSecure`), `deploy/ccrc.env.example`, the VM-gate runbook (the auth step), `README.md`, the plan ledger.

- [x] Config keys through `loadConfig` (the `||`-not-`??` discipline; `cookieSecure` defaults on, off only for an explicit localhost-http dev flag); `ccrc.env.example` documents all four with the rpId non-portability warning. The runbook's install flow gains: set `CCRC_AUTH=on`, `ccrc passwd`, restart, log in — and the honest note that 3a's proof runs on localhost (passkeys enrolled there don't carry to 3b's name; the mechanism is what's proven). README's auth section. Ledger: D-entries; the config-flag-default-off deploy note; the pending items (Caddy/`Secure`-behind-real-TLS is 3b; per-user identity is the team edition).
- [x] Full three suites; commit `docs(auth): the gate is documented, flagged off, and ready for the operator to arm`.

**Amended by the Task 5 controller ruling:** the config keys were introduced by Tasks 5 and 8 (there is no gating a route on a key that does not exist); this task DOCUMENTS them. It also carries one CODE fix from Task 9 — **D-131**, the boot refusal's journal leak.

---

## Deviations found

(Next free number at plan time: **D-108**. Next free now: **D-141**. D-123 is
claimed by `server/src/auth/credentials.ts` from Task 8 and has no ledger entry here.)

- **D-115 — the Origin check stopped at the socket, leaving CSRF open.** Task 8 added a
  `/ws/*` Origin check because `ts.net` is a public suffix, so every tailnet node is
  *same-site* and `SameSite=Lax` sends `ccrc_session` between them — then justified
  scoping it to upgrades with "ordinary requests are guarded by SameSite plus every write
  being a POST", a sentence the same file refutes three paragraphs earlier. Measured: a
  same-site sibling page can auto-submit a form POST to `/api/fleet/reboot` (reads no body,
  no params, gates only on standing config) and reboot the fleet host. The comfortable
  415 escape does not exist — Fastify seeds `text/plain` as a default parser, and
  `@fastify/multipart` is registered, so two of the three form enctypes reach a handler.
  Fixed: `needsOriginCheck` covers every upgrade and every non-exempt non-GET/HEAD/OPTIONS
  request. `gate.ts`.
- **D-116 — the cost of D-115, recorded rather than engineered around.** The Origin check
  refuses a PWA loaded from any host alias that is not `CCRC_ORIGIN` (e.g. the tailnet IP).
  Intended: the box has one origin and says so. The refusal names `CCRC_ORIGIN` and carries
  **no `AuthVerdict`**, so it cannot raise a login screen no passphrase could clear.
- **D-117 — `CCRC_PORT` never got the empty-string rule, and `origin` derives from it.**
  `Number('') === 0`, so a bare `CCRC_PORT=` line gave `http://localhost:0` — which
  `originProblem` *accepts* (loopback, http, canonical), so the boot warning stayed silent
  while every socket and write was refused. Fixed with one validation operator rather than
  `||` plus a range check: the range check already subsumed the `||`, which made the `||`
  unmeasurable. `config.ts`.
- **D-118 — `assert/start` was unmetered, so challenge eviction was a lockout lever.** The
  handler is `async` with no `await`, so its reservation released in the same tick and
  `inFlight` never exceeded 1; it never called `fail()`. `count + inFlight < 60` was
  therefore `0 + 0` forever. An anonymous peer could evict the operator's in-flight
  challenge (64 entries, oldest-first) faster than a Face ID prompt resolves, rendering as
  "That passphrase didn't match" for the duration. Fixed: `LoginRateLimiter.spend` — the
  primitive under the name that describes it, with `fail` delegating. `ratelimit.ts`,
  `server.ts`.
- **D-119 — absent and unreadable were one state, and the collapse destroyed credentials.**
  `PasskeyStore.doLoad` folded ENOENT / EACCES / corrupt into `records = []`, and the enrol
  screen then said "No passkey is enrolled on this box". An operator who believes it enrols,
  and the enrolment rewrites the file from an in-memory array that is empty *because the read
  failed*. Fixed: a three-state `StoreState`; `'unusable'` denies assertions **and refuses
  enrolment**; `PasskeyListResponse.storeUnreadable` tells the screen to say so instead.
  `credentials.ts`, `server.ts`, `AccountsScreen.tsx`.
- **D-120 — `add()` returned an overloaded boolean.** `true` meant "stored" even when
  `doFlush` had swallowed a write failure into a warn, so a full disk answered
  `204 Passkey added` for a row that vanished on restart. Fixed: a discriminated `AddResult`
  (`full` / `unusable` / `write-failed`). `credentials.ts`.
- **D-121 — `decodeB64url`'s alphabet test was unmeasurable, and provably redundant.**
  `toString('base64url')` can only emit `[A-Za-z0-9_-]`, so any input outside that set already
  differs from its own re-encoding. Deleted rather than kept as unmeasurable defence in depth;
  the subsumption is enumerated by test. `webauthn.ts`.
- **D-122 — `passkeySupported()` probed WebAuthn Level 1 for a Level 2 requirement.** It
  tested `PublicKeyCredential.prototype.getClientExtensionResults` (present since 2019) while
  the no-CBOR design needs `AuthenticatorAttestationResponse.prototype.getPublicKey`. Split
  into `passkeyLoginSupported` (L1 is enough to assert) and `passkeyEnrollSupported` (L2),
  because a browser that cannot enrol can still sign in with a key enrolled on a phone.
  `pwa/src/lib/passkey.ts`.

- **D-124 — the "parseable by `hashLine`, rejected by the parser" pair fails EARLIER than
  predicted.** Task 9's brief named `{n: 65536, r: 1, p: 1}` (D-113's bound) as the pair
  that would prove the round-trip guard fires. Measured on node 24.14.1: it never reaches
  the parser — `crypto.scrypt` throws `ERR_CRYPTO_INVALID_SCRYPT_PARAMS` synchronously
  inside `scryptDerive`'s promise executor, so `hashLine` REJECTS and there is no line to
  read back. Two consequences, both shipped: `gen-auth-hash.mjs` catches the derive so that
  case is a sentence rather than an unhandled rejection under a caller that promised one,
  and the round trip is proven with a different real pair — `keylen: 16`, which derives
  happily and which the parser refuses ("hash is 16 bytes, want 32"). Both are measured, by
  a fixture that re-exports the SHIPPED module with `DEFAULT_PARAMS` swapped
  (`server/test/authFixtures.ts`), so no broken default ships to prove a guard.
- **D-125 — `ccrc passwd` REFUSES to overwrite a secret file it cannot read.** The brief
  says `passwd` is the operator's only remedy for a bad `auth.scrypt`, which argues for
  overwriting anything. But the generation cannot be read out of an unusable file, and
  writing `INITIAL_GENERATION` over a box that WAS at generation 1 would REVALIDATE every
  session minted under it — the exact opposite of what the command is for. So the writer
  carries `secret.ts`'s own polarity (absent ≠ unusable): absent → initial, parsed →
  `+ 1`, unusable → refuse, printing `mv <file> <file>.broken && ccrc passwd`. Doctor's
  `auth` remedy prints the same two-step rather than a bare `ccrc passwd`, which would send
  an operator to a command that is about to refuse. The round-trip guard is what makes this
  affordable: `passwd` can no longer CREATE the state it refuses to repair.
- **D-126 — the `auth` check PASSes an un-armed box; a fresh install ends GREEN.**
  Shipped first as the plan's own text said (off + no `auth.scrypt` → WARN), which made
  `ccrc install`'s doctor tail end `1 warned` on **every** box, since `install` writes no
  passphrase by doctrine. **Operator ruling (Task 9 review), amending the plan:** auth-off
  is the default and correct state for a fresh box, and a warning every operator sees every
  time is one they learn to skim — which costs the warnings that matter (an ARMED gate
  nobody can log into; a file the server will not boot on). The state is now a PASS whose
  DETAIL carries the arming instructions as next-steps text, `CCRC_AUTH=on` + absent stays
  FAIL, and `ccrc-install.test.ts` is back to `0 warned` while also asserting the check ran
  and found the box uncredentialed (`PASS auth: … nothing is gated`), so `0 warned` cannot
  be reached by the check having vanished.
- **D-127 — doctor measures the secret with the SERVER's parser, and prints no byte of the
  file.** `_check_auth` shells to `deploy/gen-auth-hash.mjs --check`, which imports the
  compiled `secret.ts` — a bash approximation would inevitably pass a line the server
  refuses, and that refusal is a boot failure, not a refused login. The helper answers with
  an exit CODE (absent / parsed / unusable / no-build) and a params-and-generation summary
  the check re-validates against a strict regex; `AuthSecretUnusable`'s message is never
  printed, because it quotes the field it choked on (measured: `unknown prefix "<field>"`,
  `N is not a plain decimal integer ("<field>")`) and the plausible way to get an unusable
  `auth.scrypt` is a misplaced copy of another secret. Both leak shapes are pinned by test.

- **D-128 — the trap that protected the terminal broke the abort, and disclosed the
  passphrase.** `trap 'stty echo' EXIT INT TERM` looks like the standard fix and is a
  disclosure bug: **bash restarts an interrupted `read` after running a trapped handler**,
  so Ctrl-C re-enabled echo and handed control back to the still-running prompt. Measured
  against the shipped verb — `New passphrase (at least 12 characters): VISIBLE-PASSPHRASE`
  echoed into the terminal and the scrollback, confirmation echoed too, run exited 0 having
  written the file — under a banner reading "Ctrl-C aborts". Without ANY trap the same
  Ctrl-C kills the script cleanly. Fixed with two traps: `EXIT` restores echo, `INT`/`TERM`
  restore it and `exit 130`. The reason it survived a green suite is D-129's sibling: the
  echo test spawned a SECOND pty, where echo is always on — a test that could not fail.
  It now runs the verb and `stty` in ONE pty and goes red for this defect.
- **D-129 — `read` without `IFS=` trims the passphrase, silently.** Measured:
  `read -rs x` on `"  spaced pass  "` yields `"spaced pass"`; `IFS= read -rs x` preserves it.
  Both entries trim identically, so the confirmation matches, the file written is valid, and
  doctor PASSes — while the browser sends the raw string, which never verifies. A lockout
  with no red anywhere. Every other `read` in `ccd/ccrc` already had `IFS=`; these two did
  not. Pinned through the FILE (`verifyPassphrase` against the spaced and the trimmed form),
  not through the transcript.
- **D-130 — `CCRC_AUTH_SECRET_PATH` was a silent security no-op, not a documentation gap.**
  `config.ts:339` lets a box redirect the gate's secret. Writing the DEFAULT on such a box
  is not a cosmetic mismatch: the server keeps reading the override, `passwd` reports
  success, and doctor then PASSes on the file it just wrote — so an operator rotating after
  a compromise gets a green transcript over a live, unchanged credential. Both consumers now
  resolve through one function (`ccrc`'s `_box_auth_path`): an empty override is absent (the
  bare-`KEY=` rule), an ABSOLUTE override is honoured **and named in the output**, and a
  RELATIVE one is refused by both — `config.ts` does not resolve it either, so the server
  resolves it against systemd's working directory and every tool against its own, and no
  verdict about "the secret" is available when nothing can say which file that is.
- **D-131 — the BOOT refusal was the last path by which a byte of `auth.scrypt` reached a
  log.** D-127 closed this class in the doctor (which shells to `--check` and reads an exit
  CODE, never a message) and the same leak stayed open one seam over: `buildServer` called
  `readAuthSecret` uncaught, and `AuthSecretUnusable`'s message QUOTES the field it choked on
  — `unknown prefix "<field>"`, `N is not a plain decimal integer ("<field>")`, `final field
  must be "gen=..", got "<field>"`. Node prints an uncaught rejection's message, stack **and
  `[cause]` chain**, `verify-service.sh` tails that into a deploy transcript, and the
  plausible way to get an unusable `auth.scrypt` is a misplaced copy of some OTHER secret.
  Fixed at the boot call site: the throw is caught and re-thrown as a NEW `AuthSecretUnusable`
  whose message is structural (which file, that it is present-but-unusable, `ccrc doctor` as
  the safe way to measure it, and D-125's `mv … && rm -f <sessions> && ccrc passwd` remedy)
  — with **no `{ cause: err }`**, because attaching it would put the original message back in
  the journal through the printer instead of through the string. The refusal is unchanged in
  every other respect: same class, still fatal, still armed-path-only. Measured with a
  three-way mutation, and the FIXTURES are measured too: one test asserts the planted bytes
  really do appear in `readAuthSecret`'s own message, because a garbled line whose failure arm
  quotes nothing (`expected 5 '$'-separated fields, got 1`) would make the leak assertion pass
  for the wrong reason — the defect the Task 9 review caught in D-127's first fixture.
  `server.ts`, `auth-routes.test.ts`.

- **D-132 — a shipped auth feature with no way to sign out.** `POST /api/auth/logout` landed in
  Task 5 — gated, tested, and with ZERO callers in `pwa/src` (`api.ts` shipped no `logout` because
  nothing used it). So an armed box had no control for ending a session: the only routes back to a
  login screen were an empty cookie jar, a `ccrc passwd` rotation, or waiting out the 30-day
  absolute TTL. Invisible from inside the code and obvious the moment the runbook had to tell an
  operator how to do it. Fixed with `api.logout()` and a **This session** block on `AccountsScreen`,
  beside the passkey controls for the reason both belong there: each requires an existing session.
  THE LOCAL HALF GOES THROUGH `raiseAuthLost('no-session')` — the same seam a 401 uses — because
  that seam already mounts the login screen, parks both socket ladders, and makes the next login's
  `clearAuthLost` wake them; a second path would have reinvented three behaviours and matched none.
  `'no-session'` and not `'expired'`, because `'expired'`'s sentence claims something happened TO
  the operator. Rendered in BOTH passkey branches including D-119's unreadable-store one: an
  operator whose credential file is broken must not also be trapped on a console they cannot leave.
- **D-133 — the cookie-policy contradiction had no signal at all.** `cookieSecure` is config-driven
  and defaults ON regardless of scheme, which is correct (a scheme-derived flag drops `Secure`
  behind `tailscale serve`, the deployment that most needs it). The consequence nobody stated: an
  `http:` `CCRC_ORIGIN` mints a `Secure` cookie that a browser may silently discard, so the login
  answers **204**, the session row is written, the server does everything right, and the operator
  watches the login screen come straight back with NOTHING logged — because nothing failed. The
  mirror (`https:` origin + `CCRC_COOKIE_INSECURE=on`) is a plain downgrade. Fixed with
  `cookiePolicyProblem` (`cookie.ts`) and one boot line. **This is the boot check that IS
  implementable**, and the distinction matters: the origin self-check ruled out in Task 8 needs a
  fact the server cannot obtain (the hostname it is reached under), while this compares two values
  the same operator stated in the same file. Both CORRECT combinations are silent — D-126's rule.
  An unparseable origin returns `null`, because `originProblem` already reports exactly that.
- **D-134 — an IP-literal `rpId` was accepted by the server and refused by every browser.**
  `rpIdProblem` refused single labels, a short trap list and a charset — and `127.0.0.1` passed all
  three (it has dots, and holds nothing outside `[a-z0-9.-]`). `originProblem` then AGREED with it,
  because `http://127.0.0.1:7788`'s hostname is exactly `127.0.0.1`, so `relyingPartyProblem`
  answered `null`: no boot warning, live ceremony routes, and an opaque `SecurityError` in the
  client with nothing in the journal — *precisely* the failure that function's own docstring says it
  exists to convert into a log line and a 501. Found by writing the localhost runbook, where
  reaching the box by IP is the obvious thing to do and `CCRC_RP_ID=127.0.0.1` is the obvious way to
  make the pair agree. Refused now, v4 and v6, with a sentence naming the name to use instead. The
  test is SHAPE-based rather than an address parser and is placed before the charset check so an
  IPv6 literal gets the IP sentence rather than the generic "not a bare domain" one; the ipv4 shape
  requires a dot so a bare numeric label still gets the more accurate single-label message.
- **D-135 — D-130's defect class, one key over.** Doctor's `auth` remedy resolved the SECRET through
  `_box_auth_path` and then printed a hard-coded `rm -f ~/.ccrc/sessions.json` in the same sentence.
  On a box setting `CCRC_SESSIONS_PATH` that tells an operator to delete a file nothing reads —
  leaving the sessions that the fresh generation-1 secret is about to REVALIDATE exactly where they
  were, which is the same "green transcript, unchanged reality" shape D-130 was raised for. Fixed
  with ONE parameterised resolver: `_box_path_for <key> <default>`, with `_box_auth_path` and
  `_box_sessions_path` as its two callers, so the two cannot hold different opinions about the
  three-way rule. A RELATIVE `CCRC_SESSIONS_PATH` prints no `rm` at all and says why, rather than
  guessing a path that would delete something else. `gen-auth-hash.mjs`'s own copy of the sentence
  still says `~/.ccrc/sessions.json` — it is never handed the sessions path, and it already hedges
  with "CCRC_SESSIONS_PATH overrides where it lives"; widening the helper's CLI for a message was
  judged the worse trade.

- **D-136 — the armed gate broke the coordinator protocol's mandated read of `GET /api/runs`.**
  `gate.ts`'s entry for `POST /api/runs` ended "GET /api/runs is the PWA read and is NOT here", and
  that characterisation was **false one corpus over**:
  `ccd/coordinator-skill/references/wave-lifecycle.md` makes the GET part of the pinned protocol,
  performed **cookieless** from the fleet host — `:34` is the standing re-orientation after every
  compaction ("never parse a hold reason to learn what wave you are on. Ask `GET /api/runs` and read
  the run row's own `wave`"), `:95`/`:386` are the documented `unknown-run` recovery, `:375` is the
  ledger tally. The gate reads only the session cookie, and the route had no token check of its own,
  so an armed box answers `401 no-session` to all four — wedging the coordinator out of the run it
  owns at the two moments it is least able to diagnose itself, with the pause files untouched and
  nothing red anywhere. Workers were unaffected: their whole surface is exempt box-token lanes.
  Fixed as **exempt-but-authenticated**, the `GET /api/auth/status` pattern — the handler requires a
  live session **or** a valid box token, so the confidentiality the method-keyed table bought is
  unchanged. Flag-aware, so a dark box is untouched; the refusal carries the session's own
  `AuthVerdict`, so the PWA's one login screen keeps working and D-114's expired-vs-no-session split
  survives; and it authenticates BEFORE it answers `501`, which the gate would have done for it.
  Softening the skill was rejected: re-measure-not-parse is load-bearing there and
  `coordinator-skill.test.ts` pins those clauses verbatim.
  **THE GENERAL LESSON, bigger than the route:** `auth-gate.test.ts` validated `EXEMPT` against the
  server's own route table in *both* directions and against every `checkMailToken` call site — and
  never against consumers **outside `server/`**. The skills and `ccd/ccrc` read this HTTP surface
  too, and a route's "who calls this" is not a fact the server package can see about itself. Two
  source-scanning tests now close that: one asserts every `METHOD /api/…` either skill corpus names
  is in `EXEMPT` (it reds if `GET /api/runs` leaves the table — measured), and one asserts every path
  a real `curl` in `ccd/`/`deploy/` reaches is either exempt or carries a written ruling.
  A side effect worth noting: the table's "keyed by METHOD" paragraph was justified by `/api/runs`
  being exempt as a POST and gated as a GET. Both methods are now in the table, so that argument was
  rewritten to the forward-looking one it always really was — an exemption is a decision about a
  (method, path) PAIR, and a path-only table would hand a `DELETE /api/runs` registered next month a
  hole nobody decided about.
  **Also recorded, NOT fixed:** `ccrc doctor`'s one network call (`GET /api/fleet/health`,
  `ccd/ccrc:615`) is gated and answers 401 on an armed box. Left gated deliberately — that route
  publishes roster digests, build stamps and divergence, and exempting it to spare a diagnostic
  would widen the tailnet surface. It is **degraded, not wedged**, which is the difference from the
  finding above: doctor prints `fleet: not measured (the server answered HTTP 401 …)` beside its own
  `auth` check reporting the gate is armed, so a human reading two adjacent lines can connect them —
  where the coordinator had no human and no second line. Follow-up for the `ccd/ccrc` owner is a
  message naming the gate rather than the bare code; the sweep test carries that ruling so a new
  unexempt `curl` fails instead of joining a tolerated set.

- **D-137 — the doctor's one network call read a CORRECT refusal as a fault.** `ccrc`'s only HTTP
  request is `GET /api/fleet/health`, which is GATED — deliberately, and re-affirmed at whole-branch
  review: that route publishes roster digests, build stamps and divergence, and exempting it to
  spare a diagnostic would widen the tailnet surface for convenience. So an armed box answers 401,
  which is both parties behaving correctly — and `_box_health` folded it into its generic HTTP-error
  code, whose callers say *"answered HTTP 401 … read the server's own log"* and *"fleet: not measured
  (the server answered HTTP 401 …)"*. That sends an operator to a journal where nothing is wrong, on
  exactly the box the runbook tells them to run doctor on immediately after arming, and
  `ccrc.env.example` ships `CCRC_HOST`/`CCRC_PORT` populated so every example-derived box reaches it.
  Fixed as a MESSAGE change, never a routing one: a new `_box_health` code 9 for THIS server's own
  refusal envelope (`error: 'unauthenticated'` plus a `verdict` — a bare 401 is not enough, since a
  reverse proxy answers 401 too and telling that operator "your session gate refused it" is the same
  class of wrong answer). Matched with bash's own `=~` rather than node, because this arm has to work
  on a degraded box; nothing from the body is printed, as ever. Doctor SKIPs rather than WARNs — a
  WARN owes a remedy and the only honest one would be "turn the gate off", and a yellow line every
  armed box shows on every run is D-126's lesson exactly. **The cost is stated in the line rather
  than glossed:** build skew and roster divergence are NOT measured on an armed box, so silence there
  is not evidence of agreement, and the message says to compare with `ccrc version` by hand. What
  makes that acceptable — and D-136 not — is that doctor is DEGRADED, not wedged, and prints this
  line beside its own `auth` check reporting the gate is armed: a human reading two adjacent lines
  can connect them. The coordinator had no human and no second line.
- **D-138 — `'unconfigured'`'s sentence was false in one of the two states it covers.**
  `LoginScreen` rendered *"No passphrase is set on this box — run `ccrc passwd`"*, and that verdict is
  ALSO what a present-but-unusable secret produces at request time (the collapse is a stated wire
  limit: `AuthVerdict` has no "present but unreadable" member, and publishing one would tell an
  anonymous caller which boxes are unenterable-but-open). In that state the sentence is false twice
  — a passphrase IS set, and `ccrc passwd` will REFUSE (D-125) and print the real
  `mv … && rm … && ccrc passwd`. Never a lockout: it ends correctly after two hops. But Task 7's
  sentence and Task 9's refusal disagreed across the seam. Now it points at `ccrc doctor`, the one
  command that is correct in BOTH states, and asserts nothing that is false in either — and still
  leaks neither, which is what kept the wire collapse worth having.
- **D-139 — a config refusal rendered as a network failure.** With passkeys enrolled and `CCRC_RP_ID`
  later broken, the login screen still offers the passkey button (it keys off `passkeysEnrolled > 0`,
  and the credential store loads regardless of the RP check). `assert/start` then answers a BARE 501
  carrying no `verdict`, `verdictOf` returns null, and the catch fell through to *"Couldn't reach the
  box — check the connection"* — pointing at the one thing that is fine, while the server's journal
  held the answer. A fourth failure kind now, caught by STATUS before the null-verdict arm claims it:
  the box cannot run the ceremony, its WebAuthn config is refused, use the passphrase. The button's
  own visibility is left alone deliberately — hiding it would need `AuthStatus` to publish passkey
  AVAILABILITY as distinct from enrolment, a wire change for a case whose sentence is now correct.
- **D-140 — the unreadable-store sentence hard-codes `~/.ccrc/passkeys.json`, and that is a decision.**
  `CCRC_PASSKEYS_PATH` can redirect the file — the D-130/D-135 class one file over — but a BROWSER is
  the one surface in this tree that genuinely cannot resolve it: no route publishes the path, and
  adding one would put a filesystem path on a near-anonymous screen for the sake of a sentence. So it
  is HEDGED rather than resolved or dropped, the same shape `gen-auth-hash.mjs` uses for the session
  file it likewise cannot resolve: it names the default AND the key that overrides it. Dropping the
  path instead would leave an operator with "fix the permissions" and no file to fix. Recorded here
  so it reads as a decision rather than an oversight.

**Recorded, deliberately unchanged:** the `signCount` both-zero carve-out. Most Apple/Android
platform passkeys and every synced credential always send 0; accepting them forfeits nothing,
because clone detection was never available for a key that lives in several places by design.
The single-use challenge remains the replay defence for those credentials.

**Operator ruling, wired:** revocation is `DELETE /api/auth/passkey/:id` + `GET
/api/auth/passkeys` (both gated) and a per-credential list in the PWA. `ccrc passwd` keeps its
current meaning — it invalidates **sessions**, not authenticators — and `StoredCredential`
deliberately carries no generation stamp. The documented emergency procedure is "revoke the
passkey, then rotate the passphrase". This matters because `rm ~/.ccrc/passkeys.json` does
**not** work on a running server: the store loads once at boot and the next accepted assertion
rewrites the file from memory, resurrecting the row.

## Deferred / seams recorded

**Scope decisions, taken at plan time:**

- **Passkeys are origin-bound; 3a's proof is localhost-scoped** — enrolled-there credentials don't carry to 3b's DuckDNS name; per-credential rpId binding makes that a loud failure, not a silent one. Stated, not engineered around.
- **`Secure` behind real TLS + `trustProxy`** — 3a drives `Secure` from config; the `trustProxy`/`X-Forwarded-Proto` decision lands properly in 3b when Caddy terminates TLS.
- **Per-user identity** — the single-identity session layer is deliberately the team-edition seam (spec §6); this slice ships one operator.
- **Attestation verification** (packed/tpm/etc.) — out of scope; `attestation:'none'` is what keeps the crypto library-free; the team edition revisits it.

**Minors found DURING the stage, recorded rather than fixed.** Consolidated here
from each task's own progress notes at close-out, because once the plan is the
only surviving artifact a note that lives only in a task ledger is a note that is
lost. None is a bypass or a fail-open; each is a real seam somebody will meet.

*The gate (Task 5):*

- **`gate.ts:315` measures the secret BEFORE the exempt check** — so an exempt request on an armed box still pays one `readFileSync`. Fail-SAFE as-is (the ternary is a cost gate, not a decision gate: not measuring yields `'unread'`, which denies), so it is a cost, not a hole. Reordering would be an optimisation with a security-relevant ordering change in it.
- **`gate.ts:127`'s `GET /*` exempts every UNMATCHED GET on a box with a built `dist-pwa/`** — so an unmatched `/api/...` GET answers 404 rather than 401 there, while on an API-only box (no static plugin, no `/*` route) the same url is gated. It leaks the existence of a route table that is public in this repo anyway; noted so nobody later reads the 404 as a gate failure.
- **`server.ts`'s cookie `Max-Age` derives from `ABSOLUTE_TTL_MS` (30d) while `IDLE_TTL_MS` is 4d** — so a browser can hold a cookie for up to ~26 days after the row behind it has been swept. **CORRECTED at close-out (whole-branch review).** This entry used to claim the idle lapse still answers `'no-session'`, and that D-114 fixed "only the unmatched-token half" — the shipped code disagrees, and a ledger that overstates what shipped is itself a finding. `sessionVerdict` maps EVERY presented-but-unmatched cookie to `'expired'` (`gate.ts`'s D-114 arm), sweep-deleted idle rows INCLUDED, because a swept row is exactly an unmatched hash; the expire-cookie guard therefore fires and sheds it (pinned in `auth-gate.test.ts`). The only `'no-session'` answers left are literally-no-cookie. **The true residue is cosmetic:** the jar outlives the idle TTL until the browser next presents the cookie, and that first presentation is what shreds it. Nobody is shown a wrong sentence, and there is no code change owed.
- **`expireCookie` sweeping lives only in the gate** — an expired cookie presented to the EXEMPT status route is not swept.
- **`GET /api/auth/status` does a second `readFileSync` per anonymous request on an armed box** — the gate already does one, so this doubles rather than introduces.

*The PWA (Task 7):*

- **No focus trap on the login screen** — matches `BlockScreen`, so this is consistency, not a regression. It is still a full-screen modal a keyboard user can tab behind.
- **A dark box serves one extra `/api/auth/status` per failed socket attempt** — the probe fires whenever an attempt never opened, and on a gateless box that is a request with no answer to give. Behaviourally identical, not byte-identical.
- **`checkAuth`'s cost, if ever trimmed, must use a TIME THROTTLE and never a memoised "this box is dark"** — arming the flag is a server restart that does NOT reload the page, so a permanent memo recreates the endless-reconnect failure the whole task exists to prevent.
- **A success toast fired in the same tick as a 401 wave is dropped** — so a non-idempotent action may be re-done after signing back in. Narrowing the guard would need the ~40 catch blocks the design exists to avoid.

*The CLI and the helper (Task 9):*

- **Stale `auth.scrypt.tmp.*` files are never reaped, and the doctor does not report them** — the writer unlinks its own temp on every failure path it can see, but a crash between `writeFileSync` and `renameSync` leaves one behind. 0600 and randomly suffixed, so it is litter rather than a leak, and litter beside a credential is still litter nobody is looking for.
- **The 12-character passphrase floor lives in bash only, deliberately** — `gen-auth-hash.mjs` validates FORMAT, `ccrc passwd` owns POLICY, and a second copy of the number is exactly the drift `single-definition.test.ts` fails builds over. Recorded so the asymmetry reads as a decision.

*Found by the whole-branch review, all FIXED:* **D-137** (the doctor read a correct 401 as a fault),
**D-138** and **D-139** (two login-screen sentences that are false in a reachable state), **D-140**
(the hedged passkey path, recorded as a decision). The review also corrected two ledger claims: the
Max-Age entry above, and `server.ts`'s "nothing is READ off it while dark" comment, which was the
stronger claim — the exempt status route reads `passkeys.count()` on a dark box, harmlessly, off an
unloaded in-memory array. **A ledger that overstates what shipped is itself a finding**, so both were
fixed in place rather than left to be rediscovered.

*Found while writing the documentation (Task 10) — all four FIXED, not deferred:*

Writing the operator-facing docs surfaced four real defects. They are recorded here as findings and
in the ledger above as **D-132** (no sign-out control), **D-133** (the cookie-policy contradiction
had no signal), **D-134** (an IP-literal `rpId` passed the server's own validator) and **D-135**
(the doctor's remedy hard-coded the sessions path). The pattern is worth keeping: each one was
invisible while reading the code and obvious the moment a sentence had to be written telling an
operator what to do. Documenting a feature is the best review it gets.

## Close-out — stage 3a, 2026-08-20

**What shipped.** A session gate over every route, dark by default.

- **L0 wire vocabulary** (`shared/api.ts`): `AuthVerdict` in the `PrReason` shape, `LoginRequest`, `AuthStatus`, four WebAuthn shapes. No `FLEET_PROTO` bump — the frames are additive.
- **The secret** (`auth/secret.ts`): a self-describing scrypt line, parsed strictly, failing SHUT on anything present-but-unusable; `verifyPassphrase` async and length-check-first; a generation the rotation bumps.
- **The session store** (`auth/sessions.ts`): a flat file holding `sha256(token)` and never the token, 0600, tmp+rename, 30d absolute / 4d idle, sweeping on load and on a timer, and DEGRADING rather than crashing on a corrupt file — deliberately the inverse polarity to the secret's.
- **The brake** (`auth/ratelimit.ts`): a pure L1 policy plus one impure holder, counting failures rather than attempts, and RESERVING at admission so a concurrent flood cannot all pass while the count is still zero.
- **The gate** (`auth/gate.ts`, `auth/cookie.ts`): one `onRequest` hook, an exempt table keyed by METHOD as well as path, an Origin check on every upgrade and every non-exempt write, and a decision that is pure and returns WHY it allowed.
- **Passkeys** (`auth/webauthn.ts`, `auth/credentials.ts`): WebAuthn with `node:crypto` alone — no new dependency — two separate challenge stores, per-credential rpId/origin binding, enrolment behind the gate, and revocation wired end to end.
- **The client** (`pwa/src/lib/auth.ts`, `LoginScreen.tsx`, `AccountsScreen.tsx`): a login screen that rises on POSITIVE evidence only, so no route on a dark box can raise it; both socket ladders park while lost and resume on regain; and a **Sign out** control that goes through the same signal (D-132).
- **The operator surface** (`ccd/ccrc passwd`, `deploy/gen-auth-hash.mjs`, `ccrc doctor`'s `auth` check): one writer for the secret, ONE parameterised resolver for both the secret's path and the session store's (D-135), a round trip through the server's own parser before any install, and a check that measures the file without printing a byte of it.
- **Two boot warnings that catch a silent misconfiguration** — the rpId/origin pair, now including IP literals (D-134), and the cookie policy against the origin's scheme (D-133).
- **The documentation** (this task): `deploy/ccrc.env.example`, README's session-gate section, and step 10 of the VM-gate runbook.

**Deliberately deferred** — the four scope decisions and the eleven minors above, none of them load-bearing for arming the gate. The four defects the documentation pass found (D-132..D-135) were FIXED rather than deferred.

**Pending operator proofs.** Everything above is a hermetic-suite measurement over fixture `$HOME`s. Three things only a real run can answer, and all three are step 10 of the runbook:

1. **The arming sequence on a real box** — `ccrc passwd`, the three-key edit, the restart, the login, and now the sign-out. Whether the `Secure` cookie survives a plain-http localhost browser is still the one step whose answer this repository does not know — but D-133 means the box now WARNS that it might not, so the operator meets a predicted symptom rather than a mystery.
2. **A passkey ceremony against a real authenticator.** Every passkey test in this stage signs with a real P-256 keypair, but no test has ever driven a browser, a platform prompt or a security key.
3. **The emergency procedures, rehearsed once** — revoke-then-rotate, and the `mv … && rm -f … && ccrc passwd` recovery from a corrupt secret. The cheapest time to run them is on a VM that is about to be destroyed.

**The deploy posture this stage ends in:** `CCRC_AUTH` is off everywhere, including the live fleet. The whole slice can ship to production and change nothing until an operator makes one edit; that was the design constraint and it held to the end.
