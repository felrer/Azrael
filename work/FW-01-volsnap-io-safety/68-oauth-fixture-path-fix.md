# OAuth 검사 임시 경로 단축

## 변경과 범위

- Windows x64 빌드의 `engine.model-harness-profiles.oauth-identity` 검사에서 SQLite `BEGIN IMMEDIATE`가 `SQLITE_CANTOPEN`으로 실패했다. 기존 실행 경로를 기준으로 계산한 journal 경로는 267자였으나, 오류에 실제 DB 경로가 없어 길이가 유일한 원인이라고 단정하지 않는다.
- `scripts/check-anthropic-oauth-identity.cjs`가 기존 `beginArtifactRun`의 `runId` 옵션을 사용하도록 변경했다. `oauth-`와 하이픈 없는 UUID를 사용하며 owner, 작업 경계, 네 개 Bun 검사, 종료 및 정리 절차는 유지한다.
- 기존 미커밋 검사 실행기는 이 빌드의 필수 선행 파일이므로 이 단일 파일을 함께 커밋한다. 다른 provider 구현은 포함하지 않는다. 앱의 OAuth 동작이나 검사 기준을 변경하지 않았다.

## 실제 검증

- 후보 SHA256: `d4f917d4888bf66c91f7121569f0d17e47393d37c709fb9487dba40375729e66`.
- 원본 SHA256: `844ea8b15ebf94abdc3f59d306ea0661dddb02de612dd97929585828bf57e524`.
- 원 고정 입력에 위 한 파일만 반영한 정식 derived 입력을 사용했다. manifest SHA256 `53f0722258efc1144ae105e93c8e050ce25be77de6cec435f598b36ac8da1c59`, project SHA256 `ea3049bac44130d34adbbb424ca98a43438cb8972d58564bbb8dc8894b02c1f0`.
- 소비자 무결성 검사 exit 0. 동일 네 파일에서 Bun 1.4.2 실제 37 pass, 0 fail, 284 expects. Node PID 30508, 실행 2026-11-06T15:20:10.727Z~15:20:31.306Z, 실제 exit 0/signal null(session52314, chunk90665b).
- 기존 실패는 11 pass/26 fail로 보존한다. 제품 빌드나 최종 설치 성공의 근거로 대신 사용하지 않는다.
- 원자료는 `artifacts/tasks/fw04/runs/oauth-identity-20261107-01`의 reports와 logs에 있으며 빌드 인계에 필요한 동안 보호하고 사용 종료 후 정리한다. 기존 네 파일 검사를 재사용했고 새 영구 검사는 추가하지 않았다.
