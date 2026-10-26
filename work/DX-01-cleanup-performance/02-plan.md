상태: catalog 및 Windows worker 최적화·2회 전후 비교·132개 회귀 검증 완료. 생성물 정리와 실제 부재 확인 완료. 설치 앱은 변경하지 않음.

# Catalog와 Windows 삭제 프로세스 비용 개선

- 권한: 사용자가 기존 최적화 후 제안한 1(catalog 반복 검사), 2(Windows 프로세스 실행) 추가 개선을 승인했다. 집중 native 컴파일/테스트와 자체 fixture 측정·삭제를 수행하며 제품 전체 빌드/설치/배포는 포함하지 않는다.
- 범위: catalog 의미는 Windows/Linux/macOS 공통, Windows 프로세스 재사용은 Windows x64 구현에 한정한다. Windows x64 실제 회귀/각각 2회 전후 비교를 수행하며 Linux/macOS는 검증 범위를 별도 표시한다. Unix 삭제 의미는 변경하지 않는다.
- 보존: 모든 fresh 파일 읽기/전체 목록 확인/경로·권한 callback/신규 consumer·불량 기록·잠금/guard 경계, durable intent/result 및 부분·불명 실패 의미를 유지한다. TTL·mtime만 신뢰하는 cache·삭제 병렬화·force/ACL/System 변경은 금지한다.
- 접근: byte equality로 확인한 JSON 파싱 및 정적 계약만 요청 수명에 memoize하고 매번 동적 경로/권한을 재검증한다. Windows는 동일 PowerShell 검사와 일반 Remove-Item을 재사용하며 요청 내 여러 항목에 대한 프로세스 초기화 비용을 줄인다. 상세 구현은 조사 결과에 따라 본 문서에 확정한다.
- 기준 재사용: 이전 보관본의 project-maintenance, utils/process, Cargo.toml/lock/rust-toolchain 29개 파일이 현재 소스와 byte-equal임을 확인했다. 기존 after-dispatch.exe SHA-256 72e02facf40ab657b2427fd63e00d89a42de3afddfdaa08a288888e693fb9ce3을 baseline으로 재사용한다. archive 원본은 읽기 전용으로 보존한다.
- 의존/소유: root는 계약·catalog 설계·benchmark·입력 동결·통합 및 정리를 소유한다. 독립 read-only agent는 Windows 삭제 구현과 회귀 근거를 조사한다. 기준 실행기를 먼저 측정하며 준비된 독립 구현은 병행한다.
- 검증: 실제 native register/review/apply fixture에서 catalog 비용과 다수 항목 삭제를 각각 식별한다. 같은 seed/profile/OS에 전후 2회만 측정하고 준비/컴파일과 실행 시간을 분리한다. 기존 전체 crate 회귀 및 신규 mutation/프로세스 재사용·실패 회귀를 수행한다.
- 정리: 이전 archive 예외는 완료된 01 작업에 한정한다. 이번 고유 lifecycle의 source/target/fixture/controller/log/report를 생성 전에 등록하고 종료 후 기본 native 정리로 삭제 및 부재 확인한다. 필요한 요약만 이 문서에 남긴다. 잔여 보관이 필요하면 정확한 범위로 사용자 승인을 받는다.
- 임시 제어 파일 .git/dx02-plan-body.md는 계획 할당 직후 일반 삭제 및 부재 확인한다. 이번 변경만 task commit하며 무관한 staged/working 변경을 보존한다.

- 소유 run `run:DX-02:cleanup-20261026075412069`, 경계 `artifacts/tasks/y075412d7bb`: 생성 전 lifecycle pending/incomplete 등록. inputs/after, native 실행기, target/pending/OS temp, fixtures/controller/log/report를 포함하며 archive 기준 원본은 변경하지 않는다.

## 구현 및 비교 확정

