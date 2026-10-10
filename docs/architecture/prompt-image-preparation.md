# Prompt image preparation

Status: `partial` — common source policy; Windows verification is recorded per task. Installed-host acceptance requires a matching engine. Linux and macOS runtime acceptance remains unverified.

Owner: `engine/codex-rs/utils/image/src/lib.rs`; core user and tool image insertion uses `engine/codex-rs/core/src/image_preparation.rs`.

Shared prompt image preparation caps the long edge at 2560 pixels, preserves aspect ratio, and does not upscale. Existing lower detail or patch budgets still apply. After resizing, non-JPEG images larger than 1 MiB of encoded image bytes are converted to JPEG at quality 95 with 4:4:4 sampling only when the result is smaller and the image has no transparency. RGB ICC profiles and EXIF metadata are preserved. Existing JPEG inputs ignore this byte threshold: they pass through byte-for-byte when within the pixel budget, and are re-encoded only when resizing is necessary. The source file is untouched; prepared results are cached by source content and preparation mode. Raw `PromptImageMode::Original`, used for validation, retains its passthrough behavior.

This policy is common provider logic, separate from the configured native request envelope. It reduces individual image payloads but does not guarantee that accumulated history fits the total request limit, and does not automatically summarize or discard history.

The byte threshold applies to encoded image bytes before base64. JPEG quality is fixed; conversion does not repeatedly lower quality to meet a byte target.
