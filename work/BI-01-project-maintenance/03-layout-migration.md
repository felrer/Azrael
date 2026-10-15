# 프로젝트 생성물 구조 이전 결과

상태: 복사·내용 검증·reader 전환과 구 경로의 실제 삭제를 완료했다. 모든 경로는 프로젝트 루트 기준이다.

완료된 BL-01/AO-01 두 작업의 9개 파일(16,804 논리 bytes)을 4개 실행으로 나눴다. 원본과 새 파일의 SHA-256이 같고, 파일 내용과 내장된 과거 실행 경로는 고치지 않았다. 소스 코드·기존 테스트·작업 기록은 각 소유 위치에 유지한다. 소속이 불명확하거나 현재/직전 설치·활성 공유 캐시에 묶인 대형 legacy는 물리 이전하지 않았다. [삭제 검토 후보](02-cleanup-candidates.md)에 필요한 추가 확인과 보호 근거를 기록했다.

| 원본 | 새 경로 | bytes | SHA-256 |
| --- | --- | ---: | --- |
| `artifacts/logs/recent-chat-limit/behavior.log` | `artifacts/tasks/BL-01-recent-chat-limit/runs/recent-chat-check-20261014/logs/behavior.log` | 39 | `4f30801ad84e98d3fe65cd256e1397e75e8129adc1b1053d20e85de39edd3862` |
| `artifacts/logs/recent-chat-limit/integration.log` | `artifacts/tasks/BL-01-recent-chat-limit/runs/namespace-cache-check-20261014/logs/integration.log` | 1281 | `e93d2863c78f0b9466616218a275d2d7cbf6043b6eb0c23094f2e3f9ca9b5cfe` |
| `artifacts/logs/composer-session-emoticons/source-tests.log` | `artifacts/tasks/AO-01-composer-session-emoticons/runs/source-tests-20261015/logs/source-tests.log` | 856 | `3954d0c7706a7747573a97812c286efb8a919320a68f084800d5572aea93a618` |
| `artifacts/logs/composer-session-emoticons/render.log` | `artifacts/tasks/AO-01-composer-session-emoticons/runs/chromium-render-20261015/logs/render.log` | 302 | `309107ac107ed16d593995d94f6632be70778f988e0390698a4f75b68f81028c` |
| `artifacts/logs/composer-session-emoticons/render/cleanup.txt` | `artifacts/tasks/AO-01-composer-session-emoticons/runs/chromium-render-20261015/logs/cleanup.txt` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `artifacts/logs/composer-session-emoticons/render/summary.json` | `artifacts/tasks/AO-01-composer-session-emoticons/runs/chromium-render-20261015/reports/summary.json` | 621 | `53fc79407ec47082e2b80047c2c34ff0984bc63d1db5962c4d0ad489a31dbc6a` |
| `artifacts/logs/composer-session-emoticons/render/cleanup-preview.json` | `artifacts/tasks/AO-01-composer-session-emoticons/runs/chromium-render-20261015/reports/cleanup-preview.json` | 424 | `03e041f14df68f0470f0ef6e3487b9e75262d6cdf899eb241bef4bfa144b1fe1` |
| `artifacts/logs/composer-session-emoticons/render/light.png` | `artifacts/tasks/AO-01-composer-session-emoticons/runs/chromium-render-20261015/outputs/render/light.png` | 6530 | `767f3681d3ec8be1cf58a7e19140a0b3c34f3c87a64c2a81e9cf0f10f5b0c384` |
| `artifacts/logs/composer-session-emoticons/render/dark.png` | `artifacts/tasks/AO-01-composer-session-emoticons/runs/chromium-render-20261015/outputs/render/dark.png` | 6751 | `9b86a5cc2b56e73af2daa8c67556962d199c0bc8b62706ec45c6d3f76b75af25` |

## 관리 시스템 연결

새 4개 run은 `run:<work-id>:<run-id>`로 복사 전에 pending 등록하고, 복사·해시 확인 후 complete/membership_complete로 조정했다. 구 두 루트는 `migration-source:BL-01-recent-chat-limit`, `migration-source:AO-01-composer-session-emoticons`로 보호했다. 작업 기록의 로그·보고서·이미지 참조와 운영 문서를 새 경로로 바꿨다. Reader 전환과 후속 writer 검증 후 두 구 루트를 native 도구로 일반 삭제하여 실제 부재와 producer record finalized를 확인했다. 새 4개 보존 run은 유지한다.

