상태: 구현 완료, 고정 입력의 Rust 검증 중. 사용자 응답 없이 필수 검증과 정리를 진행한다.

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

기존 dirty/staged 변경과 이번 변경을 분리하기 위해 원래 바이트에서 만든 task-only patch와 별도 임시 index를 사용한다. 무관한 기존 formatter 차이는 커밋에 포함하지 않는다. 임시 index/기준 복사본/검사용 엔진 스냅샷은 검증과 커밋 이후 제거한다. 공유 빌드 캐시는 기존 소유 경로를 유지한다.
