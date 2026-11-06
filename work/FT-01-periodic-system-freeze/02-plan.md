상태: 전체 빌드 절차의 필요성과 비용을 감사 중. 새 복사·빌드는 보류하고, 근거가 있는 개선안을 제시하여 사용자 승인 후 하나씩 적용한다. 최종 빌드·사용자 프로필 설치 목표는 유지한다.

# 현재 변경 통합 빌드 및 사용자 프로필 설치

## 목표와 권한

사용자는 지금까지 변경사항 전부를 반영한 빌드와 사용자 프로필 설치를 명시적으로 요청했다. 현재 tracked/untracked/deleted 입력을 기존 소유자의 immutable input과 작업 사본으로 고정하고 동일 입력으로 검증·패키징·설치한다. 이후 primary의 동시 수정은 이 빌드에 섞지 않는다. 현재 설치 2026.0.16, 소스 버전 설정 2026.0.17. 로컬 Windows x64/일반 VS Code 사용자 프로필과 ~/.azrael-ex 상태를 대상으로 하며 Linux/macOS 빌드, 원격 게시·push는 범위 밖이다.

## 전체 빌드 비용 감사

사용자는 입력 준비부터 검증·패키징·설치·정리까지 각 단계의 필요성과 합리성을 의심하며 조사하고, 개선안을 제시하여 승인받은 뒤 적용하는 과정을 반복하도록 요청했다. 읽기 전용 코드·기존 실행 기록 조사가 현재 권한이며 새 개선 구현은 승인 후 수행한다. 이미 실행 중이던 L 삭제는 종료 결과까지 확인했으며 새 M 준비는 시작하지 않았다.

검토 순서: 입력 고정·복사와 중단 복구 → 검사 선택·재사용과 단계 병렬도 → 엔진/모듈 빌드 → UI·플러그인 준비 및 최종 검증 → 설치·복구 자료·정리. 각 단계마다 목적, 실제 비용, 중복 여부, 제거·축소 위험, 권고안, 승인 여부와 효과 검증을 같은 기록에 남긴다. 검증되지 않은 예상 절감은 실측과 구분한다.

시간 비교 방침(사용자 지시): 이후에는 새 버전만 측정하고 기존 버전의 시간은 이미 확보한 측정값을 재사용한다. 비교를 위해 기존 구현을 다시 실행하지 않는다. 입력 크기·환경·캐시 조건이 다른 과거 측정은 차이를 명시하고 직접적인 배율이나 절감 시간으로 단정하지 않는다. 이 지시 전에 완료한 속도 2차 소형 비교 결과는 그대로 사용한다.

### ZIP의 이미지·폰트 재압축 생략(사용자 승인)

기능 단위 커밋 `0b24a7f527918abed132628e4bf13c2de07eb6e5`: writer·검사와 이번 패키징 문서/기능 목록 변경만 포함했다. 기존 다른 staged 39개는 그대로 보존했다.

이번 정리 완료: 한 소유 묶음의 측정 ZIP·임시 Git index·원시 로그 729,400,435B를 optimized standalone의 registered review/apply로 삭제했다(actual exit0, deleted/remaining=false/error=null). 독립 결과 요약은 이 기록에 남겼으며 기존 K 입력·이전 기준 ZIP·5장 이미지 비교 HTML은 변경하지 않았다.

`package-local-host.cjs`의 pinned yazl 2.5.1을 그대로 사용한다. PNG/JPEG/WebP/AVIF/GIF/WOFF/WOFF2는 ZIP STORE, 다른 항목은 기존 DEFLATE를 사용한다. 디스크 파일·생성 buffer에 같은 대소문자 무시 확장자 규칙을 적용하고, metrics에 stored/deflated 개수를 추가했다. 파일 선택·내용·권한·재현 가능한 순서/타임스탬프와 보안/최종 패키지 검증은 유지한다. 기존 `engine.source-provenance`의 패키지 검사를 연결했다. 다른 OS에서도 같은 ZIP 정책을 쓰는 공통 JS 변경이며 실제 검증은 Windows x64/Node26.7.0/VSCE3.9.2에서 수행했다. 이후 writer 교체에서 재압축 생략이나 raw font/코드의 기존 압축을 잃는 실수를 막기 위해 기존 패키징 suite에 직접 ZIP method/내용/권한 확인을 추가했다. 대상 suite의 fixture 삭제는 기존 일반 삭제로 통일했다.

집중 패키징 검사 16개 실제 pass16/fail0/skip0/exit0(10.531초), feature manifest validation 통과. 기존 작은 VSCE CLI 비교는 기능 호환성 확인이며 과거 성능 기준을 다시 측정한 것은 아니다. preparation-state가 이미 writer hash를 포함하므로 오래된 패키징 checkpoint가 새 정책의 결과로 재사용되지 않는다.

새 writer만 기존 K의 준비된 host 입력으로 1회 측정했다. 512px 새 프로필은 이 비교의 양쪽 입력 모두에 포함하지 않아 이미지 축소 효과와 구분했다. 보관된 기존 ZIP archive 414,019.604ms → 새 writer 36,427.344ms; 기존 방식의 재실행은 없었다. 전체 20,665개 항목의 CRC·비압축 크기·권한이 일치하며 method 정책을 확인했다(stored1643/deflated19022). ZIP 684,532,758B → 726,759,279B. 과거 측정은 source-tests/engine-preservation과 중첩됐지만 이번 실행은 같은 부하를 재현하지 않았으므로 시간 차이 전체를 변경의 인과 효과나 최종 빌드 절감으로 주장하지 않는다. 현재 512px 프로필을 포함한 최종 패키지·설치 수용은 별도 미완료다. 작업 `FT-02-zip-store/20261105T054032266Z-5eb09423-f424-4d2d-9bac-279f3c9090f4`의 결과는 이 요약과 커밋에 보존하고 측정용 ZIP·중간 index·원시 로그는 같은 한 소유 묶음에서 정리한다.

### 프로필 이미지 축소 및 비교 HTML

커밋 `f6d5ac16b5cbc5d7fe92be33f833928672db09cb`: 이번 200장과 manifest·provenance·NOTICE 및 설계의 해당 문단만 포함했다. 대체 index에서 범위를 검토해 커밋하고 원래 index의 다른 staged 39개 변경이 byte-identical하게 유지됨을 확인했다. 기존 작업 기록과 나머지 설계 수정은 그대로 보존했다.

이번 정리: setup·변환·검증·최초/최종 렌더·커밋의 6개 run 전체를 native registered review/apply로 삭제했다(actual exit0, 모든 항목 deleted/remaining=false/error=null). 요청된 9.52MB 비교 HTML과 최소 요약은 별도 preview 소유자로 보존한다. 이미지 변환은 약11.5초인 반면 분리된 run마다 관리 등록을 반복한 비용이 컸다. 후속 비용 검토에서는 한 작업을 불필요하게 여러 소유 묶음으로 나누지 않는 실행 방식과 지원되는 일괄 등록 가능성을 별도로 조사한다. 이 단위의 삭제 결과는 이전 입력 검증 잔여나 전체 배포의 정리 완료를 뜻하지 않는다.

사용자는 투명 영역을 유지하며 기본 프로필 200장을 512×512 PNG로 축소하도록 승인했고, 비교 결과 확인 후 교체를 확정했다. 512×512는 권장 해상도이며 다른 크기 이미지 지원은 유지한다. 제품의 로스터 검증·사용자 이미지 가져오기에는 해상도 제한이나 자동 축소를 추가하지 않는다. 축소 전 원본은 Git `c721f03efefd48b216671b3d7206810f07c7c20b`에 있으며, 로스터와 provenance에 현재 이미지 hash 및 원본/출력별 변환 근거를 기록했다. 기존 생성·교체 승인 이력은 보존했다. 원본·출력은 공통 플랫폼 자산이며 이번 실제 변환·검증은 Windows x64에서 수행했다.

Windows System.Drawing HighQualityBicubic으로 전체 구도와 알파를 보존하여 1254×1254 → 512×512 변환했다. 새 변환만 11.477초 측정했으며 이전 방식 재측정은 하지 않았다. 총 195,635,668B → 62,086,260B(68.264% 감소). 모든 200장의 치수, 실제 투명 픽셀·가시 픽셀, ID·이름·순서·파일명 보존과 기존 복사/PNG/hash/비정상 입력 검증이 실제 exit0으로 통과했다. 해상도를 강제하는 영구 테스트는 추가하지 않았다. 반복 교체 시 무결성은 기존 asset 계약이 소유한다. 설치·패키징 및 최종 빌드 시간 절감은 아직 검증하지 않았다.

대표 5장(10010, 10005, 10046, 10100, 26004)의 원본·축소본을 내장한 요청 산출물은 `artifacts/tasks/FT-02-avatar-preview/runs/20261105T052058378Z-8acc93ae-c56d-4d34-bfdd-e247e8839418/outputs/avatar-512-comparison.html`(9,520,017B)이다. 최초 HTML의 PowerShell stdin 인코딩 오류를 실제 렌더링에서 발견해 UTF-8로 바로잡고 중복 이미지 삽입을 제거했다. 최종 HTML의 고립 Chrome 렌더 5개 페이지를 모두 확인했다(actual exit0). 연결 브라우저의 상호작용 검증은 연결 실패로 수행하지 않았으며, 배경·표시 크기 선택의 실제 클릭 검증은 미확인이다. HTML은 요청된 독립 산출물로 보존하고 변환 중간 사본·원시 로그·렌더 PNG는 사용 종료 후 지원 소유자로 정리한다.

첫 확인: SourceTestConcurrency=1 및 SourceCheckConcurrency=1은 검사 내부 병렬도만 제한했다. deploy-azrael.ps1은 build/source-tests와 이후 source-tests/engine-preservation/prepare를 중첩 실행한다. K 실측에서도 01:34:40~01:50:40 UTC 세 단계가 동시에 실행됐다. 과거 "병렬도 1" 보고는 전체 단계 배타 실행까지 보장한 것으로 오해하게 했으며 이를 정정한다. 멈춤의 직접 원인이라는 증거는 없지만 사용자 요청과 실제 스케줄이 불일치한다.

목표 정정: 사용자는 컴퓨터 멈춤과 부하 억제를 이번 검토에서 제외하고, 빌드부터 설치까지 총 경과 시간 단축만을 목표로 명시했다. 순차 실행 기본값 제안은 거절·철회되었다. 병렬도 1을 성능 목표로 유지하지 않고, 공유 자원 경합을 포함한 실제 총 소요 시간으로 병렬화를 판단한다. 기존 단계 중첩은 속도에 유용할 수 있으므로 제거 대상으로 삼지 않는다.

다음 제안은 중복 작업 제거와 유효한 결과 재사용에 우선한다. K preparation 43분06초 중 working copy 단계만 16분05초였으며 두 capture가 총 약35분을 차지했다. 반면 J baseline의 reuse 검증 실측은 약52초였다. 전수 검증 중복은 확인하되, 반복 해시만 고치면 전체 비용이 해결된다고 주장하지 않는다. 복사 단계의 실제 파일·메타데이터 작업과 이미 준비된 작업 소스의 재사용 가능성을 함께 검토한다.

속도 1차 개선(사용자 승인, 구현·검증 중): 동일 프로세스의 `reuseDeploymentInputs → prepareDerivedDeploymentWorkspace` 경로에서 바로 반복되는 baseline 전수 검증 한 회를 재사용한다. 최초 검증과 복사 후 검증은 유지하며, 외부 JSON이나 이전 프로세스의 검증 결과를 무조건 신뢰하는 기능은 추가하지 않는다. 소유권·참조·manifest·루트 정체성의 값싼 재확인은 유지한다. 기존 J 기준 한 번의 baseline 검증은 약52초였으나 변경 후 실제 절감은 별도 확인해야 한다. 검증 결과를 프로세스 내부의 정확한 선택/owner에 결부하고, 오래되거나 위조된 결과·원본 변화·출력 불일치 거부를 검증한다.

