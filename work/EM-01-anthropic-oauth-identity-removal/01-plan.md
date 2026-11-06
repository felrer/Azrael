상태: 소스 수정 및 focused 검증 완료 — upstream 필수 검증 도구 누락으로 커밋은 보류. 설치본 적용과 live 호출은 범위 밖입니다.

# Anthropic OAuth 식별 문장 제거

## 범위와 권한
- 요청: `You are a Claude agent, built on Anthropic's Claude Agent SDK.`를 전송 프롬프트에서 제거.
- 공통 TypeScript provider 동작: Windows x64, Linux x64, macOS ARM64에 동일 적용. 실제 검증은 Windows x64의 pinned Bun으로 수행.
- 일반 대화, 호환 프로필, 같은 상수를 사용하는 웹 검색·이미지 설명 요청이 대상.
- 기존 OAuth 토큰·헤더, 도구 변환, native 지침 순서, 캐시 제어와 도구 실행 권한은 보존.
- 설치·패키징·실계정 호출은 범위 밖. 다른 작업의 변경은 보존.

## 구현과 검증
1. adapter/sidecar의 문구 및 상수 제거; 호환 프로필 변환의 prefix 전제 제거.
2. 기존 wire 테스트에서 문구 부재, native root 지침 보존, 빈 system 입력 및 캐시 경계를 확인.
3. vendor manifest와 provenance, 관련 architecture, 기존 feature inventory 연결을 갱신.
4. Windows focused Bun 테스트, 공통 매핑 테스트, vendor 무결성 검사. vendored upstream 검증 스크립트/구조 문서는 import에 없으면 그 제한을 명시.
5. 변경 diff 확인 후 이 작업만 커밋. 생성 임시 자료는 사용 종료 시 삭제.

## 확인된 제약
- 원본 `vendor/structure/INDEX.md`, `docs-site/`, upstream test/typecheck/privacy 스크립트는 현재 vendor import에 포함되지 않음. 로컬 Azrael 문서와 focused checks 사용.
- 현재 설치본과 live OAuth 수락 여부, Linux/macOS 실행은 미검증.

## 결과와 검증 증거
- 일반 대화·Claude 호환 프로필·웹 검색·이미지 설명에서 SDK 식별 문장과 상수 제거. 빈 system 입력을 허용하면서 비어 있지 않은 native 지침의 보존 검증 유지.
- 기존 이미지 테스트의 강제 삭제를 일반 삭제로 바꾸고 종료 후 root 변수를 비워 중복 정리 시 없는 경로를 삭제하지 않도록 수정.
- vendor 5개 파일의 실제 해시, canonical digest, guard 및 UPSTREAM 기록 갱신. 원래 Windows review digest는 baseline provenance로 보존.
- `engine.model-harness-profiles`에 request-boundary 보존 검사를 연결. 기존 다른 작업의 feature inventory 변경은 유지.
- Windows x64 / pinned Bun 1.4.2: `node scripts/check-anthropic-oauth-identity.cjs` → 31 pass, 0 fail, 260 assertions, exit 0, 20.38초. 일반·호환 프로필 지침/빈 입력, 캐시, 이미지, 도구 변환, sidecar 요청을 mock transport로 검증. 마지막 테스트의 reasoning 값을 해당 vision 타입에 맞게 `low`로 정정한 뒤 sidecar 1개만 재실행 → 1 pass, exit 0.
- `node --test scripts/test-common-agent-instructions.cjs providers/opencodex/tests/harness-mapping.test.mjs` → 10 pass, exit 0.
- `node --test --test-name-pattern 'reviewed vendor mapping' scripts/test-build-platform.cjs` → 1 pass, exit 0. 실제 전체 vendor 파일 해시와 manifest 일치, 변조 거부 확인.
- 첫 focused 실행에서는 빈 지침을 요구하던 wire guard와 강제 삭제 제거 후 stale root 중복 정리가 각각 실패. 두 원인을 수정하고 해당 31개 검사를 다시 실행해 모두 통과.
- `git diff --check` scoped 검사 exit 0. feature check 등록/owner 존재 및 전송 소스에 식별 상수·문장 부재 확인.
- `bun run typecheck` → exit 1: import에 `tsconfig.json`이 없어 compiler 도움말만 출력, 타입 검사 미실행.
- `bun run test:changed`, `bun run privacy:scan` → 각각 exit 1: `scripts/test.ts`, `scripts/privacy-scan.ts` 누락. upstream mandatory 명령을 통과했다고 주장하지 않으며 이 제약 때문에 작업 커밋은 보류.
- 실계정 네트워크 호출·빌드·설치는 하지 않음. 변경된 요청이 live OAuth에서 수락되는지는 미검증.

## 정리
- 계획 생성용 임시 seed 파일은 할당 직후 일반 삭제 및 부재 확인.
- 테스트의 임시 계정·설정은 각 테스트 소유 `afterEach`에서 일반 삭제. 확인한 fixture/image 경로의 실제 부재 확인.
- 별도 빌드, 백업, 패키지, 원시 로그 파일은 생성하지 않음. 유지 자료는 변경 소스·테스트·provenance와 이 작업 기록뿐입니다.
