상태: 완료 — 구현·검증·정리를 마쳤으며 실사용 서버와 검증한 정적 번들을 유지한다.

# 스케치 보드

사용자가 그림·화면 캡처·화살표·메모로 요구사항을 전달하고, 저장된 결과와 해석 지침을 에이전트가 함께 읽는다. Excalidraw 편집기 재사용 후 실사용·실측을 먼저 수행하며 소스 포크와 엔진 기능 제거는 범위 밖이다.

## 범위와 설계 차이

- 기존 계약: docs/boards/README.md의 작은 로컬 프로그램, 파일 저장·백업·충돌 방지·고정 전달본. 기존 요구사항 보드와 데이터는 보존한다.
- 승인된 차이: 별도 `sketch` 보드에 React/Excalidraw와 정적 번들 빌드를 추가한다. 실행 시 로컬 코드·글꼴만 사용한다. 서버·저장 모듈을 복사하지 않고 보드별 데이터 검증/전달 어댑터를 연결한다.
- 그림 원본의 요소·이미지·좌표를 저장 기준으로 삼는다. 요소 ID의 `customData.board`에 분류·메모를 연결한다. 근접 배치·색상만으로 의도를 추론하지 않는다.
- 수동 저장과 저장 버전·위치 확인을 유지한다. 전달은 저장 버전에서 선택한 도형과 필수 연결 요소·이미지·PNG 미리보기·지침을 고정한다.
- 제한: 요소 2000개, 문서 JSON 16 MiB, 개별 raster 이미지 4 MiB/합계 8 MiB. 요청 32 MiB. 초과·지원하지 않는 입력은 오류로 표시하고 편집본을 유지한다.
- 기본 도구·undo/redo·확대/축소·이미지 입력을 제공한다. 공식 설정과 메뉴 교체로 서비스/중복 저장 UI를 줄인다. 패키지 코드 제거와 임의의 모든 도구 숨김은 수용 조건으로 주장하지 않는다.

## 환경과 권한

공통: 로컬 Node/현대 브라우저, 기존 의도 대상 Windows x64·Linux x64·macOS ARM64. 이번 실제 수용은 Windows x64/Chrome/Node에 한정하며 Linux/macOS는 미검증으로 표시한다. 원격 공유·Azrael 내장·확장 설치·전체 앱 빌드·push/게시·사용자 데이터 이동은 제외한다. 별도 보드이므로 Azrael 호스트/엔진의 기능 보존 목록은 변경하지 않는다.

## 담당과 실행

- root: 공통 서버·저장 경계, 스케치 검증/전달 어댑터, 회귀·브라우저 검사, 담당 README/통합/정리/커밋.
- /root/sketch_ui: sketch app.jsx/CSS/index/package/lock/build 전용. 입력 계약 확정 후 UI와 의존성 준비를 병행한다. 빌드 고정 입력과 산출물 경로·해시·종료 코드를 인계한다.
- build 산출물은 artifacts/boards/sketch/<입력해시>/public, current.json은 완료된 산출물만 선택한다. 서버는 시작 시 선택을 고정한다. 임시 소스 snapshot은 검증 후 정리하고 실사용 번들은 보존한다.

## 수용 기준

1. 실제 편집기에서 글자·도형·화살표·이미지를 만들고 이동하며 undo/redo가 동작한다: Chrome 실제 조작.
2. 한글 메모·분류와 그림·이미지의 저장/재시작 복구가 일치한다: HTTP/파일 검사와 실제 reload.
3. 충돌/잘못된 이미지/불가능한 위치의 저장 실패가 원본과 편집본을 보존한다: 오류·기존 백업/복구 회귀.
4. 선택한 그림·연결 요소·이미지·지침의 전달본이 이후 변경에도 유지된다: 해시·PNG·파일 검사.
5. 밝은/어두운/좁은 화면을 실제 렌더링해 읽기·편집·오류 상태를 확인한다.
6. 서버가 외부 서비스나 로컬 비공개 소스를 제공하지 않는다. 화면과 PNG는 로컬 코드·글꼴로 동작하며 패키지의 외부 글꼴 대체 주소는 CSP로 차단되어 외부 응답을 받지 않는다.
7. 실제 번들 raw/gzip 크기, 첫 준비 시간, 렌더링/메모리를 가능한 범위에서 측정한다. 측정 조건을 적고 엔진 경량화 성과로 과장하지 않는다.
8. 필요 검증 종료 코드/로그/미검증 범위와 fixture 정리를 기록하고 소유 변경만 커밋한 뒤 실사용 URL을 제공한다.

## 진행과 근거

조사: Excalidraw npm 0.18.1, React18.3.1 지원, esbuild0.28.2 확인. 기존 저장/서버/Chrome CDP 검증을 재사용한다. 공식 문서의 UIOptions는 메뉴 액션과 image 도구 표시를 제공하며 코드 제거 보장은 없다.

