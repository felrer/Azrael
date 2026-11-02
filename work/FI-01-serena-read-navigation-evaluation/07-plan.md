상태: 구현·실제 Serena 검증 완료, 임시 환경 정리 중 — 제품 기본 연결 미실시.

# ID 목록과 선택 원문 읽기로 도구 단순화

사용자는 개요·role·type·parent·선택적 펼침을 제거하고 해당 스크립트 ID 목록에서 고르는 도구 제작과 설명을 요청했다. 코드의 해시 ID만으로 선택하기 어렵다는 사실을 설명한 뒤, 기존 조회가 지원하는 함수명/심볼 경로를 목록에 반환하고 해시는 내부 변경 검증에만 사용하는 방안을 명시 승인받았다.

대상은 유지 중인 실험용 scripts/serena-read-tools.py다. list_ids(relative_path)는 해당 파일의 전체 심볼 경로 문자열 배열만 반환한다. read_symbols(selections:[{relative_path,id}])는 단일·다중/파일간 선택을 같은 호출 형태로 읽고 원문과 선택 ID·파일만 반환한다. 내부 파일 identity 검증, 경로 containment, 중복 본문 제거·개별 오류·batch 중 버전 혼합 거부는 보존한다. 해시/종류/위치/설명은 선택 목록에 노출하지 않는다. 이름을 알면 list_ids를 거치지 않고 읽을 수 있다. 구조 펼침·depth/role/signature/추가 모델 호출/TypeScript 메타데이터 subprocess는 제거한다. API를 실제 Azrael tool catalog/MCP에 등록하거나 제품을 배포하는 것은 이번 범위가 아니다. Blender/SVG/HTML adapter 연결도 이번 코드 어댑터 구현으로 검증됐다고 주장하지 않는다.

기존 metadata 모듈과 전용 검사는 현재 소비자를 확인한 뒤 제거하고, adapter 검사는 새 두 동작과 이름/원문/안전성 계약에 맞게 갱신한다. root는 계약·adapter·실제 Serena 통합·설명·정리, 독립 executor가 필요하면 test 파일만 소유한다. 공유/동시 변경 보존. 공통 Python 로직이며 Windows x64에서 실제 검증, 다른 OS는 미검증이다. 이전처럼 Serena2.1.0을 검증 환경에 고정하고 실제 provider의 이름/계층/본문 동작을 확인한다. 기존 설치·stdlib·native API를 먼저 재사용한다.

검증은 ID-only 목록/중첩 메서드 목록/기존 이름 경로로 직접 단일·파일간 일괄 읽기/원문 정확성/중복/없는 이름·모호성/파일 변경/파일 경계다. 유지 검사는 후속 단순화에서 외부 설명 생성 의존성이나 stale·혼합 원문 누출을 재도입할 수 있는 구체적 편집을 방지하는 최소 계약 검사로 한정한다. 성능 우위나 모델 행동 개선 측정은 이번 요청에 없으므로 도구 실제 동작과 설명에 집중한다.

임시 venv·pip/LSP cache·fixture·log는 생성 전 lifecycle run:serena-read-eval:20261103:r4(owner work:serena-read-eval), artifacts/verification/sr04에 예약했다. 종료·참조·보존 근거 확인 후 owner register/review/apply/finalize로 모두 삭제한다. 유지 산출물은 adapter/직접검사/이 작업 기록이며 제품 미연결이므로 enduring 제품 architecture/feature inventory 변경은 없다. development-workflow·implementation·testing 및 project work/cleanup 절차를 적용하고 검증·정리 뒤 task-level 로컬 commit한다.

## 구현 계약과 사용법

공개 동작은 두 가지다. 기존 API의 문자열 심볼 경로를 ID로 사용하며 새로운 설명/역할/이름을 생성하지 않는다. Serena가 제공하는 overload 인덱스(`[0]` 등)와 `Class/method` 같은 경로도 그대로 반환한다. ID 목록은 한 파일에 한정하고, 파일 안의 전체 일치 심볼을 반환하며 깊이 인자나 단계별 펼침은 없다. 해시/타입/상위 대상/시그니처/설명/줄 번호는 목록에 없다.

```python
reader = SerenaReadTools(api, project_root)

# 예시: 해당 파일의 심볼 경로 문자열 배열만 반환
reader.list_ids("app.js")
# ["createSession", "Client", "Client/connect"]

# 이름을 이미 알면 목록 없이도 가능. 하나·여러 개 모두 같은 형태.
reader.read_symbols([
    {"relative_path": "app.js", "id": "createSession"},
    {"relative_path": "app.js", "id": "Client/connect"},
])
```

