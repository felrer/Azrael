상태: 사용자의 VS Code 종료 보고 후 감시 실험 중지. 기존1회 완료·v5 1회 미완료이며 추가 실행0, 종료 코드 unknown과 보호된 중단 자료 정리 미해결로 작업 미완료다.

# 기존·v5 각 1회 재측정과 캐시 미스 감시

## 목적과 승인 범위

사용자는 실행 직후 VS Code가 종료됐다고 보고하고, 대략적인 경향만 보는 이전의 간단한 실험 방식으로 돌아가는 방향을 제안했다. root는 진행 중인 실험만 지원된 interrupt/정상 종료로 멈추고 추가 모델 실행·준비 확대를 금지했다. 이번 실험이 UI 종료를 일으켰다는 인과관계는 미확정이다. 아래 감시 설계는 중단된 시도의 기록이며 후속 실행 요구사항으로 유지하지 않는다. 이미 확보된 두 조건의 결과가 있으면 우선 재사용하고, 단순 방식의 새 실험은 별도 실행 결정 전 진행하지 않는다.

사용자는 기존(no reader)과 v5를 각각 1회 다시 측정하고, 대규모 캐시 미스가 발생하면 중단하며 원인을 대략 구분할 수 있는 설정을 요청했다. 이전의 구버전 재실행 금지는 이번 기존 1회에 한해 변경된다. 중단된 시도도 실제 실행 1회로 세며 자동 재시도하지 않는다.

기존 실험의 모델 OpenAI/gpt-6.1-sol·medium, 동일 과제, 자유 terminal, 파일 크기 제한 없음, v5에는 효율적 작업을 위해 제공 도구를 사용하라는 정도의 안내만 유지한다. 한 번 고정한 fresh corpus·같은 runtime·동일 검사 기준으로 두 조건을 비교하고, v5 기능 자체는 변경하지 않는다. 공통 JS/TS 조사 의미이며 실제 준비·검증은 Windows x64 로컬 환경에 한정한다. 기본 제품 설치·공유 설정 변경·엔진 배포는 범위 밖이다.

## 확정된 중단 기준과 한계

사용자는 권장 기준으로 감시·중단을 승인했다. 각 조건의 첫 유효 요청은 cold start 예외로 둔다. 이후 expected_reuse_approx = floor(min(직전 inputTokens, 현재 inputTokens) / 128) × 128, loss = max(0, expected_reuse_approx − cachedInputTokens), ratio = cachedInputTokens / expected_reuse_approx로 계산한다(기대량0이면 ratio1). loss ≥ 8,192이며 ratio < 0.75이면 대규모 miss 감시가 발동한다. 실제 캐시 가능 경계를 아는 판정이 아닌 근사 감시 기준이다.

현재 thread/turn의 response ID별 usage를 중복 제거한다. usage 누락·잘못된 값은 캐시 미스로 단정하지 않고 감시 불가로 중단한다. 중단은 한 번만 발신하며 이후 응답·terminal을 기록한다. 어느 조건에서든 중단·실패하면 전체 비교를 멈추고 남은 조건을 시작하지 않는다. 중단된 시도도 실제 실행1회로 세며 자동 재시도하지 않는다.

외부 app-server의 rawResponse/completed를 받은 직후 지원 turn/interrupt를 보낸다. 해당 요청 비용은 이미 발생하며 다음 요청과 경쟁할 수 있다. 별도 전송 proxy·엔진 수정/빌드/배포는 하지 않고, 후속 완료 응답 관측과 중단 발신/확인 시각을 기록한다. 추가 완료 응답이 없다는 관측을 추가 네트워크 요청이 없었다는 보장으로 바꾸지 않는다.

설치 인터페이스에서 공식 prompt_cache_diagnostics 전용 전달은 찾지 못했다. 조건별 설정·도구 schema·모델/effort·runtime·입력 hash와 실제 관측된 compaction/도구변경/연결 실패 등을 수집한다. client 설정 hash와 실제 전송 요청 hash를 구분하며 후자는 미관측 시 null이다. provider 내부 원인은 근거 없으면 unknown으로 남긴다.

## 조사와 재사용

