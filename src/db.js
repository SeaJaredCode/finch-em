import pg from 'pg';

// One process-wide pool for the injected DATABASE_URL (DB Farm contract).
let pool = null;

export function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set');
    }
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    pool.on('error', (err) => console.error('[db] idle client error', err.message));
  }
  return pool;
}
