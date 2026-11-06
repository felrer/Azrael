상태: 소스 구현·자동 검증·작업 소유 임시 산출물 정리 완료. 제품 전체 빌드·설치는 요청 범위 밖이다. 설치본 및 live provider 종단 간 수용은 미검증이다.

# 세션 간 이미지 첨부 ID 전달

## 목표·권한·확정 사항
채팅 첨부와 root/lead가 다운로드한 별도 이미지를 선택하여 다른 세션의 실제 이미지 입력으로 전달한다. fork_turns=all 없이 동작해야 한다. 사용자는 이미지 전용 attachments 구현을 요청했다. 별도 등록 도구 없이 spawn_agent/send_message/followup_task가 path 또는 attachment_id를 받아 자동 검증·복사·전달한다. 일반 파일과 URL 다운로드는 받지 않으며 기존 세션 접근권을 유지한다.
지원 로컬 데스크톱 공통 설계이며 이번 근거는 Windows x64에서 소스 읽기다. Linux/macOS·원격·새 기능 실제 실행은 미검증이다.

## 확인된 근거
- engine/codex-rs/protocol/src/user_input.rs: Image/LocalImage가 있고 로컬 이미지를 데이터로 변환한다.
- core/src/tools/handlers/multi_agents_v2/spawn.rs 및 message_tool.rs: 생성·메시지·후속 요청은 문자열 입력이다.
- core/src/agent/types.rs의 AgentMessage와 protocol/src/models.rs의 AgentMessageInputContent는 텍스트/암호화 텍스트만 지원한다.
- protocol/src/protocol.rs의 InterAgentCommunication은 메시지 영속 필드 및 모델 입력 변환 경계다. 이 경계와 provider별 AgentMessage 투영까지 확장해야 한다.
- providers/opencodex/inference-mapping.mjs는 일반 input_image의 data URL을 처리하고 원격 URL은 거부한다. 이것만으로 세션 메시지 이미지 지원이 입증되지는 않는다.
- 기존 사본 저장소 target: docs/architecture/azrael-ex.md의 Attachment copies and project cleanup 및 work/CV-01-file-attachment-analysis/01-plan.md. 사용 중 사본 하나라도 있으면 프로젝트 전체 삭제 보류는 기존 확정 정책이다.

## 권장 설계
다운로드는 기존 도구로 수행한다. attachments 각 원소는 path 또는 attachment_id 중 하나만 지정한다. 엔진이 현재 읽기 권한·실제 이미지 형식·용량을 검사해 불변 관리 사본을 만들고 ID를 반환한다. 원본 변경·삭제는 사본에 영향을 주지 않는다. 채팅 이미지에도 재사용할 ID를 노출한다.
기존 수신 대상 권한과 별도로 첨부 접근권·수신 모델 이미지 지원을 검사한다. 이미지 참조는 암호화 텍스트와 별도 구조화 필드로 유지하고 실제 이미지 파트를 입력한다. 없는 ID·권한 밖 ID·이미지 미지원 모델은 명시적 오류로 처리한다.
메시지와 참조를 함께 보존해 queue-only/TriggerTurn·발신자·재시작·재시도 의미를 유지한다. 저장소 등록 → 구조/영속화 → 도구 → provider 투영 → 실제 자식 검증 순으로 진행한다. 아직 구현 소유자는 배정하지 않았다.
큐·실행·재시도·재개·하위 전달의 사용 참조를 관리하고 기존 일괄 삭제 보류 정책과 연결한다. 송신자 종료나 기간 만료만으로 삭제하지 않는다. 원본 다운로드와 관리 사본의 정리 권한은 구분한다. 기존 사본 저장소도 target이므로 이미 구현됐다고 가정하지 않는다.

## 남은 선택과 권고
최초 범위는 같은 root 작업 트리에서 기존 메시지 규칙으로 허용된 대상에 전달하는 것으로 권장한다. lead는 이름이 아닌 실제 권한으로 판단한다. 독립 root/프로젝트 간 공유는 별도 접근권과 소유 귀속 결정이 필요하다. 원격 호스트는 경로 대신 바이트 운반과 대상 등록이 필요하며 이번에는 검증하지 않았다.
개수·용량 한도와 프로젝트 귀속은 기존 이미지 한도 및 사본 저장소 설계와 정렬하여 확정한다. 자동 HTTP 다운로드를 등록 도구에 추가하는 것은 현재 권고 범위에 포함하지 않는다.

## 구현 시 성공 기준
fork_turns=none 자식의 실제 시각 확인, 등록 후 원본 변경/삭제에도 동일 사본, 다중 이미지 순서/중복/재전달, queue-only 비기동과 followup 기동 보존, 재시작/재시도 복원, 잘못된 ID/권한/형식/한도/모달리티 명시 오류, 사용 중 일괄 삭제 차단 및 참조 해제 후 기존 소유자 절차 정리. 공통 변경의 Windows 회귀와 provider별 검증이 필요하며 다른 플랫폼 실제 검증은 별도 표시한다.
## 구현 분담·진행
root는 도구 스키마/호출자·수신 모델 검사·채팅 ID 표시·문서/inventory·통합 검증과 정리/커밋을 맡는다. image_message_transport는 protocol/메시지 영속화/모델 입력/provider 투영을, image_attachment_snapshots는 환경 권한을 지키는 읽기/ID/불변 사본/대화 삭제 수명을 맡는다. 고정한 ImageAttachment 및 AgentMessage::WithAttachments 계약으로 독립 구현하고 무거운 Cargo 검증은 통합 후 순차 실행한다. 설치본에는 소스 변경이 자동 적용되지 않는다.

