🗺️ meet_me_in_the_middle (MVP)

브라우저에서 바로 동작하는 중간지점 Top 3 추천 데모

🚀 실행 방법

client/index.html을 브라우저로 엽니다.

Kakao JavaScript 키를 교체하세요.

Kakao Developers 콘솔에서 허용 도메인(origin) 을 등록해야 합니다.

로컬 테스트 시:

http://localhost:3000

http://127.0.0.1:8080

file:// 스킴은 등록할 수 없으므로 반드시 간단한 로컬 서버를 띄워 접속하세요.

기본 포함된 키는 https://hanuseok.github.io에서만 동작합니다.

🌐 GitHub Pages에서 실행하기

HTML 파일을 직접 열면 코드만 표시되므로, Pages 배포를 설정해야 웹에서 바로 실행됩니다.

설정 절차

저장소 → Settings → Pages로 이동

Build and deployment →

Deploy from a branch 선택

Branch: main

Folder: /(root)

Save 클릭

1–2 분 후 아래 주소로 접속

https://<계정>.github.io/<저장소>/client/index.html


예:
https://hanuseok.github.io/meet_me_in_the_middle/client/index.html

URL 공유 시 반드시 /client/index.html까지 포함해야 합니다.
루트(/)에는 index.html이 없어 404 가 표시됩니다.

Pages 실행 시에도 Kakao 앱 키 허용 도메인에
예: https://hanuseok.github.io 를 추가해야 합니다.

소유자가 배포한 주소가 있다면 그대로 접속하거나,
포크/사본을 배포하려면 본인 저장소에서 Pages를 활성화하고 앱 키를 교체하세요.

🧭 사용 방법

참여자 2명의 장소를 입력

“중간지점 → Top 3” 버튼 클릭

초기 화면: 전체 Top 3

탭으로 맛집 / 술집 / 카페 / 놀거리 Top 3 필터 가능

🛠️ 다음 단계 (확장 계획)

ETA/교통 반영: server/routing → time_sum / minimax 확장

품질/예약/혼잡도: server/integration 보강

하드 필터 / 슬라이더: client/filters-ui 연결

실시간 투표 / 위치 공유: client/realtime-sdk + server/realtime
