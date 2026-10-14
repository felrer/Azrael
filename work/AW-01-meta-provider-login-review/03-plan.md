상태: 완료 — Muse Wonder 소스 경로·fixture 검증 완료. 실제 서버 호출·앱 빌드·설치는 미검증.

# Muse Wonder 추론 경로

Meta 경로의 후속 작업으로 `muse-wonder-1.0`을 모델 목록과 Responses 추론에 추가한다. 기존 로그인·계정 고정·도구·private replay 계약을 재사용한다. 공식 https://dev.meta.ai/docs/models 및 /docs/reasoning 에서 동일 endpoint/요청 형식, 1,048,576 context, minimal/low/medium/high/xhigh/max를 확인했다. Wonder Full과 Wonder Contributor는 공식 Model API 모델로 노출하지 않는다. Azrael 입력 지원은 기존 text/image 범위다.

Windows x64/Linux x64/macOS ARM64 공통 제품 로직 변경이며 실제 검증은 Windows fixture다. vendor 출처·manifest의 다른 진행 중인 변경을 보존하고 Azrael 소유 metadata 확장으로 새 모델을 catalog와 pin 양쪽에 일관되게 적용한다. root가 직접 구현한다. 모델 기본값과 기존 Spark 메타데이터는 유지한다. 실제 인증·유료 서버 호출·빌드·설치·게시 권한은 이번 요청 범위에 포함하지 않는다.

성공 기준은 catalog에 정확한 Wonder ID/context/입력/effort가 표시되고, minimal 및 max가 wire에 그대로 전달되며, 기존 도구·추론 재사용이 Wonder에서도 동작하는 것이다. 기존 Meta fixture 전체, 관련 모델 목록 회귀, 새 metadata 타입 검사를 실행한다. 소유 설계와 보존 항목을 갱신하고 이번 변경만 작업별 커밋한다.

## 결과·검증 (2026-10-14)

`inference-config.ts`의 `managedMetaRegistry`에서 vendor 메타데이터를 확장하고 catalog와 resolvePin에서 함께 사용한다. 기존 Spark 기본값과 metadata는 유지하며 `muse-wonder-1.0`을 추가한다. 소유 설계와 `engine.meta-provider` 보존 항목을 갱신했다.

Windows에서 `node scripts/check-meta-provider.cjs`가 22 tests/130 assertions, exit 0으로 통과했다(15.63초, `artifacts/logs/meta-provider/wonder-tests.log`). Wonder의 minimal/max wire, 이미지 입력, 함수/custom/namespace/client-search 도구와 encrypted reasoning replay를 검사했다. catalog/reasoning 회귀는 15 tests/76 assertions, exit 0(`wonder-regressions.log`), feature preservation은 13 tests, exit 0(`wonder-preservation.log`)이다. `tsc --noEmit --strict --module preserve --moduleResolution bundler --target es2023 --skipLibCheck --types bun --allowImportingTsExtensions inference-config.ts`가 exit 0(`wonder-typecheck-strict.log`)으로 통과했다. 초기 noImplicitAny false 옵션은 vendor의 빈 배열에 never 추론 오류를 유발했으나 표준 strict 설정에서는 통과했다. registry의 존재하는 models에 대한 타입 명시 외 runtime 입력 변경은 마지막 테스트 이후 없다.

실제 Meta 계정 권한과 서버 모델 응답은 검증하지 않았다. 전체 빌드·설치·다른 OS도 미검증이다. 임시 계획 body는 삭제했으며 테스트는 각 격리 계정 fixture를 정리한다. 이번 task의 코드와 문서만 커밋하고 다른 진행 중인 변경은 보존한다.
