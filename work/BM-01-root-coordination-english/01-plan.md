상태: 완료 — 영어 번역과 Windows 소스·provider 검사가 통과했다. 빌드·설치는 수행하지 않았다.

## 목표와 범위

사용자가 지목한 root 조율 지침을 한국어에서 영어로 번역한다. 현재 엔진 원본 `engine/codex-rs/prompts/src/root_coordination_instructions.rs`의 본문만 수정한다. 역할, 태그, 주입 조건과 모든 요구사항은 유지한다. 다른 스킬·AGENTS 지침의 번역, 빌드·설치·배포는 범위 밖이다.

공통 요구: Windows x64, Linux x64, macOS ARM64가 공유하는 프롬프트 문자열이며 플랫폼 분기는 없다. 실제 검증은 Windows에서 소스 비교와 provider 매핑 검사로 수행하며 다른 OS 실행이나 설치본 반영을 주장하지 않는다.

## 실행과 검증

root가 원문 전체를 번역한 뒤 절·항목 대응과 의미 보존, 한글 잔존 여부, 문자열 밖 코드 불변을 확인한다. 기존 공통 지침 검사를 실행하고 변경된 실제 본문의 provider 전달을 확인한다. 기존 staged/unstaged 작업은 보존하며 이번 파일과 작업 계획만 커밋한다. 문서화된 동작·책임 계약이 유지되므로 아키텍처 문서와 기능 목록 변경은 필요하지 않다. 지침은 네이티브 프롬프트 구현이 소유하므로 `instructions/`에 중복 사본을 만들지 않는다.

## 결과

- 원문의 8개 절·29개 항목을 일대일로 번역하고 요구사항의 의미를 검토했다. 본문의 한글이 제거됐고 본문 밖 Rust 코드가 HEAD와 동일함을 확인했다. 이번 작업 전 대상 파일에는 기존 수정이 없었다.
- Windows PowerShell에서 `node --test scripts/test-common-agent-instructions.cjs`: 5개 통과, 종료 코드 0. 로그: [common-agent-instructions.log](common-agent-instructions.log).
- 일회성 Node 소스 대조 및 실제 변경 본문을 사용한 Devin/OpenCodex `compileRequest` 검사: 두 provider 모두 developer fragment 전체를 정확히 유지, 종료 코드 0. 절·항목 수, 한글 부재, 본문 밖 코드 불변 검사도 통과. 로그: [translation-verification.log](translation-verification.log).
- 로그는 이번 번역의 검증 근거로 작업 폴더에 보존한다. 임시 계획 입력 파일은 일반 삭제 후 부재를 확인했다. 실행 스크립트·빌드·캐시를 생성하지 않았다.
- 문구 번역만 수행했으므로 Rust 컴파일·네이티브 회귀·실제 모델 행동 평가는 수행하지 않았다. 실행 중인 앱과 설치본에는 아직 반영되지 않았으며 빌드·설치 후 적용된다.
