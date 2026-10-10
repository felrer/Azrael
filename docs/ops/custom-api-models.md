# 사용자 API 모델 연결

Status: `partial` — 설정·helper·picker의 로컬 검증 범위. 설치된 Azrael과 실제 서버의 결합 검증은 별도로 수행한다.

## 등록과 선택

명령 팔레트의 `Azrael: API 연결 관리` 또는 계정 및 사용량 화면의 API 연결 영역에서 연결을 추가한다. 최초 목록과 주소 입력은 비어 있다. 연결 이름, 사용자가 접근 가능한 API base URL, Chat Completions 또는 Responses 규격, 인증 방식을 입력한다. base URL은 API 경로의 부모 주소이며 helper가 `/chat/completions`, `/responses`, `/models`를 붙인다. Responses 전체 경로도 추론에 사용할 수 있으나 모델 조회를 사용하려면 부모 주소를 지정한다.

Bearer 키는 운영체제 비밀 저장소에 저장하며 기존 키를 화면에 다시 표시하지 않는다. 로컬 토큰 파일은 절대 경로로 지정한다. HTTP 주소는 TLS로 보호되지 않으므로 해당 서버와 경로를 확인한 후 사용한다. 터널이나 서버는 자동으로 시작하지 않는다.

모델 ID를 수동으로 등록하거나 명시적으로 모델 목록을 조회한다. 조회는 `/models` 요청만 수행한다. 조회 결과만으로 도구 지원을 확정하지 않으며 모델의 context, 출력 한도, 도구 지원과 요청 옵션을 직접 설정한다. 검증되지 않은 서버는 비스트리밍·thinking 비활성·병렬 도구 비활성으로 시작한다. 도구 지원을 끈 모델은 텍스트 전용으로 실행한다.

모델 선택기의 `API` 그룹에서 `연결 이름 · 모델 이름`을 선택한다. subagent에는 카탈로그의 정확한 `api/<connection-id>/<remote-model-id>` 키를 전달한다. 원격 모델 ID에 포함된 슬래시를 보존한다. 역할에 고정된 모델이 있으면 역할 설정이 우선한다.

## 변경과 진단

thinking 파라미터 전송은 기본으로 꺼져 있다. Qwen처럼 해당 옵션을 지원하는 서버에서 thinking을 끄려면 `thinking 파라미터 전송`을 선택하고 `enable_thinking`은 선택하지 않는다. 일반 서버에는 해당 확장 필드를 보내지 않는다. Responses SSE의 텍스트는 완료 응답에서 전달한다.

표시 이름은 바꿀 수 있다. 모델과 요청 옵션 변경은 다음 턴에 적용하며 진행 중인 요청의 설정을 바꾸면 해당 요청을 종료한다. 연결 주소·인증 identity가 바뀐 기존 대화는 오류를 반환하므로 새 대화에서 변경된 연결을 사용한다. 연결 비활성화·삭제는 실행을 중단하며 다른 provider로 자동 전환하지 않는다.

오류는 안전한 코드와 HTTP 상태만 표시한다. 서버의 원문 오류 본문이나 API 키를 진단 로그에 복사하지 않는다. `api_connection_missing`, `api_model_missing`, `api_secret_unavailable`, `api_connection_changed`는 등록·모델·인증·기존 대화 identity를 각각 확인한다. `provider_request_deadline`은 연결의 제한시간과 서버 응답을 확인하며 자동 재시도를 하지 않는다.

Qwen의 서버 측 PASS 결과는 Azrael 연동 시험과 구분한다. 사용자가 등록한 주소에서 모델 조회, 비스트리밍 도구 call/result 왕복, subagent 생성·후속 지시·중단·완료를 검증한 뒤 실제 사용 범위를 확정한다. GPU 경로·context·streaming·thinking·병렬 도구 변경은 각각 재검증한다.

구조와 저장 계약은 [사용자 API 모델](../architecture/custom-api-models.md)을 참조한다.
