# 상세 진단 로그 제어

Status: `partial` — Windows에서 엔진·helper·호스트 소스 회귀 검증을 통과했다. 다른 OS와 설치된 배포본 적용은 별도다.

## 정책

상세 진단은 기본 활성 상태다. 프로세스 환경의 `AZRAEL_DIAGNOSTICS`로 전체 상세 진단을 제어하고, 기능별 환경변수로 해당 분야만 덮어쓴다. 값은 앞뒤 공백과 대소문자를 무시하며 `on`, `true`, `1`은 활성, `off`, `false`, `0`은 비활성이다. 전체 값이 없거나 잘못된 값이면 활성 상태를 유지한다. 분야 값이 없거나 잘못된 값이면 전체 정책을 따른다.

| 분야 환경변수 | 제어 범위 |
| --- | --- |
| `AZRAEL_DIAGNOSTICS_INFERENCE` | helper transport 상세 계측과 엔진의 반복 progress/transport 진단 기록 |
| `AZRAEL_DIAGNOSTICS_TOOLS` | 카탈로그·스키마 분석 및 도구 호출 상세 계측·기록 |
| `AZRAEL_DIAGNOSTICS_RECOVERY` | 호스트 RPC와 정상 메시지 처리의 반복 진단 기록 |
| `AZRAEL_DIAGNOSTICS_UI_INPUT` | webview 입력 진단의 수집·전송 |
| `AZRAEL_DIAGNOSTICS_UI_HEALTH` | Webview 부팅·오류·드래그·응답 신호의 상세 수집·전송; 호스트가 이미 확인한 생성 실패·준비 시간 초과의 오류 기록은 유지 |
| `AZRAEL_DIAGNOSTICS_ACCOUNTS` | provider 계정 helper 요청의 정상 시작·완료 기록 |

환경은 호스트, 엔진, helper 경계에서 상속한다. 실행 중인 프로세스의 환경을 변경하는 UI는 제공하지 않으며 변경 후 관련 프로세스를 재시작한다. 일반 빌드에 진단 코드가 포함되므로 재빌드 없이 다시 활성화할 수 있다. 자동 만료와 진단 전용 빌드는 이 계약에 포함하지 않는다.

## 보존하는 동작

비활성화는 선택적 계측 생성과 기록 경계에서 적용한다. 카탈로그·도구 해시와 상세 관찰은 꺼진 상태에서 계산하지 않는다. 오류 분류에 필요한 최소 단계 정보는 선택적 transport 계측과 분리한다.

진행 프레임과 유효성 검증, generation inactivity 및 thinking heartbeat 판정, timeout, 도구 검증·실행, 복구·계정 상태와 대화 기록은 계속 동작한다. 실패·경고 및 주요 실행 결과를 보존한다. 로깅 여부는 실행 권한이나 오류 결과를 바꾸지 않는다.

기존 tracing/SQLite 및 VS Code 로그 채널과 보관 정책을 재사용한다. `RUST_LOG`는 stderr 출력 필터이므로 이 수집 정책을 대신하지 않는다. upstream의 모든 로그와 외부 code-mode-host 바이너리 내부 로그를 끄는 설정은 아니다.

모델 오류는 [근거 기반 오류 분류](managed-providers.md#evidence-based-error-classification)를 따른다. HTTP 상태만으로 제한의 종류를 추측하지 않으며, 상세 진단에는 허용된 오류 유형·사유·본문 판독 결과와 검증된 제한 수치·헤더만 보존한다. 분류되지 않은 오류의 사용자 문구는 `정의되지 않은 오류`다. 공급자의 종료 사유와 refusal 범주도 `provider_stop_reason`·`provider_refusal_category`의 닫힌 허용값으로만 보존한다. 명시적 null은 unspecified, 누락은 missing, 미지원 값은 unknown으로 구분한다. refusal 판정은 상세 진단의 활성 여부와 독립적이다. 원문 본문과 인증 정보는 기록하지 않는다.

정책은 Windows x64, Linux x64, macOS ARM64의 공통 실행 경계에 적용한다. OS별 환경 전달과 설치된 패키지 검증은 별도이며, 소스 테스트를 다른 OS의 설치 수용 근거로 사용하지 않는다. 실제 사용 절차는 [네이티브 진단](../ops/native-diagnostics.md#상세-진단-켜기끄기)에 둔다.
