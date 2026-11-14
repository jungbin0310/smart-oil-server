import mysql, { Pool, PoolOptions } from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const createDbPool = (): Pool => {
  const mysqlUrl = process.env.MYSQL_URL || process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL;

  if (mysqlUrl) {
    return mysql.createPool({
      uri: mysqlUrl,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  }

  const poolConfig: PoolOptions = {
    host: process.env.DB_HOST || process.env.MYSQLHOST || 'localhost',
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT) || 3306,
    user: process.env.DB_USER || process.env.MYSQLUSER || 'root',
    password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || '',
    database: process.env.DB_NAME || process.env.MYSQLDATABASE || 'smart_oil',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  };

  return mysql.createPool(poolConfig);
};

export const pool: Pool = createDbPool();
export default pool;
