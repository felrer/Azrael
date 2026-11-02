상태: 완료 — 10개 실험·통합 검증 및 임시 자료 삭제 완료, 제품 변경 없음.

# 알려진 대상 직접 조회와 조건부 영어 개요 평가

사용자가 선택한 정책을 기존 5유형(Blender 모델/애니메이션/영상, SVG, HTML 슬라이드)에서 시험한다. 기존 동작과 시각 목표를 재사용하되 새로운 동일 시드를 양 조건에 복사하고 유형별 독립 sol_executor 한 쌍, 총 10세션을 실행한다. 제품 연결·기본 도구·사용자 설정·공유 지침은 변경하지 않는다. Windows x64 로컬의 실제 파일 수정/렌더 범위이며 생성형 래스터 이미지/PPTX/GUI 작업으로 일반화하지 않는다.

기존 일반 조건에도 필터와 선택 fields를 허용하고 정확한 ID를 알면 불필요한 list를 하지 않도록 한다. adaptive 조건은 target을 알면 필요한 per-item fields만 read_many로 읽고, 모를 때만 query/parent/frame_range로 scoped overview를 펼친다. 개요의 key/관측 설명은 English, 원본 이름·텍스트는 번역하지 않는다. 전체 개요는 scope:'root'를 명시하면 가능하며 행/문자/본문 하드 제한은 없다. 이전 출력도 대부분 영어였으므로 영어만의 효과를 분리했다고 주장하지 않는다.

모델/애니메이션은 정확한 대상 이름을 주는 known 사례다. SVG/슬라이드는 visible title·내용만, 영상은 마지막 장면의 문구/시간 구간만 주어 내부 ID를 모르는 사례로 사용한다. 동일 목표·프롬프트를 두 조건에 주며 이전 cr01 수치를 섞어 평균내지 않는다. COMMON/ADAPTIVE 문서를 분리해 이전 baseline 미지원 API 안내 혼동을 제거한다.

root는 공통 harness 재사용·계측·통합·시각/보존 검사·정리 소유, native/document 제작 agent는 각각 자기 adapter/seed만 소유한다. 두 제작자와 평가 세션의 추가 위임은 금지한다. 실제 preflight 후 source/hash를 고정하고 준비된 평가를 시작한다. 모델 동시성은 최대 4, Blender/Chrome backend는 단일 queue로 실행한다. queue와 provider 영향을 실제 도구 속도 차이로 해석하지 않는다.

조회/전체 API/원시·전달 텍스트/실제 이미지/input 증가·왕복/오류·재조회/목표와 무관 요소 보존을 계측한다. 초기·최종 preview를 실제로 보고 최종 control verify/원문 보존·MP4 확인을 수행한다. 언어 효과를 따로 재려면 같은 개요의 한·영 조건이 필요하며 이번에는 combined policy만 평가한다. 실제로 scoped overview가 사용되는지와 known 대상에서 생략되는지 확인한다.

임시 자료는 생성 전에 lifecycle run:creative-read-eval:20261102:r2(owner work:serena-read-eval), artifacts/verification/cr02에 등록했다. 이전 승인된 harness/fixture를 제작자의 맥락과 원래 root rollout에서 코드 데이터만 복원해 재사용한다. 결과를 이 보고서에 독립 보존하고 실제 producer 종료 확인 뒤 현재 검증된 maintenance owner register/review/apply/finalize로 삭제한다. 보고서만 로컬 커밋하며 다른 작업 source/index를 보존한다. development-workflow·implementation·testing의 기존 절차를 따른다.

## 결과: 호출 수는 감소했지만 컨텍스트 절감은 아직 확인되지 않음

일반 → adaptive. 조회 호출에는 실패와 read_many 내부 item 오류도 포함한다. 출력은 문자가 기준이며 토큰 수와 같지 않다.

| 유형 | 조회 호출 | 조회 응답 문자 | 전체 도구 전달 문자 | 입력 컨텍스트 증가 토큰 |
|---|---:|---:|---:|---:|
| 3D 모델 | 2 → 1 | 238 → 214 | 4768 → 5564 | 3024 → 3154 |
| 애니메이션 | 1 → 1 | 936 → 982 | 5437 → 6477 | 3480 → 3739 |
| SVG 그래픽 | 3 → 2 | 547 → 990 | 5356 → 6645 | 3730 → 4086 |
| 영상 편집 | 3 → 3 | 445 → 410 | 5198 → 6155 | 3460 → 3829 |
| HTML 슬라이드 | 5 → 2 | 632 → 2090 | 5598 → 7938 | 3897 → 4417 |
| 합계 | 14 → 9 | 2798 → 4686 | 26357 → 32779 | 17591 → 19225 |

조회 호출 -35.7%, 조회 응답 +67.5%, 전체 전달 텍스트 +24.4%, 입력 증가 +9.3%. 전체 작업 API는 34→29회다. 모델 요청은 양쪽 모두 52회, 모델 도구 호출은 양쪽 모두 47회다. 기존 조건이 독립 get을 한 exec에서 묶기도 하므로 API 호출 감소가 모델 왕복 감소를 뜻하지 않는다. 실제 이미지 블록은 양쪽 각각10개(모든 세션 전후2개)다.

