상태: 권장 해결안의 소스 수정·회귀/통합 검증·임시 실행 환경 정리 완료. 현재 설치본에 반영하려면 별도 제품 빌드·설치가 필요함.

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

최초 구현 작업에서는 추가 제품 빌드·설치를 수행하지 않았다. 이후 설치 상태는 아래 후속 조사에서 별도로 확인한다.

## 편집 버튼 무반응 조사

2026-10-17 요청은 보이는 편집 버튼이 눌러도 반응하지 않는 원인 분석과 해결안 제시였으며, 이어서 사용자가 권장안대로 수정을 요청했다. 공통 웹 UI의 연결 경로를 수정하고 Windows에서 검증한다. root는 injector·회귀 검사·문서·수용 검증을, 별도 구현 담당자는 기존 렌더 fixture의 실제 native composer 연결 보강을 맡는다. fixture가 준비되면 root가 브라우저에서 검증한다. 사용자 설정, 실행 중인 대화, 설치 파일은 변경하지 않는다.

현재 설치 경로 `C:/Users/felre/.vscode/extensions/azrael-ex-local.azrael-2026.0.8/webview/assets`의 관련 여섯 파일 모두 `azrael-image-sketch-v1` marker를 포함한다. 설치 누락이라는 설명은 이 확인과 맞지 않는다. 해당 VS Code 창의 메모리 로드 상태는 직접 관측하지 않았다.

설치본 `azraelUseImageSketchBridge`는 scope 불일치, `canOpen=false`, 요청 처리 중, 기존 활성 스케치 조건에서 즉시 반환한다. 수신기가 없을 때도 요청 함수는 `false`만 반환한다. 버튼 콜백은 이 반환값을 처리하지 않으므로 사용자에게 이유가 표시되지 않는다. 버튼 표시 조건은 수신 편집기의 가용성과 연결되어 있지 않다.

설치된 `app-initial-7a199c66e670.js`에서 두 helper를 추출해 Node VM에서 분리 실행했다(exit 0). 수신기 없음/열기 비활성/scope 불일치/기존 활성 상태 모두 `handled=false, opened=0, errors=0`; 준비된 수신기는 `handled=true, opened=1, errors=0`이었다. 이는 조용히 실패하는 경로의 재현이며, 사용자 창에서 어느 조건이 실제로 발생했는지의 실측은 아니다. 파일이나 실행 서버를 생성하지 않았다.

이전 렌더 fixture는 단일 scope와 `canOpenSketch=true`를 고정하고 native composer 생성 경계를 대신 연결했다. 그리기와 PNG 합성 검증은 유효하지만 실제 대화에서 버튼→composer 연결 성공의 근거로 확대할 수 없다.

### 확인한 연결 결함

첨부 컴포넌트 `En`의 `f(ut)`와 편집기 연결 컴포넌트 `cda`의 `Ou(Dh)`는 같은 native `BRt(Iv)`를 호출한다. 그러나 `BRt`는 컴포넌트별 `useRef` 안에 `{chain,node,scope,value,...}` 래퍼를 생성한다. 같은 provider node를 참조해도 두 컴포넌트의 래퍼는 서로 다른 객체다. `scripts/inject-image-sketch.cjs:42`의 `request.scope !== scope`는 정상적인 같은 대화 요청도 거부한다. 이미지 decode와 편집기 open 이전에 반환하므로 이미지 형식이나 canvas 그리기 코드보다 앞선 연결 결함이다.

설치본 `app-initial-97d3534ad35f.js`의 실제 `BRt` 선언을 추출하고 두 컴포넌트의 독립 ref 경계만 모의해 실행했다(exit 0). 같은 descriptor와 같은 node를 주어도 `sameDescriptor=true, sameNode=true, sameWrapper=false, bridgeRejects=true`였다. 따라서 scope 래퍼의 동일성 비교가 잘못됐다는 결론은 단순 추측을 넘어 소스와 분리 실행으로 뒷받침된다. 사용자 창에서 이 이벤트가 실제 어느 분기로 들어갔는지는 직접 trace하지 않았다.

native Codex `uda`는 `canOpenSketch=canSave&&!isSubmitting`을 전달한다. 별도의 응답 진행 상태는 이 식에 직접 포함되지 않는다. 화면의 작업 진행 표시만으로 열기 비활성 상태라고 단정하지 않는다. 수신기 부재나 제출 중 비활성도 별도 무반응 경로지만, 핵심 결함인 서로 다른 래퍼 비교와 구분한다.

### 권장 해결과 수용 기준