첫 project_tests run은 기본 단발 실행 경로의 10초 제한으로 exit 124, producer_completed=true였다. 장기 exec 경로의 재시도(work 7e9755d2-1755-4cd0-8cf8-72a02161fed3)는 기존 공유 캐시의 미확인 생성자 때문에 Cargo 실행 전에 exit 1로 거부됐다. 실패 run은 FS-01-agent-image-attachments/20261104T031420810Z-db1542cc-d57e-43a4-a37c-5d446c4b2661, 입력은 artifacts/verification/fs-5abfb085다. 공유 캐시 96c960bf...는 pending/producer 없음이고 generation 1e74c383-13c6-4bc0-8e73-d915a09f4a15의 종료 근거가 없어 해제·복구·삭제하지 않는다. 기존 자원과 격리된 명시적 --private-target으로 검증한다. 기존 target owner는 유지하며 디버그 심볼을 제외해 테스트 컴파일 디스크 사용을 줄인다. 이 전용 타깃과 사본은 사용 종료 후 소유자 절차로 삭제한다.

최초 격리 등록은 다른 작업의 정리 중 발생한 catalogSnapshot ENOENT로 생성 전에 실패했다. 소유자 catalog가 다시 정상으로 읽힌 것을 확인한 후 재시도했다. work db21e4d2-9f99-4f0c-ace7-158b42ac9865의 protocol 컴파일은 MASM A1009(출력 경로 길이)로 exit 101, 실행한 테스트 0개였다. run 20261104T032208903Z-1ab31af2-28e9-49b7-8ea7-235f2788e69f, 입력 fs-d4fb1b1c, sourceSha256 9ea0bdfc873bb4c37d412d4ec872f80f4de05123ba6a841fa06d2dc580ea0183. 전용 outputs를 artifacts/verification/ft-<고유값>/t로 짧게 지정하여 work 5b3f2371-b10e-434b-8b3f-d4823958800f로 재검증 중이다. 메모리 소유자의 4GiB admission 기준은 유지한다.
provider mapping 42개 검사(exit 0), scripts/test-cargo-verification.cjs 및 test-feature-preservation.cjs(exit 0), feature manifest 유효성 검사는 통과했다. 이는 native 기능이나 live API 수용 결과를 대신하지 않는다.

## 최종 구현과 검증

이미지 전용 attachments를 세 도구에 구현했다. path 입력은 기존 환경/권한 경계를 통해 이미지를 읽고 불변 사본을 자동 생성한다. attachment_id는 송신 세션의 등록 사본 또는 현재 이미지 이력에서만 해석한다. 일반 파일과 원격 URL은 거부한다. 원본 변경·삭제 후 ID 재사용, 실제 이미지 파트 전달, 평문/암호화 및 메시지 기동 의미를 보존한다.

첫 native 검증은 총 13개 테스트를 통과했다. 이후 최종 검토에서 삭제와 늦은 사본 저장의 경합 보장 부족을 확인했다. LocalThreadStore의 기존 writer 잠금과 live_writer_parts 검사를 재사용하고 실제 LiveThread fixture와 shutdown/discard 후 쓰기 거부 검사를 추가했다. 최종 소스는 새 고정 입력과 전용 출력으로 재검증했다(work 4795a800-2ae3-4e10-8f17-6c99dbdb09da). 종료가 확인된 첫 target은 dependency 참조로 보호하며 새 출력으로 복사했고, 종료 후 참조를 해제했다. 원래 target이나 실행 중 고정 입력은 변경하지 않았다.

최종 6개 필터, 총 14개 native 테스트(protocol 3, thread-store 2, core 9)가 모두 exit 0이다. provider mapping 42개와 Cargo/feature owner 검사, manifest 검사도 exit 0이다. 시작·종료 시각과 실제 counts는 verification.json에 보존한다. 검증 입력과 변경 소유 파일 17개의 일치 검사를 통과했다. 이후 작은 도구 파일 두 개는 내용 변화 없이 원래 CRLF만 복원했다. 설치·패키징·실제 provider API 호출·Linux/macOS/원격 실행 및 설치본에서 자식의 실제 이미지 인식은 미검증이다.

## 커밋과 정리 경계

작업 전부터 동일 protocol/session/tool/provider 파일과 인덱스에 role-profile·user-wait·provider 변경이 섞여 있다. 이미지 테스트 fixture 일부는 선행 미커밋 API에 의존한다. 이 작업만의 독립 검증된 커밋을 안전하게 분리하지 못해 기존 인덱스를 보존하고 커밋하지 않는다. 설치본 변경도 없다.

실패 및 성공 실행의 작업 소유 임시 소스·타깃·로그와 빈 작업 컨테이너는 소유 정리 도구로 삭제하고 실제 부재를 검증했다. 모든 FS-01 실행 소유 기록도 종료·정리했다. 정리 요청 파일 7개는 사용 종료 후 일반 삭제하고 부재를 확인했다. 유지하는 작업 산출물은 이 계획과 verification.json의 작은 수용 증거뿐이다. 기존 미확인 공유 캐시는 이번 작업 소유물이 아니며 변경하지 않았다.

최종 실행의 최초 정리 등록 및 마지막 소스 사본 삭제는 각각 공유 project-maintenance.json 변경으로 거부됐다. 현재 설정으로 해당 등록 또는 검토만 재시도한 뒤 같은 소유 도구로 삭제했다. 보호 검사나 삭제 경계를 우회하지 않았다. 실제 항목별 결과와 알려진 논리 크기는 verification.json에 보존하며, 논리 크기를 실제 디스크 회수량으로 주장하지 않는다.

