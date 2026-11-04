import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { before, after, test } from 'node:test';
import ExcelJS from 'exceljs';
import { google } from 'googleapis';

process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'regression-tests-only';
let app, server, base, pool, cookie;
before(async () => {
  ({ default: app } = await import('../server.js'));
  pool = app.locals.pool;
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const response = await request('/login', 'POST', { password: process.env.ADMIN_PASSWORD });
  cookie = response.headers.get('set-cookie').split(';')[0];
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  await pool.end();
});

function request(path, method = 'GET', body, session = cookie) {
  return fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(session ? { Cookie: session } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function json(path, method, body, status = 200) {
  const response = await request(path, method, body);
  const result = await response.json();
  assert.equal(response.status, status, JSON.stringify(result));
  return result;
}
const options = [
  { option_label: 'Good', option_value: 'PASS', is_fail_value: false },
  { option_label: 'Bad', option_value: 'FAIL', is_fail_value: true }
];
const question = mode => ({ category: mode === 'ladder' ? 'general' : mode, question: 'Is the equipment safe?',
  display_order: 1, question_type: 'decision', is_active: true, is_required: true, placeholder: 'Choose outcome', field_key: 'safety', options });

test('authentication rejects missing, expired, future, and logged out sessions', async () => {
  assert.equal((await request('/questions', 'GET', undefined, '')).status, 401);
  assert.equal((await request('/login', 'POST', { password: 'wrong' })).status, 401);
  for (const timestamp of [Date.now() - 8 * 86400000, Date.now() + 86400000]) {
    const payload = String(timestamp);
    const signature = crypto.createHmac('sha256', process.env.ADMIN_PASSWORD).update(payload).digest('hex');
    const response = await request('/session', 'GET', undefined, `admin_session=${payload}.${signature}`);
    assert.equal((await response.json()).authenticated, false);
  }
  const login = await request('/login', 'POST', { password: process.env.ADMIN_PASSWORD });
  const otherCookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/logout', 'POST', {}, otherCookie)).status, 200);
  assert.equal((await request('/session', 'GET', undefined, otherCookie).then(r => r.json())).authenticated, false);
});

test('invalid question payloads and modes fail before a database write', async () => {
  await json('/questions?mode=sheet', 'POST', question('ladder'), 400);
  for (const change of [{ question: '' }, { display_order: 1.5 }, { is_active: 'false' }, { question_type: 'unknown' }, { options: [] }, { options: [...options, options[0]] }, { options: null }]) {
    await json('/questions?mode=fire', 'POST', { ...question('fire'), ...change }, 400);
  }
  await json('/questions/1/active?mode=fire', 'PATCH', { is_active: 'false' }, 400);
  await json('/inspections?mode=ladder&from=2026-02-30', 'GET', undefined, 400);
  await json('/export/inspections?mode=fire&from=2026-11-05&to=2026-11-04', 'GET', undefined, 400);
});

test('Google Sheet data and exports quote worksheet names and report missing tabs', async t => {
  const previousCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ type: 'service_account', client_email: 'test@example.com', private_key: 'test-key' });
  t.after(() => {
    if (previousCredentials === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = previousCredentials;
  });
  const ranges = [];
  t.mock.method(google, 'sheets', () => ({ spreadsheets: {
    get: async () => ({ data: { properties: { title: 'Test' }, sheets: [{ properties: { title: "Inspector's list", sheetId: 42, gridProperties: { rowCount: 3, columnCount: 2 } } }] } }),
    values: { get: async ({ range }) => { ranges.push(range); return { data: { values: [['Name', 0], ['Test', 0]] } }; } }
  } }));
  const data = await json('/sheets/data?sheetName=Inspector%27s%20list');
  assert.deepEqual(data.headers, ['Name', '0']);
  assert.deepEqual(data.rows, [['Test', '0']]);
  assert.equal(ranges[0], "'Inspector''s list'");
  const response = await request('/sheets/export?sheetName=Inspector%27s%20list');
  assert.equal(response.status, 200);
  assert.equal(ranges[1], "'Inspector''s list'");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  assert.equal(workbook.worksheets[0].getCell('B2').value, 0);
  await json('/sheets/data?sheetName=missing', 'GET', undefined, 404);
  await json('/sheets/export?sheetName=missing', 'GET', undefined, 404);
});

test('API workflows against isolated PostgreSQL temporary tables', { skip: process.env.TEST_DATABASE !== '1' }, async t => {
  const client = await pool.connect();
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  t.after(async () => {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    try {
      // All fixtures are temporary; committing removes ON COMMIT DROP tables
      // and also clears any stale temporary tables from an interrupted run.
      await client.query('commit');
    } finally {
      client.release();
    }
  });
  // Temporary tables shadow the production tables only on this test connection.
  // Local identity sequences ensure fixture inserts never touch production sequences.
  const modes = {
    ladder: ['inspection_points', 'question_options', 'inspections', 'inspection_results'],
    fire: ['fire_inspection_points', 'fire_question_options', 'fire_inspections', 'fire_inspection_results'],
    firstaid: ['firstaid_inspection_points', 'firstaid_question_options', 'firstaid_inspections', 'firstaid_inspection_results']
  };
  // An outer transaction pins one backend even with transaction-pooled databases.
  await client.query('begin');
  for (const tables of Object.values(modes)) {
    for (const name of tables) {
      await client.query(`drop table if exists pg_temp.${name} cascade`);
      await client.query(`create temporary table ${name} (like public.${name} including all) on commit drop`);
      if (!name.endsWith('inspections')) {
        await client.query(`alter table pg_temp.${name} alter column id drop identity if exists`);
        await client.query(`alter table pg_temp.${name} alter column id drop default`);
        await client.query(`alter table pg_temp.${name} alter column id add generated by default as identity`);
      }
    }
  }
  const deletionMigration = (await import('node:fs')).readFileSync(new URL('../supabase/migrations/20261104010000_question_deletion.sql', import.meta.url), 'utf8')
    .replaceAll('public.', 'pg_temp.').replaceAll('search_path = public', 'search_path = pg_temp');
  await client.query(deletionMigration);
  const typesMigration = (await import('node:fs')).readFileSync(new URL('../supabase/migrations/20261104020000_question_answer_types.sql', import.meta.url), 'utf8')
    .replaceAll('public.', 'pg_temp.').replaceAll('search_path = public', 'search_path = pg_temp');
  await client.query(typesMigration);
  pool.query = (...args) => client.query(...args);
  pool.connect = async () => ({ query: (sql, values) => {
    const transaction = sql.trim().toLowerCase();
    if (transaction === 'begin') return client.query('savepoint api_request');
    if (transaction === 'commit') return client.query('release savepoint api_request');
    if (transaction === 'rollback') return client.query('rollback to savepoint api_request');
    return client.query(sql, values);
  }, release() {} });

  for (const [mode, tables] of Object.entries(modes)) {
    await t.test(`${mode}: create, status changes, saves, options, and missing IDs`, async () => {
      const { id } = await json(`/questions?mode=${mode}`, 'POST', question(mode));
      assert.equal(id, 1);
      let [saved] = await json(`/questions?mode=${mode}`);
      const optionIds = saved.options.map(option => option.id);
      await json(`/questions/${id}/active?mode=${mode}`, 'PATCH', { is_active: false });
      [saved] = await json(`/questions?mode=${mode}`);
      assert.equal(saved.is_active, false);
      assert.deepEqual(saved.options.map(option => option.id), optionIds);
      await json(`/questions/${id}/active?mode=${mode}`, 'PATCH', { is_active: true });
      await json(`/questions/${id}?mode=${mode}`, 'PUT', { question: 'Edited question', options: [options[0]] });
      [saved] = await json(`/questions?mode=${mode}`);
      assert.equal(saved.question, 'Edited question');
      assert.equal(saved.field_key, 'safety', 'omitted metadata is preserved');
      assert.equal(saved.placeholder, 'Choose outcome');
      assert.equal(saved.options.length, 1);
      assert.equal(saved.options[0].id, optionIds[0]);
      const history = await client.query(`select is_active from ${tables[1]} where id=$1`, [optionIds[1]]);
      assert.equal(history.rows[0].is_active, false, 'removed option remains available to historical references');
      await json(`/questions/${id}?mode=${mode}`, 'PUT', { ...question(mode), is_active: false, field_key: 'changed', placeholder: 'Updated hint' });
      [saved] = await json(`/questions?mode=${mode}`);
      assert.equal(saved.is_active, false);
      assert.equal(saved.field_key, 'changed');
      assert.equal(saved.placeholder, 'Updated hint');
      assert.deepEqual(saved.options.map(option => option.id), optionIds);
      await json(`/questions/${id}/active?mode=${mode}`, 'PATCH', { is_active: false });
      await json(`/questions/999?mode=${mode}`, 'PUT', question(mode), 404);
      await json(`/questions/999/active?mode=${mode}`, 'PATCH', { is_active: true }, 404);
      await json(`/questions/999?mode=${mode}`, 'DELETE', undefined, 404);
      for (const other of Object.keys(modes).filter(value => value !== mode)) {
        const rows = await json(`/questions?mode=${other}`);
        if (rows.length) assert.equal(rows[0].field_key, 'changed');
      }
    });
  }

  for (const [mode, tables] of Object.entries(modes)) {
    await t.test(`${mode}: filter lists and Excel exports by dates, location, inspector, and result`, async () => {
      const id = crypto.randomUUID();
      const fields = { id, inspector_name: 'Regression Inspector', epf_number: '1234', inspection_date: '2026-11-04', overall_result: 'FAIL', remarks: 'Needs attention', submission_key: crypto.randomUUID() };
      Object.assign(fields, mode === 'ladder' ? { ladder_no: 'L-01', section: 'Regression Bay', height_feet: 12, ladder_type: 'extension' }
        : mode === 'fire' ? { point_no: 'FE-01', location: 'Regression Bay', quantity: '1', extinguisher_type: 'CO2', pressure_weight: '5 kg' }
          : { box_no: 'FA-01', location: 'Regression Bay' });
      const names = Object.keys(fields);
      await client.query(`insert into ${tables[2]} (${names.join(',')}) values (${names.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(fields));
      const answer = { inspection_id: id, inspection_point_id: 1, question_text_snapshot: 'Edited question', display_order_snapshot: 1, result: 'FAIL', answer_label: 'Bad', remarks: 'Needs repair' };
      if (mode === 'ladder') answer.category_snapshot = 'general';
      await client.query(`insert into ${tables[3]} (${Object.keys(answer).join(',')}) values (${Object.keys(answer).map((_, i) => `$${i + 1}`).join(',')})`, Object.values(answer));
      const query = `mode=${mode}&from=2026-11-04&to=2026-11-04&ladder=Regression%20Bay&inspector=Regression&status=FAIL`;
      const records = await json(`/inspections?${query}`);
      assert.equal(records.length, 1);
      assert.equal(records[0].inspection_date, '2026-11-04');
      assert.equal(records[0].epf_number, '1234');
      assert.equal(records[0].fail_count, 1);
      const details = await json(`/inspections/${id}?mode=${mode}`);
      assert.equal(details[0].answer_label, 'Bad');
      await json(`/questions/1?mode=${mode}`, 'PUT', { question: 'Renamed export question', display_order: 2, is_active: true });
      await json(`/questions?mode=${mode}`, 'POST', { ...question(mode), question: 'New export question', display_order: 1 });
      const response = await request(`/export/inspections?${query}`);
      assert.equal(response.status, 200);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
      const values = [];
      workbook.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => values.push(cell.value instanceof Date ? cell.value.toISOString().slice(0, 10) : String(cell.value ?? '')))));
      assert.ok(values.includes('1234'), 'export contains the matching fixture');
      assert.ok(values.includes('2026-11-04'), 'export preserves calendar date');
      const sheet = workbook.worksheets[0];
      const headings = sheet.getRow(mode === 'fire' ? 9 : 5).values;
      const renamedColumn = headings.findIndex(value => String(value).includes('Renamed export question'));
      const addedColumn = headings.findIndex(value => String(value).includes('New export question'));
      assert.ok(addedColumn > 0 && addedColumn < renamedColumn, 'question additions and ordering are dynamic');
      assert.equal(sheet.getCell(mode === 'fire' ? 10 : 6, renamedColumn).value, 'Bad', 'renamed question retains the saved answer by ID');
      assert.equal(sheet.getCell(mode === 'fire' ? 10 : 6, addedColumn).value, null, 'new questions have blank historical answers');
      assert.ok(values.includes('Edited question'), 'original question wording is preserved in history');
      assert.equal((await json(`/inspections?mode=${mode}&ladder=does-not-exist`)).length, 0);
      for (const [type, value] of [['text', 'FAIL'], ['number', 0], ['date', '2026-11-04']]) {
        const created = await json(`/questions?mode=${mode}`, 'POST', { ...question(mode), question: `Typed ${type}`, question_type: type, field_key: '', options: [] });
        await client.query(`insert into ${tables[3]} (inspection_id,inspection_point_id,question_text_snapshot,display_order_snapshot,result,answer_label,answer_value,question_type_snapshot${mode === 'ladder' ? ',category_snapshot' : ''}) values ($1,$2,$3,3,'ANSWERED',$4,$5::jsonb,$6${mode === 'ladder' ? ",'general'" : ''})`, [id, created.id, `Typed ${type}`, String(value), JSON.stringify(value), type]);
      }
      const typedDetails = await json(`/inspections/${id}?mode=${mode}`);
      assert.equal(typedDetails.find(answer => answer.question_type === 'number').answer_value, 0);
      const typedResponse = await request(`/export/inspections?mode=${mode}`);
      const typedWorkbook = new ExcelJS.Workbook();
      await typedWorkbook.xlsx.load(Buffer.from(await typedResponse.arrayBuffer()));
      const typedSheet = typedWorkbook.worksheets[0];
      const typedHeaders = typedSheet.getRow(mode === 'fire' ? 9 : 5).values;
      const typedCell = name => typedSheet.getCell(mode === 'fire' ? 10 : 6, typedHeaders.findIndex(value => String(value).includes(name)));
      assert.equal(typedCell('Typed text').value, 'FAIL');
      assert.equal(typedCell('Typed number').value, 0);
      assert.equal(typedCell('Typed date').value.toISOString().slice(0, 10), '2026-11-04');
    });
  }

  for (const [mode, tables] of Object.entries(modes)) {
    await t.test(`${mode}: deletion purges recorded data and export columns and rejects late submissions`, async () => {
      const before = (await client.query(`select count(*)::int as count from ${tables[2]}`)).rows[0].count;
      const deleted = await json(`/questions/1?mode=${mode}`, 'DELETE');
      assert.equal(deleted.deletedAnswers, 1);
      assert.equal((await client.query(`select count(*)::int as count from ${tables[3]} where inspection_point_id=1`)).rows[0].count, 0);
      assert.equal((await client.query(`select count(*)::int as count from ${tables[1]} where question_id=1`)).rows[0].count, 0);
      assert.equal((await client.query(`select count(*)::int as count from ${tables[2]}`)).rows[0].count, before, 'inspection records remain intact');
      assert.ok(!(await json(`/questions?mode=${mode}`)).some(question => question.id === 1));
      await json(`/questions/1?mode=${mode}`, 'PUT', question(mode), 404);
      await json(`/questions/1/active?mode=${mode}`, 'PATCH', { is_active: true }, 404);
      await json(`/questions/1?mode=${mode}`, 'DELETE', undefined, 404);
      const response = await request(`/export/inspections?mode=${mode}`);
      assert.equal(response.status, 200);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
      const values = [];
      workbook.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => values.push(String(cell.value ?? '')))));
      assert.ok(!values.some(value => value.includes('Renamed export question') || value === 'Edited question' || value === 'Bad'));
      assert.ok(values.some(value => value.includes('New export question')), 'other questions remain');
      const inspection = (await client.query(`select id from ${tables[2]} limit 1`)).rows[0].id;
      await client.query('savepoint late_answer');
      await assert.rejects(client.query(`insert into ${tables[3]} (inspection_id, inspection_point_id, question_text_snapshot, display_order_snapshot, result) values ($1,1,'Late answer',1,'PASS')`, [inspection]), /permanently deleted/);
      await client.query('rollback to savepoint late_answer');
      const info = await json(`/questions?mode=${mode}`, 'POST', { ...question(mode), question: 'Inspector to delete', category: 'section_1', field_key: 'inspector_name', question_type: 'text', options: [] });
      const removedInfo = await json(`/questions/${info.id}?mode=${mode}`, 'DELETE');
      assert.equal(removedInfo.deletedValues, 1);
      assert.equal((await client.query(`select inspector_name from ${tables[2]} limit 1`)).rows[0].inspector_name, null);
      const date = await json(`/questions?mode=${mode}`, 'POST', { ...question(mode), question: 'Date to delete', category: 'section_1', field_key: 'inspection_date', question_type: 'date', options: [] });
      await json(`/questions/${date.id}?mode=${mode}`, 'DELETE');
      assert.equal((await client.query(`select inspection_date from ${tables[2]} limit 1`)).rows[0].inspection_date, null);
      const withoutInfo = await request(`/export/inspections?mode=${mode}`);
      const withoutInfoWorkbook = new ExcelJS.Workbook();
      await withoutInfoWorkbook.xlsx.load(Buffer.from(await withoutInfo.arrayBuffer()));
      const main = withoutInfoWorkbook.worksheets[0];
      const captions = main.getRow(mode === 'fire' ? 9 : 5).values.filter(value => value != null).map(String);
      assert.ok(!captions.some(value => /Inspector|Inspection Date|Date to delete/.test(value) || value === 'Date'));
    });
  }
});
