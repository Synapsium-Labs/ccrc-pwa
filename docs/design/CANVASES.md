# Design canvases

Every canvas made with `/design` for this product gets a line here, **with the commit
sha it matched**. Without the sha a canvas drifts from the code silently and nobody can
say when it stopped being true.

A canvas is a picture of a decision, not the decision. Ground truth stays `ui/src` plus
the contrast gate (`pwa/design/audit.mjs`); an edit made in the Claude Design GUI comes
back as a brief for the next wave, never as code.

| Canvas | Covers | Brief | Matched at |
|---|---|---|---|
| _(none yet)_ | | | |

## Columns

- **Canvas** — the canvas's name, as the design is called. Never its link: this
  repository is public, and a claude.ai link is the id of a private, account-scoped
  resource (`CLAUDE.md`'s public-repo rule). Name plus sha is enough to find it again.
- **Covers** — which screens or components, in the product's own words.
- **Brief** — path under `briefs/`, or `—` for a canvas made without one.
- **Matched at** — the short sha of the commit whose `ui/src` the canvas was drawn
  against. Re-check the canvas when that sha falls behind a wave that touched the
  components it shows.
