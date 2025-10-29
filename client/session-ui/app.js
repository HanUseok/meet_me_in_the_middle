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

  const sheet = $('#sheet');
  const sheetHeader = $('#sheetHeader');
  const top3Popup = $('#top3-popup');
  const top3Title = top3Popup.querySelector('.popup-title');
  const top3List = top3Popup.querySelector('.popup-list');
  const top3Close = top3Popup.querySelector('.popup-close');

  let originMarker=null, cache=null, areaMarkers=[], areaLabels=[];
  let sheetOpen=false;
  const dragState={ active:false, startY:0, moved:false, committed:false, pointerId:null, type:null };
  let lastPopup=null;

  function setSheetState(open){
    sheetOpen=open;
    sheet.classList.toggle('open', open);
    sheet.classList.toggle('collapsed', !open);
    sheet.setAttribute('aria-expanded', String(open));
  }

  function collapseSheet(){ setSheetState(false); }
  function expandSheet(){ setSheetState(true); }

  function hideTop3Popup(){
    top3Popup.classList.add('hidden');
    top3Popup.setAttribute('aria-hidden', 'true');
    top3List.innerHTML='';
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

  function showTop3Popup(items, options={}){
    const { title='추천 Top3', mode='place' } = options;
    if(!items || !items.length){
      hideTop3Popup();
      return;
    }
    lastPopup = { items, options: { ...options } };
    top3Title.textContent = title;
    top3List.innerHTML='';

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

      if(mode==='area'){
        const btn=document.createElement('button');
        btn.type='button';
        btn.className='popup-action';
        btn.textContent='선택';
        btn.addEventListener('click', ()=>{
          cache._selectedArea = item;
          cache._areaPick = item;
          hideTop3Popup();
          expandSheet();
          showAreaCategories(item);
          status(`✅ 지역 선택: ${item.name} — 카테고리 선택`);
        });
        card.appendChild(btn);
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

      top3List.appendChild(card);
    });

    top3Popup.classList.remove('hidden');
    top3Popup.setAttribute('aria-hidden', 'false');
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

  function setOrigin(lat,lng){
    if(originMarker) originMarker.setMap(null);
    originMarker=new kakao.maps.Marker({ position:new kakao.maps.LatLng(lat,lng), zIndex:10 });
    originMarker.setMap(map); map.setCenter(originMarker.getPosition()); map.setLevel(5);
  }

  function addAreaMarkers(areas){
    areaMarkers.forEach(m=>m.setMap(null));
    areaLabels.forEach(l=>l.setMap(null));
    areaMarkers=[]; areaLabels=[];
    areas.forEach((area, idx)=>{
      const m = new kakao.maps.Marker({
        position: new kakao.maps.LatLng(area.lat, area.lng),
        title: area.name
      });
      m.setMap(map);
      areaMarkers.push(m);

      // 마커에 번호 표시
      const label = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(area.lat, area.lng),
        content: `<div style="background:#111;color:#fff;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;">${idx+1}</div>`,
        yAnchor: 0.5
      });
      label.setMap(map);
      areaLabels.push(label);
      
      kakao.maps.event.addListener(m, 'click', ()=>{
        const iw = new kakao.maps.InfoWindow({
          content: `<div style="padding:8px"><strong>${area.name}</strong><br/>중간지점에서 ${formatDistance(area.distance)}</div>`
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
@@ -139,160 +273,389 @@ export function initApp(){
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

    showTop3Popup(top, { title:'추천 장소 Top3', mode:'place' });
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
        status(`✅ ${area.name} ${cat} 선택 — 실제 장소 검색 필요`);
      });
    });
  }

  function beginDrag(y,{pointerId=null,type=null}={}){
    dragState.active=true;
    dragState.startY=y;
    dragState.moved=false;
    dragState.committed=false;
    dragState.pointerId=pointerId;
    dragState.type=type;
    sheet.classList.add('dragging');
  }

  function endDrag(){
    if(!dragState.active) return;
    if(dragState.type==='pointer' && dragState.pointerId!=null){
      try{ sheetHeader.releasePointerCapture(dragState.pointerId); }catch(_){/* ignore */}
    }
    dragState.active=false;
    dragState.pointerId=null;
    dragState.type=null;
    sheet.classList.remove('dragging');
  }

  const DRAG_THRESHOLD=28;

  function updateDrag(y){
    if(!dragState.active) return;
    const delta=y-dragState.startY;
    if(Math.abs(delta)>4) dragState.moved=true;
    if(delta<=-DRAG_THRESHOLD){
      dragState.committed=true;
      endDrag();
      setSheetState(true);
    } else if(delta>=DRAG_THRESHOLD){
      dragState.committed=true;
      endDrag();
      setSheetState(false);
    }
  }

  function completeDrag({allowTapToggle=true}={}){
    if(!dragState.active){
      sheet.classList.remove('dragging');
      if(allowTapToggle && !dragState.committed && !dragState.moved){
        setSheetState(!sheetOpen);
      }
      dragState.moved=false;
      dragState.committed=false;
      return;
    }
    const wasMoved=dragState.moved;
    const wasCommitted=dragState.committed;
    endDrag();
    if(allowTapToggle && !wasMoved && !wasCommitted){
      setSheetState(!sheetOpen);
    }
    dragState.moved=false;
    dragState.committed=false;
  }

  const supportsPointer = typeof window !== 'undefined' && 'PointerEvent' in window;

  if(supportsPointer){
    sheetHeader.addEventListener('pointerdown', e=>{
      if(e.pointerType==='mouse' && e.button!==0) return;
      if(e.target.closest('button')) return;
      beginDrag(e.clientY,{pointerId:e.pointerId,type:'pointer'});
      try{ sheetHeader.setPointerCapture(e.pointerId); }catch(_){/* ignore */}
    });

    sheetHeader.addEventListener('pointermove', e=>{
      if(!dragState.active || dragState.pointerId!==e.pointerId) return;
      if(e.cancelable) e.preventDefault();
      updateDrag(e.clientY);
    });

    sheetHeader.addEventListener('pointerup', e=>{
      if(dragState.pointerId!==e.pointerId){
        completeDrag({allowTapToggle:false});
        return;
      }
      const shouldToggle=!dragState.moved && !dragState.committed;
      endDrag();
      if(shouldToggle) setSheetState(!sheetOpen);
      dragState.moved=false;
      dragState.committed=false;
    });

    sheetHeader.addEventListener('pointercancel', ()=>{
      completeDrag({allowTapToggle:false});
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
      updateDrag(t.clientY);
      if(dragState.active && e.cancelable) e.preventDefault();
    }, {passive:false});

    const endTouch = allowTapToggle=>{
      completeDrag({allowTapToggle});
      touchId=null;
    };

    sheetHeader.addEventListener('touchend', ()=>endTouch(true));
    sheetHeader.addEventListener('touchcancel', ()=>endTouch(false));

    sheetHeader.addEventListener('mousedown', e=>{
      if(e.button!==0) return;
      if(e.target.closest('button')) return;
      beginDrag(e.clientY,{type:'mouse'});
      const moveHandler=ev=>{
        if(!dragState.active) return;
        updateDrag(ev.clientY);
      };
      const upHandler=ev=>{
        document.removeEventListener('mousemove', moveHandler);
        document.removeEventListener('mouseup', upHandler);
        if(!dragState.active){
          if(!dragState.moved && !dragState.committed) setSheetState(!sheetOpen);
          dragState.moved=false;
          dragState.committed=false;
          return;
        }
        const shouldToggle=!dragState.moved && !dragState.committed;
        endDrag();
        if(shouldToggle) setSheetState(!sheetOpen);
        dragState.moved=false;
        dragState.committed=false;
      };
      document.addEventListener('mousemove', moveHandler);
      document.addEventListener('mouseup', upHandler);
    });
  }

  top3Close.addEventListener('click', ()=>{
    hideTop3Popup();
  });

  top3Popup.addEventListener('click', e=>{
    if(e.target===top3Popup){
      hideTop3Popup();
    }
  });

  setSheetState(false);
  hideTop3Popup();

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
        areas: popularAreas,
        _areas: popularAreas
      };
      renderAreaTop3(popularAreas);

      // 선택된 지역들을 지도에 마커로 표시
      addAreaMarkers(popularAreas);
      const distInfo = popularAreas.map(a => `${a.name}(${formatDistance(a.distance)})`).join(', ');
      status(`✅ 중간지점: ${centerAddress} (${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}) | 추천지역: ${distInfo}`);
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

  status('✅ 준비됨 — 하단 패널을 끌어올려 참여자 장소를 입력하고 “중간지점→지역 Top3”를 눌러보세요');
}
