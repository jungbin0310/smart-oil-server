# Smart Oil API 명세서 (Client Integration Guide)

> **Base URL**
> - 로컬 개발: `http://localhost:3000`
> - 운영(Railway): `https://<your-railway-domain>`

---

## 1. 공통 규칙

### 요청 헤더
- `Content-Type: application/json`
- 인증이 필요한 API는 아래 헤더를 포함해야 합니다.
  ```http
  Authorization: Bearer <accessToken>
  ```

### 공통 응답 형식
- **성공**
  ```json
  {
    "success": true,
    "data": { ... },
    "meta": { ... }
  }
  ```
- **실패**
  ```json
  {
    "success": false,
    "error": {
      "code": "ERROR_CODE",
      "message": "사람이 읽을 수 있는 오류 메시지"
    }
  }
  ```

### 공통 Enum 값
| 항목 | 허용 값 | 설명 |
| --- | --- | --- |
| `fuelType` | `GASOLINE`, `DIESEL`, `LPG` | 유종 (`PREMIUM_GASOLINE`은 수집 제외) |
| `inputType` | `FIXED_AMOUNT`, `FIXED_LITER` | 금액 기준 / 리터 기준 주유 입력 방식 |
| `searchMode` | `ROUTE`, `RADIUS` | 경로상 탐색 / 현위치 반경 3km 탐색 |
| `roadTypeHint` | `CITY`, `NATIONAL`, `HIGHWAY` | 시내(기본) / 국도 / 고속도로 |
| `brand` | `SKE`, `GSC`, `HDO`, `SOL`, `RTO`, `RTX`, `NHO`, `ETC`, `E1G`, `SKG` | 오피넷 주유소 상표 코드 |

---

## 2. 엔드포인트 상세

### 2.1 헬스체크
- **`GET /health`**
- 인증: 불필요
- **응답 (`200 OK`)**
  ```json
  { "status": "OK" }
  ```

---

### 2.2 카카오 로그인 (JWT 발급)
- **`POST /api/v1/auth/kakao`**
- 인증: 불필요
- 설명:
  - 개발/테스트 시 `kakaoAccessToken`에 `"DEV_TEST_TOKEN"`을 전달하면 테스트 유저(`kakao_id: "test_user_1"`, `nickname: "류태현"`)로 즉시 로그인됩니다.
  - 실제 카카오 SDK 액세스 토큰을 전달하면 카카오 서버(`v2/user/me`)로 검증 후 유저를 Upsert하고 JWT(유효기간 30일)를 발급합니다.
- **요청 Body**
  ```json
  {
    "kakaoAccessToken": "DEV_TEST_TOKEN"
  }
  ```
- **응답 (`200 OK`)**
  ```json
  {
    "success": true,
    "data": {
      "accessToken": "eyJhbGciOiJIUzI1NiIs...",
      "user": {
        "userId": 1,
        "kakaoId": "test_user_1",
        "nickname": "류태현"
      }
    }
  }
  ```

---

### 2.3 전체 할인카드 마스터 목록 조회
- **`GET /api/v1/master/cards`**
- 인증: 불필요
- 설명: 사용자가 온보딩/설정 화면에서 선택할 수 있는 전체 제휴 할인카드 목록을 반환합니다.
- **응답 (`200 OK`)**
  ```json
  {
    "success": true,
    "data": {
      "cards": [
        {
          "cardId": 1,
          "cardName": "신한 Deep Oil (SK에너지)",
          "targetBrands": ["SKE"],
          "discountType": "PER_LITER",
          "discountValue": 100,
          "maxDiscountLimit": 5000
        }
      ]
    },
    "meta": {
      "totalCount": 1
    }
  }
  ```
  - `discountType`: `PER_LITER` (리터당 원 할인), `PERCENT` (결제액 % 할인), `FLAT` (정액 원 할인)

---

### 2.4 내 차량 및 할인카드 프로필 조회
- **`GET /api/v1/users/profile`**
- 인증: **필수** (`Bearer <accessToken>`)
- 설명: 저장된 차량/주유 설정과 보유 할인카드 목록을 반환합니다. 미등록 시 기본값이 반환됩니다.
- **응답 (`200 OK`)**
  ```json
  {
    "success": true,
    "data": {
      "userId": 1,
      "fuelType": "GASOLINE",
      "officialEfficiency": 13.0,
      "customEfficiency": 14.2,
      "appliedEfficiency": 14.2,
      "recordCount": 3,
      "inputType": "FIXED_AMOUNT",
      "defaultAmountMoney": 50000,
      "defaultAmountLiter": 30,
      "ownedCardIds": [1, 3],
      "ownedCards": [
        {
          "cardId": 1,
          "cardName": "신한 Deep Oil (SK에너지)",
          "targetBrands": ["SKE"],
          "discountType": "PER_LITER",
          "discountValue": 100,
          "maxDiscountLimit": 5000
        }
      ]
    }
  }
  ```

---

