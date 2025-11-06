# meet_me_in_the_middle (MVP)
브라우저에서 바로 동작하는 중간지점 Top3 추천 데모.

## 실행
- `client/index.html` 을 브라우저로 열고, Kakao JS 키를 교체하세요.
- Kakao Developers 콘솔에서 **자신의 앱 키에 허용 도메인(origin)을 추가**해야 합니다.
  - 예: 로컬 테스트 시 `http://localhost:3000`, `http://127.0.0.1:8080` 등을 플랫폼 → 웹 도메인으로 등록
  - `file://` 스킴은 등록할 수 없으므로, 반드시 간단한 로컬 서버를 띄워 접속하세요.
  - 기본으로 포함된 키는 `https://hanuseok.github.io`에서만 동작합니다.

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
- 참여자 2명의 장소를 입력 → "중간지점→Top3" 클릭.
- 초기 화면: 전체 Top3, 탭으로 맛집/술집/카페/놀거리 Top3 필터.

## 다음 단계
- ETA/교통 반영: server/routing 를 만들어 time_sum/minimax 확장
- 품질/예약/혼잡: server/integration 으로 보강
- 하드필터/슬라이더: client/filters-ui 연결
- 실시간 투표/위치: client/realtime-sdk + server/realtime
