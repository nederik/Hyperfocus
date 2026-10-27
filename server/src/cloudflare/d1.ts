import type { Client, InStatement, InValue, ResultSet } from '@libsql/client';
import type { D1Database, D1Result } from './types';

/**
 * Makes Cloudflare D1 look like the libSQL client the server code uses.
 * Only the parts the code needs are implemented: execute() and batch().
 */
export function d1Client(db: D1Database): Client {
  const normalize = (stmt: InStatement) => {
    if (typeof stmt === 'string') return { sql: stmt, args: [] as InValue[] };
    return { sql: stmt.sql, args: (Array.isArray(stmt.args) ? stmt.args : []) as InValue[] };
  };
  // D1 accepts neither bigint nor undefined.
  const clean = (args: InValue[]) => args.map((a) => (typeof a === 'bigint' ? Number(a) : a === undefined ? null : a));
  const prepare = (stmt: InStatement) => {
    const { sql, args } = normalize(stmt);
    const p = db.prepare(sql);
    return args.length ? p.bind(...clean(args)) : p;
  };
  const toResultSet = (r: D1Result): ResultSet =>
    ({
      rows: r.results ?? [],
      columns: [],
      columnTypes: [],
      rowsAffected: r.meta?.changes ?? 0,
      lastInsertRowid: r.meta?.last_row_id !== undefined ? BigInt(r.meta.last_row_id) : undefined,
      toJSON: () => ({}),
      // For the storage meter: the database size after the query (bytes).
      dbSize: (r.meta as { size_after?: number } | undefined)?.size_after,
    }) as unknown as ResultSet;

  const client = {
    async execute(stmt: InStatement) {
      return toResultSet(await prepare(stmt).all());
    },
    async batch(stmts: InStatement[]) {
      const results = await db.batch(stmts.map(prepare));
      return results.map(toResultSet);
    },
  };
  return client as unknown as Client;
}
