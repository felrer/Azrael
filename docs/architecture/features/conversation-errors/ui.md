# Conversation Errors UI

<!-- architecture: {"id":"arch.conversation-errors.ui","feature":"conversation-errors","layers":["ui"]} -->

## Conversation error messages

Status: `partial` — shared formatter and guarded pinned renderer implementation; verification and installed-host limits are in [the work record](../../../../work/BU-01-thread-01a144c2-error-analysis/02-plan.md). Preservation feature: `ui.error-presentation`.

The native integrated error selector and standalone conversation view share one evidence-based formatter. Known structured categories use safe fixed messages; exact approved rate details preserve their specific dimension. Unsupported-model and connection details require complete recognized formats, and cannot override a contradictory category. Authentication failure does not imply expired credentials, and a session budget is distinct from provider account usage. Unknown detail, including nested provider JSON, displays exactly `정의되지 않은 오류`.

The exact native Other text `Fatal error: 모델 제공자가 응답을 거부했습니다. (provider_refusal)` identifies an observed provider refusal and displays as `모델 제공자가 응답을 거부했습니다. (provider_refusal)`. Only that exact message/category pair establishes refusal; unprefixed, quoted, modified or contradictory-category text uses the unknown-error rule.

The exact historical helper text `rate limit exceeded: Provider request rate limit reached. Try again later.` also represented ambiguous HTTP 429 responses. Even with its saved `rateLimitExceeded` category, that particular legacy text displays as undefined and does not establish a rate-limit cause in recovery diagnostics. Conversation storage and recovery admission are unchanged.

Existing native error cards, typography, spacing and theme tokens remain in use. The native selector continues to suppress errors while retrying and preserves separately owned policy-error presentation. The formatter changes displayed errors only; conversation storage, tool results, permissions and retry/admission state remain with their owners. This shared presentation applies to Windows x64, Linux x64 and macOS ARM64; source/renderer fixtures do not establish installed acceptance.