21-verification.json의 독립 보존 하네스6개와 v5 구현·unit/native 수용 근거를 재사용한다. v4 대비 v5의 누적 입력은19토큰 감소했지만 캐시 입력은33,152 감소했다. 요청3(cached0), 요청6(cached21,888)에 차이가 집중됐다. 기존 두 번째 실행은 첫 요청부터24,064 캐시 입력을 받아 시작 조건도 달랐다. 캐시를 임의 초기화하거나 계정·키를 조작하여 cold start를 꾸미지 않고 실제 첫 요청 캐시를 별도 보고한다.

current source의 rawResponse/completed는 responseId·usage·usageMetadata를 노출하며 prompt_cache_diagnostics 전용 전달은 찾지 못했다. 실험 하네스는 단일 turn/start에서 모델·effort·도구를 고정한다. 서버 원인과 로컬 설정 변경을 구분할 때 실제 전송 요청을 관측했는지, client 설정만 관측했는지 명시한다.

## 실행 순서와 책임

root가 요구사항·중단 기준·진단 계약·최종 실행 승인·통합 수용·task commit을 맡는다. runner의 읽기 전용 조사는 완료됐다. baseline은21의 동일 native 하네스에서 dynamicTools=[]와 효율 안내 한 문장 제거로 구성하고, v5는21의 계약을 유지한다. 역사적12의 guide 전체·driver 본문은 보존되지 않아 완전히 같은 프롬프트 복원은 불가하다. 이번은 같은 fresh snapshot/cwd에서 baseline→v5 순서로 수행한다.

현재 task 핵심2파일·v5 의존9개·설치engine SHA는21과 동일하며 전체 corpus는 maintenance 관련3개가 달라 두 조건에 공통으로 고정한다. runner가 새 run에 baseline/v5 분기·실시간 guard·진단을 준비하고 root는 동시에 독립 수용을 준비한다. runner의 고정 입력/검증 READY 후 root START로만 실제 모델 측정을 시작한다. 정상 kmw 인증 owner 재사용 외 계정 변경은 먼저 root에 보고한다. 재위임·credential 복제·공유 설정 수정·proxy·제품 engine 수정은 하지 않는다.

## 검증과 보고

감시기는 cold first request, 정상 캐시, 대규모 miss, usage 누락·중복 response, latch 이후 이벤트를 점검한다. 보관v4/v5 트레이스를 재생하여 v4는 발동 없음, v5는3번째 발동·6번째 부분 miss는 독립 사례로 확인한다. 무추론 경계 검증은 실제 모델 trial과 구분한다. 기존 v5 unit/native는 입력이 동일하면 재실행하지 않는다. 각 조건의 actual trial 수는 최대1이며 중단·실패를 정확도 PASS나 완료 성능값으로 대체하지 않는다. cache 판단 시점·중단 요청/확인·추가 완료 응답 관측 유무를 기록한다.

최종 비교는 전달 출력·컨텍스트 증가·누적/일반/캐시/쓰기 입력·출력·요청/도구 호출·시간·정확도를 포함한다. 첫 요청과 그 이후 비용을 구분하고 N=1·캐시 시작 상태·부분 진단의 한계를 보고한다.

## 산출물과 정리

변경은 실험 하네스·감시기와 이 작업의 독립 수용 기록으로 한정한다. 기본 Azrael 도구나 설치본 동작을 바꾸지 않으므로 제품 아키텍처 변경은 없다. 실제 producer 전에 run 소유권·예정 산출물을 등록하고, 고정 입력·로그·자식 프로세스를 추적한다. sr04 기존 보관 승인을 유지하며 이 실행 참조만 해제한다. 원문 run은 필요한 최소 독립 검증 근거를보존한 뒤 기존 owner 절차로 삭제하고 실제 부재를 확인한다. 타인 변경·기존 staged37항목을 보존한다.

## 준비 검증 결과

새 run은 artifacts/verification/minimal-id-cache-guard-20261103-41bf7a62, lifecycle은 run:serena-read-eval:20261103:cacheguard-41bf7a62다. root가 offline-readiness.json SHA256 7bc1f635db44a78047d9e8ce636d08f0efd3b37e885826ff7bfc6fdba16ce86c와 감시기·Peer·comparison-driver 소스를 직접 검토했다. 가드10사례 actual exit0, JSONL 전송 모의 actual exit0, driver syntax exit0이다. 저장 v4는 발동 없음, 저장 v5는3번째 loss21,888/ratio0 발동, 독립 마지막 부분 miss는 expected33,536/loss11,648/ratio0.65267로 재현했다. 모의에서는 turn/start 응답보다 먼저 온 알림의 turnId로 interrupt1회·{}응답·발동 후 추가 완료1건 보존을 확인했다. 실제 설치 engine 취소 효과를 증명한 검사는 아니다.

