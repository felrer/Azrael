상태: 소스 구현과 범위 검증 완료. 현재 설치본 적용에는 별도 빌드·설치가 필요함.

# 사진 위 스케치

사용자가 요청한 결과는 채팅 사진 확대 화면에서 기존 스케치 기능으로 사진 위에 그리는 것이다. 소스 수정과 필요한 검증을 승인받았으며 전체 제품 빌드·설치·배포는 범위 밖이다. 원본 사진을 보존하고 결과를 새 PNG 첨부로 만든다.

요구사항은 공통 웹 UI 동작이다. Windows x64, Linux x64, macOS ARM64에 같은 의미를 적용하며 실제 검증은 Windows에서 수행했다. 다른 OS, 전체 composer 및 설치본 수용은 별도다. 기존 이미지 편집, 확대·이동·다운로드·닫기와 빈 스케치 작성을 보존한다.

## 구현과 소유권

root가 구현·통합·검증을 담당했다. 읽기 전용 조사 담당자가 pinned 사진 확대·스케치 상태·저장 콜백을 조사했고 결과를 구현 선행 계약으로 사용했다. 기능 소유 문서는 [UI presentation](../../docs/architecture/ui-presentation.md#sketch-on-an-attached-image), 보존 항목은 `ui.image-sketch`다.

기존 라이브러리 조사 결과 native `SketchEditor`, `createSketchComposerState`, canvas fit 변환, `export({outputBounds,drawBackground})`, composer `File` 첨부 경로를 재사용한다. provider 이미지 편집 제출을 사용하는 `ImageMarkupEditor`는 PNG 첨부 계약과 맞지 않아 사용하지 않는다. 새 의존성이나 engine/host 권한을 추가하지 않았다.

`inject-image-sketch.cjs`는 여섯 pinned asset에 엄격한 변환을 적용한다. 입력창 사진 및 보낸 사진의 기존 확대 화면에 독립적인 그리기 버튼을 추가하며 두 overlay 경로를 연결한다. composer scope를 이벤트에 담아 해당 입력창만 요청을 수락한다. 이미지 로드 후 원래 크기의 논리 좌표와 투명 스케치 표면을 겹치고 native fit 변환을 사용한다. native export 크기 제한을 유지하면서 사진과 그림을 합친다. 저장 실패 시 기존 그림이 남고 재편집 시 배경을 유지한다. preview 닫기·이미지 전환·unmount·composer 변경으로 오래된 요청을 취소한다.

namespace 준비, 변환 캐시 키·편집 횟수, 필수 owner 확인과 보존 inventory에 연결했다. 기존 staged/unstaged 변경이 많아 시작 시 기준본을 기록했고 이 작업의 차이만 별도 index로 커밋한다. worktree는 사용하지 않았다.

## 검증 결과

- `node --test scripts/test-image-sketch.cjs`: 5/5, exit 0, 약 33초. 여섯 변환의 구문·재적용·손상 거부, 전체 namespace pipeline, native state의 배경 합성/재편집/일반 스케치 보존, export 실패 복구, composer scope·취소를 검사했다. 최종 변경 후 아래 묶음에서 다시 통과했다.
- `node --test scripts/test-asset-transform-cache.cjs scripts/test-namespace-cache-owner.cjs scripts/test-ui-cleanup.cjs`: 26개 중 25개 통과, exit 1, 약 147초. 캐시 파일 identity 모의 변경에서 실패했다. Windows의 큰 `ino` 값은 안전 정수 범위를 넘을 수 있어 `ino + 1`이 원래 값과 같을 수 있었다. 검사 의도를 유지하면서 항상 다른 숫자를 쓰도록 해당 fixture만 수정했다.
- `node --test scripts/test-image-sketch.cjs scripts/test-namespace-cache-owner.cjs`: 최종 12/12, exit 0, 약 34초. 수정한 identity 검사와 새 기능을 포함한다. 앞 묶음의 영향받지 않은 19개 통과 결과를 재사용하여 총 31개의 관련 검사를 확인했다.
- feature inventory/rule 검증 및 `node --check scripts/image-sketch-render-fixture.mjs`: exit 0.
- Windows Chrome의 pinned React/CSS fixture에서 밝은/어두운 테마의 사진 위 펜 그리기, Undo/Redo, PNG 첨부를 확인했다. 사진과 선이 합성된 결과는 800×500이며 배경색과 비율을 유지했다. 빈 스케치에는 배경 이미지가 없고 사진 확대는 100%→110%로 동작했다. 최종 소스로 밝은 테마의 그리기→첨부를 재확인했으며 해당 URL의 브라우저 오류는 없었다.

검사 실행 UTC: 최초 기능 09:52:40–09:53:13, 관련 회귀 09:54:42–09:57:10, 수정 후 최종 09:59:17–09:59:51 (2026-10-15). 회귀 실패 진단 뒤 영향받은 묶음만 재실행했다.

렌더 fixture는 실제 native Lightbox, SketchEditor, canvas, composer state/host를 사용한다. 앱 scope가 없는 fixture의 UI scale=1 및 reduced-motion=true, locale, 첨부 저장소 경계만 고정했다. 전체 composer와 실제 host 업로드, 새 overlay의 전체 런타임 경로, packaging 및 설치본을 검증했다고 주장하지 않는다. 최종 preview 취소 guard는 source/state 검증 대상이며 그리기 렌더를 바꾸지 않았다.

## 증거와 재실행

로그: `artifacts/tasks/BN-01-image-sketch/runs/source/{tests,regression,cache-identity-rerun,cache-identity-diagnostic,final-tests}.log`.
화면: `artifacts/tasks/BN-01-image-sketch/runs/render/{light,dark,result}.png`, 최종 소스 화면 `artifacts/tasks/BN-01-image-sketch/runs/final/light.png`.

`node scripts/image-sketch-render-fixture.mjs --run-id <새 ID>`로 loopback 검증 URL을 연다. Preview photo → Sketch on image → 그리기 → Attach sketch를 확인한다. Dark theme과 New sketch로 보존 흐름을 확인한다. 각 run은 생성 전 lifecycle을 등록하고 다른 실행 경로를 덮어쓰지 않는다. 서버 종료 후 임시 HTML/JS와 불필요한 산출물을 정리한다.

## 정리와 한계

검증용 브라우저 탭을 닫고 이 작업의 서버를 종료했다. 서버는 Windows `Stop-Process`로 의도적으로 종료되어 producer exit 1을 관측했으며 제품/검사 실패로 계산하지 않는다. 작은 로그·화면·서버 식별 영수증은 검증 증거로 보존한다. 임시 기준본·진단 helper·HTML/JS를 일반 삭제하고 실제 부재를 확인했다. 커밋용 별도 index·patch는 커밋 직후 같은 절차로 정리한다. 공유 cache와 사용자 데이터는 정리 대상으로 삼지 않는다.

추가 제품 빌드·설치는 요청되지 않았다. 실행 중인 앱은 이 소스 변경을 아직 포함하지 않는다.