전체 전달 텍스트는 안내 읽기·실행 wrapper·오류·검사 결과까지 포함한다. 안내 파일 자체는 11,738→16,504자(+4,766자)로 늘어 전체 차이6,422자의 큰 부분을 설명한다. 안내 파일 문자만 산술 차감하면 14,619→16,275자이나, 이는 안내의 행동 영향이나 wrapper 차이를 제거한 별도 통제 실험이 아니다. 입력 증가는 첫 모델 입력 대비 마지막 입력의 차이이며, 읽기만의 토큰·총 청구 입력 토큰·이미지 토큰을 뜻하지 않는다. 자체 출력·반복 포함 가능성과 이미지 처리 영향을 분리하지 못했다.

### 정책이 실제로 지켜졌는가

- Known 모델/애니메이션 모두 overview 없이 read_many를 바로 사용했다. 모델은 두 대상의 dimensions/location/rotation을 한 번에 읽었고 애니메이션은 대상 하나의 animation만 읽었다. 단일 대상은 get도 한 번이므로 호출 절감이 없었다. read_many envelope 때문에 애니메이션 응답이936→982자로 소폭 증가했다.
- SVG는 Design Exchange 검색으로 card-a 가지6개만 펼친 뒤 date/CTA 필드 두 개를 일괄 조회했다. 무관한 다른 카드/전역 개요를 열지 않았다. 하지만 해당 카드 형제와 설명도 포함해 단순 list+선택 get보다 출력이 커졌다.
- 영상은 원문 Thanks for watching와 61–90프레임의 교집합으로 한 strip만 펼쳤다. overview222자였고 전역 조회는 없었다. 양쪽 모두 잘못된 frame_final_duration 요청1회가 발생해 지원 필드로 재조회했다. adaptive read_many의 item 오류는 isError=false 안의 errors 배열이므로 별도로 계수했다. 오류 비용은 제외하지 않았다.
- 슬라이드는 Workshops by quarter 검색으로 해당 slide/chart 가지14개를 펼친 뒤 chart scale/Q3/bar/label 네 대상을 서로 다른 필드로 한 번에 읽었다. 목적에 맞는 batch였지만 개요의 타 분기·다른 분기 값과 설명까지 반환해 응답이632→2,090자로 증가했다.
- adaptive의 scoped overview3회, root overview0회, list/dump0회. 불필요한 전역 개요는 피했지만 scoped라고 반드시 작거나 최소 출력인 것은 아니다. 개요는 영어 키/관측 설명을 썼으며 원본 이름·문구는 보존했다.

### 해석 및 다음 개선 후보

조건부 접근은 알려진 대상의 우회 탐색을 없애고 실제 관련 속성 묶음을 만들었다. 다만 이번 소형 과제에서는 일반 조건의 필터 조회도 작아, 개요의 추가 정보와 사용 안내가 더 비쌌다. 따라서 현재 결과로 컨텍스트 최적화가 달성됐다고 판단하지 않는다.

권장 후속 설계는 (1) 검색 첫 응답은 일치 대상의 ID/type/parent와 짧은 역할만 반환하고, 자식·형제·수치·상세 구조는 선택적으로 확장, (2) 항목마다 지원 필드/수정 필드 스키마를 짧게 제공해 Blender 내부 속성명 추측 실패 방지, (3) 단일 대상은 get, 여러 대상은 read_many로 자연스럽게 선택, (4) read_many/overview 안내는 일회성 공통 계약으로 제공해 호출마다 긴 지침을 복제하지 않기다. 이 후보들은 아직 구현/측정하지 않았다. 하드 출력 제한으로 필요한 정보를 숨기기보다는 조회 표현력과 단계별 구조를 개선하는 방향이다.

기존 실험 출력도 대부분 영어였으므로 영어 자체의 토큰 절약 효과는 분리 검증하지 않았다. 같은 개요를 한/영으로 쌍대 측정해야 언어 효과를 주장할 수 있다. 정확한 사전 ID를 늘리면 결과가 좋아질 수 있지만 이번에는 known2/unknown3을 고정했다. 복잡한 장면이나 반복 편집에서의 효과는 미검증이다.

## 검증과 범위

Windows x64, Blender5.2.2LTS의 실제 .blend 객체/FCurve/VSE, 실제 SVG/XML과 HTML/SVG chart, Chrome headless PNG를 사용했다. Serena 자체/MCP 실제 연결·Three.js·Blender GUI·PPTX·생성형 이미지 작업의 직접 측정이 아니다. 단순 과제 각 조건1회, 총10개 독립 sol_executor 세션이며 유의성/일반 성능 우위를 주장하지 않는다.

native/document adapter 각각 사전검사 exit0. read_many/get 동등성, scope query/parent/frame_range, 요청별 field/error, 잘못된 수정의 원자성 및 무관 요소 보존을 검사했다. 13개 seed/helper source hash를 동결하고 종료 시 전부 일치했다. 같은 유형의 두 조건은 초기 원본 바이트가 동일했다. 평가 기간 동시 모델 최대4개, backend는 한 Blender queue로 순차 처리했다. 10개 trial verify 및 root의 새 control verify10개 모두 통과했다. control 호출은 실험 카운트에서 제외했다.