초기 corpus는643파일/8,845,784bytes이며 manifest SHA256 36ebe5f018d848c1de1e726d5ba6086fbf678d0dc85e4b27313191eb3e32b08a다. v5 의존9개와 핵심 task2파일·설치engine은21과 같은 SHA라 기존 수용 근거를 재사용했다. 실제 engine/backend·기존 kmw 정상read·두 thread 준비를 승인했으며 모델 실행은 root의 exclusive START까지0회로 유지한다. 기존 staged37항목은 root가 별도로 보존 기준을 저장했다.

실제 준비 session37125에서 driver58644/engine58132/backend45900, initialize177.483초 후 정상 kmw_active=true/chatgpt·계정 재선택0을 확인했다. baseline/v5 두 스레드는 같은 instructionSources·OpenAI/gpt-6.1-sol/medium이다. source643/control22가 불변이며 backend의 성능 전 query0이다. Peer account RPC 및 알림 redaction 보완 후 오프라인 개인정보 검사·전송 모의가 actual exit0이다. 최종 Peer SHA는6e165a1b4fc76a13dad25479405464e393f886813b6e67da4aa5325330af60eb, offline-readiness SHA는dd4cfadebd8bc0087ea75473dc3ee4df2ca1de8ab4941632ab0268c60c537eb3으로 갱신됐다.

root는 trial-readiness.json SHA9ce4311c82ee33d82f1034797c6f24e5f5d60849b12d8e74e70faa2359b21525와 실제 prompt/user/tool 계약·고정control을 확인했다. START epoch1793712869281에 exclusive start-turn.json을 생성했고 자동 추가실행을 허용하지 않았다. runner가 결과·정확 종료·독립 수용 후보를 준비하며 close/삭제는 root 수용 뒤로 보류한다.

## 중단 관측과 현재 한계

실제 turn/start는 baseline1회+v51회이며 추가 trial0이다. baseline은7응답·누적 입력204,450·캐시169,088·컨텍스트 증가13,282·전달45,787자·모델 도구6회로 완료됐다. v5는4응답까지 누적 입력99,628·캐시71,296·전달39,180자·모델 도구4회가 관측됐으나 turn/completed가 없어 미완료다. 두 조건 모두 관측 guard trip은 없었다. v5 중간값을 정상 완료된 baseline 또는 과거 v5와 성능 비교하지 않는다.

마지막 engine event는2026-11-03 22:37:06.544 KST, baseline terminal은22:36:15.321 KST다. session37125는 Unknown process id로 실제 완료 관측권을 잃었다. driver/backend shutdown 기록이 없어 driver/engine/backend actual exit는 모두 null/unknown이다. 사전에 관측한 정확 PID+생성시각11개 현재 잔존0 및 run 명령행 프로세스0을 확인했으나, 이 관측을 전체 producer tree 정상 종료의 증명이나 삭제 권한으로 취급하지 않는다. 사용자 VS Code·계정·타 프로세스는 조작하지 않았다. 사용자 크래시의 정확 시각·원인 증거는 수집하지 않았으므로 실험과의 인과관계는 미확정이다.

runner의 interrupted-summary.json은8,553bytes/SHA256 a5a076df5f961be78c33bbfbbe2fec1f8f2bf8ae4e88fe333244d18d8aac4296로 root가 일치 확인했다. interruption-observation.json과 기존 raw run은 현재 불명 종료 복구용 보호 자료로 유지하며 close/delete0이다. 그 경로는 artifacts/verification/minimal-id-cache-guard-20261103-41bf7a62다. 전체 tree 중단을 충분히 확인해 owner 보호를 해제할 때까지 정리 미해결이며 작업 완료/최종 commit을 선언하지 않는다.

후속 방향은 자동 캐시 가드·별도 원인 진단을 제거하고 동일 과제/모델의 출력량·누적 입력·호출 수로 대략적인 경향을 비교하는 단순 실험이다. 실제 캐시 상태와 API 환산 비용은 참고값으로 구분한다. 이번 변경 요청은 설계 방향 제안으로 취급하며 새 측정을 자동 실행하지 않는다.
