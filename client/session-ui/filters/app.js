import { geometricCenter, clusterAreas } from './core/center.js';
import { categorizeAndRank, createAreaRanks, scorePlace } from './core/rank.js';

export function initApp(){
  // 1) 지도/서비스 인스턴스 초기화 -------------------------------------------
  const map = new kakao.maps.Map(document.getElementById('map'), {
    center: new kakao.maps.LatLng(37.4979,127.0276), level:5 // 기본: 강남역 인근
  });
  const ps = new kakao.maps.services.Places();        // 장소 검색
  const geocoder = new kakao.maps.services.Geocoder();// 역지오코딩(좌표→주소)
  const directions = new kakao.maps.services.Directions(); // 경로 탐색(차량/보행 등)
  const $ = s=>document.querySelector(s);             // 짧은 셀렉터
  const status = t=>($('#status').textContent=t);     // 상태 텍스트 갱신
  // 간단 토스트 UI
  const toast = (msg)=>{ const el=$('#toast'); if(!el) return; el.textContent=msg; el.style.display='block'; clearTimeout(el._t); el._t=setTimeout(()=>{ el.style.display='none' }, 1600) };
  // 입력 자동완성 등에 쓰는 디바운서
  const debounce=(fn,ms=250)=>{ let h; return (...a)=>{ clearTimeout(h); h=setTimeout(()=>fn(...a),ms) } };

  // 2) 하단 시트/팝업 등 UI 엘리먼트 캐싱 --------------------------------------
  const sheet = $('#sheet');
  const sheetHeader = $('#sheetHeader');
  const top3Popup = $('#top3-popup');
  const top3Title = top3Popup.querySelector('.popup-title');
  const top3List = top3Popup.querySelector('.popup-list');
  const top3Close = top3Popup.querySelector('.popup-close');
  const top3Content = top3Popup.querySelector('.popup-content');

  // CSS 커스텀 속성('--peek')로부터 접힘 높이 가져오기
  const getPeek = ()=>parseInt(getComputedStyle(document.documentElement).getPropertyValue('--peek')) || 76;

  // 3) 지도/오버레이/상태 관련 런타임 변수 ------------------------------------
  let originMarker=null, cache=null, areaMarkers=[], areaLabels=[], participantsMarkers=[], polylines=[];
  let sheetOpen=false;           // 하단 시트 오픈 상태
  let isSearching=false;         // 로딩 스켈레톤 표시 제어
  // 시트 드래그(열고 닫기) 상태 묶음
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
  let lastPopup=null;            // 마지막으로 띄운 팝업(다시보기 지원용)

  // 드래그 상태 초기화
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

  // 현재 컨텐츠 높이를 기준으로 접힘 오프셋 계산
  function getCollapsedOffset(){
    const rect=sheet.getBoundingClientRect();
    return Math.max(0, rect.height - getPeek());
  }

  // 시트 펼침/접힘 토글(접을 수 없는 높이면 강제 open)
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
    // 사용자 선호(펼침/접힘) 저장
    try{ localStorage.setItem('sheetOpen', String(nextOpen)); }catch(_){/* ignore */}
  }

  // 보조 헬퍼
  function collapseSheet(){ setSheetState(false); }
  function expandSheet(){ setSheetState(true); }

  // Top3 팝업 숨김
  function hideTop3Popup(){
    top3Popup.classList.add('hidden');
    top3Popup.setAttribute('aria-hidden', 'true');
    top3List.innerHTML='';
  }

  // 카테고리별 아이콘(텍스트 이모지)
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

  // 4) Top3 팝업 렌더링(일반/지역코스 모드) -----------------------------------
  function showTop3Popup(items, options={}){
    const { title='추천 Top3', mode='place', categories=null } = options;
    // 일반 모드에서 목록이 비면 닫기
    if((!items || !items.length) && options.mode!=='areaCourses'){
      hideTop3Popup();
      return;
    }
    // '팝업 다시보기'를 위해 마지막 상태 저장
    lastPopup = { items, options: { ...options } };
    top3Title.textContent = title;
    top3List.innerHTML='';
    const popupTabs = $('#popup-tabs');
    popupTabs.innerHTML='';
    popupTabs.style.display='none';

    // (A) 지역 선택 후: 카테고리 탭 + 내부 리스트 렌더링 모드
    if(mode==='areaCourses' && categories && cache && cache.selectedArea){
      // areaCourses는 배경 클릭으로 닫히지 않도록 잠금
      try{ top3Popup.dataset.lock='true'; }catch(_){}
      const cats = ['all','food','pub','cafe','play'];
      const labels = {all:'전체',food:'맛집',pub:'술집',cafe:'카페',play:'놀거리'};
      // 탭 선택에 따라 해당 카테고리 테이블 렌더
      const renderCat=(cat)=>{
        const table={all:'rank_all',food:'rank_food',pub:'rank_pub',cafe:'rank_cafe',play:'rank_play'}[cat];
        const list=cache.selectedArea.ranks?.[table]||[];
        top3List.innerHTML='';
        list.slice(0,20).forEach((item,idx)=>{
          // 카드 헤더(순위/아이콘/이름)
          const card=document.createElement('div');
          card.className='popup-card';
          const h=document.createElement('div');
          h.className='popup-card-header';
          h.innerHTML=`<span class="popup-rank">${idx+1}</span><span class="popup-icon">${getCategoryIcon(item.cat||item.category)}</span><span class="popup-name">${item.place_name||item.name}</span>`;
          card.appendChild(h);
          // 메타(주소/스코어 이유 등)
          const m=document.createElement('div');
          m.className='popup-meta';
          if(item.road_address_name||item.address_name)m.appendChild(document.createElement('span')).textContent=item.road_address_name||item.address_name;
          if(item._reasons&&item._reasons.length)m.appendChild(document.createElement('span')).textContent=item._reasons.join(' · ');
          card.appendChild(m);
          // 길찾기 버튼(내부 경로 그리기)
          const linkBtn=document.createElement('button');
          linkBtn.type='button';
          linkBtn.className='popup-action';
          const lat=item.y?parseFloat(item.y):item.lat;
          const lng=item.x?parseFloat(item.x):item.lng;
          linkBtn.textContent='길찾기';
          linkBtn.addEventListener('click', async (e)=>{
            e.preventDefault();
            hideTop3Popup();

            // 기존 경로 제거 및 진행상태 표시
            polylines.forEach(p=>p.setMap(null));
            polylines=[];
            polylines.length=0;
            status('🗺️ 경로 계산 중...');

            // 각 참여자→목적지 경로를 색상별로 표시
            if(cache && cache.participants && cache.participants.length){
              const colors = ['#4caf50', '#f44336', '#2196f3', '#ff9800', '#9c27b0'];
              const promises = cache.participants.map(async (p, idx)=>{
                const origin = new kakao.maps.LatLng(p.lat, p.lng);
                const dest = new kakao.maps.LatLng(lat, lng);
                return new Promise(resolve=>{
                  directions.route({
                    origin,
                    destination: dest
                  }, (result, status)=>{
                    if(status===kakao.maps.services.Status.OK && result.routes && result.routes.length){
                      const routes = result.routes[0].summary;   // 총 거리/시간 등 요약
                      const polylinePath = result.routes[0].geometry; // 경로 좌표열
                      const polyline = new kakao.maps.Polyline({
                        path: polylinePath,
                        strokeColor: colors[idx % colors.length],
                        strokeOpacity:0.7,
                        strokeWeight:4
                      });
                      polyline.setMap(map);
                      polylines.push(polyline);

                      // 참여자 마커에 개별 경로 정보 툴팁 표시
                      if(participantsMarkers[idx]){
                        const iw = new kakao.maps.InfoWindow({
                          content: `<div style="padding:8px"><strong>참여자${idx+1}</strong><br/>→ ${item.place_name||'목적지'}<br/>${Math.round(routes.distance/1000*10)/10}km, ${Math.floor(routes.duration/60)}분</div>`
                        });
                        iw.open(map, participantsMarkers[idx]);
                      }
                      resolve({duration:routes.duration, distance:routes.distance});
                    } else resolve(null);
                  });
                });
              });

              // 평균 거리/시간 산출하여 상태바에 요약
              const results = await Promise.all(promises);
              const avgDist = results.filter(r=>r).reduce((a,b)=>a + b.distance,0) / results.filter(r=>r).length;
              const avgDur = results.filter(r=>r).reduce((a,b)=>a + b.duration,0) / results.filter(r=>r).length;
              status(`✅ 경로 표시 완료 (평균 ${Math.round(avgDist/1000*10)/10}km, ${Math.floor(avgDur/60)}분)`);

              // 목적지 마커 및 인포윈도우
              const destMarker = new kakao.maps.Marker({
                position: new kakao.maps.LatLng(lat, lng),
                zIndex:11
              });
              destMarker.setMap(map);

              const iw = new kakao.maps.InfoWindow({
                content: `<div style="padding:8px"><strong>${item.place_name||'목적지'}</strong><br/>${item.road_address_name || item.address_name || ''}</div>`
              });
              iw.open(map, destMarker);

              // 참여자+목적지 모두 보이도록 바운드 조정
              const bounds = new kakao.maps.LatLngBounds();
              bounds.extend(new kakao.maps.LatLng(lat, lng));
              cache.participants.forEach(p=>bounds.extend(new kakao.maps.LatLng(p.lat, p.lng)));
              map.setBounds(bounds);
            }
          });
          card.appendChild(linkBtn);
          top3List.appendChild(card);
        });
      };
      // 탭 버튼 렌더 및 기본 '전체' 선택
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
      renderCat('all');

      top3Title.textContent = `${cache.selectedArea.name} 추천코스`;
      top3Popup.classList.remove('hidden');
      top3Popup.setAttribute('aria-hidden','false');
      collapseSheet(); // 팝업 집중을 위해 시트 접기
      return; // areaCourses 모드 종료
    }

    // (B) 일반 Top3 팝업: 잠금 해제
    try{ delete top3Popup.dataset.lock; }catch(_){}

    // 리스트형 카드 렌더
    items.forEach((item, idx)=>{
      const card=document.createElement('div');
      card.className='popup-card';

      // 헤더: 순위/아이콘/이름
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

      // 메타: 거리/주소/스코어 이유 등
      const meta=document.createElement('div');
      meta.className='popup-meta';
      if(item.distance){
        meta.appendChild(document.createElement('span')).textContent=`중간지점에서 ${formatDistance(item.distance)}`;
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

      // 모드별 액션: 지역이면 '선택', 장소면 외부 길찾기 링크
      if(mode==='area'){
        const btn=document.createElement('button');
        btn.type='button';
        btn.className='popup-action';
        btn.textContent='선택';
        btn.addEventListener('click', async ()=>{
          try{
            status(`🔎 ${item.name} 주변 장소 수집 중…`);
            const ranked = await buildAreaRanks(item); // 카테고리별 랭킹 수집/계산
            const area = { ...item, ranks: ranked };
            cache.selectedArea = area;
            // 같은 팝업을 '코스 보기' 모드로 전환
            showTop3Popup([], { 
              title:`${item.name} 추천코스`,
              mode:'areaCourses',
              categories:true
            });
            status(`✅ 지역 선택: ${item.name} — 카테고리 선택`);
          }catch(e){
            console.error(e);
            status('❌ 지역 장소 수집 실패');
          }
        });
        card.appendChild(btn);
      } else {
        // 외부 카카오맵 길찾기 링크(좌표가 있으면 link/to, 없으면 place_url)
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

      // 팝업 내부 클릭이 백드롭으로 전파되지 않게 처리
      card.addEventListener('click', ev=>ev.stopPropagation());
      top3List.appendChild(card);
    });

    // 팝업 표시
    top3Popup.classList.remove('hidden');
    top3Popup.setAttribute('aria-hidden', 'false');
    collapseSheet(); // 팝업 집중을 위해 시트 접기
  }

  // 거리 포맷터(미터/킬로미터)
  const formatDistance = distance => {
    if(!distance && distance !== 0) return '';
    if(distance >= 1000) {
      const km = distance / 1000;
      return (km >= 10 ? Math.round(km) : km.toFixed(1)) + 'km';
    }
    return Math.round(distance/10)*10 + 'm';
  };

  // 5) 중심 마커/참여자 마커 표시 및 지도 초기 뷰 조정 -------------------------
  function setOrigin(lat,lng, participants=null){
    if(originMarker) originMarker.setMap(null);
    originMarker=new kakao.maps.Marker({ position:new kakao.maps.LatLng(lat,lng), zIndex:10 });
    originMarker.setMap(map);
    
    // 참여자 마커 새로 그림(재검색 시 중복 방지)
    if(participants && participants.length){
      participantsMarkers.forEach(m=>m.setMap(null));
      participantsMarkers=[];
      participants.forEach((p, idx)=>{
        const m=new kakao.maps.Marker({
          position:new kakao.maps.LatLng(p.lat,p.lng),
          zIndex:9,
          title: `참여자${idx+1}`
        });
        m.setMap(map);
        participantsMarkers.push(m);
      });
    }
    
    map.setCenter(originMarker.getPosition()); map.setLevel(5);
  }

  // 6) 추천 지역 마커/라벨 렌더 및 클릭 시 경로 탐색 ----------------------------
  function addAreaMarkers(areas){
    // 이전 마커/라벨 제거
    areaMarkers.forEach(m=>m.setMap(null));
    areaLabels.forEach(l=>l.setMap(null));
    areaMarkers=[]; areaLabels=[];
    const bounds = new kakao.maps.LatLngBounds();
    let hasBounds=false;

    // 중심점도 bounds에 포함(뷰 자동 조정)
    if(cache && cache.center){
      const cpos = new kakao.maps.LatLng(cache.center.lat, cache.center.lng);
      bounds.extend(cpos);
      hasBounds=true;
    }

    areas.forEach((area, idx)=>{
      const position = new kakao.maps.LatLng(area.lat, area.lng);
      const m = new kakao.maps.Marker({
        position,
        title: area.name
      });
      m.setMap(map);      
      areaMarkers.push(m);
      bounds.extend(position);
      hasBounds=true;

      // 순번 라벨(커스텀 오버레이)
      const label = new kakao.maps.CustomOverlay({
        position,
        content: `<div style="background:#111;color:#fff;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;">${idx+1}</div>`,
        yAnchor: 0.5
      });
      label.setMap(map);
      
      // 마커 클릭 → 참여자별 경로 계산 및 요약 표시
      kakao.maps.event.addListener(m, 'click', async ()=>{
        // 기존 경로 제거
        polylines.forEach(p=>p.setMap(null));
        polylines=[];
        polylines.length=0;
        
        const iw = new kakao.maps.InfoWindow({
          content: `<div style="padding:8px"><strong>${area.name}</strong><br/>중간지점에서 ${formatDistance(area.distance)}<br/><small style="color:#666">경로 계산 중...</small></div>`
        });
        iw.open(map, m);
        
        if(cache && cache.participants && cache.participants.length){
          const colors = ['#4caf50', '#f44336', '#2196f3', '#ff9800', '#9c27b0'];
          const promises = cache.participants.map(async (p, idx)=>{
            const origin = new kakao.maps.LatLng(p.lat, p.lng);
            const dest = new kakao.maps.LatLng(area.lat, area.lng);
            return new Promise(resolve=>{
              directions.route({
                origin,
                destination: dest
              }, (result, status)=>{
                if(status===kakao.maps.services.Status.OK && result.routes && result.routes.length){
                  const routes = result.routes[0].summary;
                  const polylinePath = result.routes[0].geometry;
                  const polyline = new kakao.maps.Polyline({
                    path: polylinePath,
                    strokeColor: colors[idx % colors.length],
                    strokeOpacity:0.6,
                    strokeWeight:3
                  });
                  polyline.setMap(map);
                  polylines.push(polyline);
                  resolve({duration:routes.duration, distance:routes.distance});
                } else resolve(null);
              });
            });
          });
          
          // 참여자별 거리/시간 요약 문자열 구성 후 인포윈도우 갱신
          const results = await Promise.all(promises);
          const infos = results.map((r,idx)=>`참여자${idx+1}: ${r ? `${Math.round(r.distance/1000*10)/10}km, ${Math.floor(r.duration/60)}분` : '경로없음'}`).join('<br/>');
          
          const iwUpdated = new kakao.maps.InfoWindow({
            content: `<div style="padding:8px"><strong>${area.name}</strong><br/>중간지점에서 ${formatDistance(area.distance)}<br/><hr style="margin:4px 0;border:none;border-top:1px solid #ddd"/>${infos}</div>`
          });
          iwUpdated.open(map, m);
        } else {
          // 참여자 정보 없으면 거리만 노출
          const iwUpdated = new kakao.maps.InfoWindow({
            content: `<div style="padding:8px"><strong>${area.name}</strong><br/>중간지점에서 ${formatDistance(area.distance)}</div>`
          });
          iwUpdated.open(map, m);
        }
      });
    });

    // 모든 마커가 보이도록 지도 영역 자동 조정
    if(hasBounds && typeof map.setBounds==='function'){
      try{
        map.setBounds(bounds, 60, 60, 320, 60); // 여백 지정(좌/상/우/하)
      }catch(_){
        try{ map.setBounds(bounds); }catch(__){/* noop */}
      }
    }
  }

  // 7) 문자열 키워드 → 지오코딩(첫번째 결과만 사용)
  function geocodeOne(q){
    return new Promise(res=>{
      ps.keywordSearch(q, (data, status)=>{
        if(status===kakao.maps.services.Status.OK && data && data.length){
          const p=data[0]; res({ lat:parseFloat(p.y), lng:parseFloat(p.x), raw:p });
        } else res(null);
      }, {size:10});
    });
  }

  // 8) 브라우저 Geolocation으로 현재 위치 얻기(참여자1용)
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

  // 9) 좌표 → 주소 문자열(간단 포맷)
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

  // 10) 하드코딩 인기 지역(스캔 실패 시 안전망)
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

  // 11) 중간지점 주변에서 '밀집 지역'을 방사형으로 스캔하여 Top3 도출 -------------
  async function getPopularAreas(center){
    // 기준 좌표/서비스 준비
    const loc = new kakao.maps.LatLng(center.lat, center.lng);
    const psLocal = new kakao.maps.services.Places();
    const bearings = [0,30,60,90,120,150,180,210,240,270,300,330]; // 12방향 방사
    // 참여자 평균거리 기반 탐색 반경(최소 1200 ~ 최대 6000)
    const avgDist = (cache && cache.participants && cache.participants.length)
      ? cache.participants.reduce((a,p)=>a + haversine(center, p),0)/cache.participants.length
      : 3000;
    const step = Math.max(1200, Math.min(6000, avgDist*0.6));
    const R = 6371000;
    const toRad = d=>d*Math.PI/180, toDeg = r=>r*180/Math.PI;

    // 중심에서 특정 방위/거리만큼 이동한 좌표 구하기(대원거리 공식)
    const move = (c, brgDeg, dist)=>{
      const brg = toRad(brgDeg);
      const lat1 = toRad(c.lat), lng1 = toRad(c.lng);
      const lat2 = Math.asin(Math.sin(lat1)*Math.cos(dist/R) + Math.cos(lat1)*Math.sin(dist/R)*Math.cos(brg));
      const lng2 = lng1 + Math.atan2(Math.sin(brg)*Math.sin(dist/R)*Math.cos(lat1), Math.cos(dist/R)-Math.sin(lat1)*Math.sin(lat2));
      return { lat: toDeg(lat2), lng: toDeg(lng2) };
    };

    // 해당 후보 좌표 주변 음식점 개수(밀집도 근사치)
    const categoryCount = cand=>new Promise(resolve=>{
      psLocal.categorySearch('FD6', (data, status)=>{
        if(status===kakao.maps.services.Status.OK && data){ resolve(data.length||0) }
        else resolve(0)
      }, { location: new kakao.maps.LatLng(cand.lat, cand.lng), radius: 1200, size: 15 });
    });

    // 후보 좌표의 라벨(행정동/주소 3뎁스) 추출
    const nameOf = (cand)=>new Promise(res=>{
      geocoder.coord2Address(cand.lng, cand.lat, (result, status)=>{
        if(status===kakao.maps.services.Status.OK && result && result.length){
          const addr=result[0];
          const label = addr.road_address?.region_3depth_name || addr.address?.region_3depth_name || addr.road_address?.address_name || addr.address?.address_name;
          res(label||'추천지점');
        } else res('추천지점');
      });
    });

    // 12방향 후보 생성 → 각 후보 밀집도/거리 계산
    const cands = await Promise.all(bearings.map(async b=>{
      const pos = move(center, b, step);
      const count = await categoryCount(pos);
      const name = await nameOf(pos);
      const distance = haversine(center, pos);
      return { name, lat: pos.lat, lng: pos.lng, distance, _density: count };
    }));

    // 스코어링: 밀집도↑, 거리↓
    const scored = cands.map(c=>({
      ...c,
      _score: (c._density*1.0) - (c.distance/2000) // 간단 가중치(경험적)
    }));

    const top = scored
      .sort((a,b)=>b._score-a._score)
      .slice(0,3)
      .map(({name,lat,lng,distance})=>({name,lat,lng,distance}));

    // 안전망: 스캔 실패 시 하드코딩 인기 지역에서 중간지점과의 거리 기준으로 Top3
    if(top.length===0){
      const areasWithDistance = POPULAR_AREAS.map(area => ({
        ...area,
        distance: haversine(center, { lat: area.lat, lng: area.lng })
      }));
      return areasWithDistance.sort((a,b)=>a.distance-b.distance).slice(0,3);
    }
    return top;
  }

  // Haversine 거리(m)
  function haversine(a, b){
    const R = 6371000, toRad = x => x * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const s1 = Math.sin(dLat/2)**2;
    const s2 = Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng/2)**2;
    return 2 * R * Math.asin(Math.sqrt(s1 + s2));
  }

  // 12) 장소 Top3를 팝업/시트에 렌더 -------------------------------------------
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

    // 팝업 힌트 카드 + '다시보기' 버튼
    const hint=document.createElement('div');
    hint.className='card card-hint';
    hint.innerHTML='<div style="font-weight:700;margin-bottom:6px">추천 장소 Top3가 팝업으로 표시됐어요</div><div style="font-size:13px;color:#586076;">팝업을 닫았다면 아래 버튼으로 다시 확인할 수 있습니다.</div>';
    const replay=document.createElement('button');
    replay.type='button';
    replay.className='btn-inline';
    replay.textContent='팝업 다시보기';
    replay.addEventListener('click', ()=>{
      if(lastPopup) showTop3Popup(lastPopup.items, lastPopup.options);
    });
    hint.appendChild(replay);
    el.appendChild(hint);

    // 실제 팝업 표시
    showTop3Popup(top, { title:'추천 장소 Top3', mode:'place' });
  }

  // 13) 빈 리스트 카드 렌더(필터 초기화 콜백 지원)
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

  // 14) 일반 리스트 렌더(로딩/빈결과/액션 버튼 포함)
  function renderPlaceList(items){
    const el = $('#results'); el.innerHTML='';
    const centerCard = buildCenterCard();
    if(centerCard) el.appendChild(centerCard);
    if(isSearching){
      // 로딩 스켈레톤
      const sk=document.createElement('div');
      sk.className='card';
      sk.innerHTML='<div style="display:flex;flex-direction:column;gap:10px">'+Array.from({length:5}).map(()=>'<div style="height:16px;background:#eef1f6;border-radius:8px"></div>').join('')+'</div>';
      el.appendChild(sk);
      expandSheet();
      return;
    }
    if(!items || !items.length){
      // 탭 초기화와 함께 빈 결과 처리
      renderEmptyList('조건에 맞는 장소가 없어요.', { onReset: ()=>{
        document.querySelector('#tabs .tab[data-cat="all"]').click();
      }});
      return;
    }
    // 실제 아이템 카드들
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
      actions.append(
        mkBtn('저장', ()=>{}),
        mkBtn('공유', ()=>{}),
        mkBtn('길찾기', ()=>{
          // 외부 길찾기: 카카오맵 'link/to' 사용
          const lat=item.y?parseFloat(item.y):item.lat; const lng=item.x?parseFloat(item.x):item.lng;
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

  // 15) 중간지점 카드(주소/참여자별 거리 요약)
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

    // 참여자별 직선거리 정보
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

  // 16) 지역 내 카테고리별 랭킹 수집(장소 검색→스코어→정렬) ---------------------
  async function buildAreaRanks(area){
    // Kakao category codes: CE7(cafe), FD6(restaurant), CT1(cultural facility), AT4(관광명소)
    const CODES = { cafe:'CE7', food:'FD6', play:['CT1','AT4'] };
    const SEARCH_RADIUSES = [4000, 5500, 7000]; // 반경을 늘려가며 시도
    const PAGE_COUNT = 4; // 페이지네이션(최대 약 60개)

    // ID 중복 제거(장소 ID 없으면 좌표 문자열로 대체)
    const uniqById = (arr)=>{
      const m=new Map();
      for(const p of arr){ const id=p.id||p.place_id||`${p.x},${p.y}`; if(!m.has(id)) m.set(id,p); }
      return Array.from(m.values());
    };

    // 카테고리 검색(반경/페이지네이션 포함)
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
        if(!one.length) break; // 더 없으면 중단
        pages.push(...one);
      }
      return pages;
    };

    // 여러 코드 묶음을 주고, 반경을 늘려가며 수집
    const collectByCodes = async (codes)=>{
      for(const r of SEARCH_RADIUSES){
        const chunks = await Promise.all(codes.map(c=>categorySearchPages(c, r)));
        const merged = uniqById([].concat(...chunks));
        if(merged.length) return merged;
      }
      return [];
    };

    const participants = (cache&&cache.participants)||[];

    // 스코어/태그 주입 후 정렬
    const scoreAndTag = (list, cat)=>{
      const enriched = list.map(p=>{
        const sc = scorePlace(p, participants);
        return { ...p, cat, _score: sc.total, _reasons: sc.reasons };
      });
      const sorted = [...enriched].sort((a,b)=>b._score-a._score);
      return sorted;
    };

    // 카테고리별 수집
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
      // 술집은 FD6에서 이름/카테고리 토큰으로 필터(별도 코드 부재 보완)
      let list = await collectByCodes([CODES.food]);
      const pubTokens = ['술집','주점','바','펍','와인바','칵테일','포차','호프','맥주','이자카야','wine','pub','bar','izakaya','tap'];
      const isPub = p=>{
        const s = `${p.place_name||''} ${p.category_name||''}`;
        return pubTokens.some(t=>s.includes(t));
      };
      const pubs = list.filter(isPub);
      return scoreAndTag(pubs, 'pub');
    };

    // 병렬 수집 및 총합 랭킹 생성
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

  // 17) 추천 지역 Top3(‘지역’ 단위) 렌더 + 팝업 ---------------------------------
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
    hint.innerHTML='<div style="font-weight:700;margin-bottom:6px">추천 지역 Top3가 팝업으로 표시됐어요</div><div style="font-size:13px;color:#586076;">지도를 가리는 대신 팝업에서 원하는 지역을 선택할 수 있습니다.</div>';
    const replay=document.createElement('button');
    replay.type='button';
    replay.className='btn-inline';
    replay.textContent='팝업 다시보기';
    replay.addEventListener('click', ()=>{
      if(lastPopup) showTop3Popup(lastPopup.items, lastPopup.options);
    });
    hint.appendChild(replay);
    el.appendChild(hint);

    showTop3Popup(top, { title:'인기 지역 Top3', mode:'area' });
  }

  // 18) (미사용 시나리오용) 카테고리 선택 리스트 UI ------------------------------
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
    
    // (현재는 실제 데이터 없이 빈 처리로 연결)
    el.querySelectorAll('.btnCategoryPick').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const cat = btn.getAttribute('data-cat');
        status(`✅ ${area.name} ${cat} 선택 — 결과 리스트 준비`);
        renderEmptyList(`${area.name} 지역의 ${cat} 결과가 아직 없어요.`, { onReset: ()=>showAreaCategories(area) });
      });
    });
  }

  // 19) 입력창 자동완성(간단 키워드 검색 기반) -----------------------------------
  function attachAutocomplete(input){
    if(!input) return;
    // 오버레이 컨테이너 동적 생성
    const ac=document.createElement('div');
    ac.style.cssText='position:absolute;z-index:15;background:#fff;border:1px solid #d8dce6;border-radius:12px;box-shadow:0 8px 24px rgba(17,23,34,.12);display:none;overflow:hidden';
    input.parentElement.style.position='relative';
    input.parentElement.appendChild(ac);
    // 위치/표시/숨김 유틸
    const placeUnder=()=>{ ac.style.left=(input.offsetLeft)+'px'; ac.style.top=(input.offsetTop+input.offsetHeight+6)+'px'; ac.style.minWidth=(input.offsetWidth)+'px' };
    const hide=()=>{ ac.style.display='none' };
    const show=(items)=>{
      if(!items.length){ hide(); return }
      placeUnder();
      ac.innerHTML='';
      items.slice(0,5).forEach(p=>{
        const it=document.createElement('div');
        it.style.cssText='padding:10px 12px;cursor:pointer;font-size:14px';
        it.textContent=p.place_name || p.road_address_name || p.address_name;
        it.addEventListener('click',()=>{ input.value=it.textContent; hide(); });
        it.addEventListener('mouseenter',()=>{ it.style.background='#f5f7fb' });
        it.addEventListener('mouseleave',()=>{ it.style.background='' });
        ac.appendChild(it);
      });
      ac.style.display='block';
    };
    // 디바운스된 검색
    const fetchAC=debounce((q)=>{
      if(!q||q.length<2){ hide(); return }
      ps.keywordSearch(q,(data,status)=>{
        if(status===kakao.maps.services.Status.OK&&data){ show(data) }
        else hide();
      },{size:5});
    }, 250);
    // 이벤트 바인딩
    input.addEventListener('input',()=>fetchAC(input.value.trim()));
    input.addEventListener('blur',()=>setTimeout(hide,150)); // blur 직후 클릭 반영을 위해 지연
    input.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); $('#btnCenter').click(); hide(); }});
  }

  // 20) 시트 드래그(포인터/터치/마우스) 이벤트 핸들링 -----------------------------
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
    if(Math.abs(delta)>4) dragState.moved=true; // 탭/클릭과 드래그 구분
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
      // 드래그가 아니면 탭으로 토글
      if(allowTapToggle){
        setSheetState(!sheetOpen);
      }
      return;
    }

    if(!moved && allowTapToggle){
      // 거의 움직이지 않았으면 탭 토글 간주
      setSheetState(!sheetOpen);
      return;
    }

    // 절반 기준으로 열림/닫힘 결정
    const shouldOpen=currentOffset <= maxOffset/2;
    setSheetState(shouldOpen);
  }

  // 포인터 이벤트 지원 여부 확인
  const supportsPointer = typeof window !== 'undefined' && 'PointerEvent' in window;

  // (A) Pointer Events 경로
  if(supportsPointer){
    sheetHeader.addEventListener('pointerdown', e=>{
      if(e.pointerType==='mouse' && e.button!==0) return; // 좌클릭만 유효
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
    // (B) Touch + Mouse 폴백 경로
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

    // 마우스 드래그 폴백
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

  // 키보드 접근성(Enter/Space로 토글)
  sheetHeader.addEventListener('keydown', e=>{
    if(e.key==='Enter' || e.key===' '){
      e.preventDefault();
      setSheetState(!sheetOpen);
    }
  });

  // 팝업 닫기 버튼/백드롭 동작(코스 모드에서는 잠금)
  top3Close.addEventListener('click', ()=>{
    hideTop3Popup();
  });
  if(top3Content){ top3Content.addEventListener('click', e=> e.stopPropagation()); }
  top3Popup.addEventListener('click', e=>{
    if(e.target===top3Popup){
      if(top3Popup.dataset.lock==='true') return;
      hideTop3Popup();
    }
  });

  // 초기 시트 상태 복원 + 팝업 숨김
  let initialOpen = false;
  try{ initialOpen = localStorage.getItem('sheetOpen') === 'true'; }catch(_){ initialOpen = false }
  setSheetState(initialOpen);
  hideTop3Popup();

  // 자동완성 연결(참여자 1,2 입력)
  attachAutocomplete($('#p1'));
  attachAutocomplete($('#p2'));

  // 21) 내 위치 버튼: 참여자1 입력값에 현재 위치 주소 채우기 ----------------------
  document.querySelector('.btn-location').addEventListener('click', async ()=>{
    try{
      status(`📍 위치 감지 중...`);
      const {lat, lng} = await getCurrentLocation();
      const addr = await reverseGeocode(lat, lng);
      $('#p1').value = addr;
      status(`✅ 위치 감지됨: ${addr}`);
    }catch(e){
      console.error(e);
      status(`❌ 위치 감지 실패: ${e}`);
    }
  });

  // 22) '중간지점' 버튼: 지오코딩→중간점→인기지역→표시 전체 플로우 ---------------
  $('#btnCenter').addEventListener('click', async ()=>{
    try{
      isSearching=true; renderPlaceList([]);           // 로딩 스켈레톤
      const tabs=$('#tabs'); if(tabs) tabs.style.display='none';
      status('🧭 중간지점 계산…');

      // 입력 확보 및 유효성
      const q1 = ($('#p1').value||'').trim(), q2 = ($('#p2').value||'').trim();
      if(!q1||!q2) return alert('참여자 2명 이상 입력');

      // 두 지점을 지오코딩
      const [g1,g2] = await Promise.all([geocodeOne(q1), geocodeOne(q2)]);
      if(!g1||!g2) return alert('장소 해석 실패');

      // 참여자 좌표 집합 및 중간지점(산술평균) 계산
      const participants=[{lat:g1.lat,lng:g1.lng},{lat:g2.lat,lng:g2.lng}];
      const center = geometricCenter(participants);
      setOrigin(center.lat, center.lng, participants);

      // 중간지점 주소 얻기(사용자에게 친절한 표시)
      status('📍 중간지점 주소 확인 중…');
      const centerAddress = await reverseGeocode(center.lat, center.lng);

      // 중간지점 주변 '인기 지역' 스캔(밀집도/거리 기반 Top3)
      status(`📡 인기 지역 분석 중...`);
      const popularAreas = await getPopularAreas(center);

      // 참여자별 중간지점 거리 요약(카드에 표시)
      const participantsInfo = [g1, g2].map((geo, idx)=>{
        const base = geo.raw||{};
        const display = base.place_name || base.road_address_name || base.address_name || (idx===0 ? q1 : q2);
        return {
          label: `참여자${idx+1}`,
          display,
          distance: haversine({lat:geo.lat,lng:geo.lng}, center)
        };
      });

      // 캐시(현재 세션 상태) 갱신
      cache = {
        participants,
        center,
        centerAddress,
        participantInfo: participantsInfo,
        areas: popularAreas
      };

      // 지역 Top3 UI 및 지도 마커 표시
      renderAreaTop3(popularAreas);      
      addAreaMarkers(popularAreas);

      // 상태바 요약
      const distInfo = popularAreas.map(a => `${a.name}(${formatDistance(a.distance)})`).join(', ');
      status(`✅ 중간지점: ${centerAddress} (${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}) | 추천지역: ${distInfo}`);
      toast('Top3가 팝업으로 표시됩니다');
      isSearching=false;
    }catch(e){
      console.error(e); status('❌ 오류 발생');
      isSearching=false; toast('오류가 발생했어요. 다시 시도해 주세요');
    }
  });

  // 초기 안내 문구
  status('✅ 준비됨 — 하단 패널을 끌어올려 참여자 장소를 입력하고 “중간지점→지역 Top3”를 눌러보세요');
}
