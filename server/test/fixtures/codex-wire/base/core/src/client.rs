// Synthetic excerpt for codex-wire-watch.test.ts, shaped like the upstream client; not upstream source.
const RESPONSES_ENDPOINT: &str = "/responses";
const RESPONSES_COMPACT_ENDPOINT: &str = "/responses/compact";

pub fn headers(session: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert("session-id", HeaderValue::from_str(session).unwrap());
    headers.insert("originator", HeaderValue::from_static("codex_cli_rs"));
    headers.insert(HeaderName::from_static("chatgpt-account-id"), account_value());
    headers
}

pub fn content_type() -> &'static str {
    "text/event-stream"
}

pub fn include() -> Vec<String> {
    vec!["reasoning.encrypted_content".to_string()]
}
