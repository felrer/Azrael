상태: 완료. 승인된 1번 개선의 구현·Windows 검증·분리 커밋·임시 자료 정리를 마쳤다. 추가 사용자 확인은 필요하지 않다.

# 프로젝트 전체 해시의 실행 내 재사용

## 목표와 권한

연결 세션의 [전체 빌드 비용 감사](02-plan.md)를 잇는 별도 개선 단위다. 사용자는 프로젝트 전체 해시 재사용만 승인했다. 체크포인트 경합 변경, 제품 빌드·설치·push는 제외하며 기존 동시 변경과 index를 보존한다.

## 범위와 설계

준비 실행의 보존 검사 시작/종료 및 패키지 연결에 명시적 실행별 관찰 context를 전달한다. Resume에도 새 세대와 최초 전체 내용 검사를 유지한다. context는 의미적 입력 identity에 넣지 않는다.

기존 snapshotProject의 Git 선택·재귀 gitlink·추적/미추적/삭제·무시 규칙 및 SHA/count/bytes/inventory 계약을 재사용한다. 매 관찰에서 실제 Git 목록을 다시 확인한다. UI 관찰의 로컬 NTFS 검증·경로 보호·실행/도구 binding·원자 게시를 공통 helper로 추출하고 엔진 metadata observer에 선택 경로 관찰만 추가한다. 링크·공유 파일·지원 외 환경·변경·손상·다른 세대·불확실성은 기존 전체 해시로 돌아간다.

설치 전 deploy Assert-ProjectSnapshot 및 context 없는 호출의 전체 해시를 유지한다. metadata 조작에 대한 적대적 무결성이나 전역 atomic snapshot을 보장하지 않는다. 빠른 경로는 Windows x64/로컬 NTFS이며 공통 JS의 Linux x64/macOS ARM64 경로는 기본 전체 검사다. 실제 검증은 Windows로 한정한다.

## 실행과 검증

Root가 구현·통합·커밋을 소유한다. 기존 Git snapshot 검사를 확장해 내용/이름/선택 목록/복원 mtime/중첩 gitlink 변화, 세대·손상·독립 프로세스·기본 전체 경로를 확인한다. 기존 실제 Git 보존/receipt/package binding 사례로 consumer 전달과 변조 거부를 확인하고 UI observer·준비 checkpoint 회귀를 실행한다. 이후 새 버전만 실제 고정 입력에서 측정하며 구형 버전 재측정이나 전체 빌드 절감률 주장은 하지 않는다.

산출물은 artifacts/tasks/FT-02-project-source-state/runs/20261106-project-observation-4a8798b6 단일 run-root 소유권으로 생성 전에 등록했다. fixture·baseline·원시 로그·별도 index는 사용 종료 후 기존 native owner로 삭제하고 실제 부재를 확인한다. 최소 검증 결과는 이 기록에 보존한다.

유지 검사는 후속 호출을 추가하며 context 전달·세대 갱신·Git 선택 변경·기본 전체 검사와 최종 guard를 빠뜨리는 반복 실수를 막는 작은 기존 사례 확장으로 제한한다.

## 실행 결과

