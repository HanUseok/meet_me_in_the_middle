// 중간지점: 지오메트릭 평균 (MVP)
export function geometricCenter(points){
    const lat = points.reduce((a,p)=>a+p.lat,0)/points.length;
    const lng = points.reduce((a,p)=>a+p.lng,0)/points.length;
    return { lat, lng };
}

// 지역 클러스터링: K-평균 알고리즘으로 장소들을 영역별로 그룹화
function toNum(x){ return typeof x === 'string' ? parseFloat(x) : x }

function kmeansXY(places, k){
  const pts = places.map(p=>[toNum(p.x), toNum(p.y)]);
  const n = pts.length; if(n === 0) return [];
  const kk = Math.min(k, n);
  // 초기 중심: 처음 kk개
  let centers = pts.slice(0, kk).map(p=>p.slice());
  let assign = new Array(n).fill(0);
  const dist2 = (a,b)=>{ const dx=a[0]-b[0], dy=a[1]-b[1]; return dx*dx+dy*dy };

  for(let iter=0; iter<8; iter++){
    // 할당
    for(let i=0;i<n;i++){
      let best=0, bd=Infinity;
      for(let c=0;c<centers.length;c++){
        const d=dist2(pts[i], centers[c]); if(d<bd){ bd=d; best=c }
      }
      assign[i]=best;
    }
    // 재계산
    const sums = Array(centers.length).fill(0).map(()=>[0,0,0]);
    for(let i=0;i<n;i++){
      const a=assign[i]; sums[a][0]+=pts[i][0]; sums[a][1]+=pts[i][1]; sums[a][2]++;
    }
    for(let c=0;c<centers.length;c++){
      if(sums[c][2]>0){ centers[c]=[sums[c][0]/sums[c][2], sums[c][1]/sums[c][2]]; }
    }
  }
  // 클러스터 결과 수집
  const clusters = Array(centers.length).fill(0).map(()=>({ items:[], center:null }));
  for(let i=0;i<n;i++) clusters[assign[i]].items.push(places[i]);
  for(let c=0;c<centers.length;c++) clusters[c].center = { x:centers[c][0], y:centers[c][1] };
  // 빈 클러스터 제거
  return clusters.filter(cl=>cl.items.length>0);
}

export function clusterAreas(enrichedPlaces, k=3){
  const clusters = kmeansXY(enrichedPlaces, k);
  return clusters.map(cl=>({
    center: { lat: parseFloat(cl.center.y), lng: parseFloat(cl.center.x) },
    items: cl.items
  }));
}
  
