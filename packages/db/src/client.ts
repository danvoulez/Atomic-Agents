/**
 * SQL Client with tagged template literals
 * 
 * Provides a safer way to write SQL queries using template literals.
 */

import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/**
 * Tagged template literal for SQL queries
 */
export async function sql<T = unknown>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> {
  // Build parameterized query
  let query = "";
  for (let i = 0; i < strings.length; i++) {
    query += strings[i];
    if (i < values.length) {
      query += `$${i + 1}`;
    }
  }

  const res = await pool.query(query, values);
  return res.rows as T[];
}

// Namespace utilities
export namespace sql {
  export function json(value: unknown): string {
    return JSON.stringify(value);
  }

  export async function unsafe<T = unknown>(
    query: string,
    values: unknown[] = []
  ): Promise<T[]> {
    const res = await pool.query(query, values);
    return res.rows as T[];
  }
}

export async function query<T = unknown>(sqlStr: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(sqlStr, params);
  return res.rows as T[];
}
