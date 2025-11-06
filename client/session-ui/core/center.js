// 중간지점: 지오메트릭 평균 (MVP)
// NOTE: 실제로는 '산술 평균(Arithmetic mean)'으로 위도/경도의 단순 평균을 냅니다.
// 구면 좌표를 고려한 '지오데식 중간점'은 아님(장거리/극지방에서 오차 가능).
export function geometricCenter(points){
    // 모든 포인트의 위도 합 / 개수
    const lat = points.reduce((a,p)=>a+p.lat,0)/points.length;
    // 모든 포인트의 경도 합 / 개수
    const lng = points.reduce((a,p)=>a+p.lng,0)/points.length;
    // {lat, lng} 형태로 반환
    return { lat, lng };
}

// 지역 클러스터링: K-평균 알고리즘으로 장소들을 영역별로 그룹화
// 문자열로 들어온 좌표를 숫자로 안전 변환. 숫자면 그대로 반환.
function toNum(x){ return typeof x === 'string' ? parseFloat(x) : x }

function kmeansXY(places, k){
  // 입력 place 객체들에서, KMeans 계산용 (x=lng, y=lat) 2차원 좌표 배열 생성
  const pts = places.map(p=>[toNum(p.x), toNum(p.y)]);
  const n = pts.length; if(n === 0) return [];         // 입력이 없으면 즉시 빈 배열 반환
  const kk = Math.min(k, n);                           // 클러스터 수는 데이터 개수를 초과할 수 없음

  // 초기 중심: 처음 kk개 포인트를 그대로 사용 (간단하지만 초기치 편향 가능)
  let centers = pts.slice(0, kk).map(p=>p.slice());    // 깊은 복사로 중심 배열 구성
  let assign = new Array(n).fill(0);                   // 각 포인트가 할당된 클러스터 인덱스 저장용
  const dist2 = (a,b)=>{                               // 유클리드 거리의 제곱(루트 없이 비교용으로 충분)
    const dx=a[0]-b[0], dy=a[1]-b[1];
    return dx*dx+dy*dy
  };

  // KMeans 반복: 할당(Assignment) → 재계산(Update) 과정을 8번 수행 (고정 반복)
  for(let iter=0; iter<8; iter++){
    // 1) 할당 단계: 각 포인트를 가장 가까운 중심(centroid)에 할당
    for(let i=0;i<n;i++){
      let best=0, bd=Infinity;                         // best: 최적 중심 인덱스, bd: 최단 거리제곱
      for(let c=0;c<centers.length;c++){
        const d=dist2(pts[i], centers[c]);             // 포인트 i와 중심 c의 거리제곱
        if(d<bd){ bd=d; best=c }                       // 더 가까우면 갱신
      }
      assign[i]=best;                                  // 포인트 i의 할당 결과 저장
    }

    // 2) 재계산 단계: 각 클러스터에 속한 포인트들의 평균으로 중심을 업데이트
    // sums[c] = [x 합, y 합, 개수]
    const sums = Array(centers.length).fill(0).map(()=>[0,0,0]);
    for(let i=0;i<n;i++){
      const a=assign[i];                               // 포인트 i가 속한 클러스터
      sums[a][0]+=pts[i][0];                           // x(경도) 합산
      sums[a][1]+=pts[i][1];                           // y(위도) 합산
      sums[a][2]++;                                    // 개수 증가
    }
    for(let c=0;c<centers.length;c++){
      // 해당 클러스터에 최소 1개 이상 포인트가 있으면 평균으로 중심 갱신
      if(sums[c][2]>0){
        centers[c]=[sums[c][0]/sums[c][2], sums[c][1]/sums[c][2]];
      }
      // 비어 있는 클러스터는 기존 중심 유지(현 구현에서는 별도 재초기화 없음)
    }
  }

  // 반복 종료 후: 최종 할당 결과를 바탕으로 클러스터 객체 생성
  const clusters = Array(centers.length).fill(0).map(()=>({ items:[], center:null }));
  // 각 포인트를 자신의 클러스터에 넣어주기
  for(let i=0;i<n;i++) clusters[assign[i]].items.push(places[i]);
  // 각 클러스터의 중심 좌표 기록(x=lng, y=lat). 여기서는 숫자 그대로 저장.
  for(let c=0;c<centers.length;c++) clusters[c].center = { x:centers[c][0], y:centers[c][1] };

  // 빈 클러스터는 제거하여 반환 (KMeans 과정에서 비는 경우가 발생할 수 있음)
  return clusters.filter(cl=>cl.items.length>0);
}

export function clusterAreas(enrichedPlaces, k=3){
  // KMeans 결과(중심 x,y와 items)를 받아서, 지도로 쓰기 좋게 {lat, lng}로 변환
  const clusters = kmeansXY(enrichedPlaces, k);
  return clusters.map(cl=>({
    // center: 내부 표현(x=lng, y=lat)을 외부 표현(lat/lng)로 변환(문자→숫자 안전 캐스팅)
    center: { lat: parseFloat(cl.center.y), lng: parseFloat(cl.center.x) },
    // items: 해당 영역(클러스터)에 속한 원본 장소 리스트 유지
    items: cl.items
  }));
}
