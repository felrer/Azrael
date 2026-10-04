# Azrael 실행기와 provider 연결

상태: `target`. 승인된 [작업 계획](<G:/내 드라이브/ObsidianVault/PARA/30 Project/pi-harness/Tasks/Task2/AZ-01-codex-runtime-decoupling/01-plan.md>)의 구현 기준이다. 아래 동작은 해당 검증을 통과하기 전까지 현재 제품의 동작으로 간주하지 않는다. 현재 구현은 [azrael-ex 호스트](azrael-ex.md), [계정](accounts.md), [Devin](devin.md), [관리형 provider](managed-providers.md) 문서가 설명한다.

## 제품 경계

Azrael은 VS Code 확장 하나로 채팅, 계정, 모델, 사용량, 진단 화면을 제공한다. 설치된 공식 Codex 확장 또는 별도 Codex 실행 파일을 채팅 backend로 활성화하지 않는다. Azrael이 자체 빌드한 하나의 실행기 인스턴스가 모든 provider의 대화 진행, 공통 지침, 도구와 권한, 세션 기록, 큐, 압축, 취소, 재개를 소유한다. 최신 공개 Codex 소스는 이 실행기를 발전시키는 기준으로 사용하며, 소스 버전과 실행 파일의 출처를 기록한다. 소스 갱신과 모델 목록 갱신은 서로 다른 작업이다.

실행기는 provider registry에서 명시적인 `(provider_id, model_id, account_ref)` 선택을 해석한다. OpenAI와 Claude는 이 registry의 구독 provider다. Devin도 같은 실행기 경계로 연결한다. 추가 provider는 구독 인증과 추론 계약을 확인한 뒤 등록한다. API key만 지원하는 기존 계정은 사용자 데이터로 보존하되 이 릴리스의 로그인·모델 선택·실행 경로에 노출하지 않는다. 자격증명을 임의로 삭제하거나 다른 계정으로 자동 전환하지 않는다.

Anthropic Claude는 첫 릴리스 필수 provider다. Azrael이 Claude.ai 구독 OAuth 로그인·갱신과 Anthropic Messages 변환을 직접 연결한다. Claude Code 실행 파일이나 별도 대화 loop를 시작하지 않는다. Claude에 전송하는 기본 지침과 대화 기록은 Azrael의 공통 snapshot에서 가져오며, 도구는 Anthropic 양식으로 선언하지만 실행·승인·결과 기록은 Azrael이 소유한다. OAuth 전송에 필요한 provider 고유의 식별 지침은 기본 지침을 대체하지 않고 adapter 경계에 한정한다. 이 경로는 [Anthropic의 인증·자격증명 정책](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use)이 지원하는 제3자 구독 통합이라고 주장하지 않는다. 사용자는 개인 사용에서 계정 제한 위험을 감수하고 이 경로를 선택했다. 실계정 인증과 도구 왕복을 확인하기 전에는 첫 릴리스가 완료됐다고 판단하지 않는다.

## 실행 요청과 책임

새 turn을 시작할 때 실행기는 선택 모델, 계정, endpoint와 credential 연속성, 공통 지침, 필요한 모델별 보정, 현재 공개 history, 도구 schema를 하나의 불변 요청 snapshot으로 묶는다. 실행 중 UI에서 다음 모델이나 계정을 바꿔도 그 turn의 선택과 도구 후속 요청은 바뀌지 않는다. adapter는 구독 인증, 모델 발견, provider 추론 통신과 응답 변환을 맡는다. 도구 실행·승인·세션 쓰기는 adapter가 수행하지 않는다. adapter 결과는 기존 공통 응답 stream으로 들어오고, 실행기는 완결된 도구 호출만 실행 대상으로 받아들인다.

Azrael의 `전체 액세스`는 provider와 무관하게 native thread에 `approvalPolicy: never`와 `danger-full-access` sandbox를 함께 지정한다. 새 대화·재개·provider 전환에서 실행기가 돌려준 유효 정책을 확인하고, 다음 turn의 설정 요청이 실패하면 해당 입력을 실행 큐에 넣지 않는다. 전체 액세스가 확인된 상태에서 Azrael이 시작한 turn의 명령·파일 변경·추가 권한 승인 요청은 자동 승인한다. 이전 정책에서 이미 실행 중이던 turn은 소급 승인하지 않는다. MCP의 정보 입력·외부 인증과 client가 직접 실행해야 하는 동적 도구 호출은 승인 응답으로 실행 성공을 위조하지 않는다.

