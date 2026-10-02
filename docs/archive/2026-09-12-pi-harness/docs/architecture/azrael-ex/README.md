# azrael-ex 설계

이 디렉터리의 열 문서가 VS Code extension의 규범적 설계 집합이다.

## 문서

- [2단계 전체 설계](azrael-ex-two-phase-system-design.md): 제품 경계, Pi runtime 연동, process model, 소유권, 권한, 복구와 후속 Electron 단계의 관계
- [다중 세션 백그라운드 런타임](multi-session-background-runtime-design.md): session별 Pi Host, panel attach/detach, 동시 실행 budget, mutation lease와 background permission/recovery 계약
- [세션 Writer 소유권과 전환](session-writer-ownership-design.md): profile-scoped Session Broker, read-only open, 단일 Pi writer와 idle session writer 전환, observer 전원형 control 계약
- [Codex형 세션 관리 UI](session-management-ui-design.md): header의 세션 작업·최근 세션·계정·새 세션 control, rename/deeplink와 running indicator 계약
- [세션 Draft와 Command Queue](session-draft-and-command-queue-design.md): session별 durable draft, prompt/compaction FIFO queue, Steer·삭제·Edit message와 자동 dispatch 계약
- [모델 응답 지점 새 세션 Fork](model-response-session-fork-design.md): 응답 footer 진입점, compaction 이전 지점 지원, 원본 불변 clone과 restart/hibernate 복구 계약
- [모델·Reasoning·Speed 캐스케이딩 메뉴](model-reasoning-speed-menu-design.md): Composer 우측 하단의 OpenAI 모델, 모델별 reasoning effort와 Standard/Fast 선택 계약
- [ChatGPT OAuth·Pi·reference UX 설계](azrael-ex-chatgpt-oauth-pi-reference-design.md): extension 전역 `AuthCoordinator`, 구독 기반 `openai-codex` 인증, credential broker와 Codex 공개 계약을 Pi session 및 azrael-ex UI에 옮기는 규칙
- [UI/UX 디자인 지침](azrael-ex-ui-ux-design-guidelines.md): Webview visual system, interaction, accessibility와 golden-reference gate
- [안정성 및 품질 계약](azrael-ex-stability-quality-contract.md): delivery semantics, failure isolation, draft·queue·scroll 복구, budget과 release blocker

## 상태와 권위

Pi Harness Workbench 문서는 역사적 설계 입력일 뿐이며, 이 디렉터리에 다시 명시한 동작만 azrael-ex가 채택한다. UI PoC는 구현되었고 live Pi workspace 실행과 사용 권한이 확인된 lossless golden reference는 아직 1차 release의 미완료 작업이다.
