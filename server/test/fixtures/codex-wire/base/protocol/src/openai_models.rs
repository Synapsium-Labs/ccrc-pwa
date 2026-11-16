// Synthetic excerpt for codex-wire-watch.test.ts, shaped like the upstream model metadata; not upstream source.
#[derive(Debug, Clone, Deserialize)]
pub struct ModelInfo {
    pub slug: String,
    pub context_window: Option<i64>,
}
