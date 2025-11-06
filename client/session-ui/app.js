import { geometricCenter, clusterAreas } from './core/center.js';
import { categorizeAndRank, createAreaRanks, scorePlace } from './core/rank.js';

function initUI(){
  const $ = s=>document.querySelector(s);
  const status = t=>($('#status').textContent=t);
  const toast = (msg)=>{ const el=$('#toast'); if(!el) return; el.textContent=msg; el.style.display='block'; clearTimeout(el._t); el._t=setTimeout(()=>{ el.style.display='none' }, 1600) };
  const debounce=(fn,ms=250)=>{ let h; return (...a)=>{ clearTimeout(h); h=setTimeout(()=>fn(...a),ms) } };

  const sheet = $('#sheet');
  const sheetHeader = $('#sheetHeader');
  const top3Popup = $('#top3-popup');
  const top3Title = top3Popup.querySelector('.popup-title');
  const top3List = top3Popup.querySelector('.popup-list');
  const top3Close = top3Popup.querySelector('.popup-close');
  const top3Content = top3Popup.querySelector('.popup-content');
  const legend = $('#legend');

  const getPeek = ()=>parseInt(getComputedStyle(document.documentElement).getPropertyValue('--peek')) || 76;

  let originMarker=null, cache=null, areaMarkers=[], participantsMarkers=[], polylines=[], centerCircle=null, centerBtnOverlay=null, routeStartMarker=null, routeEndMarker=null;
  let myLocationMarker=null; // 참여자1 임시 표시용 아이콘
  let myLocationMarker2=null; // 참여자2 임시 표시용 아이콘
  let sheetOpen=false;
  let isSearching=false;
  const dragState={
    active:false,
    startY:0,
    startOffset:0,
    currentOffset:0,
    maxOffset:0,
    moved:false,
    pointerId:null,
    type:null
  };
  let lastPopup=null;
  
  // 이전에 선택해서 숨겼던 지역 마커 좌표를 보관 (다른 지역 선택 시 복원)
  let lastSelectedAreaPoint=null; // { lat, lng }
  
  // 코스 장바구니 상태 관리
  let courseCart = []; // 담긴 장소 목록 (중복 방지: id 기준)
  let coursePreviewOverlays = []; // 코스 미리보기 오버레이 (폴리라인/마커)
  let confirmedCourse = null; // 확정된 코스
  let recommendedCourses = []; // 생성된 추천 코스 3개
  let courseOverlays = []; // 지도에 표시된 코스 오버레이들 (폴리라인, 마커, 라벨)
  let currentEditingCourse = null; // 편집 중인 코스

  // 경로 폴리라인/오버레이/인포윈도우 등 UI 잔여물 정리
  function clearRouteArtifacts(){
    try {
      // 폴리라인 제거
      if(Array.isArray(polylines)){
        polylines.forEach(p=>{ try{ p&&p.setMap&&p.setMap(null) }catch(_){} });
        polylines = [];
      }
      // 시작/끝 마커 제거(사용 안 해도 안전차원)
      if(routeStartMarker && routeStartMarker.setMap){ try{ routeStartMarker.setMap(null) }catch(_){} }
      if(routeEndMarker && routeEndMarker.setMap){ try{ routeEndMarker.setMap(null) }catch(_){} }
      routeStartMarker = null;
      routeEndMarker = null;
      // 목적지 인포윈도우 닫기
      if(window.currentInfoWindow && window.currentInfoWindow.close){
        try{ window.currentInfoWindow.close() }catch(_){}
        window.currentInfoWindow = null;
      }
      // 액션 오버레이 제거
      if(window.actionOverlay && window.actionOverlay.setMap){
        try{ window.actionOverlay.setMap(null) }catch(_){}
        window.actionOverlay = null;
      }
      // 코스 오버레이 제거 (코스 수정하기 버튼 포함)
      clearAllCourseOverlays();
      recommendedCourses = [];
      
      // 코스 편집 패널 제거
      const editPanel = $('#course-edit-panel');
      if(editPanel) editPanel.remove();
      currentEditingCourse = null;
      
      // 코스 장바구니 초기화
      courseCart = [];
      const cartPanel = $('#course-cart-panel');
      if(cartPanel) cartPanel.style.display = 'none';
      
      // 이전에 숨긴 Top 마커 좌표 초기화(새 검색에서는 복원 불필요)
      lastSelectedAreaPoint = null;
    } catch(_) {}
  }

  function resetDragState(){
    dragState.active=false;
    dragState.startY=0;
    dragState.startOffset=0;
    dragState.currentOffset=0;
    dragState.maxOffset=0;
    dragState.moved=false;
    dragState.pointerId=null;
    dragState.type=null;
  }

  function getCollapsedOffset(){
    const rect=sheet.getBoundingClientRect();
    return Math.max(0, rect.height - getPeek());
  }

  function setSheetState(open){
    const collapsedOffset=getCollapsedOffset();
    const canCollapse=collapsedOffset>16;
    const nextOpen = canCollapse ? open : true;
    sheetOpen=nextOpen;
    sheet.classList.toggle('open', nextOpen);
    sheet.classList.toggle('collapsed', !nextOpen && canCollapse);
    sheet.setAttribute('aria-expanded', String(nextOpen));
    sheetHeader.setAttribute('aria-expanded', String(nextOpen));
    if(!dragState.active){
      sheet.classList.remove('dragging');
      sheet.style.removeProperty('--sheet-offset');
    }
    try{ localStorage.setItem('sheetOpen', String(nextOpen)); }catch(_){/* ignore */}
  }

  function collapseSheet(){ setSheetState(false); }
  function expandSheet(){ setSheetState(true); }

  function hideTop3Popup(){
    // 포커스 가능한 요소들의 포커스 제거 및 탭 인덱스 비활성화
    const focusableElements = top3Popup.querySelectorAll('button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    focusableElements.forEach(el => {
      if (document.activeElement === el) {
        el.blur(); // 현재 포커스를 제거
      }
      el.setAttribute('tabindex', '-1'); // 포커스 방지
    });
    
    top3Popup.classList.add('hidden');
    top3Popup.setAttribute('aria-hidden', 'true');
    top3List.innerHTML='';
    const routeTabs = $('#route-mode-tabs');
    if(routeTabs) routeTabs.style.display='none';
    
    // 코스 결과 섹션 숨기기
    const courseResultsSection = $('#course-results-section');
    if(courseResultsSection) courseResultsSection.style.display = 'none';
    
    // 코스 미리보기 제거 (팝업 닫을 때)
    clearCoursePreview();
    
    // FAB는 유지 (다시 확인 가능)
  }

  function getCategoryIcon(cat){
    const map={
      area:'📍',
      all:'📍',
      food:'🍽️',
      pub:'🍻',
      cafe:'☕',
      play:'🎉',
      etc:'⭐'
    };
    if(!cat) return map.area;
    return map[cat] || map.etc;
  }

  function showRouteModeTabs(area, initialMode='자가용'){
    const routeTabs = $('#route-mode-tabs');
    if(!routeTabs) return;
    // 카테고리 세그먼트 탭 숨김 (areaCourses에서 넘어올 때 남아있는 문제 해결)
    const popupTabs = $('#popup-tabs');
    if(popupTabs) popupTabs.style.display='none';
    
    // Top3 리스트 숨기고 경로 목록만 표시
    top3List.innerHTML='';
    
    const modes = [
      {key:'drive', label:'자가용', icon:'🚗'},
      {key:'walk', label:'도보', icon:'🚶'}
      // 대중교통 모드는 현재 버전에서 제외됨
    ];
    
    // 각 모드별로 경로 정보 카드 생성
    modes.forEach((mode, idx)=>{
      const routeCard = document.createElement('div');
      routeCard.className='popup-card';
      routeCard.style.cssText='cursor:pointer;transition:transform 0.2s';
      routeCard.addEventListener('mouseenter',()=>routeCard.style.transform='translateY(-2px)');
      routeCard.addEventListener('mouseleave',()=>routeCard.style.transform='');
      
      const header = document.createElement('div');
      header.className='popup-card-header';
      header.innerHTML=`${mode.icon} <span class="popup-name">${mode.label}</span>`;
      routeCard.appendChild(header);
      
      const meta = document.createElement('div');
      meta.className='popup-meta';
      meta.innerHTML='<span style="color:#888;font-size:12px">탭하면 지도에 경로가 표시됩니다</span>';
      routeCard.appendChild(meta);
      
      routeCard.addEventListener('click', async ()=>{
        routeTabs.querySelectorAll('.popup-card').forEach(c=>c.style.border='1px solid #e1e5f2');
        routeCard.style.border='2px solid #007AFF';
        // 모드 클릭 시 팝업 닫기
        hideTop3Popup();
        await calculateRoute(area, mode.key);
      });
      
      top3List.appendChild(routeCard);
    });
    
    // 대중교통 모드 카드 추가 (비활성화 상태로)
    const transitCard = document.createElement('div');
    transitCard.className='popup-card';
    transitCard.style.cssText='cursor:not-allowed;opacity:0.6;position:relative';
    transitCard.addEventListener('click', ()=>{
      toast('대중교통 경로는 현재 버전에서는 사용할 수 없습니다.');
      alert('대중교통 경로는 현재 버전에서는 사용할 수 없습니다.');
    });
    
    const transitHeader = document.createElement('div');
    transitHeader.className='popup-card-header';
    transitHeader.innerHTML='🚇 <span class="popup-name">대중교통</span>';
    transitCard.appendChild(transitHeader);
    
    const transitMeta = document.createElement('div');
    transitMeta.className='popup-meta';
    transitMeta.innerHTML='<span style="color:#888;font-size:12px">현재 버전에서 사용 불가</span>';
    transitCard.appendChild(transitMeta);
    
    top3List.appendChild(transitCard);
    
    routeTabs.style.display='flex';
  }

  function generateKakaoMapLink(area, modeKey='car'){
    const lat = area.y ? parseFloat(area.y) : area.lat;
    const lng = area.x ? parseFloat(area.x) : area.lng;
    const areaName = (area.place_name || area.name || '').replace(/\s+/g, '');
    
    // 모드에 따른 이동수단 매핑
    const modeMap = {
      'drive': 'car',
      'walk': 'walk',
      'transit': 'traffic',
      'car': 'car'
    };
    const moveType = modeMap[modeKey] || 'car';
    
    if(!cache || !cache.participants || !cache.participants.length){
      // 출발지 없는 경우
      return `https://map.kakao.com/link/to/${encodeURIComponent(areaName)},${lat},${lng}`;
    }
    
    // 첫 번째 참여자를 출발지로 사용
    const origin = cache.participants[0];
    const originName = '출발지'; // 참여자 이름이 있으면 사용
    
    // 카카오맵 길찾기 URL 생성
    return `https://map.kakao.com/link/by/${moveType}/${encodeURIComponent(originName)},${origin.lat},${origin.lng}/${encodeURIComponent(areaName)},${lat},${lng}`;
  }

  // TMAP 경로 계산 (mock 데이터 - 서버 구현 전 임시)
  function calculateMockRoute(origin, dest, modeKey){
    const colors = {
      'drive': '#007AFF',
      'transit': '#34C759',
      'walk': '#FF9500'
    };
    
    // 직선 경로에 약간의 곡선 추가
    const steps = 50;
    const path = [];
    for(let i=0; i<=steps; i++){
      const ratio = i/steps;
      const lat = origin.lat + (dest.lat - origin.lat) * ratio;
      const lng = origin.lng + (dest.lng - origin.lng) * ratio;
      path.push(new kakao.maps.LatLng(lat, lng));
    }
    
    const polyline = new kakao.maps.Polyline({
      path: path,
      strokeColor: colors[modeKey] || '#007AFF',
      strokeOpacity: 0.7,
      strokeWeight: 5,
      strokeStyle: modeKey === 'transit' ? 'shortdash' : 'solid'
    });
    
    polyline.setMap(map);
    polylines.push(polyline);
    
    // 거리와 시간 계산 (하버사인 기반)
    const haversine = (a, b) => {
      const R = 6371000, toRad = x => x * Math.PI / 180;
      const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
      const s1 = Math.sin(dLat/2)**2;
      const s2 = Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng/2)**2;
      return 2 * R * Math.asin(Math.sqrt(s1 + s2));
    };
    const dist = haversine(origin, dest);
    
    // 모드별 평균 속도 (m/s)
    const speedMap = { drive: 13.9, transit: 5.6, walk: 1.2 };
    const speed = speedMap[modeKey] || 1.2;
    const duration = Math.round(dist / speed);
    
    return { distance: dist, duration };
  }

  // 기존 마커 및 오버레이 정리 함수
  function clearAreaMarkersAndOverlays(){
    areaMarkers.forEach(m=>{
      if(m && m.setMap) m.setMap(null);
    });
    areaMarkers = [];
    
    if(centerBtnOverlay) {
      centerBtnOverlay.setMap(null);
      centerBtnOverlay = null;
    }
    if(centerCircle) {
      centerCircle.setMap(null);
      centerCircle = null;
    }
    if(originMarker) {
      originMarker.setMap(null);
      originMarker = null;
    }
  }
  
  // TOP3 마커 및 관련 UI 숨기기 (코스 적용 시)
  function hideTop3MarkersAndUI(){
    // TOP3 지역 마커 제거
    areaMarkers.forEach(m => {
      if(m && m.setMap) m.setMap(null);
    });
    areaMarkers = [];
    
    // 경로 폴리라인 제거 (빨간 줄)
    polylines.forEach(p => {
      if(p && p.setMap) p.setMap(null);
    });
    polylines = [];
    
    // 참여자 마커 제거 (내 위치 아이콘)
    participantsMarkers.forEach(m => {
      if(m && m.setMap) m.setMap(null);
    });
    participantsMarkers = [];
    
    // 임시 위치 마커 제거
    if(myLocationMarker) {
      myLocationMarker.setMap(null);
      myLocationMarker = null;
    }
    if(myLocationMarker2) {
      myLocationMarker2.setMap(null);
      myLocationMarker2 = null;
    }
    
    // 중간지점 버튼 및 동그란 원형 마커 제거
    if(centerBtnOverlay) {
      centerBtnOverlay.setMap(null);
      centerBtnOverlay = null;
    }
    if(centerCircle) {
      centerCircle.setMap(null);
      centerCircle = null;
    }
    
    // 중간지점 마커(과녁 아이콘) 제거
    if(originMarker) {
      originMarker.setMap(null);
      originMarker = null;
    }
    
    // "뭐할지 찾기" 버튼 제거
    if(window.actionOverlay) {
      window.actionOverlay.setMap(null);
      window.actionOverlay = null;
    }
    
    // 레전드 숨기기 (Top 1, 2, 3 표시)
    if(legend) {
      legend.style.display = 'none';
    }
    
    // TOP3 보기 버튼 숨기기 (results 섹션의 "팝업 다시보기" 버튼 등)
    const results = $('#results');
    if(results){
      const replayButtons = results.querySelectorAll('.btn-inline, button[class*="top3"], button[class*="replay"]');
      replayButtons.forEach(btn => {
        const card = btn.closest('.card');
        if(card && card.classList.contains('card-hint')){
          card.style.display = 'none';
        }
      });
    }
    
    console.log('✅ TOP3 마커 및 UI 숨김 완료');
  }

  async function calculateRoute(area, modeKey){
    console.log('calculateRoute 호출:', area, modeKey, 'map:', typeof map);
    
    // 이전 경로 정리
    polylines.forEach(p => {
      if(p && p.setMap) p.setMap(null);
    });
    polylines = [];
    if(routeStartMarker) {
      routeStartMarker.setMap(null);
      routeStartMarker = null;
    }
    if(routeEndMarker) {
      routeEndMarker.setMap(null);
      routeEndMarker = null;
    }
    
    if(!cache || !cache.participants || !cache.participants.length){
      console.log('참여자 없음, 종료');
      return;
    }
    if(!map){
      console.error('map 초기화 안 됨!');
      status('지도를 초기화 중입니다...');
      return;
    }
    
    // 이전 경로 제거
    polylines.forEach(p=>p.setMap(null));
    polylines=[];
    
    const destLat = area.y ? parseFloat(area.y) : area.lat;
    const destLng = area.x ? parseFloat(area.x) : area.lng;
    const dest = { lat: destLat, lng: destLng };
    
    const modeNames = { drive:'자가용', walk:'도보', transit:'대중교통' };
    const modeName = modeNames[modeKey] || '자가용';
    
    status(`🗺️ ${area.name} 경로 계산 중... (${modeName})`);
    
    try{
      const origin = cache.participants[0];
      console.log('경로 계산 시작:', { origin, dest, modeKey });
      
      // 서버 상태 확인
      try {
        const healthCheck = await fetch('http://localhost:3000/health').catch(() => null);
        if (!healthCheck || !healthCheck.ok) {
          console.error('❌ 서버 연결 실패:', {
            url: 'http://localhost:3000/health',
            status: healthCheck?.status,
            statusText: healthCheck?.statusText
          });
          toast('서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.');
          status('서버 연결 실패');
          throw new Error('서버 연결 실패');
        }
        const health = await healthCheck.json();
        console.log('✅ 서버 상태 확인:', health);
      } catch (healthErr) {
        console.error('❌ 서버 상태 확인 실패:', healthErr);
        toast('서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.');
        status('서버 연결 실패');
        throw healthErr;
      }
      
      // 서버 프록시 호출
      try {
        const mode = modeKey === 'drive' ? 'car' : (modeKey === 'walk' ? 'walk' : 'transit');
        console.log('서버에 요청 전송:', { mode, origin, destination: { lat: destLat, lng: destLng } });
        
        const resp = await fetch('http://localhost:3000/api/route', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode,
            origin: { lat: origin.lat, lng: origin.lng },
            destination: { lat: destLat, lng: destLng }
          })
        }).catch(fetchErr => {
          console.error('Fetch 에러 (서버 연결 실패 가능):', fetchErr);
          throw new Error(`서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요: ${fetchErr.message}`);
        });
        
        console.log('서버 응답 수신:', { status: resp.status, statusText: resp.statusText, ok: resp.ok });
        
        if(resp.ok){
          const data = await resp.json();
          console.log('서버 응답 성공:', data);
          console.log('polyline 데이터:', data?.polyline);
          console.log('polyline 길이:', data?.polyline?.length);
          console.log('첫 번째 polyline 요소:', data?.polyline?.[0]);
          console.log('첫 번째 polyline 요소 타입:', typeof data?.polyline?.[0]);
          
          if(data && data.polyline && data.polyline.length > 0){
            // Polyline 렌더
            // 1) LatLng 변환 (타입 보장)
            const pathLatLngs = data.polyline.map((coord) => {
              if(!Array.isArray(coord)) {
                console.error('좌표가 배열이 아닙니다:', coord);
                return null;
              }
              const [lat, lng] = coord;
              if(typeof lat !== 'number' || typeof lng !== 'number') {
                console.error('좌표 값이 숫자가 아닙니다:', {lat, lng});
                return null;
              }
              return new kakao.maps.LatLng(Number(lat), Number(lng));
            }).filter(Boolean);
            
            console.log('경로 좌표 개수:', pathLatLngs.length);
            console.log('타입 체크:', pathLatLngs[0] instanceof kakao.maps.LatLng); // true 여야 함
            console.log('첫 번째 좌표:', pathLatLngs[0]?.getLat(), pathLatLngs[0]?.getLng());
            
            if(pathLatLngs.length === 0) {
              console.error('경로 좌표가 없습니다');
              return;
            }
            
            // 2) 눈에 띄는 스타일로 폴리라인 생성
            const colors = { drive: '#ff3b30', transit: '#34C759', walk: '#FF9500' }; // drive를 빨간색으로
            const polyline = new kakao.maps.Polyline({
              path: pathLatLngs,
              strokeWeight: 6,             // 두껍게
              strokeColor: colors[modeKey] || '#ff3b30',      // 눈에 확 띄는 색
              strokeOpacity: 1,            // 완전 불투명
              strokeStyle: modeKey === 'transit' ? 'shortdash' : 'solid',
              endArrow: false,             // 화살표 비활성화
              zIndex: 9999                 // 맨 위로
            });
            
            // map 객체 검증
            if(!map) {
              console.error('❌ map 객체가 null입니다!');
              return;
            }
            console.log('✅ map 객체 확인:', map, '타입:', typeof map);
            
            polyline.setMap(map);
            const addedMap = polyline.getMap();
            console.log('Polyline 생성 및 지도 추가:', {
              pathLength: pathLatLngs.length,
              strokeColor: colors[modeKey],
              strokeWeight: 6,
              zIndex: polyline.getZIndex?.() || 9999,
              map: addedMap ? 'OK' : 'NULL',
              polylineSetMap: polyline.setMap ? '함수존재' : '함수없음'
            });
            console.log('polyline.getPath() 길이:', polyline.getPath()?.length);
            console.log('polyline.getPath() 첫 좌표:', polyline.getPath()?.[0]?.getLat(), polyline.getPath()?.[0]?.getLng());
            console.log('polyline.getPath() 마지막 좌표:', polyline.getPath()?.[polyline.getPath()?.length - 1]?.getLat(), polyline.getPath()?.[polyline.getPath()?.length - 1]?.getLng());
            
            if(!addedMap) {
              console.error('❌ Polyline이 지도에 추가되지 않았습니다!');
            }
            
            polylines.push(polyline);
            
            // 4) 적절한 bounds + zoom
            const bounds = new kakao.maps.LatLngBounds();
            pathLatLngs.forEach(p => bounds.extend(p));
            // 출발지와 목적지도 포함
            if(origin && origin.lat && origin.lng) {
              bounds.extend(new kakao.maps.LatLng(origin.lat, origin.lng));
            }
            const destLat = area.lat;
            const destLng = area.lng;
            if(destLat && destLng) {
              bounds.extend(new kakao.maps.LatLng(destLat, destLng));
            }
            
            const sw = bounds.getSouthWest();
            const ne = bounds.getNorthEast();
            console.log('📍 Bounds 설정:', {
              sw: { lat: sw.getLat(), lng: sw.getLng() },
              ne: { lat: ne.getLat(), lng: ne.getLng() },
              경로좌표수: pathLatLngs.length
            });
            
            map.setBounds(bounds, 100);
            const currentCenter = map.getCenter();
            const currentLevel = map.getLevel();
            console.log('📍 현재 지도 상태:', {
              center: { lat: currentCenter.getLat(), lng: currentCenter.getLng() },
              level: currentLevel
            });
            
            // 레벨 강제 조정(더 확대)
            if(currentLevel > 5) {
              map.setLevel(5);
              console.log('📍 지도 레벨 조정:', 5);
            }
            console.log('✅ 지도 bounds 및 레벨 조정 완료, 최종 레벨:', map.getLevel())
            
            const km = data.summary?.distance_m ? (data.summary.distance_m/1000).toFixed(1) : null;
            const min = data.summary?.duration_s ? Math.round(data.summary.duration_s/60) : null;
            status(`✅ 경로 표시 완료${km?` (${km}km` : ''}${km&&min?', ' : ''}${min?`${min}분` : ''}${km||min?')' : ''}`);
          }
        } else {
          // 응답이 실패한 경우, 에러 본문 확인
          console.error('서버 응답 실패:', {
            status: resp.status,
            statusText: resp.statusText,
            url: resp.url,
            mode: modeKey
          });
          
          let errorData = {};
          try {
            const errorText = await resp.text();
            console.error('서버 응답 본문:', errorText);
            errorData = JSON.parse(errorText);
          } catch (e) {
            console.error('응답 본문 파싱 실패:', e);
          }
          
          // 대중교통 모드에서 403 에러인 경우 특별 처리
          // 대중교통 모드에서 403 에러인 경우 별도 처리
          if (resp.status === 403 && modeKey === 'transit') {
            const errorMsg = errorData.message || '대중교통 경로 API에 접근 권한이 없습니다.';
            toast(errorMsg);
            status('대중교통 경로 제공 불가 (API 권한 필요)');
            console.warn('대중교통 API 403 에러:', errorData);
            return;
          }
          
          // 도보 모드에서 400/403 에러인 경우 별도 처리
          if ((resp.status === 400 || resp.status === 403) && modeKey === 'walk') {
            const errorMsg = errorData.message || '도보 경로를 가져올 수 없습니다.';
            toast(errorMsg);
            status('도보 경로 제공 불가');
            console.warn('도보 API 에러:', errorData);
            return;
          }
          
          throw new Error(`서버 응답 실패 (${resp.status}): ${JSON.stringify(errorData)}`);
        }
      } catch(apiErr) {
        console.error('서버 경로 API 실패 상세:', {
          error: apiErr,
          message: apiErr.message,
          stack: apiErr.stack,
          mode: modeKey
        });
        console.warn('서버 경로 API 실패, Mock 경로 사용:', apiErr);
        
        // 대중교통 모드는 Mock 경로를 사용하지 않고 에러만 표시
        if (modeKey === 'transit') {
          toast('대중교통 경로는 현재 제공되지 않습니다.');
          status('대중교통 경로 제공 불가');
          return;
        }
        
        // Mock 경로로 대체 (자동차/도보)
        const mock = calculateMockRoute(origin, dest, modeKey);
        const km = (mock.distance/1000).toFixed(1);
        const min = Math.round(mock.duration/60);
        status(`⚠️ 경로 표시 완료 (Mock, ${km}km, ${min}분)`);
      }
      
      // 기존 InfoWindow 닫기 (중복 방지)
      if(window.currentInfoWindow && window.currentInfoWindow.close) {
        window.currentInfoWindow.close();
        window.currentInfoWindow = null;
      }
      
      // 범위 조정
      const bounds = new kakao.maps.LatLngBounds();
      bounds.extend(new kakao.maps.LatLng(destLat, destLng));
      cache.participants.forEach(p=>bounds.extend(new kakao.maps.LatLng(p.lat, p.lng)));
      map.setBounds(bounds);
      
      // 경로 표시 성공 후 → '뭐 할지 찾기' 오버레이 추가 (Top1/2/3 마커는 유지, 목적지 마커는 제거)
      
      // '뭐 할지 찾기' 오버레이 생성
      const actionEl = document.createElement('div');
      actionEl.style.cssText = 'background:#111;color:#fff;padding:10px 14px;border-radius:999px;box-shadow:0 6px 16px rgba(0,0,0,.25);font-weight:700;cursor:pointer;white-space:nowrap;font-size:14px';
      actionEl.textContent = '뭐 할지 찾기';
      actionEl.addEventListener('click', ()=>{
        openAreaCourses(area);
      });
      
      const actionOverlay = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(destLat, destLng),
        content: actionEl,
        yAnchor: 1.4,
        xAnchor: 0.5,
        zIndex: 12
      });
      actionOverlay.setMap(map);
      
      // 전역 변수에 저장 (나중에 정리할 수 있도록)
      if(!window.actionOverlay) window.actionOverlay = null;
      if(window.actionOverlay && window.actionOverlay.setMap) {
        window.actionOverlay.setMap(null);
      }
      window.actionOverlay = actionOverlay;
      
      // 새로운 목적지를 선택하기 전에 이전에 숨겼던 마커가 있으면 복원
      try {
        if(lastSelectedAreaPoint){
          const { lat: prevLat, lng: prevLng } = lastSelectedAreaPoint;
          const sameAsCurrent = Math.abs(prevLat - destLat) < 1e-6 && Math.abs(prevLng - destLng) < 1e-6;
          if(!sameAsCurrent){
            restoreAreaMarkerAt(prevLat, prevLng);
          }
        }
      } catch(_){ }

      // 선택된 목적지의 Top 마커 제거(해당 지점만) — 나머지 Top1/2/3와 중간지점은 유지
      try {
        const epsilon = 1e-6;
        areaMarkers = areaMarkers.filter(m => {
          if(!m || typeof m.getPosition !== 'function') return true;
          const pos = m.getPosition();
          if(!pos) return true;
          const same = Math.abs(pos.getLat() - destLat) < epsilon && Math.abs(pos.getLng() - destLng) < epsilon;
          if(same) {
            try { m.setMap(null); } catch(_){}
            return false; // 배열에서도 제거
          }
          return true;
        });
        // 현재 숨긴 지점을 기록해 두었다가 다음 선택 시 복원
        lastSelectedAreaPoint = { lat: destLat, lng: destLng };
      } catch(_) {}
      
    }catch(e){
      console.error('경로 계산 오류:', e);
      status(`❌ 경로 계산 실패`);
    }
  }

  // 코스 장바구니 토글 함수
  function toggleCourseCart(item, placeId, lat, lng, btnElement){
    const existingIndex = courseCart.findIndex(p => p.id === placeId);
    
    if(existingIndex >= 0){
      // 제거
      courseCart.splice(existingIndex, 1);
      btnElement.textContent = '🛒 코스에 담기';
      btnElement.style.cssText = 'background:#f5f7fb;color:#111';
      toast(`${item.place_name || item.name || '장소'}을 코스에서 뺐습니다.`);
    } else {
      // 추가 (최대 8개)
      if(courseCart.length >= 8){
        toast('최대 8개까지 담을 수 있습니다.');
        return;
      }
      courseCart.push({
        id: placeId,
        name: item.place_name || item.name,
        lat: lat,
        lng: lng,
        category: item.cat || item.category || 'etc',
        score: item._score || 0
      });
      btnElement.textContent = '✅ 담김';
      btnElement.style.cssText = 'background:#4caf50;color:#fff';
      toast(`${item.place_name || item.name || '장소'}을 코스에 담았습니다.`);
    }
    
    // 장바구니 패널 업데이트
    renderCourseCartPanel();
    
    // 카드 리스트에서도 모든 버튼 상태 업데이트 (동일 장소가 다른 카테고리에도 있을 수 있음)
    updateAllCartButtons();
  }
  
  // 모든 장소 카드의 장바구니 버튼 상태 업데이트
  function updateAllCartButtons(){
    const allCartBtns = top3List.querySelectorAll('.cart-btn');
    allCartBtns.forEach(btn => {
      const placeId = btn.dataset.placeId;
      const isInCart = courseCart.some(p => p.id === placeId);
      btn.textContent = isInCart ? '✅ 담김' : '🛒 코스에 담기';
      btn.style.cssText = isInCart ? 'background:#4caf50;color:#fff' : 'background:#f5f7fb;color:#111';
    });
  }
  
  // 장바구니 패널 렌더링
  function renderCourseCartPanel(){
    const cartPanel = $('#course-cart-panel');
    if(!cartPanel) return;
    
    if(courseCart.length === 0){
      cartPanel.style.display = 'none';
      return;
    }
    
    cartPanel.style.display = 'block';
    const cartTitle = cartPanel.querySelector('.cart-title');
    const cartPills = cartPanel.querySelector('.cart-pills');
    const recommendBtn = cartPanel.querySelector('.recommend-course-btn');
    
    if(cartTitle) cartTitle.textContent = `내 코스 🧭 (${courseCart.length})`;
    
    // Pill 목록 렌더링
    if(cartPills){
      cartPills.innerHTML = '';
      courseCart.forEach((place, idx) => {
        const pill = document.createElement('span');
        pill.className = 'cart-pill';
        pill.style.cssText = 'display:inline-flex;align-items:center;gap:6px;background:#f0f2f8;padding:6px 10px;border-radius:16px;font-size:13px;margin:4px';
        pill.innerHTML = `
          <span>${place.name}</span>
          <button type="button" class="cart-pill-remove" data-place-id="${place.id}" style="background:none;border:0;cursor:pointer;padding:0;font-size:16px;line-height:1">❌</button>
        `;
        pill.querySelector('.cart-pill-remove').addEventListener('click', (e)=>{
          e.stopPropagation();
          const placeId = e.target.dataset.placeId;
          const placeItem = courseCart.find(p => p.id === placeId);
          if(placeItem){
            courseCart = courseCart.filter(p => p.id !== placeId);
            renderCourseCartPanel();
            updateAllCartButtons();
            toast(`${placeItem.name}을 코스에서 뺐습니다.`);
          }
        });
        cartPills.appendChild(pill);
      });
    }
    
    // 추천 코스 보기 버튼 활성화 여부
    if(recommendBtn){
      if(courseCart.length >= 2){
        recommendBtn.disabled = false;
        recommendBtn.style.opacity = '1';
        recommendBtn.style.cursor = 'pointer';
        recommendBtn.onclick = () => generateRecommendedCourses();
      } else {
        recommendBtn.disabled = true;
        recommendBtn.style.opacity = '0.5';
        recommendBtn.style.cursor = 'not-allowed';
        recommendBtn.onclick = null;
      }
    }
  }
  
  // 추천 코스 생성 (담은 장소들만으로 생성)
  async function generateRecommendedCourses(){
    if(courseCart.length < 2){
      toast('장소를 2개 이상 담아주세요.');
      return;
    }
    
    try {
      const requestBody = {
        places: courseCart.map(p => ({
          id: p.id,
          name: p.name,
          lat: p.lat,
          lng: p.lng,
          category: p.category,
          score: p.score
        })),
        mode: 'walk'
      };
      
      console.log('📤 코스 추천 요청:', {
        url: 'http://localhost:3000/api/course/recommend',
        method: 'POST',
        body: requestBody,
        placesCount: requestBody.places.length
      });
      
      // 서버에 코스 추천 요청 (시작점은 첫 번째 장소로 자동 설정)
      status('코스 생성 중...');
      const response = await fetch('http://localhost:3000/api/course/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      
      console.log('📥 서버 응답:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        url: response.url
      });
      
      if(!response.ok){
        let errorData = {};
        let errorText = '';
        try {
          errorText = await response.text();
          console.error('❌ 서버 에러 응답 본문:', errorText);
          try {
            errorData = JSON.parse(errorText);
          } catch(e) {
            errorData = { error: errorText, raw: errorText };
          }
        } catch(e) {
          console.error('❌ 에러 응답 파싱 실패:', e);
          errorData = { error: `서버 응답 파싱 실패: ${e.message}` };
        }
        
        const errorMsg = errorData.error || errorData.message || `서버 오류 (${response.status})`;
        const detailMsg = errorData.detail ? `\n상세: ${errorData.detail}` : '';
        const fullError = `${errorMsg}${detailMsg}\n상태: ${response.status} ${response.statusText}`;
        
        console.error('❌ 코스 생성 실패 상세:', {
          status: response.status,
          statusText: response.statusText,
          errorData,
          errorText,
          requestBody
        });
        
        throw new Error(fullError);
      }
      
      const courses = await response.json();
      console.log('✅ 코스 생성 성공:', {
        coursesCount: courses?.length || 0,
        courses: courses
      });
      
      if(!courses || !courses.length || courses.length === 0){
        throw new Error('코스를 만들 수 없어요. 장소를 2개 이상 담아 주세요.');
      }
      
      // 코스 저장
      recommendedCourses = courses;
      
      console.log('📊 생성된 코스 정보:', {
        total: courses.length,
        courses: courses.map(c => ({
          type: c.type,
          stepsCount: c.steps?.length || 0,
          polylinePoints: c.polyline?.length || 0
        }))
      });
      
      // 지도에 직접 표시
      displayAllCoursesOnMap(courses);
      status('✅ 코스 생성 완료 - 지도에서 확인하세요');
      
    } catch(error){
      console.error('❌ 코스 생성 오류 상세:', {
        error,
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      
      const errorMsg = error.message || '경로 계산에 실패했어요. 잠시 후 다시 시도해 주세요.';
      toast(errorMsg);
      status(`❌ 코스 생성 실패: ${errorMsg}`);
    }
  }
  
  // 코스 결과 렌더링
  function renderCourseResults(courses){
    const resultsSection = $('#course-results-section');
    const resultsList = resultsSection.querySelector('.course-results-list');
    
    if(!resultsSection || !resultsList) return;
    
    resultsSection.style.display = 'block';
    resultsList.innerHTML = '';
    
    const courseLabels = {
      fastest: { icon: '🏃', label: '빠른' },
      balanced: { icon: '☕', label: '여유' },
      hot: { icon: '🎉', label: '핫플' }
    };
    
    courses.forEach((course, idx) => {
      const courseType = course.type || (idx === 0 ? 'fastest' : idx === 1 ? 'balanced' : 'hot');
      const label = courseLabels[courseType] || { icon: '📍', label: '추천' };
      
      const card = document.createElement('div');
      card.className = 'popup-card';
      card.style.cssText = 'cursor:pointer';
      
      const header = document.createElement('div');
      header.className = 'popup-card-header';
      header.innerHTML = `
        <span class="popup-icon">${label.icon}</span>
        <span class="popup-name">${label.label} 코스</span>
      `;
      card.appendChild(header);
      
      const meta = document.createElement('div');
      meta.className = 'popup-meta';
      const totalDist = course.summary?.distance_m ? (course.summary.distance_m / 1000).toFixed(1) : 'N/A';
      const totalTime = course.summary?.duration_s ? Math.round(course.summary.duration_s / 60) : 'N/A';
      meta.innerHTML = `<span>총 ${totalDist}km</span><span>예상 ${totalTime}분</span>`;
      card.appendChild(meta);
      
      // 순서 표시
      if(course.steps && course.steps.length){
        const stepsDiv = document.createElement('div');
        stepsDiv.style.cssText = 'font-size:12px;color:#586076;margin-top:8px';
        stepsDiv.textContent = course.steps.map((s, i) => `${i+1}. ${s.name || '장소'}`).join(' → ');
        card.appendChild(stepsDiv);
      }
      
      // 버튼 컨테이너
      const btnContainer = document.createElement('div');
      btnContainer.style.cssText = 'display:flex;gap:8px;margin-top:12px';
      
      const previewBtn = document.createElement('button');
      previewBtn.type = 'button';
      previewBtn.className = 'popup-action';
      previewBtn.textContent = '지도에서 보기';
      previewBtn.style.cssText = 'flex:1';
      previewBtn.onclick = (e) => {
        e.stopPropagation();
        previewCourseOnMap(course);
      };
      btnContainer.appendChild(previewBtn);
      
      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'popup-action';
      confirmBtn.textContent = '이 코스로 확정';
      confirmBtn.style.cssText = 'flex:1;background:#4caf50;color:#fff';
      confirmBtn.onclick = (e) => {
        e.stopPropagation();
        confirmCourse(course);
      };
      btnContainer.appendChild(confirmBtn);
      
      card.appendChild(btnContainer);
      resultsList.appendChild(card);
    });
    
    // 결과 섹션으로 스크롤
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  
  // 코스 지도 미리보기
  function previewCourseOnMap(course){
    // 기존 미리보기 제거
    clearCoursePreview();
    
    if(!course.polyline || !course.steps) return;
    
    // 폴리라인 표시
    if(course.polyline && course.polyline.length > 0){
      const pathLatLngs = course.polyline.map(coord => 
        new kakao.maps.LatLng(coord[0], coord[1])
      );
      
      const polyline = new kakao.maps.Polyline({
        path: pathLatLngs,
        strokeWeight: 5,
        strokeColor: '#007AFF',
        strokeOpacity: 0.7,
        strokeStyle: 'solid',
        zIndex: 3
      });
      polyline.setMap(map);
      coursePreviewOverlays.push(polyline);
    }
    
    // 마커 표시 (1, 2, 3... 순서대로)
    course.steps.forEach((step, idx) => {
      const markerLabel = String(idx + 1);
      const isStart = step.isOrigin || idx === 0;
      
      const marker = new kakao.maps.Marker({
        position: new kakao.maps.LatLng(step.lat, step.lng),
        map: map,
        zIndex: 4
      });
      
      // 커스텀 오버레이로 라벨 표시 (시작점은 다른 색상)
      const labelOverlay = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(step.lat, step.lng),
        content: `<div style="background:${isStart ? '#007AFF' : '#111'};color:#fff;padding:4px 8px;border-radius:4px;font-weight:700;font-size:12px">${markerLabel}</div>`,
        yAnchor: 2.2,
        xAnchor: 0.5,
        zIndex: 5
      });
      labelOverlay.setMap(map);
      
      coursePreviewOverlays.push(marker);
      coursePreviewOverlays.push(labelOverlay);
    });
    
    // 지도 범위 조정
    if(course.polyline && course.polyline.length > 0){
      const bounds = new kakao.maps.LatLngBounds();
      course.polyline.forEach(coord => {
        bounds.extend(new kakao.maps.LatLng(coord[0], coord[1]));
      });
      map.setBounds(bounds);
    }
  }
  
  // 코스 미리보기 제거
  function clearCoursePreview(){
    coursePreviewOverlays.forEach(overlay => {
      try {
        if(overlay.setMap) overlay.setMap(null);
      } catch(_){}
    });
    coursePreviewOverlays = [];
  }
  
  // 단일 추천 코스를 지도에 표시
  function displayAllCoursesOnMap(courses){
    // 기존 코스 오버레이 제거
    clearAllCourseOverlays();
    
    if(!courses || courses.length === 0){
      console.warn('⚠️ 표시할 코스가 없습니다.');
      return;
    }
    
    // TOP3 마커 및 관련 UI 숨기기
    hideTop3MarkersAndUI();
    
    // 첫 번째 코스만 사용 (단일 추천 코스)
    const course = courses[0];
    
    console.log('🗺️ 지도에 코스 표시 시작:', {
      hasPolyline: !!course.polyline,
      polylineLength: course.polyline?.length || 0,
      stepsCount: course.steps?.length || 0
    });
    
    const courseColor = '#007AFF'; // 파란색
    const courseLabel = '코스 수정하기';
    
    // 폴리라인 표시
    if(course.polyline && course.polyline.length > 0){
      const pathLatLngs = course.polyline.map(coord => 
        new kakao.maps.LatLng(coord[0], coord[1])
      );
      
      const polyline = new kakao.maps.Polyline({
        path: pathLatLngs,
        strokeWeight: 6,
        strokeColor: courseColor,
        strokeOpacity: 0.8,
        strokeStyle: 'solid',
        zIndex: 3
      });
      polyline.setMap(map);
      courseOverlays.push({ type: 'polyline', course, overlay: polyline });
      console.log(`    ✅ 폴리라인 표시 완료 (${pathLatLngs.length}개 포인트)`);
      
      // 폴리라인 중간 지점에 라벨 버튼 추가
      const midIndex = Math.floor(pathLatLngs.length / 2);
      const midPoint = pathLatLngs[midIndex];
      createCourseLabel(midPoint, courseLabel, course, courseColor);
    } else {
      console.warn('    ⚠️ 코스에 폴리라인이 없습니다.');
    }
    
    // 마커 표시 (1, 2, 3...)
    if(course.steps){
      course.steps.forEach((step, stepIdx) => {
        const marker = new kakao.maps.Marker({
          position: new kakao.maps.LatLng(step.lat, step.lng),
          map: map,
          zIndex: 4
        });
        courseOverlays.push({ type: 'marker', course, overlay: marker });
        
        const markerLabel = String(stepIdx + 1);
        const isStart = step.isOrigin || stepIdx === 0;
        const labelOverlay = new kakao.maps.CustomOverlay({
          position: new kakao.maps.LatLng(step.lat, step.lng),
          content: `<div style="background:${isStart ? courseColor : '#111'};color:#fff;padding:4px 8px;border-radius:4px;font-weight:700;font-size:12px">${markerLabel}</div>`,
          yAnchor: 2.2,
          xAnchor: 0.5,
          zIndex: 5
        });
        labelOverlay.setMap(map);
        courseOverlays.push({ type: 'label', course, overlay: labelOverlay });
      });
    }
    
    console.log('✅ 지도 표시 완료');
    
    // 지도 범위 조정
    if(course.polyline && course.polyline.length > 0){
      const bounds = new kakao.maps.LatLngBounds();
      course.polyline.forEach(coord => {
        bounds.extend(new kakao.maps.LatLng(coord[0], coord[1]));
      });
      map.setBounds(bounds);
    }
  }
  
  // 코스 라벨 버튼 생성
  function createCourseLabel(position, label, course, color){
    const labelDiv = document.createElement('div');
    labelDiv.style.cssText = `
      background:${color};
      color:#fff;
      padding:8px 16px;
      border-radius:20px;
      font-weight:700;
      font-size:14px;
      cursor:pointer;
      box-shadow:0 2px 8px rgba(0,0,0,0.3);
      white-space:nowrap;
      user-select:none;
    `;
    labelDiv.textContent = label;
    labelDiv.onmouseover = () => labelDiv.style.opacity = '0.8';
    labelDiv.onmouseout = () => labelDiv.style.opacity = '1';
    labelDiv.onclick = () => showCourseEditPanel(course);
    
    const labelOverlay = new kakao.maps.CustomOverlay({
      position: position,
      content: labelDiv,
      yAnchor: 0.5,
      xAnchor: 0.5,
      zIndex: 10
    });
    labelOverlay.setMap(map);
    courseOverlays.push({ type: 'labelButton', course, overlay: labelOverlay });
  }
  
  // 코스 편집 패널 표시
  function showCourseEditPanel(course){
    currentEditingCourse = course;
    
    // 기존 패널 제거
    const existingPanel = $('#course-edit-panel');
    if(existingPanel) existingPanel.remove();
    
    // 패널 생성
    const panel = document.createElement('div');
    panel.id = 'course-edit-panel';
    panel.style.cssText = `
      position:fixed;
      bottom:20px;
      left:50%;
      transform:translateX(-50%);
      width:90%;
      max-width:500px;
      background:#fff;
      border-radius:16px;
      padding:20px;
      box-shadow:0 4px 20px rgba(0,0,0,0.3);
      z-index:10000;
      max-height:70vh;
      overflow-y:auto;
    `;
    
    const title = document.createElement('div');
    title.style.cssText = 'font-weight:700;font-size:18px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center';
    title.innerHTML = `
      <span>추천 코스 편집</span>
      <button type="button" style="background:none;border:0;font-size:24px;cursor:pointer;padding:0;width:32px;height:32px;display:flex;align-items:center;justify-content:center">×</button>
    `;
    title.querySelector('button').onclick = () => panel.remove();
    panel.appendChild(title);
    
    const list = document.createElement('div');
    list.id = 'course-edit-list';
    list.style.cssText = 'display:flex;flex-direction:column;gap:8px';
    
    // 장소 리스트 표시 (드래그 가능)
    // 편집용 복사본 생성 (원본 유지)
    const editingSteps = course.steps.map((s, i) => ({ ...s, _originalIndex: i }));
    
    editingSteps.forEach((step, idx) => {
      const item = document.createElement('div');
      item.dataset.originalIndex = step._originalIndex;
      item.dataset.currentIndex = idx;
      item.style.cssText = `
        display:flex;
        align-items:center;
        gap:12px;
        padding:12px;
        background:#f5f7fb;
        border-radius:12px;
        cursor:move;
        user-select:none;
      `;
      
      const dragHandle = document.createElement('div');
      dragHandle.style.cssText = 'font-size:20px;color:#999;cursor:grab';
      dragHandle.textContent = '☰';
      dragHandle.onmousedown = (e) => startDrag(e, item, list);
      item.appendChild(dragHandle);
      
      const number = document.createElement('div');
      number.style.cssText = 'width:28px;height:28px;background:#111;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0';
      number.textContent = idx + 1;
      item.appendChild(number);
      
      const name = document.createElement('div');
      name.style.cssText = 'flex:1;font-size:15px;font-weight:500';
      name.textContent = step.name || '장소';
      item.appendChild(name);
      
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.style.cssText = 'background:none;border:0;font-size:20px;cursor:pointer;padding:4px;color:#999';
      removeBtn.textContent = '❌';
      removeBtn.onclick = (e) => {
        e.stopPropagation();
        removePlaceFromCourse(item);
      };
      item.appendChild(removeBtn);
      
      list.appendChild(item);
    });
    
    panel.appendChild(list);
    
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.style.cssText = 'width:100%;margin-top:16px;padding:12px;background:#007AFF;color:#fff;border:0;border-radius:12px;font-weight:700;font-size:16px;cursor:pointer';
    saveBtn.textContent = '변경사항 적용';
    saveBtn.onclick = () => applyCourseChanges();
    panel.appendChild(saveBtn);
    
    document.body.appendChild(panel);
  }
  
  // 드래그 시작
  let dragItem = null;
  let dragOffset = 0;
  
  function startDrag(e, item, container){
    dragItem = item;
    const rect = item.getBoundingClientRect();
    dragOffset = e.clientY - rect.top;
    item.style.opacity = '0.5';
    document.addEventListener('mousemove', handleDrag);
    document.addEventListener('mouseup', stopDrag);
    e.preventDefault();
  }
  
  function handleDrag(e){
    if(!dragItem) return;
    const container = dragItem.parentElement;
    const items = Array.from(container.children);
    const mouseY = e.clientY;
    
    let target = null;
    for(let item of items){
      const rect = item.getBoundingClientRect();
      if(item !== dragItem && mouseY >= rect.top && mouseY <= rect.bottom){
        target = item;
        break;
      }
    }
    
    if(target){
      const targetIndex = Array.from(container.children).indexOf(target);
      const dragIndex = Array.from(container.children).indexOf(dragItem);
      if(dragIndex < targetIndex){
        container.insertBefore(dragItem, target.nextSibling);
      } else {
        container.insertBefore(dragItem, target);
      }
      updateItemNumbers(container);
    }
  }
  
  function stopDrag(){
    if(dragItem){
      dragItem.style.opacity = '1';
      dragItem = null;
    }
    document.removeEventListener('mousemove', handleDrag);
    document.removeEventListener('mouseup', stopDrag);
  }
  
  function updateItemNumbers(container){
    Array.from(container.children).forEach((item, idx) => {
      const number = item.querySelector('div[style*="width:28px"]');
      if(number) number.textContent = idx + 1;
      item.dataset.currentIndex = idx;
    });
  }
  
  // 장소 제거
  function removePlaceFromCourse(itemElement){
    const list = $('#course-edit-list');
    if(!list || list.children.length <= 2){
      toast('최소 2개 장소는 필요합니다.');
      return;
    }
    
    itemElement.remove();
    updateItemNumbers(list);
  }
  
  // 변경사항 적용
  async function applyCourseChanges(){
    if(!currentEditingCourse) return;
    
    const list = $('#course-edit-list');
    if(!list) return;
    
    // 편집 패널의 실제 순서로 steps 재배열
    const newSteps = [];
    Array.from(list.children).forEach(item => {
      const originalIndex = parseInt(item.dataset.originalIndex);
      if(currentEditingCourse.steps[originalIndex]){
        newSteps.push({ 
          ...currentEditingCourse.steps[originalIndex],
          name: currentEditingCourse.steps[originalIndex].name || '장소'
        });
      }
    });
    
    if(newSteps.length < 2){
      toast('최소 2개 장소는 필요합니다.');
      return;
    }
    
    // 코스 재생성 (서버에 요청)
    status('코스 재생성 중...');
    try {
      const response = await fetch('http://localhost:3000/api/course/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          places: newSteps.map(s => ({
            id: s.id || `place_${s.lat}_${s.lng}`,
            name: s.name,
            lat: s.lat,
            lng: s.lng,
            category: s.category || 'etc',
            score: s.score || 0
          })),
          mode: 'walk'
        })
      });
      
      if(!response.ok) throw new Error('코스 재생성 실패');
      
      const courses = await response.json();
      if(courses && courses.length > 0){
        // 단일 추천 코스 업데이트
        const updatedCourse = courses[0];
        
        // 편집된 순서를 유지하면서 새로운 경로 계산 결과 적용
        recommendedCourses = [{
          ...updatedCourse,
          type: 'recommended',
          steps: newSteps.map((s, idx) => ({
            ...s,
            isOrigin: idx === 0
          }))
        }];
        
        // 지도 업데이트
        displayAllCoursesOnMap(recommendedCourses);
        toast('코스가 업데이트되었습니다.');
      }
    } catch(error){
      console.error('코스 재생성 오류:', error);
      toast('코스 재생성에 실패했습니다.');
    }
    
    // 패널 닫기
    const panel = $('#course-edit-panel');
    if(panel) panel.remove();
    currentEditingCourse = null;
  }
  
  // 모든 코스 오버레이 제거
  function clearAllCourseOverlays(){
    courseOverlays.forEach(({ overlay }) => {
      try {
        if(overlay.setMap) overlay.setMap(null);
      } catch(_){}
    });
    courseOverlays = [];
  }
  
  
  // 코스 확정
  function confirmCourse(course){
    confirmedCourse = course;
    hideTop3Popup();
    clearCoursePreview();
    
    // 메인 지도에 확정 코스 표시
    previewCourseOnMap(course);
    
    status('✅ 코스가 확정되었습니다.');
    toast('코스가 지도에 표시되었습니다.');
  }
  
  function showTop3Popup(items, options={}){
    const { title='추천 Top3', mode='place', categories=null } = options;
    if((!items || !items.length) && options.mode!=='areaCourses'){
      hideTop3Popup();
      return;
    }
    // 'areaCourses'는 TOP3 보기 버튼의 기본 동작(지역 Top3)을 덮어쓰지 않도록 lastPopup을 갱신하지 않는다
    if(options.mode !== 'areaCourses'){
      lastPopup = { items, options: { ...options } };
    }
    top3Title.textContent = title;
    top3List.innerHTML='';
    const popupTabs = $('#popup-tabs');
    popupTabs.innerHTML='';
    popupTabs.style.display='none';
    const routeTabs = $('#route-mode-tabs');
    if(routeTabs) routeTabs.style.display='none';

    // 지역 선택 후: 팝업 상단에 카테고리 토글 표시하고 리스트를 팝업 내부에 렌더
    if(mode==='areaCourses' && categories && cache && cache.selectedArea){
      // 잠금: 배경 클릭으로 닫히지 않도록
      try{ top3Popup.dataset.lock='true'; }catch(_){}
      const cats = ['all','food','pub','cafe','play'];
      const labels = {all:'전체',food:'맛집',pub:'술집',cafe:'카페',play:'놀거리'};
      const renderCat=(cat)=>{
        const table={all:'rank_all',food:'rank_food',pub:'rank_pub',cafe:'rank_cafe',play:'rank_play'}[cat];
        const list=cache.selectedArea.ranks?.[table]||[];
        top3List.innerHTML='';
        list.slice(0,20).forEach((item,idx)=>{
          const card=document.createElement('div');
          card.className='popup-card';
          const h=document.createElement('div');
          h.className='popup-card-header';
          h.innerHTML=`<span class="popup-rank">${idx+1}</span><span class="popup-icon">${getCategoryIcon(item.cat||item.category)}</span><span class="popup-name">${item.place_name||item.name}</span>`;
          card.appendChild(h);
          const m=document.createElement('div');
          m.className='popup-meta';
          if(item.road_address_name||item.address_name)m.appendChild(document.createElement('span')).textContent=item.road_address_name||item.address_name;
          if(item._reasons&&item._reasons.length)m.appendChild(document.createElement('span')).textContent=item._reasons.join(' · ');
          card.appendChild(m);
      
      // 버튼 컨테이너
      const btnContainer = document.createElement('div');
      btnContainer.style.cssText = 'display:flex;gap:8px;margin-top:8px';
      
      // 자세히 보기 버튼
      const linkBtn=document.createElement('button');
      linkBtn.type='button';
      linkBtn.className='popup-action';
      const lat=item.y?parseFloat(item.y):item.lat;
      const lng=item.x?parseFloat(item.x):item.lng;
      linkBtn.textContent='자세히 보기';
      linkBtn.addEventListener('click', (e)=>{
        e.preventDefault();
        e.stopPropagation();
        
        // 카카오맵 장소 정보 페이지로 이동
        let kakaoPlaceUrl = '';
        if(item.id || item.place_id){
          const placeId = item.id || item.place_id;
          kakaoPlaceUrl = `https://place.map.kakao.com/${placeId}`;
        } else if(lat && lng && item.place_name){
          const placeName = encodeURIComponent(item.place_name);
          kakaoPlaceUrl = `https://map.kakao.com/link/map/${placeName},${lat},${lng}`;
        } else {
          const placeName = encodeURIComponent(item.place_name || item.name || '');
          kakaoPlaceUrl = `https://map.kakao.com/?q=${placeName}`;
        }
        
        if(kakaoPlaceUrl){
          window.open(kakaoPlaceUrl, '_blank', 'noopener,noreferrer');
          status(`📍 ${item.place_name || item.name || '장소'} 정보 페이지로 이동`);
        } else {
          toast('장소 정보를 불러올 수 없습니다.');
        }
      });
      btnContainer.appendChild(linkBtn);
      
      // 코스에 담기 버튼 (토글)
      const placeId = item.id || item.place_id || `${lat}_${lng}`;
      const isInCart = courseCart.some(p => p.id === placeId);
      const cartBtn = document.createElement('button');
      cartBtn.type='button';
      cartBtn.className='popup-action cart-btn';
      cartBtn.dataset.placeId = placeId;
      cartBtn.style.cssText = isInCart ? 'background:#4caf50;color:#fff' : 'background:#f5f7fb;color:#111';
      cartBtn.textContent = isInCart ? '✅ 담김' : '🛒 코스에 담기';
      
      cartBtn.addEventListener('click', (e)=>{
        e.preventDefault();
        e.stopPropagation();
        toggleCourseCart(item, placeId, lat, lng, cartBtn);
      });
      btnContainer.appendChild(cartBtn);
      
      card.appendChild(btnContainer);
      top3List.appendChild(card);
    });
      };
      cats.forEach((cat,idx)=>{
        const btn=document.createElement('div');
        btn.className='popup-tab'+(idx===0?' on':'');
        btn.textContent=labels[cat];
        btn.addEventListener('click',()=>{
          popupTabs.querySelectorAll('.popup-tab').forEach(t=>t.classList.remove('on'));
          btn.classList.add('on');
          renderCat(cat);
        });
        popupTabs.appendChild(btn);
      });
      popupTabs.style.display='flex';
      // 기본값: 전체
      renderCat('all');
      top3Title.textContent = `${cache.selectedArea.name} 추천코스`;
      top3Popup.classList.remove('hidden');
      top3Popup.setAttribute('aria-hidden','false');
      
      // 장바구니 패널 렌더링 (areaCourses 모드일 때만)
      renderCourseCartPanel();
      
      // 포커스 가능한 요소들의 탭 인덱스 복원
      const focusableElements = top3Popup.querySelectorAll('[tabindex="-1"]');
      focusableElements.forEach(el => {
        if (el.tagName === 'BUTTON' || el.tagName === 'A') {
          el.removeAttribute('tabindex');
        } else {
          el.setAttribute('tabindex', '0');
        }
      });
      
      collapseSheet();
      return; // areaCourses 모드일 때는 아래의 기본 렌더링 생략
    }

    // 일반 Top3: 잠금 해제
    try{ delete top3Popup.dataset.lock; }catch(_){}

    items.forEach((item, idx)=>{
      const card=document.createElement('div');
      card.className='popup-card';

      const header=document.createElement('div');
      header.className='popup-card-header';
      const rank=document.createElement('span');
      rank.className='popup-rank';
      rank.textContent=`TOP ${idx+1}`;
      const icon=document.createElement('span');
      icon.className='popup-icon';
      const iconKey = mode==='area' ? 'area' : (item.cat || item.category || 'etc');
      icon.textContent=getCategoryIcon(iconKey);
      const name=document.createElement('span');
      name.className='popup-name';
      name.textContent=item.place_name || item.name || '(이름 없음)';
      header.append(rank, icon, name);
      card.appendChild(header);

      const meta=document.createElement('div');
      meta.className='popup-meta';
      if(item.distance){
        const distSpan=document.createElement('span');
        distSpan.style.cssText='color:#586076;font-size:12px';
        distSpan.textContent=`📍 ${formatDistance(item.distance)}`;
        meta.appendChild(distSpan);
      }
      // 예상시간 (API에서 제공되는 경우)
      if(item.durationSec || item.duration){
        const dur=item.durationSec || item.duration;
        const durSpan=document.createElement('span');
        durSpan.style.cssText='color:#586076;font-size:12px';
        const min=Math.floor(dur/60);
        durSpan.textContent=`⏱️ ${min}분`;
        meta.appendChild(durSpan);
      }
      if(item.road_address_name || item.address_name){
        meta.appendChild(document.createElement('span')).textContent=item.road_address_name || item.address_name;
      } else if(item.keywords){
        meta.appendChild(document.createElement('span')).textContent=item.keywords.slice(0,2).join(' · ');
      }
      if(item._reasons && item._reasons.length){
        meta.appendChild(document.createElement('span')).textContent=item._reasons.join(' · ');
      }
      card.appendChild(meta);

      if(mode==='area'){
        // 카드 자체 클릭 = 경로 선택 팝업으로 직행
        card.addEventListener('click', async (e)=>{
          if(e.target.classList.contains('popup-action')) return; // 버튼 클릭은 제외
          try{
            top3Title.textContent = `${item.name} 가는 방법`;
            top3List.innerHTML='';
            showRouteModeTabs(item, '자가용');
            // 팝업 열기
            top3Popup.classList.remove('hidden');
            top3Popup.setAttribute('aria-hidden', 'false');
            status(`📍 ${item.name} 경로 선택 중...`);
          }catch(e){
            console.error(e);
            status('❌ 경로 계산 실패');
          }
        });
        
        // 길찾기 버튼 (경로 선택)
        const routeBtn = document.createElement('button');
        routeBtn.type='button';
        routeBtn.className='popup-action';
        routeBtn.textContent='길찾기';
        routeBtn.addEventListener('click', async (e)=>{
          e.stopPropagation();
          try{
            top3Title.textContent = `${item.name} 가는 방법`;
            top3List.innerHTML='';
            showRouteModeTabs(item, '자가용');
            // 팝업 열기
            top3Popup.classList.remove('hidden');
            top3Popup.setAttribute('aria-hidden', 'false');
            status(`📍 ${item.name} 경로 선택 중...`);
          }catch(e){
            console.error(e);
            status('❌ 경로 계산 실패');
          }
        });
        card.appendChild(routeBtn);
      } else {
        const link=document.createElement('a');
        link.className='popup-action';
        const lat=item.y ? parseFloat(item.y) : item.lat;
        const lng=item.x ? parseFloat(item.x) : item.lng;
        const label=item.place_name || item.name || '목적지';
        const kakaoLink = lat && lng ? `https://map.kakao.com/link/to/${encodeURIComponent(label)},${lat},${lng}` : (item.place_url||'#');
        link.href=item.place_url || kakaoLink;
        link.target='_blank';
        link.rel='noopener';
        link.textContent='길찾기';
        card.appendChild(link);
      }

      // 내부 클릭이 배경으로 버블링하지 않도록
      card.addEventListener('click', ev=>ev.stopPropagation());
      top3List.appendChild(card);
    });

    top3Popup.classList.remove('hidden');
    top3Popup.setAttribute('aria-hidden', 'false');
    
    // 포커스 가능한 요소들의 탭 인덱스 복원
    const focusableElements = top3Popup.querySelectorAll('[tabindex="-1"]');
    focusableElements.forEach(el => {
      // 버튼이나 링크는 tabindex를 제거하면 기본 동작(포커스 가능)으로 돌아감
      if (el.tagName === 'BUTTON' || el.tagName === 'A') {
        el.removeAttribute('tabindex');
      } else {
        el.setAttribute('tabindex', '0');
      }
    });
    
    collapseSheet();
  }

  const formatDistance = distance => {
    if(!distance && distance !== 0) return '';
    if(distance >= 1000) {
      const km = distance / 1000;
      return (km >= 10 ? Math.round(km) : km.toFixed(1)) + 'km';
    }
    return Math.round(distance/10)*10 + 'm';
  };

  function setOrigin(lat,lng, participants=null){
    if(!map) return;
    if(originMarker) originMarker.setMap(null);
    if(centerCircle) centerCircle.setMap(null);
    // 기존 '내 위치' 임시 마커가 있다면 제거(참여자 마커로 대체되므로 중복 방지)
    if(myLocationMarker && myLocationMarker.setMap){ myLocationMarker.setMap(null); myLocationMarker=null; }
    if(myLocationMarker2 && myLocationMarker2.setMap){ myLocationMarker2.setMap(null); myLocationMarker2=null; }
    
    // 중간점 커스텀 아이콘 (파란 원 + 🎯)
    const centerIconContent = document.createElement('div');
    centerIconContent.style.cssText='background:#39678F;width:40px;height:40px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;font-size:20px;cursor:pointer';
    centerIconContent.textContent='🎯';
    
    const originPos = new kakao.maps.LatLng(lat,lng);
    originMarker = new kakao.maps.CustomOverlay({
      position: originPos,
      content: centerIconContent,
      xAnchor: 0.5,
      yAnchor: 0.5,
      zIndex: 10
    });
    originMarker.setMap(map);
    
    // 참여자 마커 표시 (초록 원 + 👤)
    if(participants && participants.length){
      participantsMarkers.forEach(m=>m.setMap(null));
      participantsMarkers=[];
      participants.forEach((p, idx)=>{
        const personIconContent = document.createElement('div');
        personIconContent.style.cssText='background:#4caf50;width:36px;height:36px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;font-size:18px';
        personIconContent.textContent='👤';
        
        const m = new kakao.maps.CustomOverlay({
          position: new kakao.maps.LatLng(p.lat,p.lng),
          content: personIconContent,
          xAnchor: 0.5,
          yAnchor: 0.5,
          zIndex: 9
        });
        m.setMap(map);
        participantsMarkers.push(m);
      });
    }
    
    map.setCenter(originPos); map.setLevel(5);
  }

  // 내 위치 임시 마커 표시(사용자가 첫 위치를 지정했을 때 즉시 피드백)
  function showMyLocationMarker(lat, lng){
    try{
      if(!map) return;
      // 이미 마커가 있으면 위치만 업데이트
      if(myLocationMarker && typeof myLocationMarker.setPosition === 'function'){
        myLocationMarker.setPosition(new kakao.maps.LatLng(lat, lng));
        return;
      }
      const personIconContent = document.createElement('div');
      personIconContent.style.cssText='background:#4caf50;width:36px;height:36px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;font-size:18px';
      personIconContent.textContent='👤';
      myLocationMarker = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(lat, lng),
        content: personIconContent,
        xAnchor: 0.5,
        yAnchor: 0.5,
        zIndex: 9
      });
      myLocationMarker.setMap(map);
    }catch(_){ }
  }

  // 참여자2 임시 마커 표시
  function showMyLocationMarker2(lat, lng){
    try{
      if(!map) return;
      if(myLocationMarker2 && typeof myLocationMarker2.setPosition === 'function'){
        myLocationMarker2.setPosition(new kakao.maps.LatLng(lat, lng));
        return;
      }
      const personIconContent = document.createElement('div');
      personIconContent.style.cssText='background:#2196f3;width:36px;height:36px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;font-size:18px';
      personIconContent.textContent='👤';
      myLocationMarker2 = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(lat, lng),
        content: personIconContent,
        xAnchor: 0.5,
        yAnchor: 0.5,
        zIndex: 9
      });
      myLocationMarker2.setMap(map);
    }catch(_){ }
  }

  function addAreaMarkers(areas){
    areaMarkers.forEach(m=>m.setMap(null));
    areaMarkers=[];
    // 이전 원 제거
    if(centerCircle) centerCircle.setMap(null);
    // 이전 중간점 버튼 제거
    if(centerBtnOverlay) centerBtnOverlay.setMap(null);
    
    const bounds = new kakao.maps.LatLngBounds();
    let hasBounds=false;
    if(cache && cache.center){
      const cpos = new kakao.maps.LatLng(cache.center.lat, cache.center.lng);
      bounds.extend(cpos);
      hasBounds=true;
      
      // 중간점 반경 원형 오버레이 추가
      const maxDistance = Math.max(...areas.map(a=>a.distance || 0));
      const radius = Math.max(1500, Math.min(maxDistance * 1.2, 10000)); // 최소 1.5km, 최대 10km
      centerCircle = new kakao.maps.Circle({
        center: cpos,
        radius: radius,
        strokeWeight: 1,
        strokeColor: '#39678F',
        strokeOpacity: 0.5,
        strokeStyle: 'dashed',
        fillColor: '#39678F',
        fillOpacity: 0.05
      });
      centerCircle.setMap(map);
      
      // 중간점 마커 아래에 "TOP 3 보기" 버튼 추가
      const btnContent = document.createElement('div');
      btnContent.style.cssText='background:#111;color:#fff;padding:10px 16px;border-radius:999px;font-weight:600;font-size:13px;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.25);white-space:nowrap;pointer-events:auto';
      btnContent.textContent='TOP 3 보기';
      btnContent.addEventListener('click', (e)=>{
        e.stopPropagation();
        if(lastPopup) showTop3Popup(lastPopup.items, lastPopup.options);
      });
      
      centerBtnOverlay = new kakao.maps.CustomOverlay({
        position: cpos,
        content: btnContent,
        yAnchor: 1.5,
        xAnchor: 0.5
      });
      centerBtnOverlay.setMap(map);
    }
    areas.forEach((area, idx)=>{
      const position = new kakao.maps.LatLng(area.lat, area.lng);
      
      // Top 영역 커스텀 아이콘 (검정 원 + 번호)
      const areaIconContent = document.createElement('div');
      areaIconContent.style.cssText='background:#111;width:44px;height:44px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:bold;color:#fff';
      areaIconContent.textContent=idx+1;
      
      const m = new kakao.maps.CustomOverlay({
        position,
        content: areaIconContent,
        xAnchor: 0.5,
        yAnchor: 0.5,
        zIndex: 11
      });
      m.setMap(map);      
      areaMarkers.push(m);
      bounds.extend(position);
      hasBounds=true;
      
      // 아이콘에 클릭 이벤트 추가
      areaIconContent.addEventListener('click', async (e)=>{
        e.stopPropagation();
        try {
          // 기존 InfoWindow 닫기
          if(window.currentInfoWindow && window.currentInfoWindow.close) {
            window.currentInfoWindow.close();
            window.currentInfoWindow = null;
          }
          
          // 길찾기 팝업으로 바로 이동
          top3Title.textContent = `${area.name} 가는 방법`;
          top3List.innerHTML='';
          showRouteModeTabs(area, '자가용');
          top3Popup.classList.remove('hidden');
          top3Popup.setAttribute('aria-hidden', 'false');
          status(`📍 ${area.name} 경로 선택 중...`);
        } catch(err) {
          console.error('마커 클릭 오류:', err);
          status('❌ 경로 선택 실패');
        }
      });
    });

    if(hasBounds && typeof map.setBounds==='function'){
      try{
        map.setBounds(bounds, 60, 60, 320, 60);
      }catch(_){
        try{ map.setBounds(bounds); }catch(__){/* noop */}
      }
    }
  }

  function geocodeOne(q){
    return new Promise(res=>{
      ps.keywordSearch(q, (data, status)=>{
        if(status===kakao.maps.services.Status.OK && data && data.length){
          const p=data[0]; res({ lat:parseFloat(p.y), lng:parseFloat(p.x), raw:p });
        } else res(null);
      }, {size:10});
    });
  }

  function getCurrentLocation(){
    return new Promise((res, rej)=>{
      if(!navigator.geolocation){
        rej('Geolocation not supported');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        pos=>{
          const {latitude, longitude} = pos.coords;
          res({lat: latitude, lng: longitude});
        },
        err=>{
          rej('위치 접근 거부됨: '+err.message);
        }
      );
    });
  }

  function reverseGeocode(lat, lng){
    return new Promise((res)=>{
      geocoder.coord2Address(lng, lat, (result, status)=>{
        if(status===kakao.maps.services.Status.OK && result && result.length){
          const addr=result[0].road_address?.address_name || result[0].address?.address_name || '';
          res(addr || `${lat.toFixed(4)}, ${lng.toFixed(4)}`);
        } else {
          res(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
        }
      });
    });
  }

  const POPULAR_AREAS = [
    { name: '강남', lat: 37.4979, lng: 127.0276 },
    { name: '홍대', lat: 37.5563, lng: 126.9236 },
    { name: '잠실', lat: 37.5133, lng: 127.1028 },
    { name: '명동', lat: 37.5630, lng: 126.9825 },
    { name: '신촌', lat: 37.5551, lng: 126.9370 },
    { name: '건대', lat: 37.5406, lng: 127.0692 },
    { name: '이태원', lat: 37.5345, lng: 126.9947 },
    { name: '압구정', lat: 37.5264, lng: 127.0275 },
    { name: '삼성역', lat: 37.5088, lng: 127.0631 },
    { name: '잠실새내', lat: 37.5139, lng: 127.0979 },
    { name: '사당', lat: 37.4764, lng: 126.9813 },
    { name: '교대', lat: 37.4929, lng: 127.0145 }
  ];

async function getPopularAreas(center){
  // 동적으로 중간지점 주변에서 밀집 지역 스캔
  const loc = new kakao.maps.LatLng(center.lat, center.lng);
  const psLocal = new kakao.maps.services.Places();
  const bearings = [0,30,60,90,120,150,180,210,240,270,300,330];
  // 참여자 평균거리 기반으로 탐색 반경 산정(최소 1200~최대 6000)
  const avgDist = (cache && cache.participants && cache.participants.length)
    ? cache.participants.reduce((a,p)=>a + haversine(center, p),0)/cache.participants.length
    : 3000;
  const step = Math.max(1200, Math.min(6000, avgDist*0.6));
  const R = 6371000;
  const toRad = d=>d*Math.PI/180, toDeg = r=>r*180/Math.PI;

  const move = (c, brgDeg, dist)=>{
    const brg = toRad(brgDeg);
    const lat1 = toRad(c.lat), lng1 = toRad(c.lng);
    const lat2 = Math.asin(Math.sin(lat1)*Math.cos(dist/R) + Math.cos(lat1)*Math.sin(dist/R)*Math.cos(brg));
    const lng2 = lng1 + Math.atan2(Math.sin(brg)*Math.sin(dist/R)*Math.cos(lat1), Math.cos(dist/R)-Math.sin(lat1)*Math.sin(lat2));
    return { lat: toDeg(lat2), lng: toDeg(lng2) };
  };

  const categoryCount = cand=>new Promise(resolve=>{
    psLocal.categorySearch('FD6', (data, status)=>{
      if(status===kakao.maps.services.Status.OK && data){ resolve(data.length||0) }
      else resolve(0)
    }, { location: new kakao.maps.LatLng(cand.lat, cand.lng), radius: 1200, size: 15 });
  });

  const nameOf = (cand)=>new Promise(res=>{
    geocoder.coord2Address(cand.lng, cand.lat, (result, status)=>{
      if(status===kakao.maps.services.Status.OK && result && result.length){
        const addr=result[0];
        const label = addr.road_address?.region_3depth_name || addr.address?.region_3depth_name || addr.road_address?.address_name || addr.address?.address_name;
        res(label||'추천지점');
      } else res('추천지점');
    });
  });

  const cands = await Promise.all(bearings.map(async b=>{
    const pos = move(center, b, step);
    const count = await categoryCount(pos);
    const name = await nameOf(pos);
    const distance = haversine(center, pos);
    return { name, lat: pos.lat, lng: pos.lng, distance, _density: count };
  }));

  // 점수: 가까울수록, 밀집도 높을수록
  const scored = cands.map(c=>({
    ...c,
    _score: (c._density*1.0) - (c.distance/2000) // 간단 가중치
  }));

  // 예상시간 계산: 도보 기준(평균 시속 4km)
  const top = scored
    .sort((a,b)=>b._score-a._score)
    .slice(0,3)
    .map(({name,lat,lng,distance})=>({
      name, lat, lng, distance,
      durationSec: Math.round(distance/4000*60*60) // 도보 예상시간(초)
    }));

  // 안전망: 스캔 결과 없으면 기존 하드코드 사용
  if(top.length===0){
    const areasWithDistance = POPULAR_AREAS.map(area => {
      const dist = haversine(center, { lat: area.lat, lng: area.lng });
      return {
        ...area,
        distance: dist,
        durationSec: Math.round(dist/4000*60*60) // 도보 예상시간(초)
      };
    });
    return areasWithDistance.sort((a,b)=>a.distance-b.distance).slice(0,3);
  }
  return top;
}

  function haversine(a, b){
    const R = 6371000, toRad = x => x * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const s1 = Math.sin(dLat/2)**2;
    const s2 = Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng/2)**2;
    return 2 * R * Math.asin(Math.sqrt(s1 + s2));
  }

  function renderTop3(list){
    const el = $('#results'); el.innerHTML='';
    const centerCard = buildCenterCard();
    if(centerCard) el.appendChild(centerCard);
    const top = list.slice(0,3);
    if(top.length===0){
      hideTop3Popup();
      const empty=document.createElement('div');
      empty.className='card';
      empty.textContent='결과 없음';
      el.appendChild(empty);
      expandSheet();
      return;
    }

    const hint=document.createElement('div');
    hint.className='card card-hint';
    hint.innerHTML='<div style="font-weight:700;margin-bottom:6px">추천 장소 Top3가 지도에 표시되었습니다.</div><div style="font-size:13px;color:#586076;">지도 위 "TOP 3 보기" 버튼을 클릭하여 팝업을 열 수 있습니다.</div>';
    el.appendChild(hint);

    // 팝업 데이터 저장 (자동 오픈 제거)
    lastPopup = { items: top, options: { title:'추천 장소 Top3', mode:'place' } };
    // showTop3Popup 자동 호출 제거 - 사용자가 버튼을 눌렀을 때만 열림
    
    // 바텀시트 접기 (지도에 마커가 표시되므로 시트는 접혀있어야 함)
    collapseSheet();
  }

  function renderEmptyList(message, { onReset }={}){
    const el = $('#results'); el.innerHTML='';
    const centerCard = buildCenterCard();
    if(centerCard) el.appendChild(centerCard);
    const empty=document.createElement('div');
    empty.className='card';
    empty.innerHTML=`<div style="font-weight:700;margin-bottom:6px">${message||'결과 없음'}</div><div style="font-size:13px;color:#586076;">필터를 바꾸거나 다른 지역을 선택해 보세요.</div>`;
    if(typeof onReset==='function'){
      const btn=document.createElement('button');
      btn.type='button';
      btn.className='btn-inline';
      btn.style.marginTop='10px';
      btn.textContent='필터 초기화';
      btn.addEventListener('click', ()=>onReset());
      empty.appendChild(btn);
    }
    el.appendChild(empty);
    expandSheet();
  }

  function renderPlaceList(items){
    const el = $('#results'); el.innerHTML='';
    const centerCard = buildCenterCard();
    if(centerCard) el.appendChild(centerCard);
    if(isSearching){
      const sk=document.createElement('div');
      sk.className='card';
      sk.innerHTML='<div style="display:flex;flex-direction:column;gap:10px">'+Array.from({length:5}).map(()=>'<div style="height:16px;background:#eef1f6;border-radius:8px"></div>').join('')+'</div>';
      el.appendChild(sk);
      expandSheet();
      return;
    }
    if(!items || !items.length){
      renderEmptyList('조건에 맞는 장소가 없어요.', { onReset: ()=>{
        document.querySelector('#tabs .tab[data-cat="all"]').click();
      }});
      return;
    }
    items.forEach(item=>{
      const card=document.createElement('div');
      card.className='card';
      const name=item.place_name||item.name||'(이름 없음)';
      const cat=item.cat||item.category||'etc';
      const dist=item.distance!=null?` · ${formatDistance(item.distance)}`:'';
      const tags=(item.tags||item.keywords||[]).slice(0,3).join(' · ');
      card.innerHTML=`
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <div style="font-weight:700">${name}</div>
          <div class="badge">${cat.toUpperCase()}</div>
        </div>
        <div style="color:#666;font-size:13px">${tags||'추천 태그'}${dist}</div>
      `;
      const actions=document.createElement('div');
      actions.style.cssText='margin-top:10px;display:flex;gap:8px;flex-wrap:wrap';
      const mkBtn=(label,handler)=>{ const b=document.createElement('button'); b.type='button'; b.className='btn-inline'; b.textContent=label; b.addEventListener('click',handler); return b };
      const lat=item.y?parseFloat(item.y):item.lat;
      const lng=item.x?parseFloat(item.x):item.lng;
      actions.append(
        mkBtn('경로 보기', ()=>{
          // 경로 선택 팝업으로 직행
          top3Title.textContent = `${name} 가는 방법`;
          top3List.innerHTML='';
          showRouteModeTabs({ name, lat, lng, ...item }, '자가용');
          // 팝업 열기
          top3Popup.classList.remove('hidden');
          top3Popup.setAttribute('aria-hidden', 'false');
        }),
        mkBtn('길찾기', ()=>{
          const label=name;
          const href = lat&&lng?`https://map.kakao.com/link/to/${encodeURIComponent(label)},${lat},${lng}`:(item.place_url||'#');
          window.open(href,'_blank','noopener');
        })
      );
      card.appendChild(actions);
      el.appendChild(card);
    });
    expandSheet();
  }

  function buildCenterCard(){
    if(!cache || !cache.center) return null;
    const card=document.createElement('div');
    card.className='card card-center';

    const title=document.createElement('div');
    title.style.cssText='font-weight:700;margin-bottom:4px;display:flex;align-items:center;gap:6px;';
    title.textContent='📍 중간지점 미리보기';
    card.appendChild(title);

    const addr=document.createElement('div');
    addr.style.cssText='color:#444;font-size:14px;margin-bottom:6px;';
    addr.textContent = cache.centerAddress || `${cache.center.lat.toFixed(4)}, ${cache.center.lng.toFixed(4)}`;
    card.appendChild(addr);

    if(cache.participantInfo && cache.participantInfo.length){
      const list=document.createElement('div');
      list.style.cssText='font-size:12px;color:#666;line-height:1.6;margin-bottom:6px;';
      cache.participantInfo.forEach(info=>{
        const row=document.createElement('div');
        const label = info.display ? `${info.label} (${info.display})` : info.label;
        row.textContent = `${label} ↔ ${formatDistance(info.distance)}`;
        list.appendChild(row);
      });
      card.appendChild(list);
    }

    const note=document.createElement('div');
    note.style.cssText='font-size:11px;color:#888;line-height:1.5;';
    note.textContent='* 좌표 기준 직선거리로 계산된 중간 위치입니다. 실제 이동 시간은 교통 수단과 경로에 따라 달라질 수 있습니다.';
    card.appendChild(note);

    return card;
  }

  async function buildAreaRanks(area){
    // Kakao category codes: CE7(cafe), FD6(restaurant), CT1(cultural facility)
    const CODES = { cafe:'CE7', food:'FD6', play:['CT1','AT4'] };
    const SEARCH_RADIUSES = [4000, 5500, 7000]; // meters (try wider if empty)
    const PAGE_COUNT = 4; // up to 60 results (15/page)

    const uniqById = (arr)=>{
      const m=new Map();
      for(const p of arr){ const id=p.id||p.place_id||`${p.x},${p.y}`; if(!m.has(id)) m.set(id,p); }
      return Array.from(m.values());
    };

    const categorySearchPages = async (code, radius)=>{
      const loc = new kakao.maps.LatLng(area.lat, area.lng);
      const pages=[];
      for(let p=1;p<=PAGE_COUNT;p++){
        const one = await new Promise(resolve=>{
          if(typeof ps.categorySearch !== 'function') return resolve([]);
          ps.categorySearch(code, (data, status)=>{
            if(status===kakao.maps.services.Status.OK && data){ resolve(data); }
            else resolve([]);
          }, { location: loc, radius, size: 15, page: p, sort: kakao.maps.services.SortBy.DISTANCE });
        });
        if(!one.length) break;
        pages.push(...one);
      }
      return pages;
    };

    const collectByCodes = async (codes)=>{
      for(const r of SEARCH_RADIUSES){
        const chunks = await Promise.all(codes.map(c=>categorySearchPages(c, r)));
        const merged = uniqById([].concat(...chunks));
        if(merged.length) return merged;
      }
      return [];
    };

    const participants = (cache&&cache.participants)||[];

    const scoreAndTag = (list, cat)=>{
      const enriched = list.map(p=>{
        const sc = scorePlace(p, participants);
        return { ...p, cat, _score: sc.total, _reasons: sc.reasons };
      });
      const sorted = [...enriched].sort((a,b)=>b._score-a._score);
      return sorted;
    };

    const fetchFood = async ()=>{
      const list = await collectByCodes([CODES.food]);
      return scoreAndTag(list, 'food');
    };
    const fetchCafe = async ()=>{
      const list = await collectByCodes([CODES.cafe]);
      return scoreAndTag(list, 'cafe');
    };
    const fetchPlay = async ()=>{
      const list = await collectByCodes(Array.isArray(CODES.play)? CODES.play : [CODES.play]);
      return scoreAndTag(list, 'play');
    };
    const fetchPub = async ()=>{
      // Start from FD6, then filter likely pubs by name/category tokens; fallback to keyword search tokens if empty
      let list = await collectByCodes([CODES.food]);
      const pubTokens = ['술집','주점','바','펍','와인바','칵테일','포차','호프','맥주','이자카야','wine','pub','bar','izakaya','tap'];
      const isPub = p=>{
        const s = `${p.place_name||''} ${p.category_name||''}`;
        return pubTokens.some(t=>s.includes(t));
      };
      const pubs = list.filter(isPub);
      return scoreAndTag(pubs, 'pub');
    };

    const [listFood, listPub, listCafe, listPlay] = await Promise.all([
      fetchFood(), fetchPub(), fetchCafe(), fetchPlay()
    ]);

    const allUnion = uniqById([].concat(listFood, listPub, listCafe, listPlay));
    const rank_all = [...allUnion].sort((a,b)=>b._score-a._score);

    return {
      rank_all,
      rank_food: listFood,
      rank_pub: listPub,
      rank_cafe: listCafe,
      rank_play: listPlay
    };
  }

  // '뭐 할지 찾기' 버튼 클릭 시 카테고리 팝업 열기
  async function openAreaCourses(area){
    status(`📡 ${area.name} 주변 탐색 중...`);
    try {
      // 기존 중간지점/Top1~3 마커는 유지 (사용자가 비교 가능하도록)
      
      const ranks = await buildAreaRanks(area);
      cache.selectedArea = { ...area, ranks };
      showTop3Popup([], { mode: 'areaCourses', categories: true });
    } catch(e) {
      console.error('openAreaCourses 오류:', e);
      status('❌ 주변 탐색 실패');
      toast('주변 장소를 가져오는데 실패했습니다.');
    }
  }

  // 좌표로 해당 Top 마커(번호 원형)를 복원
  function restoreAreaMarkerAt(lat, lng){
    try{
      if(!cache || !cache.areas || !Array.isArray(cache.areas)) return;
      // 캐시에 저장된 Top 목록에서 동일 좌표의 인덱스를 찾음
      const epsilon = 1e-6;
      const idx = cache.areas.findIndex(a => Math.abs((a.y?parseFloat(a.y):a.lat) - lat) < epsilon && Math.abs((a.x?parseFloat(a.x):a.lng) - lng) < epsilon);
      if(idx < 0) return;
      const position = new kakao.maps.LatLng(lat, lng);
      const areaIconContent = document.createElement('div');
      areaIconContent.style.cssText='background:#111;width:44px;height:44px;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:bold;color:#fff';
      areaIconContent.textContent=idx+1;
      const m = new kakao.maps.CustomOverlay({
        position,
        content: areaIconContent,
        xAnchor: 0.5,
        yAnchor: 0.5,
        zIndex: 11
      });
      m.setMap(map);
      areaMarkers.push(m);
      // 클릭 시 기존 로직과 동일하게 경로 선택 팝업 표시
      const area = cache.areas[idx];
      areaIconContent.addEventListener('click', async (e)=>{
        e.stopPropagation();
        try {
          if(window.currentInfoWindow && window.currentInfoWindow.close) {
            window.currentInfoWindow.close();
            window.currentInfoWindow = null;
          }
          top3Title.textContent = `${area.name} 가는 방법`;
          top3List.innerHTML='';
          showRouteModeTabs(area, '자가용');
          top3Popup.classList.remove('hidden');
          top3Popup.setAttribute('aria-hidden', 'false');
          status(`📍 ${area.name} 경로 선택 중...`);
        } catch(err) {
          console.error('마커 클릭 오류:', err);
          status('❌ 경로 선택 실패');
        }
      });
    }catch(_){ }
  }

  function renderAreaTop3(areas){
    const el = $('#results'); el.innerHTML='';
    const centerCard = buildCenterCard();
    if(centerCard) el.appendChild(centerCard);
    const top = areas.slice(0,3);
    if(top.length===0){
      hideTop3Popup();
      const empty=document.createElement('div');
      empty.className='card';
      empty.textContent='지역 결과 없음';
      el.appendChild(empty);
      expandSheet();
      return;
    }

    const hint=document.createElement('div');
    hint.className='card card-hint';
    hint.innerHTML='<div style="font-weight:700;margin-bottom:6px">추천 지역 Top3가 지도에 표시되었습니다.</div><div style="font-size:13px;color:#586076;">지도 위 "TOP 3 보기" 버튼을 클릭하여 팝업을 열 수 있습니다.</div>';
    el.appendChild(hint);

    // 팝업 데이터 저장 (자동 오픈 제거)
    lastPopup = { items: top, options: { title:'인기 지역 Top3', mode:'area' } };
    // showTop3Popup 자동 호출 제거 - 사용자가 버튼을 눌렀을 때만 열림
    
    // 레전드 표시
    if(legend) legend.style.display='block';
    
    // 바텀시트 접기 (지도에 마커가 표시되므로 시트는 접혀있어야 함)
    collapseSheet();
  }

  function showAreaCategories(area){
    const el = $('#results'); el.innerHTML='';
    const centerCard = buildCenterCard();
    if(centerCard) el.appendChild(centerCard);
    const categories = [
      { name: '전체', key: 'all' },
      { name: '맛집', key: 'food' },
      { name: '술집', key: 'pub' },
      { name: '카페', key: 'cafe' },
      { name: '놀거리', key: 'play' }
    ];
    
    categories.forEach(cat=>{
      const card=document.createElement('div'); card.className='card';
      card.innerHTML = `
        <div style=\"display:flex;justify-content:space-between;align-items:center\">
          <div style=\"font-weight:700\">${area.name} ${cat.name}</div>
          <button data-cat=\"${cat.key}\" class=\"btnCategoryPick\">보기</button>
        </div>
        <div style=\"color:#666;font-size:13px\">${area.name} 지역의 ${cat.name} Top3</div>`;
      el.appendChild(card);
    });
    
    el.querySelectorAll('.btnCategoryPick').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const cat = btn.getAttribute('data-cat');
        status(`✅ ${area.name} ${cat} 선택 — 결과 리스트 준비`);
        // 실제 검색 데이터가 없으므로 빈 목록 처리
        renderEmptyList(`${area.name} 지역의 ${cat} 결과가 아직 없어요.`, { onReset: ()=>showAreaCategories(area) });
      });
    });
  }

  // Autocomplete for inputs
  function attachAutocomplete(input){
    if(!input) return;
    const ac=document.createElement('div');
    ac.style.cssText='position:absolute;z-index:15;background:#fff;border:1px solid #d8dce6;border-radius:12px;box-shadow:0 8px 24px rgba(17,23,34,.12);display:none;overflow:hidden';
    input.parentElement.style.position='relative';
    input.parentElement.appendChild(ac);
    const placeUnder=()=>{ ac.style.left=(input.offsetLeft)+'px'; ac.style.top=(input.offsetTop+input.offsetHeight+6)+'px'; ac.style.minWidth=(input.offsetWidth)+'px' };
    const hide=()=>{ ac.style.display='none' };
    let isSelecting=false; // 항목 선택 중 플래그
    const show=(items)=>{
      if(!items.length || isSelecting){ hide(); return }
      placeUnder();
      ac.innerHTML='';
      items.slice(0,5).forEach(p=>{
        const it=document.createElement('div');
        it.style.cssText='padding:10px 12px;cursor:pointer;font-size:14px';
        it.textContent=p.place_name || p.road_address_name || p.address_name;
        it.addEventListener('click',()=>{ 
          isSelecting=true; // 선택 중 플래그 설정
          input.value=it.textContent; 
          hide(); 
          // p1 입력에서 목록 선택 시 즉시 사람 아이콘 표시
          try{
            if(input && (input.id==='p1' || input.getAttribute('id')==='p1')){
              const lat = parseFloat(p.y);
              const lng = parseFloat(p.x);
              if(!isNaN(lat) && !isNaN(lng)){
                showMyLocationMarker(lat, lng);
                try{ if(map) map.setCenter(new kakao.maps.LatLng(lat, lng)); }catch(_){ }
              }
            } else if(input && (input.id==='p2' || input.getAttribute('id')==='p2')){
              const lat = parseFloat(p.y);
              const lng = parseFloat(p.x);
              if(!isNaN(lat) && !isNaN(lng)){
                showMyLocationMarker2(lat, lng);
                try{ if(map) map.setCenter(new kakao.maps.LatLng(lat, lng)); }catch(_){ }
              }
            }
          }catch(_){ }
          // 잠시 후 플래그 해제 (입력 이벤트가 발생해도 드롭다운이 다시 나타나지 않도록)
          setTimeout(()=>{ isSelecting=false; }, 300);
        });
        it.addEventListener('mouseenter',()=>{ it.style.background='#f5f7fb' });
        it.addEventListener('mouseleave',()=>{ it.style.background='' });
        ac.appendChild(it);
      });
      ac.style.display='block';
    };
    const fetchAC=debounce((q)=>{
      if(!q||q.length<2 || isSelecting){ hide(); return }
      ps.keywordSearch(q,(data,status)=>{
        if(status===kakao.maps.services.Status.OK&&data && !isSelecting){ show(data) }
        else hide();
      },{size:5});
    }, 250);
    input.addEventListener('input',()=>fetchAC(input.value.trim()));
    input.addEventListener('blur',()=>setTimeout(hide,150));
    input.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); $('#btnCenter').click(); hide(); }});
  }

  function beginDrag(y,{pointerId=null,type=null}={}){
    const collapsedOffset=getCollapsedOffset();
    const canCollapse=collapsedOffset>16;
    dragState.active=canCollapse;
    dragState.startY=y;
    dragState.startOffset=sheetOpen ? 0 : collapsedOffset;
    dragState.currentOffset=dragState.startOffset;
    dragState.maxOffset=collapsedOffset;
    dragState.moved=false;
    dragState.pointerId=pointerId;
    dragState.type=type;
    if(canCollapse){
      sheet.classList.remove('open', 'collapsed');
      sheet.classList.add('dragging');
      sheet.style.setProperty('--sheet-offset', `${dragState.currentOffset}px`);
    }
  }

  function updateDrag(y){
    if(!dragState.active) return;
    const delta=y-dragState.startY;
    if(Math.abs(delta)>4) dragState.moved=true;
    const maxOffset=dragState.maxOffset || getCollapsedOffset();
    const next=Math.max(0, Math.min(maxOffset, dragState.startOffset + delta));
    dragState.currentOffset=next;
    sheet.style.setProperty('--sheet-offset', `${next}px`);
  }

  function finishDrag({allowTapToggle=true}={}){
    if(dragState.type==='pointer' && dragState.pointerId!=null){
      try{ sheetHeader.releasePointerCapture(dragState.pointerId); }catch(_){/* ignore */}
    }
    const wasActive=dragState.active;
    const moved=dragState.moved;
    const maxOffset=dragState.maxOffset || getCollapsedOffset();
    const currentOffset=dragState.currentOffset;
    sheet.classList.remove('dragging');
    sheet.style.removeProperty('--sheet-offset');
    resetDragState();

    if(!wasActive){
      if(allowTapToggle){
        setSheetState(!sheetOpen);
      }
      return;
    }

    if(!moved && allowTapToggle){
      setSheetState(!sheetOpen);
      return;
    }

    const shouldOpen=currentOffset <= maxOffset/2;
    setSheetState(shouldOpen);
  }

  const supportsPointer = typeof window !== 'undefined' && 'PointerEvent' in window;

  if(supportsPointer){
    sheetHeader.addEventListener('pointerdown', e=>{
      if(e.pointerType==='mouse' && e.button!==0) return;
      beginDrag(e.clientY,{pointerId:e.pointerId,type:'pointer'});
      if(dragState.active){
        try{ sheetHeader.setPointerCapture(e.pointerId); }catch(_){/* ignore */}
      }
    });

    sheetHeader.addEventListener('pointermove', e=>{
      if(dragState.pointerId!==e.pointerId) return;
      if(dragState.active && e.cancelable) e.preventDefault();
      updateDrag(e.clientY);
    });

    sheetHeader.addEventListener('pointerup', e=>{
      const allowTapToggle = dragState.pointerId===e.pointerId;
      finishDrag({allowTapToggle});
    });

    sheetHeader.addEventListener('pointercancel', ()=>{
      finishDrag({allowTapToggle:false});
    });
  } else {
    let touchId=null;

    sheetHeader.addEventListener('touchstart', e=>{
      if(touchId!=null) return;
      const t=e.changedTouches[0];
      touchId=t.identifier;
      beginDrag(t.clientY,{type:'touch'});
    }, {passive:true});

    sheetHeader.addEventListener('touchmove', e=>{
      if(touchId==null) return;
      const t=Array.from(e.changedTouches).find(tt=>tt.identifier===touchId);
      if(!t) return;
      if(dragState.active && e.cancelable) e.preventDefault();
      updateDrag(t.clientY);
    }, {passive:false});

    const endTouch = allowTapToggle=>{
      touchId=null;
      finishDrag({allowTapToggle});
    };

    sheetHeader.addEventListener('touchend', ()=>endTouch(true));
    sheetHeader.addEventListener('touchcancel', ()=>endTouch(false));

    sheetHeader.addEventListener('mousedown', e=>{
      if(e.button!==0) return;
      beginDrag(e.clientY,{type:'mouse'});
      const moveHandler=ev=>{
        if(!dragState.active) return;
        updateDrag(ev.clientY);
      };
      const upHandler=()=>{
        document.removeEventListener('mousemove', moveHandler);
        document.removeEventListener('mouseup', upHandler);
        finishDrag({allowTapToggle:true});
      };
      document.addEventListener('mousemove', moveHandler);
      document.addEventListener('mouseup', upHandler);
    });
  }

  sheetHeader.addEventListener('keydown', e=>{
    if(e.key==='Enter' || e.key===' '){
      e.preventDefault();
      setSheetState(!sheetOpen);
    }
  });

  top3Close.addEventListener('click', ()=>{
    hideTop3Popup();
  });

  // 팝업 내용 클릭은 백드롭으로 전파되지 않도록
  if(top3Content){ top3Content.addEventListener('click', e=> e.stopPropagation()); }

  top3Popup.addEventListener('click', e=>{
    if(e.target===top3Popup){
      if(top3Popup.dataset.lock==='true') return; // areaCourses 모드에서는 백드롭 클릭으로 닫히지 않음
      hideTop3Popup();
    }
  });

  // 초기 시트 상태: localStorage 복원
  let initialOpen = false;
  try{ initialOpen = localStorage.getItem('sheetOpen') === 'true'; }catch(_){ initialOpen = false }
  setSheetState(initialOpen);
  hideTop3Popup();

  // Attach autocomplete to inputs
  attachAutocomplete($('#p1'));
  attachAutocomplete($('#p2'));

  // 내 위치 버튼 이벤트 (참여자1만)
  document.querySelector('.btn-location').addEventListener('click', async ()=>{
    try{
      status(`📍 위치 감지 중...`);
      const {lat, lng} = await getCurrentLocation();
      const addr = await reverseGeocode(lat, lng);
      $('#p1').value = addr;
      status(`✅ 위치 감지됨: ${addr}`);
      // 즉시 사람 아이콘(내 위치) 표시
      showMyLocationMarker(lat, lng);
      // 지도의 중심을 현재 위치로 이동(초기 피드백 강화)
      try{ if(map) map.setCenter(new kakao.maps.LatLng(lat, lng)); }catch(_){ }
      // 바텀시트 상태 유지 (강제 접힘 제거)
    }catch(e){
      console.error(e);
      status(`❌ 위치 감지 실패: ${e}`);
    }
  });

  // 버튼: 중간지점 → 후보 수집 → 랭킹
  $('#btnCenter').addEventListener('click', async ()=>{
    try{
      // 이전 경로/오버레이/팝업 정리
      hideTop3Popup();
      clearRouteArtifacts();

      isSearching=true; renderPlaceList([]);
      const tabs=$('#tabs'); if(tabs) tabs.style.display='none';
      status('🧭 중간지점 계산…');
      const q1 = ($('#p1').value||'').trim(), q2 = ($('#p2').value||'').trim();
      if(!q1||!q2) return alert('참여자 2명 이상 입력');
      const [g1,g2] = await Promise.all([geocodeOne(q1), geocodeOne(q2)]);
      if(!g1||!g2) return alert('장소 해석 실패');
      const participants=[{lat:g1.lat,lng:g1.lng},{lat:g2.lat,lng:g2.lng}];

      const center = geometricCenter(participants);
      setOrigin(center.lat, center.lng, participants);

      status('📍 중간지점 주소 확인 중…');
      const centerAddress = await reverseGeocode(center.lat, center.lng);

      // 키워드 검색 대신 미리 정의된 인기 지역들 사용
      status(`📡 인기 지역 분석 중...`);
      const popularAreas = await getPopularAreas(center);

      const participantsInfo = [g1, g2].map((geo, idx)=>{
        const base = geo.raw||{};
        const display = base.place_name || base.road_address_name || base.address_name || (idx===0 ? q1 : q2);
        return {
          label: `참여자${idx+1}`,
          display,
          distance: haversine({lat:geo.lat,lng:geo.lng}, center)
        };
      });

      cache = {
        participants,
        center,
        centerAddress,
        participantInfo: participantsInfo,
    areas: popularAreas
      };
      renderAreaTop3(popularAreas);      

      // 선택된 지역들을 지도에 마커로 표시
      addAreaMarkers(popularAreas);
      const distInfo = popularAreas.map(a => `${a.name}(${formatDistance(a.distance)})`).join(', ');
      status(`✅ 중간지점: ${centerAddress} (${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}) | 추천지역: ${distInfo}`);
      toast('Top3가 팝업으로 표시됩니다');
      isSearching=false;
    }catch(e){
      console.error(e); status('❌ 오류 발생');
      isSearching=false; toast('오류가 발생했어요. 다시 시도해 주세요');
    }
  });


  status('✅ 준비됨 — 하단 패널을 끌어올려 참여자 장소를 입력하고 "중간지점→지역 Top3"를 눌러보세요');
  
  return { map, ps, geocoder, toast, status };
}

let map, ps, geocoder;

// UI 먼저 초기화 (항상 실행)
initUI();

export function initApp(){
  // 지도 초기화 (SDK 있으면)
  if(typeof kakao !== 'undefined' && kakao.maps){
    map = new kakao.maps.Map(document.getElementById('map'), {
      center: new kakao.maps.LatLng(37.4979,127.0276), level:5
    });
    ps = new kakao.maps.services.Places();
    geocoder = new kakao.maps.services.Geocoder();
  }
}
