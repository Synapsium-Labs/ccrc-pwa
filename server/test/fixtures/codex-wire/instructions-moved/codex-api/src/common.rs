// Synthetic excerpt for codex-wire-watch.test.ts, shaped like the upstream file's request struct; not upstream source.
use serde::Serialize;

/// The request body. A doc comment's "response.not_an_event" is prose, never a finding.
#[derive(Debug, Serialize)]
/// The instructions travel as the first input item now, a developer message.
pub struct ResponsesApiRequest<'a> {
    pub model: &'a str,
    pub input: &'a [ResponseItem],
    pub tools: &'a [serde_json::Value],
    pub tool_choice: &'static str,
    pub parallel_tool_calls: bool,
    pub reasoning: Option<Reasoning>,
    pub store: bool,
    pub stream: bool,
    pub include: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_cache_key: Option<String>,
    pub text: Option<TextControls>,
}

#[derive(Debug, Serialize)]
pub struct Reasoning {
    pub effort: Option<String>,
    pub summary: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TextControls {
    pub verbosity: Option<String>,
    pub format: Option<HashMap<String, Box<dyn Fn() -> String>>>,
}

/* A block comment /* nested */ with "response.also_prose" in it. */
#[derive(Debug, Deserialize)]
pub struct ReadOnlyAnswer {
    pub never_sent: String,
}

pub fn quote_char() -> char {
    '"'
}

#[cfg(test)]
mod tests {
    #[derive(Serialize)]
    struct TestOnlyRequest {
        test_field: String,
    }
    const T: &str = "response.test_only";
}
