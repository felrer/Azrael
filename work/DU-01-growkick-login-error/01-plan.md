상태: growkick 계정 선택 및 채팅 화면 복구 완료. 사용자 추가 조치 없음.

# growkick 로그인 오류

목표/권한: 원인 조사, 최소 수정과 복구·검증. 다른 창의 작업과 자격 증명을 보존한다.

범위: Windows x64 로컬 VS Code w13r-99afefb1. 공통 코드 변경 시 Windows 회귀를 수행하며 다른 플랫폼 검증은 별도로 구분한다.

증거: 실행 소스 artifacts/inputs/dm01-w13r/project/engine. growkick 기본 선택과 최신 창 선택은 selectedProfileId=null, requiresRecovery=true이다. 기본 OAuth 로그인은 lock_azrael_unmanaged_mutation 독점 입장을 요구하여 다른 창 공유 lease가 있으면 첨부 오류로 거절된다. 계정 선택은 별도 azrael/account switch 경로로 공유 사용을 지원한다.

접근: 기존 유효 계정 선택으로 복구하고 growkick UI 로그인 상태 확인. 자격 증명 삭제나 다른 창 종료는 하지 않는다. 코드 문제 발견 시 관련 소스/회귀 범위를 확정 후 수정한다.

성공 기준: 원인과 복구 결과를 증거로 설명하며 미검증 범위를 구분한다.


## 복구 및 검증
- Window Use로 growkick 창을 확인하고 명령 팔레트의 계정 및 사용량 화면을 열었다.
- 직전 유효 세션에서 선택됐던 동일 프로필의 이 계정으로 전환을 실행했다. 현재 로그인 배지와 상태 표시줄이 복원됐으며 기본 선택 JSON의 selectedProfileId가 해당 프로필로, requiresRecovery가 false로 저장됐다.
- 채팅 패널은 즉시 반영되지 않아 growkick 창 다시 로드를 수행했다. 이후 로그인 화면이 사라지고 대화 목록, 입력창, 모델 선택이 표시됨을 실제 화면으로 확인했다.
- 자격 증명/lock 직접 변경, 다른 창 종료, 제품 코드 변경은 없었다. 최초 복구 필요 상태가 저장된 원인은 현재 증거만으로 확정하지 않는다.


- 검증 환경: Windows x64 설치 실행 w13r-99afefb1. 실제 모델 호출·새 OAuth 로그인은 수행하지 않았다. 제품 소스 변경이 없어 빌드·회귀 테스트는 해당하지 않는다.
- 임시 plan body는 일반 Remove-Item으로 제거했다. 작업 파일은 이 기록 하나이며 향후 동일 상태 진단을 위한 증거로 유지한다.
- 오류 직접 원인: 복구 필요 상태에서 기본 ChatGPT 로그인을 시도해 공용 자격 증명 독점 mutation 입장이 다른 창 공유 lease와 충돌했다. 최초 계정 unavailable의 원인과 채팅 패널 즉시 갱신 누락은 별도 미확정 사항이다.
