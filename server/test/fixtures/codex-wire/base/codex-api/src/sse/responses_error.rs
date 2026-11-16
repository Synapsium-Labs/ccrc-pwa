// Synthetic excerpt for codex-wire-watch.test.ts, shaped like the upstream failure classifier; not upstream source.
pub fn classify(code: Option<&str>) -> Failure {
    match code {
        Some("context_length_exceeded") => Failure::ContextWindow,
        Some("cyber_policy") | Some("bio_policy") => Failure::Policy,
        Some("invalid_prompt") => Failure::InvalidPrompt,
        Some("server_is_overloaded") => Failure::Overloaded,
        _ => Failure::Other,
    }
}
