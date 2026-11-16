"""codexbridge.count — D24: a local `count_tokens` from the bytes the bridge sends, calibrated per route and model.

Codex-bridge spec 2026-10-15 §2.3 ("`count_tokens` … answered locally. Calibrated per route and model from the
bridge's own measurements (D24). No upstream call.") and D24 ("A running bytes-to-tokens ratio per route and model,
seeded at 3.5 bytes per token, rounded up, so an estimate errs towards compacting early"); plan 2026-10-22, Task 5.

The bytes are `NeutralRequest.countable_bytes` (Task 2): what the bridge sends, with base64 image data, dropped
thinking blocks, `cache_control` and the billing line never counted. Each image is a fixed `inbound.IMAGE_TOKENS`
(D-6427). The ratio a route and model carry lives in the stats file (`stats.Stats.ratio`), moved by
`updated_ratio` from each successful reply's real `input_tokens`.

Every constant is read when a function is called, so the test driver's `consts` reach it.
"""

import math

from . import inbound

SEED_BYTES_PER_TOKEN = 3.5  # D24's seed: a fresh route and model, before any measured reply
ALPHA = 0.2  # the exponential average's weight for one new sample
RATIO_MIN = 1.0  # the clamp: a ratio never leaves [RATIO_MIN, RATIO_MAX] bytes per token
RATIO_MAX = 8.0
CALIBRATE_MIN_TOKENS = 1000  # a reply with fewer input tokens is too small a sample to move the ratio


def _ratio(value: object) -> float:
    """A usable ratio: a finite positive number, else the seed (a bool is not a number here)."""
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0:
        return float(value)
    return SEED_BYTES_PER_TOKEN


def estimate(countable_bytes: int, ratio: float, image_count: int = 0) -> int:
    """`ceil(bytes / ratio) + image_count × inbound.IMAGE_TOKENS`, at least 1. Rounded up, so the estimate errs high
    and Claude Code compacts early rather than late (D24)."""
    tokens = math.ceil(max(0, countable_bytes) / _ratio(ratio)) + max(0, image_count) * inbound.IMAGE_TOKENS
    return max(1, tokens)


def updated_ratio(old: float, countable_bytes: int, input_tokens: int) -> float:
    """The ratio after one measured reply: an exponential average with weight ALPHA, clamped to [RATIO_MIN,
    RATIO_MAX]; `old` unchanged when the reply had fewer than CALIBRATE_MIN_TOKENS input tokens or no bytes."""
    if input_tokens < CALIBRATE_MIN_TOKENS or countable_bytes < 1:
        return old
    base = _ratio(old)
    sample = countable_bytes / input_tokens
    return min(RATIO_MAX, max(RATIO_MIN, base + ALPHA * (sample - base)))
