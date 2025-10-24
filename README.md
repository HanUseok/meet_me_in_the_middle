# meet_me_in_the_middle (MVP)
브라우저에서 바로 동작하는 중간지점 Top3 추천 데모.

## 실행
- `client/index.html` 을 브라우저로 열고, Kakao JS 키를 교체하세요.
- 참여자 2명의 장소를 입력 → "중간지점→Top3" 클릭.
- 초기 화면: 전체 Top3, 탭으로 맛집/술집/카페/놀거리 Top3 필터.

## 다음 단계
- ETA/교통 반영: server/routing 를 만들어 time_sum/minimax 확장
- 품질/예약/혼잡: server/integration 으로 보강
- 하드필터/슬라이더: client/filters-ui 연결
- 실시간 투표/위치: client/realtime-sdk + server/realtime
