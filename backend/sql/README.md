# 팀원용 Oracle DB 적용 가이드

백엔드 코드와 이 폴더를 함께 전달하세요. `backend/.env`에는 팀원 자신의 접속 정보를 설정합니다.
현재 Oracle 21c에서 확인했습니다. **기존 테이블을 DROP하거나 다시 만들 필요는 없습니다.**

## 가장 간단한 적용 순서

기존 백엔드를 종료하고, DB에 기존 데이터가 있다면 적용 전에 백업합니다.
터미널 위치는 `backend` 폴더입니다.

```bash
npm ci
```

`.env`가 없을 때만 `.env.example`을 복사해 다음 값을 입력합니다. 기존 파일을 덮어쓰지 마세요.

```dotenv
PORT=4000
RIOT_API_KEY=팀원이_발급받은_키
DB_USER=기존_테이블을_소유한_사용자
DB_PASSWORD=해당_사용자_비밀번호
DB_CONNECT_STRING=호스트:1521/서비스명
```

```bash
npm run db:migrate
npm run db:check
npm run db:status
npm test
npm run dev
```

최상위 AFTERGG 폴더에서도 같은 `db:migrate`, `db:check`, `db:status` 명령을 실행할 수 있습니다.
DB 스키마 적용과 이전 중에는 백엔드를 실행하지 않고, 마이그레이션도 한 터미널에서만 실행합니다.

## 기존 DB와 빈 DB

| 팀원 DB 상태                                    | 적용 방법                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| 기존 `SUMMONERS`, `SUMMONER_MATCH_CACHE`가 있음 | `db:migrate`가 기존 테이블을 유지하고 새 테이블·인덱스를 추가한 뒤 JSON을 분리해 이전 |
| 아무 테이블도 없음                              | 같은 `db:migrate` 명령이 기본 2개와 추가 6개 테이블을 순서대로 생성                   |
| 이미 새 구조를 적용함                           | 같은 명령을 다시 실행해도 완료한 데이터 이전은 반복하지 않음                          |
| 테이블 이름은 같지만 컬럼·타입이 다름           | 자동으로 덮어쓰지 않고 문제 컬럼을 알려준 뒤 중단. 아래 SQL과 비교해 확인             |

`db:check`는 영구 데이터를 변경하지 않고 필요한 테이블·컬럼·타입·인덱스와 이전 완료 기록을 확인합니다.
테이블이 없거나 이전이 미완료면 종료 코드 1로 안내하므로 `db:migrate`를 먼저 실행합니다.

## SQL 파일 순서

| 파일                                                           | 내용                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------- |
| [000-base-tables.sql](000-base-tables.sql)                     | 처음 시작하는 DB의 기존 소환사·JSON 캐시 테이블 정의                |
| [001-normalized-matches.sql](001-normalized-matches.sql)       | 랭크·갱신 상태·경기·참가자·아이템·이전 이력 테이블과 인덱스         |
| [verify-schema.sql](verify-schema.sql)                         | SQL Developer에서 직접 확인할 테이블·컬럼·제약조건·건수 조회        |
| [admin-permissions.example.sql](admin-permissions.example.sql) | 권한 오류가 있을 때 DBA가 검토할 최소 권한 예제. 자동 실행하지 않음 |
| [statistics.sql](statistics.sql)                               | 챔피언·최종 보유 아이템 통계 SQL 예제                               |

DDL 파일을 SQL Developer에서 직접 실행하려면 빈 DB는 `000` → `001`, 기본 두 테이블이 이미 있는 DB는 `001`만 적용합니다.
DDL 파일 자체는 재실행용이 아닙니다. 보통은 존재 여부를 확인하는 `db:migrate`를 사용하는 편이 편합니다.
**SQL로 테이블만 만든 경우에도 `db:migrate`를 실행해야 JSON 이전과 완료 이력 기록까지 처리됩니다.**

## 최종 테이블과 역할

