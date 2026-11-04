const ExcelJS = require('exceljs');

const INFORMATION_SECTIONS = new Set(['section_1', 'section_2']);
const MODES = {
  ladder: { title: 'Ladder Inspection Record', fields: [
    ['inspection_date', 'Inspection Date', 14], ['inspector_name', 'Inspector Name', 24], ['epf_number', 'EPF Number', 16],
    ['ladder_no', 'Ladder No.', 18], ['section', 'Section / Location', 24], ['height_feet', 'Height (Feet)', 16], ['ladder_type', 'Ladder Type', 20]
  ] },
  fire: { title: 'Fire Extinguisher Inspection Record', fields: [
    ['inspection_date', 'Inspection Date', 14], ['inspector_name', 'Inspector Name', 24], ['epf_number', 'EPF Number', 16],
    ['point_no', 'Point / Cylinder No.', 22], ['location', 'Location', 24], ['extinguisher_type', 'Extinguisher Type', 22],
    ['pressure_weight', 'Pressure / Weight Capacity', 26], ['quantity', 'Quantity', 16]
  ] },
  firstaid: { title: 'First Aid Box Inspection Record', fields: [
    ['inspection_date', 'Inspection Date', 14], ['inspector_name', 'Inspector Name', 24], ['epf_number', 'EPF Number', 16],
    ['box_no', 'First Aid Box No.', 22], ['location', 'Location', 24]
  ] }
};
const sectionName = category => ({ general: 'General', extension: 'Extension', step: 'Step', fire: 'Fire checklist', fire_extinguisher: 'Fire checklist', firstaid: 'First aid checklist' })[category] || 'Checklist';
const canonicalField = (mode, key) => mode === 'fire'
  ? ({ ladder_no: 'point_no', section: 'location', ladder_type: 'extinguisher_type' })[key] || key
  : mode === 'firstaid' ? ({ ladder_no: 'box_no', section: 'location' })[key] || key : key;
const hasValue = value => value !== null && value !== undefined && value !== '';
const order = (a, b) => Number(a.display_order ?? a.question_number ?? Infinity) - Number(b.display_order ?? b.question_number ?? Infinity) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true });

function calendarDate(value) {
  if (!value) return null;
  const text = value instanceof Date
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
    : String(value).slice(0, 10);
  const date = new Date(text + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) ? date : null;
}

function writeTable(sheet, columns, records, tableName) {
  // Stable keys keep two questions with identical wording in separate columns.
  const used = new Set();
  for (const column of columns) {
    let label = column.label;
    if (used.has(label.toLowerCase())) label += ` [${column.questionId ?? column.key}]`;
    const disambiguated = label;
    let suffix = 2;
    while (used.has(label.toLowerCase())) label = `${disambiguated} (${suffix++})`;
    used.add(label.toLowerCase());
    column.header = label;
  }
  sheet.columns = columns.map(column => ({ key: column.key, width: column.width || 36 }));
  const values = records.map(record => columns.map(column => {
    const value = column.value(record);
    return value === undefined ? null : value;
  }));
  if (values.length) {
    sheet.addTable({ name: tableName, ref: 'A5', headerRow: true, totalsRow: false,
      style: { theme: 'TableStyleMedium2', showRowStripes: true },
      columns: columns.map(column => ({ name: column.header, filterButton: true })), rows: values });
  } else {
    sheet.getRow(5).values = columns.map(column => column.header);
    sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: columns.length } };
  }
  sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 5, showGridLines: false }];
  sheet.pageSetup = { orientation: 'landscape', printTitlesRow: '4:5' };
  sheet.pageSetup.printArea = `A1:${sheet.getColumn(columns.length).letter}${Math.max(5, sheet.rowCount)}`;
  const headerHeight = Math.min(240, Math.max(42, ...columns.map(column => 18 * Math.ceil(column.header.length / Math.max(12, column.width || 36)) + 18)));
  sheet.getRow(5).height = headerHeight;
  columns.forEach((column, index) => {
    const header = sheet.getCell(5, index + 1);
    header.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF18344D' } };
    header.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    header.border = { right: { style: 'thin', color: { argb: 'FFFFFFFF' } } };
  });
  records.forEach((record, rowIndex) => {
    const row = sheet.getRow(rowIndex + 6);
    let lineCount = 1;
    columns.forEach((column, index) => {
      const cell = row.getCell(index + 1);
      cell.font = { name: 'Arial', size: 11, color: { argb: 'FF243447' } };
      cell.alignment = { vertical: 'middle', wrapText: true, horizontal: column.numeric ? 'right' : 'left' };
      if (column.date) cell.numFmt = 'yyyy-mm-dd';
      else if (column.text) cell.numFmt = '@';
      const text = String(cell.value ?? '');
      lineCount = Math.max(lineCount, text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / (column.width || 36))), 0));
    });
    row.height = Math.min(409, Math.max(28, lineCount * 15 + 10));
  });
  if (records.length) columns.forEach((column, index) => {
    if (!column.result) return;
    const failures = new Set(['FAIL', 'EXPIRED']);
    for (const record of records) if (['FAIL', 'EXPIRED'].includes(column.result(record))) failures.add(String(column.value(record)));
    const letter = sheet.getColumn(index + 1).letter;
    sheet.addConditionalFormatting({ ref: `${letter}6:${letter}${records.length + 5}`, rules: Array.from(failures, value => ({
      type: 'expression', formulae: [`${letter}6="${value.replace(/"/g, '""')}"`],
      style: { font: { bold: true, color: { argb: 'FF9C0006' } }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFE5E7' } } }
    })) });
  });
}

