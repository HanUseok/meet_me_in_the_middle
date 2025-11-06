# TMAP API 허용 경로 설정 가이드

## 서버에서 사용하는 TMAP API 엔드포인트

1. **자동차 경로**: `https://apis.openapi.sk.com/tmap/routes`
2. **도보 경로**: `https://apis.openapi.sk.com/tmap/routes/pedestrian`
3. **대중교통 경로**: `https://apis.openapi.sk.com/transit/routes`

## TMAP 콘솔에서 허용 목록에 추가할 경로

### 옵션 1: 전체 도메인 허용 (권장)
```
https://apis.openapi.sk.com/*
```

### 옵션 2: 개별 경로 허용
```
https://apis.openapi.sk.com/tmap/routes
https://apis.openapi.sk.com/tmap/routes/pedestrian
https://apis.openapi.sk.com/transit/routes
```

### 옵션 3: 개발 환경 (로컬 호스트)
```
localhost
http://localhost:8080
http://127.0.0.1:8080
```

## 설정 방법

1. **openapi.sk.com** 접속
2. 내 프로젝트 → 앱 키 선택
3. 보안 설정 (Security Settings) 클릭
4. Referrer 제한 또는 IP 제한 설정에서 위 경로 추가
5. 저장

## 참고

- 개발 중에는 옵션 3 (localhost)를 사용하는 것이 편리합니다.
- 프로덕션 환경에서는 옵션 1 또는 옵션 2를 사용하는 것을 권장합니다.
- 설정 변경 후 즉시 적용되므로 서버 재시작이 필요 없습니다.