- catalog owner는 `src/registry.rs`, 요청 Context 통합은 `src/lib.rs`이다. (선택 root, 절대 기록 경로)별 Rc proof는 fresh bytes가 같은 경우 파싱/정적 shape·경로 계산만 재사용하고 member 동적 검사는 같은 순서로 replay한다. 두 catalog pass, 전후 읽기, fresh listing/lock/relevant 비교를 유지한다.
- Windows worker owner는 `src/windows_delete.rs`, 기존 `paths.rs` 진입점을 통해 요청 Context에 lazy 생성한다. C# Add-Type/bootstrap만 재사용하고 항목별 locals·전체 안전 검사·Remove-Item·결과를 유지한다. sequence 검증, stderr drain, 응답 유실 시 미확인·재시도 금지, EOF 회수, 완전 응답 직후 종료 시 실제 결과 보존을 검증한다.
- 기준 fixture: catalog 64 records/512 members 및 선택 파일 8개; Windows 단독은 16개. 새 fixture마다 actual register/review/apply를 실행하고 모든 결과 및 실제 부재를 확인한다. 초기 실행은 준비 확인에만 사용하고, 최종 통계는 TEMP까지 고정한 controlled 결과만 사용한다. 짧은 준비 단계는 성능 통계에서 제외한다.

- feature `tool.project-maintenance`의 owner에 windows_delete.rs를 연결했다. 해당 변경의 mandatory native library check를 실행한다. 공용 dispatch API·Node writer·prompt/core adapter는 변경하지 않으므로 무관한 제품 전체 compilation이나 prompt/core 테스트는 반복하지 않는다. 기존 feature ID와 관련 검사 정의는 유지한다.

- 최종 비교는 child TEMP/TMP/TMPDIR도 이번 소유 temporary/os로 고정한다. 초기 baseline은 harness 공용 temp를 상속했으므로 비교 통계에서 제외하고, 환경을 맞춘 baseline/after를 새 controlled fixture에서 각각 2회 실행한다. 초기 결과는 실제 동작 준비 확인으로만 보존한다. 최적화 frozen 입력 SHA `1e43e3a056d6ea6feede253d7808d62ded9a7c42eea51de2afd74099727fcf0d`, native compile exit 0 (40.844초), after binary SHA `d5a141513182922723910d9c6efc59ef77f4e50b3bd26f2630b1a0559d848c40`.

## 회귀 검증

- `check-project-maintenance.cjs <frozen engine> --stage library`: actual exit 0; type-check, selection(132개), 실제 실행 모두 exit 0. 전체 crate 132 passed / 0 failed / 0 ignored. 준비 포함 161.821초, 실제 libtest execution 82.350초. frozen primary 변경 4개 파일 SHA 일치 재확인.
- 영구 회귀는 catalog 3개와 Windows worker 6개를 추가했다. warm byte cache에서도 같은 callback 순서·member/ancestor 권한 거부·기록 변경·새 consumer·불량 unrelated record를 검사한다. worker는 동일 실제 PID 재사용, 실패/속성 기록 격리, 응답 유실 시 비재시도, 완전 응답 직후 종료 결과 보존, 승인 밖 자식 거부, exact process handle을 통한 EOF 종료를 검사한다. 향후 최적화 안전 계약으로 유지한다.
- 기존 junction/hardlink/long path/System·권한·부분 실패/durable receipt/잠금/membership 회귀도 전체 crate에 포함해 통과했다. Windows x64 실제 검증이며 Linux/macOS 실기기·설치 앱 반영은 수행하지 않았다. 최종 rustfmt --check 및 git diff --check exit 0.

- task commit 제어 파일 `.git/dx02-task.index`를 생성 전 선언한다. 이 index로 이번 변경만 commit하고 일반 삭제·부재 확인한다. 기존 staged 항목 SHA를 보존하며 docs/background_command 및 feature inventory의 무관한 변경은 제외한다. 추출된 PowerShell background 실행 정책은 새 worker에서 유지하고 무관한 cmd.exe 테스트 변경은 분리한다.

## 최종 성능 비교