### 2.5 내 차량 및 할인카드 프로필 저장/수정
- **`PUT /api/v1/users/profile`**
- 인증: **필수** (`Bearer <accessToken>`)
- 설명: 전달된 필드만 선택적으로 업데이트하며, `ownedCardIds`를 전달하면 기존 보유 카드 목록을 교체합니다.
- **요청 Body** (모든 필드 선택 가능)
  ```json
  {
    "fuelType": "GASOLINE",
    "officialEfficiency": 14.5,
    "inputType": "FIXED_AMOUNT",
    "defaultAmountMoney": 50000,
    "defaultAmountLiter": 30,
    "ownedCardIds": [1, 3]
  }
  ```
- **응답 (`200 OK`)**: `GET /api/v1/users/profile`과 동일한 구조로 갱신된 프로필 반환.

---

### 2.6 주유 기록 등록 및 연비 보정
- **`POST /api/v1/records`**
- 인증: **필수** (`Bearer <accessToken>`)
- 설명: 주행거리(`drivenDistanceKm`)와 주유량(`fueledLiter`)으로 1회 주행 연비를 계산하고, 최근 5회 가중 이동평균 수식으로 `custom_efficiency`와 `record_count`를 업데이트합니다.
- **요청 Body**
  ```json
  {
    "drivenDistanceKm": 420.5,
    "fueledLiter": 30.0
  }
  ```
- **응답 (`200 OK`)**
  ```json
  {
    "success": true,
    "data": {
      "singleTripEfficiency": 14.02,
      "customEfficiency": 14.02,
      "recordCount": 1
    }
  }
  ```

---

### 2.7 실주유비/주유량 최적 주유소 추천 (핵심 API)
- **`POST /api/v1/stations/recommend`**
- 인증: **선택** (토큰이 없으면 비회원 게스트 기본값 `GASOLINE`, 연비 `13.0`, `FIXED_AMOUNT`, `50,000원`, 보유 카드 없음으로 자동 계산)
- **요청 Body**
  ```json
  {
    "origin": { "lat": 37.3948, "lng": 127.1112 },
    "destination": { "lat": 37.5088, "lng": 127.0473 },
    "searchMode": "ROUTE",
    "roadTypeHint": "CITY"
  }
  ```
  - `origin` (또는 `currentLocation`): **필수** (`{ lat, lng }`)
  - `destination`: 경로 탐색 시 필수. 생략하거나 `searchMode: "RADIUS"`로 호출하면 현위치 반경 3km 탐색 모드로 동작합니다.
  - 선택적 임시 오버라이드 필드: `fuelType`, `inputType`, `defaultAmountMoney`, `defaultAmountLiter`, `appliedEfficiency` (미전달 시 로그인 유저의 DB 프로필 또는 비회원 기본값 사용)

- **정렬 및 추천 기준**
  - **`FIXED_LITER` (주유량 입력 모드)**: `costBreakdown.finalTotalCost`(최종 실주유비 = 기본 주유비 + 우회 추가 이동비 - 카드 할인액) **오름차순** 1~5순위
  - **`FIXED_AMOUNT` (주유 금액 입력 모드)**: `netSecuredLiter`(순수 확보 주유량 = `(입력금액 - 우회 추가 이동비 + 카드 할인액) / 단가`) **내림차순** 1~5순위

- **응답 (`200 OK`)**
  ```json
  {
    "success": true,
    "data": {
      "searchMode": "ROUTE",
      "appliedRoadType": "CITY",
      "fuelType": "GASOLINE",
      "inputType": "FIXED_AMOUNT",
      "appliedEfficiency": 13.0,
      "topRecommendation": {
        "rank": 1,
        "stationId": "A0001234",
        "name": "판교셀프주유소",
        "brand": "SKE",
        "brandName": "SK에너지",
        "roadType": "CITY",
        "location": { "lat": 37.4012, "lng": 127.1085 },
        "unitPrice": 1625,
        "expectedFuelLiter": 30.77,
        "netSecuredLiter": 32.51,
        "detourDistanceMeter": 650,
        "detourDurationSec": 95,
        "appliedCardName": "신한 Deep Oil (SK에너지)",
        "costBreakdown": {
          "baseFuelCost": 50000,
          "detourExtraCost": 81,
          "cardDiscountAmount": 3000,
          "finalTotalCost": 47000
        }
      },
      "alternatives": [
        {
          "rank": 2,
          "...": "2~5순위 주유소 객체 (topRecommendation과 동일 스키마)"
        }
      ]
    },
    "meta": {
      "isFallbackApplied": false,
      "candidateCount": 5
    }
  }
  ```
  - `meta.isFallbackApplied`: 카카오모빌리티 API 키 미설정/타임아웃(800ms 초과)/오류로 인해 직선거리 × 굴곡도 계수 기반 Fallback 우회거리가 적용된 경우 `true`로 반환됩니다.

---

### 2.8 관리자 수동 오피넷 동기화 (내부 운영용)
- **`GET /api/v1/admin/sync?key=<ADMIN_KEY>&fuel=all`**
- `fuel` 파라미터: `all` (기본값, 3대 유종 전체), `B027` (휘발유), `D047` (경유), `K015` (LPG)
- 정기 자동 수집은 매일 한국 시간(Asia/Seoul) `06:00` 정각에 하루 1회 자동 실행됩니다.