목표: 모델 폭2.6/2.4; ball Z12=3.6, 마지막 키30→42(값0.61); SVG 날짜 November16·18:30과 CTA #a14b32; closing caption Create something bright.와 시작65/길이30; slide Q3=9, bar height135/y35, label9/y26. XML은 목표 외 전체 tree 비교(포맷 공백 제외); native는 scene/geometry/material/curve/strip 상태 비교다. native 검사의 명시적 제외는 파생 Z곡선 handles 및 evaluated X/Z pose이며, 이 범위까지 보존됐다고 주장하지 않는다.

모든 trial이 전후 PNG를 실제 view_image로 확인했다. root도 최종10개 미리보기를 합성해 육안 확인했고, 양 조건의 목표 결과/배치에 명백한 차이를 보지 못했다. Glow panel은 시점상 native 값 검증에 의존한다. 애니메이션은1/12/30프레임 표본만 육안 확인했고42키는 native 검사로 검증했다. 연속 애니메이션 전체는 시각 검사하지 않았다.

두 최종 MP4 export는 명시적 --python-exit-code1로 실제 exit0, 각각22,838바이트/96프레임. .blend source hash는 export 전후 동일했다. 다시 실제 movie strip으로 import해96프레임 확인 및75프레임 PNG decode/render exit0, root가 adaptive75프레임의 변경 문구를 육안 확인했다. worker stop은 기존 실행 session의 실제 exit0과 PID+CreationDate identity 및 하위/관련 명령행 CIM snapshot으로 확인했으며 남은 일치 process/관련 process는0개다. native export/검사도 실제 종료 후 확인했다.

실험 읽기 API service time 합계80.18→61.12ms는 로컬 직렬 queue 내부 시간이며 파일열기/모델/렌더/대기 전체 속도와 다르다. 세션별 elapsed는 아래에 보존하며 중첩 시간을 합산해 총 소요라고 쓰지 않는다. provider/queue 영향이 있어 이 표본에서 속도 우위를 결론내리지 않는다. root 검증 보조 도구에는 PowerShell node -e quoting1회, PowerShell pipeline 문법1회, Python locale read1회가 실패했고 허용된 방법/명시 UTF8로 수정 후 완료했다. 이들은 trial 외 control 비용이며 성능표에는 섞지 않았다.

## 정리 완료

현재 설치된 maintenance-owner-ff01-reservation-win-x64-20261102의 실행 파일 SHA256 c0cf7fa34948cceebbd10db45b0b55ecf0f42c7fae79079da673e8d6ce90c680을 확인했다. lifecycle close revision2 및 완전한 group 등록 후, 등록 결과 파일 추가를 반영해 재등록했다. 마지막 측정30,335,275바이트/참조0개였고 registered review blockers0개를 확인했다. 같은 최신 token으로 apply exit0, group/item deleted, remaining=false를 받았으며 실제 artifacts/verification/cr02 경로 부재를 확인했다. finalize는 remaining/references/blockers가 모두 빈 배열로 완료됐다. 보관 fixture/adapter/helper/PNG/MP4/raw log/profile/cache는 없으며 이 보고서와 기존 세션 저장소만 남는다. 임시 자료 내부의 상세 경로는 아래의 과거 검증 identity로만 보존한다.

## 독립 보존 근거

아래 자료는 cr02 임시 파일 삭제 후에도 결과·검사·입력 identity를 이해할 수 있도록 이 보고서에 보존한다. 원본 rollout은 세션 저장소 소유이며 이번 작업 정리 대상이 아니다. task 임시 raw logs/fixture/preview/helper/profile/cache는 모두 정리 대상이다.

### 세션 및 상세 계측

