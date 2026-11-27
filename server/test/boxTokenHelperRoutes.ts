// The routes a file of their own registers whose box-token check is COMPOSED in the calling file and handed in (Desktop
// polish wave 187; review 4086's F-F): the helper's call is that route's registration in the calling file. ONE table, read
// by the two suites that count box-token checks: `box-token-census.test.ts` credits the check in the helper call's
// arguments to the route, and `coord-token.test.ts` gives the check site its owner. Each suite holds every row to its file.
// Keyed by the helper's name; `file` is repo-relative.
export const HELPER_ROUTES: Readonly<Record<string, { readonly key: string; readonly file: string }>> = Object.freeze({
  registerTestboxFramesRoute: { key: 'GET /api/testbox/frames', file: 'server/src/testboxFramesRoutes.ts' },
});
