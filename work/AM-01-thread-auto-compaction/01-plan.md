상태: 구현·Windows 범위 검증·임시 입력 정리 완료. 앱 빌드 및 설치는 수행하지 않음.

# 스레드별 자동 압축

사용량 카드에 자동 압축 토글을 추가한다. 모든 새 스레드(분기 및 자식 포함)는 켜짐으로 시작하고, 설정은 해당 스레드에만 적용한다. 재개 시 해당 스레드의 설정을 복원한다. 수동 압축은 그대로 유지한다.

요구사항은 제품 대상인 Windows x64/MSVC, glibc Linux x64, Apple Silicon macOS의 로컬 VS Code 실행에 공통이다. 공통 UI 변환 및 엔진 스레드 경계에서 구현하며 Windows에서 검사한다. Linux/macOS 네이티브 실행은 미검증으로 구분한다. WSL, Remote SSH, 컨테이너, Intel Mac과 Linux ARM64는 별도 지원 범위다. 구현 및 필요한 테스트 빌드는 허용되어 있으며 전체 앱 빌드·설치·게시를 수행하지 않는다.

자동 압축이 꺼졌을 때 입력이 자동 압축 기준 A에 도달하면 노란색으로 전환하고, 두 번째 바퀴는 (입력 - A) / (전체 용량 - A)로 표시한다. 정확히 A에서 두 번째 바퀴 0%, 전체 용량에서 100%다. 기준 및 전체 용량이 유효하지 않으면 기존 게이지 대체 동작을 유지한다. 켜짐에서는 기존 자동 압축 및 요금 색상 정책을 유지한다.

기존 모델/프로바이더 기준, 네이티브 사용량 카드·버튼·스위치, 수동 압축 요청 경로를 재사용한다. 새 외부 의존성은 필요하지 않다. 상태/API 계약 조사 후 엔진과 UI를 연결한다. 엔진 조사 담당은 읽기 전용이며 root가 공유 계약과 통합을 소유한다.

성공 조건: 신규 기본값, 두 스레드 격리, 재개 보존, 모든 자동 압축 경로 차단과 수동 압축 유지, 토글 실패 표시, 경계와 포화 계산, 실제 밝은/어두운 렌더링 및 키보드 상호작용. 소스·네이티브 검사와 설치 상태를 구분한다.

소유 문서: docs/architecture/context-policy.md. 보존 목록: ui.provider-context 및 engine.provider-context. 기존 dirty 작업은 보존하고 이번 변경만 커밋한다.

## 확정된 실행 계약

- 쓰기: `thread/settings/update`의 `{threadId, autoCompactionEnabled}`. 응답은 기존 빈 객체이며 `thread/read`의 `thread.autoCompactionEnabled`를 확인한다. 설정 알림의 `ThreadSettings.autoCompactionEnabled`는 기존 manager가 전체 스냅샷으로 보관한다.
- 저장: 스레드의 `SessionConfiguration`과 `ThreadSettingsApplied` 체크포인트. 이전 기록의 누락 값은 켜짐, 같은 스레드 재개만 복원하며 부모/분기 옵트아웃은 전파하지 않는다.
- 자동 압축을 필요로 하는 할당량 복구도 꺼짐에서는 원래 할당량 오류를 반환해 공개 이력과 계정 바인딩을 보존한다. 이미 시작된 압축은 취소하지 않는다.
- native 담당은 엔진 코드/테스트와 변경 전 바이트를 보관하고 root는 공유 계약, 입력 고정, Rust 검사, 보존 목록, 통합 및 작업별 변경 분리 커밋을 소유한다. UI 담당은 카드 변환/소스 검사/렌더 검사만 소유한다. 자식은 재위임하지 않는다.

## 검증 진행

보존 목록 JSON/계약 검증 통과. 수동 압축/큐/초안/namespace 회귀 63개가 종료 0으로 통과했다 (`artifacts/logs/thread-auto-compaction/manual-regression.log`, `.exit`). 화면 소스 검사 19개와 실제 pinned native React/스위치/CSS의 밝은·어두운 렌더 검사 33개가 종료 0으로 통과했다. 화면 근거는 `artifacts/logs/thread-auto-compaction/ui/native/summary.json`과 동일 폴더의 이미지에 있고 테스트 브라우저 프로필은 제거됐다.

엔진 담당의 수정은 14:30:46–15:05:01 KST에 완료됐다. root가 `am01-native-01` 입력을 `artifacts/verification/`에 고정하고 공유 `engine/codex-rs/target` 캐시에서 4개 패키지의 `--lib auto_compaction`과 core `--test all auto_compaction`을 직렬로 실행한다. 시작 시 다른 작업의 artifact lock을 기다린 뒤 컴파일을 진행했다. 최초 결과 확인은 15:23 KST 또는 완료 신호 시점이다. 실행별 입력 SHA/시작·종료/종료 코드와 로그는 `artifacts/logs/thread-auto-compaction/am01-native-01-*`에 보존한다. 전체 앱 빌드·설치·실제 모델 요청은 수행하지 않았다.

첫 입력은 15:07:14–15:19:58 KST에 실행되어 종료 101이었다. 토글 외 기존 모델 프로필 변경의 `get_harness_base_instructions` 두 호출부가 새 model 인자를 전달하지 않아 core 라이브러리 컴파일이 실패했다. root가 `provider_handoff.rs`와 `compact.rs`의 기존 현재 모델을 전달하도록 호출부만 보정했다. 재실행은 `am01-native-02`로 이전 고정 입력과 이 두 검토된 보정만 선택하며, 다른 작업의 이후 변경을 따라 갱신하지 않는다. 이 보정은 별도 기존 기능의 통합 수정으로 기록하고 토글 작업 커밋과 분리한다.

