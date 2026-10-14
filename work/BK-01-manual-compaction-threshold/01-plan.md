상태: 소스 수정 및 범위 내 검증 완료. 빌드·설치 미수행. 사용자 추가 입력 없음.

수동 압축 실행의 최소 컨텍스트 기준을 100,000에서 80,000토큰으로 변경한다. 80,000 미만은 건너뛰고 정확히 80,000부터 실행한다. 자동압축 설정은 유지한다.

공통 요구: Windows x64, Linux x64, macOS ARM64의 공유 Core 및 호스트 안내 문구. 실제 검증은 Windows 소스/렌더링 검사이며 다른 OS와 설치본은 미검증이다.

구현: engine/의 compact_input.rs와 기존 경계/실행 테스트, scripts의 안내 변환 및 관련 테스트/렌더링 기대값, queued-compaction 설계와 코드 맵을 함께 갱신한다. 기존 unknown/negative 처리와 queue admission은 보존한다. 기존 사용자 변경은 보존한다.

검증: 기존 Node 수동 압축 테스트 및 밝은/어두운 테마 렌더링. Core 판정 함수와 기존 exact_threshold_and_invalid_data 테스트를 추출해 rustc로 독립 실행한다. 전체 Core 비동기 세션 테스트는 실행하지 않는다. 전체 앱 빌드/설치는 요청 범위에 포함하지 않는다. 작업 변경만 커밋한다.

결과: 수동 압축은 80,000토큰 미만에서 skip, 정확히 80,000부터 실행한다. 한/영 토스트와 경계/실행 테스트를 갱신했다. 기존 ui.queued-compaction 보존 항목과 설계 절에 Core/호스트 테스트 소유자를 연결했다.

Windows 검증: Node 수동 압축/큐 18개, cache-owner 7개 통과(exit 0). production 판정 함수 및 기존 경계 테스트를 rustc 독립 harness로 실행해 1개 통과(컴파일/실행 exit 0). 이는 전체 Core 세션 통합 검증이 아니다. 밝은/어두운 native toast/React/CSS, 한/영, 반복 요청, 키보드 닫기 7개 검사 통과(exit 0). 로그: artifacts/logs/manual-compaction-threshold/, artifacts/logs/compaction-skip/ui/summary.json. 임시 Rust harness/exe와 브라우저 fixture/profile은 제거 확인했다. CRLF를 허용한 scoped diff 검사 통과. 전체 Core 비동기 테스트, Linux/macOS, 패키지/설치본은 미검증이다.
