# Pi Harness Workbench 설계

공개 Pi SDK를 사용하는 Electron harness의 구조를 기록한다. Pi는 transcript와 agent session을 소유하고, 앱은 UI, durable metadata, credential, 권한 및 실패 복구를 별도 경계에서 소유한다.

## 문서

- [초기 전체 설계](initial-system-design.md): 제품 범위, process topology, protocol, 소유권, session, queue, context, goal, 보안과 복구
- [Provider-aware hybrid compaction](hybrid-compaction-design.md): Pi compaction 재사용, structured checkpoint, reasoning-aware routing과 portable fallback
- [Workspace 관리와 Pi session 경로](workspace-management-design.md): workspace identity, native folder 선택, trust와 Pi 기본 session root

## 상태와 권위

초기 전체 설계는 2차 Electron 참조 기준선이며 현재 azrael-ex 계약이 아니다. compaction 설계는 구현 완료된 기준선이다. Workspace 관리는 구현되었지만 Windows packaged native-picker 수동 acceptance가 남아 있다. 향후 Electron 재설계는 azrael-ex의 변경을 암묵적으로 상속하지 않고 이 디렉터리를 명시적으로 개정한다.
