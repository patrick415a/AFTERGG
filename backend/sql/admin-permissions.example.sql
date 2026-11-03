-- 자동 실행하지 않습니다. DBA가 대상 PDB에 접속해서 검토 후 실행하는 예제입니다.
-- AFTERGG_APP을 실제 DB_USER로, USERS를 실제 기본 테이블스페이스로 바꾸세요.
-- 기존 사용자를 대상으로 하며 계정/비밀번호 생성은 포함하지 않습니다.
SELECT USERNAME, DEFAULT_TABLESPACE FROM DBA_USERS WHERE USERNAME = 'AFTERGG_APP';

GRANT CREATE SESSION, CREATE TABLE TO AFTERGG_APP;
ALTER USER AFTERGG_APP QUOTA 200M ON USERS;

-- 자신의 테이블에 인덱스를 만들 때 CREATE ANY INDEX나 DBA 역할을 부여할 필요는 없습니다.
-- 예상 데이터량에 따라 DBA가 quota를 조절하세요.
