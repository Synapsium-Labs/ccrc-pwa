// Synthetic excerpt for codex-wire-watch.test.ts, shaped like the upstream item types; not upstream source.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionCallOutputPayload {
    pub content: String,
    pub success: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReasoningItem {
    pub id: String,
    pub summary: Vec<String>,
    pub encrypted_content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ResponseItem {
    Message { role: String, content: Vec<ContentItem> },
    FunctionCall { name: String, arguments: String, call_id: String },
    Reasoning(ReasoningItem),
    #[serde(other)]
    Other,
}
