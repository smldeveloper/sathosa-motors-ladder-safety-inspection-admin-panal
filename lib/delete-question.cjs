const bindings = {
  inspection_points: { inspector_name: 'inspector_name', epf_number: 'epf_number', inspection_date: 'inspection_date', ladder_no: 'ladder_no', section: 'section', height_feet: 'height_feet', ladder_type: 'ladder_type' },
  fire_inspection_points: { inspector_name: 'inspector_name', epf_number: 'epf_number', inspection_date: 'inspection_date', ladder_no: 'point_no', point_no: 'point_no', section: 'location', location: 'location', ladder_type: 'extinguisher_type', extinguisher_type: 'extinguisher_type', quantity: 'quantity', pressure_weight: 'pressure_weight' },
  firstaid_inspection_points: { inspector_name: 'inspector_name', epf_number: 'epf_number', inspection_date: 'inspection_date', ladder_no: 'box_no', box_no: 'box_no', section: 'location', location: 'location' }
};

async function deleteQuestion(pool, tables, id) {
  let client;
  try {
    client = await pool.connect();
    await client.query('begin');
    const { rows } = await client.query(`select id, category, field_key from ${tables.points} where id=$1 and not is_deleted for update`, [id]);
    if (!rows.length) throw Object.assign(new Error('Question not found.'), { status: 404 });
    const question = rows[0];
    const { rowCount: deletedAnswers } = await client.query(`delete from ${tables.results} where inspection_point_id=$1`, [id]);
    await client.query(`delete from ${tables.options} where question_id=$1`, [id]);
    const column = ['section_1', 'section_2'].includes(question.category) ? bindings[tables.points]?.[question.field_key] : null;
    let deletedValues = 0;
    if (column) {
      // Column identifiers come exclusively from the fixed binding map above.
      const result = await client.query(`update ${tables.inspections} set ${column}=null where ${column} is not null`);
      deletedValues = result.rowCount;
    }
    // Retain only an inactive binding tombstone so hard-coded information inputs
    // cannot reappear through the form's legacy defaults. All answer data is purged.
    await client.query(`update ${tables.points} set is_deleted=true, is_active=false, is_required=false, question='', placeholder='', updated_at=now() where id=$1`, [id]);
    await client.query('commit');
    return { ok: true, deletedAnswers, deletedValues };
  } catch (error) {
    if (client) await client.query('rollback');
    throw error;
  } finally {
    client?.release();
  }
}

module.exports = { deleteQuestion };