read_symbols는 `results`(request_index/relative_path/id/body), `errors`(request_index/error), `duplicates`(중복 요청의 원래 index와 ID/파일)를 반환한다. `body`는 선택한 심볼의 Serena 원문으로 자르거나 요약하지 않는다. 본문을 여러 번 출력하지 않도록 같은 파일·ID의 중복만 구분하며, 서로 다른 파일의 같은 ID는 각각 읽는다. 조회는 `/`가 붙은 native full-path exact match로 실행하여 suffix로 잘못 선택하지 않는다. 없는 ID나 모호한 native 결과는 추측하지 않고 오류로 반환한다.

파일 SHA256은 reader 인스턴스 안에서만 사용한다. 목록 이후 파일이 바뀌면 read가 거부되고 새 list_ids로 갱신한다. 목록 없이 알려진 ID를 읽을 때도 조회 전후/일괄 읽기 종료 시 파일 identity를 확인한다. batch 중 바뀐 파일의 성공·중복 결과는 전부 폐기하고 다른 파일의 유효한 결과는 유지한다. 프로젝트 밖·상위 경로·없는 파일은 허용하지 않는다.

SerenaReadTools의 Node/TypeScript metadata subprocess와 overview/structure 확장 구현을 제거했다. 소비자가 사라진 scripts/serena-read-metadata.cjs 및 전용 test-serena-read-metadata.cjs도 제거했다. Serena 자체의 JS/TS language server 실행에 필요한 Node 등은 별개이며 제거했다고 주장하지 않는다. 직접 검사7개를 새 계약에 맞게 유지하며, 임시 runtime/config/cache를 제품 의존성이나 설치 상태로 남기지 않는다.

## 검증 결과

- Windows x64, 격리 venv의 serena-agent2.1.0 및 실제 LspApi/JS language server를 사용했다. 단위검사7개 exit0, 실제 통합 probe exit0. 테스트를 모의 echo만으로 끝내지 않았다. 비ASCII/이모지가 포함된 exports/전역함수/중첩 메서드, 사전 목록 없는 직접 읽기·파일간 동명 배치·중복 제거·파일 변경 거부 및 새 목록 후 회복을 확인했다.
- 실제 최초 목록은 ["Box", "Box/shared", "shared"]였다. 일반 source 파일의 native 심볼 이름에서 얻었으며 Agent가 role/의미 라벨을 미리 작성하지 않았다. 목록 생성이나 원문 반환에 설명 생성 모델 호출은 없다.
- 공개 입력은 파일 경로와 ID 선택뿐이다. 내부적으로는 Serena native get_symbols_overview가 주는 원시 심볼 트리를 iter_children로 한 번 순회해 경로만 수집한다. native API의 이름에 overview가 있지만 그 렌더링/설명/단계별 펼침을 사용자 도구로 노출하지 않는다. depth는 public API에 없고 전체 트리를 반환한다. 읽기는 full-path exact find_symbol(include_body=True)을 재사용한다.
- 실제 연동 중 준비 오류2개를 발견·수정했다. 첫 probe는 초기화 비동기 완료를 기다리지 않아 manager not initialized(exit1)였고 FIFO task 완료 대기로 교정했다. 다음 probe는 find_symbol 빈 패턴이 native API에서 AssertionError로 거부돼(exit1) 목록 획득을 native get_symbols_overview/iter_children로 교정했다. 각 실패의 프로세스 정상 종료 확인 후 다음 실행을 시작했다. 단위 mock 역시 실제 API 표면에 맞게 수정했고 최종7개를 다시 통과했다. 실패 기록을 성공으로 바꾸지 않았다.
- 최종 probe는 on_shutdown 정상 반환, LSP shutdown/exit 응답 및 종료 exit0, PID+create_time을 가진 자식 process5개 모두 종료를 확인했다. root도 sr04 관련 명령행 process0개를 새로 확인했다. 단위 임시 폴더7개 cleanup 완료. root 보고서 작성의 첫 stdin은 PowerShell 기본 인코딩으로 파싱 실패(무변경)하여 UTF8 파일 실행으로 교정했다.
- 다른 OS/언어 및 모델을 돌린 호출·출력량 비교는 이번에 측정하지 않았다. 앞선 창작 작업 adapter의 Blender/SVG/HTML 연결이 이 코드 도구로 검증된 것은 아니다. Azrael 기본 tool catalog/MCP 연결·설치·배포는 변경하지 않았다. 유지 검사7개는 이후 응답 확장·메타데이터 재도입 또는 파일 identity 처리 변경에서 최소 목록/정확 원문/혼합 버전 거부를 누락하는 편집을 방지한다. 삭제한 metadata 전용 검사는 제거된 기능에만 속하며 제품 mandatory 검사나 다른 테스트로 대체됐다고 주장하지 않는다.

