상태: 사본 저장 및 프로젝트별 일괄 삭제 설계 논의 중 — 전체 삭제 보류 정책은 확정됐으며 사용 중 판정 구조를 설명한다. 제품 수정·빌드·설치는 수행하지 않았다.

# 일반 파일 첨부 실패 분석

## 목표·권한·범위
요청: 일반 파일 첨부 실패와 이미지 성공의 원인 분석. 허용: 코드·설치본·기존 로그 읽기 및 격리 실험. 제품 수정·빌드·설치 권한은 요청되지 않았다.
신고 환경: 로컬 Windows x64 VS Code. 공통 첨부 UI와 Windows 드래그 어댑터를 분석했다. Linux/macOS·원격 환경·실제 GUI 드롭은 미검증이다.
설계 소유자: docs/architecture/azrael-ex.md의 Chat content handling. 구현: scripts/inject-local-file-drop.cjs 및 pinned UI의 SFi/jSa/rti/ati/HQ.

## 확인된 원인
설치본의 SFi는 imageFiles/otherFiles가 모두 빈 경우에만 사용자 정의 addFileReferences를 호출한다. Windows 탐색기의 일반 File 객체는 native addFiles로 전달된다.
native jSa의 일반 파일 처리 E는 ati/HQ로 로컬 경로를 구한다. HQ는 electronBridge.getPathForFile 또는 File.path를 요구하며 없으면 null이다. 설치본 jSa 호출의 canCopyBrowserFileAttachments는 false이므로 경로 없는 일반 파일을 복사하는 대체 경로가 비활성화돼 있다. 결과적으로 참조 0개가 생성되며 오류도 표시하지 않는다.
이미지 처리는 별도 y 경로에서 Nf(File)로 바이트를 읽으므로 로컬 경로 없이도 작동할 수 있다.
사용자 정의 드래그 어댑터는 CodeEditors/CodeFiles/ResourceURLs/application/vnd.code.uri-list만 인식하고 Files-only 입력은 받지 않는다.

## 검증 근거
설치본: C:/Users/felre/.vscode/extensions/azrael-ex-local.azrael-2026.0.10.
두 pinned asset에서 local-file-drop 및 composer 주입 marker 존재 확인.
기존 runtime 로그: APPDATA/Code/logs/20261017T230155/window9/exthost/azrael-ex-local.azrael/Azrael Recovery.log에 hostVersion 2026.0.10과 u17b 엔진 기록. 다른 창 w10e도 공존하여 특정 사용자 창의 실행 asset 바이트와의 일치는 단정하지 않는다.
Windows Node VM 격리 실험: 설치된 app-initial-7a199c66e670.js에서 HQ/ati 및 E 함수를 추출하고 local host, copy false 조건을 제공했다. 일반 browser File(path 없음)은 references=0, errorNotifications=0. 동일 File에 path를 제공하면 references=1, errorNotifications=0. 실제 실행 exit code 0.
생산 코드 helper의 Files-only 입력 인식 결과 false. 실제 실행 exit code 0.
기존 scripts/test-local-file-drop.cjs는 CodeFiles/ResourceURLs 중심이며 native drop mock은 otherFiles=[]이다. 실제 Files-only 비이미지 드롭 회귀를 검증하지 않는다.

## 판단·남은 확인·권고
경로 없는 일반 파일을 조용히 버리는 결함은 설치 코드와 격리 재현으로 확인했다. 사용자가 Windows 탐색기에서 드래그할 때 실패한다고 확인했으므로 조사한 입력 경로와 일치한다. 실제 드래그 payload와 GUI 재현은 아직 확인되지 않아 단일 확정 원인으로 단정하지 않는다. 버튼 선택·VS Code 내부 드래그까지 동일 원인이라고 확대하지 않는다.
권고: 비이미지 File에 대해 VS Code host가 읽을 수 있는 임시 첨부 파일을 만드는 기존 바이트 전달 경로의 재사용 가능성을 검토하거나 host 경로 해석을 연결한다. Files-only 비이미지 드롭 회귀와 이미지 보존을 함께 확인해야 한다. 경로를 추정하거나 file.name을 절대경로로 취급하지 않는다.
실제 GUI 재현 없이 수정안의 완전성은 판단하지 않는다. 이번 작업은 제품·설계 계약을 변경하지 않아 architecture 갱신·제품 빌드·설치·작업 커밋은 수행하지 않았다.



