// graphifySkillFixture.ts — the graphify skill the install fixtures plant.
//
// ONE definition, three consumers (`install-graphify-skill.test.ts`,
// `ccrc-install-graphify.test.ts`, `ccrc-install.test.ts`). The pinned
// package's own frontmatter, verbatim from `<pkg>/skill.md` at 0.9.9 (read
// 2026-09-02): the description is the whole reason spec §1's artifact table
// credits this skill with reaching every session, so every fixture carries the
// REAL one rather than a placeholder. D-1366: D-1364's guard warns when that
// sentence is missing, and two install suites planted a one-line stub with no
// frontmatter at all — so the guard fired on the fixture, not the package, and
// "finishes clean: nothing on stderr" went red. A fixture plants the shipped
// artifact, not a paraphrase of it.
export const PKG_DESCRIPTION =
  'Use for any question about a codebase, its architecture, file relationships, or project content'
  + ' — especially when graphify-out/ exists, where the question should be treated as a graphify'
  + ' query first. Turns any input (code, docs, papers, images, videos) into a persistent knowledge'
  + ' graph with god nodes, community detection, and query/path/explain tools.';

// The BODY says both tokens too — the real package's does — so D-1364's guard
// is bound to the frontmatter description and cannot go green on a body mention.
export const skillMd = (description: string): string =>
  `---\nname: graphify\ndescription: "${description}"\n---\n\n# /graphify\n\n`
  + 'Run `graphify query "<question>"` against `graphify-out/graph.json` for a scoped subgraph.\n';
