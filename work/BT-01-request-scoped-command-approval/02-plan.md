상태: 소스 구현과 Windows 검증 완료 — 생성물 정리 대기. 빌드·설치는 사용자가 나중에 진행하기로 함.

# 전체 액세스 삭제 정책 복구

기존 정책에서 허용하던 삭제는 승인 없이 통과시키고, 위험 삭제 분류로 차단되던 호출은 사용자 승인 대상으로 바꾼다. 명시적 금지 및 다른 위험 명령은 유지한다. 기존 자동 승인 patch 삭제도 복구한다. Windows x64, Linux x64, macOS ARM64의 공통 정책이며 플랫폼별 명령 분류를 유지한다. 설치나 배포는 별도 권한이다.

기존 exec policy 평가와 위험 명령 분류를 재사용해 명시적 정책과 혼합 명령을 보존한다. 엔진, patch, 기존 회귀 테스트 및 소유 아키텍처를 변경한다. Windows에서 일반 삭제·기존 위험 삭제·명시적 금지·혼합 명령 및 patch를 검증하고 다른 플랫폼은 분류 단위 검증의 범위를 기록한다. 설치본의 동작은 소스 검증과 구분한다.

## 검증 및 남은 작업

Windows x64: `node scripts/check-deletion-approval-host.cjs` 26개 통과(종료 0). 최종 native 검증 `node scripts/check-deletion-approval-native.cjs` 분류 57개, exec policy 91개, patch 24개 통과(종료 0; 2026-10-29 09:00–09:19 KST). Unix 전용 승인 라우팅 테스트는 Windows에서 실행되지 않는다. 이전 시도는 실행기 시간 제한 124와 Unix 전용 테스트 선택 0개로 실패했고 최종 재실행은 수정 후 완료됐다. Linux·macOS 실기 및 설치된 앱은 미검증이다. 생성물 정리와 task commit은 미완료다. standalone maintenance_owner 등록을 두 번 시도했으나 catalog OS 잠금 점유로 거절됐다. 초기 제한시간 종료 run은 producer 구성 확정이 안 되어 보호 중이다. 현재 설치본을 변경하지 않았다.

정리 재시도에서 대상에 active-cleanup-reservation이 확인됐다. 예약의 현재 소유와 종료 근거를 확인하기 전에는 제거하거나 우회하지 않는다.

정리 재시도: 첫 완료 run의 등록 예약 복구와 두 번째 완료 run 등록이 maintenance OS 잠금 점유로 거절됐다. 두 run 모두 해당 등록 예약이 남아 있으며, 초기 시간 초과 run은 구성 확정이 안 됐다. 증거: artifacts/maintenance/evidence/bt-deletion-registration-stop-15176.json. 요청 임시 파일 2개는 삭제와 부재를 확인했다. 잠금 해제와 각 예약의 정확한 종료 근거 확인 후 owner 절차로 복구·등록·심사·삭제한다. 앱 빌드·설치는 보류한다.
