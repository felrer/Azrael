# Build artifacts

이 디렉터리는 저장소 최상위에 흩어져 있던 재생성 가능한 빌드·패키지·임시 산출물을 모은다.
소스나 규범적 문서를 두지 않으며, 내용은 버전 관리 대상이 아니다.

현재 `pi-harness/` 아래에는 2026-09-03에 이동한 기존 Electron 구현의 산출물이 원래 이름으로
보존되어 있다.

- `.webpack/`: Electron Forge Webpack 중간 산출물
- `dist/`: 별도 bundle 산출물
- `out/`: 최근 package/make 산출물
- `out-draft-fix/`, `out-stage7*`: 과거 검증 package
- `tmp/`: 문서 preview 등 일시 산출물

기존 Pi Harness의 build 설정 자체는 변경하지 않았다. 해당 구현을 다시 build하면 Forge가
최상위 `.webpack/` 또는 `out/`을 재생성할 수 있으므로, 필요할 때 이 디렉터리로 다시 정리한다.
새 `azrael-ex-b` 구현의 build layout은 별도 구현 계획에서 이 경계를 따르도록 정한다.
