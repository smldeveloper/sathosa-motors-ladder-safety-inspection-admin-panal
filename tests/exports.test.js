import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { buildInspectionWorkbook } from '../lib/inspection-export.cjs';

function fixture(mode) {
  const category = mode === 'ladder' ? 'general' : mode;
  const questions = [
    { id: 1, category, question: 'New wording after edit', display_order: 4, is_active: true },
    { id: 2, category, question: 'Newly added question', display_order: 1, is_active: true },
    { id: 3, category, question: 'Retired question', display_order: 2, is_active: false },
    { id: 4, category, question: 'Unused inactive question', display_order: 3, is_active: false },
    { id: 5, category, question: 'Newly added question', display_order: 5, is_active: true },
    { id: 6, category: 'section_2', field_key: 'ladder_no', question: 'Renamed Equipment Identifier', display_order: 1, is_active: true },
    { id: 7, category: 'section_1', field_key: 'inspector_name', question: 'Assigned Inspector', display_order: 2, is_active: true },
    { id: 8, category: 'section_1', field_key: 'epf_number', question: 'Hidden unused EPF', display_order: 3, is_active: false }
  ];
  const inspection = { inspection_id: 'inspection-001', inspection_date: '2026-11-04', inspector_name: 'Test Inspector', ladder_no: 'L-001', section: 'Workshop', height_feet: '12.5', ladder_type: 'extension',
    point_no: 'FE-001', location: 'Workshop', extinguisher_type: 'CO2', pressure_weight: '5 kg', quantity: 0, box_no: 'FA-001', overall_result: 'FAIL', overall_remarks: 'Overall remarks retained' };
  const rows = [
    { ...inspection, question_id: 1, category, question_number: 99, question: 'Original wording when submitted', answer: 'FAIL', answer_label: 'Needs Repair', answer_remarks: 'Item remark retained' },
    { ...inspection, question_id: 3, category, question_number: 2, question: 'Retired wording when submitted', answer: 'PASS', answer_label: 'Good' },
    { ...inspection, question_id: 5, category, question_number: 3, question: 'A different question with duplicate wording', answer: 'PASS', answer_label: 'Second duplicate answer' }
  ];
  return { mode, questions, rows };
}
const headers = sheet => {
  if (sheet.name !== 'Sheet1') return sheet.getRow(5).values.slice(1);
  const values = Array.from({length: sheet.columnCount}, (_, i) => String(sheet.getCell(9, i + 1).value ?? ''));
  while (values.at(-1) === '') values.pop();
  return values;
};
const cell = (sheet, label, row = sheet.name === 'Sheet1' ? 10 : 6) => sheet.getCell(row, headers(sheet).findIndex(header => header.includes(label)) + 1);

for (const mode of ['ladder', 'fire', 'firstaid']) {
  test(`${mode}: renamed questions keep answers by ID; additions, ordering, duplicates, and history remain intact`, async () => {
    const input = fixture(mode);
    const generated = await buildInspectionWorkbook(input);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await generated.xlsx.writeBuffer());
    const sheet = workbook.worksheets[0];
    const labels = headers(sheet);
    assert.equal(cell(sheet, 'New wording after edit').value, 'Needs Repair');
    assert.equal(cell(sheet, 'Newly added question').value, null, 'new unanswered question remains blank');
    assert.ok(labels.findIndex(label => label.includes('Newly added question')) < labels.findIndex(label => label.includes('New wording after edit')));
    assert.equal(new Set(labels).size, labels.length, 'native table headings are unique');
    assert.equal(cell(sheet, '[5]').value, 'Second duplicate answer');
    assert.equal(cell(sheet, 'Retired question [Inactive]').value, 'Good');
    assert.ok(!labels.some(label => label.includes('Unused inactive')));
    assert.ok(!labels.some(label => label.includes('Hidden unused EPF')));
    assert.equal(cell(sheet, 'Assigned Inspector').value, 'Test Inspector');
    assert.equal(cell(sheet, 'Renamed Equipment Identifier').value, mode === 'ladder' ? 'L-001' : mode === 'fire' ? 'FE-001' : 'FA-001');
    assert.ok(cell(sheet, mode === 'fire' ? 'Date' : 'Inspection Date').value instanceof Date);
    assert.equal(cell(sheet, mode === 'fire' ? 'Date' : 'Inspection Date').value.toISOString().slice(0, 10), '2026-11-04');
    if (mode === 'ladder') assert.equal(cell(sheet, 'Height (Feet)').value, 12.5);
    if (mode === 'fire') assert.equal(cell(sheet, 'Quantity').value, 0);
    assert.match(cell(sheet, mode === 'fire' ? 'Overall Remarks' : 'Item Remarks').value, /Original wording when submitted: Item remark retained/);
    assert.match(cell(sheet, 'Overall Remarks').value, /Overall remarks retained/);
    if (mode === 'fire') {
      assert.equal(sheet.getCell('D1').value, 'Fire Extinguisher Inspection Record Sheet');
      assert.equal(sheet.getCell('A6').font.size, 12);
      assert.equal(sheet.getCell('A10').font.name, 'Calibri');
      assert.equal(sheet.getImages().length, 2);
    } else {
      assert.equal(sheet.actualRowCount, 5, 'four heading rows plus one inspection, no template samples');
      assert.ok(sheet.getTable('InspectionRecords'));
      assert.equal(sheet.views[0].ySplit, 5);
    }
    const history = workbook.getWorksheet('Answer History');
    assert.equal(cell(history, 'Question at Inspection').value, 'Original wording when submitted');
    assert.equal(cell(history, 'Order at Inspection').value, 99);
    assert.equal(cell(history, 'Result').value, 'FAIL');
    assert.equal(history.rowCount, 8);
    assert.ok(sheet.conditionalFormattings.length > 0, 'result formatting follows cell edits');
  });
}

