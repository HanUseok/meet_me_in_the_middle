// 간단 거리 계산
const R=6371000, toRad=x=>x*Math.PI/180;
export function haversine(a,b){
  const dLat=toRad(b.lat-a.lat), dLng=toRad(b.lng-a.lng);
  const s1=Math.sin(dLat/2)**2;
  const s2=Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(s1+s2)); // meters
}

// 카카오 카테고리 → 우리 카테고리
export function mapCategory(place){
  const cat=(place.category_group_name||'').toLowerCase();
  if(cat.includes('cafe')) return 'cafe';
  if(cat.includes('bar')||cat.includes('주점')||cat.includes('술')) return 'pub';
  if(cat.includes('restaurant')||cat.includes('음식')||cat.includes('식당')) return 'food';
  if(cat.includes('노래')||cat.includes('공연')||cat.includes('전시')||cat.includes('게임')||cat.includes('테마')) return 'play';
  return 'other';
}

// 점수: -(거리합 + λ·최대거리)  (설명 배지 포함)
export function scorePlace(place, participants){
  const p = { lat:parseFloat(place.y), lng:parseFloat(place.x) };
  const dists = participants.map(u=>haversine(u, p));
  const sum = dists.reduce((a,b)=>a+b,0);
  const mx  = Math.max(...dists);
  const alpha=1.0, beta=0.35;
  const total = - (alpha*sum + beta*mx);
  const avgMin = Math.round((sum/participants.length)/60);
  const maxMin = Math.round(mx/60);
  return { total, reasons:[`평균 ${avgMin}분`, `최장 ${maxMin}분`] };
}

export function categorizeAndRank(kakaoPlaces, participants){
  const enriched = kakaoPlaces.map(p=>{
    const cat = mapCategory(p);
    const sc  = scorePlace(p, participants);
    return { ...p, cat, _score: sc.total, _reasons: sc.reasons };
  });
  const rank_all=[...enriched].sort((a,b)=>b._score-a._score);
  const by = c => rank_all.filter(p=>p.cat===c);
  return {
    rank_all,
    rank_food: by('food'),
    rank_pub:  by('pub'),
    rank_cafe: by('cafe'),
    rank_play: by('play')
  };
}

// 지역 라벨링: 주소에서 구/동 정보 추출
export function areaLabelFromAddress(place){
  const src = (place.road_address_name || place.address_name || '').trim();
  if(!src) return (place.place_name||'지역');
  const toks = src.split(/\s+/);
  // 보편적인 한국 주소 포맷: 시/도 구 동 ... → 구 동 또는 시 구 조합 사용
  if(toks.length >= 3){ return `${toks[1]} ${toks[2]}` }
  if(toks.length >= 2){ return `${toks[0]} ${toks[1]}` }
  return toks[0] || (place.place_name||'지역');
}

// 지역별 랭킹 생성: 클러스터된 영역들을 지역명과 랭킹으로 구성
export function createAreaRanks(clusters){
  return clusters.map((cluster, idx)=>{
    // 라벨: 가장 많이 등장하는 구/동 토큰
    const labels = new Map();
    for(const p of cluster.items){
      const lab = areaLabelFromAddress(p);
      labels.set(lab, (labels.get(lab)||0)+1);
    }
    let name='지역', maxc=-1; 
    for(const [lab,cnt] of labels){ 
      if(cnt>maxc){ maxc=cnt; name=lab } 
    }
    
    // 영역 점수: 구성원 중 최고 점수 기준
    const sortedAll = [...cluster.items].sort((a,b)=>b._score-a._score);
    const byCat = c => sortedAll.filter(p=>p.cat===c);
    
    return {
      name: name || `지역 ${idx+1}`,
      center: cluster.center,
      items: cluster.items,
      ranks: {
        rank_all: sortedAll,
        rank_food: byCat('food'),
        rank_pub:  byCat('pub'),
        rank_cafe: byCat('cafe'),
        rank_play: byCat('play')
      },
      area_score: sortedAll.length ? sortedAll[0]._score : -Infinity
    };
  }).sort((a,b)=>b.area_score-a.area_score); // 영역 자체 랭킹: 최고 점수 기준 내림차순
}