# AFTERGG backend

Express·Riot API·Oracle 기반 전적 서버입니다. 설정과 전체 흐름은 [전체 README](../README.md)를 참고하세요.

팀원에게 적용할 때는 **[DB 적용 가이드와 SQL 순서](sql/README.md)**를 먼저 확인하세요.
빈 DB와 기존 DB 모두 `npm run db:migrate`를 사용할 수 있습니다.

## 실행과 DB 이전

```bash
npm ci
npm run db:migrate
npm run db:check
npm run dev
```

`backend/.env`의 `PORT`, `RIOT_API_KEY`, `DB_USER`, `DB_PASSWORD`, `DB_CONNECT_STRING`을 사용합니다.
기본 포트는 4000입니다. 기존 두 테이블을 보존하면서 경기·참가자·아이템 테이블과 랭크·갱신 상태 테이블을 추가합니다.
이전 도구는 기존 JSON을 분리해 저장하고 완료 버전을 기록합니다. 완료 후 재실행해도 중복 이전하지 않습니다.

## 데이터 흐름

- 기존 소환사 검색·더 보기: DB 조회만 실행합니다.
- 신규 소환사 검색: Riot 프로필·랭크만 받아 DB에 등록하고 다시 읽습니다.
- 전적 갱신: 최근 30일 솔로/자유 랭크 ID 전체 → DB에 없는 완전한 상세만 Riot 조회 → 한 트랜잭션으로 저장 → DB 재조회.
- 각 경기의 전체 참가자 PUUID를 연결하므로 다른 참가자도 저장된 이력을 공유합니다.
- DB 오류는 오류로 반환합니다. 저장되지 않은 API 응답으로 대체하지 않습니다.
- 기존 JSON의 다른 참가자 PUUID·패치 정보는 추정하지 않고, 새 갱신에서 실제 상세로 보완합니다.

## 주요 파일

- `server/app.js`: API 검증, Riot 요청 제한, 메타데이터 캐시
- `server/summoner-service.js`: 조회·갱신 흐름, 상세 재사용, 저장 후 재조회
- `server/db.js`: 관계형 전적 조회와 트랜잭션 저장
- `server/connection.js`: Oracle 연결과 해제
- `server/matches.js`: Riot·이전 JSON을 공통 모델로 변환
- `server/recommendations.js`: 한국시간 오늘 수집된 경기의 전체/라인별 픽률 TOP 7과 표본 집계
- `sql/001-normalized-matches.sql`: 신규 테이블과 인덱스
- `sql/statistics.sql`: 패치별 챔피언·최종 보유 아이템 통계 예제
- `scripts/migrate-db.js`, `scripts/db-status.js`: 이전·저장 건수 확인

## 검증

```bash
npm test
npm run db:status
```

자동 테스트는 대체 DB와 외부 응답을 사용해 실제 DB/API에 접근하지 않습니다.
실제 연결 검증은 최상위 폴더에서 `node backend/scripts/verify-live.js`를 실행합니다.
`--refresh`를 추가하면 실제 API 갱신과 저장·재조회·다른 참가자 공유까지 검증합니다.
