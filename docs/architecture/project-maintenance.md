# 프로젝트 테스트와 생성물 관리

<!-- architecture: {"id":"arch.legacy.project-maintenance","feature":null,"layers":[],"redirect":"arch.project-maintenance.contract"} -->

Status: `reference` — link-only compatibility router.

[Canonical contract](features/project-maintenance/README.md).

<a id="프로젝트-테스트와-생성물-관리"></a>

[프로젝트-테스트와-생성물-관리](features/project-maintenance/README.md#프로젝트-테스트와-생성물-관리).

<a id="생명주기-소스-검사-범위"></a>

[생명주기-소스-검사-범위](features/project-maintenance/README.md#생명주기-소스-검사-범위).

<a id="성공한-삭제의-상세-이력"></a>

[성공한-삭제의-상세-이력](features/project-maintenance/README.md#성공한-삭제의-상세-이력).

<a id="windows-대량-io와-측정-메모리"></a>

[windows-대량-io와-측정-메모리](features/project-maintenance/README.md#windows-대량-io와-측정-메모리).

<a id="개인-맞춤-설정과-관리-기능-중지"></a>

[개인-맞춤-설정과-관리-기능-중지](features/project-maintenance/README.md#개인-맞춤-설정과-관리-기능-중지).

<a id="다중-플랫폼-관리-명령과-모듈-경계"></a>

[다중-플랫폼-관리-명령과-모듈-경계](features/project-maintenance/README.md#다중-플랫폼-관리-명령과-모듈-경계).

<a id="maintenance-platform-modules"></a>

[maintenance-platform-modules](features/project-maintenance/README.md#maintenance-platform-modules).

<a id="공통-코어와-플랫폼-어댑터"></a>

[공통-코어와-플랫폼-어댑터](features/project-maintenance/README.md#공통-코어와-플랫폼-어댑터).

<a id="파일-처리와-삭제"></a>

[파일-처리와-삭제](features/project-maintenance/README.md#파일-처리와-삭제).

<a id="실행-진입과-권한"></a>

[실행-진입과-권한](features/project-maintenance/README.md#실행-진입과-권한).

<a id="플랫폼별-수용과-전환"></a>

[플랫폼별-수용과-전환](features/project-maintenance/README.md#플랫폼별-수용과-전환).

<a id="생성-소유권과-보관관찰-책임"></a>

[생성-소유권과-보관관찰-책임](features/project-maintenance/README.md#생성-소유권과-보관관찰-책임).

<a id="목적과-책임"></a>

[목적과-책임](features/project-maintenance/README.md#목적과-책임).

<a id="테스트와-빌드"></a>

[테스트와-빌드](features/project-maintenance/README.md#테스트와-빌드).

<a id="기본-입력과-스크립트-변경의-분리"></a>

[기본-입력과-스크립트-변경의-분리](features/project-maintenance/README.md#기본-입력과-스크립트-변경의-분리).

<a id="실행과-복구"></a>

[실행과-복구](features/project-maintenance/README.md#실행과-복구).

<a id="소유권과-잠금-경계"></a>

[소유권과-잠금-경계](features/project-maintenance/README.md#소유권과-잠금-경계).

<a id="명시적으로-승인한-폴더-전체-삭제"></a>

[명시적으로-승인한-폴더-전체-삭제](features/project-maintenance/README.md#명시적으로-승인한-폴더-전체-삭제).

<a id="기본-삭제-검증과-catalog-관측"></a>

[기본-삭제-검증과-catalog-관측](features/project-maintenance/README.md#기본-삭제-검증과-catalog-관측).

<a id="요청-조정과-범위별-실행"></a>

[요청-조정과-범위별-실행](features/project-maintenance/README.md#요청-조정과-범위별-실행).

<a id="관리-잠금의-소유와-명시적-복구"></a>

[관리-잠금의-소유와-명시적-복구](features/project-maintenance/README.md#관리-잠금의-소유와-명시적-복구).

<a id="경합-처리와-보유-시간-관측"></a>

[경합-처리와-보유-시간-관측](features/project-maintenance/README.md#경합-처리와-보유-시간-관측).

<a id="공용-잠금-반환-대기"></a>

[공용-잠금-반환-대기](features/project-maintenance/README.md#공용-잠금-반환-대기).

<a id="관리-상태-분할"></a>

[관리-상태-분할](features/project-maintenance/README.md#관리-상태-분할).

<a id="생성물과-백업"></a>

[생성물과-백업](features/project-maintenance/README.md#생성물과-백업).

<a id="동일-경로의-중복-소유권-통합"></a>

[동일-경로의-중복-소유권-통합](features/project-maintenance/README.md#동일-경로의-중복-소유권-통합).

<a id="중첩-소유-항목의-단계적-폐기"></a>

[중첩-소유-항목의-단계적-폐기](features/project-maintenance/README.md#중첩-소유-항목의-단계적-폐기).

<a id="관리-경계-폐기"></a>

[관리-경계-폐기](features/project-maintenance/README.md#관리-경계-폐기).

<a id="배포-제어-파일과-빈-컨테이너의-폐기"></a>

[배포-제어-파일과-빈-컨테이너의-폐기](features/project-maintenance/README.md#배포-제어-파일과-빈-컨테이너의-폐기).

<a id="정리-결정과-적용"></a>

[정리-결정과-적용](features/project-maintenance/README.md#정리-결정과-적용).

<a id="기능-의존-캐시와-연결-정리"></a>

[기능-의존-캐시와-연결-정리](features/project-maintenance/README.md#기능-의존-캐시와-연결-정리).

<a id="생성물-소유와-삭제-검토"></a>

[생성물-소유와-삭제-검토](features/project-maintenance/README.md#생성물-소유와-삭제-검토).

<a id="반복-검증과-관리-잠금"></a>

[반복-검증과-관리-잠금](features/project-maintenance/README.md#반복-검증과-관리-잠금).

<a id="보호의-종료와-참조-해제"></a>

[보호의-종료와-참조-해제](features/project-maintenance/README.md#보호의-종료와-참조-해제).

<a id="지침과-적용-환경"></a>

[지침과-적용-환경](features/project-maintenance/README.md#지침과-적용-환경).

[preamble](features/project-maintenance/README.md#프로젝트-테스트와-생성물-관리).