1. 래퍼 객체 대신 native scope의 안정적인 실제 identity를 사용해 요청을 연결한다. 같은 scope descriptor/node 및 대상 composer의 대화·host 소유권을 확인하고 기존 오래된 요청 취소 조건을 보존한다. 전역의 마지막 활성 입력창으로 보내는 방식은 사용하지 않는다. 기존 native sketch state/host와 첨부 저장 경로를 재사용하며 새 그림 라이브러리가 필요하지 않다.
2. 수신기 부재, 제출 중 비활성, 기존 편집 중 등 요청 거부 이유를 결과로 돌려주고 버튼의 가용 상태와 연결한다. 표시된 버튼을 누른 경우 준비/열림/실패 상태를 사용자에게 안내하며 반환값을 버리지 않는다.
3. 두 컴포넌트가 같은 node를 참조하지만 서로 다른 scope 래퍼를 받는 회귀 사례를 추가한다. 다른 대화·host·오래된 preview 요청은 여전히 거부해야 한다. 실제 전체 composer에서 입력 전/보낸 사진의 확대→그리기→PNG 첨부, 취소·Undo/Redo, 제출 중 상태와 오류를 검증한다. Windows 밝은/어두운 테마에서 실제 설치 패키지까지 확인하고 Linux/macOS 공통 UI 영향과 미검증 범위를 구분한다.

### 수정과 검증 결과

scope descriptor와 실제 provider node를 비교하도록 수정했다. 요청은 `opened`, `unavailable`, `busy`, `failed`, `cancelled` 중 하나로 완료되며, 기존 native toast service로 열기 진행과 거부·실패 이유를 한국어/영어로 안내한다. 수신기가 없을 때도 결과를 처리한다. composer effect 해제는 처리 중인 요청을 취소하고, native lazy loader의 실패·조건 변경은 완료 callback으로 전달한다. 빈 스케치의 기존 오류 안내는 보존한다.

이전 fixture의 수동 state/host 연결을 실제 변환된 native `cda` component, native `BRt` scope hook과 stable callback/compiler hook, 실제 `UPe` lazy loader로 교체했다. 두 React 컴포넌트가 같은 node를 참조하지만 서로 다른 wrapper를 갖는 조건에서 검증한다. 앱 scope resolver, locale/theme, instrumentation guard, toast 출력과 첨부 저장소는 명시적인 fixture 경계이며 전체 앱 provider graph나 실제 host 업로드 검증을 의미하지 않는다. 연결 가능한 Browser plugin 인스턴스가 없어, 설치된 Playwright와 Chromium의 별도 임시 profile을 사용했다.

- 최초 `node --test scripts/test-image-sketch.cjs scripts/test-namespace-cache-owner.cjs`: 16개 중 15개 통과, exit 1. native scope의 getter를 테스트에서 객체 spread로 읽어 발생한 `Missing query client`를 수정했다. 제품 코드 실패는 아니었으며 fixture의 다른 scope 생성도 명시적 필드로 바꿨다. 영향받지 않은 namespace owner 7개는 모두 통과했다.
- 수정 후 `node --test scripts/test-image-sketch.cjs`: 9/9, exit 0. 같은 node/다른 wrapper의 정상 연결, 다른 node/descriptor와 수신기 부재, 비활성·busy 안내, pending 요청 보존, 취소·effect 해제, 이미지 오류·재시도·open 실패를 검증한다. 입력이 바뀌지 않은 namespace owner 7개 결과를 재사용했다.
- Windows Chromium native composer 렌더 검사: 10개 흐름 통과, exit 0, page error 0. 밝은/어두운 테마의 사진 위 그리기·Undo/Redo·PNG 첨부와 빈 스케치, 비활성 안내, 다른 scope 거부, decode 오류 후 재시도, 로딩 취소·중간 비활성, 실제 cda lazy module 로딩 실패를 확인했다. PNG는 두 테마 모두 800×500이며 원본과 달라진 pixel은 각각 2,835/2,914개였다. 최종 화면과 합성 PNG도 직접 확인했다.
- `node --check scripts/inject-image-sketch.cjs`, `node --check scripts/test-image-sketch.cjs`, `node --check scripts/image-sketch-render-fixture.mjs`, task 파일의 `git diff --check`: exit 0.

소스 검사 UTC: 최초 2026-10-16 18:14:14–18:15:59, 수정 후 18:21:13–18:22:10. fixture 서버 준비 영수증은 18:20:56, 브라우저 최종 결과 영수증은 18:24:25다. 두 작업은 겹쳐 진행했고 native 연결 fixture가 준비된 뒤 화면 검증을 시작했다. 재실행은 실패한 테스트 helper 수정에 한정했다.

증거: `artifacts/tasks/BN-01-image-sketch/runs/scope-fix-tests-{01,02}/{tests.log,result.json}`, `scope-fix-render-01/{browser-results.json,verification-identity.json,light.png,dark.png,light-annotated.png,dark-annotated.png,unavailable.png}`. source/fixture의 SHA-256은 `verification-identity.json`에 보존한다. 이 세 run group은 다음 설치 패키지에서 동등한 검증 증거가 확보되면 보존 필요성을 재검토한다.

검증 브라우저를 닫고 임시 profile 약 29.9 MB를 inventory/review/apply로 일반 삭제한 뒤 실제 부재를 확인했다. 검증 서버는 command/PID와 자식 없음으로 소유를 확인한 뒤 종료했으며 native session exit 1은 의도한 서버 종료 결과다. 제품/브라우저 검사 실패로 계산하지 않는다. 증거 group만 보존한다. 기존 staged/unstaged 변경과 사용자 데이터, 설치본은 변경하지 않았다. Linux/macOS, 전체 앱 provider graph, 실제 native toast 표시 및 host 업로드, 최종 설치 패키지 수용은 별도다.