```json
{
  "totals": {
    "base": {
      "read_queries": 14,
      "total_queries": 34,
      "read_raw_chars": 2798,
      "delivered_chars": 26357,
      "guide_file_chars": 11738,
      "input_growth": 17591,
      "model_requests": 52,
      "model_tool_calls": 47,
      "image_blocks": 10
    },
    "adaptive": {
      "read_queries": 9,
      "total_queries": 29,
      "read_raw_chars": 4686,
      "delivered_chars": 32779,
      "guide_file_chars": 16504,
      "input_growth": 19225,
      "model_requests": 52,
      "model_tool_calls": 47,
      "image_blocks": 10
    }
  },
  "timeline": [
    {
      "lane": "base_model",
      "start": "2026-11-02T14:50:45.405Z",
      "end": "2026-11-02T14:51:41.726Z"
    },
    {
      "lane": "adaptive_model",
      "start": "2026-11-02T14:50:56.571Z",
      "end": "2026-11-02T14:52:08.219Z"
    },
    {
      "lane": "adaptive_graphic",
      "start": "2026-11-02T14:51:04.409Z",
      "end": "2026-11-02T14:52:03.765Z"
    },
    {
      "lane": "base_graphic",
      "start": "2026-11-02T14:51:13.239Z",
      "end": "2026-11-02T14:52:12.372Z"
    },
    {
      "lane": "base_animation",
      "start": "2026-11-02T14:54:15.413Z",
      "end": "2026-11-02T14:55:12.937Z"
    },
    {
      "lane": "adaptive_animation",
      "start": "2026-11-02T14:54:22.409Z",
      "end": "2026-11-02T14:55:25.989Z"
    },
    {
      "lane": "base_video",
      "start": "2026-11-02T14:54:28.151Z",
      "end": "2026-11-02T14:55:28.510Z"
    },
    {
      "lane": "adaptive_video",
      "start": "2026-11-02T14:54:34.410Z",
      "end": "2026-11-02T14:55:32.893Z"
    },
    {
      "lane": "base_slides",
      "start": "2026-11-02T14:55:19.810Z",
      "end": "2026-11-02T14:56:14.918Z"
    },
    {
      "lane": "adaptive_slides",
      "start": "2026-11-02T14:55:35.254Z",
      "end": "2026-11-02T14:56:28.912Z"
    }
  ],
  "detail": [
    {
      "lane": "base_model",
      "queries": 6,
      "by_tool": {
        "preview": 2,
        "get": 2,
        "apply": 1,
        "verify": 1
      },
      "guide_chars": 2318,
      "model_requests": 10,
      "model_tool_calls": 9,
      "seconds": 56.321,
      "read_service_ms": 24.63329996680841,
      "errors": [],
      "item_errors": [],
      "first_input": 24566,
      "last_input": 27590,
      "output_tokens": 1414,
      "image_blocks": 2,
      "preview_files": [
        {
          "file": "variants\\base_model\\previews\\1793631055777-37042f7f8e.request.png",
          "bytes": 124429,
          "width": 384,
          "height": 288,
          "sha256": "25b79ea5be5f515c83d181dd3f90c55715e74965fa8c6e2f43b2f07aae08df10"
        },
        {
          "file": "variants\\base_model\\previews\\1793631078120-085f240ae9.request.png",
          "bytes": 125494,
          "width": 384,
          "height": 288,
          "sha256": "cc9cf645dd37065b0321de5fe10c583b155d21a5ab2f1bf6af4ec1f901eda1e6"
        }
      ]
    },
    {
      "lane": "adaptive_model",
      "queries": 5,
      "by_tool": {
        "preview": 2,
        "read_many": 1,
        "apply": 1,
        "verify": 1
      },
      "guide_chars": 3300,
      "model_requests": 10,
      "model_tool_calls": 9,
      "seconds": 71.648,
      "read_service_ms": 10.788300016429275,
      "errors": [],
      "item_errors": [],
      "first_input": 24585,
      "last_input": 27739,
      "output_tokens": 1365,
      "image_blocks": 2,
      "preview_files": [
        {
          "file": "variants\\adaptive_model\\previews\\1793631065066-a033942479.request.png",
          "bytes": 124433,
          "width": 384,
          "height": 288,
          "sha256": "796c75c2c768f934d5bfb793de9b43a0c016dbe225cfb834838dbb1b140a5dcd"
        },
        {
          "file": "variants\\adaptive_model\\previews\\1793631097901-5d69331f45.request.png",
          "bytes": 125498,
          "width": 384,
          "height": 288,
          "sha256": "0a072a8b1b3fbde6af9546ec3d07402769e634db048c00a23c2a26a01a42f4bd"
        }
      ]
    },
    {
      "lane": "adaptive_graphic",
      "queries": 6,
      "by_tool": {
        "preview": 2,
        "overview": 1,
        "read_many": 1,
        "apply": 1,
        "verify": 1
      },
      "guide_chars": 3270,
      "model_requests": 10,
      "model_tool_calls": 9,
      "seconds": 59.356,
      "read_service_ms": 1.2590000114869326,
      "errors": [],
      "item_errors": [],
      "first_input": 24587,
      "last_input": 28673,
      "output_tokens": 1454,
      "image_blocks": 2,
      "preview_files": [
        {
          "file": "variants\\adaptive_graphic\\previews\\1793631075594-ff5a2cb19a.request.png",
          "bytes": 35511,
          "width": 960,
          "height": 720,
          "sha256": "06b75f704f6f318c73ab9271740264940cca833490926fab79184f14e56358d4"
        },
        {
          "file": "variants\\adaptive_graphic\\previews\\1793631096650-00136190ef.request.png",
          "bytes": 38089,
          "width": 960,
          "height": 720,
          "sha256": "5dc1f1dccc0712442ab512c6a6c664b869b7f345bd353f4769223f24eab2dc9b"
        }
      ]
    },
    {
      "lane": "base_graphic",
      "queries": 7,
      "by_tool": {
        "preview": 2,
        "list": 1,
        "get": 2,
        "apply": 1,
        "verify": 1
      },
      "guide_chars": 2360,
      "model_requests": 11,
      "model_tool_calls": 10,
      "seconds": 59.133,
      "read_service_ms": 2.226499986136332,
      "errors": [],
      "item_errors": [],
      "first_input": 24576,
      "last_input": 28306,
      "output_tokens": 1341,
      "image_blocks": 2,
      "preview_files": [
        {
          "file": "variants\\base_graphic\\previews\\1793631082201-d00ba1768d.request.png",
          "bytes": 35511,
          "width": 960,
          "height": 720,
          "sha256": "06b75f704f6f318c73ab9271740264940cca833490926fab79184f14e56358d4"
        },
        {
          "file": "variants\\base_graphic\\previews\\1793631108438-04dd19b10e.request.png",
          "bytes": 38089,
          "width": 960,
          "height": 720,
          "sha256": "5dc1f1dccc0712442ab512c6a6c664b869b7f345bd353f4769223f24eab2dc9b"
        }
      ]
    },
    {
      "lane": "base_animation",
      "queries": 5,
      "by_tool": {
        "preview": 2,
        "get": 1,
        "apply": 1,
        "verify": 1
      },
      "guide_chars": 2338,
      "model_requests": 10,
      "model_tool_calls": 9,
      "seconds": 57.524,
      "read_service_ms": 12.77739999932237,
      "errors": [],
      "item_errors": [],
      "first_input": 24526,
      "last_input": 28006,
      "output_tokens": 1261,
      "image_blocks": 2,
      "preview_files": [
        {
          "file": "variants\\base_animation\\previews\\1793631264043-5bcda08c80.request-contact.png",
          "bytes": 187576,
          "width": 1176,
          "height": 288,
          "sha256": "56279176e83951914c272a8ee3ec7b94d582c54f409a0a3c2069102a72beab38"
        },
        {
          "file": "variants\\base_animation\\previews\\1793631290780-f1094291a6.request-contact.png",
          "bytes": 194724,
          "width": 1176,
          "height": 288,
          "sha256": "ab8d8ab6862b866e4a3499fbd761c1cf7b22a0213d26955692cb56fe50f4697d"
        }
      ]
    },
    {
      "lane": "adaptive_animation",
      "queries": 5,
      "by_tool": {
        "preview": 2,
        "read_many": 1,
        "apply": 1,
        "verify": 1
      },
      "guide_chars": 3320,
      "model_requests": 10,
      "model_tool_calls": 9,
      "seconds": 63.58,
      "read_service_ms": 13.465600000927225,
      "errors": [],
      "item_errors": [],
      "first_input": 24535,
      "last_input": 28274,
      "output_tokens": 1289,
      "image_blocks": 2,
      "preview_files": [
        {
          "file": "variants\\adaptive_animation\\previews\\1793631274360-950deabea0.request-contact.png",
          "bytes": 187576,
          "width": 1176,
          "height": 288,
          "sha256": "56279176e83951914c272a8ee3ec7b94d582c54f409a0a3c2069102a72beab38"
        },
        {
          "file": "variants\\adaptive_animation\\previews\\1793631301236-82795d9ba1.request-contact.png",
          "bytes": 194724,
          "width": 1176,
          "height": 288,
          "sha256": "ab8d8ab6862b866e4a3499fbd761c1cf7b22a0213d26955692cb56fe50f4697d"
        }
      ]
    },
    {
      "lane": "base_video",
      "queries": 7,
      "by_tool": {
        "preview": 2,
        "list": 1,
        "get": 2,
        "apply": 1,
        "verify": 1
      },
      "guide_chars": 2358,
      "model_requests": 12,
      "model_tool_calls": 11,
      "seconds": 60.359,
      "read_service_ms": 37.62429999187589,
      "errors": [
        {
          "tool": "get",
          "error": "ValueError: Unknown fields: frame_final_duration"
        }
      ],
      "item_errors": [],
      "first_input": 24530,
      "last_input": 27990,
      "output_tokens": 1299,
      "image_blocks": 2,
      "preview_files": [
        {
          "file": "variants\\base_video\\previews\\1793631279357-af8b48d3e6.request-contact.png",
          "bytes": 205843,
          "width": 1176,
          "height": 288,
          "sha256": "858182992c1ebf7bcf1ec420cf797581330398edf6ff69902d58bd28e55cd842"
        },
        {
          "file": "variants\\base_video\\previews\\1793631309557-1ad50d4861.request-contact.png",
          "bytes": 206721,
          "width": 1176,
          "height": 288,
          "sha256": "38c88b9a69447f0d22710bd9b4e0b3a55f88d8c90c88c571fbfda13378168ca9"
        }
      ]
    },
    {
      "lane": "adaptive_video",
      "queries": 7,
      "by_tool": {
        "preview": 2,
        "overview": 1,
        "read_many": 2,
        "apply": 1,
        "verify": 1
      },
      "guide_chars": 3340,
      "model_requests": 12,
      "model_tool_calls": 11,
      "seconds": 58.483,
      "read_service_ms": 34.16899999137968,
      "errors": [],
      "item_errors": [
        {
          "tool": "read_many",
          "id": "Closing caption",
          "error": "Unknown fields: frame_final_duration"
        }
      ],
      "first_input": 24543,
      "last_input": 28372,
      "output_tokens": 1502,
      "image_blocks": 2,
      "preview_files": [
        {
          "file": "variants\\adaptive_video\\previews\\1793631282355-4f4296a5ed.request-contact.png",
          "bytes": 205843,
          "width": 1176,
          "height": 288,
          "sha256": "858182992c1ebf7bcf1ec420cf797581330398edf6ff69902d58bd28e55cd842"
        },
        {
          "file": "variants\\adaptive_video\\previews\\1793631311969-16cf1295bb.request-contact.png",
          "bytes": 206721,
          "width": 1176,
          "height": 288,
          "sha256": "38c88b9a69447f0d22710bd9b4e0b3a55f88d8c90c88c571fbfda13378168ca9"
        }
      ]
    },
    {
      "lane": "base_slides",
      "queries": 9,
      "by_tool": {
        "preview": 2,
        "list": 1,
        "get": 4,
        "apply": 1,
        "verify": 1
      },
      "guide_chars": 2364,
      "model_requests": 9,
      "model_tool_calls": 8,
      "seconds": 55.108,
      "read_service_ms": 2.9182999569457024,
      "errors": [],
      "item_errors": [],
      "first_input": 24528,
      "last_input": 28425,
      "output_tokens": 1470,
      "image_blocks": 2,
      "preview_files": [
        {
          "file": "variants\\base_slides\\previews\\1793631328396-f8a32cf0e6.request.png",
          "bytes": 43063,
          "width": 960,
          "height": 720,
          "sha256": "eb875e2b44d82bc37d39950b8e4a0e373b73a37c7e358b2ac6286c20d1f22549"
        },
        {
          "file": "variants\\base_slides\\previews\\1793631357419-d70e1ccab5.request.png",
          "bytes": 43117,
          "width": 960,
          "height": 720,
          "sha256": "eafb5b69e200872cd05af06c5cff775ef7cd33de9272c2d9e754f092bfbb6a6d"
        }
      ]
    },
    {
      "lane": "adaptive_slides",
      "queries": 6,
      "by_tool": {
        "preview": 2,
        "overview": 1,
        "read_many": 1,
        "apply": 1,
        "verify": 1
      },
      "guide_chars": 3274,
      "model_requests": 10,
      "model_tool_calls": 9,
      "seconds": 53.658,
      "read_service_ms": 1.436099992133677,
      "errors": [],
      "item_errors": [],
      "first_input": 24542,
      "last_input": 28959,
      "output_tokens": 1375,
      "image_blocks": 2,
      "preview_files": [
        {
          "file": "variants\\adaptive_slides\\previews\\1793631344938-540e9f3c99.request.png",
          "bytes": 43063,
          "width": 960,
          "height": 720,
          "sha256": "eb875e2b44d82bc37d39950b8e4a0e373b73a37c7e358b2ac6286c20d1f22549"
        },
        {
          "file": "variants\\adaptive_slides\\previews\\1793631366386-92a48852cd.request.png",
          "bytes": 43117,
          "width": 960,
          "height": 720,
          "sha256": "eafb5b69e200872cd05af06c5cff775ef7cd33de9272c2d9e754f092bfbb6a6d"
        }
      ]
    }
  ]
}
```