function heading(sheet, title, count, explanation) {
  sheet.getCell('A2').value = 'Sathosa Motors - ' + title;
  sheet.getCell('A2').font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FF18344D' } };
  sheet.getRow(2).height = 28;
  sheet.getCell('A3').value = `${count} ${count === 1 ? explanation.replace(/^(inspections|answers)\b/, word => word.slice(0, -1)) : explanation}`;
  sheet.getCell('A3').font = { name: 'Arial', size: 11, color: { argb: 'FF526477' } };
  sheet.getRow(3).height = 22;
}

function buildInspectionWorkbook({ mode = 'ladder', questions = [], rows = [] }) {
  const config = MODES[mode];
  if (!config) throw new Error('Invalid inspection mode.');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sathosa Motors';
  const sheet = workbook.addWorksheet('Inspection Records', { properties: { tabColor: { argb: 'FF18344D' } } });
  const questionById = new Map(questions.map(question => [String(question.id), question]));
  const inspections = new Map();
  const recordedQuestions = new Map();
  const history = [];
  for (const row of rows) {
    const inspectionId = String(row.inspection_id);
    if (!inspections.has(inspectionId)) inspections.set(inspectionId, { ...row, answers: new Map() });
    if (row.question_id === null || row.question_id === undefined) continue;
    const questionId = String(row.question_id);
    inspections.get(inspectionId).answers.set(questionId, row);
    if (!recordedQuestions.has(questionId)) recordedQuestions.set(questionId, row);
    history.push(row);
  }
  const records = Array.from(inspections.values());
  const columns = [{ key: 'inspection_id', label: 'Inspection ID', width: 38, text: true, group: 'Inspection details', value: record => String(record.inspection_id) }];
  const fields = new Map();
  // The latest edit is authoritative when older data has duplicate field bindings.
  for (const question of questions.filter(question => INFORMATION_SECTIONS.has(question.category)).sort((a, b) =>
    (new Date(a.updated_at || 0).getTime() - new Date(b.updated_at || 0).getTime()) || Number(a.id) - Number(b.id))) {
    fields.set(canonicalField(mode, question.field_key), question);
  }
  const metadata = config.fields.map(([key, label, width], index) => ({ key, label, width, index, question: fields.get(key) }))
    .filter(field => !field.question || field.question.is_active || records.some(record => hasValue(record[field.key])))
    .sort((a, b) => (a.question?.display_order ?? a.index + 1) - (b.question?.display_order ?? b.index + 1));
  for (const field of metadata) {
    const inactive = field.question?.is_active === false;
    columns.push({ key: field.key, label: (field.question?.question || field.label) + (inactive ? ' [Inactive]' : ''), width: field.width,
      date: field.key === 'inspection_date', numeric: field.key === 'height_feet', text: ['epf_number', 'ladder_no', 'point_no', 'box_no'].includes(field.key), group: 'Inspection details',
      value: record => field.key === 'inspection_date' ? calendarDate(record[field.key])
        : field.key === 'height_feet' && hasValue(record[field.key]) ? Number(record[field.key])
        : field.key === 'epf_number' && hasValue(record[field.key]) ? String(record[field.key]) : record[field.key] });
  }
  const current = questions.filter(question => !INFORMATION_SECTIONS.has(question.category) && question.is_active).sort(order);
  const currentIds = new Set(current.map(question => String(question.id)));
  const historical = Array.from(recordedQuestions.entries()).filter(([id]) => !currentIds.has(id) && !INFORMATION_SECTIONS.has(questionById.get(id)?.category))
    .map(([id, record]) => ({ ...(questionById.get(id) || {}), id, question: questionById.get(id)?.question || record.question,
      category: record.category, display_order: questionById.get(id)?.display_order ?? record.question_number, historical: true })).sort(order);
  for (const question of [...current, ...historical]) {
    const id = String(question.id);
    const label = `${mode === 'ladder' && question.category ? sectionName(question.category) + ': ' : ''}${question.question}${question.historical ? ' [Inactive]' : ''}`;
    columns.push({ key: 'question:' + id, questionId: id, label, width: 38, group: question.historical ? 'Historical questions' : sectionName(question.category),
      value: record => { const answer = record.answers.get(id); return answer?.answer_label ?? answer?.answer ?? null; },
      result: record => record.answers.get(id)?.answer });
  }
  columns.push(
    { key: 'item_remarks', label: 'Item Remarks', width: 48, group: 'Results', value: record => Array.from(record.answers.values()).filter(answer => hasValue(answer.answer_remarks)).map(answer => `${answer.question}: ${answer.answer_remarks}`).join('\n') },
    { key: 'overall_result', label: 'Overall Result', width: 18, group: 'Results', value: record => record.overall_result, result: record => record.overall_result },
    { key: 'overall_remarks', label: 'Overall Remarks', width: 48, group: 'Results', value: record => record.overall_remarks }
  );
  heading(sheet, config.title, records.length, 'inspections. Current question labels are shown below. Original wording is in Answer History.');
  writeTable(sheet, columns, records, 'InspectionRecords');
  let groupStart = 0;
  while (groupStart < columns.length) {
    let end = groupStart;
    while (end + 1 < columns.length && columns[end + 1].group === columns[groupStart].group) end++;
    if (end > groupStart) sheet.mergeCells(4, groupStart + 1, 4, end + 1);
    const cell = sheet.getCell(4, groupStart + 1);
    cell.value = columns[groupStart].group;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7EEF5' } };
    cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF18344D' } };
    cell.alignment = { vertical: 'middle' };
    groupStart = end + 1;
  }
  sheet.getRow(4).height = 24;
  const detail = workbook.addWorksheet('Answer History');
  heading(detail, 'Original Inspection Answers', history.length, 'answers. Question wording, answer labels and remarks are retained as submitted.');
  writeTable(detail, [
    { key: 'id', label: 'Inspection ID', width: 38, value: row => String(row.inspection_id) },
    { key: 'date', label: 'Inspection Date', width: 14, date: true, value: row => calendarDate(row.inspection_date) },
    { key: 'question_id', label: 'Question ID', width: 14, value: row => String(row.question_id) },
    { key: 'category', label: 'Section at Inspection', width: 22, value: row => row.category },
    { key: 'number', label: 'Order at Inspection', width: 16, numeric: true, value: row => row.question_number },
    { key: 'question', label: 'Question at Inspection', width: 56, value: row => row.question },
    { key: 'answer', label: 'Answer', width: 24, value: row => row.answer_label ?? row.answer, result: row => row.answer },
    { key: 'result', label: 'Result', width: 16, value: row => row.answer, result: row => row.answer },
    { key: 'remarks', label: 'Answer Remarks', width: 56, value: row => row.answer_remarks }
  ], history, 'OriginalAnswers');
  return workbook;
}

module.exports = { buildInspectionWorkbook };
