상태: 완료. 5회 실측·분석 및 작업 소유 대화/임시 프로필 정리 검증 완료.

# Azrael 2026.0.13 sol medium 첫 응답 지연

## 범위와 측정 조건

사용자 요청은 격리 프로필에서 실제 요청부터 첫 응답까지 분석하는 것이다. 제품 수정·빌드·재설치 없이 Windows x64 로컬 설치본을 조사했다. VS Code user-data/shared-data/extensions/workspace는 작업 전용으로 분리했다. 인증 복제를 피하기 위해 native state/auth는 기존 C:/Users/felre/.azrael-ex를 사용했고 2026.0.13 shared engine에 연결했다. 따라서 계정·엔진·기기 부하까지 완전히 격리한 실험은 아니다. 다른 릴리스 엔진도 동시 실행 중이었다.

설치 확장 package.json은 2026.0.13, 엔진 SHA-256은 af05729487ad2fa94d97eb0abedb795f843130297135546464becb522fb8c40a로 runtime-config.json과 일치했다. 모든 실제 요청의 native response_preparation span에서 model=gpt-6.1-sol, reasoning_effort=medium을 확인했다. UI는 Standard였다. IDE context 토글은 껐다. 작업 공간은 프로젝트 아래이므로 상위 AGENTS/공통 지침에서 독립된 빈 프로젝트 기준선으로 보지 않는다.

실제 보이는 입력창에 도구 없이 두 숫자의 덧셈 결과만 요청했다. 새 대화 2개, 실제 요청 5개 모두 완료됐고 도구 호출은 없었다. 전송 버튼 click capture, 복사한 호스트의 sendProviderRequest/routeIncomingMessage 시각, native SQLite의 기존 response_preparation, DOM MutationObserver를 연결했다. 호스트 복사본만 계측했으며 실제 설치 파일은 수정하지 않았다. DOM 출현 시각은 모니터 표시 완료 시각과 구분한다.

## 단계별 실측 (ms)

| 표본 | 클릭→turn/start 호출 | 호출→turn/started | turn/started→첫 답변 delta | delta→DOM 답변 | 합계 |
| --- | ---: | ---: | ---: | ---: | ---: |
| fresh1 | 2846 | 624 | 3118 | 58 | 6646 |
| followup1 | 1195 | 77 | 2791 | 35 | 4098 |
| followup2 | 241 | 83 | 3975 | 35 | 4334 |
| fresh2 | 2593 | 376 | 4547 | 31 | 7547 |
| followup3 | 240 | 61 | 4243 | 22 | 4566 |

first1 click은 한국 시각 2026-10-28 22:42:49.415, 마지막 표본은 22:47:18.828이다. 상세 수치는 [result.json](result.json)에 보존한다. first1은 프로필 첫 요청이지 기기의 shared engine 완전 cold start는 아니다.

## 해석

1. 새 대화에서 첫 답변까지 6.646/7.547초, 후속 요청은 4.098/4.334/4.566초였다. 새 대화의 turn/start 호출 전 2.593~2.846초는 원격 모델 추론으로 설명할 수 없는 로컬/호스트 준비 구간이다.
2. 새 대화의 첫 thread/start 호출은 클릭 후 336~481ms, 해당 thread 시작 이벤트까지 약 1.0~1.1초였다. 이후 모델/계정/설정/큐·첨부·기록 초기화 요청이 함께 관측됐고 turn/start는 클릭 후 2.6~2.8초였다. gpt-6-luna 임시 thread/start도 병행 관측됐다. 실행본의 ephemeralGenerationModel 기본값과 일치하지만 이것이 주 대화 모델 변경이나 특정 지연의 단독 원인이라는 증거는 없다.
3. 후속 요청의 전송 준비는 240~1195ms였다. 가장 느린 후속 준비에는 계정 조회 완료 이후 다음 설정 조회까지 약 909ms 공백이 있다. 현재 계측은 그 공백 내부의 UI 작업/대기를 구분하지 못한다.
4. native context_capture→sampling_context 완료 구간은 새 대화 553~624ms, 후속 요청 244~277ms였다. world_state는 initial_context/sampling_context 내부 중첩이므로 단계별 elapsed를 중복 합산하지 않는다.
5. 준비 완료→첫 delta는 2472~3959ms였다. 이 값에는 추가 로컬 처리, 실제 전송, 네트워크, 원격 대기·추론이 섞여 있다. wire send/server receipt/first-byte를 기록하지 않았으므로 순수 모델 처리 시간으로 부를 수 없다.
6. 첫 delta 이후 DOM 답변까지 22~58ms로, 이번 표본에서는 마지막 렌더 구간이 주요 지연이 아니었다. 긴 대화·큰 도구 출력·장시간 멈춤까지 배제하지 않는다.

## 한계와 다음 진단 권고

5개 짧은 요청에서 수십 초 지연은 재현되지 않았다. p95/간헐 장애 빈도를 판단하지 않는다. 실제 문제 발생 대화와 긴 입력의 성능은 별도다. 두 번째 새 대화 준비 과정에서 숨겨진 이전 composer의 Send가 한 번 호출됐으나 turn/start가 발생하지 않아 성능 표본에서 제외했고, 보이는 컨트롤로 다시 측정했다. 제어 도구 호환성 문제/준비 시간은 측정 시간에 포함하지 않는다.

진단 우선순위는 (1) 클릭→thread 생성→계정/설정 준비→turn/start 사이의 고정 단계별 계측, (2) 일반 OpenAI 요청의 실제 wire 제출·첫 이벤트 계측, (3) 실제 느린 입력과 정상 입력의 같은 조건 비교다. timeout/대기 보호나 검증을 낮추는 변경은 제안하지 않는다. 코드 변경은 이 분석 요청에 포함하지 않았다.

## 검증·정리

실요청 5개 completed, 각 turn은 userMessage/agentMessage만 포함. native 로그 조회 실행 exit 0. 엔진 해시와 실제 모델/effort 검증 완료. 배포 영수증의 engineSourceRoot는 현재 부재하므로 현재 engine 소스 설명을 정확한 릴리스 소스 검증으로 일반화하지 않는다. 원본 native 로그 DB/사용자 대화/계정은 정리 대상이 아니다. 이 작업이 생성한 대화 두 개와 임시 프로필/복사본/상세 로그만 소유자 절차로 정리하며 최종 결과를 아래에 반영한다.

정리 완료: 테스트 대화 2개 삭제 후 state DB 부재 확인(exit 0), 소유 VS Code/계측 controller 모두 exit 0 및 18-process 트리 잔여 0. 약 1,354,220,844 bytes의 임시 프로필·복사본·상세 로그 묶음을 검증된 maintenance_owner로 registered 검토 후 삭제했다. status=deleted, remaining=false, 실제 run 경로 부재, finalize exit 0. 최초 등록 호출 중단 결과는 unknown으로 보존하고 정확한 예약 소유자·종료 증거로 복구했다. 복구 제어 증거는 artifacts/maintenance/evidence/eh01-registration-stop.json 및 소유자 관리 영수증에 보존한다. 분석 산출물은 이 문서와 result.json이며 제품 파일 변경은 없다.
