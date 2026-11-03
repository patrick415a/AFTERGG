const fs = require('node:fs');
const path = require('node:path');
const oracledb = require('oracledb');

function readSchema() {
  return ['000-base-tables.sql', '001-normalized-matches.sql'].flatMap((file) =>
    fs
      .readFileSync(path.join(__dirname, '..', 'sql', file), 'utf8')
      .replace(/--[^\n]*/g, '')
      .split(';')
      .map((sql) => sql.trim())
      .filter(Boolean)
      .map((sql) => {
        const [, kind, name] = /^CREATE (TABLE|(?:UNIQUE )?INDEX) (\w+)/.exec(sql) || [];
        if (!name) throw new Error(`지원하지 않는 스키마 문장: ${file}`);
        return { kind, name, sql };
      }),
  );
}

function tableColumns(sql) {
  return [
    ...sql.matchAll(
      /^\s*(\w+)\s+(NVARCHAR2|VARCHAR2|NUMBER|TIMESTAMP|CLOB)\b(?:\((\d+)\))?([^\n]*)/gm,
    ),
  ].map(([, name, type, length, rest]) => ({
    name,
    type,
    length: length ? Number(length) : null,
    required: /NOT NULL|PRIMARY KEY/.test(rest),
    identity: /AS IDENTITY/.test(rest),
  }));
}

async function objectExists(connection, { kind, name }) {
  const view = kind === 'TABLE' ? 'USER_TABLES' : 'USER_INDEXES';
  const column = kind === 'TABLE' ? 'TABLE_NAME' : 'INDEX_NAME';
  const result = await connection.execute(`SELECT ${column} FROM ${view} WHERE ${column} = :name`, {
    name,
  });
  return result.rows.length > 0;
}

async function validateTable(connection, definition) {
  const result = await connection.execute(
    `SELECT COLUMN_NAME, DATA_TYPE, CHAR_LENGTH, NULLABLE, IDENTITY_COLUMN, DATA_DEFAULT
     FROM USER_TAB_COLUMNS WHERE TABLE_NAME = :name ORDER BY COLUMN_ID`,
    { name: definition.name },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  const columns = new Map(result.rows.map((row) => [row.COLUMN_NAME, row]));
  const issues = [];
  for (const expected of tableColumns(definition.sql)) {
    const actual = columns.get(expected.name);
    const label = `${definition.name}.${expected.name}`;
    if (!actual) {
      issues.push(`${label}: 컬럼 없음`);
      continue;
    }
    const typeMatches =
      expected.type === 'TIMESTAMP'
        ? actual.DATA_TYPE.startsWith('TIMESTAMP')
        : actual.DATA_TYPE === expected.type;
    if (!typeMatches) issues.push(`${label}: ${actual.DATA_TYPE} → ${expected.type} 필요`);
    if (expected.type.includes('VARCHAR2') && actual.CHAR_LENGTH < expected.length) {
      issues.push(`${label}: 문자열 길이 ${expected.length} 이상 필요`);
    }
    if (expected.required && actual.NULLABLE !== 'N') issues.push(`${label}: NOT NULL 필요`);
    if (
      expected.identity &&
      actual.IDENTITY_COLUMN !== 'YES' &&
      !/NEXTVAL/i.test(actual.DATA_DEFAULT || '')
    ) {
      issues.push(`${label}: IDENTITY 또는 시퀀스 기본값 필요`);
    }
  }
  if (definition.name === 'SUMMONERS') {
    const unique = await connection.execute(
      `SELECT c.CONSTRAINT_NAME, cols.COLUMN_NAME
       FROM USER_CONSTRAINTS c JOIN USER_CONS_COLUMNS cols
         ON cols.CONSTRAINT_NAME = c.CONSTRAINT_NAME
       WHERE c.TABLE_NAME = :name AND c.CONSTRAINT_TYPE IN ('P', 'U') AND c.STATUS = 'ENABLED'`,
      { name: definition.name },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const keys = new Map();
    for (const row of unique.rows) {
      if (!keys.has(row.CONSTRAINT_NAME)) keys.set(row.CONSTRAINT_NAME, []);
      keys.get(row.CONSTRAINT_NAME).push(row.COLUMN_NAME);
    }
    if (![...keys.values()].some((key) => key.length === 1 && key[0] === 'PUUID')) {
      issues.push('SUMMONERS.PUUID: 외래키 연결을 위한 UNIQUE 또는 PRIMARY KEY 필요');
    }
  }
  return issues;
}

async function inspectSchema(connection, definitions) {
  const missing = [],
    issues = [];
  for (const definition of definitions) {
    if (!(await objectExists(connection, definition))) {
      missing.push(definition);
      continue;
    }
    if (definition.kind === 'TABLE') issues.push(...(await validateTable(connection, definition)));
    else {
      const index = await connection.execute(
        'SELECT TABLE_NAME, UNIQUENESS, STATUS FROM USER_INDEXES WHERE INDEX_NAME = :name',
        { name: definition.name },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const expectedTable = /\bON\s+(\w+)/.exec(definition.sql)[1];
      if (index.rows[0].TABLE_NAME !== expectedTable || index.rows[0].STATUS !== 'VALID') {
        issues.push(`${definition.name}: 대상 테이블 또는 인덱스 상태 확인 필요`);
      }
      if (definition.kind === 'UNIQUE INDEX' && index.rows[0].UNIQUENESS !== 'UNIQUE') {
        issues.push(`${definition.name}: UNIQUE 인덱스 필요`);
      }
    }
  }
  return { missing, issues };
}

module.exports = { readSchema, tableColumns, objectExists, inspectSchema };