test('grows beyond every old template row and column boundary, including AA and later columns', async () => {
  const questions = Array.from({ length: 45 }, (_, i) => ({ id: i + 1, category: 'firstaid', question: `Dynamic question ${i + 1}`, display_order: i + 1, is_active: true }));
  const rows = Array.from({ length: 65 }, (_, i) => questions.map(question => ({ inspection_id: `inspection-${i}`, inspection_date: '2026-11-04', box_no: `BOX-${i}`, inspector_name: 'Test',
    overall_result: 'PASS', question_id: question.id, question_number: question.display_order, question: question.question, answer: 'PASS', answer_label: `Answer ${i}:${question.id}` }))).flat();
  const wb = await buildInspectionWorkbook({ mode: 'firstaid', questions, rows });
  const saved = new ExcelJS.Workbook();
  await saved.xlsx.load(await wb.xlsx.writeBuffer());
  const sheet = saved.worksheets[0];
  assert.equal(sheet.rowCount, 70);
  assert.equal(sheet.columnCount, 54);
  assert.equal(cell(sheet, 'Dynamic question 45', 70).value, 'Answer 64:45');
  assert.equal(saved.getWorksheet('Answer History').rowCount, 2930);
});

test('empty exports have current headers without fake inspection rows', async () => {
  const wb = await buildInspectionWorkbook({ mode: 'fire', questions: fixture('fire').questions, rows: [] });
  const saved = new ExcelJS.Workbook();
  await saved.xlsx.load(await wb.xlsx.writeBuffer());
  const sheet = saved.worksheets[0];
  assert.equal(sheet.rowCount, 23, 'the reference blank rows are preserved');
  assert.ok(headers(sheet).some(label => label.includes('New wording after edit')));
  assert.ok(!headers(sheet).some(label => label.includes('Retired question')));
  assert.equal(saved.getWorksheet('Answer History').rowCount, 5);
});

test('inactive metadata with historical values is retained and marked, and the latest binding wins', async () => {
  const input = fixture('fire');
  input.questions.push({ id: 9, category: 'section_1', field_key: 'inspector_name', question: 'Disabled Inspector', display_order: 2, is_active: false, updated_at: '2026-11-04' });
  input.rows.push({ ...input.rows[0], inspection_id: 'inspection-002', question_id: null });
  const sheet = (await buildInspectionWorkbook(input)).worksheets[0];
  assert.equal(cell(sheet, 'Disabled Inspector [Inactive]').value, 'Test Inspector');
  assert.ok(!headers(sheet).some(label => label === 'Assigned Inspector'));
});

test('EPF and equipment identifiers preserve leading zeros in Excel', async () => {
  const input = fixture('fire');
  input.questions = input.questions.filter(question => question.field_key !== 'epf_number');
  input.rows.forEach(row => { row.epf_number = '00123'; row.point_no = '00042'; });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await (await buildInspectionWorkbook(input)).xlsx.writeBuffer());
  const sheet = wb.worksheets[0];
  assert.equal(cell(sheet, 'EPF Number').value, '00123');
  assert.equal(cell(sheet, 'EPF Number').numFmt, '@');
  assert.equal(cell(sheet, 'Renamed Equipment Identifier').value, '00042');
});

