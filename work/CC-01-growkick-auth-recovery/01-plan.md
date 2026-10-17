상태: 기존 인증 복구 완료. 화면 반영과 실제 추론은 미확인.

목표와 범위: Windows 로컬 GrowKick VS Code 창에서 기존 OpenAI 계정을 정상 선택 경로로 복원. 다른 창 종료, 자격 증명 복사, 앱 코드 변경 및 빌드는 수행하지 않았다.

원인과 확인 범위: 계정 선택이 null이고 requiresRecovery=true인 상태로 저장되어 있었다. 새 로그인은 다른 창이 사용 중인 인증의 교체 잠금에 차단되었다. 최초 계정 비가용 판정의 원인은 확정하지 않았다.

복구: 설치된 2026.0.8/w31b의 정상 companion bridge와 azrael/account switch를 사용하여 직전 GrowKick 선택 프로필 1a426129343eb39d4d53452b3edc2087을 다시 선택했다. 등록된 소유자, 실제 extension host PID, 바이너리 SHA-256 검증을 통과한 연결에서만 처리했다. 인증 토큰을 출력하거나 직접 변경하지 않았다.

검증: 복구 명령 및 별도 연결의 재조회 모두 exit 0. account/read에서 기존 ChatGPT Pro 계정을 인식했고, 재조회 activeProfileId가 기존 프로필과 일치하며 lastError=null이다. GrowKick 현재 세션 및 workspace default 선택 파일 모두 selectedProfileId 일치와 requiresRecovery=false를 확인했다. 실제 추론이나 reload 재현, 화면 반영 및 다른 OS는 검증하지 않았다.

보존: 기존 계정/인증 선택 계약의 운영 복구이므로 아키텍처 변경 없음. 실행에 사용한 일회성 recover.cjs는 검증 후 일반 삭제하고 이 기록만 보존한다. 토큰/키/인증 저장소를 작업 산출물로 복사하지 않았다.
