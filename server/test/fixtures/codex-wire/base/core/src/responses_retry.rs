// Synthetic excerpt for codex-wire-watch.test.ts, shaped like the upstream retry rule; not upstream source.
pub fn retryable(code: &str) -> bool {
    matches!(code, "server_is_overloaded" | "rate_limit_exceeded")
}
