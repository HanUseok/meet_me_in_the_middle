# TMAP API 수동 테스트 가이드

## 403 INVALID_API_KEY 에러 해결 체크리스트

### 1. 콘솔 점검 (가장 중요)

1. **openapi.sk.com** 접속
2. 내 프로젝트 → 앱 키 확인
3. **사용 중인 상품**에 "TMAP API(경로안내)"가 있는지 확인
   - 없으면 추가 신청 (무료)
   - 있으면 제한(IP/Referrer) 설정 확인

### 2. 수동 호출 테스트 (cURL)

#### 자동차 경로 (car)
```powershell
curl -i -X POST "https://apis.openapi.sk.com/tmap/routes?version=1" `
  -H "Accept: application/json" `
  -H "Content-Type: application/json; charset=UTF-8" `
  -H "appKey: t81odmPimb2qePH8hFJNo9L3CvudOy1ryLbo8d" `
  -d '{\"startX\":\"126.88640998410038\",\"startY\":\"37.47871294053313\",\"endX\":\"126.92639059289041\",\"endY\":\"37.51479213334867\",\"reqCoordType\":\"WGS84GEO\",\"resCoordType\":\"WGS84GEO\",\"searchOption\":\"0\"}'
```

#### 도보 경로 (walk)
```powershell
curl -i -X POST "https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1" `
  -H "Accept: application/json" `
  -H "Content-Type: application/json; charset=UTF-8" `
  -H "appKey: t81odmPimb2qePH8hFJNo9L3CvudOy1ryLbo8d" `
  -d '{\"startX\":\"126.88640998410038\",\"startY\":\"37.47871294053313\",\"endX\":\"126.92639059289041\",\"endY\":\"37.51479213334867\",\"reqCoordType\":\"WGS84GEO\",\"resCoordType\":\"WGS84GEO\"}'
```

### 3. 엔드포인트 확인

현재 사용 중인 엔드포인트:
- 자동차: `https://apis.openapi.sk.com/tmap/routes?version=1`
- 도보: `https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1`
- 대중교통: `https://apis.openapi.sk.com/transit/routes`

**TMAP 문서**를 확인하여 정확한 엔드포인트/버전이 맞는지 재확인하세요.

### 4. 키 재발급 테스트

콘솔에서 키를 새로 재발급한 뒤 즉시 테스트하면 원인 분리가 쉽습니다.

### 5. 예상 응답

**성공 시 (200 OK):**
```json
{
  "type": "FeatureCollection",
  "features": [...]
}
```

**실패 시 (403):**
```json
{
  "error": {
    "id": "403",
    "category": "gw",
    "code": "INVALID_API_KEY",
    "message": "Forbidden"
  }
}
```