- `SUMMONERS`: 기존 소환사 정보와 자동완성. `ID` 자동 증가, `PUUID` 유일성 필요
- `SUMMONER_MATCH_CACHE`: 이전 JSON 보존용. 새 전적 저장·조회에는 사용하지 않음
- `SUMMONER_RANKS`: 소환사별 솔로·자유 티어/LP/승패
- `SUMMONER_SYNC`: 프로필·전적 갱신 시각과 전체 수집 여부
- `LOL_MATCHES`: 경기 ID별 한 행, 큐·패치·맵·경기 시각·수집 시각
- `LOL_MATCH_PARTICIPANTS`: 경기·참가자별 PUUID·챔피언·포지션·KDA·피해량 등
- `LOL_PARTICIPANT_ITEMS`: 참가자별 최종 아이템 슬롯 0~7
- `AFTERGG_MIGRATIONS`: 완료한 이전 버전

`LOL_MATCH_PARTICIPANTS.PUUID`는 이전 JSON에 없는 경우 NULL을 허용합니다.
일반 `UNIQUE(MATCH_ID, PUUID)`로 바꾸면 NULL 참가자가 여러 명인 예전 경기의 이전이 실패할 수 있습니다.
`001`의 `CASE WHEN PUUID IS NOT NULL THEN MATCH_ID END` 함수 기반 유일 인덱스를 그대로 사용합니다.
예전 버전의 같은 이름 UNIQUE 제약조건이 있으면 마이그레이션이 이 인덱스로 교체합니다.

## 이전 데이터와 오늘의 추천

기존 JSON은 지우지 않고 별도 테이블로 분리합니다. 이전이 중단되면 성공한 소환사 단위부터 이어서 처리합니다.
예전 JSON에 없는 다른 참가자의 PUUID·패치·골드는 추정해서 채우지 않습니다.
기존 경기를 전적 갱신하면 상세를 보완하고 모든 참가자의 공유 이력에 연결합니다.

오늘의 추천은 한국시간 오늘 새로 수집한 **완전한 경기 상세**만 사용합니다.
이전 JSON만 옮긴 경기나 오늘 새로 수집한 상세가 없다면 추천이 비어 있어도 정상입니다.
완전한 경기를 단순 재갱신하는 것만으로 오늘 표본이 늘어나지 않습니다.
백엔드 연결은 세션 시간대를 `Asia/Seoul`로 설정합니다.

## 적용 후 확인

```bash
npm run db:check
npm run db:status
node scripts/verify-recommendations.js
```

프론트도 실행한 뒤 검색 → 전적 갱신 → 재방문 → 경기 참가자 이름으로 이동을 확인합니다.
`/api/health`는 키의 설정 여부만 확인하며 실제 DB 연결·키 유효성 검사까지 수행하지는 않습니다.

별도 PC의 **별도 DB**에는 이 PC의 실제 경기 데이터가 자동 복사되지 않습니다.
코드·스키마만 적용하면 빈 DB로 시작하며, 전적 갱신으로 데이터를 수집합니다.
기존 데이터도 같이 쓰려면 같은 DB에 접속하거나 DBA가 별도로 데이터를 이관해야 합니다.

## 오류가 나면

| 오류                       | 확인할 항목                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------- |
| ORA-01017                  | `.env` 사용자·비밀번호                                                                |
| ORA-12514 / 접속 시간 초과 | 호스트·포트·서비스명과 DB 실행 상태                                                   |
| ORA-01031                  | 테이블 소유 계정과 생성 권한                                                          |
| ORA-01950                  | 기본 테이블스페이스의 사용자 quota                                                    |
| ORA-00942                  | 다른 계정/서비스에 생성하지 않았는지, `db:migrate` 적용 여부                          |
| 기존 구조 확인 필요        | 메시지에 나온 컬럼을 `000`·`001`과 비교. 기존 데이터 확인 없이 테이블을 삭제하지 않음 |

Oracle DDL은 실행 시 commit되므로 전체 스키마 생성이 한 번에 rollback되는 방식은 아닙니다.
실패 원인을 수정한 뒤 `db:migrate`를 다시 실행합니다. 데이터 저장은 소환사별 트랜잭션을 사용합니다.
[Oracle 권한 안내](https://docs.oracle.com/en/database/oracle/oracle-database/21/sqlrf/CREATE-TABLE.html),
[DDL과 트랜잭션](https://node-oracledb.readthedocs.io/en/latest/user_guide/txn_management.html)을 참고할 수 있습니다.
