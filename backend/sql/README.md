# Oracle DB 적용

`backend/.env`에 접속 정보를 설정한 뒤 `backend` 폴더에서 실행합니다.
기존 데이터가 있으면 먼저 백업하고, 서버를 종료한 상태에서 마이그레이션을 한 번에 하나만 실행하세요.

```bash
npm run db:migrate
```

빈 DB는 필요한 테이블·인덱스를 생성합니다. 기존 DB는 원본 JSON을 보존하며 새 구조로 이전하고, 완료한 이전은 반복하지 않습니다.
기존 테이블 구조가 맞지 않으면 문제를 안내하고 중단합니다. 적용 후 `npm run db:check`로 구조와 이전 완료 여부를 확인할 수 있습니다.

## SQL 파일

- [000-base-tables.sql](000-base-tables.sql): 소환사·기존 JSON 캐시 테이블
- [001-normalized-matches.sql](001-normalized-matches.sql): 랭크·갱신 상태·경기·참가자·아이템·이전 이력과 인덱스
- [statistics.sql](statistics.sql): 챔피언·최종 보유 아이템 통계 예제
- [admin-permissions.example.sql](admin-permissions.example.sql): DBA가 검토할 권한 설정 예제

일반적으로 `db:migrate`를 사용하세요. SQL을 직접 적용한다면 빈 DB는 `000` → `001` 순서이며, 이후에도 데이터 이전을 위해 `db:migrate`를 실행해야 합니다.
Oracle DDL은 자동 커밋되므로 실패 원인을 해결한 뒤 명령을 다시 실행하세요.

별도 DB에는 기존 경기 데이터가 자동 복사되지 않습니다. 전적 갱신으로 수집하거나 별도로 데이터를 이관해야 합니다.