## 원본 경로 획득 가능성 조사

추가 요청은 원래 경로를 얻을 수 있는지 조사하는 것이다. 구현·VS Code 수정·설치 권한은 요청되지 않았다. Windows 로컬 설치본만 조사했다.

설치 VS Code는 C:/Users/felre/AppData/Local/Programs/Microsoft VS Code/6d62b1d5da/resources/app/package.json 기준 1.142.0이다.
- out/vs/base/parts/sandbox/electron-browser/preload.js에는 webUtils.getPathForFile이 있다. workbench.desktop.main.js의 JP/hir가 이를 이용해 native File에 URI를 부여한다. VS Code 자체에는 원래 경로 획득 기능이 있다.
- 확장 웹뷰는 별도 iframe이다. 설치 out/vs/workbench/contrib/webview/browser/pre/index.html의 getVsCodeApiScript는 postMessage/getState/setState만 노출하고, handleInnerDropEvent는 preventDefault만 한다. 파일 경로를 추출·전달하지 않는다.
- 설치 out/vscode-dts/vscode.d.ts의 Webview/WebviewView/WebviewPanel에는 onDidDropFiles 또는 File 경로 해석 API가 없다. onDidReceiveMessage 문서는 DOM File/Blob 전달도 지원하지 않는다고 명시한다.
- 설치본 getVsCodeApiScript를 추출한 Node VM 실험에서 실제 API 키 getState/postMessage/setState를 확인했다(exit 0). 최초 fixture는 외부 상수 vscodePostMessageFuncName 누락으로 ReferenceError(exit 1)였고, 설치본과 동일한 상수를 제공한 재실행이 통과했다. 실제 GUI 검증이 아니다.

원본 경로가 필요한 공식 경로는 showOpenDialog의 Uri 반환, 또는 별도 TreeView의 TreeDragAndDropController/DataTransferFile.uri이다. 설치 Azrael의 BNa는 pick-files RPC로 파일 선택을 요청하며 host는 pickFilesFromDialog로 연결한다. 실제 파일 선택 버튼은 이번에 실행하지 않았다. VS Code 내부 탐색기/편집기에서 오는 CodeFiles/ResourceURLs는 기존 어댑터가 담당하며 Windows 탐색기 Files-only 입력과 다르다.

현재 채팅 입력창에 OS 파일을 직접 드롭하면서 원본 경로를 얻는 공개 API 연결은 확인되지 않았다. 앞선 'VS Code에서 경로를 받아 연결' 제안은 공개 확장 API만으로 간단히 실행할 수 있는 방안으로 받아들이면 안 된다. VS Code 자체 preload/workbench 변경은 연결 설계 가능성이 있지만 Azrael 확장 범위를 넘어 배포·업데이트 유지까지 확대되며 실제 가능성은 검증하지 않았다.

권고: 원본 파일 직접 참조가 필수라면 기존 host 파일 선택 경로를 우선 재사용한다. 별도 TreeView 드롭 영역도 공식 경로이나 UI 변경이 필요하다. 현재 입력창으로 바로 드롭하는 사용성을 우선하면 파일 바이트를 host에 보내 첨부용 사본을 저장하는 설계를 검토한다. 사본 저장은 원본 경로 획득과 다르고 저장 한도·수명·오류처리·이미지 보존 검증이 필요하다. 단순 플래그 변경이나 File.name 기반 경로 추정으로 해결했다고 간주하지 않는다.

공식 근거:
- Electron renderer/preload 요구: https://www.electronjs.org/docs/latest/api/web-utils
- VS Code native 경로 해석: https://github.com/microsoft/vscode/blob/main/src/vs/platform/dnd/browser/dnd.ts
- 웹뷰 API 및 드롭 전달: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/webview/browser/pre/index.html
- 공개 API: https://code.visualstudio.com/api/references/vscode-api#Webview 및 #TreeDragAndDropController
- 동일 기능 요청 https://github.com/microsoft/vscode/issues/255608 은 not planned로 닫혀 있다. 이는 보조 근거이며 보편적 불가능성을 증명하지 않는다.