주된 복사 병목은 별도 후속 대상이다. K 두 capture의 copy 구간은 17분48초와 16분05초이며 26,906개/602,680,399바이트를 복제했다. 복사 함수는 파일마다 여러 번 조상 디렉터리 lstat/realpath를 수행하지만 현재 로그에는 그 내부 시간 분리가 없어 원인으로 단정하지 않는다. 현재 C:는 NTFS로 확인했다. Microsoft의 block-cloning 문서는 ReFS만 지원한다고 명시하므로 단순 block-clone 도입을 이 호스트의 해결책으로 제안하지 않는다(https://learn.microsoft.com/en-us/windows/win32/fileio/block-cloning).

검사 중복 조사: K source-preflight 35개 그룹은 실제 실행됐지만 engine-preservation은 그 35개를 재사용했다(executed=0). test-project도 source-preflight에서 완전히 다룬 node test 파일을 제외한다. 모든 소스 검사가 중복된다는 가설은 기각한다. 늦은 prepare 환경 오류를 앞에서 검출하는 작은 preflight와 남은 개별 검사 비용은 후속 검토한다.

추가 조사: K 입력 준비 43.1분, source-preflight 13분39초, build 7분57초, prepare 16분 후 실패. 중단 L 산출물 약360MB/27항목 삭제는 8분42.5초, 최초 workspace 등록은 약122초로 기록됐으며 자세한 CPU/I/O 원인은 아직 계측하지 않았다. 부분 입력 재개 불가, 반복 전수 확인, 늦은 플러그인 환경 실패와 71B .git sentinel 소유권 누락은 별도 개선 후보로 조사한다. 등록된 27항목 삭제/finalize는 통과했으나 sentinel과 부모 디렉터리는 보존 중이다.

### 속도 2차 개선: 검증된 고정 입력의 단순 복사 경로(사용자 승인, 구현·집중 검증 완료)

사용자는 복사만 하는 단계에는 별도 검수가 불필요하다는 의견을 제시했다. 현재 `captureProject`는 변경 가능한 원본의 캡처와 이미 검증된 불변 원본의 복제를 같은 경로로 처리한다. 파일마다 조상 경로·파일 identity를 복사 전후 여러 차례 확인하고, 자체 읽기/쓰기와 hash 계산, Git object/index 구성, 목적지 전체 snapshot 검증을 수행한다. 이 부가 작업은 copy 시간 구간 안에 포함되며 각 비용의 정확한 비중은 아직 미측정이다.

권고안은 이미 검증된 immutable baseline에서 작업 사본을 만드는 구간에 전용 단순 복사 경로를 두는 것이다. 검증된 파일 목록과 원본 manifest를 재사용하고 표준 복사 기능의 오류/완료를 확인하며, 각 파일의 반복 조상 검사와 복사 단계 전용 재해시를 제거한다. 복사 대상 경계·독립된 새 목적지·실행 소유권 확인, 최초 변경 원본의 입력 확정, 기존 빌드 진입 입력 확인과 최종 산출물 검증은 유지한다. 원본이 최초부터 검증되지 않은 경우까지 검증을 없애는 방안은 아니다. 이 변경은 현재 원본 캡처/복사 검사 계약의 축소이므로 구현 전에 사용자 승인을 받는다. 현재 대형 copy 비용에 대한 정확한 절감치는 아직 없다.

사용자 승인 후 `copyVerifiedProject`와 `copyVerifiedTree`를 기존 capture 모듈에 추가하고 full/derived 작업 사본 생성에서 사용했다. 표준 copyFile/cp와 측정된 파일 목록을 사용하며, 파일별 조상 재검사·자체 스트리밍 hash·복사 직후 snapshot 검사는 제거했다. Git object/index는 native Git pack/index 명령으로 옮긴다. 최초 live-source capture 및 후속 verifyDeploymentWorkspace는 유지한다. workingCopy는 standard-copy/contentVerified:false로 기록하고 digest는 검증된 원본의 기대값임을 명시한다.

집중 검증: Windows x64/Node26.7.0 workspace 17개 그룹 exit0(89.924초), 기존 changing-source capture 13개 exit0(18.864초). 잘못된 사본은 복사 완료로만 반환되고 필수 consumer-entry 검사에서 거부되며, native copy 실패도 전파된다. run `FT-02-verified-copy/20261105T044839233Z-4d535acb-d223-476e-b6f0-8bd9c057cee1`. 소형 warm-cache 비교(128파일/524,293B, Git 작업 포함)는 기존 1868.746ms → 표준 480.452ms였고 출력 digest 동일. run `FT-02-copy-benchmark/20261105T045136094Z-c5fa3ac6-01c4-4d2c-a5a4-883b82cfb5ff`. 대형 실제 빌드 절감으로 환산하지 않는다. 이 두 run의 임시 자료는 생성 시점부터 managed root 하위에 생성물 소유권을 명시했다.

속도 2차 정리 완료: 위 두 run과 temporary `artifacts/tasks/cb-mw32j5el`, `artifacts/tasks/vc-mw32fcxs`의 총 4개 멤버를 기존 standalone owner의 registered review/apply로 삭제했다(actual exit0, 두 그룹 deleted). lifecycle finalize도 두 그룹 모두 finalized/remaining=[]/references=[]/blockers=[] 및 exit0을 확인했다. 독립 수용 근거는 위 요약에 보존했고 원시 로그와 fixture는 제거했다. 앞선 속도 1차 정리 잔여와 최종 제품 빌드·설치는 여전히 미완료다.

### 속도 1차 개선 검증 결과

`deployment-workspace.cjs`의 private WeakMap으로 정확한 동일 프로세스 반환 객체에만 최초 검증 snapshot을 결부했다. derived 진입 한 번에서만 소비하고, manifest/owner/root 재확인 및 복사 후 full 검증은 그대로 유지한다. 기존 작은 workspace suite에 실제 inventory 호출 계측과 직렬화·재사용·원본 변화 사례를 추가했다. 정상 경로는 baseline inventory 6회에서 4회(전수 검증 3회에서 2회), 이미 소비한 객체는 진입/종료 전수 검증 4회, 직렬화한 객체는 최초 포함 6회를 확인했다. 복사 전 원본 수정, 복사 후 최종 검증 전 수정, 소유자 위조도 거부됐다.

2026-11-05 실행: 첫 회는 새 fixture의 중복 reference 등록으로 실제 exit1, 독립 소비자 run으로 수정 후 두 번째 workspace suite의 17개 검증 그룹이 실제 exit0(89.652초). 구문 검사와 scoped diff check도 exit0. 실제 대형 빌드의 시간 절감은 아직 미측정이다. 검증 run IDs는 `20261105T043022529Z-f6ad5cb2-f235-4f76-ad9a-0fe2277226b2`(실패)와 `20261105T043156034Z-892742bf-9257-491f-8e8f-7f5e1fd10253`(성공), workId `FT-02-input-handoff`. 실제 제품 빌드·설치는 수행하지 않았다.

정리 미완료: 짧은 fixture 경로 `artifacts/ih-mw31rupt`, `artifacts/ih-mw31tuv6`의 외부 temporary 멤버에 생성물 표시가 자동으로 붙지 않는 준비 오류를 소유자 기록으로 바로잡았다. 그러나 정확한 경로를 managed root로 추가하면 루트 자체 보호에 걸리므로 삭제를 수행하지 않았다. 임시 managed_roots 추가는 되돌렸다. native review/apply는 두 run의 전체 4개 멤버를 deferred/remaining=true로 기록했다. 보호를 우회하지 않았으며 두 임시 트리와 raw log는 아직 존재한다. 이들은 검증 완료를 뜻하지 않는 정리 잔여이며, 후속 지원 정리 경로 수정 또는 명시적 보존 결정이 필요하다.

## 실행 및 검증

### 재검사 판단 정책 변경

사용자가 입력·환경 변경에 따른 일반 재검사 강제를 추천으로 전환하고, 빌드 모델이 이전 결과 재사용 또는 재실행을 선택하며 이유를 기록하도록 승인했다. 변경 의미를 평가하지 않는 전체 환경 hash와 선행 실행 ID 불일치만으로 긴 검사를 자동 반복하지 않는다. 현재/이전 입력 차이, 영향받는 검사와 근거를 제시하고 선택을 현재 후보에 결부한다. 일치한 유효 결과의 자동 재사용은 유지한다.

실제 검사 실패, 변조·누락된 증거/산출물, 미종료·종료 불명 producer는 모델의 재사용 선택으로 성공이 되지 않는다. 선택되지 않은 검사나 실행하지 않은 검사를 새로 실행해 통과했다고 기록하지 않는다. 검사 범위와 실제 실행/기존 증거 수용을 구분하며 최종 산출물 무결성, 원본 보존, 실행 배타성과 삭제 보호는 유지한다. 빌드/검증 코드의 공통 정책이므로 지원 대상 Windows/Linux/macOS에 공통 의미를 적용하되 실제 회귀 검증은 Windows x64로 명시한다. 새 엔진 컴파일이나 플랫폼 지원 변경은 이 정책 작업 범위가 아니다.

root는 공통 결정 계약, 문서·기능 inventory 통합과 최종 수용을 소유한다. 기존 원본 작업 폴더에서 수정하고 진행 중인 frozen J에는 반영하지 않는다. 무거운 검사/복사는 현재 빌드와 겹치지 않으며 병렬도 1을 유지한다. 검증은 입력·환경·선행 ID 변화의 추천 생성, 명시 재사용/재실행 및 이유 기록, 오래된 결정 거부, 실패/변조/unknown의 재사용 거부를 기존 작은 owner 테스트로 확인한다.

root는 입력 고정, 환경, 배포 실행과 통합/설치/정리를 소유한다. build_readiness 조사 담당은 기존 source-built code-mode-host/V8 및 캐시 소유 근거를 읽어 확인하며 수정하지 않는다. 기존 deployment runner의 변경 기반 검사와 필수 source/engine/정확한 패키지 host acceptance를 사용한다. 기존 사용자 창은 종료·재시작하지 않는다. 원본 Codex·사용자 상태·관련 없는 확장은 보존한다. 필요한 build/packaging 결함은 원인을 좁혀 승인 범위의 동작 보존 수정만 수행한다.

## 준비 근거 및 남은 확인

진행 중인 cargo/rustc/build/deploy producer는 최초 프로세스 조회에서 관측되지 않았다. C: 여유는 약 190.2 GiB이며 이후 컴파일 증가 추정과 비교한다. 기본 PATH에 pwsh/python이 없으므로 설치된 절대 도구 경로를 실제 자식 환경에서 검증한다. 캐시의 미확인 producer는 자동 복구하거나 우회하지 않는다. build 입력, 로그, fixture, 설치/복구 산출물은 기존 artifact owner를 사용한다.

완료 기준: 고정 입력 identity와 검증 종료 코드, 정확한 배포/패키지 hashes, 설치 영수증 및 기존 프로필 보존을 확인한다. 사용자 정상 동작 확인이 필요한 최소 복구 묶음은 정확한 경로·용량·삭제 조건을 알리고 확인 대기한다. 사용이 끝난 임시 자료는 즉시 소유자 절차로 정리한다.

## 고정 입력과 실행 판단

- 엔진 inventory에 현재 변경 66개와 새 파일 2개를 supported recorder로 반영했다. 새 파일 `image_attachments.rs`, `find_names.rs`만 추적 대상으로 추가했으며 다른 index는 보존했다. inventory SHA-256: `79960511044810dbc2e9f3a934b65a48afeab8756bfd479094dbc75192f40a18`.
- 첫 immutable 입력(`artifacts/inputs/ft17-20261104`) 고정 성공, 소요 약 13분26초. 이후 source-built code-mode-host의 V8 환경 값도 입력 identity에 포함해야 함을 확인했다. 동일 고정 소스에서 V8 환경을 추가한 최종 입력 `artifacts/inputs/ft17-v8-20261104`, 작업 사본 `artifacts/b`를 준비한다. 첫 결과를 최신 primary로 대체하지 않는다.
- OpenAI rusty-v8-v150.4.0의 Windows ptrcomp_sandbox archive/binding을 `artifacts/v8-ft17`에 다운로드하고 소스에 핀된 manifest/archive SHA 및 manifest의 binding SHA를 확인했다. 다운로드 종료 코드 0. archive SHA `732ec5da4243aa166799780c8519a5eea6f32f6e47657a323342794dc3c239d6`, binding SHA `dabf78ba1faac127660db9862b1d0354175c71b8db2d4fcb5bacbd9c93576b16`.
- 기존 공용 Cargo target의 producer 종료 근거가 없어 보호 상태를 유지한다. 승인된 scoped cache 기능으로 `win017-ft02`를 선택한다. 캐시 전체 복사 없이 새 target을 사용하고 이후 검증/빌드에서 재사용한다. 동시 Cargo jobs 2, dev/test debug 0. 공용 cache key `9d65c03f6d2d798ea0081c6babb32ee4882b57c9db7b08cb46623200846f02d1`는 final 작업 사본에서도 재확인한다.
- 최종 소스 복사와 독립적으로 같은 코드의 첫 고정 사본에서 Windows PTY preflight를 시작했다. 첫 시도는 Cargo 시작 전 copied workspace의 maintenance owner 경로 부재로 종료 코드 1. 검증한 설치 실행기 경로를 명시해 재실행한다. product 코드는 변경하지 않았다. 참조 스키마 오류 재시도는 run 생성 전 종료 코드 1이며 producer를 시작하지 않았다.

## 검증 범위 선택

변경 경로가 매핑하는 30 feature와 추가 native 영향 3 feature를 명시한다. 무매핑 native 경로를 빈 선택으로 건너뛰지 않는다. 직접 관련된 Devin account payload 동작의 검증 공백은 실행 전 기존 검사 범위를 추가 확인한다.

`agent.image-attachments`, `build.shared-ui-cache`, `engine.api-context`, `engine.capacity-recovery`, `engine.error-classification`, `engine.executor-completion`, `engine.managed-tool-identities`, `engine.manual-resume`, `engine.mcp-lazy-startup`, `engine.meta-provider`, `engine.model-harness-profiles`, `engine.parent-requests`, `engine.provider-context`, `engine.question-withdrawal`, `engine.recovery`, `engine.response-tps`, `engine.role-profiles`, `engine.root-resume-reasoning`, `engine.selected-upstream`, `engine.shared-engine`, `engine.source-provenance`, `engine.startup-performance`, `engine.task-profile-skills`, `engine.task-work-time`, `engine.window-approval`, `runtime.deletion-approval`, `tool.find-names`, `tool.multi-pointer`, `tool.project-maintenance`, `tool.task-memory`, `engine.auto-account-switch`, `engine.devin-native`, `engine.devin-code-mode`.

2026-11-04 14:43 KST 최종 입력 준비 시작. PTY 검사는 입력 복사와 자원을 과도하게 경합하지 않도록 2 jobs로 실행한다. 최종 deployment는 PTY와 입력 고정 성공에 종속되며 컴파일을 중복 시작하지 않는다. 준비·검사 run의 실제 종료 및 경과는 해당 producer report에 기록한다.

## 입력/사전 검사 결과

최종 고정 준비 종료 코드 0, 약 15분13초. report `artifacts/tasks/FT-02-win017-v8-inputs/runs/20261104T054314956Z-cd56b50c-110d-4b34-8413-7abde5a58f21/reports/deployment-workspace.json`, SHA `d7862c7f3c1536aba2b862766feef13999543598a54a45eeff1c056b9df0e335`. input `input:1bf50ab5cec6361fde358ac5`, workspace `workspace:1bf50ab5cec6361fde358ac5`. 소스 project SHA `d104a2addcedb3b33acdd9eebaaa172564e4b492f63cd2d67031e8878bd93058`는 첫 입력과 일치한다.

Windows PTY 검사는 종료 코드 0: 9 passed, 0 failed. 컴파일 56.73초, 실제 테스트 16.74초. 로그: `artifacts/tasks/FT-02-windows-pty/runs/20261104T054938122Z-5cdefa1d-eea7-4c59-8729-1d42b478430c/logs`. 실행 파일은 선택한 shared Cargo target 아래에 있으며 최종 빌드와 경합하지 않는다.

Devin profile-pinned 계정 경로는 기존 task-profile fixture(openai)와 Devin synthetic check가 교차 경로를 직접 검증하지 않는다. `-VerifyOnly`로 전체 빌드/패키지 acceptance까지 진행한 후 exact engine에 추가 검사를 실행하고, 통과하면 기존 `install-azrael.ps1`로 같은 검증 패키지를 설치한다. 기능 범위를 제외하거나 검사를 통과한 것으로 간주하지 않는다. 이 분리는 추가 동작 검증 전에 자동 설치되는 것을 막기 위한 내부 실행 순서다.

도구 준비의 첫 시도는 Bun cache 조회를 package.json 없는 프로젝트 root에서 실행해 종료 코드 1. compiler/build는 시작하지 않았다. 같은 소유 묶음을 known-stopped 새 generation으로 열어 extension package context에서 재시도하며 원래 실패 report는 보존했다.

## 재개와 도구 준비

사용자 중단 후 npm 준비 executor는 cancelled/exit 1이었다. 원래 generation은 성공으로 처리하지 않았다. 06:01:25Z 실행 시작 경계 이후 전체 Windows process census의 PID/ParentPID/CreationDate 연결을 검사했고 살아 있는 모든 프로세스가 생성 순서가 유효한 연속 부모 연결로 시작 전 조상에 도달했다. task Node 실행 파일의 남은 두 프로세스는 모두 11월 3일 시작된 별도 작업으로 확인했다. 끊어진/reused parent 연결과 해당 시도 잔존 Node가 없어 exact tree 종료 근거를 기록하고 실패로 close했다. 근거 `artifacts/tasks/FT-02-cancellation-audit/runs/20261104T074418458Z-3515b852-20a7-4aa2-b5c9-3ee57fffd550/reports/tree-stop-accepted.json`. npm 자체의 성공을 추론한 것이 아니다.

그 뒤 재시도 npm ci와 frozen TypeScript require는 각각 종료 코드 0. source fixture discovery는 기본 spawnSync 버퍼 한도에서 ENOBUFS로 종료했다. frozen Git index의 raw CRLF 표현 때문에 기존 plugin 파일까지 변경 목록에 포함되어 7,152개가 선택된다. 파일 바이트는 고정 입력과 일치하며 소스/검사 범위를 줄이지 않는다. 기존 `--args-file` + SHA256 transport에 64MiB 한도로 읽은 NUL Git 변경 목록을 넘겨 해결한다. deployment 자체도 기존 .NET Git reader와 args-file을 사용하므로 제품 코드 변경은 필요 없다. 필수 pinned UI의 out/extension.js 두 파일만 추가 복사하고 SHA를 확인했다.

최종 작업 사본에서 Cargo identity 재계산 결과 PTY 대상 key와 일치했다. 남은 절차는 fixture readiness → VerifyOnly 전체 deployment → scoped Devin 추가 검사 → exact package ordinary profile 설치 → 실제 결과/참조에 따른 정리다.

## 배포 실행

2026-11-04 17:04 KST `artifacts/b/scripts/deploy-azrael.ps1`의 `win017-ft02-20261104` VerifyOnly 실행을 시작했다. 실행 작업 ID `618f5bea-afb4-462f-80c5-ab569e6aa6fc`; 소유 run `artifacts/tasks/FT-02-deployment/runs/20261104T080410478Z-e822a830-547e-4d93-b1cb-b6854b3d23c2`. 전체 인자/실행 PID/실제 종료 결과는 해당 reports, stdout/stderr는 logs에 남긴다. source concurrency 1, source test concurrency 2, Cargo jobs 2, npm sockets 2, 디스크 잔여 하한 30GiB. 컴파일 증가량은 측정 근거가 없어 추정값을 제출하지 않았다. 설치는 VerifyOnly 및 추가 Devin 검사 통과 후 수행한다.

최종 fixture readiness: `artifacts/tasks/FT-02-fixture-readiness/runs/20261104T080229814Z-a61e54cd-84b4-4d73-9308-8068c909a17e/reports/readiness.json`, 종료 코드 0. 이전 Git ENOBUFS와 누락된 두 pinned extension.js는 각각 기존 args-file transport와 필수 파일만 복사하는 방식으로 해결했으며 고정 제품 소스는 변경하지 않았다.

## 배포 준비 오류 처리와 현재 실행

- 최초 배포는 중복 Node PATH 문자열 때문에 initial snapshot 이전에 실패했다. 다음 도구 probe는 Microsoft Store alias가 Python/PowerShell을 중복 노출하는 것을 발견했다. 기존 `pipeline-preflight.composePath`를 재사용하고 WindowsApps 전체 경로 대신 `Microsoft.PowerShell_8wekyb3d8bbwe` 전용 경로를 선택했다. 실제 PowerShell child에서 node/python/cargo/pwsh 각각 정확히 1개 해석을 확인했다.
- 이후 시도는 최초 실패가 남긴 `artifacts/b/artifacts/v` 미생성 fixture claim과 충돌했다. 최초 deployment metrics의 failed/빈 stages/빈 inputChecks, 관측된 executor exit 1 및 fixture 경로 부재를 근거로 `run:verification:win017-ft02-20261104`, `run:account-controls:win017-ft02-20261104`를 supported lifecycle finalize retirement로 정리했다. 실제 payload는 생성되지 않았다. 실패를 성공으로 바꾸거나 활성 소유 기록을 제거하지 않았다.
- 현재 작업 ID `2701b009-51d2-45e3-aa75-69ab4137e68d`, release `win017-ft02b-20261104`: 같은 고정 입력, 검증된 환경과 인자를 재사용해 VerifyOnly 배포를 실행한다. 앞선 tool-resolution-only 실패에서는 이 release의 배포를 시작하지 않았고, claim 충돌 시도도 compiler/stage producer 이전이었다.
- scoped Devin 외부 검사 드라이버 준비 완료: `artifacts/tasks/FT-02-devin-scoped-check/runs/20261104T081258673Z-e6c897a4-c3ba-4cc9-9139-c08535d65fe8/inputs/check-devin-scoped.cjs`, SHA256 `fececb46242bcb891ff15e82dd83cf77572449b0310d63c138c6fc4bf5074a22`, node --check exit 0. 아직 제품 실행 검증은 하지 않았다.
- 비어 있던 checker bootstrap `run:FT-02-devin-scoped-check:20261104T081129235Z-fbfd0760-048e-42b4-9b51-b860a2396485`는 pinned standalone owner의 register→registered review→명시 delete→부재 확인→finalize 완료. 논리 크기 1,056 bytes, 삭제 remaining=false.

## 발견한 소스 검사 결함과 수정

`win017-ft02c-20261104`는 환경/fixture/verification-dependencies를 통과하고 engine-source-preflight를 실행했다. 처음 10개 invocation은 통과했고 `build.shared-ui-cache.forwarding`의 `scripts/test-build-platform.cjs`에서 실패했다. 해당 파일은 14개 중 12 pass, 1 fail, 1 platform skip. 원인은 native-target-plan 단위 검사가 buildPlan의 ambient process.env를 사용해 이번 source-built V8 경로를 읽고 별도 V8 guard에 먼저 걸린 것이다. 실제 제품 V8 guard 위반을 허용한 문제가 아니다.

primary와 frozen 검사 파일이 같은 hash임을 확인하고 primary `scripts/test-build-platform.cjs`의 buildPlan 호출 4곳에 명시적 `{}` 환경을 전달했다. 별도 V8 override 거부 검사와 모든 assert는 유지했다. 범위는 공통 플랫폼 planning 테스트의 환경 격리이며 실제 실행 환경은 Windows x64다. Linux/macOS 제품 빌드 검증을 주장하지 않는다.

작업 `20541887-3259-4088-a646-0ad38630533a`는 실제 V8 환경에서 두 관련 검사를 먼저 실행하고, 통과 시 기존 immutable baseline 재사용 + 단일 script override로 derived input/working copy를 준비한다. 새 working root는 `artifacts/d`, delta root는 `artifacts/inputs/ft17-platform-test-fix-20261104`. 기존 `artifacts/b`는 수정하지 않는다. 제품 engine 소스는 그대로다. 입력이 바뀌므로 기존 실패 receipt를 성공으로 취급하거나 same-input Resume로 우회하지 않는다.

## 잠금 초기 응답 안정화

compact input 준비가 두 차례 초기 lease 응답 시간 초과로 중단됐고, catalog/run_claim에 빈 sentinel이 남았다. 두 경우 모두 등록/파생 copy callback 이전이었다. 전체 현재 프로세스의 생성 시각·부모 연결 및 해당 실행기 부재를 독립 검증한 후 pinned standalone `recover_lock`으로 복구했다. catalog receipt SHA `d6e3e39fa99924a337087f44b83af4f851a21fe2ea271e5c09d0d099a7b46ff6`, run_claim receipt SHA `640fa312713450f46e77658d2a141711400603d3bba33874eca713ff3caea7cb`; native status recovered/exit 0과 실제 sentinel 부재를 확인했다. catalog evidence/receipt의 64KiB 제한으로 거부된 시도는 파일 내용을 바꾸지 않았고, 전체 census를 SHA로 참조하는 작은 summary evidence로 정상 복구했다.

필요한 빌드 안정화 수정으로 `scripts/maintenance-lock-owner.cjs`의 초기 응답 여유를 10초에서 60초로 분리했다. 실제 native `--wait-ms` 0/5000, 기존 명령 응답 60초, EOF/close 관측, timeout·unknown 보호는 그대로다. 초기 acquire도 10초 지연 진단을 남긴다. 빈 sentinel을 성공한 lease로 간주하거나 임의 삭제하는 처리는 추가하지 않았다.

`scripts/test-maintenance-lock-owner.cjs`에 실제 11초 초기 응답 fake owner 회귀와 명시적5000 전달 검사를 추가했다. `tool.project-maintenance`의 기존 필수 검사/owner 연결을 사용한다. owning architecture/ops를 갱신했다. Windows x64에서 전체 retained lock test exit 0, 실제 V8 환경의 플랫폼 계획 관련2개 테스트 exit 0. 결과 `artifacts/tasks/FT-02-lock-test/runs/20261104T090531366Z-026b6147-b437-49ee-ac0e-54eb9eb179a8/reports/results.json`. 다른 OS의 실제 실행 수용은 추가하지 않았다.

현재 입력 준비 work ID `bf1dbce9-1cc5-4d59-a0db-f935cad0fc79`는 수정된 세 script를 baseline+delta 방식으로 고정한다. docs는 primary의 운영 설명으로 유지하고 엔진 소스는 변경하지 않았다.

## 수정 입력 준비 완료

`bf1dbce9-1cc5-4d59-a0db-f935cad0fc79` actual exit 0. derived manifest `artifacts/tasks/FT-02-script-fix/runs/20261104T090715671Z-db809406-48e6-4d3e-b27b-966996afcd00/reports/deployment-workspace.json`, SHA `fef15049618002c9a9593365bacb801cc7aaf2fac3deb5635d0c52c2c3320366`. project SHA `63762a560dd4adbd42b1d514b477cfbb85e5fb60007ebbf83b0a705935930bd6`, input `input:ae80e016df65b7d764bb745f`, workspace `workspace:ae80e016df65b7d764bb745f`. working `artifacts/d`; immutable engine는 `artifacts/inputs/ft17-v8-20261104/project/engine`을 재사용한다.

15분 첫 점검에서 주요 파일은 존재했으나 완료 보고가 없어 진행으로만 보고했다. 이후 executor succeeded/exit0와 최종 manifest를 확인했다. 준비에 들인 wall time은 테스트/빌드 성공 시간으로 합산하지 않는다.

새 도구 준비 `d88a19b5-8644-46ab-a213-ed20bfd2edf8`: 기존 `artifacts/b`에서 package/lockfile 동일성을 확인한 dependency tree와 pinned UI fixture를 새 `artifacts/d`로 복사하고, 실제 D consumer의 TypeScript resolve/require·npm/Bun cache query·fixture readiness를 수행한다. npm/Cargo 캐시 전체 seed 복사는 하지 않으며, 이후 Cargo cache는 같은 scoped key를 재계산해 사용한다.

## 직렬 사전 검사 재시도

D 도구 준비는 실제 exit 0, fixture/module/cache query 모두 통과했다. `win017-ft02d-20261104` 배포는 source-fixtures/environment-preflight/verification-dependencies 통과 후 source preflight에서 중단됐다. 16개 invocation 중 shared-engine fixture guards만 실패했고, 123개 중 122 pass였다. 두 Node test file의 artifact-run.claim이 같은 `.run-claim.lock`에서 충돌하여 명시 owner의 5000ms 대기를 소진했다. 제품 Cargo assertion 실패나 unknown lease가 아니다. 새 source 변경 없이 SourceTestConcurrency=1, SourceCheckConcurrency=1로 유지한다. 기존 d verification/account fixture는 실제 생성되지 않았고 단계 종료 증거로 소유자 finalize 완료했다.

2026-11-04T10:03Z 직렬 7-file 재검사 시작: `artifacts/tasks/FT-02-serial-guards/runs/20261104T100343322Z-6fad2c72-eba9-4050-a98a-3065db61e7c8`. 같은 D source와 준비된 환경을 사용한다. 통과 후 fresh `win017-ft02e-20261104` VerifyOnly 배포, 실제 엔진의 scoped Devin 추가 검증, 동일 package 설치 순서다. 입력 재복사나 Cargo cache 복사는 하지 않는다.
직렬 7-file 검사 actual exit 0: 130 pass, 0 fail/skip, 26.45초. `win017-ft02e-20261104` VerifyOnly 작업 `9ac40b4e-05de-4b51-8054-b4bad966a89d` 시작. 같은 derived manifest와 scoped Cargo target, SourceTestConcurrency=1을 사용한다. 제품 빌드/설치는 아직 미완료다.

## 추가 사전 검사 결함

`win017-ft02e-20261104`는 30개 source invocation 중 29개 통과, `tool.project-maintenance.adapter`에서 두 검사 실패로 종료(actual exit1). 캐시 fixture guards는 통과했다. 남은 9개 invocation은 선행 실패로 실행되지 않았다. 제품 컴파일/설치는 아직 시작하지 않았다.

portable build는 fresh output 부모가 없으면 `.pipeline.lock` 생성이 Windows os error3으로 실패했다. `build-platform.cjs`에서 부모를 먼저 준비하도록 수정했고, lifecycle fixture는 현행 pipeline state/lock을 포함한 정확한8개 member path/role을 검사하도록 갱신했다. 담당자 `build_parent_fix` 검증: Windows focused1 pass/exit0, diff check0, fixture 삭제 확인. 근거 `artifacts/tasks/build-parent-readiness/runs/20261104T101607413Z-541f52b4-da05-4995-afbb-1e4f3b4fe123/logs/focused-test.log`. frozen D는 수정하지 않았다.

`selection_failure`는 native-verification-cache 변경 시 UI 검사 추가 선택의 실제 의존성을 read-only 조사한다. 기다리는 동안 D에서 실패와 독립적인 미실행8개 source invocation을 실행한다. lifecycle-source는 수정된 build-platform/test-artifact-lifecycle 입력에 의존하므로 새 frozen 입력에서 검증한다. 독립 검사 work `c418a735-652d-4213-a4b0-413f25cbe2fa`, run `artifacts/tasks/FT-02-remaining-source/runs/20261104T101651233Z-a112b98a-cb95-44cf-a894-ed178da9cd39`. 모든 검사 실제 결과는 해당 reports/results.json에 기록한다.

검사 선택의 실제 원인은 ui.window-control manifest가 공통 feature-preservation gate를 선언한 관계를 따라 내부 native cache까지 모든 UI 검사에 전파한 것이었다. test-project.cjs의 declared-owner traversal에만 좁은 경계를 추가했다. 실제 static import, gate 자체 직접 매핑, 다른 module/data 의존성은 유지한다. 기존 정확한 선택 검사를 변경하지 않았고 관련5개 모두 pass/exit0. 근거 `artifacts/tasks/selector-gate-scope/runs/20261104T102013445Z-97e4e316-0502-4d7a-9a14-f7ba8d7cba22/logs/focused-selection.log`. owning architecture의 pipeline/selection 설명을 갱신했다.

D의 나머지 독립8개 invocation 모두 exit0. 새 입력 준비 `c421247b-1766-4c7e-adf8-19e9a0031f2b`가 10:22Z 시작했다. baseline V8 immutable source는 그대로이며, 앞선3개와 추가3개(build-platform/test-artifact-lifecycle/test-project) 스크립트만 delta로 지정한다. working artifacts/f, delta artifacts/inputs/ft17-script-fix2-20261104. 원래 primary의 다른 변경은 이미 고정 baseline에 포함됐고 새 수정 외에는 따라가지 않는다. 준비 run: `artifacts/tasks/FT-02-script-fix2/runs/20261104T102201620Z-b884f3ae-81da-480c-aade-b678b42b4cea`.

새 F 입력 준비 actual exit0. manifest SHA `f8500d0867d716fa6315b075fa5b668e79139bdb21295a610ec2437fa5b287fc`, project SHA `131c322943e3bef9d4c51e2c2f11d5a0cb6b1c393b7ee603818d426992d195ee`, input `input:214ef71245b61941861a301f`, workspace `workspace:214ef71245b61941861a301f`. 15분 점검 시 running이어서 기다렸고 이후 성공 종료/manifest를 확인했다.

F 도구 준비는 기존 D package/lockfile 동일성 확인 후 의존성/UI fixture를 재사용한다. 동시에 앞서 수정 입력에 의존해 보류한 lifecycle-source gate만 F에서 실행한다(work `6f796c24-402e-4e1e-b6a6-c5fffe1c0489`). 이 gate는 자체 isolated fixture를 사용하고 준비 중인 node_modules를 소비하지 않는다. 도구 readiness와 lifecycle gate 성공 후 새 이름의 전체 배포를 실행한다.

F lifecycle-source 실제 exit1. 유일한 실패는 PowerShell deletion reservation 검사(test-artifact-lifecycle.cjs:1440)의 초기 maintenance-lock-client 응답15초 초과였다. 수정한 fresh-output 경로와 다른 테스트는 통과했다. 동시 도구복사 구간에서 suite가 약15분 걸렸으며 일반 shell 호출도 지연됐으나 I/O 원인은 아직 확정하지 않는다. 해당 PowerShell 시작 실패 경로는 stdin을 닫고 실제 client WaitForExit 후 반환한다. timeout을 성공으로 취급하지 않는다. 도구 복사가 끝난 뒤 동일 F의 해당검사만 별도 새 fixture에서 재실행(work112e1501-f322-4d4f-9cfe-862594bf466c)하여 부하 조건과 분리한다.

F 도구 복사와 npm/Bun/TypeScript 실제probe는 완료했으나 첫 fixture probe는 changed-only와 deferral 인자조합 금지로 실패했다. 소스검사를 실행한 실패는 아니다. 기존 전체 changedPaths와6개override 합집합을 유지하고 deferral 없는 --check-fixtures --changed-only만 새run에서 재실행하도록 결정했다. 복사/설치는 반복하지 않는다.

F isolated PowerShell reservation 재검사는 exact same source에서1pass/exit0. 도구 준비 종료 후 실행하여 동시 copy 부하를 제거했다. timeout은 변경하지 않았다. F tool final readiness actual exit0: `artifacts/tasks/FT-02-f-tools-final/runs/20261104T110302179Z-275ea12a-9dd8-4548-bc22-3e19d908c7fb/reports/readiness.json`. 첫 npm/Bun/TypeScript probe와 최종 fixture probe 실제 성공을 결합하며 원래 실패로그는 별도 유지한다.

전체 VerifyOnly `win017-ft02f-20261104`, work `23f41732-701f-4ece-9a45-2269afc4da47` 시작(11:04Z). F frozen6-script input, same retained engine/scoped Cargo/V8 environment, SourceTestConcurrency1/SourceCheckConcurrency1. 새 working F의 짧은 artifacts/v fixture를 사용해 socket 길이 제한을 유지한다. 대규모 copy와 겹치지 않는다. mandatory source/native/package/host 검사 모두 실제 통과 후 외부 scoped Devin 검사와 exact package 사용자 설치를 이어간다.

## 시스템 재부팅으로 인한 중단

F 배포는 source preflight 전체 exit0 후 11:21Z build 단계에 진입했다. Cargo release 실제 producer1개, rustc 최대2개 실행을 확인했으나 11:55:47.5Z Windows 재부팅으로 runtime 관측이 상실됐다. work23f41732 상태unknown/exitnull, native session68383 소실, parent result.json 없음, deployment metrics는 build running/exitnull이다. 이를 성공/정상실패로 바꾸지 않는다. 실제 설치는 아직16이다.

독립 OS 부팅 시각이 producer 시작11:04:36.977Z보다 늦어 이전 process tree 종료는 확인된다. System 이벤트41/6008은 비정상 종료를 기록하고1001/1074는 조회 범위에서 확인되지 않았다. 원인 자체는 미확정이며 사용자에게 직접 강제 재부팅 여부를 질문했다. 근거 `artifacts/tasks/FT-02-reboot-recovery/runs/20261104T121514667Z-1d87435d-6b22-4c55-9b07-941408294112/reports/reboot-evidence.json` (probe exit0).

scoped Cargo physical lease token `fa7ec538-f74b-46fb-91ac-75cf9d9a479d`, ownerSHA `bb5acbd3ecb6b42f68cdbb52c68f17a168a3a3cc27ddb7ec1bd86f8f289f9e4f`, coordinator32120, phase spawn-attempted. shared lifecycle rev3 pending/generatione5af8bb7-400e-46dd-8f9b-c01b0915b228. 재부팅 전 partial Cargo payload는 보존한다. 기존 지원 복구 API가 unknown outcome을 유지하면서 재사용할 수 있는지 조사 중이며, 새 cache복사/중복빌드는 시작하지 않는다.

지원 복구 경로 조사 결과: cargo-target-owner.recoverTargetOwner는 exacttoken/hash+독립 중단증거로 물리lease만 unknown/null 결과를 보존하며 퇴역할 수 있다. 그러나 cargo-shared-cache.beginExecution은 stopped라도 unknown producer를 거부하고 해당 owner에 재사용용 recovery API가 없다. pipeline-state 역시 running/unknown을 재시작할 지원 transition이 없다. 따라서 기존 guard를 우회하거나 unknown을 failed/null로 재분류하지 않고 같은 캐시/실행을 재개할 경로가 확인되지 않았다. 조사 범위는 해당3owner/운영docs이며 nativeprojectmaintenance의 다른producer 복구를 이cache에 적용하지 않는다.

Resume fixture도 F/artifacts/v-xxxxxxxx/s로9문자 길어져 현재107byte 소켓 한도를 넘기므로 짧은prefix만으로 해결됐다고 주장하지 않는다. 현재source를 고친다면 별도 frozeninput 정체성이 필요하다. 새캐시로 전체컴파일을 중복하거나 기존캐시 guard를 우회하지 않는다. 사용자에게 중단캐시와pipeline의 증거기반 recovery 기능 보완 범위까지 승인 요청하며, 빌드/설치는 미완료로 유지한다. 재부팅 원인질문도 아직미응답이다. 현재 task의 작업사본/partialcache/실패및중단로그는 원인분석·재개에 필요한 보호자료로 유지하며 정리완료를 주장하지 않는다.

## 재개 승인과 복구 구현

사용자가 컴퓨터 멈춤으로 직접 강제 재부팅했음을 확인했고, 이후 재개를 요청했다. 앞서 제안한 증거기반 캐시/빌드 복구 보완을 포함해 이어간다. 실제 멈춤의 원인은 여전히 미확정이다. 현재 storage HealthStatus 정상/C:175.1GiB는 상태관측일 뿐 원인배제 근거가 아니다. 이후 Cargo jobs=1, sourcefile/group concurrency=1로 낮추고 대규모 copy와 build를 겹치지 않는다.

원래unknown/null 결과를 보존하는 pipeline.recover API와 lifecycle/sharedCargo 재시작 authorization을 분리 구현한다. root는 recovery 증거와 통합/실제복구, pipeline worker는 pipeline-state/test, cache worker는 lifecycle/sharedCache/test 소유다. Windows x64 실제검증이며 공통 코드의 Linux/macOS 실제수용은 주장하지 않는다. F/기존immutable 입력은 수정하지 않는다.

pipeline worker: exact currentstage/stoptrue/regular evidence SHA/기존writer+update lock에 묶인 recovery 구현, unknown/null 유지/의존성 성공불인정/새attempt만허용. focused test exit0와 fixture부재확인. 근거 `artifacts/tasks/FT-02-pipeline-recovery/runs/20261104T125856816Z-ef5581b6-bb56-4d3d-b19e-bd461c71c58f/logs/pipeline.stdout.log`.

root: Resume에서 명시fresh VerificationFixtureRoot는 길이를 늘리지 않도록 수정. 기존경로는거부하고 lifecycle충돌guard유지, 기본자동경로는기존attemptsuffix유지. 기존 fixture-path-selection을확장해명시path/기존path거부/기본path분리검증. test-deploy-azrael focused1pass/exit0(work2c55166c-762c-44cb-a2c9-ea01431a0555), 보고 `artifacts/tasks/deploy-checks/runs/40b98fc91e1140779bfe5f23977b44dd/reports/results.json`. architecture/ops의해당계약갱신.

복구 구현 검증: shared cache Windows native-backed9/9, generic lifecycle generation/cleanup선택41pass, 최종 recovery1pass 모두 exit0. fixtures 삭제 확인. 근거 FT-02-cache-recovery-test runs 20261104T130337601Z-e8b2811a-bf68-4cbf-9b85-1f4552db7bd2, 20261104T130452694Z-20f26398-19b6-458f-b89a-8068e3f70a1b, 20261104T130551367Z-86414d4a-cf30-4557-9303-a3782cee18c3. API는정확generation/revision/token/hash/stop증거/targetretirementreceipt를검증하고 activelease·tampering·stale·불완전권한을거부한다.

실제 physical target lease 복구 exit0, 부재확인. receipt `artifacts/tasks/FT-02-target-recovery/runs/20261104T130237346Z-956442a1-4dad-4e93-9ab4-6b02d5055e10/reports/target-recovery.json`, SHA fd341abceb9252ad9e274caf7edd3a9b0e191810525d2cc8f7245207d794a0f3. priorresult unknown/null 유지. 실제pipeline 두단계 build/build.engine는Windows기존writer+buildhandle을획득한 상태에서 recover를호출해unknown/null과stage별복구증거를기록했다(exit0). 근거 `artifacts/tasks/FT-02-pipeline-stop/runs/20261104T130533573Z-d4283e67-a50e-4da5-a0f3-dd649ac30d28`.

현재 실제sharedcache recovery는독립stop/targetreceipt 소유run을cache의dependency로등록한뒤정확revision으로진행한다. 새generation은아직시작하지않았다. 기존F 소스는그대로며새복구코드를포함한scriptdelta 입력을준비한뒤동일physicaltarget을재사용할예정이다. Cargojobs1은cachekey에포함되지않는실행동시성변경이며samekey를실제로재확인한다.

실제 cache recoverExecution 완료 exit0: `artifacts/tasks/FT-02-cache-recovery/runs/20261104T130718921Z-76d5f85f-e95b-436c-b01f-b47d50a97196`. lifecycle rev6, stopped unknown/null, canRestart=true, samekey9d65c03f... 유지. cache에target/reboot proof소유run dependency를기록해다음generation에서도증거보호를유지한다. 아직컴파일재실행/설치는하지않았다.

새13-script delta 준비 시작 work86c98ca2-ebec-468b-9e29-9c963cd6983f. working artifacts/g, immutable delta artifacts/inputs/ft17-recovery-20261104. baselineB V8 source/engine 재사용, CARGO_BUILD_JOBS=1. 기존6script+pipeline2+lifecycle/sharedcache/test3+deploy/fixturetest2를고정한다. docs는primary운영설명으로유지한다. 준비완료 전source변경없고추가대용량복사를실행하지않는다.

G 입력준비actualexit0. manifest `artifacts/tasks/FT-02-recovery-inputs/runs/20261104T130916690Z-e5922704-20c5-4fc0-974b-51d5c8ad9cfa/reports/deployment-workspace.json`, SHA54e5d8cc59987a67d2c2c96d117246db7fd8d809d216195e36801d8f2360e34e, projectSHAeba2a3b541ed4a8498704bd353939bc5af3ed36d6273484484e000ecc854723b, input:3da5c5c6421f59ecae2b7ece/workspace:3da5c5c6421f59ecae2b7ece. tool준비는F의lock동일dependencies와두UI pin의package.json/out/extension.js/webview만복사하며단독진행한다. 13개override/전체changedPaths, instructionroot, 실제consumer probes를유지한다.

현재Windows CIM disk 성능조회가능을확인했다. 재빌드에는기존기본빌드로그와별개로30초간격디스크처리량/대기열의작은task소유진단로그를남길예정이며, 정상상태관측을장애원인배제나테스트통과로취급하지않는다.

G 도구준비actual exit0: `artifacts/tasks/FT-02-g-tools/runs/20261104T132515613Z-407f29e5-b725-4c2b-a4aa-9c82ef806abb/reports/readiness.json`. npm/Bun cache, G TypeScript require, fixture readiness 모두성공. 7,152changedPaths에13overrides모두포함/hash재확인. 필요한두node_modules와UIclosure만복사했으며Cargo복사/재설치없음.

VerifyOnly `win017-ft02g-20261104` 시작 workcd08ca73-a29c-4200-97ee-2e41f5a30931. G frozen13-script inputs, samecargo/scopedkey/V8, jobs1/sourcefile1/sourcegroup1. 별도30초disk-samples.jsonl observer는taskrun에귀속되고배포child종료후stopfile로정상종료를관측한다. 결과에는monitor실제exit도분리기록한다. CPU/RAM/디스크상태를검사성공이나멈춤원인확정으로대체하지않는다.

## 실시간 모니터 하 재개

사용자가 실시간 모니터 기록 시작 및 병렬도1 유지로 복구·재개를 요청했다. CPU온도수집은미확인으로유지하며수집성공/정상온도를주장하지않는다. 기존G workcd08ca73... 관측unknown, Windowsboot13:41:39.5Z(22:41KST)로확인. 이번에는Cargo시작전engine-source-preflight에서중단됐고22개checkexit0이남았다. 이전disk로그의마지막정상JSON은13:34:42Z이며후미NUL영역이있어이후시간대의연속관측을주장하지않는다.

새 독립boot증거 `artifacts/tasks/FT-02-g-recovery/runs/20261104T140720831Z-0a65e2ed-0136-4a85-84ad-6850b8958cbe/reports/reboot-evidence.json`. 실제G 기존pipelinewriterhandle획득하에engine-source-preflight currentstage1317b892-5907-4d0e-b30b-5b15de4ba337만recover, unknown/null유지. 원래verification/account-controls의planned경로모두부재·단계미시작확인후ownerfinalize완료. 결과exit0 `artifacts/tasks/FT-02-g-resume-recovery/runs/20261104T140902274Z-7e1b0905-ef11-44aa-90dc-ea5577511109`. Cargo shared rev6/canRestart=true는그대로이며재복구/복사하지않았다.

sameRelease win017-ft02g-20261104 / samefrozenG / Resume=true로재개(work0d427435-1b8b-4a9e-9562-7264e4f9f306). CARGO_BUILD_JOBS=1, SourceTestConcurrency=1, SourceCheckConcurrency=1을launcher에서검증. 사용자외부모니터와중복하는자체monitor는추가실행하지않으며저장경로를질문했다. 답변을빌드선행조건으로만들지않는다. 현재목표는모든필수검사후실제engine추가검증과동일package 사용자프로필설치까지다.

G Resume work0d427435... actualexit1(2026-11-04T17:12:51.715Z). engine-source-preflight/build.engine/build.engine-ready 모두actualexit0. Rust 본체/bridge/code-modehost 컴파일과provenance/IPC 호환성검사는성공했다. 실패는build.package의동기Move-Item에서final공유상위 artifacts/g/artifacts/releases가없어서발생했다. package staging에는engine/azrael.exe와azrael-ex.vsix가존재하고package.log정상경로출력이있다. source-tests는부모실패취소로-1이며통과로취급하지않는다.

source변경/새입력복사/engine재컴파일없이공유release상위디렉터리를준비한다. 실제부모exit1+Move-Item오류로그+package정상반환증거를SHA로묶고기존writerlease하에미완료build.package만unknown/null보존recovery한다. 미생성acceptance/account fixture예약은같은증거로ownerfinalize한다. 같은G/Release/Resume/environment를유지해성공엔진checkpoint재사용과실패packaging 재실행을요청한다. 사용자요청대로추가monitor조사는하지않는다.

상위release디렉터리준비/packaging복구exit0: `artifacts/tasks/FT-02-package-parent/runs/20261104T171620978Z-0601d41f-e2d7-484c-be92-e8cac8491d72`. 이어진Resume work640c5fbd...는engine-source-preflight 재실행 중 adapter 테스트의rmSync에서EBUSY가발생해exit1. 제품assertion이아닌검증임시폴더정리실패이며강제삭제/조건완화하지않았다. 동일G의check-unavailable-tool-adapter.cjs 단독재실행은exit0(18tests); `artifacts/tasks/FT-02-adapter-recheck/runs/20261104T172358969Z-351ef5c1-d58f-470c-83c5-8cde6e3071fb`에근거저장.

마지막실패attempt82d3846185e14d5c8a79c79aa7fcecb9의미생성검증fixture예약을actual4stage결과로ownerfinalize하고sameG/Resume로재개(work25768399-a511-4ce7-bcac-294285430076). engine/build.engine-ready 성공기록유지, build.package unknown+verifiedrecovery유지. 병렬도1. 아직최종패키지/필수검증/설치완료아님.

최근G source-preflight 두회에서동일Bun adapter 테스트cleanup rmSync EBUSY 반복. 실제 sourceConcurrency=1/sourceTestConcurrency=1 확인했고Bun경로도기존동일pinned입력이다. 원인확정없이병렬도때문이라고주장하지않는다. 같은preflight environmentPatch(TEMP/TMP/TMPDIR G/artifacts/t 포함)를적용한단독2회는모두exit0(`FT-02-adapter-env-check/20261104T173212134Z-b9362e1d-640a-45c7-b692-0fd2ed31089a`). 남은path는sessions/tools-thread.json이며Bun종료후exclusiveFileShare.None 읽기가성공했다. read-only tracing에서bindingread finallyclose, OAuthlockclose/release, syncwrite+rename, infer timer/budget dispose가확인됐으나실제당시holder는확인되지않았다.

동일fullretry는보류하고pinnedBun의표준rmSync maxRetries/retryDelay를일시적Windowsno-delete-sharing holder/지속holder로검증한다. 지원될때만기존test finally의ordinarycleanup에제한된retry를적용하며force/ACL/검사assertion 변경없음. TS파일변경은scriptdelta대상밖이므로정확한기존immutableB baseline+G의13고정script+단일검증된TSoverride로fullinput을준비할예정이다. 그경우에도성공한globalCargo release의engine/bridge/host/provenancebundle을명시재사용하고Rust재컴파일은하지않는다. enginecheckpoint SHA: azrael443760a91191c946d3e71a7e2c17317299dc23ea7bd89c2ac8a9bd21e69f7513, bridgea7b7030420465e08e48d8cd68996d4048be8fe9be14ad11384994a9a7805c62b, host5eec9d3a5ab3b961c9569d6399f5660ca90a0530486a820d193fc4e94e5f96e4, provenanceb32f9c1552c36b17ba907d633947c140f51e826d1e05ce90c3625c9e68ad481c.

Bun1.4.2 Windows x64에서 rmSync와 fs/promises.rm 모두 maxRetries5/retryDelay100을 실제 적용하지 않아500ms 공유잠금 유지중 각각0.64ms/3.28ms EBUSY로종료했다. async probe run FT-02-bun-async-rm-probe/20261104T175753441Z-429c7d40-8ba0-484b-b754-128ddbee01ee exit1. source수정없이holder정상종료후일반삭제성공. 따라서 같은rmSync 일반삭제의Windows EBUSY에만100/200/300/400/500ms(총1.5초) 제한재시도를test cleanup에적용하고일시/지속잠금검증및18adapter검사를수행하기로결정했다. force/권한변경/다른삭제owner/검사assertion변경없음. 사용자추가답변은빌드만계속하도록요청했으며monitor경로추가질문없이기존빌드·검증·사용자프로필설치목표를유지한다.

제한same-rmSync 재시도수정검증완료: transient500ms는606.9ms후삭제성공, sustained5s는1508.2ms후EBUSY전파및holderlive확인;모두holderexit0후fixture삭제. exacthelper probe FT-02-bun-owned-rm-retry/20261104T180034107Z-54a1dafc-de5e-42e8-95df-a0e5a3c45490 exit0. 실제adapter18pass/208assertions/exit0, FT-02-adapter-bounded-cleanup/20261104T180255227Z-d01f339a-c3fd-4813-bad0-5cd9a339de86. primary TS SHA7df269ceabde819a63e8aaa81e6c0d888d7d0cc3a65d958ce69fd62a1f2e846d. root diff검토로assertion/envrestore유지확인. Windows x64만실제검증. 다음입력H는B의정확한baseline+G13script+이TS만fullfreeze하며성공한enginebundle은SkipEngineBuild로재사용한다. 도구준비/빌드와복사겹치지않는다.

H fullinput준비exit0,30.64분(immutablecapture19.40분/workingcapture4.05분/enginecheckcopy2.54분). 로그오류없음,자원제약확정없음. FT-02-h-inputs/20261104T180810801Z-552fc705-06f1-4cf0-8c76-e9845f518e97/reports/deployment-workspace.json SHA29d6b6d8129411f6b72d847cd493d3a31031fba3283fc895b8cf60ce6f0a0347. Baseline d104a2...일치,immutable/workingSHA14a155aedac748d9b654410c455f7a5930fde384263952e168f5cd21dd40cfbe. input/workspace:b034590a58d422a1a909d53a. 이제G lock동일도구만H에순차준비하고preflightfixtureprobes후SkipEngineBuild로완료enginebundle재사용한다.

H VerifyOnly workd74f2c0c-659d-41c4-bfb7-019332e0ac69/runFT-02-deployment/20261104T184717081Z-84499540-dde4-420e-bd86-54a09bfba469 실제exit1. sourcepreflight0(이전EBUSY해결), engine 재사용/provenance/IPC0, package0. 후속provider module fingerprint가H/artifacts/tools/bun-1.4.2/package/bin/bun.exe 미준비로실패. env AZRAEL_BUN만으로이명시input을대체하지않는다. source-tests는부모실패취소-1,통과아님. 기존Bunowner로정확한localclosure준비후sameH/Resume. 아직설치안함. 미시작verification/account예약은모든member부재+actualmetrics와controllerexit근거로ownerfinalize완료;metricsSHA159cbe0f20f465dc1064889f63982bd7af58755a86fcfe6773ff3b2458353eb5. 처음finalize는Hownerpin없음으로변경없이거부됐고primary검증된standaloneowner선택후성공했다.

H localBun준비exit0: FT-02-h-local-bun/20261104T191547195Z-dd3f5bc5-24db-43e9-ad1e-db7ded85f583. 원본npmarchive/receipt무결성및추출3filehash일치,localBun1.4.2/providervendorprobe0. 원본pin은protected shared-source-tool:bun-1.4.2-win32-x64로보호등록(protection_known:false);H4fileclosure별도owner.
SameH Resume workc0b4d050-a5c4-44b5-91bf-d5c6cbd44382/run20261104T191728975Z-3b5b19e0-f4a4-4123-b736-1bc1a5839961 exit1. 새로운build.engine checkpoint c63bba3b... inputsKey40ce...는성공했지만기존package는이전engine43a70349...에의존해lookup불일치. release존재guard가overwrite거부. 파일손상확정아님. 기존H failedstage/protectedpackage보존,source복사/engine재컴파일없이새release win017-ft02h2-20261105+freshfixtureH/artifacts/w로같은H와전체enginebundle사용. Worke241459f-e59d-4774-a3ca-bf6bd19de666/session25969실행시작;Resume없음,sourceconcurrency1/Cargoj1유지. H이전d354190b미생성fixture예약정리와failedversioncleanup은후속owner정리필요.

H2 initiallauncherworke241459f-e59d-4774-a3ca-bf6bd19de666는VerificationFixtureRoot artifacts/w가허용되지않아pipeline시작전exit1. 허용v경로의이전d354190b예약을부재+terminalmetrics로finalize한후v로수정해재실행(불필요한경로선택오류root책임). 실제H2 runFT-02-deployment/20261104T194113301Z-585732e8-82de-402e-8940-ce39961ae4ac PID11016 terminalexit1. sourcepreflight/build/engine/engine-ready/package모두0. engine-preservation 'Source preflight input identity is stale'로0checks/102blocked,source-tests와prepare취소-1. 실제수용/설치아님. receipt H/artifacts/logs/deploy-win017-ft02h2-20261105/engine-preservation/preservation-YSOc0X/receipt.json. 동일source상두단계identity필드차이를기존readonlyowner로확인중;검사생략/영수증위조/immutable수정없음.

H2 staleidentity진단: sourceInputs에서engine제외비교시유일차이는inputs.executionEnvironment(preflight32dbbb2a... vs preservationc5104f26...),source/tool/runtime/concurrency등동일. feature-preservation.checkEnvironment가AZRAEL_WINDOW_SETTINGS_TEST_ROOT 미지정시각outputDirectory/window-use-settings-fixtures를사용해두단계환경hash가달라진다. 기존지원env변수로동일run소유fixture root를명시하는실행보완선택;hash검사유지/receipt변조/source검사생략없음. source수정·새snapshot불필요. 환경변경은기존stagekey를무효화하므로sameH+성공enginebundle사용하되새release win017-ft02h3-20261105 실행을준비한다. H2실패prepare의fixture사용상태/소유정리선행조건확인후실행하며v-3대체는socket길이실제검증조건부다.

H3 최초실행은H2의부재fixture예약충돌로stage시작전실패. H2예약finalize 및H3정확7member(실제0bytepipeline.lock) closefailure/native정리/finalize실제성공. H소유FT-02-h3-retirement/20261104T204649224Z-9b6017cd-b600-41c7-8880-1bb3e705042c/reports/cleanup-result.json. 근거workingfile을H2finalize뒤확장해참조hash가바뀐제약있음;accepted원문snapshot과mapping보존,원기록변조없음. 이후근거불변준수요청.
H3 재실행FT-02-deployment/20261104T204916632Z-6d89c4dc-5c3c-4952-a55d-7dce3de62c0a actualexit1,child11788closed21:16:26UTC. commonenv실제두config동일hashprobe0. setup/sourcepreflight/build/engine/package0. prepare는account-ui/provider-accounts-host.cjs의./platform-runtime.cjs missing으로exit1;source-tests/preservation취소-1. root확인prepare-independent-vscode.ps1 account-payload가platform-runtime.cjs/azrael-platforms.json을out/에만복사하고account-ui복사목록에누락. 최소fix두account-ui파일복사+namespacecheckpointinventory추가를primary에서진행;failedpackage/H불변유지. fix후fullHimmutable기반scriptdelta로새입력,engine재사용예정.

account-ui 수정 실제closure red1→green0, 기존focused1pass0, PowerShellsyntax0. primaryprepare-independent-vscode.ps1 SHAdd44b0fc1e494bf88d3aed7132c5361e1d3041e3e212c01a33a73756351ffea2. H와직접diff는account-ui2filecopy+finalVSIXinventory만변경. J scriptdelta준비0: FT-02-j-inputs/20261104T212418573Z-10b1728c-4036-41a0-b15c-5008d6d21b2a/reports/deployment-workspace.json SHA925a7e2476b543fc6e1af76416b561c10babac5ef4aa9070ef59f944ad4eeea5/projecta33c3be910bc9befcaf309e59d6cd4214a4c89a98292572507585a0b30515a76, input/workspace27dd585aae29e752a46c48e9.
J tools실제6probes0, FT-02-j-tools/20261104T213601457Z-5ba57a53-50f2-414a-a753-e1414498c357/reports/readiness.json. 7153changedPaths+15combinedfixes유지,localBun/runtime의존closure준비완료. win017-ft02j-20261105 VerifyOnly를공통settingsfixture환경/전체mandatory33features/serial/기존enginebundle로시작지시. 최종검증·추가Devin·설치·cleanup미완료.

J VerifyOnly runFT-02-deployment/20261104T215613272Z-b7f4a0bf-dbae-451f-8ba6-49ad7f501933 actualexit1,child24332closed. sourcepreflight/build/engine/package0,prepare1. 기존account-uiplatformclosure오류해결후sync-codex-environment.validate가C:/Users/felre/.azrael-ex/skills/computer-use unmanagedretiredskill로거부. 실제현재hash2a0ed8fe8285e1cb5c29f9554cbd778775ccfda2896df31e0312000de096f8a3,priorReceiptmanagedState없음. window-use는현재/priorhash579ad40b912f6a0e3da7ef85a06642d12242586ce90d9f19494548424b6e5167일치하여동일충돌아님. currentarchitecture/computer-use.md는다음WindowUsepackage의retirement설계이고설치이전사용자상태보존계약이다. 기존운영docs일부legacyretirementdeferred설명과상태불일치있어그문구로삭제권한추론안함. unmanagedcomputer-use를임의삭제/영수증소유로위장하지않고백업후활성폴더제거권한을사용자에게질문할예정. source-tests/engine-preservation취소-1로통과아님. 설치/cleanup미완료;현재진행producer없음.

사용자가기존computer-use삭제승인후추가사전검사없이처리요청. root는별도내용/충돌재검사없이정확경계확인후원자적일반rename으로활성폴더를backup이동(exit0),source부재/backup존재확인. 백업 run:FT-02-retired-skill:20261104T230240704Z-af2ae637-b0e6-4c84-968f-d14e870d53cf, outputs/computer-use-backup. 이전관측5files35838bytes;이번추가hash검사안함. 원본소유receipt조작/force삭제없음. 설치정상확인때까지최소복구backup으로보호하고후속owner정리예정. 기존J소스/engine완료결과재사용하여win017-ft02j2-20261105 검증재개지시. 사용자지시는이skill삭제사전검사생략이며필수제품검증생략으로해석안함. 기존Jfixture예약은terminal증거/부재ownerfinalize선행,가능한기존sourcepreflight는지원receipt+동일env조건에서재사용.

정책구현 준비: 공통verification-reuse-policy.cjs는이전/현재/근거hash에묶인reviewId, scope/action/reason 결정을검증하고민감값대신field/hash차이를보고한다. pipeline lookup은일치자동재사용,일반차이review-required(exit3),명시rerun/null또는reviewed재사용/감사기록이며원래exit/id/inputs불변. 캐시는이전key삭제전에성공로그무결성검증·review를수행하고reviewedhit을새key성공으로재발행하지않는다. native/Cargo의정책전달관리변수하나만의미환경hash에서제외하고그외환경은유지한다. sourcehandoff/verify/bind는원래검사범위·원본로그증거를보존하며reviewed재사용/실제재실행을구분한다.
root는Windows/portableCLI 결정파일전달,code3전파,standalone패키지helper포함과ownerinventory를통합했다. 독립packager UI체크전달도연결. 모든worker테스트는진행중J2부하와겹치지않도록미실행상태로인계했다. Cargo검증helper diff는관리변수전달/절대경로검증2줄뿐임을J와직접비교했고SHA dff29bb34537e0a90c51f925ea6b2876f9a4f93bb47224ecefa63a7f86eb5fb5의auditedallowlist추가승인. 정책현재상태는코드작성완료·자동검증대기이며수용완료아님.

정책1차직렬회귀 FT-02-reuse-policy-tests/20261104T235032878Z-734c525e-477b-4afb-acb3-b364a17046f9: pipeline/basiccache/pipelinepreservation/cargocommand/buildplatform 및PS구문3종통과. gate1실패는concurrency변경에대한예전failed기대; sourcecache5실패는fixture가이전reviewattempt에서실행된기록을버리고최종receipt만집계한오류; native1실패는변경key재실행을명시선택하지않은기대. 실제receipt는앞서실행된검사를다음attempt에서재사용했다고정확기록했다. 테스트는모든attempt근거/횟수를보존하도록수정하고원래receipt는변경하지않는다.
Cargo1실패는이미승인된scope/복구변경의sharedhelperhash가sourceOnlyallowlist에없었음. root가HEAD→current전체diff검토로명령실행/제품바이너리참조변화없음을확인,normalizedSHA6a91db8d1f128157fa27fbc42b1033d4903bd005ce0a92f273753246c42fbfd4 등록. platformpackaging1실패는변조패키지를더이른integrityguard가거부해기대문구만수정. standalonedeploy재실행은explicitreceipt통과/fullinstallfixture status누락실패,실제성공응답과맞게statuspassed추가. 실패만재실행예정.
진행했던J2배포는Windowscleanup assertion으로actual1종료. 해당test는lockedbody실패후log보존/partial상태복합assert의어느부분이달랐는지근거누락;테스트정리전실제candidate/member상태를로그에보존하는최소진단보완뒤단독재현한다. 정책결정으로이실패를통과시키지않는다.

정책직렬재검증 r2-mw2s6165 실제전체exit0: 이전실패Node5suite총90tests/0fail,focuseddeployment3cases0,cleanup구문0와full54assertions0. 이전통과pipeline/basiccache/pipelinepreservation/cargocommand/buildplatform/PS3구문근거재사용. Windows정리잠금복합assert은동일production코드로재실행통과했으며이전J2실패의실제조건은그당시근거부재로확정불가. 진단추가가복합assert을완화하지않음. 결과 artifacts/tasks/FT-02-reuse-policy-tests/runs/r2-mw2s6165/reports/results.json, standalone artifacts/tasks/FT-02-reuse-policy-deploy/r2-mw2s6165/reports/results.json.
사용자승인정책은구현·Windows회귀통과. 현재원래목표의설치완료를위해최종K전체입력준비지시: J고정baseline+정확28script(신규공통helper포함)+2docs만override,새input ft17-reuse-policy-20261105/workingK. 성공enginebundle 재사용,CARGOj1/소스병렬1유지. 새helper추가로지원fullmode를사용하며ignoredCargo캐시복사없음. 모든source파일은capture도중변경하지않는다. 이전wholegitdiffcheck는관련없는광범위CRLF/기존변경경고로종료1이었고본정책실패검증으로취급하지않는다.

최종K준비actual0(43.1분), baselineJ a33c...일치. manifest artifacts/tasks/FT-02-k-inputs/runs/20261105T001605110Z-1f65e40b-a129-4267-96bf-d798291a90cc/reports/deployment-workspace.json SHA7f76edcb34afcb127af457159032d37a3d01d2a654357090dd257967c720ab9a, project5672ae1ba11695b38c225f7f1ca0cda2f9bed1c3391a7ba6fee3d346a7720518, input/workspaceadf1ab0f319e9760599601ab. K도구최종6probes0: FT-02-k-tools-final/20261105T010636177Z-3f106da8-7d5c-4f2e-a6d4-d6f0ba7f453a/reports/readiness.json. 첫Buncacheprobe는cwd에package.json없음으로1이었고올바른providers/opencodex cwd에서기존복사그대로재실행0. 전체changedPaths7157.
win017-ft02k-20261105 VerifyOnly 시작지시. 새정책아래 review-required/code3는실제testfailure와구분하여근거검토후모델결정을task소유JSON에기록한다. 결정없이강제재검사/기존성공위조안함. 실패1은계속차단. 같은K/Release와성공enginebundle,공통settingsenv/serial을유지한다.


K VerifyOnly: source-preflight/build/engine/package exit0, prepare exit1. 원본 node_repl browser service가 cache 26.1007.21434를 참조하는 동안 현재 marketplace는 26.1023.51421을 materialize하여 경로가 불일치했다. 원본 이전 버전 파일은 존재한다. 실패한 prepare와 취소된 후속 검사는 통과로 취급하지 않는다. sync-codex-environment에서 검증된 materialize 결과 버전으로 stage/final node_repl 환경 참조를 재결합하며 service 존재 검사는 유지한다. 외부/미선택 plugin 경로는 보존한다. 공통 구현이며 이번 실제 검증 대상은 Windows x64이다. 기존 snapshot suite 15개, environment engine suite 26개, 일회 경계 검사 22개가 모두 통과했다. 긴 fixture 경로에서 SQLite 초기화 실패한 최초 검사는 짧은 소유 경로에서 동일 assertion과 실제 engine으로 재실행했다. 기존 packaging 검증이 누락 경로를 이미 검출하므로 새 영구 테스트는 추가하지 않는다. 설계 설명은 docs/architecture/azrael-ex.md snapshot 섹션에 반영했으며 문서만의 수정은 L 실행 코드 입력에 포함했다고 주장하지 않는다.


User resumed after explicit stop. Previous L preparation run 20261105T030526874Z-d098dfe6-6f87-47f6-993e-0b0f52dcc755 remains cancelled; exact owned tree stopped, executor exit1 preserved separately from lifecycle unknown/null. Partial L roots require supported recovery before reuse. Resume owner prepares only immutable inputs and tools with pinned K environment (including RUSTY_V8 paths), concurrency1. Root will accept readiness before final VerifyOnly, then exact-package install with NoLaunch. No source edits or test reruns are requested by this resume.


## 빌드 시간 최적화 검토 및 승인된 변경

- 사용자는 컴퓨터 멈춤과 병렬도 제한을 최적화 조건에서 제외했다. 전체 완료 시간을 줄이고 의심되는 단계마다 근거와 개선안을 제시한 뒤 승인받는다. 기존 버전 시간은 과거 기록을 재사용하며 새 버전만 측정한다.
- 입력 복사 개선: 같은 프로세스의 검증된 baseline handoff를 재사용하고, 측정한 inventory에서 native copyFile/COPYFILE_EXCL로 복사한다. 복사 직후 중복 전체 해시 검사는 없애되 소비 시 검증과 baseline 변경 검사는 유지한다. 해당 변경은 이전 17개 그룹 및 capture 13개 검사 근거가 있다. 최종 전체 빌드 입력에는 아직 반영하지 않았다.
- 승인된 기본 프로필 PNG 200장을 투명도 유지 512×512로 교체했다. 195635668B→62086260B, 새 변환 11.477초. 512×512는 권장값이며 다른 크기 및 사용자 이미지 지원은 유지한다. commit f6d5ac16b5cbc5d7fe92be33f833928672db09cb.
- 승인된 VSIX 최적화: PNG/JPEG/WebP/AVIF/GIF/WOFF/WOFF2는 ZIP STORE, 나머지는 DEFLATE. 16개 검사 통과. 이전 K prepared host의 동일 20665 entries에서 새 writer 36427.344ms, 과거 archive 414019.604ms. 모든 CRC/비압축 길이/모드 일치; 새726759279B, 과거684532758B. 과거 병렬 부하가 달라 11배 인과 개선이나 전체 빌드 절감으로 해석하지 않는다. commit 0b24a7f527918abed132628e4bf13c2de07eb6e5.
- 현재 사용자 요청: 축소 전 원본은 레퍼런스 3개만 보존. 제품 200장은 이미 축소본이고, 예전 생성 폴더 3곳에는 원본·참조·HTML 사본이 남아 있었다. 시로코10010/수영복 이즈나10046/시미코26004 원본 SHA를 축소 전 provenance와 대조해 일치 확인. 624개 loose 이미지/HTML 413401594B 및 이전 5쌍 비교 HTML 묶음을 owner로 정리 중이다. 생성 프롬프트·승인 JSON은 보존한다. Git 이력과 기존 고정 빌드/복구 입력은 별도 소유자로 이번 선택적 삭제에서 제외한다.
- 현재 레퍼런스 위치와 해시의 독립 기록: artifacts/visualizations/blue-archive-expansion-20261012/retained-originals.json. 사용자 승인된 지속 레퍼런스 3장 총3296138B. 제품 metadata의 삭제될 HTML 링크는 null과 retirement 설명으로 바꾸었다. Windows x64에서 실제 validator 및 200장 크기·해시·순서, 3장 원본 해시 검사 exit0.
- 다음 검토 후보(미승인/미구현): K companion 캐시는 hit였지만 13494개 산출물 전체 해시 검사에115280.7247ms, 입력 fingerprint23578.5386ms가 걸렸다. 산출물에는 VSIX뿐 아니라 companion/node_modules와 dist 전체가 들어 있다. 캐시 소비자가 실제로 쓰는 배포물/TS/VSCE 도구를 구분하거나 의존성 캐시를 source cache와 분리할 수 있는지 검토한다. 검증 생략 또는 절감 시간은 아직 확정하지 않았다.

Cleanup continuation: native register completed for four groups work:FT-02-original-avatar-retirement:20261105-{1,2,3,4} (160/160/160/144 files). Preview group is combined with batch1. Expanded review >200 was rejected before deletion; corrected per-batch reviews. Controller node PID7020 (StartUtcTicks639294548567922748), managed session58804, currently applying batch1 via native PID8588. At2026-11-05T06:00:55Z, presence-only checkpoint observed65/160 first-batch files absent and preview root absent; this is progress, not final success. Native observed CPU use confirms active execution; do not duplicate or interrupt it. Observer managed session6616/workId d5faa27a-2607-4dda-9d98-a19264e8a291 only waits for pinned controller termination. On resume inspect session58804 terminal exit and outputs/apply-{1..4}.json actual per-item results before accepting cleanup.
Caller run: artifacts/tasks/FT-02-original-avatar-cleanup/runs/20261105T055015658Z-d668b10f-7a55-40c7-849a-9d98a386f6c7, lifecycle generation pending (known previous stage exited1 on review size guard; generation not yet closed). Native per-item owner procedure is slow for this leaf-file group; retain truthful states. No new expensive producer is authorized by the wait.
After deletion: verify exactly3 raster originals remain across three named legacy roots and200 resized product PNGs unchanged; finalize preview lifecycle. Retain independent summary with reference index/metadata, close caller generation with actual outcome, commit prepared alternate index (outputs/commit.index; outputs/commit-preparation.json records normal-index digest and scoped paths), reconcile normal index only for scoped paths, verify39 unrelated staged files unchanged. Then delete/finalize caller run through owner. Do not delete three retained references or textual generation metadata. No new product build/install has started.

원본 정리 완료: 네 native 배치 actual exit0, aborted/cancelled=false,625개 모두 deleted/remaining=false/error없음. 예전 생성 폴더3곳의 raster는 승인된 원본3장만 남고 HTML0개. 논리삭제크기422923695B. 제품200 PNG의512×512/명단/해시와 원본3장해시 재검증 exit0. 독립결과 artifacts/visualizations/blue-archive-expansion-20261012/retirement-result.json; 보존목록 retained-originals.json. 이전 비교HTML lifecycle finalize 완료. 호출자 run12,247,746B도 native owner로 deleted/remaining=false 후 finalize 완료. scoped commit87af9d9db44b0bf9917b96c7571d822c3a84bc0f; unrelated staged39개 binary diff SHA256 동일 보존. 고정 빌드/복구입력,Git이력,프로젝트 밖 tool-managed generated_images는 이번 정리에서 변경하지 않았다. 새 제품 빌드/설치는 아직 시작하지 않았다.
다음 승인 제안: 캐시 적중 때13,494개 산출물을 순차 해시하는 비용(과거 K115.281초)을 줄이기 위해 .NET 표준 bounded parallel hashing을 적용한다. VSIX 외에 실제TS/VSCE와 의존성을 소비하므로 현 단계에서 전체 검사를 생략할 근거는 부족하다. 검사 대상·SHA256·링크/변경 감지·영수증 검증은 유지하고 파일 해시 실행만 제한 병렬로 바꿔 새 구현 시간을 측정하는 최소 개선안이다. 구형 시간은 과거 기록만 사용하고 부하 차이 때문에 인과 속도 향상은 단정하지 않는다. 아직 사용자 승인·구현 전이다.

Parallel module hashing approved by user. Root owns build-module-cache.ps1 fingerprint scanner, focused tests and owning project-maintenance architecture paragraph. Common .NET/PowerShell implementation; actual regression/benchmark Windows x64. Reuse Parallel.ForEach with max4 readers, preserve deterministic rows, complete SHA256, link/change checks, key serialization and cache lease/receipt rules. Existing uncommitted serial C# batch scanner is an approved prerequisite; commit only that fingerprint unit plus parallel implementation/callers/tests/docs, preserving unrelated recovery/cleanup changes and39 staged files. Verify small multi-file/hash/error contracts first, then existing module cache regression and one new implementation scan of exact K companion outputs. Historical115280.7247ms reused; no old writer/hash implementation rerun.

승인된 fingerprint 병렬화 완료. commit a7699e95c5c54dd1421f17538d30ae5c72949e1b. 기존 미커밋 C# 배치 scanner와 필요한 Get-BuildModuleKey/Get-BuildModuleEntry/Save-BuildModuleEntry 호출부를 기능 단위로 함께 커밋했고 unrelated복구·정리 변경 및 staged39개는 SHA256동일 보존. .NET Parallel.ForEach 최대min(4,ProcessorCount), 원래 행 사전할당으로 완료순서와 key순서를 분리하고 전체SHA256·수정시간/길이·링크/경계·lease/영수증 검사를 유지한다. Windows 해시조회는 기존의 대소문자 비구분 경로 해석을 유지하고 Unix는 Ordinal을 사용한다.
검증: Windowsx64 PowerShell7.6.9 Node26.7.0. 전체 scripts/test-build-module-cache.ps1 -FixtureRoot <owned-short-root> actual0(130.252초), 최초 read/worker mapping/실패·schema2·제외폴더/파일/링크 및 staged판본 별도계약검사0. Windows 경로대소문자 보완 후 실제 staged생산함수로 cachehit/영수증 대소문자/실제 출력손상거부 검사0, 최종실제Get-BuildModuleEntry 측정0. 전체회귀 전부를 작은호환성 보완후 반복하지 않고 영향받는 경계를 재검사했다.
실측대상: 기존 K companion key 6e77cd148c78453e2aff2ba8c9d635bf041585d7398b7458f76431875b3d3213, 같은1939개 input roles 및13494개 출력 영수증에 실제hit=true; 첫 출력검증29.5388초, Windows호환성 보완 후 재측정3.5744초. 최종입력 fingerprint2.5526초/전체cache lookup6.6776초. 과거K 출력검증115.2807247초/입력23.5785386초를 재사용하고 구형은 실행하지 않았다. filesystem cache와 병렬부하·이전 배치개선 영향이 있으므로 순수 병렬효과나 전체빌드 절감으로 단정하지 않는다. 새형태가 같은cachekey/bytes검증을 통과했다는 근거와 관찰시간을 구분한다.
현재 원래 빌드/설치 목표는 미완료. 다음 제안 후보: feature-preservation.cjs eligibleGroups가 UI source/cacheInputs에만 개별 결과캐시를 허용한다. 엔진 source검사는 전체단계/기존preflight receipt 재사용과 별개로 개별 결과캐시에서 제외된다. 과거 K sourcepreflight35그룹818938ms는 후속engine-preservation이 모두 재사용했으므로 두 단계를 중복실행했다고 해석하지 않는다. 읽기전용 엔진 source검사도 완전한 입력·도구·환경 identity와 이전 통과 근거가 있는 그룹에 한해 개별 캐시 재사용을 확장하는 개선은 아직 승인·구현 전이다.

Fingerprint unit cleanup: native actual0, 2 items deleted/remaining=false/error=null; lifecycle finalized with remaining/references/blockers empty. All task copies, raw logs, candidate scripts, indexes and owned short fixture removed. Source commits/tests/docs and current work record retain the necessary acceptance evidence.

Next approval proposal narrowed to3 groups: tool.project-maintenance.adapter285105.8679ms, tool.project-maintenance.writers170401.8357ms, tool.project-maintenance.lifecycle-source128512.9254ms; combined584020.629ms(9m44s) of K source-preflight35 engine-area groups818790.5871ms. Current registry has0 engine-source checks with cacheInputs and13 UI-source checks with cacheInputs; feature-preservation eligibleGroups and activeCacheCheckIds also explicitly require UI area. Existing source runtime binds Node/TypeScript/environment but does not yet declare all external native-owner/Git/Python/PowerShell identities needed by these3 checks. Proposal: make only these complete scoped source groups eligible after binding their actual tool/dependency closures, reuse prior passing evidence only through the supported cache/review policy, and retain real failures/final package acceptance. No implementation or fresh execution of these3 groups occurred during this audit. User approval is pending.


Source-check scope improvement approved. Root owns source-check-selection.cjs, its retained tests, source runner dependency export, three maintenance check declarations, lifecycle dispatch filtering, preservation receipt binding and deployment forwarding. Common Node semantics; Windows x64 execution only. Reuse existing static dependency analysis and full source preflight handoff; do not add unsafe engine-source cache eligibility. Native/final package gates stay unchanged. Unknown feature-owned inputs and full/explicit feature selection retain full checks. Remove duplicated lifecycle test from adapter only; surviving lifecycle-source check owns it. Validate selection, mixed/transitive/unknown paths, exact command selection, source receipt coverage and real selected execution. Tests prevent future omission of changed dependencies or acceptance of a receipt for fewer/different files. Existing 39 staged changes remain excluded. No product build/install in this unit.

Maintenance source selection implemented: commit 75b7b327d4f9006d208dce2d32c673b0703026d1. Three registered source groups select test files through the existing dependency parser. Direct edits, cyclic/deleted dependencies, unknown-owner/full-scope fallback, dispatcher allowlist, selected receipt/command binding and same-selection preflight reuse verified. Dynamic unbounded dependency uncertainty stays visible in selection evidence under existing runner policy. Native and final package gates unchanged; individual engine-source result caching has NOT been added. Windows x64, Node26.7.0: full source-selection + feature-preservation 34/34, exit0,33.844s; final scoped candidate5/5 exit0,1.796s. Exact committed unit reconstructed from HEAD and checked separately to exclude unrelated pending work; current-only registered packaging-workspace test remains in the working manifest, not pulled into this commit. Both current/candidate PowerShell deploy ASTs parse. Actual lifecycle dispatcher selected test-build-platform only, child/parentexit0,19.103s; original whole lifecycle-source historical128.513s is a different scope and not a direct speedup ratio. No old implementation timing rerun. 39 unrelated staged changes preserved at binary-diff SHA2564d2b0a26d8cb397cce51c862d6925ca34a4e7ec7ea8ad72566d59df855465f82. No product build/install run in this unit. Disposable verification cleanup now starts for the named caller and dispatcher groups.
Source-selection cleanup completed: optimized native owner identity verified; two projected run roots deleted with remaining=false and both lifecycle records finalized (no remaining paths, references or blockers). Disposable baseline copies, candidate files, test fixtures, reports/logs and alternate index were removed.

### 다음 검토 후보: 재사용 엔진의 실제 호환성 검사 범위 분리

상태: 조사 완료, 개선안 승인 대기. 제품 코드 수정·검사 실행·새 빌드 없음.

- 과거 K build-metrics의 `code-mode-host-compatibility.log` 실제 성공 시간은 116121ms다. `build-azrael.ps1`은 `SkipEngineBuild`로 같은 바이너리를 재사용해도 이 검사를 실행한다. 같은 파이프라인의 성공 checkpoint를 재개하면 건너뛰지만 새 빌드에는 적용되지 않는다.
- 이름은 코드 모드 호환성 검사이나, 실제 성공 보고서에는 26개 항목이 있다. 세션 재접속, 창 소멸 후 작업 유지, 승인 격리, 여러 세대 엔진, 종료·재시작과 수동 재개까지 시험한다. 다른 source 단위 검사와 동일 실행은 아니므로 중복 실행으로 단정하지 않는다.
- 기존 `check-shared-engine.mjs`의 `runCheck`에 `codeModeCompatibilityOnly` 분기가 이미 있으나 빌드 CLI는 이를 전달하지 않는다. 이 분기의 실제 실행 시간과 최종 빌드 수용은 미검증이다.
- 제안: 엔진 3종 바이너리, shared-engine JS 호스트와 검사·의존 코드, Node/Windows PowerShell/OS·환경 및 검사 옵션이 기존 전체 성공 근거와 일치하면 일반 빌드에는 실제 코드 모드 IPC 확인만 실행한다. 관련 변경·FullRegression·유효한 전체 성공 근거 부재에는 기존 전체 검사를 유지한다. 좁은 검사를 전체 26개 통과 근거로 기록하지 않는다. 출처·바이너리 해시와 최종 패키지/설치 검증은 그대로 유지한다.
- 기존 native 검증 결과 저장소·잠금·재사용 정책을 우선 활용하되, 현재 key만으로 PowerShell 등 실제 외부 도구 identity가 완전한지는 구현 전 보완해야 한다. 과거 보고서에 없는 identity를 사후 생성해 기존 성공으로 간주하지 않는다.
- 측정은 새 방식만 수행하고, 구형 116121ms는 위 과거 기록을 재사용한다. 예상 절감은 기존 전체 실행 시간에서 새 IPC 검사·근거 확인 비용을 뺀 값이며 아직 수치 확정 전이다.


### Engine compatibility implementation and approved archival checkpoint

Status: partial; implementation and focused tests prepared, final native acceptance remains unresolved. No product build/install or unit commit yet.

Approved exact-full-proof reuse is implemented in the working tree with fresh IPC smoke on exact hits, full checks for missing/changed proof or forced/rebuilt engine, existing cache leases, post-run identity validation and distinct full/IPC evidence. Windows x64 evidence: cache suite34/34 exit0, shared-engine guards15/15 exit0, build metrics19/19 exit0, new dependency/recipe/policy checks5/5 exit0. Earlier real cold26/warm4 probe pair exited0 at76.725s/33.832s; historical full116.121s reused without rerunning old code. After expanding final tool/environment identity, the last full attempt completed26 behavioral checks but exited1 on the owned fixture process cleanup guard. This final attempt is NOT a pass and no full result was published. The guard does not identify the conflicting PID, so PID reuse remains a hypothesis rather than a confirmed cause.

User directed preservation instead of deletion and explicitly approved artifacts/archive/FT-02-engine-compatibility/. All three current owned roots were moved on the same volume to artifacts/archive/FT-02-engine-compatibility/20261105T090857908Z-e5aa3626-5b9e-4d03-a5a4-e279c63d9180/ (run/, fixtures/ecf-01b732/, fixtures/ec17/). Ordinary literal PowerShell Move-Item exited0; original roots absent and destination directory identities unchanged. No payload deletion or recursive rehash. Archive manifest retains the failed source lifecycle, exact path mapping and stop evidence; source owner finalized with independent retirement proof; new archive owner work:FT-02-engine-compatibility:archive:20261105T090857908Z-e5aa3626-5b9e-4d03-a5a4-e279c63d9180 is retained with complete membership. Retention is explicitly user-approved, to be reviewed/released only on further user direction. Original diagnostic reports remain unchanged and may contain historical source paths; use the manifest mapping. Unrelated39 staged files preserved at binary diff SHA2564d2b0a26d8cb397cce51c862d6925ca34a4e7ec7ea8ad72566d59df855465f82.

Next: resolve the fixture cleanup process-identity diagnostic gap without weakening active-process guards, then finish only the required final acceptance and scoped unit commit. Candidate/index preparation is under the archived run/outputs. This task remains incomplete; existing installed2026.0.16 unchanged.

### 다음 개선안: 중첩된 엔진 출처 검사 통합

상태: 승인한 엔진 출처 검사 재사용 단위 구현·검증·커밋·보관 완료. 커밋 `b4c04cb976591c187db2023550b4027309f14d9d`. 앞선 호환성 개선의 최종 정리 오류와 커밋은 별도로 미완료 상태를 유지한다. 제품 전체 빌드·설치는 이번 단위에서 실행하지 않았다.

- 현재 `build-azrael.ps1`이 패키징 전후 작업 소스와 보존 소스를 각각 검사한다(4회). 내부 `package-azrael.ps1`도 복사 전후 같은 두 소스를 검사한다(4회). `engine-provenance.py verify`는 호출마다 전체 소스 내용과 바이너리 3종을 확인한다. 두 물리적 소스 루트의 검증은 각각 유지해야 한다.
- 과거 K의 `artifacts/k/artifacts/logs/win017-ft02k-20261105/build-metrics.json`: 외부 사전 검사25.093초, 내부 `package.log`49.804초, 외부 최종 검사24.190초. 이 세 구간은 직렬이며 서로 겹치지 않는다. 내부 시간에는 복사 등도 포함되므로 합계99.087초 전체를 해시 시간으로 단정하지 않는다. 현재 `engine-provenance.py`, `import-engine-source.py`, `package-azrael.ps1`은 K 입력과 바이트가 동일함을 확인했다. 구형은 재실행하지 않았다.
- 구현: 통합 빌드는 시작 시 각 물리적 imported 소스 루트를 전체 검증하고, 이후 같은 빌드 세대의 소비자가 그 관찰 결과를 공유한다. `engine-source-state.py`는 Node/libuv의 `engine-source-metadata.cjs`를 통해 파일 목록·파일/디렉터리 신원·크기·mtimeNs·ctimeNs를 확인한다. Windows의 Python st_ctime은 생성 시각이므로 변경 감지에 사용하지 않는다. 현재 빠른 경로는 로컬 NTFS/Windows로 제한하며 링크·공유 파일·메타데이터 오류·지원되지 않는 플랫폼/파일시스템·세대/target/도구/환경 불일치·상태 파일 부재/손상은 전체 검증을 선택한다. 변경된 내용에 맞지 않는 기존 번들은 계속 거부한다. 바이너리 3종·receipt·profile·host 검증과 단독 패키징의 기본 검증을 유지한다. 소스 변경은 필요한 컴파일/검증 결과의 재생성을 요구하며 기존 불변 입력에 덧씌우지 않는다.
- 확인된 제약: 현재 immutable 입력은 별도 경로·신원·해시로 관리하는 논리적 계약이며, 확인한 경로에 쓰기를 운영체제로 차단하는 기능이나 지속적인 변경 감시기는 없다. 현재 deploy의 시작/설치 전 Get-ProjectSnapshot 및 workspace 검증은 실제 파일을 다시 읽어 변경을 판정한다. 파일 목록·크기·시간 정보 또는 감시 이벤트만으로 내용 불변을 완전히 입증할 수 있다고 주장하지 않는다. 변경 감지 누락/중단/루트 교체/입력·환경 불일치 때 재검사로 전환할 조건과 비용을 구현 전에 정한다. 중복 검증을 다른 이름의 전체 해시로 옮겨놓는 방식은 제외한다.
- 기존 snapshot/verify를 확장하고 build-azrael의 자동 재사용·snapshot·record·전후 verify 호출7곳 및 package-azrael 호출에 같은 실행별 상태와 새 GUID를 전달했다. 상태 파일은 새 빌드/재개 attempt의 로그에 속하며 이전 attempt의 상태를 재사용하지 않는다. 기본 provenance API와 다른 플랫폼은 원래 전체 검사 경로를 유지한다. 별도의 배포 전 최종 프로젝트 입력 검사와 최종 패키지/호스트 검증은 이번 엔진 출처 단위에서 변경하지 않았다.
- 검증: Windows x64, Python3.12/Node26.7/PowerShell7.6.9. 기존 출처 테스트 및 초기 신규 테스트59건에서55통과·4skip, 실제 패키징을 포함한 최종 신규9건 모두 통과했다. HEAD 기반으로 이번 단위만 재구성한 후보11건이 모두 통과했고, 최종 메타데이터/경로 guard 보완 뒤 영향받는 후보3건도 다시 통과했다. 모든 성공 명령 actual exit0. 현재 작업본과 독립 후보의 실제 PowerShell AST 호출은7곳 모두 같은 상태/세대를 전달했고 패키징 전달과 구문 검사가 통과했다. 기존 기본 경로 결과를 재사용하여 반복 전체 회귀를 피했다. 관련 mandatory source check에 신규 테스트를 연결했다. 이 테스트는 후속 편집에서 상태 무효화·항상 수행할 바이너리 검사·패키징 전달을 누락하는 반복 실수를 막기 위해 유지한다.
- 측정: 첫 파일별 Windows 핸들 구현은 과거 전체 검사 비용보다 느려 소유한 측정 자식을 명시적으로 중지했다(자식4294967295, 외부1). 실패 결과를 보존하고 해당 구현을 제거했다. Node 기반 방식은 실제 K 작업 소스10,353개 항목을374ms에 관찰했다. 실제 두 소스·기존 engine 번들로 새 CLI 검사8회가 모두0으로 끝났다. 최초 각 루트 전체 검사는15.451초/35.565초, 이후6회는각1.505~1.913초였으며 총60.823초다. 이 측정은 최종 경로/미지원 메타데이터 guard 보완 전 동일 Node 기반 정상 경로이며 최종 후보 검증을 별도로 통과했다. 과거 package.log에는 복사가 포함되고 동시 실행/파일 캐시/도구 차이가 있어 전체 빌드 절감량이나 순수 개선 비율로 단정하지 않는다. 구형은 재측정하지 않았다.
- 통합·보관: 기존 staged39개는 binary diff SHA256 `4d2b0a26d8cb397cce51c862d6925ca34a4e7ec7ea8ad72566d59df855465f82` 그대로 보존했다. 작업 중 들어온 다른 작업의 Volsnap 문서 커밋도 유지했다. 이번 자료는 삭제 없이 `artifacts/archive/FT-02-source-state/20261105-source-state/run/`으로 같은 볼륨에서 이동했고 원래 루트 부재·이동된 디렉터리 신원 동일·retained 새 소유권 및 원본 소유권 finalize를 확인했다. 보관 목적은 이번 검증/성능 결과이며 추가 사용자 지시 전까지 유지한다. 최초 allocation wrapper가 자동 종료되어 있었던 메타데이터 불일치는 초기 결과를 바꾸지 않고 별도 보관 준비 세대로 정합화했다. 원래 allocation 기록과 각 실제 검증 종료 결과는 archive-manifest와 로그에 보존한다.

### JavaScript 무변경 자산의 중복 파싱 제거

사용자 승인 범위 구현 완료. 커밋 `dd6f328a82885b054af5a72d1239fb507d4db209`. `rewriteJavaScript`는 원본 문법 검사와 AST 순회를 수행한 뒤 수정 목록이 비어 있으면 원본을 즉시 반환한다. 수정된 결과의 두 번째 문법 검사는 유지한다. 기존 사전 필터와 자산 캐시는 그대로이며, 개선 대상은 캐시 미적중 중 수정이 없는 JavaScript에 한정한다. 제품 동작·문서화된 계약은 유지하므로 별도 아키텍처 변경이나 기능 인벤토리 변경은 필요하지 않다.

- 검증: Windows x64, Node26.7.0/TypeScript5.9.3. 현재 작업본 source suite 4/4 exit0(5.353초), 이번 변경만 포함한 HEAD 후보의 직접 영향 검사 3/3 exit0(0.384초). 원본 오류 거부·무변경 1회 파싱·수정 결과 재파싱·기존 브랜딩과 백엔드 식별자 보존을 확인했다. 추후 빠른 반환을 원본 검사 앞으로 옮기거나 재파싱을 무조건 제거하는 실수를 막기 위해 기존 테스트 파일에 작은 사례 1개를 유지한다.
- 후보 전체 suite 최초 시도는 3pass/1fail exit1: HEAD의 기존 getTransformRules가 현재 제거된 `computer-use-approvals.cjs`를 읽다가 ENOENT. 이를 이번 변경의 성공으로 기록하지 않으며 의존성을 복원하거나 관련 없는 변경을 커밋하지 않았다. 실제 작업본 전체 관련 suite는 통과했고 후보의 영향 범위 3개는 별도 통과했다.
- 새 구현만 측정: 실제 pinned runtime.worker 3개(각4MB대)의 transformAsset 직접 실행에서 출력 동일·각 파싱1회, 총5095.0034ms. 과거 K consumption 합계는 약5412.769ms이지만 I/O/캐시 범위·도구·환경이 달라 절감률이나 전체 빌드 절감 시간은 확정하지 않는다. 기존 구현은 다시 측정하지 않았다.
- 보관: 기존 사용자 지시에 따라 삭제 없이 `artifacts/archive/FT-02-namespace-noop/20261105-noop/`에 로그·표본 측정·baseline·분리 후보·commit 근거를 보관한다. 소유권 `run:FT-02-namespace-noop:20261105-noop`. 최초 등록의 kind work/run-root 불일치는 산출물 생성 전 거부되어 kind run으로 수정했다. 실제 실패와 성공 기록을 각각 보존한다. 정상 staged diff SHA256 `4d2b0a26d8cb397cce51c862d6925ca34a4e7ec7ea8ad72566d59df855465f82` 동일 확인. 다른 OS·전체 빌드·패키징·설치는 실행하지 않았다. 앞선 engine compatibility의 최종 정리 진단 문제와 원래 설치 목표는 별도 미완료 상태를 유지한다.

### 패키징 원본 비교의 제한 병렬 실행

상태: 승인 범위 구현·검증·분리 커밋 완료. 커밋 `975609b0abb70a197415dd22819849033be2a89d`. 공통 Node 코드이며 실제 검증은 Windows x64, Node26.7.0/VSCE3.9.2이다. 제품 동작·문서화된 계약은 그대로이므로 추가 아키텍처/기능 인벤토리 변경은 필요하지 않았다. 원래 전체 빌드·설치 목표와 앞선 compatibility의 별도 미완료 상태는 유지한다.

- `untrustedTextFiles`의 파일 간 직렬 처리를 최대4개 worker로 변경했다. 파일당 로컬/원본 SHA256 쌍을 계산하므로 최대8개 해시 스트림이다. 결과를 입력 인덱스별로 저장해 스캔 순서를 유지한다. 기존 상대경로·물리 루트 경계·환경 파일 무조건 스캔·원본 누락/읽기 불가 시 스캔 복귀·예상 밖 오류 전파를 보존한다. 각 경로/해시 쌍은 실패해도 모두 종료될 때까지 기다리고, worker 전체 종료 후 실패를 반환한다. 새 캐시나 의존성은 없다.
- 검증: 직접 영향 검사5/5 exit0,0.484초. 기존 package-local-host 전체18/18 exit0,11.544초. 실제 VSCE 작은 패키지의 내용/메타데이터 일치·STORE 유지·환경/메모리/디스크 비밀정보 차단·경로 이탈 및 링크 보호도 통과했다. 기존 테스트의 원본 패키지 실행은 내용 비교용이며 구형 성능을 재측정하지 않았다. 이번에는 파일2개가 처음부터 HEAD와 같았고 커밋 후보는 검증한 작업본과 LF 정규화 후 byte-identical이므로 후보 suite를 반복 실행하지 않았다.
- 테스트 유지: 후속 병렬화 편집에서 결과를 완료 순서로 push하거나, Promise.all의 조기 reject 때문에 읽기를 남기는 구체적 실수를 막기 위해 기존 파일에 성공/실패2개 사례를 추가했다. 실제 파일 읽기에 지연·EIO를 제어해 입력 순서·최대8개 읽기·반환/실패 시 진행 중 읽기0을 확인한다. 기존 보호 검사는 그대로 유지했다.
- 새 구현만 측정: 이전 K의 실제 준비 호스트와 원본, 같은 VSCE3.9.2를 읽기 전용으로 사용했다. 수집20665개/텍스트16064개/스캔537개로 과거 계수와 같으며, 새 comparison12144.269ms, collect7222.771ms였다. 원래 비교 함수 본문과 동일한 과거 기록20748.4746ms를 재활용했으며 구형 비교는 재실행하지 않았다. 관측 차이는8604.2056ms지만 저장장치 캐시/호스트 부하가 통제되지 않아 인과적 단축률이나 전체 빌드 절감 시간은 확정하지 않는다. 새 패키지 생성이나 전체 빌드·설치는 하지 않았다.
- 보관/정리: 사용자 승인대로 삭제 없이 `artifacts/archive/FT-02-package-comparison/20261105-parallel/`에 소유 run `run:FT-02-package-comparison:20261105-parallel`로 로그·원본 baseline·후보·새 측정·commit 근거를 보관한다. 테스트가 기존 절차로 정리한 transient fixture는 전용 temporary 부모가 비어 있음을 확인한다. 다른 staged 변경의 binary-diff SHA256 `4d2b0a26d8cb397cce51c862d6925ca34a4e7ec7ea8ad72566d59df855465f82`를 그대로 보존했다.

### VSIX 런타임 항목 검색의 단일 색인

상태: 승인 범위 구현·검증·분리 커밋 완료. 커밋 `f4ee7a302b8357514fa2e2b391871c2236613f04`. Windows PowerShell7 패키징 경로를 변경했고 실제 검증 환경은 Windows x64/PowerShell7.6.9/Node26.7.0이다. 기존 문서화된 검증 계약과 검사 소유자는 유지하므로 별도 아키텍처/기능 인벤토리 변경은 필요하지 않았다. 전체 빌드·설치 및 다른 환경의 acceptance는 실행하지 않았다.

- `Assert-IntegratedHostVsixContents`는 열린 ZIP 목록을1회 순회해 Dictionary 색인을 만든다. 기존 `-ceq`와 같은 InvariantCulture 대소문자 구분 비교를 사용한다. 현 플랫폼에서 대소문자 차이·soft hyphen·유니코드 조합 표현을 실제 PowerShell 비교와 대조했다. 동일한 이름의2번째 엔트리부터 null sentinel로 표시해 기존 두 런타임 조회의 누락/중복 거부를 유지한다. 기존 다른 GetEntry 대상의 중복 거부 범위는 확대하지 않았다. 런타임·호스트 모듈 SHA256과 아카이브 닫기는 그대로 유지한다.
- 검증: 기존 배포 테스트에 등록한 `Test-VsixEntryIndex` 실제 함수와 실제 준비 검사를 추출 실행해 정상/Computer Use 누락·중복·대소문자 변형·유니코드 동등 중복·내용변조/Window Control 누락·중복·내용변조9시나리오 모두 통과(exit0,1.659초). HEAD에 이번 변경만 적용한 독립 후보도9개 모두 통과(exit0,1.743초). 전체 PowerShell 파일의 구문 검사도 통과했다. 전체 배포 fixture suite를 통과했다고 주장하지 않는다. 유지 이유는 이후 GetEntry 단순화나 Ordinal 비교 교체로 중복/유니코드 거부를 빠뜨릴 구체적 편집 위험이며, 기존 테스트 entrypoint/ChangedOnly 선택에 같은 case를 연결했다.
- 실제 패키지 새 구현만 측정: 보존 K VSIX20665항목과 release를 읽기 전용으로 검증, 모든 실제 런타임/호스트 hash 통과(exit0). 새 검사2085.7513ms, 과거 K archive-contract11760.7023ms를 재사용했다. 전체11.76초에는 검색 외의 해시도 포함되어 있었다. 과거 구현 재실행은 없었다. 실행 부하·파일 캐시가 통제되지 않았고 새 측정의 앞선 실패 시도가 파일 캐시를 데웠을 수 있으므로 인과적 단축률/전체 빌드 절감 시간을 확정하지 않는다. 측정 후 제품 변경은 설명 주석1줄뿐이며 최종 후보9개를 별도 검증했다.
- 실제 실패 보존: 최초 테스트 fixture의 Stream.Write 단일 인자 호출은 PowerShell overload 바인딩에서 exit1이었다. byte[]/3인자 호출로 고친 후 새 경로에서9개 통과했다. 최초 실물 측정은 측정 도구에 추가한 StrictMode 때문에 이전 manifest에 없는 optional virtualInput 속성에서 exit1이었다. 원래 준비 스크립트와 같은 실행 모드로 맞춘 뒤 새 버전만 다시 측정했다. 초기 PowerShell 인라인 probe 인용 오류도 manifest에 보존했다. 실패를 통과로 수정하지 않았다.
- 보관/통합: `artifacts/archive/FT-02-vsix-index/20261105-index/`, 소유권 `run:FT-02-vsix-index:20261105-index`에 정상/실패 fixture·로그·원본·분리 후보·측정·commit 근거를 사용자 승인대로 삭제 없이 보관한다. 기존 staged39개 binary-diff SHA256 `4d2b0a26d8cb397cce51c862d6925ca34a4e7ec7ea8ad72566d59df855465f82`와 대상 파일의 다른 미완료 변경을 보존했다. 원래 전체 설치 목표 및 앞선 engine compatibility의 별도 미완료 상태는 유지한다.

### Windows UI 복사 세 지점의 제한 병렬 실행

상태: 승인 범위 구현·검증·분리 커밋 완료. 커밋 `f3c01b35ba99b57889000785e89ac692b1a32cf7`. 공식 UI 준비1곳과 실제 호스트 검증용 UI/오디오 복사2곳에 `/MT:8`만 추가했다. Windows 로컬 복사로 한정하며 /E·COPY:DAT·DCOPY:DAT·R:1·W:1·출력 옵션·UI Linux 제외 경로·0~7 정상/8이상 실패·기존 원본 보호/해시 검사는 유지했다. 제품/검증 계약은 그대로여서 추가 아키텍처 문서나 인벤토리 변경은 필요하지 않았다.

- Windows x64/PowerShell7.6.9의 실제 robocopy로3개 명령의 정상 복사와 각각의 없는 원본 오류, 총6개를 확인했다. 모든 정상은 native1→스크립트0 정상화, 오류는 native16→기존 메시지 throw였다. 유니코드 경로·내용·빈 디렉터리·파일 수정 시각·Linux 제외 유무가 유지됐다. 전체 실행 exit0,1.277초이며 소규모 동작 확인용 시간이다. 전체 UI를 복사하거나 전수 재해시하지 않았다.
- 작업본 및 HEAD에 이번3개 인자만 적용한 독립 후보의 PowerShell 전체 구문이 정상이고, 영향받는3개의 실제 native 명령/오류 처리 블록이 동일함을 확인했다. 이 동일 범위의 실제 실행 근거를 재사용해 후보 복사도 반복하지 않았다. 새로운 상시 테스트는 추가하지 않았다. 기존 플랫폼 기능의 옵션 추가이고 원본 구조적 검사/종료 처리가 유지되므로 작업별 native probe로 충분한 변경이다.
- 성능: 새로운 전체 단계 시간은 원래 다음 빌드/호스트 검증 때 기록한다. 과거 UI preparation staging71380.4137ms는 복사 외 runtime 검증·복사·패치를 포함하므로 복사 단독 시간이나 절감 시간으로 취급하지 않는다. 구형을 다시 측정하지 않았으며, 실물 빌드/호스트 실행 및 설치는 이번 단위에서 하지 않았다.
- 보관: 사용자 승인대로 `artifacts/archive/FT-02-ui-copy/20261106-mt8/`, 소유권 `run:FT-02-ui-copy:20261106-mt8`에 작은 fixture·probe·후보·로그·commit 근거를 삭제 없이 유지한다. 소유권 등록/기준 캡처 명령이 session으로 yield된 뒤 이번 인자가 먼저 적용되어 작업본 캡처는 변경 후였다. 실제 캡처 바이트는 그대로 두고 알려진3개 인자만 역변환한 before 재구성을 별도 파일에 기록했다. 이를 변경 전 직접 관찰로 주장하지 않는다. 기존 staged binary-diff SHA256 `4d2b0a26d8cb397cce51c862d6925ca34a4e7ec7ea8ad72566d59df855465f82`와 check-independent의 다른 미완료 변경을 보존했다. 원래 전체 빌드·설치 목표와 앞선 compatibility의 별도 미완료 상태는 유지한다.

다음 검토로 남긴 관찰: check-independent-vscode는 원본/오디오를 해시한 뒤 복사 직후 목적지를 다시 전수 해시한다. 원본 UI는 실제 호스트 실행 뒤에도 원본·fixture를 재검증하지만 오디오 copy baseline은 뒤에서 재사용되지 않는다. 복사 직후 전수 확인을 줄이는 경우에는 원본 보존의 마지막 검사와 보고서의 관찰/기대 baseline 의미를 함께 정리해야 하므로 이번 /MT 변경에 합치지 않았다.

### 호스트 검증의 복사 직후 전수 해시 축소

상태: 승인 범위 구현·검증·분리 커밋 완료. 커밋 `8dadcfddbc6ac6cc5006c7ce1cb4669767cd7f1c`. Windows 호스트 fixture 경로의 전체 디렉터리 해시를6→3회로 줄였다. 원래 전체 빌드·설치 및 앞선 compatibility의 별도 미완료 상태는 유지한다. 다른 플랫폼이나 실제 최종 호스트 acceptance는 이번 단위에서 실행하지 않았다.

- 원본 UI 실행 전/후 실제 측정2회와 fixture UI 실행 후 실제 측정1회는 유지한다. fixture의 최종 SHA256·파일 수·바이트 수를 실행 전 원본의 기대 기준과 비교한다. fixture UI 복사 직후의 전체 해시1회와 오디오 원본/복사본 해시2회를 제거했다. 오디오는 native 복사 성공, 초기/최종 버전 inventory와 선택된 실제 호스트 검사에 맡기는 승인된 검사 축소이며, 오디오 내용 해시나 소리 동작을 검증했다고 주장하지 않는다. native copy 오류는 즉시 실패, UI 내용 차이는 최종 보존 검사에서 실패한다. 기존 /MT:8·복사/패키지 신원/원본 보호 조건을 유지했다.
- 보고서 originalSource.before/after·unchanged는 실제 관찰로 유지했다. originalFixture는 expected·after·matchesSource로 변경해 기대 기준과 실제 최종 관찰을 구별하고, 측정하지 않은 before/unchanged를 보고하지 않는다. 원본 변경/fixture 불일치 오류도 실제로 입증한 범위의 메시지로 명확히 했다. owning ops의 Prepare, verify and install에 의미와 검사 축소를 반영했다. 제품 동작이 아닌 검증 절차/보고서 변경이며 기존 검사 소유자는 그대로여서 별도 기능 인벤토리 항목은 필요하지 않았다.
- 검증: Windows x64/PowerShell7.6.9/Node26.7.0. 실제 directory-state.ps1/Node SHA256 경로와 실제 초기 기준·최종 guard·보고서 표현을 사용했다. 정상, 원본 내용 변조, fixture 내용 변조(같은 크기), 파일 추가, 파일 삭제5시나리오 모두 exit0,2.413초. 각 경우 실제 해시 호출은 원본2+fixture1로3회였다. HEAD에 이번 단위만 적용한 독립 후보도5/5 exit0,2.240초이며 양쪽 전체 PowerShell 파일 구문이 통과했다. 전체 배포 suite나 VS Code 실제 호스트를 실행했다고 주장하지 않는다. 기존 테스트 entrypoint와 ChangedOnly에 같은 case를 연결했다.
- 유지 테스트 이유: 후속 스캔 축소 중 원본 실행 전 기준/최종 guard를 함께 제거하거나, 기대 기준을 측정한 before처럼 보고하는 구체적 반복 실수를 막는다. 기존 테스트 파일의 작은 단일 helper/case로 연결하고 새 검증 실행 경로나 영구 fixture를 만들지 않았다. 시간은 소규모 정확성 확인만의 값이며 성능 비교가 아니다. 전체 UI 복사/재해시는 하지 않았고, 과거 개별 해시 시간이 없으므로 절감 시간은 미확정이다. 실제 단계 시간/호스트 acceptance는 원래 다음 빌드 때 확인한다. 구형 성능은 재측정하지 않았다.
- 보관/통합: 사용자 승인에 따라 `artifacts/archive/FT-02-host-copy-baseline/20261106-baseline/`, 소유권 `run:FT-02-host-copy-baseline:20261106-baseline`에 작은 정상/변조 fixture·원본·독립 후보·로그·commit 근거를 삭제 없이 보관한다. 생성된 temporary hashing manifest는 기존 helper가 정상 정리했고 부모 비어 있음을 확인한다. 작업 전 baseline은 소유권/캡처 명령의 실제 종료 후 수정을 시작해 직접 보존했다. 기존 staged binary-diff SHA256 `4d2b0a26d8cb397cce51c862d6925ca34a4e7ec7ea8ad72566d59df855465f82` 및 다른 미완료 코드/문서 변경을 그대로 유지했다.

### 승인된 두 개선: 엔진 관찰 기록의 후속 단계 전달과 ZIP 속도 우선 압축

상태: 사용자 승인 범위의 두 안을 구현·검증하고 별도 커밋을 완료했다. 엔진 handoff는 d099c759ecdf2254d957c18ebe706d48c791bff7, ZIP 속도 우선 압축은 8e86c2f58af30a82f4d5987d99145f12cffffcd1이다. Root는 엔진 handoff/통합/문서/커밋을, 독립 작업자 zip_fast_compression은 ZIP writer/lock/preparation tool identity를 담당했다. 서로의 실행 입력을 수정하지 않았다. 새 구현만 시간을 측정했으며 구형 구현은 재실행하지 않았다.

1. 엔진 provenance 검사 관찰 기록을 같은 deployment attempt의 준비/후속 엔진 검사에 전달한다. `build-azrael.ps1:124`는 현재 자체 sourceStatePath와 sourceGeneration을 만들고 package-azrael까지 전달하지만, `prepare-independent-vscode.ps1`의 첫 engine-provenance verify와 `feature-preservation.cjs` identity의 native engine verify에는 해당 옵션이 없다. deploy는 build 종료를 기다린 뒤 engine-preservation과 prepare를 시작하므로 완료된 관찰을 넘길 수 있는 경계가 있다. 기존 Windows 로컬 NTFS metadata detector/guard/완전 검증 fallback을 재사용하며, Git 소스·지원되지 않는 FS/환경·도구/대상/소스 변경·상태 오류·세대 불일치는 기존 전체 검사로 돌아간다. 바이너리3종·receipt/profile/host 검증과 whole-project/source snapshot·최종 패키지/설치 검사는 유지한다.
   - 구현 권고: 새 attempt마다 유일한 실행 context를 사용하고 완료된 build의 명시적 관찰 handoff만 소비한다. build 소유권이 종료된 파일에 후속 consumer가 쓰거나 병렬 consumer끼리 같은 상태 파일을 쓰지 않도록, 각 consumer의 소유 출력에 관찰 seed를 복사한다. 보존된 실제 예시 state파일은1687/3380bytes여서 Cargo/cache payload 전체 복사와 다르다. 각 consumer가 자기 파일에서 현재 metadata를 다시 관찰하고 원래 guard에 따라 재사용/전체 재검사를 선택한다. 단독 준비·context 부재·다른 attempt는 기본 전체 검사다. 오래된 build-info만으로 매번 같은 세대를 재활용하지 않는다.
   - 효과 근거: 앞선 source-state 실제 동일 실행 측정에서 최초 루트 검사는15.451/35.565초, 후속6회는각1.505~1.913초였다. 이는 기능의 기존 실측이며 새 후속 단계 handoff 효과로 환산하지 않는다. K input-verification28.986초는 engine/runtime/checkpoint 입력 검사를 합친 구간이라 전체를 절감 가능 시간으로 간주하지 않는다. 새 handoff의 실제 적중/미적중 및 중단·재개/단독 실행을 검증하고 새 버전만 측정한다. Windows scoped 최적화이며 다른 OS의 전체 검사 fallback을 유지한다.

2. 남은 DEFLATE 압축을 속도 우선(level1 권고)으로 바꾼다. package-local-host의 PNG/JPEG/WebP/AVIF/GIF/WOFF/WOFF2 STORE 정책은 이미 구현되어 그대로 둔다. JS·텍스트·실행파일 등 남은 DEFLATE는 현재 yazl2.5.1 기본값으로 처리되며 설치된 다른 ZIP writer 후보(fflate/archiver)는 발견하지 못했다. 현재 yazl2.5.1은 compressionLevel 옵션을 구현하지 않아 플래그만 추가하면 효과가 없다. 공식 yazl README/현행 package.json(3.3.1)을 확인했고 지원 버전은 compressionLevel을 zlib에 전달한다. 공식 근거: https://github.com/thejoshwolfe/yazl 및 https://raw.githubusercontent.com/thejoshwolfe/yazl/master/package.json .
   - 구현 권고: 필요한 ZIP 도구를 지원하는 고정 버전으로 별도 선택하고 VSCE 내부 의존성을 무작정 교체하지 않는다. 설치 recipe/lock/도구 해시/라이선스/캐시 input에 해당 writer를 바인딩한다. DEFLATE에만level1을 지정하고 STORE에는 충돌 옵션을 주지 않는다. 3.3.0 이후 UT timestamp 확장 기본값이 바뀌므로 forceDosTimestamp 등으로 기존 모드/순서/mtime 계약을 유지하고 실제 패키지 메타데이터로 검증한다. 파일 내용·비밀정보 검사·최종 SHA/VSIX acceptance는 유지한다. 적용은 공통 Node 패키징 경로이며 실제 실행은 Windows부터 확인하고 다른 플랫폼의 미검증을 구분한다.
   - 절충: 압축 파일 크기가 커질 수 있고 최초1회 도구 의존성 갱신이 필요하다. 설치 후 파일 내용/압축 해제 크기는 동일하게 유지한다. 과거 K archive414.020초는 이미지 축소/STORE 이전 값이어서 현재 남은 압축 비용이나 예상 절감량으로 사용하지 않는다. 보존 K 패키지의 압축 크기/기존 기록은 재사용하고 새 구현의 압축 시간·출력 크기만 측정한다. 실제 절감률·크기 증가량은 아직 미확정이다.

엔진 구현/검증: 빌드 성공 종료 후 fresh token/release/state SHA256에 결합한 handoff를 소비한다. 준비·engine preservation은 부모 로그 소유권 아래 독립 writable seed를 받으며 불일치/오류는 full 경로로 돌아간다. generation은 매 build attempt 새로 만들고 Resume도 새 token을 사용한다. 바이너리3종·receipt/profile/host 및 project/source snapshot 검사는 유지한다. 작은 handoff source test5개, 기존 real Git/identity 통합 사례1개와 HEAD+이번 변경만의 후보에서도 각각 exit0였다. Windows Python source-state suite는10개 중9pass/1기존 platform skip, exit0였으며 실제 importer/receipt/binary validator로 clone의 재사용·소스 변경 거부를 검증했다. 새 상시 검사는 향후 호출부를 추가하며 옵션 전달/개별 상태 소유권/세대 무효화를 빠뜨리는 구체적 재발을 막는 범위다. PowerShell 작업본/후보 구문과 실제 준비 context의 Unicode 전달도 exit0였다.

배포 fixture: 실제 deploy→실제 handoff helper→준비/engine stub 연결에서 재사용 성공은 d2의 full install case(exit0), handoff 부재의 full 경로는 d4의 source handoff unavailable case(exit0)로 확인했다. d1은 native stdout 한글 경로 decode 오류로 실패해 ASCII JSON escape로 고쳤다. d2 전체 batch exit1은 새 fallback mode를 기존 성공 후 fixture 정리 assertion이 실패로 잘못 분류한 테스트 보조 코드 오류였고 성공 scenario flag로 수정했다. d3 재실행 exit1은 기존 pipeline-state.json rename EPERM 및 engine-ready checkpoint 미완료에서 발생했으며 handoff 소비 전이었다. 제품 범위를 넓혀 이 별도 소유권/파일 경합 코드를 수정하지 않았고, 독립 fallback은 d4에서 통과했다. 초기 실패/수정/통과 로그는 보존하며 batch 실패를 통과로 덮어쓰지 않는다.

엔진 새 측정: K 소스에 새 구현의 source-only handoff 소비2회는 prepare788.129ms/engine745.101ms, seed 복사3.937/3.359ms, 모두 source-state reused/exit0였다. 전체 빌드/바이너리 검증 시간이나 과거 시간 대비 인과적 단축률로 주장하지 않는다. 선행 paired probe는100403.314ms/exit1: 현재 환경의 RUSTY_V8_ARCHIVE·RUSTY_V8_SRC_BINDING_PATH가 빈 값이고 K receipt에는 pinned 경로가 있어 buildEnvironment만 달랐다. 작은 JSON snapshot 비교에서 다른 소스 필드는 동일했다. 실제 source 변화나 성공한 제품 검증으로 해석하지 않는다. 이 실패에서 제품 handoff를 발행하지 않았으며 별도 source-only 측정은 snapshot 의미로만 기록했다. 후보 준비 중 bare python 명령이 PATH에 없어 실행되지 않은 시도와 context snippet의 PSScriptRoot 바인딩 오류도 각각 명시 경로/독립 변수로 수정했다.

ZIP 구현/검증: dev-only alias azrael-yazl@npm:yazl@3.3.1 및 nested buffer-crc32@1.0.0만 lock에 추가했다. 기존 VSCE yazl2.5.1은 유지하고 STORE0/DEFLATE1, forceDosTimestamp:true를 적용했다. companion package/lock은 기존 module recipe가 fingerprint하며 preparation receipt에는 lock+writer2개+CRC2개 정확한5개 파일을 추가했다. package tests19/19 exit0(12.083초), preparation tests13/13 exit0(8.766초). 최초 assertion에서 initial.tools로 잘못 접근한 test-only 오류는 initial.inputs.tools로 고친 뒤 통과했고 실패 로그도 유지했다. 실제 pinned TypeScript.js 한 파일 NEW writer 측정은9,112,572B→2,092,188B,64.916ms; SHA roundtrip, mode33188, DOS timestamp, DEFLATE 확인 exit0. 전체 VSIX 속도/크기 변화는 미측정이다. 초기 lifecycle 등록의 kind/cwd 오류 뒤 npm 출력이 등록 전에 생긴 절차 오류를 기록하고 실제 경계에 등록했다.

ZIP 분리 후보도 HEAD+이번 narrow patch만으로 preparation7개 exit0(2.670초)였다. 다른 미완료 변경으로 추가된6개는 이 커밋에 포함하지 않고 작업본13개 통과 근거와 구분했다. 후보 준비에서 source 문자열을 dependency로 오인한 초기 시도, 동적 font/script 입력 누락 때문에 입력 수집 중 실패한7개씩의 로그, git show 기본 버퍼 초과를 그대로 기록했다. 명시된 실제 작은 입력 closure와 파일 stdout으로 해결한 뒤 동일 assertions가 통과했다. ZIP 통합 보관 묶음의 최종 관찰은177files/10,852,516B다.


보관/통합: 사용자 승인 archive 정책에 따라 엔진 evidence는 artifacts/archive/FT-02-engine-handoff/20261106-handoff(225files/7,505,089B) 및 별도 deploy owner d1(162files/3,818,238B), d2(369files/7,727,428B), d3(139files/3,785,915B), d4(182files/3,862,657B)에 보관한다. 각 deploy group에는 연결된 빈 scratch root artifacts/dt/6731,2998,8bd9,97ec(각0B)도 포함되며 현재 소유권 묶음과 함께 남아 있다. ZIP worker archive는 artifacts/archive/FT-02-fast-zip/zip-level1-20261106-01(29files/11,674,286B), 통합 후보/commit 기록은 artifacts/archive/FT-02-fast-zip/zip-integration-20261106이다. 모두 실제 종료 후 stopped/완전 membership으로 닫고 user archive retention reference를 유지했다. d1/d2/d3의 failed 결과는 그대로 유지한다. 향후 사용자 지시로 보관을 해제할 때 같은 그룹과 연결 scratch root를 함께 검토한다. 삭제나 공간 회수로 계산하지 않는다. 기존 staged39 SHA256 4d2b0a26d8cb397cce51c862d6925ca34a4e7ec7ea8ad72566d59df855465f82와 다른 미완료 변경을 보존했으며 push는 하지 않았다. 검증은 Windows x64/Node26.7/Python3.12/PowerShell7.6.9 한정이며 Linux/macOS 및 전체 제품 빌드·사용자 프로필 설치·앞선 compatibility 미완료 상태는 별도다.

### 다음 개선 후보 두 가지: UI 원본 관찰 재사용과 pipeline 상태 파일 경합 완화

상태: 첫 안만 구현 승인받았고, 실원본의 하드링크 5개는 매번 내용 해시를 유지하는 보완도 별도 승인받았다. 아래 초기 조사와 구분하여 실행 결과를 기록한다. 두 번째 pipeline 경합 안은 승인 범위 밖으로 남긴다. 새 속도만 측정하고 기존 시간은 보관 기록을 재사용한다는 결정과, 멈춤/병렬도1 제약을 고려하지 않는 결정은 유지한다.

1. **UI 원본 전체 해시도 같은 준비 attempt에서 재사용한다.** 준비의 checkpoint init은 preparation-state.cjs inputs()에서 config.source 전체를 getDirectoryState로 읽는다. feature-preservation identity()의 UI 분기는 같은 uiRoot를 전체 해시하며 runPreservation의 시작/종료에 각각 호출된다. 이후 bindPackage→packageState→verifyReceipt→identity에서도 같은 원본을 다시 읽는다. 정상적인 새 준비 경로에 최소4회의 원본 내용 전체 해시가 있으며, ChangedOnlyTests로 featureIds가 비어 있어도 이 identity 검사는 남는다. 앞서 구현한 엔진 source-state와 handoff는 Python engine provenance 경로에만 적용되어 이 UI 원본 중복은 아직 남아 있다.
   - 근거: 보관된 K preparation-state.json의 원본은19,632files/1,452,149,037B다. 같은 내용4회면 약5.81GB를 읽고, 첫 전체 검사 뒤3회를 재사용할 수 있는 조건에서는 원본 내용 재읽기 약4.36GB를 줄일 여지가 있다. 이는 코드 경로와 과거 입력 크기에 따른 계산이며 새 시간/절감률 실측이 아니다. K input-verification28.986초·feature-preservation36.909초·binding73.078초는 다른 검사와 project snapshot도 포함하므로 합계나 전부를 절감 시간으로 주장하지 않는다.
   - 권고: getDirectoryState의 기본 전체 해시 동작은 유지하고, 명시적으로 선택한 원본 UI에만 같은 attempt의 관찰 재사용을 적용한다. 최초 성공한 전체 해시 결과를 보관하고 후속 단계는 이름·물리 신원·크기·mtime·Windows ChangeTime의 현재 관찰이 같을 때만 해당 결과를 재사용한다. engine-source-metadata.cjs의 기존 observer를 재사용/공통화하되 UI에 엔진 SOURCE.json/import 조건을 억지로 적용하지 않는다. Windows 로컬 NTFS에서만 활성화하고 링크/공유 파일·지원되지 않는 환경·불확실성·상태/도구/세대 변경은 원래 전체 경로로 돌아간다. 캐시 파일/세대 같은 임시 context를 checkpoint의 의미적 입력에 섞어 정상 Resume을 항상 무효화하지 않도록 분리하며, 새 attempt/Resume의 첫 전체 관찰을 생략하지 않는다. 병렬 consumer는 각각 자기 상태 파일을 쓴다.
   - 보존/검증: UI 원본 content SHA/count/bytes의 의미, 기존 sourceUi identity와 transform/report/feature checks, whole-project/manifest guard, 변환 결과·최종 VSIX/실제 호스트 acceptance는 유지한다. 기존의 일반 변경 감지 모델을 UI에도 확장하는 절충이며 공격적인 metadata 조작이나 동시 수정의 전역 atomic snapshot을 보장하지 않는다. 승인 후 실제 getDirectoryState 결과와 캐시 반환값의 동일성, 내용·이름·파일 수·원본 교체·복원 mtime 변경의 무효화, 손상/다른 세대/단독 실행/지원 외 플랫폼 fallback 및 후속 호출 전달을 작은 사례로 확인한다. 새 구현만 실제 고정 UI 입력에서 측정하며 원래 전체 호스트 검증은 별도다.

2. **체크포인트 파일의 일시적 경합 때문에 성공한 작업까지 중단·복구하지 않게 한다.** deploy Wait-BuildEngineReady는100ms 간격으로 pipeline-state.json을 Get-Content -Raw로 읽고, pipeline-state save()는 자기 임시 파일을 같은 JSON 경로로 renameSync한다. 기존 update-lock은 writer끼리의 짧은 read/modify/write를 직렬화하지만 이 PowerShell reader는 그 경로 밖이다. save()에는 교체 실패의 제한된 재시도가 없다. 이전 d3 build.stderr.log에는 실제 EPERM rename과 이어진 No running pipeline stage: build.engine-ready가 남았으며 외부 batch는32.303초/exit1이었다. 어떤 핸들/다른 프로세스가 실제 rename을 막았는지는 이 증거만으로 확정하지 않는다.
   - 권고: Windows 상태 읽기에서 파일 교체를 허용하는 명시적인 공유 모드로 짧게 읽고 닫으며, writer는 자기 owner/update-lock 및 임시 파일 신원을 유지한 채 일시적인 교체 오류만 짧은 기한 안에서 재시도한다. 기존 상태 전이, engine-ready의 provenance/IPC 선행 조건 및 실제 build 프로세스 신원 확인, 부모/자식 stage 갱신 직렬화는 유지한다. 대체안인 별도 readiness 파일/이벤트 프로토콜은 새 수명·재개 계약을 늘리므로 우선 도입하지 않는다. 영구 권한 오류/기한 초과는 실패를 유지하고 다른 lock이나 stale temp를 지우거나 탈취하지 않는다. ACL/소유권 변경이나 강제 삭제로 해결하지 않는다.
   - 기대 효과/검증: 평상시 컴파일 자체를 줄이는 안이 아니라 경합으로 인한 중단·재시도·복구 비용을 줄이는 안이다.32.303초는 실패한 작은 fixture 전체 시간으로 예상 절감량이 아니며 발생 빈도도 아직 측정하지 않았다. 승인 후 작은 실제 Windows reader/writer fixture에서 일시적 점유 해제 후 성공과 원래 SHA/최종 stage 보존을 확인하고, 계속 점유/진짜 실패는 기한 내 실패로 남는지 확인한다. 기존 stale temp/unknown-running/lease/부모·자식 독립 stage 보존 검사를 재사용하며 실제 동시 접근의 공백만 보완한다. Windows 공유 모드 대응으로 범위를 한정하고 다른 플랫폼의 상태 의미는 바꾸지 않는다.

범위: 첫 안과 승인된 하드링크 보완만 반영했다. 두 번째 안은 변경하지 않았다. 원래 전체 빌드·설치 및 앞선 compatibility 미완료 상태는 계속 별도다.

### UI 원본 관찰 재사용 실행 결과

- 승인: 첫 안만 적용. 실제 원본의 하드링크 5개/8,926,840B는 매번 내용 검사하고 나머지만 재사용하는 보완을 사용자에게 제안해 승인받았다.
- 구현: 기존 directory-state의 전체/부분 manifest validator를 그대로 재사용한다. 최초 전체 결과와 공유 파일 부분 해시를 저장하고, 후속 이름·물리 신원·size·mtime·ChangeTime·link count 관찰 및 공유 파일의 새 내용 해시가 맞을 때만 원본 전체 identity를 재사용한다. 변경·손상·다른 세대/도구·지원 외/불확실한 환경·심볼릭 링크는 전체 경로다. 엔진 observer의 기본 공유 파일 거부는 유지했다. 준비→보존 시작/종료→binding context를 연결하고 Resume마다 새 세대 및 최초 전체 검사를 유지한다.
- 검증: working 17pass; narrow candidate 11pass; 실제 Git identity/receipt/package binding 및 변조 package 거부 1pass; engine source-state 9pass/1skip. 각 명령 actual exit0. 실제 PowerShell 호출·공백/한글 경로·새 Resume 의미적 identity·보존 전달, Windows junction/shared-state/probe 실패 fallback 및 등록도 exit0. 작은 synthetic package 바인딩 검증이며 실제 최종 VSIX/호스트 수용은 아니다.
- 새 구현만 측정: 최초 9.895초, 후속 1.553/1.477/1.411초. 최초 파일내용 읽기 19,637회(전체 19,632+공유 5), 후속 각 5회/8,926,840B. 네 경로의 내용 읽기 합계를 계산하면 전체 4회 대비 4,320,739,751B 감소. 네 결과 SHA/count/bytes는 과거 K identity와 일치했다. 과거 버전 재측정 및 전체 빌드 절감률 주장은 없다. 초기 하드링크 fallback 측정과 counter 오류 측정은 실패/한계를 그대로 기록하고 corrected r3를 사용했다.
- 커밋: c3d2c02e8fec6b60951e25bd9b408b9351f93a8a. 별도 index로 이 단위 11개 파일만 커밋했고 기존 staged 39개 diff SHA256 `4d2b0a26d8cb397cce51c862d6925ca34a4e7ec7ea8ad72566d59df855465f82`는 불변이다.
- 보관: 사용자 archive 지시를 재사용해 `artifacts/archive/FT-02-ui-source-state/20261106-ui-observation`에 약 12.99MB/265파일(마지막 보고서 제외)과 자기 root 안을 가리키는 junction 1개를 보관한다. lifecycle `run:FT-02-ui-source-state:20261106-ui-observation`; 로그·baseline·작은 fixture·candidate를 함께 보관하며 사용자 보관 해제 지시에 기존 owner로 다시 검토한다. 이동으로 공간이 회수됐다고 보지 않는다. 상세 exit·재시도·범위는 execution-report.json.
- 원래 전체 제품 빌드·설치/실제 호스트·타 플랫폼 수용 및 앞선 compatibility 미완료는 별도다.