기존 dirty/staged 변경과 이번 변경을 분리하기 위해 원래 바이트에서 만든 task-only patch와 별도 임시 index를 사용한다. 무관한 기존 formatter 차이는 커밋에 포함하지 않는다. 임시 index/기준 복사본/검사용 엔진 스냅샷은 검증과 커밋 이후 제거한다. 공유 빌드 캐시는 기존 소유 경로를 유지한다.

검증 중 외부에서 `09bb4b35` (`others`) 커밋이 생성되어 토글의 코드·테스트·문서도 함께 포함됐다. 이 커밋과 다른 작업 변경을 유지하고, 남은 fixture 보정·검증 기록만 별도 작업 커밋으로 묶는다. 이전 HEAD 기준의 임시 index를 현재 HEAD에 적용해 기존 커밋을 되돌리지 않는다.

두 번째 입력은 15:22:54–15:49:36 KST, 종료 101이었다. app-server의 기존 codex-history resolver 연결 의존성과 수동 압축 테스트의 중복 Arc를 보정했다. 함께 고정된 Claude 테스트의 Session 경로/PermissionProfile 경로, 새 필드 초기화 두 곳, 임시 배열 수명도 최소 범위에서 보정했다. 변경 전 바이트와 parser 근거를 보존한다. 아직 라이브러리 실행 통과 결과는 없으므로 am01-native-03에서 라이브러리와 저장 검사를 모두 재실행한다. 저장 fixture는 legacy 전용 helper 대신 실제 저장된 history를 cold resume하며, 페이지화된 저장도 동일 ID 복원을 확인한다. 세 번째 입력은 am01-native-02와 검토된 8개 파일 보정만 포함한다.

세 번째 입력은 15:55:14–16:30:17 KST, 종료 101이었다. 동일 테스트 파일의 두 번째 StepContext 호출부에도 중복 Arc가 남아 있었음을 실제 컴파일로 확인해 모두 보정했다. 네 번째 실행은 종료된 am01-native-03 경로를 재사용하고 해당 파일만 보정한다. 이전 입력 manifest/SHA와 결과는 별도 기록으로 유지하며 새 am01-native-04 입력 SHA를 기록하고 실행 중 불변성을 검사한다. 경로 변경으로 발생한 광범위 재컴파일 비용을 줄이기 위한 재사용이며 이전 실패 결과를 통과 근거로 쓰지 않는다.

네 번째 입력은 16:32:20–16:47:57 KST, 종료 101이었다. app-server 1개와 app-server-protocol 1개는 통과했고 core 8개 중 7개 통과했다. 수동 압축은 성공 응답했으나 테스트가 일반 compaction 변경 대신 transcript promotion용 reset epoch를 비교해 잘못 실패했다. 실제 assistant 이력을 넣고 window 교체·world-state 체크포인트·기존 이력 제거·시작/완료 이벤트를 검증하도록 수정했다. 저장 검사는 해당 lib fixture와 독립적으로 시작했다. 마지막 lib 검사는 통과한 app-server 두 패키지를 반복하지 않고 core와 아직 실행되지 않은 protocol만 검사한다.

최종 검증: am01-storage-01은 16:49:40–17:10:35 KST, 종료 0이며 저장/재개/격리/실패 복원 및 기존 token-budget 회귀 5개가 통과했다. 입력 SHA d66af893b3ed1b243f0329da6024d48fc744f7129456aa583c5cd70df01d9a52, 실행 중 불변이다. am01-native-05는 17:11:40–17:34:09 KST, 종료 0이며 core 8개와 protocol 1개 통과했다. 입력 SHA 77fb3320d9a2d7edeee63d0b95fddb2f52e25438dbce60f72e8fadd107a09a6b, 실행 중 불변이다. native04의 app-server/app-server-protocol 각 1개 통과 결과를 재사용해 라이브러리 총 11개를 확인했다. 이후 수정은 lib fixture뿐이라 저장 검사의 제품 입력은 일치한다. task native 경로 최종 소스/검증 입력 비교도 차이가 없다 (`final-input-comparison.json`). 모든 실행 로그와 결과는 artifacts/logs/thread-auto-compaction/에 보존한다.

수용 범위는 Windows의 고정 소스 및 pinned native UI 검증이다. 새 바이너리의 실제 RPC, 실제 모델/계정 요청, 전체 앱 패키징과 설치, Linux/macOS 실행은 미검증이다. 이번 작업에서 앱 빌드·설치·게시를 수행하지 않았다. 이전 native01/02 입력은 정리 종료 0으로 삭제 및 부재를 확인했다. 최종 입력과 임시 index/기준 복사본을 정리하고 남은 수정·검증 기록을 별도 커밋한다.

최종 정리: native01/02/03 스냅샷, 임시 index와 실행 helper, 기준 복사본을 일반 삭제로 제거하고 부재 확인했다 (`final-cleanup.json`, 각 cleanup 결과). 로그·입력 manifest·SHA·결과 receipt·화면 근거는 보존하고 공유 target 캐시는 유지했다. 함께 발견한 기존 Claude 테스트 컴파일 보정은 f545435a로 별도 커밋했다. 외부 09bb4b35/7e13e663 커밋을 유지하며 이번 토글의 남은 의존성·fixture·소유 문서·검증 기록을 별도 커밋한다. 원격 push 및 게시 없음.