### 실제 adaptive 조회 인자

```json
[
  {
    "lane": "adaptive_graphic",
    "tool": "overview",
    "args": {
      "query": "Design Exchange"
    },
    "chars": 899
  },
  {
    "lane": "adaptive_model",
    "tool": "read_many",
    "args": {
      "items": [
        {
          "id": "Lamp shade",
          "fields": [
            "dimensions",
            "location",
            "rotation"
          ]
        },
        {
          "id": "Glow panel",
          "fields": [
            "dimensions",
            "location",
            "rotation"
          ]
        }
      ]
    },
    "chars": 214
  },
  {
    "lane": "adaptive_graphic",
    "tool": "read_many",
    "args": {
      "items": [
        {
          "id": "date-a",
          "fields": [
            "text"
          ]
        },
        {
          "id": "cta-a",
          "fields": [
            "fill"
          ]
        }
      ]
    },
    "chars": 91
  },
  {
    "lane": "adaptive_animation",
    "tool": "read_many",
    "args": {
      "items": [
        {
          "id": "Orange bounce ball",
          "fields": [
            "animation"
          ]
        }
      ]
    },
    "chars": 982
  },
  {
    "lane": "adaptive_video",
    "tool": "overview",
    "args": {
      "query": "Thanks for watching",
      "frame_range": [
        61,
        90
      ]
    },
    "chars": 222
  },
  {
    "lane": "adaptive_video",
    "tool": "read_many",
    "args": {
      "items": [
        {
          "id": "Closing caption",
          "fields": [
            "text",
            "frame_start",
            "frame_final_duration"
          ]
        }
      ]
    },
    "chars": 96
  },
  {
    "lane": "adaptive_video",
    "tool": "read_many",
    "args": {
      "items": [
        {
          "id": "Closing caption",
          "fields": [
            "text",
            "frame_start"
          ]
        }
      ]
    },
    "chars": 92
  },
  {
    "lane": "adaptive_slides",
    "tool": "overview",
    "args": {
      "query": "Workshops by quarter"
    },
    "chars": 1874
  },
  {
    "lane": "adaptive_slides",
    "tool": "read_many",
    "args": {
      "items": [
        {
          "id": "workshop-chart",
          "fields": [
            "data-baseline",
            "data-scale",
            "data-unit"
          ]
        },
        {
          "id": "quarter-three",
          "fields": [
            "data-value"
          ]
        },
        {
          "id": "bar-three",
          "fields": [
            "y",
            "height"
          ]
        },
        {
          "id": "value-three",
          "fields": [
            "text",
            "y"
          ]
        }
      ]
    },
    "chars": 216
  }
]
```

