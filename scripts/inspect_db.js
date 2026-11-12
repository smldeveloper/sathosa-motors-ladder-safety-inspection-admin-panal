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
  const fCols = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'fire_inspection_points'
  `);
  console.log('fire_inspection_points columns:', fCols.rows.map(r => r.column_name));

  const fPoints = await pool.query('SELECT * FROM fire_inspection_points LIMIT 5');
  console.log('fire_inspection_points sample:', fPoints.rows);

  const aCols = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'firstaid_inspection_points'
  `);
  console.log('firstaid_inspection_points columns:', aCols.rows.map(r => r.column_name));

  const aPoints = await pool.query('SELECT * FROM firstaid_inspection_points LIMIT 5');
  console.log('firstaid_inspection_points sample:', aPoints.rows);
} catch (e) {
  console.error(e);
} finally {
  await pool.end();
}
