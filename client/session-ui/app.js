import { geometricCenter, clusterAreas } from './core/center.js';
import { categorizeAndRank, createAreaRanks } from './core/rank.js';

export function initApp(){
  const map = new kakao.maps.Map(document.getElementById('map'), {
    center: new kakao.maps.LatLng(37.4979,127.0276), level:5
  });
  const ps = new kakao.maps.services.Places();
  const geocoder = new kakao.maps.services.Geocoder();
  const $ = s=>document.querySelector(s);
  const status = t=>($('#status').textContent=t);

  let originMarker=null, cache=null;

  function setOrigin(lat,lng){
    if(originMarker) originMarker.setMap(null);
    originMarker=new kakao.maps.Marker({ position:new kakao.maps.LatLng(lat,lng), zIndex:10 });
    originMarker.setMap(map); map.setCenter(originMarker.getPosition()); map.setLevel(5);
  }

  function addAreaMarkers(areas){
    areas.forEach((area, idx)=>{
      const m = new kakao.maps.Marker({ 
        position: new kakao.maps.LatLng(area.lat, area.lng),
        title: area.name
      }); 
      m.setMap(map);
      
      // 마커에 번호 표시
      const label = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(area.lat, area.lng),
        content: `<div style="background:#111;color:#fff;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;">${idx+1}</div>`,
        yAnchor: 0.5
      });
      label.setMap(map);
      
      kakao.maps.event.addListener(m, 'click', ()=>{
        const iw = new kakao.maps.InfoWindow({ 
          content: `<div style="padding:8px"><strong>${area.name}</strong><br/>거리: ${Math.round(area.distance/1000)}km</div>` 
        });
        iw.open(map, m);
      });
    });
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
        },
        {timeout: 5000, enableHighAccuracy: true}
      );
    });
  }

  function reverseGeocode(lat, lng){
    return new Promise(res=>{
      geocoder.coord2Address(lng, lat, (data, status)=>{
        if(status===kakao.maps.services.Status.OK && data && data.length){
          // 도로명주소 우선, 없으면 지번주소
          const addr = data[0].road_address ? data[0].road_address.address_name : data[0].address.address_name;
          res(addr);
        } else res(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
      });
    });
  }

  // 미리 정의된 인기 지역들 (전국 주요 도시 & 관광지)
  const POPULAR_AREAS = [
    // 서울 (강남권)
    { name: '강남', lat: 37.4979, lng: 127.0276, keywords: ['강남역', '신논현역', '역삼역'] },
    { name: '홍대', lat: 37.5563, lng: 126.9226, keywords: ['홍대입구역', '상수역', '합정역'] },
    { name: '이태원', lat: 37.5347, lng: 126.9947, keywords: ['이태원역', '한강진역', '녹사평역'] },
    { name: '명동', lat: 37.5636, lng: 126.9826, keywords: ['명동역', '을지로입구역', '회현역'] },
    { name: '신촌', lat: 37.5551, lng: 126.9368, keywords: ['신촌역', '이대역', '아현역'] },
    { name: '건대', lat: 37.5407, lng: 127.0692, keywords: ['건대입구역', '구의역', '뚝섬역'] },
    { name: '잠실', lat: 37.5133, lng: 127.1028, keywords: ['잠실역', '석촌역', '송파역'] },
    { name: '압구정', lat: 37.5275, lng: 127.0286, keywords: ['압구정역', '신사역', '청담역'] },
    { name: '성수', lat: 37.5446, lng: 127.0559, keywords: ['성수역', '뚝섬역', '한남역'] },
    { name: '여의도', lat: 37.5219, lng: 126.9242, keywords: ['여의도역', '여의나루역', '샛강역'] },
    
    // 부산
    { name: '부산 서면', lat: 35.1596, lng: 129.0735, keywords: ['서면역', '부산 중심가', '서면 백화점'] },
    { name: '부산 해운대', lat: 35.1629, lng: 129.1606, keywords: ['해운대역', '해운대 해수욕장', '스카이시티'] },
    { name: '부산 남포동', lat: 35.0979, lng: 129.0328, keywords: ['남포동', '광복로', 'BIFF광장'] },
    
    // 대구
    { name: '대구 중심', lat: 35.8748, lng: 128.5933, keywords: ['신세계', '동성로', '반월당역'] },
    { name: '대구 팔공산', lat: 35.8946, lng: 128.6546, keywords: ['팔공산', '동화사', '팔공산 케이블카'] },
    
    // 인천
    { name: '인천 송도', lat: 37.3862, lng: 126.6431, keywords: ['송도', 'IFC', '센트럴파크'] },
    { name: '인천 주안', lat: 37.4539, lng: 126.6381, keywords: ['주안역', '차이나타운', '개항장'] },
    
    // 광주
    { name: '광주 중심', lat: 35.1596, lng: 126.8519, keywords: ['충장로', '광주 종로', '문화전당'] },
    
    // 대전
    { name: '대전 둔산', lat: 36.3504, lng: 127.3845, keywords: ['둔산', '대전 시청', '엑스포'] },
    
    // 강원도 관광지
    { name: '강릉 경포', lat: 37.7633, lng: 128.9008, keywords: ['경포 해수욕장', '강릉 해변', '경포대'] },
    { name: '강릉 동해', lat: 37.5154, lng: 129.1197, keywords: ['정동진', '동해 바다', '동해 일출'] },
    { name: '평창 스키', lat: 37.1106, lng: 127.0095, keywords: ['용평리조트', '이천', '고깡마을'] },
    { name: '남이섬', lat: 37.9709, lng: 127.1170, keywords: ['남이섬', '종로', '강촌'] },
    { name: '춘천 의암호', lat: 37.8781, lng: 127.7381, keywords: ['춘천', '의암호', '나미섬'] },
    
    // 제주도
    { name: '제주 시내', lat: 33.5136, lng: 126.5292, keywords: ['제주시', '용담동', '제주 중심'] },
    { name: '서귀포 중심', lat: 33.2543, lng: 126.5641, keywords: ['서귀포', '중문관광단지', '성산'] },
    { name: '제주 한라산', lat: 33.3617, lng: 126.5305, keywords: ['한라산', '백록담', '한라산 국립공원'] },
    { name: '제주 우도', lat: 33.5062, lng: 126.9481, keywords: ['우도', '산호사해수욕장', '검멀레'] },
    { name: '제주 중문', lat: 33.2554, lng: 126.4145, keywords: ['중문관광단지', '해수욕장', '도근마을'] },
    
    // 경주 (문화유산)
    { name: '경주 대릉원', lat: 35.8460, lng: 129.2264, keywords: ['대릉원', '불국사', '석굴암'] },
    
    // 전주 (전통)
    { name: '전주 한옥마을', lat: 35.8242, lng: 127.1476, keywords: ['한옥마을', '경기전', '전주 중심'] }
  ];

  async function getPopularAreas(center){
    // 중간지점에서 각 인기 지역까지의 거리 계산
    const areasWithDistance = POPULAR_AREAS.map(area => {
      const distance = haversine(center, { lat: area.lat, lng: area.lng });
      return { ...area, distance };
    });
    
    // 거리순으로 정렬하고 Top3 선택
    return areasWithDistance
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3);
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
    const top = list.slice(0,3);
    if(top.length===0){ el.innerHTML='<div class="card">결과 없음</div>'; return; }
    top.forEach(p=>{
      const card=document.createElement('div'); card.className='card';
      card.innerHTML = `
        <div style="font-weight:700">${p.place_name||'(이름 없음)'}</div>
        <div style="color:#666;font-size:13px">${p.road_address_name||p.address_name||''}</div>
        <div style="margin:6px 0">
          <span class="badge">${p.cat||'기타'}</span>
          <span class="badge">${p._reasons.join(' · ')}</span>
        </div>
        <div style="display:flex;gap:8px">
          <a class="detail" href="${p.place_url||'#'}" target="_blank"><button>상세</button></a>
        </div>`;
      el.appendChild(card);
    });
  }

  function renderAreaTop3(areas){
    const el = $('#results'); el.innerHTML='';
    const top = areas.slice(0,3);
    if(top.length===0){ el.innerHTML='<div class=\"card\">지역 결과 없음</div>'; return; }
    top.forEach((area, idx)=>{
      const card=document.createElement('div'); card.className='card';
      card.innerHTML = `
        <div style=\"display:flex;justify-content:space-between;align-items:center\">
          <div style=\"font-weight:700\">${area.name}</div>
          <button data-idx=\"${idx}\" class=\"btnAreaPick\">선택</button>
        </div>
        <div style=\"color:#666;font-size:13px\">거리: ${Math.round(area.distance/1000)}km</div>
        <div style=\"margin:6px 0\"><span class=\"badge\">인기 지역</span></div>`;
      el.appendChild(card);
    });
    el.querySelectorAll('.btnAreaPick').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const idx=parseInt(btn.getAttribute('data-idx'),10);
        const area = top[idx];
        cache._selectedArea = area;
        showAreaCategories(area);
        status(`✅ 지역 선택: ${area.name} — 카테고리 선택`);
      });
    });
  }

  function showAreaCategories(area){
    const el = $('#results'); el.innerHTML='';
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
        status(`✅ ${area.name} ${cat} 선택 — 실제 장소 검색 필요`);
      });
    });
  }

  // 내 위치 버튼 이벤트 (참여자1만)
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

  // 버튼: 중간지점 → 후보 수집 → 랭킹
  $('#btnCenter').addEventListener('click', async ()=>{
    try{
      status('🧭 중간지점 계산…');
      const q1 = ($('#p1').value||'').trim(), q2 = ($('#p2').value||'').trim();
      if(!q1||!q2) return alert('참여자 2명 이상 입력');
      const [g1,g2] = await Promise.all([geocodeOne(q1), geocodeOne(q2)]);
      if(!g1||!g2) return alert('장소 해석 실패');
      const participants=[{lat:g1.lat,lng:g1.lng},{lat:g2.lat,lng:g2.lng}];

      const center = geometricCenter(participants);
      setOrigin(center.lat, center.lng);

      // 키워드 검색 대신 미리 정의된 인기 지역들 사용
      status(`📡 인기 지역 분석 중...`);
      const popularAreas = await getPopularAreas(center);

      cache = { participants, center, areas: popularAreas };
      renderAreaTop3(popularAreas);
      
      // 선택된 지역들을 지도에 마커로 표시
      addAreaMarkers(popularAreas);
      const distInfo = popularAreas.map(a => `${a.name}(${Math.round(a.distance/1000)}km)`).join(', ');
      status(`✅ 중간지점: (${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}) | 가까운지역: ${distInfo}`);
    }catch(e){
      console.error(e); status('❌ 오류 발생');
    }
  });

  // 탭 전환: 재검색 없이 캐시 필터
  document.querySelectorAll('#tabs .tab').forEach(tab=>{
    tab.addEventListener('click', ()=>{
      if(!cache) return status('ℹ️ 먼저 중간지점을 계산하세요');
      document.querySelectorAll('#tabs .tab').forEach(t=>t.classList.remove('on'));
      tab.classList.add('on');
      const cat=tab.dataset.cat;
      const table = { all:'rank_all', food:'rank_food', pub:'rank_pub', cafe:'rank_cafe', play:'rank_play' }[cat] || 'rank_all';
      const area = cache._areaPick || (cache._areas ? cache._areas[0] : null);
      if(area){
        renderTop3(area.ranks[table]);
      } else {
        renderAreaTop3(cache._areas||[]);
      }
    });
  });

  status('✅ 준비됨 — 참여자 장소 입력 후 “중간지점→Top3” 클릭');
}