AO writer `scripts/verify-composer-emoticon-render.mjs`는 기본 timestamp+UUID 및 선택한 안전한 `--run-id`를 사용한다. `--describe-paths`는 asset·Chrome 준비나 파일 생성 없이 경로와 충돌만 확인한다. 새 실행은 같은 run의 `temporary/fixture`, `logs`, `reports`, `outputs/render`에 쓰기 전에 lifecycle을 등록한다. 기존 UI 단언, 실제 브라우저 종료 및 프로세스 참조 검사를 유지했다. 성공한 실행도 fixture를 자동 삭제하지 않고 모델이 전체 묶음을 삭제하거나 보류한다.

## 검증 범위

- 구문 검사 exit 0. 읽기 전용 경로 계약 10건 exit 0: 기본 두 실행의 고유성, 명시 ID, 잘못된 ID, 누락 값, 충돌을 확인했다. Run 및 registry 목록은 바뀌지 않았다.
- Windows Chromium 실제 한 번 실행 exit 0. 밝은/어두운 테마, 입력·지우기, 세션 재방문, 7개 후보 및 reload의 기존 단언 3묶음이 통과했다. 브라우저 actual exit 0/signal null, fixture 참조 프로세스 0이었다.
- 이후 보고서 독점 쓰기와 mkdir 경합 방어만 보강하고, 최종 구문 및 충돌 회귀 exit 0과 기존 summary SHA 불변을 확인했다. Chromium을 다시 실행하지 않았다. 실제 Chromium은 code SHA `8b81168d73cec0bc00293d22b2e9b740fbdbd1a64e0293fb4fa41b367d8763e6`에서 실행했으며 최종 code SHA `354afa4e28ae3ea498d6364f409d2dd592ae42aa65cab344fe52c2c5320651ff`와 구분한다.

변경은 출력 경로·충돌·정리 흐름이다. 제품 UI 수용 범위를 확대하지 않는다. 전체 native composer, 설치본 및 다른 OS 검증은 없다. 원래 작업 기록에 source commit/hash가 없으므로 새 폴더 이름을 제품 버전 출처로 간주하지 않는다.

조사 입력의 한 사본은 5,146,908 files/48,596 directory rows/301.2초/오류 0의 별도 기존 집계였다. 이번에 전수 재스캔한 것이 아니다. 필요한 매핑과 결과는 이 문서에 보존했고 원시 입력·임시 조사 스크립트, 이번 AO 검증 run 및 성능/지침 검증 생성물은 사용 종료 후 같은 6묶음 정리에서 삭제했다. Native 검토/apply는 각각 exit0, aborted=false, 6항목 모두 deleted/remaining=false, producer record 6개 모두 finalized였다. 묶음 전체의 당시 논리 크기는 402,363,889bytes다.

## 공통 테스트의 미래 writer

`scripts/test-project.cjs`와 관리 adapter도 기본 생성을 `artifacts/tasks/<work-id>/runs/<timestamp+UUID>/{logs,reports}`로 이전했다. `--work-id` 생략값은 project-tests다. 실행 전 producer 기록, 충돌 거부와 독점 mkdir 뒤 stdout/stderr 및 결과 checkpoint를 같은 run에 쓴다. 정상 성공은 모델 정리 검토를 기다리고 실패·미확인 실행은 보호한다. 명시한 legacy 출력 override는 기존 배치를 유지하며 해당 caller가 소유/정리 연결을 제공한다. 이 변경은 과거 모든 로그의 물리 이전 완료를 뜻하지 않는다. Windows에서 69기존 통과와 dependency 예상 보완 후1focused통과, 실제 Node child0/7 및 로그·상태를 검증했으며 세부 결과는01-plan.md에 보존했다.

Windows mock 배포 writer도 모든 mode를 ArtifactProjectRoot/artifacts/tasks/deploy-checks/runs/GUIDN으로 이전했다. 기존 Case/ChangedOnly 선택과 실제 child 단언은 유지하고 fixture·logs·reports와 lifecycle 상태를 함께 관리한다. 네 기존/ChangedOnly 사례 exit0 및 invalidCase exit1 보호를 확인했으며 구 20261005 고정 출력은 생성하지 않았다. 과거 실패/부분 실행·복구 백업은 별도 보류하고 완결된 독립 run만 정밀 검토한다.