### 동결 입력 및 마지막 control verify

```json
{
  "hashes": [
    {
      "path": "seeds\\animation\\main.blend",
      "sha256": "f7750b48cef87e6d70f06d16c2b4b4228063c47326dae1caea4df500514ea3a2",
      "unchanged": true
    },
    {
      "path": "seeds\\animation\\native-baseline.json",
      "sha256": "9bca77994c0c162b4934c14fa97d0a8aa5ef3a8840a0b76da00eb539771b7f1c",
      "unchanged": true
    },
    {
      "path": "seeds\\graphic\\main.svg",
      "sha256": "b6b68fbfae0b5b06801530193c45e76a1fdbc31d118caf102b228dc9c28f548e",
      "unchanged": true
    },
    {
      "path": "seeds\\model\\main.blend",
      "sha256": "59efc1de7428f95184ba60285dd489a8c76a6407a9ab9d2d30b42c481742d1be",
      "unchanged": true
    },
    {
      "path": "seeds\\model\\native-baseline.json",
      "sha256": "24e5565faeff8682b008f7a5bfde4b5b4a31b26a70ef55e874a14efb6106ca4b",
      "unchanged": true
    },
    {
      "path": "seeds\\slides\\main.html",
      "sha256": "38164cba73b461fb1a4a7c0e7213e8fa1859791e7edb1f9e2e12b4b95d976463",
      "unchanged": true
    },
    {
      "path": "seeds\\video\\main.blend",
      "sha256": "44ae35de34d1ef05ecc610368fa671724c35a216db0e3987e809ae51557ee05d",
      "unchanged": true
    },
    {
      "path": "seeds\\video\\native-baseline.json",
      "sha256": "9a89310a6b006667932d505972c63457d17e14b11e93ec864736a5890b7e3fd7",
      "unchanged": true
    },
    {
      "path": "native_media.py",
      "sha256": "ba6aa32355f3c6d65ab990b023e6a54bfe2332c783edefd166f84acef1cfdfe5",
      "unchanged": true
    },
    {
      "path": "document_media.py",
      "sha256": "980da05d45166fb0442797147e900b50eb048439dd52512cdc61c33ce18657d7",
      "unchanged": true
    },
    {
      "path": "worker.py",
      "sha256": "9d42066f5cae1dc84fde39741e249f0e709e80c5685f74a8cc009e3f075dd161",
      "unchanged": true
    },
    {
      "path": "client.cjs",
      "sha256": "e2f36f76732fe67319c6d77ba051ab28b51d12d7f778c13da8b6f00ecd7e229e",
      "unchanged": true
    },
    {
      "path": "guides.py",
      "sha256": "36d04e16670c9a08f44c65af1ae5ca8b6d84d0522fb35306c92a85c1bbeb4117",
      "unchanged": true
    }
  ],
  "checks": [
    {
      "lane": "base_model",
      "result": {
        "passed": true,
        "checks": [
          {
            "check": "Lamp shade width",
            "passed": true
          },
          {
            "check": "Glow panel width",
            "passed": true
          },
          {
            "check": "all remaining baseline state preserved",
            "passed": true
          }
        ],
        "details": "Native current scene/geometry/materials/keyframes/strips compared with seed. Affected Z curve derived handles and evaluated X/Z pose excluded; other channels retained."
      }
    },
    {
      "lane": "base_animation",
      "result": {
        "passed": true,
        "checks": [
          {
            "check": "apex height",
            "passed": true
          },
          {
            "check": "last key delayed",
            "passed": true
          },
          {
            "check": "all remaining baseline state preserved",
            "passed": true
          }
        ],
        "details": "Native current scene/geometry/materials/keyframes/strips compared with seed. Affected Z curve derived handles and evaluated X/Z pose excluded; other channels retained."
      }
    },
    {
      "lane": "base_graphic",
      "result": {
        "passed": true,
        "checks": {
          "date-a.text": true,
          "cta-a.fill": true,
          "all_other_content_preserved": true
        },
        "details": {
          "comparison": "Full XML tree against seed with only requested semantic edits; formatting whitespace ignored.",
          "failed": []
        }
      }
    },
    {
      "lane": "base_video",
      "result": {
        "passed": true,
        "checks": [
          {
            "check": "closing text",
            "passed": true
          },
          {
            "check": "closing timing",
            "passed": true
          },
          {
            "check": "all remaining baseline state preserved",
            "passed": true
          }
        ],
        "details": "Native current scene/geometry/materials/keyframes/strips compared with seed. Affected Z curve derived handles and evaluated X/Z pose excluded; other channels retained."
      }
    },
    {
      "lane": "base_slides",
      "result": {
        "passed": true,
        "checks": {
          "quarter-three.data-value": true,
          "bar-three.height": true,
          "bar-three.y": true,
          "value-three.text": true,
          "value-three.y": true,
          "all_other_content_preserved": true
        },
        "details": {
          "comparison": "Full XML tree against seed with only requested semantic edits; formatting whitespace ignored.",
          "failed": []
        }
      }
    },
    {
      "lane": "adaptive_model",
      "result": {
        "passed": true,
        "checks": [
          {
            "check": "Lamp shade width",
            "passed": true
          },
          {
            "check": "Glow panel width",
            "passed": true
          },
          {
            "check": "all remaining baseline state preserved",
            "passed": true
          }
        ],
        "details": "Native current scene/geometry/materials/keyframes/strips compared with seed. Affected Z curve derived handles and evaluated X/Z pose excluded; other channels retained."
      }
    },
    {
      "lane": "adaptive_animation",
      "result": {
        "passed": true,
        "checks": [
          {
            "check": "apex height",
            "passed": true
          },
          {
            "check": "last key delayed",
            "passed": true
          },
          {
            "check": "all remaining baseline state preserved",
            "passed": true
          }
        ],
        "details": "Native current scene/geometry/materials/keyframes/strips compared with seed. Affected Z curve derived handles and evaluated X/Z pose excluded; other channels retained."
      }
    },
    {
      "lane": "adaptive_graphic",
      "result": {
        "passed": true,
        "checks": {
          "date-a.text": true,
          "cta-a.fill": true,
          "all_other_content_preserved": true
        },
        "details": {
          "comparison": "Full XML tree against seed with only requested semantic edits; formatting whitespace ignored.",
          "failed": []
        }
      }
    },
    {
      "lane": "adaptive_video",
      "result": {
        "passed": true,
        "checks": [
          {
            "check": "closing text",
            "passed": true
          },
          {
            "check": "closing timing",
            "passed": true
          },
          {
            "check": "all remaining baseline state preserved",
            "passed": true
          }
        ],
        "details": "Native current scene/geometry/materials/keyframes/strips compared with seed. Affected Z curve derived handles and evaluated X/Z pose excluded; other channels retained."
      }
    },
    {
      "lane": "adaptive_slides",
      "result": {
        "passed": true,
        "checks": {
          "quarter-three.data-value": true,
          "bar-three.height": true,
          "bar-three.y": true,
          "value-three.text": true,
          "value-three.y": true,
          "all_other_content_preserved": true
        },
        "details": {
          "comparison": "Full XML tree against seed with only requested semantic edits; formatting whitespace ignored.",
          "failed": []
        }
      }
    }
  ]
}
```