const referencePath = fileURLToPath(new URL('../fire_extinguisher_template.xlsx', import.meta.url));
const imageAnchors = sheet => sheet.getImages().map(image => ({ imageId: image.imageId, tl: image.range.tl.model, br: image.range.br.model, editAs: image.range.editAs }));
const imageHashes = workbook => workbook.worksheets[0].getImages().map(image => createHash('sha256').update(workbook.getImage(image.imageId).buffer).digest('hex'));

test('Fire exports preserve the reference header, logos, fonts, widths and original table design', async () => {
  const reference = new ExcelJS.Workbook();
  await reference.xlsx.readFile(referencePath);
  const source = reference.worksheets[0];
  const questions = Array.from({ length: 8 }, (_, index) => ({ id: index + 1, category: 'fire', question: source.getCell(9, 10 + index).value, display_order: index + 1, is_active: true }));
  const output = new ExcelJS.Workbook();
  await output.xlsx.load(await (await buildInspectionWorkbook({ mode: 'fire', questions, rows: [] })).xlsx.writeBuffer());
  const sheet = output.worksheets[0];
  assert.equal(sheet.name, source.name);
  assert.deepEqual(sheet.model.merges, source.model.merges);
  assert.deepEqual(sheet.views, source.views);
  assert.deepEqual(sheet.pageSetup, source.pageSetup);
  assert.deepEqual(sheet.properties, source.properties);
  assert.deepEqual(imageAnchors(sheet), imageAnchors(source));
  assert.deepEqual(imageHashes(output), imageHashes(reference));
  for (let c = 1; c <= reference.worksheets[0].columns.length; c++) assert.equal(sheet.getColumn(c).width, source.getColumn(c).width);
  for (let r = 1; r <= 23; r++) {
    assert.equal(sheet.getRow(r).height, source.getRow(r).height, `row ${r} height`);
    for (let c = 1; c <= 19; c++) {
      assert.deepEqual(sheet.getCell(r, c).value, source.getCell(r, c).value, `value ${r}:${c}`);
      assert.deepEqual(sheet.getCell(r, c).style, source.getCell(r, c).style, `style ${r}:${c}`);
    }
  }
});

test('Fire question columns and record rows expand without changing any document header cell or logo', async () => {
  const reference = new ExcelJS.Workbook();
  await reference.xlsx.readFile(referencePath);
  const source = reference.worksheets[0];
  const questions = Array.from({ length: 45 }, (_, index) => ({ id: index + 1, category: 'fire', question: `Changed question ${index + 1}`, display_order: index + 1, is_active: true }));
  const rows = Array.from({ length: 65 }, (_, index) => questions.map(question => ({ inspection_id: `ROW-${index}`, question_id: question.id,
    question: 'Original question text', question_number: question.display_order, answer: 'PASS', answer_label: `${index}:${question.id}`, overall_result: 'PASS' }))).flat();
  const saved = new ExcelJS.Workbook();
  await saved.xlsx.load(await (await buildInspectionWorkbook({ mode: 'fire', questions, rows })).xlsx.writeBuffer());
  const sheet = saved.worksheets[0];
  assert.equal(sheet.rowCount, 74);
  assert.equal(cell(sheet, 'Changed question 45', 74).value, '64:45');
  assert.deepEqual(imageAnchors(sheet), imageAnchors(source));
  assert.deepEqual(imageHashes(saved), imageHashes(reference));
  assert.deepEqual(sheet.model.merges.filter(merge => Number(merge.match(/\d+/)[0]) < 6), source.model.merges.filter(merge => Number(merge.match(/\d+/)[0]) < 6));
  for (let c = 1; c <= source.columns.length; c++) assert.equal(sheet.getColumn(c).width, source.getColumn(c).width);
  for (let r = 1; r <= 5; r++) for (let c = 1; c <= 19; c++) {
    assert.deepEqual(sheet.getCell(r, c).value, source.getCell(r, c).value);
    assert.deepEqual(sheet.getCell(r, c).style, source.getCell(r, c).style);
  }
  assert.equal(cell(sheet, 'Changed question 45', 9).font.size, 12);
  assert.equal(cell(sheet, 'Changed question 45', 74).font.size, 11);
});
