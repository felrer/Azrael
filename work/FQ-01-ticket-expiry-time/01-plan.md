상태: 소스 수정·검증·임시 산출물 삭제 완료. 패키징·설치는 별도 요청 범위.

# 티켓 만료 시각 표시

- 권한: 티켓 상세에 정확한 소멸 시각 표시. 소스 수정·검증이며 패키징/설치는 별도.
- 기존 Unix 초 `expiresAt`과 표준 `toLocaleString` 재사용. 본문/tooltip에 현지 연·월·일·시·분·초·시간대 표시. null 생략과 사용/확인 동작 보존.
- 범위: Windows x64/Linux x64/macOS ARM64 공통 표시. Windows x64에서 검증하며 다른 OS와 설치본은 미검증.
- 소유/순서: root가 usagePresentation.ts, 기존 테스트, accounts.md 변경 → 메모리 TypeScript 변환으로 관련 테스트와 기존 standalone/embedded light/dark 좁은 폭 렌더링 검사 → owner 기반 정리 → 작업 변경만 커밋.
- 성공 기준: 본문에 정확한 초·시간대, null 생략, 기존 티켓 선택/소비 동작과 좁은 폭 레이아웃 유지.
- 보존: 기존 ui.account-settings 매핑 재사용. 향후 날짜 표시 단순화 시 시각 재누락 방지를 위해 기존 티켓 테스트에 최소 단언 추가.
- 검증: Windows x64, Node 26.7.0. 최신 TS를 메모리에서 CommonJS로 변환하여 usagePresentation/usageTicketView 19개 통과(exit 0). 첫 시도는 소스 경로 기준 media 해석 오류, 다음은 한국어 시각 구분자에 대한 테스트 가정 오류로 수정 후 재실행했다.
- 타입 검사: extension 디렉터리에서 `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit --incremental false` 통과(exit 0). 앞선 수동 TypeScript API 호출은 상대 config 경로 해석 오류로 실패해 정식 CLI로 재확인했다.
- 렌더링: `scripts/verify-ticket-usage-render.mjs`를 메모리 TS 로더와 실행. standalone/embedded × light/dark × 390/1000px, 145개 검사 통과(exit 0). 좁은 폭 light/dark 스크린샷 육안 확인: 현지 연·월·일·시·분·초·GMT+9 표시와 줄바꿈 정상. 모든 조합 가로 overflow false, 기존 선택/확인/재시도 보존. 실제 계정 소모 없음.
- 실행: 렌더링 run `20261103T114233966Z-b45ca9f5-ee31-499f-bd7f-5ea228bc2e34`, 20:42:33–20:43:00 KST. 브라우저 exit 0 및 소유 프로세스 잔류 없음 확인. producer complete/stopped, 참조 없음. 원본 로그·스크린샷·프로필은 검토 후 동일 run 소유자로 삭제하며 이 문서가 최소 검증 근거를 보존한다.
- 임시 계획 본문 삭제 확인. 설치본·실계정·다른 OS 검증 및 패키징·설치는 수행하지 않았다.
- 정리: 첫 register가 공유 catalog 잠금 경합으로 exit 1, pre-intent 예약 유지. 정확한 실행 종료(exit 1)와 in-process CLI 경계를 확인하고 recovery-evidence.json에 소유자/SHA를 고정했다. 지원되는 recover_reservation이 reservation_recovered를 반환했고 원래 실행 결과·intent는 바꾸지 않았다. 대기 한도 600000ms를 명시한 새 register와 registered review 통과: blockers/references 없음, 74,689,484 bytes. 검토 토큰으로 apply exit 0, group/item deleted, remaining false. 잠금 파일은 수정하지 않았다. recovery-evidence.json은 독립적인 복구 영수증의 참조 근거로 보존한다.