- `node --test docs/boards/tests/sketch.test.mjs docs/boards/tests/boards.test.mjs`: 18개 통과, exit 0. 한글/그림/이미지 재시작 복구, 연결 요소 전달, PNG/지침 해시, 삭제한 미지원 도형의 저장 복구와 기존 보드 회귀를 확인했다. 로그: `artifacts/logs/board-sketch/backend-tests.log`.
- 기존 보드 실제 화면 회귀: 29개 통과, exit 0. 로그: `artifacts/logs/board-sketch/prototype-regression.log`; Chrome 종료 exit 0.
- `node docs/boards/tests/sketch-render.mjs`: 최종 번들에서 실제 화면 31개 통과, exit 0. 그리기·한글 메모/분류·이미지·undo/redo·재열기·PNG 전달·저장 충돌·폐기 취소/확인·백업 복원·한글 저장 위치 변경을 확인했다. 밝은/어두운 화면 및 390px 화면에서 모든 도구의 표시와 마지막 추가 도구의 실제 클릭도 확인했다. Chrome PID 38620 정상 종료, exit 0. 로그/화면: `artifacts/logs/board-sketch/render.log`, `render-summary.json`, `light.png`, `dark.png`, `narrow-dark.png`, `error.png`.
- 통합 검사에서 초기 React 반복 갱신, 상대 글꼴 경로, 재열기 후 내부 캐시 변경의 미저장 오인, 좁은 화면 toolbar 잘림을 수정했다. 콘텐츠 비교·절대 로컬 글꼴 경로·native toolbar 부모의 좁은 화면 배치로 해결했다. 수정된 입력은 다시 고정 빌드하고 관련 실제 화면 검사를 재실행했다. 변경 영향이 없는 백엔드/기존 보드 회귀 결과는 재사용했다. 빌드마다 시작/생성 시각·npm 종료 코드·입력 해시를 해당 `build-info.json`과 npm 로그에 보관했다.
- 최종 입력 해시: `6d7ed2ea0f2dea15d0e9593c9146f646a2604567b5c879fe6bae2ad0df6268a5`. npm ci/build exit 0. `artifacts/logs/board-sketch/final-identity.json`에서 소스 입력 31개, 로컬 문서 링크 9개와 검사 산출물 동일성을 확인했다. 8개 모듈 구문 검사 exit 0; 최종 변경한 브라우저 검사 파일도 다시 확인했다.
- 자체 작성 파일의 staged diff whitespace 검사 exit 0. 외부 라이선스 고지는 출처와 입력 해시를 보존하기 위해 원문의 trailing whitespace를 유지하며 이 검사에서 제외했다. 코드의 추가 빈 EOF 줄은 제거했고 해당 모듈 구문 검사를 다시 확인했다.
- 실행 검증: `http://127.0.0.1:4319/`, 관리 세션 91390. 화면/API/JS/모델 HTTP 200 및 실제 제공 자산과 검증한 번들의 동일성을 확인했다. `artifacts/logs/board-sketch/user-server-receipt.json`. 기본 저장은 `artifacts/board-data/sketch`, 설정은 `artifacts/board-storage/sketch.json`이며 테스트 자료를 넣지 않았다. 이 서버와 현재 정적 번들은 실사용 입력으로 남긴다.
- 정리: 고정 소스 snapshot 9개와 오래된 public 번들 8개, root 검사 fixture 4종을 삭제하고 부재를 확인했다. toolbar probe도 Chrome/서버 종료 후 fixture를 삭제했다. ordinary deletion과 프로젝트 guarded cleaner를 사용했으며 현재 번들·사용자 데이터·소스 의존성 캐시·간결한 로그/화면/출처 영수증은 보존했다. `artifacts/logs/board-sketch/build-cleanup.json`, `cleanup-*.json`, `artifacts/logs/sketch-toolbar-debug/layout.json`. 임시 계획 본문과 실행 helper도 제거한다. 작업 소유 `docs/boards`와 이 계획만 커밋하며 다른 변경은 포함하지 않는다.
- 외부 폰트 대체 주소 460건은 모두 CSP 차단, 외부 응답 0건. 차단된 주소 기록은 요청 이벤트에 나타나므로 외부 주소 기록 자체가 없다고 주장하지 않는다. 로컬 한글 표시와 이미지 포함 PNG 출력은 실제로 통과했다.
- 라이선스와 글꼴 고지 입력은 pinned upstream/실제 포함 글꼴의 메타데이터에서 확보해 URL·내용 해시를 고정했다. 과거 Liberation 바이너리의 정확한 원본 릴리스 대응은 미검증이며 현재 포함된 파일은 변경하지 않는다.

## 실측과 한계

최종 화면 검사 UTC `2026-10-12T20:14:09`~`20:14:13`. Windows x64, Node 26.7.0, Chrome, 새 headless profile, 로컬 HTTP, 1440×1000/390×844 화면과 작은 합성 그림·240×160 이미지의 1회 측정이다. 다른 OS·브라우저·대규모 그림은 검증하지 않았다. 보장된 지연이나 전체 브라우저 메모리의 측정은 아니다.

- 첫 canvas 준비 355 ms, 글꼴 준비 412 ms, 초기 로딩 자료 1,544,891 bytes (약 1.47 MiB).
- 전체 JS raw 8,366,040 bytes, 파일별 gzip 합계 2,639,380 bytes. gzip은 비교를 위한 계산값이며 현재 서버는 압축 전송하지 않는다.
- CSS raw 155,267 bytes, 보관한 전체 font 자산 13,188,212 bytes. 모든 자산을 첫 화면에서 읽지는 않는다.
- 전체 흐름 후 강제 GC의 JS heap 6,734,484 bytes. Chrome/native canvas/font 메모리와 프로세스 RSS는 포함하지 않는다.

편집기는 패키지 그대로 재사용하며 UI 숨김이 엔진 코드 제거·경량화 성과를 뜻하지 않는다. 엔진 포크 여부는 이 결과와 실사용 피드백을 바탕으로 후속 결정한다.