### 최종 내보내기 및 종료 증거

```json
{
  "exports": [
    {
      "arm": "base",
      "bytes": 22838,
      "frames": [
        1,
        96
      ],
      "sha256": "4402f82b8d6e267b43a3b0f5276cc892647ef4e62d88ffcec991081efdcd5c51",
      "source_unchanged": true
    },
    {
      "arm": "adaptive",
      "bytes": 22838,
      "frames": [
        1,
        96
      ],
      "sha256": "ba28d48fb991b937f15362133c23d6ed27f6450df0fa3fde112578dc89e701df",
      "source_unchanged": true
    }
  ],
  "mp4": [
    {
      "arm": "base",
      "decoded_frames": 96,
      "frame75_rendered": true
    },
    {
      "arm": "adaptive",
      "decoded_frames": 96,
      "frame75_rendered": true
    }
  ],
  "process_stop": {
    "related": [],
    "checked_at": "2026-11-02T14:57:50.5036776Z",
    "same_identity_survivors": []
  },
  "evidence": [
    {
      "file": "analysis.json",
      "bytes": 35848,
      "sha256": "13eea0e3be9b6cec72eb6cda4d47d6573754bd8f9679b087a0e2e243520296b0"
    },
    {
      "file": "calls.jsonl",
      "bytes": 44585,
      "sha256": "8468af81c14930e7cb003da36d8e45cf23aa574a39e25c9dfc50136b58b45dec"
    },
    {
      "file": "endcheck.json",
      "bytes": 7667,
      "sha256": "660b400327d06fdfefc2f95204a96c760e10fe9ac06feee555b7c515e4d966f3"
    },
    {
      "file": "native-preflight-result.json",
      "bytes": 4887,
      "sha256": "5082e4368821b78ab475230fe89ee3b0dc6000ff5d44ba3c342663619166f2a1"
    },
    {
      "file": "native-preflight.log",
      "bytes": 22974,
      "sha256": "3831987ecd58a3a3aec6203d3cfb3d0fd7c93d80c35e99dad08e9f1be5a5ca35"
    },
    {
      "file": "doc-preflight.log",
      "bytes": 16272,
      "sha256": "d663287ffbf254e651b16f2f6943f9eb87571d519d9fc243cfee2b392dbb8067"
    },
    {
      "file": "frozen-inputs.json",
      "bytes": 1670,
      "sha256": "811cd69607038b7da6d075a0f837e4ea7db1124659673837396854ea9ad0df99"
    },
    {
      "file": "final-export.json",
      "bytes": 316,
      "sha256": "a271c1dc697d0b1a78a01e7b55bfc2a9ab223a51d32e99889e14de37da8f578c"
    },
    {
      "file": "final-export.log",
      "bytes": 21732,
      "sha256": "9dd7d6a66e4cd57d3653827c0117c26e5995d5317e6fd780a52dde75ef00458b"
    },
    {
      "file": "mp4-verify.json",
      "bytes": 134,
      "sha256": "e3716c3a2fd1884df6bf105210e30db1d736326d7b7d56c79d56fdaf18e9d996"
    },
    {
      "file": "mp4-verify.log",
      "bytes": 2740,
      "sha256": "ee3e7fa149f07d22d0c1322adc6e8f0e4877a8b60722cff8a4873854b7aac06a"
    },
    {
      "file": "processes-before-stop.json",
      "bytes": 335,
      "sha256": "05cd5079d40962f06e7ca8743002c0aa55dc056c011f4a29afb89a162722e137"
    },
    {
      "file": "process-stop-verification.json",
      "bytes": 174,
      "sha256": "a0d66db4d6769d586164fa3a9634f2e500e23d591373256f91a656959a6c6fb1"
    }
  ]
}
```
