상태: 구현 및 Windows 범위 검증 완료. 설치본 반영은 별도 전체 빌드/설치 범위이다. 사용자 추가 결정 없음.

# 요구와 범위
- 공통: Windows x64, Linux x64/glibc, macOS ARM64의 로컬 엔진 응답 준비가 무기한 대기하지 않고 오류·취소·명시적 재개로 종료되도록 한다.
- 공통: 동일 세션의 rollout 교체/축소 시 파생 이력 인덱스를 원본 및 history_base에 맞게 일관되게 유지한다. 기존 원본 파일과 대화를 보존한다.
- Reload Window 회귀 검증 추가는 사용자 지시에 따라 제외한다. 모델/tool 재실행, 강제 창 재시작, 사용자 DB 수동 수정, 전체 앱 빌드/설치는 범위 밖이다.
- 실제 검증: Windows x64의 결정적 native 단위검사와 host recovery 검사. 타 OS 및 설치본 실사용 검증은 별도이다.

# 근거와 실행
- 실행 배포 w13e는 artifacts/w13a/engine에서 생성됨. 수정 대상은 primary engine/이다.
- 02:58:35 턴 접수, 02:58:38 상태 구성 이후 03:07:51 interrupt까지 무출력. 특정 잠금 원인은 아직 미확정.
- revert 후 파일 128349B, 파생 인덱스 offset 125763537B(옛 파일 크기). 새 턴 누락.
- root: 준비 경로의 제한 시간·취소·상태 로그 및 recovery admission, 문서·통합·검증·커밋.
- history_projection 담당: thread-store 교체/축소의 atomic projection 유지와 결정적 검사. 공유 SQL migration과 SOURCE.json 변경 금지.
- 두 코드 산출물 준비 후 입력 고정하여 targeted Windows 검사 실행. 동일 Cargo cache의 무거운 빌드는 직렬화.

# 성공 기준
- 준비 작업 정지 fixture는 제한 시간에 실패하고 동일 세션의 명시적 후속 요청을 허용한다. 원 입력과 완료 tool을 자동 재전송하지 않는다.
- 완료/취소/실패의 safe stage 로그만 기록하고 prompt 및 provider 원문은 기록하지 않는다.
- 동일 ID 파일 교체(크기가 작거나 큰 경우), 축소, history_base/이전 segment의 보존과 재조회가 결정적 검사에서 통과한다.
- 관련 문서·보존 inventory 연결, 출처 기록, 필수 검증 결과와 종료 코드·로그를 갱신한 뒤 이번 변경만 커밋한다. 사용자 기존 SOURCE.json 변경과 다른 작업을 보존한다.

# 구현 및 검증 근거
- 준비: context_capture/initial_context/world_state/sampling_context 각각 90초 deadline. 취소는 pending future를 drop, timeout은 nonretryable Fatal로 종료. 초기 실패는 기존 user-input 기록 경로를 사용한다. 모델 추론·압축·tool·사용자 승인 대기는 제외한다.
- 이력: concrete rollout_id로 projection을 선택, derived version 4의 lazy rebuild, same-ID shrink는 엄격한 prefix validation과 original cursor CAS transaction으로 처리한다. 원본 파일과 inherited segments를 보존한다.
- 호스트 recovery state/bridge/presentation: 352개 통과, 종료 코드 0, artifacts/logs/response-preparation-history/host-recovery-tests.log.
- feature-preservation 도구: 13개 통과, 종료 코드 0, artifacts/logs/response-preparation-history/feature-preservation-tests.log. 변경한 세 feature manifest entry만 validator 통과. 전체 validator는 기존 ui.provider-context.render의 native level 때문에 실패하여 변경 범위 검사와 구분한다.
- 첫 입력 사본은 Windows 경로 길이 때문에 생성 실패해 일반 삭제 후 부재 확인. 다음 사본은 동시 예산 작업 변경을 감지해 테스트 시작 전에 새 input-r2 식별자로 재고정했다. artifacts/rph2/engine 및 input-r2.json에 고정된 소스 기록. 이후 주 소스 변화는 실행 중 검증에 반영하지 않는다.
- 기존 SOURCE.json 사용자 변경은 보존한다. 이번 테스트의 입력 출처는 file SHA-256 영수증으로 기록하며 배포용 SOURCE.json 재기록·전체 빌드·설치는 수행하지 않는다.
- r2 thread-store 실행은 02:34:32Z~02:43:14Z, 공유 Cargo 캐시 잠금 대기 후 새 revert 검사 경로 타입 오류로 컴파일 종료 101. PathBuf 변환으로 수정하여 r3으로 다시 고정했다. 실행 중 입력 갱신은 하지 않았다.
- r3 이력 materialization 37개 통과(02:44:49Z~02:46:00Z), revert 2개 통과(02:47:24Z~02:47:32Z), 모두 종료 코드 0. 로그는 thread-history-materialization-r3.log / revert-thread-r3.log 및 각 result.json이다.
- r3 검증 중 turn.rs에 들어온 별도 subscription compaction 변경은 작업 트리에 보존하고 이번 커밋에서 제외한다. 준비 관련 hunk는 고정 사본과 동일하다. feature manifest도 engine.recovery owners 7개만 이번 변경으로 기록한다.
- r3 준비 검사 3개 통과, 종료 코드 0(02:48:09Z~03:00:42Z, 컴파일 포함). response-preparation-r3.log와 result.json에 기록한다. 제한 시간/취소 future drop, 실제 world-state clock 정지와 다음 build 성공을 확인했다. native 총 42개, host recovery 352개, feature-preservation 13개 통과이다.
- Reload Window 회귀 검사는 추가/실행하지 않았다. 실 사용자 DB 수정과 모델 호출, 배포 provenance 변경, 전체 앱 빌드/설치는 수행하지 않았다. 기존 캐시는 재사용하고 검증 입력 사본은 검사 종료 후 일반 삭제 및 부재 확인한다. 소스 hash 영수증과 검사 로그는 보존한다.
- 정리 완료: artifacts/rph3의 절대 경로를 artifacts 하위의 지정 경로와 대조하고 Remove-Item -Recurse로 삭제, Test-Path로 부재 확인했다. force 옵션은 사용하지 않았다.