### 독립 보존 검증 근거

임시 환경 삭제 후에도 입력/실제 결과/정상종료를 확인할 수 있도록 아래 근거를 이 작업 기록에 보존한다. 대용량 raw log/runtime/cache는 별도 유지하지 않는다.

```json
{
  "sources": [
    {
      "file": "scripts/serena-read-tools.py",
      "sha256": "448c00bfc5fb21025ec48f30cbb97d9e3ba6cd269c9bee2bb76c14b2f51d5202",
      "lines": 112
    },
    {
      "file": "scripts/test-serena-read-tools.py",
      "sha256": "817068502299d97805a157677f1448182bf357d6821ef8798a4c550f092caf55",
      "lines": 151
    }
  ],
  "unit": {
    "tests": 7,
    "exit_code": 0,
    "summary": "Ran 7 tests in 0.066s; OK"
  },
  "integration": {
    "status": "passed",
    "checks": {
      "known_id_without_listing_exact_body": true,
      "native_overview_includes_nested": [
        "Box",
        "Box/shared",
        "shared"
      ],
      "list_ids_matches_provider": [
        "Box",
        "Box/shared",
        "shared"
      ],
      "cross_file_batch_nested_exports_unicode_exact_bodies": true,
      "source_change_refused": "File changed since list_ids; request list_ids again",
      "relisting_recovers": true
    },
    "isolation": {
      "SERENA_HOME": "C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\verification\\sr04\\integration-fixture\\serena-home",
      "TEMP": "C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\verification\\sr04\\integration-fixture\\tmp",
      "TMP": "C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\verification\\sr04\\integration-fixture\\tmp",
      "npm_config_cache": "C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\verification\\sr04\\integration-fixture\\npm-cache",
      "PYTHONPYCACHEPREFIX": "C:\\Users\\felre\\Desktop\\pi-harness-init\\artifacts\\verification\\sr04\\integration-fixture\\pycache"
    },
    "shutdown": {
      "children_before": [
        {
          "pid": 25580,
          "created": 1793659754.8386223,
          "name": "cmd.exe"
        },
        {
          "pid": 32908,
          "created": 1793659754.8474512,
          "name": "conhost.exe"
        },
        {
          "pid": 11872,
          "created": 1793659754.897068,
          "name": "node.exe"
        },
        {
          "pid": 31168,
          "created": 1793659755.0013092,
          "name": "node.exe"
        },
        {
          "pid": 32060,
          "created": 1793659755.0096655,
          "name": "node.exe"
        }
      ],
      "owner_shutdown_returned": true,
      "children_remaining": []
    },
    "exit_code": 0
  },
  "root_stop": {
    "checked_at": "2026-11-02T22:49:32.1491267Z",
    "related": []
  },
  "evidence": [
    {
      "file": "unit-tests.log",
      "bytes": 110,
      "sha256": "5b52c8094e879124661e537cbf44aea298cb155a1eac99263b7272886d650021"
    },
    {
      "file": "integration.py",
      "bytes": 6716,
      "sha256": "756c72f8010e5b55d8cc76181e10afe80105a9ecc77321000c4fd28a0b250973"
    },
    {
      "file": "integration.log",
      "bytes": 11220,
      "sha256": "7f7cfb34b00e1ff537d9f42bdf6230584ce2ea99dbd200fe2d1122631fcd1267"
    },
    {
      "file": "integration-result.json",
      "bytes": 1825,
      "sha256": "fabf2cb377cfc9b5c501025fd7f2a6cdbb02aa884534db8606d89ad4369b7d31"
    },
    {
      "file": "integration-fixture/failure-empty-pattern.log",
      "bytes": 15269,
      "sha256": "58bebffddebd84d1b9635a28a75a33cd0cac530897f7f8b99a293b3a544f22e3"
    },
    {
      "file": "integration-fixture/failure-empty-pattern-result.json",
      "bytes": 3268,
      "sha256": "233cfbf2831838765341ea23e26331c1123b727f9c109fb4356b491c3f4a2a98"
    },
    {
      "file": "process-stop-verification.json",
      "bytes": 101,
      "sha256": "7238167709fefe8b922a2c62cb8bf15cb02a6b02e9cfba23fac6280b463046a1"
    },
    {
      "file": "install.log",
      "bytes": 37128,
      "sha256": "930a5cff906879ee72fa7094f1781c48b130b2c26f55806464c66fab55868435"
    }
  ]
}
```
