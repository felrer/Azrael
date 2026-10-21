상태: 검토 완료 — 구현·설정 변경·빌드·설치 및 유료 실험은 수행하지 않았으며, 다음 단계는 제안된 이식과 비교 실험의 실행 범위 결정이다.

# 하위 에이전트 프롬프트 캐시 비용 최적화 검토

## 목적과 범위

사용자가 들은 최근 Codex 변경을 확인하고 Azrael 비용 최적화 가능성을 평가한다. 허용 범위는 공식 자료 및 현재 코드 조사와 검토 기록 작성이다. 제품 구현이나 기본 설정 변경은 요청되지 않았다. 기존 작업 중 변경된 파일은 수정하지 않는다. 이번 검토는 2026-10-17 기준이다.

플랫폼 분류는 공통 엔진 동작이다. 대상 제품은 Windows x64, glibc Linux x64, macOS ARM64의 로컬 VS Code 호스트이며 OS/CPU/ABI별 캐시 정책 차이를 제안하지 않는다. 실제 확인은 Windows 환경의 정적 소스 조사와 공식 원격 소스 조회에 한정된다. 설치된 실행기 및 각 OS의 실제 추론·과금 결과는 확인하지 않았다. 후속 공통 변경에는 Windows 회귀 및 플랫폼 계약에 따른 검증이 필요하다.

## 결론

선택적 적용을 권장한다. 핵심은 캐시 메모리의 로컬 전달이 아니라 부모 요청의 서버 측 캐시와 일치하는 프롬프트 앞부분을 유지하는 것이다. 현재 Azrael에는 캐시 연결 정보 공유는 있지만 최근 전체 prefix 보존 기능은 없다. 따라서 캐시 키만 수정하거나 설정 한 줄만 추가해서 적용할 수 있는 상태가 아니다.

## 확인한 상류 변경

OpenAI 공식 저장소 PR #52535, Add opt-in history prefix preservation for full agent forks, 2026-10-09 11:08:39 UTC 병합. 조회된 merge commit: a06545b311fe01e51ce855c7aa5d8da21e9e7aaf.

- `multi_agent_v2.preserve_fork_prefix` 추가, 기본값 false.
- V2 전체 fork에서 부모에게 보였던 commentary와 도구 기록을 유지하고 자식 지시문을 뒤에 추가한다.
- 기존 compaction에 재사용 가능한 baseline이 없으면 기존 재구성 경로로 돌아간다.
- 끝나지 않은 도구 호출은 fork snapshot에서 정규화한다. 상속된 도구 세션/프로세스 핸들의 실제 소유권을 넘기지 않는다.
- 상속 기록의 provenance를 남기고 부모의 수동 승인을 자식 승인 근거에서 제외한다. checkpoint replay도 포함한다.
- 설정, fork 처리 외에 history 정규화, guardian review, tests/snapshots까지 변경한 기능이다. spawn 함수만 복사하면 충분하지 않다.

출처: https://github.com/openai/codex/pull/52535
커밋: https://github.com/openai/codex/commit/a06545b311fe01e51ce855c7aa5d8da21e9e7aaf

## Azrael 현황과 차이

현재 기본 엔진은 docs/ops/development.md의 Source and state에 따라 engine/를 선택했다. 문서에는 0.162.0 통합 소스로 기록되어 있다. upstream/codex는 이전 기준선이므로 적용 판단 근거로 사용하지 않았다. engine/SOURCE.json과 다른 파일에 기존 작업 변경이 있어 보존했다.

| 확인 항목 | 현재 근거와 의미 |
| --- | --- |
| 캐시 키 | engine/codex-rs/core/src/client.rs::prompt_cache_key는 기본적으로 responses_metadata.session_id를 사용한다. |
| 부모/자식 연결 | core/tests/suite/prompt_cache_key.rs::api_key_subagent_uses_session_id_as_prompt_cache_key는 서로 다른 thread ID와 같은 session ID, prompt cache key를 기대한다. 테스트 코드를 읽었으며 실행하지 않았다. |
| 기록 필터 | core/src/agent/control/spawn.rs::keep_forked_rollout_item은 여러 도구 호출/결과와 reasoning 등을 제외하고 assistant phase도 제한한다. 부모의 전체 model-visible prefix와 차이가 난다. |
| 지시문 변경 | 같은 파일에서 부모 developer fragment를 치환하고 root coordination, parent request guidance 등 Azrael 지침을 제거한다. 앞부분 변경은 이후 캐시 재사용을 제한할 수 있다. |
| 새 옵션 | core/src/config/mod.rs, features/src/feature_configs.rs, core/config.schema.json, spawn.rs에 preserve_fork_prefix가 없다. 단순 활성화는 불가능하다. |
| 사용량 기반 | protocol/src/protocol.rs::TokenUsage에는 cached_input_tokens와 cache_write_input_tokens가 있고 core/src/project_usage_pricing.rs에 가격 계산 경로가 있다. 측정 시 재사용 가능하지만 실제 모델/인증별 usage 제공과 가격표 유효성은 별도 확인해야 한다. |
| 다른 제공자 | providers/opencodex/inference.ts는 별도 요청 변환과 제공자별 캐시 처리를 사용한다. OpenAI 변경이 Anthropic·Devin·사용자 API에 같은 효과를 낸다고 일반화할 수 없다. |