원본 native rollout이 대화와 도구 호출·결과의 권위 있는 기록이다. Provider 간 전환에는 공개 메시지와 정확한 tool call/result ID를 투영하고, 이전 provider의 비공개 reasoning·서명·캐시는 다른 provider 또는 계정으로 보내지 않는다. 전달이 필요한 불투명 checkpoint는 원래 provider에서 안전한 요약을 만든 후 새 checkpoint로 추가한다. 요약 실패의 제한적 공개 투영 조건과 원본 보존은 [provider 전환 설계](managed-providers.md#history-projection-and-provider-handoff)를 따른다. 요청 투영 때문에 저장된 원본을 다시 쓰지 않는다.

큐의 메시지와 수동 압축은 [큐·압축 계약](queued-compaction.md)의 순서와 admission을 유지한다. 재시작과 중복 resume은 [복구 계약](reload-recovery.md)의 실행기 상태 확인과 결과 불명 보호를 유지한다. 공통 실행기 전환은 이 두 기능에 provider별 두 번째 소유자를 만들지 않는다.

## 구독 인증과 모델 목록

각 provider는 로그인 시작·완료, 만료·갱신, 상태와 로그아웃을 계정 범위로 제공한다. 자격증명은 기존 안전한 저장소와 단일 갱신 소유자를 사용하고, Webview·모델 descriptor·로그에는 토큰을 넣지 않는다. 여러 창에서 같은 계정의 갱신은 기존 프로세스 간 잠금으로 직렬화한다. OpenAI는 ChatGPT 구독 인증으로만 추론한다. 기존 API key 설정이나 환경변수가 선택한 구독 경로를 덮어쓰려 하면 명시적으로 실패한다. 로그인된 계정이 사라지거나 폐기되면 다른 계정으로 자동 전환하지 않는다.

모델 목록은 `provider_id + endpoint + account_ref + workspace + 실제 client contract` 범위로 캐시한다. 로그인 완료, 계정 변경, 수동 새로고침, 캐시 만료가 조회를 시작하며 모든 페이지를 수집한다. 항목은 opaque 모델 ID와 표시명, 확인된 입력·도구·reasoning 기능, 그 정보의 출처와 조회 시각을 가진다. 원격 목록의 새 모델 ID를 내장 목록과 교집합으로 제거하지 않는다. 같은 실행 파일로 받은 새 모델이 기존 추론·도구 계약과 호환되면 선택하고 실행할 수 있어야 한다. 확인되지 않은 기능을 모델 이름으로 추측하거나 지원되지 않는 옵션을 전송하지 않는다. 새로운 wire contract가 필요하면 adapter 업데이트가 필요하다고 표시한다.

목록 상태는 `loading`, `fresh`, `stale`, `empty`, `error`를 구별한다. 실패 시 같은 범위의 마지막 성공 목록만 `stale`로 보여 주고 오류와 재시도 동작을 함께 제공한다. 성공한 빈 목록은 이전 항목을 현재 선택 가능 목록으로 유지하지 않는다. OpenAI 구독 목록을 API key용 공개 모델 목록으로 대체하지 않으며 실제 client version을 서버에 전달한다. 계정 사용 가능 여부, 목록 표시 여부, 실제 추론 성공은 각각 다른 상태다.

## 실패, 재시도와 재개

공통 오류에는 연결 실패, 스트림 단절, header/idle/deadline 초과, 인증 만료, 사용량 한도, rate limit, 지원하지 않는 입력·기능, provider protocol 오류, 사용자 취소와 도구 실패를 구별할 수 있는 종류를 둔다. Adapter는 원래 provider code와 안전한 HTTP/transport 진단을 보존하고 실행기는 동일한 오류 계약을 UI에 전달한다. 분류할 근거가 없는 오류는 `unknown`으로 남긴다. 오류 화면은 원인, 현재 turn의 보존 상태와 사용자가 취할 수 있는 다음 행동을 구분해 표시한다.

추론 재시도는 실행기 한 곳에서만 결정한다. 연결 또는 일시적인 서버 실패는 횟수·총 시간 상한과 지수 backoff 내에서만 재시도한다. 취소, 한도, 지원하지 않는 입력, 권한 거부와 결과가 불명확한 도구 호출은 자동 재실행하지 않는다. Adapter 내부와 UI의 중복 재시도는 제거한다. 불완전한 stream의 도구 인자는 실행기에 전달하지 않으며, 실행이 승인된 도구와 결과는 durable 기록을 갖는다. 종료 시점에 외부 부작용을 확인할 수 없는 도구는 `결과 확인 필요`로 남긴다. 외부 세계에 대한 정확히 한 번 실행을 보장하지 않는다.

실행기 tracing과 확장 host logger는 session/turn/attempt/tool-call ID, provider/model, 버전, 안전한 오류 코드와 재시도 결과를 이어 준다. 토큰, 인증 header, 원문 prompt·응답·도구 인자는 진단 로그에 쓰지 않는다. 로그 저장 실패는 실행 실패로 전파하지 않는다. 실제 배포 로그 위치·보존·내보내기는 운영 문서가 소유한다.

## VS Code 화면과 저장소 전환

확장 host는 검증된 공식 Codex 채팅 UI 자산을 버전 고정해 Azrael 패키지에 포함하고, VS Code Webview·사이드바 API로 제공한다. 채팅과 계정·사용량 화면은 같은 host-local 실행기 인스턴스와 typed app-server 계약을 사용한다. 모델 선택, 대화 stream, 도구 승인·결과, 큐·압축, 자식 agent 상태, 재개와 오류를 표시한다. 원본 bundle의 minified 함수명은 영구 계약으로 취급하지 않고, 버전별 변환과 실패 검사를 거친다. 현재 workspace의 최근 대화 필터는 기존 native `cwd` 범위를 유지한다.

기존 `~/.azrael-ex`는 전환 전 보존하고 복사한 상태에서 schema와 기능을 시험한다. Provider/model/account 참조는 전환 경계에서 정규화하며, 기록·계정·queued item·checkpoint·자식 세션의 연속성을 확인한 뒤에만 실제 사용자 상태로 적용한다. 실패하면 원본을 유지하고 적용을 중단한다. 되돌리기는 이전 실행 파일뿐 아니라 데이터 snapshot을 함께 복원한다. 공식 확장 복사와 injection 경로는 자체 화면·패키지 및 데이터 전환이 검증된 후 제거한다. 기존 Codex 설치와 `.codex` 상태는 건드리지 않는다.
