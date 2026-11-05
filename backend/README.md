# AFTERGG backend

Express · Riot API · Oracle 기반 전적 서버입니다. Node.js 20.9 이상을 사용합니다.

## 실행

`backend` 폴더에서 실행합니다. `.env.example`을 `.env`로 복사하고 아래 값을 설정하세요.

- `PORT`: 서버 포트, 기본값 `4000`
- `RIOT_API_KEY`: Riot API 키
- `DB_USER`, `DB_PASSWORD`, `DB_CONNECT_STRING`: Oracle 접속 정보

```bash
npm ci
npm run db:migrate
npm run dev
```

일반 실행은 `npm start`, DB 구조 확인은 `npm run db:check`를 사용합니다.
DB 적용 방법은 [SQL 가이드](sql/README.md)를 참고하세요.

## 주요 구조

- `server/`: API, 소환사 조회·갱신, DB 연결, 추천·패치 노트
- `scripts/`: DB 생성·이전 및 스키마 처리
- `sql/`: 테이블·인덱스 정의와 참고 쿼리

기존 전적 조회는 DB를 사용하고, 전적 갱신 시 최근 30일 솔로·자유 랭크 데이터를 Riot API에서 수집해 저장합니다.
오늘의 추천은 한국시간 오늘 수집된 완전한 경기 상세를 집계합니다.
