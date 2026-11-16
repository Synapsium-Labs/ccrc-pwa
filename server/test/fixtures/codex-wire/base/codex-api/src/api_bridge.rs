// Synthetic excerpt for codex-wire-watch.test.ts, shaped like the upstream HTTP error mapper; not upstream source.
pub fn map_http(status: u16, body: &ErrorBody) -> ApiError {
    if status == 429 && body.error.code.as_deref() == Some("usage_limit_reached") {
        return ApiError::UsageLimit;
    }
    if body.error.code.as_deref() == Some("usage_not_included") {
        return ApiError::NotIncluded;
    }
    if status == 503 && body.error.code.as_deref() == Some("slow_down") {
        return ApiError::SlowDown;
    }
    ApiError::Other
}