## 첨부 사본 저장소 관리 설계

상태: 설계 논의 중. 사본 저장 방식과 설정의 현재 프로젝트 사본 일괄 삭제 진입점은 확정됐다. 구현·빌드·설치·실제 삭제는 요청되지 않았다. design-collaboration과 design-documentation으로 같은 기록을 이어간다.

설정의 '현재 프로젝트 첨부 사본 비우기' 버튼 하나를 제공한다. 별도 파일 목록·기간별 정리·자동 정리 설정은 현재 요구에 포함하지 않는다. 대상 설계 소유자는 docs/architecture/azrael-ex.md의 Attachment copies and project cleanup이다. Windows x64, Linux x64, macOS ARM64 로컬 데스크톱의 공통 목표이며 실제 구현 검증은 아직 없다.

권고 동작: 해당 프로젝트에 귀속된 Azrael 관리 첨부 사본만 삭제한다. 원본 파일과 대화 메시지는 보존한다. 과거 대화에서 삭제한 첨부 내용을 다시 읽으려면 재첨부가 필요하다는 점을 실행 전에 안내한다. 삭제 결과는 실제 삭제된 수/용량 및 실패를 반영해야 한다.

확정된 삭제 정책: 사용 중인 사본이 하나라도 있으면 프로젝트 전체 삭제를 보류한다.

사용 중 판정의 제안 설계: 사본별 ID와 프로젝트 ID를 부여하고 호스트가 소유 관계를 기록한다. 복사 중·입력창 초안 첨부·전송 준비/대기열·실행 작업·자동 재개 대기와 하위 작업에서 필요한 사본을 보호한다. 실행 작업은 현재 메시지뿐 아니라 대화 이력에서 접근 가능한 관리 사본도 보호해야 한다. 과거 대화에 참조만 남은 완료 상태는 사용 중으로 보지 않는다. 실행 중 실제 read 이벤트만으로 판정하지 않는다.

여러 창과 작업은 공통 저장소에서 보호 관계를 공유하고 삭제 검사·삭제와 새 사용 등록을 직렬화해야 한다. 재시작·충돌·전송 결과 불명은 초안·큐·엔진 작업 상태와 대조하고, 실제 소유자 종료와 인계 여부 확인 전에는 보호를 해제하지 않는다. 단순 타이머 만료·창 닫힘·PID 부재만으로 해제하지 않는다. 엔진에서 직접 시작한 작업 및 하위 작업까지 빠짐없이 연결할 수 있는지는 구현 전 조사와 검증이 필요하다.

현재 코드에는 초안 첨부 snapshot(scripts/inject-composer-draft.cjs)과 엔진 thread/turn 상태 조회(scripts/recovery-state.cjs)가 있다. 사본별 공통 사용 등록부는 아직 구현하지 않았으며 기존 상태 조회만으로 안전한 삭제가 보장된다고 주장하지 않는다. 상세 판정 구조는 권고안이며 제품 변경 권한은 별도다.

프로젝트 귀속은 기존 새 대화 초안의 host workspace project ID 재사용을 우선 조사한다(docs/architecture/ui-presentation.md 및 scripts/inject-project-drafts.cjs의 fetchWrapper.extensionFetchHandler.getWorkspaceProject). 첫 workspace 폴더만 임의 선택하지 않는다. 다중 루트 및 프로젝트 없는 창의 귀속·표시, 공유 사본 소유권은 구현 전에 정의해야 한다.

전송 취소/대화 삭제 시 자동 삭제와 사본 배지는 합의 범위에 포함하지 않는다. 제품 변경 전에 Files-only 일반 파일 저장 및 첨부, 이미지 보존, 프로젝트 격리, 삭제 범위, 사용 중 보호, 실패 처리와 양 테마 설정 UI 검증을 계획한다. Windows 회귀와 다른 지원 플랫폼의 실제 검증 범위를 구분한다.

