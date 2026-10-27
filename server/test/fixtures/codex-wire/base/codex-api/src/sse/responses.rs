// Synthetic excerpt for codex-wire-watch.test.ts, shaped like the upstream event parser; not upstream source.
pub fn kind_of(event: &SseEvent) -> Option<Kind> {
    match event.kind.as_str() {
        "response.created" => Some(Kind::Created),
        "response.output_item.done" => Some(Kind::ItemDone),
        "response.output_text.delta" => Some(Kind::TextDelta),
        "response.completed" => Some(Kind::Completed),
        "response.failed" => Some(Kind::Failed),
        "response.incomplete" => Some(Kind::Incomplete),
        _ => None,
    }
}

pub fn raw_marker() -> &'static str {
    r#"a raw "string" that is not a literal of any family"#
}
