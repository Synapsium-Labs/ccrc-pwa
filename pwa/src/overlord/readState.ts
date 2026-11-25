// One read's answer, as the console's Overlord store keeps it (Overlord W1 home, Global Constraints; review 2195 F11): L2,
// types only. Five states, so nothing unmeasured is ever read as a value: a reader takes this union, never a `null`.
//
// - `loading`: no answer yet.
// - `answered`: the read's last answer, at `at`.
// - `stale`: a refresh failed after an answer; the last answer is kept beside the failure.
// - `unmeasured`: a 401, any 5xx, a timeout or a network failure, with no answer before it.
// - `absent`: a 404 from the read's own path, which only an older server sends: that server has no such read.

export type ReadState<T> =
  | { readonly state: 'loading' }
  | { readonly state: 'answered'; readonly value: T; readonly at: number }
  | { readonly state: 'stale'; readonly value: T; readonly at: number; readonly error: string }
  | { readonly state: 'unmeasured'; readonly error: string }
  | { readonly state: 'absent' };
