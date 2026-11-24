# A GitHub credential in Settings › Integrations: plan

The plan for `docs/superpowers/specs/2026-11-22-integrations-github-credential-design.md`. It records the deviation
numbers the spec names. The task breakdown of each pull request is written when that pull request is dispatched, and
nothing is built before the operator rules on the spec's decisions.

## Deviations found

- **D-8933 (2026-11-22)** — github-key-on-server-box. The GitHub credential is stored on the server box, in a slot
  store shaped like Linear's. Today the server holds no credential for GitHub.
- **D-8934 (2026-11-22)** — github-box-signin-from-key. Stage 1: ccrc signs the fleet box's `gh` in from the stored
  key, handed over by a one-time code, so the key never rides the agent link.
- **D-8935 (2026-11-22)** — gh-store-read-guard. Stage 1 adds the missing guard: `gh`'s store directory joins the
  paths no session reads.
- **D-8936 (2026-11-22)** — github-proxy-beside-ccd. Stage 2: a GitHub proxy on the server beside `ccd`'s own `gh`
  calls. While both exist they are two mechanisms for one job, and the reason is recorded in the spec.
- **D-8940 (2026-11-22)** — doctor-gh-auth-inverts. Once the proxy carries the API calls, doctor's `gh` check inverts:
  a token in `gh`'s store on a fleet box becomes the finding.
- **D-8941 (2026-11-22)** — gh-whitelist-purpose-moves. The standing rule "`gh` has NO exec-whitelist entry,
  deliberately" is kept, and its stated purpose moves with the token: the spec says how.
