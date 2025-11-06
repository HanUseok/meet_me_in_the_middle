# meet_me_in_the_middle (MVP)
브라우저에서 바로 동작하는 중간지점 Top3 추천 데모.

## 실행

### 로컬 개발 환경
1. **의존성 설치**:
   ```bash
   npm install
   ```
2. **환경 변수 설정**:
   - `env.template` 파일을 `.env`로 복사하고 API 키를 설정하세요:
   ```bash
   # Windows
   copy env.template .env
   
   # Linux/Mac
   cp env.template .env
   ```
   - `.env` 파일에 다음 키들을 설정하세요:
   ```env
   TMAP_APP_KEY=your_tmap_api_key
   KAKAO_APP_KEY=your_kakao_api_key
   ```
   - API 키 발급:
     - **TMAP API**: [SK Open API Platform](https://openapi.sk.com/)
     - **Kakao API**: [Kakao Developers](https://developers.kakao.com/)
3. **서버 실행**:
   ```powershell
   # 방법 1: start.ps1 스크립트 사용 (두 서버 자동 시작)
   .\start.ps1
   
   # 방법 2: 수동 실행
   # 터미널 1: API 서버 (포트 3000)
   node server/index.js
   
   # 터미널 2: 프론트엔드 서버 (포트 8080)
   powershell -ExecutionPolicy Bypass -File serve.ps1
   ```
4. **브라우저 접속**: `http://localhost:8080`
5. **Kakao Developers 콘솔** 설정:
   - 자신의 앱 키에 허용 도메인을 추가하세요:
     - `http://localhost:8080`, `http://127.0.0.1:8080`
   - 플랫폼 설정에서 Web 플랫폼 등록 필요
   - 카카오맵 API 사용을 위해 JavaScript 키 사용

### GitHub Pages에서 열기
- GitHub 저장소에서 HTML 파일을 직접 열면 **코드만 표시**되고 실행되지 않습니다.
- Pages를 켜면 GitHub가 정적 호스팅을 제공하므로, 업로드한 HTML을 곧바로 웹 페이지처럼 볼 수 있습니다.
- **설정 절차**
  1. 저장소 → **Settings → Pages**로 이동합니다.
  2. "Build and deployment"에서 **Deploy from a branch**를 고르고, Branch는 `main`, Folder는 `/ (root)`로 지정한 뒤 **Save**를 누릅니다.
  3. 1~2분 뒤 `https://<계정>.github.io/<저장소>/client/index.html` 주소로 접속하면 브라우저에서 바로 실행됩니다.
     - 예: 원본 저장소는 `https://hanuseok.github.io/meet_me_in_the_middle/client/index.html`
  4. URL을 공유할 때는 `client/index.html`까지 붙여야 중간지점 데모가 열립니다. 루트(`/`)에는 index.html이 없어 404가 표시됩니다.
- Pages에서 실행할 때도 Kakao 앱 키의 허용 도메인에 Pages 주소(예: `https://hanuseok.github.io`)를 등록해야 합니다.
- 소유자가 배포한 주소가 있다면 그대로 접속하거나, 포크/사본을 배포하려면 본인 저장소에서 Pages를 켜고 앱 키를 교체하세요.
- 참여자 2명의 장소를 입력 → "중간지점→지역 Top3" 클릭.
- 초기 화면: 추천 지역 Top3가 지도에 표시됨
- 지도에서 Top 1/2/3 마커 클릭 → 경로 선택 (자가용/도보)
- "뭐 할지 찾기" 버튼 → 추천코스 팝업 (맛집/술집/카페/놀거리 필터)

## 다음 단계
- ETA/교통 반영: server/routing 를 만들어 time_sum/minimax 확장
- 품질/예약/혼잡: server/integration 으로 보강
- 하드필터/슬라이더: client/filters-ui 연결
- 실시간 투표/위치: client/realtime-sdk + server/realtime



## 프로젝트 구조

```
meet_me_in_the_middle-main/
├── client/                    # 프론트엔드 코드
│   ├── index.html            # 메인 HTML (카카오 SDK 동적 로딩)
│   ├── session-ui/           # 세션 UI 모듈
│   │   ├── app.js           # 메인 앱 로직
│   │   └── core/            # 핵심 로직 (SDK 독립적)
│   │       ├── center.js    # 중간지점 계산
│   │       └── rank.js      # 스코어링 및 랭킹
│   └── realtime-sdk/        # 실시간 SDK (향후 구현)
├── server/                   # 백엔드 서버
│   └── index.js             # Express 서버 (TMAP 프록시, API 키 제공)
├── data/                     # 데이터 파일
├── docs/                     # 문서
├── .env                      # 환경 변수 (gitignore됨)
├── env.template             # 환경 변수 템플릿
├── start.ps1                # 서버 시작 스크립트 (Windows)
├── serve.ps1                # 프론트엔드 서버 (PowerShell)
└── package.json             # 의존성 관리
```

### 주요 파일 역할

#### 프론트엔드
- **client/index.html**: 메인 HTML 파일. 카카오 SDK를 서버에서 받은 API 키로 동적 로딩.
- **client/session-ui/app.js**: 
  - 앱 전체 흐름과 상태 관리
  - Kakao 지도/장소 API 연동
  - 중간지점 산출 → 주변 인기지역 탐색
  - 카테고리별/지역별 Top3 생성
  - 경로 표시 및 마커 관리
  - 추천코스 팝업 관리
- **client/session-ui/core/center.js**: 
  - 좌표 집합의 중간지점 계산 (산술평균)
  - K-means로 지역 클러스터링
- **client/session-ui/core/rank.js**: 
  - Haversine 거리 계산
  - 후보지 스코어링 (거리합 + 최대거리 가중)
  - 지역 라벨 추출
  - 지역/카테고리별 Top-N 랭킹 생성

#### 백엔드
- **server/index.js**: 
  - Express 서버
  - TMAP API 프록시 (API 키 보안)
  - 카카오 API 키 제공 엔드포인트 (`/api/config`)
  - 경로 계산 API (`/api/route`)

### 주요 기능

#### 1. 중간지점 계산 및 지역 추천
- 참여자들의 위치 입력 (주소 검색 또는 현재 위치)
- 중간지점 자동 계산
- 중간지점 주변 인기 지역 Top3 추천
- 각 지역별 거리 및 예상 시간 표시

#### 2. 경로 표시
- 추천 지역 선택 시 경로 선택 (자가용/도보)
- TMAP API를 통한 실제 경로 계산 및 표시
- 경로 정보 (거리, 소요 시간) 표시
- 선택한 지역의 마커는 "뭐 할지 찾기" 버튼으로 전환

#### 3. 추천코스 탐색
- "뭐 할지 찾기" 버튼 클릭
- 카테고리별 필터 (전체/맛집/술집/카페/놀거리)
- 각 장소별 상세 정보 및 카카오맵 링크 제공
- 장소별 거리 기반 스코어링

### 로직 흐름 요약
1. 참여자 주소 입력 → 좌표화 (Kakao 역지오코딩)
2. 중간지점 계산 (`core/center.js` - 산술평균)
3. 중심 주변 인기 지역 탐색 (`core/center.js`)
4. 후보지 스코어링 및 지역 Top3 선정 (`core/rank.js`)
5. 지도에 마커 표시 및 경로 계산 (`app.js`)
6. 추천코스 탐색 (카테고리별 필터링)

### API 엔드포인트

#### 서버 (포트 3000)
- `GET /health`: 서버 상태 확인
- `GET /api/config`: 카카오 API 키 제공 (클라이언트용)
- `POST /api/route`: 경로 계산 (TMAP API 프록시)
  - Request: `{ mode: 'car'|'walk'|'transit', origin: {lat, lng}, destination: {lat, lng} }`
  - Response: `{ mode, summary: {distance_m, duration_s}, polyline: [[lat, lng], ...] }`

### 기술 스택
- **프론트엔드**: Vanilla JavaScript (ES6+), Kakao Maps API
- **백엔드**: Node.js, Express
- **지도 서비스**: Kakao Maps (장소 검색, 지도 표시)
- **경로 서비스**: TMAP API (자동차/도보/대중교통 경로)