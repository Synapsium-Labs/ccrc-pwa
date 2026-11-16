// Path identity W1a (spec §2.1, §2.3): the ids the W1a gate tests plant. Data only: no test runs here.
// - REDIRECT_IDS: each begins `-`, so ccd could read it as a flag (spec §2.1). `--surface` is the id that turns a stop
//   into a stop of `pwa`; `--actor`, `--reason` and `--expect` are read by the decision-flag loops.
// - REFUSED_IDS: the redirect ids, then a dot-leading id and an id one character past the cap.
// - EDGE_ACCEPTED_IDS: ids that look close to a refusal and are registry ids: dashes inside, a dot then dashes, and
//   exactly the cap.
// The caps are written as literals on purpose: a list derived from REGISTRY_ID_MAX_CHARS would move with a wrong cap.
export const REDIRECT_IDS: readonly string[] = ['--actor', '--surface', '--reason', '--expect', '--session', '--', '-h', '-x'];
export const REFUSED_IDS: readonly string[] = [...REDIRECT_IDS, '.hidden', 'x'.repeat(256)];
export const EDGE_ACCEPTED_IDS: readonly string[] = ['a--actor', 'a.--actor', 'x'.repeat(255)];
