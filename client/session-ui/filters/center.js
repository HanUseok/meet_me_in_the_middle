// 중간지점: 지오메트릭 평균 (MVP)
// NOTE: 실제 계산은 '산술 평균(Arithmetic mean)'입니다. 구면(지구 곡률)을 고려한
// 지오데식 중간점은 아니므로, 장거리/극지방/경도 180° 인접 케이스에서 오차가 커질 수 있습니다.
export function geometricCenter(points){
  // 모든 포인트의 위도 합을 개수로 나눔
  const lat = points.reduce((a,p)=>a+p.lat,0)/points.length;
  // 모든 포인트의 경도 합을 개수로 나눔
  const lng = points.reduce((a,p)=>a+p.lng,0)/points.length;
  // {lat, lng} 형태로 반환
  return { lat, lng };
}

// 지역 클러스터링: K-평균 알고리즘으로 장소들을 영역별로 그룹화
// 문자열로 들어온 좌표는 parseFloat로 수치 변환, 숫자면 그대로 반환
function toNum(x){ return typeof x === 'string' ? parseFloat(x) : x }

function kmeansXY(places, k){
// 입력 place 객체들에서 (x=lng, y=lat) 2차원 좌표 배열 구성
const pts = places.map(p=>[toNum(p.x), toNum(p.y)]);
const n = pts.length; if(n === 0) return [];       // 데이터가 없으면 즉시 종료
const kk = Math.min(k, n);                          // 클러스터 수는 데이터 수를 초과 불가

// 초기 중심: 처음 kk개 포인트를 그대로 사용(간단하지만 초기치 편향 가능)
let centers = pts.slice(0, kk).map(p=>p.slice());   // 깊은 복사로 보관
let assign = new Array(n).fill(0);                  // 각 포인트의 클러스터 할당 인덱스
// 유클리드 거리의 제곱(루트 연산 생략으로 성능 이점, 비교 목적엔 충분)
const dist2 = (a,b)=>{ const dx=a[0]-b[0], dy=a[1]-b[1]; return dx*dx+dy*dy };

// KMeans 고정 반복(8회): 할당(assignment) → 재계산(update)
for(let iter=0; iter<8; iter++){
  // 1) 각 포인트를 가장 가까운 중심에 할당
  for(let i=0;i<n;i++){
    let best=0, bd=Infinity;
    for(let c=0;c<centers.length;c++){
      const d=dist2(pts[i], centers[c]); if(d<bd){ bd=d; best=c }
    }
    assign[i]=best;
  }
  // 2) 각 클러스터의 새 중심 = 소속 포인트들의 평균
  // sums[c] = [x 합, y 합, 개수]
  const sums = Array(centers.length).fill(0).map(()=>[0,0,0]);
  for(let i=0;i<n;i++){
    const a=assign[i]; sums[a][0]+=pts[i][0]; sums[a][1]+=pts[i][1]; sums[a][2]++;
  }
  for(let c=0;c<centers.length;c++){
    if(sums[c][2]>0){ centers[c]=[sums[c][0]/sums[c][2], sums[c][1]/sums[c][2]]; }
    // 개수가 0인 클러스터는 기존 중심 유지(재초기화 없음)
  }
}

// 최종 할당 결과를 클러스터 구조로 변환
const clusters = Array(centers.length).fill(0).map(()=>({ items:[], center:null }));
// 각 포인트를 소속 클러스터에 모아 넣기
for(let i=0;i<n;i++) clusters[assign[i]].items.push(places[i]);
// 중심은 내부 표현으로 {x, y} 저장(x=lng, y=lat)
for(let c=0;c<centers.length;c++) clusters[c].center = { x:centers[c][0], y:centers[c][1] };
// 아이템이 하나도 없는 빈 클러스터는 제거
return clusters.filter(cl=>cl.items.length>0);
}

// 외부 노출용: KMeans 결과를 지도에서 쓰기 좋은 {lat, lng}로 변환
export function clusterAreas(enrichedPlaces, k=3){
const clusters = kmeansXY(enrichedPlaces, k);
return clusters.map(cl=>({
  // 내부(center.x=lng, center.y=lat)를 외부 표기(lat,lng)로 변환
  center: { lat: parseFloat(cl.center.y), lng: parseFloat(cl.center.x) },
  // 해당 클러스터에 속한 원본 장소 리스트 유지
  items: cl.items
}));
}

/*
[참고/주의]
- 시간복잡도: O(iterations * n * k) (여기서는 iterations = 8로 고정)
- 초기 중심을 '처음 kk개'로 잡아 데이터 순서에 민감할 수 있습니다.
품질 개선을 위해 k-means++ 초기화를 고려해 볼 수 있습니다.
- toNum(parseFloat) 결과가 NaN일 수 있으므로, 실제 운용에서는 Number.isFinite 체크로
NaN 좌표를 사전 필터링하는 것이 안전합니다.
- geometricCenter는 산술 평균이므로 지리적 중간점 정확도가 중요할 때는
벡터 평균 기반의 지오데식 중간점(구면 좌표계) 알고리즘으로 대체를 권장합니다.
*/