- 구현은 UI 원본 관찰의 경로/로컬 NTFS/도구 binding/게시를 공통 helper로 추출하고, 기존 엔진 metadata observer의 선택 경로 관찰을 재사용한다. 프로젝트의 실제 Git 선택은 매번 갱신하며 최초 전체 스냅샷과 동일한 SHA/count/bytes/재귀 inventory를 반환한다. 준비 실행에서만 명시적 context를 보존/패키지 연결에 전달하며 새 실행/Resume는 새 세대다. context 없는 최초/설치 전 deploy 스냅샷 및 최종 패키지/호스트 검증은 그대로다. 체크포인트 경합 코드는 변경하지 않았다.
- 작업본: Git snapshot 11개(actual exit0, 최종 22.357초), UI 원본/준비 checkpoint 17개(exit0, 10.371초), 보존/결과 캐시 50개(exit0, 218.854초), Python engine source-state 10개(exit0, 26.524초). PowerShell 7.6.9 실제 AST의 관찰/보존 설정/패키지 연결 복사 블록을 실행해 새 generation·출력 소유 경로·전달과 전체 구문을 확인했다(exit0). 실제 Git 보존/receipt/package 연결 사례는 합성 provenance/binary/package를 사용하는 경계 검증이며 실제 제품/호스트 수용을 뜻하지 않는다.
- 새 구현 실측: 고정 K 프로젝트 26,907파일/602,724,755B, SHA256 `5672ae1ba11695b38c225f7f1ca0cda2f9bed1c3391a7ba6fee3d346a7720518`. 최초 전체 내용 읽기 18,855.375ms/26,907회, 후속 8,918.315/9,062.273/8,913.981ms/각0회, 네 결과 SHA/count/bytes/inventory 동일, 명령 exit0. 이는 새 경로의 최초 검사와 재사용 비용이며 구형 재실행이나 전체 빌드 절감률/설치 검증은 아니다. 실제 검증 환경은 Windows x64/NTFS, Node26.7, Python3.12, PowerShell7.6.9다. 타 플랫폼은 전체 검사 fallback 설계를 유지하며 native 수용은 이번 범위 밖이다.
- 진단과 수정: 긴 최초 fixture의 재귀 Git clone은 `$GIT_DIR too big`으로 실패해 같은 소유권에 짧은 fixture root를 추가했다. 실제 K의 미추적 내장 저장소는 Git이 `경로/`로 반환하여 기존 비교기가 자기 스냅샷의 하위 digest를 거부했다. 비교 키의 끝 구분자만 정규화하고 기존 재귀 사례에 내장 저장소를 포함해 수정했다. 이후 한 측정에서도 예상과 다른 full fallback이 나타났으며 해당 실행의 원인을 확정하지 않았다. 동일 코드의 진단 실행에서 binding/관찰/내용 신원이 일치하고 실제 reused를 확인했으며 최종 4회 측정은 정상 통과했다. 미확실/변경 상태에서 전체 검사하는 정책은 유지한다. 진단 stdout/stderr를 PowerShell로 직접 전달한 시도는 native stderr 처리로 outer exit1이었고 이를 성공 명령으로 세지 않았다.
- 통합 준비: HEAD와 이번 변경만의 별도 index를 만들었다. 기존 dirty 코드/문서와 3-way 충돌한 지점은 HEAD에 이번 정확한 변경만 적용해 해결했다. 후보 의존 파일 수집의 초기 누락·Git 출력 버퍼 초과도 수정했으며 Git 객체의 입력을 사용한다. 기존 작업본에서 삭제/수정된 타 작업 파일을 후보의 기준으로 삼지 않는다. 기존 작업 기록의 staged39개 hash는 현재 상태와 다르므로 보존 증거로 재사용하지 않는다. 커밋 직전 확인한 타 작업 staged33개는 별도 diff identity로 보호한다.
- 분리 후보: 기존 HEAD+이번 변경만으로 Git snapshot 12개(exit0, 21.126초), UI/준비 11개(exit0, 27.056초)를 확인했다. 마지막 UI helper의 쓰이지 않는 import를 제거하면서 진행 중이던 후보 통합 검사의 입력도 바뀌어 그 결과는 최종 근거로 재사용하지 않았다. 고정한 최종 후보로 UI 3개(exit0, 5.165초)와 실제 Git 보존/receipt/package 연결 1개(exit0, 17.391초)를 다시 실행해 통과했다. 기존 작업본의 추가 6개 준비 사례와 별도 후보의 원래 deterministic snapshot 사례 1개를 구분한다.
- 커밋: 구현·검사·문서는 `2eea61ab46a4e041b09ea35f33b77ef004987580`에 이번 변경만 분리했다. 다른 작업의 staged33개 diff SHA256 `b05879d2c4093f50b4d14d984ca1d4d5a259a793fd5f529b06a61ef6be50b848`를 보존했다. 이후의 다른 작업 커밋을 유지하고 정리 완료 기록은 별도 문서 커밋으로 남긴다. push는 하지 않았다.
- 정리 완료: `run:FT-02-project-source-state:20261106-project-observation-4a8798b6`의 두 구성원 `artifacts/tasks/FT-02-project-source-state/runs/20261106-project-observation-4a8798b6`(32,958,307B)과 `artifacts/v/p4a8798b6`(4,677,567B)을 검증된 standalone native 소유자로 삭제했다. 최초 검토는 짧은 fixture가 관리 허용 경로 밖이어서 차단됐고, 사용자 승인 후 `artifacts/v`만 일시적으로 허용했다. 새 registered 검토에서 두 항목 모두 보호/참조/불확실성 없음, producer stopped를 확인한 뒤 fresh token으로 모두 delete했다. apply actual exit0, aborted/cancelled=false, group deleted 및 두 경로의 실제 부재를 확인했다. readonly/hidden 생성물의 속성 처리는 기존 native 소유자에 맡겼으며 강제 삭제나 shell 우회는 하지 않았다. logical bytes 합계 37,635,874B이며 실제 디스크 회수량은 측정하지 않았다. lifecycle finalize도 exit0, remaining/references/blockers 모두 빈 목록이다.
- 설정/범위 보존: 임시 관리 경로를 제거한 `project-maintenance.json`의 SHA256은 변경 직전과 같은 `60dec4fdeb9c6e7583ae079ee9bc41d25253ed07a37e0ff9bf0bce2de1f7c7a4`다. 다른 작업의 기존 미커밋 설정은 그대로 보존한다. 일회용 fixture·baseline·원시 로그·후보·별도 index는 남기지 않았으며 최소 수용 근거는 이 기록에 남겼다. 전체 제품 빌드·설치·실제 호스트/타 플랫폼 수용 및 이전 개선 단위의 미완료 사항은 별도 범위다.
