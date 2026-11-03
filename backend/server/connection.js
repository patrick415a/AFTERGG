const oracledb = require('oracledb');

async function openConnection() {
  const { DB_USER: user, DB_PASSWORD: password, DB_CONNECT_STRING: connectString } = process.env;
  if (!user || !password || !connectString) throw new Error('Oracle DB 환경변수를 확인해 주세요.');
  const connection = await oracledb.getConnection({
    user,
    password,
    connectString,
    connectTimeout: 10,
    transportConnectTimeout: 5,
  });
  connection.callTimeout = 15000;
  try {
    // 수집일(STORED_AT)은 한국 날짜 기준으로 일관되게 기록합니다.
    await connection.execute("ALTER SESSION SET TIME_ZONE = 'Asia/Seoul'");
  } catch (error) {
    await connection.close();
    throw error;
  }
  return connection;
}

async function withConnection(task) {
  const connection = await openConnection();
  try {
    return await task(connection);
  } finally {
    await connection.close();
  }
}

module.exports = { openConnection, withConnection };
