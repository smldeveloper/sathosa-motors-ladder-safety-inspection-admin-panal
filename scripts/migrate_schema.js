import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: false }
});

try {
  await pool.query('BEGIN');
  await pool.query(`ALTER TABLE inspection_points DROP CONSTRAINT IF EXISTS inspection_points_category_check`);
  await pool.query(`ALTER TABLE inspection_points ADD COLUMN IF NOT EXISTS question_type text DEFAULT 'decision'`);
  await pool.query(`ALTER TABLE inspection_points ADD COLUMN IF NOT EXISTS placeholder text DEFAULT ''`);
  await pool.query(`ALTER TABLE inspection_points ADD COLUMN IF NOT EXISTS field_key text DEFAULT ''`);

  await pool.query(`ALTER TABLE fire_inspection_points ADD COLUMN IF NOT EXISTS category text DEFAULT 'fire'`);
  await pool.query(`ALTER TABLE fire_inspection_points ADD COLUMN IF NOT EXISTS question_type text DEFAULT 'decision'`);
  await pool.query(`ALTER TABLE fire_inspection_points ADD COLUMN IF NOT EXISTS placeholder text DEFAULT ''`);
  await pool.query(`ALTER TABLE fire_inspection_points ADD COLUMN IF NOT EXISTS field_key text DEFAULT ''`);

  await pool.query(`ALTER TABLE firstaid_inspection_points ADD COLUMN IF NOT EXISTS category text DEFAULT 'firstaid'`);
  await pool.query(`ALTER TABLE firstaid_inspection_points ADD COLUMN IF NOT EXISTS question_type text DEFAULT 'decision'`);
  await pool.query(`ALTER TABLE firstaid_inspection_points ADD COLUMN IF NOT EXISTS placeholder text DEFAULT ''`);
  await pool.query(`ALTER TABLE firstaid_inspection_points ADD COLUMN IF NOT EXISTS field_key text DEFAULT ''`);

  await pool.query('COMMIT');
  console.log('Successfully updated schema!');
} catch (e) {
  await pool.query('ROLLBACK');
  console.error('Schema update failed:', e);
} finally {
  await pool.end();
}

