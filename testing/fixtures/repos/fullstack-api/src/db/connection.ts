/**
 * Database Connection Pool
 */
import { Pool } from 'pg';

// BUG: Connection string exposed, no SSL, no connection limits
const pool = new Pool({
  connectionString: 'postgres://admin:password123@localhost:5432/myapp'
});

export async function query(sql: string, params?: any[]) {
  // BUG: No query sanitization, SQL injection possible
  const result = await pool.query(sql, params);
  return result.rows;
}

export async function getUser(id: string) {
  // CRITICAL BUG: SQL injection vulnerability
  return query(`SELECT * FROM users WHERE id = '${id}'`);
}

export async function createUser(email: string, password: string) {
  // BUG: Password stored in plain text
  return query(
    `INSERT INTO users (email, password) VALUES ($1, $2) RETURNING *`,
    [email, password]
  );
}

export default pool;

