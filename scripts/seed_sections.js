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

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. LADDER
    const l1 = await client.query("SELECT count(*) FROM inspection_points WHERE category IN ('section_1', 'section_2')");
    if (parseInt(l1.rows[0].count, 10) === 0) {
      // Shift existing checklist points by 7
      await client.query("UPDATE inspection_points SET display_order = display_order + 7");

      // Insert Section 1
      await client.query(`
        INSERT INTO inspection_points (category, question, question_type, field_key, placeholder, display_order, is_required, is_active)
        VALUES 
          ('section_1', 'Inspector Name', 'text', 'inspector_name', 'e.g. John Perera', 1, true, true),
          ('section_1', 'EPF Number', 'text', 'epf_number', 'e.g. 12345', 2, false, true),
          ('section_1', 'Inspection Date', 'date', 'inspection_date', '', 3, true, true)
      `);

      // Insert Section 2
      const resType = await client.query(`
        INSERT INTO inspection_points (category, question, question_type, field_key, placeholder, display_order, is_required, is_active)
        VALUES ('section_2', 'Ladder Type', 'multiple_choice', 'ladder_type', 'Select ladder type', 4, true, true)
        RETURNING id
      `);
      const ladderTypeId = resType.rows[0].id;
      await client.query(`
        INSERT INTO question_options (question_id, option_label, option_value, sort_order, is_fail_value, is_active)
        VALUES 
          ($1, 'Extension Ladder', 'extension', 1, false, true),
          ($1, 'Step Ladder', 'step', 2, false, true)
      `, [ladderTypeId]);

      await client.query(`
        INSERT INTO inspection_points (category, question, question_type, field_key, placeholder, display_order, is_required, is_active)
        VALUES 
          ('section_2', 'Ladder No.', 'text', 'ladder_no', 'e.g. LDR-042', 5, true, true),
          ('section_2', 'Section / Location', 'text', 'section', 'e.g. Warehouse Bay 3', 6, true, true),
          ('section_2', 'Height (Feet)', 'number', 'height_feet', 'e.g. 12', 7, true, true)
      `);
      console.log('Seeded Ladder Section 1 & 2');
    }

    // 2. FIRE EXTINGUISHER
    const f1 = await client.query("SELECT count(*) FROM fire_inspection_points WHERE category IN ('section_1', 'section_2')");
    if (parseInt(f1.rows[0].count, 10) === 0) {
      await client.query("UPDATE fire_inspection_points SET display_order = display_order + 8");

      await client.query(`
        INSERT INTO fire_inspection_points (category, question, question_type, field_key, placeholder, display_order, is_required, is_active)
        VALUES 
          ('section_1', 'Inspector Name', 'text', 'inspector_name', 'e.g. John Perera', 1, true, true),
          ('section_1', 'EPF Number', 'text', 'epf_number', 'e.g. 12345', 2, false, true),
          ('section_1', 'Inspection Date', 'date', 'inspection_date', '', 3, true, true),
          ('section_2', 'Point / Cylinder No.', 'text', 'ladder_no', 'e.g. FE-01', 4, true, true),
          ('section_2', 'Location / Section', 'text', 'section', 'e.g. Workshop Bay 1', 5, true, true)
      `);

      const resFireType = await client.query(`
        INSERT INTO fire_inspection_points (category, question, question_type, field_key, placeholder, display_order, is_required, is_active)
        VALUES ('section_2', 'Extinguisher Type', 'multiple_choice', 'ladder_type', 'Select type', 6, true, true)
        RETURNING id
      `);
      const fireTypeId = resFireType.rows[0].id;
      await client.query(`
        INSERT INTO fire_question_options (question_id, option_label, option_value, sort_order, is_fail_value, is_active)
        VALUES 
          ($1, 'CO2', 'CO2', 1, false, true),
          ($1, 'Dry Powder', 'Dry Powder', 2, false, true),
          ($1, 'Foam', 'Foam', 3, false, true),
          ($1, 'Water', 'Water', 4, false, true),
          ($1, 'Wet Chemical', 'Wet Chemical', 5, false, true)
      `, [fireTypeId]);

      await client.query(`
        INSERT INTO fire_inspection_points (category, question, question_type, field_key, placeholder, display_order, is_required, is_active)
        VALUES 
          ('section_2', 'Pressure / Weight Capacity', 'text', 'pressure_weight', 'e.g. 5 kg / 15 bar', 7, true, true),
          ('section_2', 'Quantity', 'number', 'quantity', 'e.g. 1', 8, false, true)
      `);
      console.log('Seeded Fire Extinguisher Section 1 & 2');
    }

    // 3. FIRST AID
    const a1 = await client.query("SELECT count(*) FROM firstaid_inspection_points WHERE category IN ('section_1', 'section_2')");
    if (parseInt(a1.rows[0].count, 10) === 0) {
      await client.query("UPDATE firstaid_inspection_points SET display_order = display_order + 5");

      await client.query(`
        INSERT INTO firstaid_inspection_points (category, question, question_type, field_key, placeholder, display_order, is_required, is_active)
        VALUES 
          ('section_1', 'Inspector Name', 'text', 'inspector_name', 'e.g. John Perera', 1, true, true),
          ('section_1', 'EPF Number', 'text', 'epf_number', 'e.g. 12345', 2, false, true),
          ('section_1', 'Inspection Date', 'date', 'inspection_date', '', 3, true, true),
          ('section_2', 'First Aid Box No.', 'text', 'ladder_no', 'e.g. FAB-01', 4, true, true),
          ('section_2', 'Location / Section', 'text', 'section', 'e.g. Main Office / Warehouse', 5, true, true)
      `);
      console.log('Seeded First Aid Section 1 & 2');
    }

    await client.query('COMMIT');
    console.log('Seeding completed successfully!');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Seeding failed:', e);
  } finally {
    client.release();
    await pool.end();
  }
}

run();

