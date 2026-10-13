상태: 소스 수정·검증·정리 완료. 전체 빌드·설치는 범위 밖이며 사용자 추가 판단은 필요하지 않습니다.

목표: 모델별 자동 압축 설정 후속 변경. OpenAI native 구독 경로의 길이 비용 경계를 제거하고 기본값을 정확히 300,000토큰으로 설정합니다. 1M=30%, 400K=75%; 더 작은 모델은 실제 safe context에 제한합니다. 실제 모델 용량과 remote/config 제한을 늘리지 않습니다.

권한·보존: 코드·문서·관련 검증·작업 커밋. 기존 모델/provider/global 사용자 설정, API 비용 경계 및 기본값, Anthropic1M600K, 다른 제공자, next-turn 적용·설정 드롭다운은 유지합니다. 구독 제외 managed OpenAI/API 경로는 변경하지 않습니다. 제품 공통 정책이며 실제 검증 대상은 Windows x64; 다른 OS, 실계정, 설치된 앱은 미검증입니다.

접근: protocol 정책과 core admission에 auth route를 전달(기존 model_policy 담당), UI preview와 화면 검증·문서·통합(root). 공통 계약은 subscription=true && OpenAI && !managed, baseline=실제 context, default=min(300K,safe). UI는 전달된 no-surcharge 정책으로 동일한 정확 토큰 기본값을 표시·저장합니다. 새 의존성 없음.

근거: 현재 resolver에서 subscription은 pricing display에만 쓰이고 baseline은 API로 고정됩니다. 공식 문서 https://learn.chatgpt.com/docs/pricing 및 API 모델 페이지를 조회했지만 전체 구독 모델의 무할증은 아직 명시적 근거를 얻지 못했습니다. 사용자 요청의 제품 정책으로 적용하며 모든 계정 실제 과금의 검증으로 보고하지 않습니다.

완료 기준: subscription1M/400K/작은모델·API 분리, safe cap, 명시 override/reset를 정책 테스트. UI percentage와 exact300K default save/reset 및 light/dark 화면 확인. feature inventory 소유자 연결. 전체 빌드·설치·live updated-engine RPC 제외.
검증: Windows x64 final immutable V2 protocol10/10 exit0, initial frozen models-manager6/6 exit0(최종 api/ guard는 auth-free false 경로에 영향 없음). 최종 UI source15/15 exit0, inventory13/13 exit0, pinned renderer31검사 exit0(light/dark/narrow). 현재 engine 소스6파일 최종 immutable hash일치. 다운시프트 구독 resolver 블록 재통합·syntax parse exit0. core 전체 타입 컴파일·실계정·updated-engine RPC·전체 빌드·설치·다른 OS는 수행하지 않음.

근거·정리: artifacts/logs/openai-subscription-compaction(최종 입력 대조, source-tests-final.log, inventory-tests.log, ui/summary.json·화면·cleanup-result.json, commit-result.json), artifacts/logs/openai-subscription-context-20261013(native result.json·logs·input manifests). 브라우저 fixture/profile 및 engine snapshot2개 제거, shared Cargo cache 보존. 이 작업 파일과 turn.rs·inventory의 관련 hunk만 분리 커밋하며 다른 작업의 변경은 보존합니다.