## 캐시 조건과 비용 판단

OpenAI 공식 Prompt caching 문서는 전체 rendered prefix 일치와 모델·도구 정의·설정·compaction의 영향을 설명한다. GPT-5.6 이후 API 모델은 캐시 라우팅을 자동 처리하므로 키만 공유하는 것에 최적화를 집중하면 안 된다. Codex ChatGPT endpoint에는 client.rs가 session-id 기반 affinity를 별도로 설명한다. API 문서를 구독 endpoint의 과금 규칙으로 일반화하지 않는다.

캐시 유지에도 읽기 비용, 모델별 쓰기 비용, 새 자식 지시문 및 출력/추론 비용이 남는다. 긴 부모 맥락을 상속하면 cache hit가 좋아져도 짧은 새 맥락보다 총비용이 높을 수 있다. 비교 지표는 hit 비율 외에 작업 전체의 일반 입력·캐시 읽기·캐시 쓰기·출력 비용, 재작업, 지연, 결과 품질이다. 루트와 자식 집계가 중복되지 않도록 한다. API 비용과 ChatGPT 구독 한도 감소는 별도로 관찰한다.

출처: https://developers.openai.com/api/docs/guides/prompt-caching

## 권고하는 후속 작업

1. #52535의 관련 변경과 후속 수정 여부를 고정 revision으로 검토하여 선택적으로 이식한다. 처음에는 기본값 false와 명시적 opt-in을 유지한다.
2. Azrael 부모 전용 지침을 앞부분에서 제거하는 기존 계약과 prefix 보존을 조정한다. 과거 부모 지침을 모델 맥락으로 유지하더라도 자식의 현재 역할·도구 제한·실행 권한과 부모 승인을 구분해야 한다. 단순 early return으로 기존 sanitation을 우회하지 않는다. 승인 계승 방지, root 전용 행동 방지, checkpoint/resume 이후 일관성을 검증한다.
3. 동일 모델/제공자/인증 범위의 전체 상속 작업에서 기존 경로와 보존 경로를 비교하고, 독립 작업에는 fork_turns=none으로 필요한 자료만 준 경우도 비교한다. 캐시를 이유로 더 많은 에이전트를 생성하지 않는다.
4. 기존 사용량/가격 계산 경로를 재사용해 캐시 읽기·쓰기와 전체 작업 비용을 측정한다. 별도 모델로 전환한 자식이 부모의 캐시를 그대로 재사용한다고 가정하지 않는다.
5. 비교 결과가 품질·권한 격리를 유지하며 총비용을 낮출 때 기본 정책 변경을 검토한다. 구현 시 기능 inventory와 owning architecture의 상태를 함께 갱신한다.

## 검증과 수용 기준

이번 검토의 완료 기준은 실제 상류 변경 식별, 현재 Azrael의 구현 차이 확인, 적용 조건과 미검증 범위 명시이며 모두 정적 조사로 충족했다. 실행 코드는 변경하지 않아 테스트/빌드는 실행하지 않았다. PowerShell 파일 조회·공식 GitHub API/원본 조회로 근거를 확인했다. 일부 초기 검색/웹 조회 실패는 좁힌 재조회로 보완했다. 실제 캐시 적중률이나 절감률을 확정하지 않았다.

후속 구현 검증은 legacy/paginated 전체 fork, Code Mode, compaction fallback, incomplete tool call 정규화, 상속된 승인 격리, 자식 역할/권한, 재개 이후 동작을 포함한다. 고정 입력과 모델/설정으로 baseline과 opt-in의 실제 비용 및 품질을 비교한다. 소스 테스트, 실행기 빌드, 설치된 호스트와 실제 제공자 비용 검증은 서로 별도 수용 단계다.

## 미결정 사항

검토 결과에 대한 사용자 질문은 없다. 구현 요청이 있을 때 선택적 이식 및 유료 비교 실험의 허용 범위를 기존 기록에서 이어서 결정한다. 이번에는 영구 아키텍처를 변경하지 않았다. 제안 단계이며 제품 동작 변경이 없기 때문이다.