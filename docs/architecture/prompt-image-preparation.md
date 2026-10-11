# Prompt image preparation

Status: `partial` — common source policy; matching Windows 2026.0.5 and Linux 2026.0.5 packages passed native and installed-host acceptance. Linux release-locked image library tests passed 17/17 on Ubuntu 24.04/glibc 2.39 through WSLg; evidence belongs to `artifacts/logs/linux-release-2026.0.5/build`. macOS runtime acceptance remains unverified. Engine image preparation and provider request normalization retain separate guarantees below.

Owner: `engine/codex-rs/utils/image/src/lib.rs`; core user and tool image insertion uses `engine/codex-rs/core/src/image_preparation.rs`.

Shared prompt image preparation caps the long edge at 2560 pixels, preserves aspect ratio, and does not upscale. Existing lower detail or patch budgets still apply. After resizing, non-JPEG images larger than 1 MiB of encoded image bytes are converted to JPEG at quality 95 with 4:4:4 sampling only when the result is smaller and the image has no transparency. RGB ICC profiles and EXIF metadata are preserved. Existing JPEG inputs ignore this byte threshold: they pass through byte-for-byte when within the pixel budget, and are re-encoded only when resizing is necessary. The source file is untouched; prepared results are cached by source content and preparation mode. Raw `PromptImageMode::Original`, used for validation, retains its passthrough behavior.

This policy is common provider logic, separate from the configured native request envelope. It reduces individual image payloads but does not guarantee that accumulated history fits the total request limit, and does not automatically summarize or discard history.

Provider adapters can apply additional image processing after this preparation. The Anthropic adapter normalizes images using age-based tiers and aggregate request budgets before its image-limit guard. JPEG byte preservation at the engine preparation stage therefore does not guarantee unchanged JPEG bytes in the final Anthropic request.

The byte threshold applies to encoded image bytes before base64. JPEG quality is fixed; conversion does not repeatedly lower quality to meet a byte target.