- Windows x64, Rust 1.95.0, release/x86_64-pc-windows-msvc, 동일 seed와 개수, child TEMP/TMP/TMPDIR 고정, OS cache 초기화 없음. baseline은 앞선 상태 저장 최적화를 이미 포함하며 이번 추가 개선만 비교한다. 각 경우 전후 2회, 준비/등록/review/컴파일은 apply 시간에서 제외한다.
- catalog: before 47.772016/53.704764초, after 45.508745/42.250651초; 평균 50.738390 → 43.879698초, 6.858692초(13.52%) 단축.
- windows: before 13.967594/14.240341초, after 2.537659/2.475517초; 평균 14.103967 → 2.506588초, 11.597379초(82.23%) 단축.
- catalog 경우는 64개 producer/512개 member 전체 검사와 8개 삭제를 포함한 결합 시간이다. catalog 단독 개선율로 분해하지 않는다. fresh 파일/권한 검사는 유지하므로 여전히 해당 비용이 남는다. Windows 경우는 catalog 없는 16개 파일 apply이다. 두 회의 평균이며 통계적 유의성이나 실제 대규모 정리의 동일 개선율을 주장하지 않는다.
- 유효 24개 native 호출 모두 exit 0, 매번 결과 deleted/remaining=false 및 실제 부재(총 96개)를 확인했다. before binary SHA `72e02facf40ab657b2427fd63e00d89a42de3afddfdaa08a288888e693fb9ce3`, after `d5a141513182922723910d9c6efc59ef77f4e50b3bd26f2630b1a0559d848c40`, frozen source `1e43e3a056d6ea6feede253d7808d62ded9a7c42eea51de2afd74099727fcf0d`, controller `df9bdab85a2a5e1e3fa51a5178148883cce72f2b2eb0e0f54e40903e34d9cfa9`.
- 검증된 변경 파일 SHA: `src/lib.rs`: `9d27474fba6e234613b474b73ec68891f9691ca94ed05fb4f0826b7048226059`; `src/registry.rs`: `1e0613c7038e67a25afdfcaf54539d0eb4f088119a33ac0e7ea7190f77f89847`; `src/paths.rs`: `472d4bddfded25e417ec1f844ac3c8c2a7fc01ffdd98e3a2300648deef685c0b`; `src/windows_delete.rs`: `991e0f59a638f104f31e386df0c7faa92475948bc03c7a70baa93de2fa2314a2`.
- 기존 staged 항목 4개는 원래 경로와 상태를 보존한다. 전체 index의 이번 소유 경로 제외 SHA `db49d5d1bb2fce71d88e23c805a5390ded976c971f6e41e9be491a7a8143c3e5`를 확인했다. 모든 생성 producer의 실제 종료를 확인했고 이번 run 전체를 native 정리한다. 원시 logs/reports와 복사본 삭제 후에도 본 기록으로 검증을 독립 확인할 수 있다.

## 정리 결과

- 이번 생성물 `artifacts/tasks/y075412d7bb`(등록 논리 크기 407,800,715 bytes)를 기본 native inventory/register → registered review → explicit apply 경로로 정리했다. review blocker/reference 없음, apply aborted=false, group/item deleted, remaining=false, deletion error=null, attributes=[]를 확인했다. 실제 파일시스템 경로 부재도 확인했다. attempt `attempt-54328-3041-1793002612672`. 물리 회수량은 도구가 null을 반환하므로 주장하지 않는다.
- 원래 producer record는 supported finalize 결과 finalized, remaining/references/blockers=[] 및 registry 파일 부재로 확인했다. 이번 작업의 소스 사본·Cargo target/pending/OS temp·실행기·fixture·controller·raw log/report는 모두 제거했다. 이전 `archive/DX-01-cleanup-performance-20261026`은 기존 사용자 승인대로 보존했다. 무승인 보관 예외는 없다.
- 공용 dispatch/schema/Unix 삭제·기존 정책은 유지한다. 단, 동기 PowerShell 초기화를 항목마다 반복하던 구현을 요청 내 순차 worker로 바꾸고 완전한 응답 및 미확인 결과를 구분한다. source-only 최적화이며 제품 전체 빌드·설치·배포를 하지 않았다.

- 인덱스 검증 보정: 초기 Node spawnSync 기본 출력 상한으로 ls-files 증거가 ENOBUFS 잘림 상태였으므로 초기 prefix SHA는 보존 근거에서 제외했다. 64MiB 수집 및 실제 exit/error 확인으로 17,504개 전체 엔트리를 읽고 이전 HEAD와 대조했다. 이번 소유 경로 외 차이는 작업 시작 전부터 staged였던 추가 파일 4개뿐이며 삭제/변경은 없다. Git status에서도 네 경로 모두 A 상태이고 working 변동 없음으로 재확인했다.
