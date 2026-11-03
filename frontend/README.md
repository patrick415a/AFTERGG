# AFTERGG frontend

Next.js App Router, TypeScript, SCSS Modules로 구성한 전적 검색 화면입니다.
환경 설정·DB 흐름·API·제한은 [전체 README](../README.md)를 참고하세요.

## 이 폴더에서 실행

```bash
npm ci
npm run dev
```

기본 포트는 3000입니다. 백엔드는 별도 터미널에서 4000번 포트로 실행합니다.
새 환경에서는 `.env.example`을 `.env.local`로 복사합니다.

- `BACKEND_URL`: Express 주소. 기본값 `http://127.0.0.1:4000`
- `DEV_ALLOWED_HOSTS`: 개발 중 허용할 프론트 호스트명/IP. 쉼표 구분, 프로토콜·포트 제외

프론트는 `/api`로 요청하고 `next.config.ts`의 rewrite가 백엔드로 전달합니다.
환경 파일은 `frontend/.env.local`에 둡니다. Riot 키·DB 접속 정보는 이 폴더에 넣지 않습니다.
Next.js 서버가 필요하므로 정적 export만으로 배포할 수 없습니다.

## 코드 읽는 순서

1. `app/layout.tsx`, `app/page.tsx`, `app/summoner/page.tsx`: 공통 레이아웃과 페이지
2. `components/SearchForm.tsx`, `lib/search-history.ts`: 이름#태그 검색, 최근 검색 10개, DB 자동완성, 키보드 선택
3. `hooks/useSummoner.ts`: 최초 전적 조회, 갱신, 더 보기, 요청 취소
4. `lib/api.ts`: API 계약, 타입, 표시용 함수
5. `components/Summoner.tsx`: 프로필, 랭크, 요약과 사이드 통계
6. `components/MatchList.tsx`: 경기 목록, 팀별 상세, 장비 표시
7. `components/Home.tsx`, `data/home.ts`: 오늘의 추천 챔피언·표본 수·포지션 탭과 패치 노트

컴포넌트 스타일은 같은 이름의 `.module.scss`를 수정합니다.
전역 테마 변수와 기본 스타일은 `app/globals.scss`에 있습니다.
기존 `.css`, `.css.map`은 현재 import하지 않는 생성 파일입니다.

## 검증과 코드 정리

```bash
npm run typecheck
npm run build
```

코드 형식은 최상위 폴더에서 `npm run format`으로 정리합니다.
들여쓰기는 공백 2칸, 줄 길이는 기본 100자로 통일합니다.
빌드 후에는 `npm start`로 실행할 수 있습니다.

## 전적과 화면 동작

기존 소환사의 전적과 더 보기는 DB에서 읽습니다. 신규 소환사는 기본 정보만 확인하며, 경기 수집은 전적 갱신 버튼으로 실행합니다.
갱신 결과도 DB 저장 후 다시 읽은 데이터입니다. 다른 참가자에게서 공유된 경기는 일부 전적이라는 안내를 표시합니다.
소환사 레벨은 아이콘 오른쪽 아래 원형 배지에 표시합니다. 자동완성은 최대 20개·약 6개 높이의 스크롤 목록이며 라이트·다크 테마를 따릅니다.
리듬 막대는 오래된 경기부터 왼쪽에 이어서 배치합니다.
