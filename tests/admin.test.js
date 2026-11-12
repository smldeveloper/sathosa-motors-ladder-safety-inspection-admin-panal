import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Script } from 'node:vm';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../public/admin.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const fixture = (mode, id = 1) => ({ id, category: mode === 'ladder' ? 'general' : mode,
  question: `${mode} question`, question_type: 'decision', display_order: 1, is_active: true,
  is_required: true, placeholder: 'Original hint', field_key: 'original_key', options: [
    { id: 1, option_label: 'Good', option_value: 'PASS', is_fail_value: false },
    { id: 2, option_label: 'Bad', option_value: 'FAIL', is_fail_value: true }
  ] });

async function setup(t) {
  const dom = new JSDOM(html, { url: 'http://localhost', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window } = dom;
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const data = Object.fromEntries(['ladder', 'fire', 'firstaid'].map(mode => [mode, [fixture(mode)]]));
  const calls = [];
  let intercept;
  window.fetch = async (path, opts) => {
    const url = new URL(path, 'http://localhost');
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    const call = { url, method: opts.method, body };
    calls.push(call);
    if (intercept) {
      const response = intercept(call);
      if (response) return response;
    }
    const mode = url.searchParams.get('mode') || 'ladder';
    let result = {};
    if (url.pathname === '/api/session') result = { authenticated: true };
    else if (url.pathname === '/api/questions' && opts.method === 'GET') result = data[mode];
    else if (url.pathname.endsWith('/active')) data[mode][0].is_active = body.is_active;
    else if (url.pathname.startsWith('/api/questions/') && opts.method === 'DELETE') {
      data[mode] = data[mode].filter(question => String(question.id) !== url.pathname.split('/').at(-1));
    }
    else if (url.pathname === '/api/questions' && opts.method === 'POST') {
      const created = { ...body, id: 2 };
      data[mode].push(created);
      result = { id: 2 };
    } else if (url.pathname.startsWith('/api/questions/') && opts.method === 'PUT') {
      data[mode][0] = { ...data[mode][0], ...body };
    } else if (url.pathname === '/api/inspections') result = [];
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => structuredClone(result) };
  };
  new Script(source).runInContext(dom.getInternalVMContext());
  await tick();
  return { window, data, calls, el: id => window.document.getElementById(id),
    intercept: callback => { intercept = callback; }, tick };
}

for (const mode of ['ladder', 'fire', 'firstaid']) {
  test(`${mode}: deactivate, reactivate, edit, create, and preserve metadata`, async t => {
    const { window, data, calls, el } = await setup(t);
    window.showApp(mode);
    await tick();
    assert.equal(el('category').value, mode === 'ladder' ? 'general' : mode);
    assert.equal(el('sortOrder').value, '2');
    window.editQuestion(1);
    assert.equal(el('fieldKey').value, 'original_key');
    assert.equal(el('placeholder').value, 'Original hint');
    const optionIds = data[mode][0].options.map(o => o.id);
    await window.toggleActive(1, false);
    const toggle = calls.find(call => call.method === 'PATCH');
    assert.equal(toggle.url.searchParams.get('mode'), mode);
    assert.deepEqual(toggle.body, { is_active: false });
    assert.equal(el('active').checked, false);
    assert.match(el('questionRows').textContent, /Off/);
    window.renderPreview();
    assert.doesNotMatch(el('previewList').textContent, new RegExp(`${mode} question`));
    await window.toggleActive(1, true);
    assert.deepEqual(data[mode][0].options.map(o => o.id), optionIds);
    el('placeholder').value = 'Updated hint';
    el('fieldKey').value = 'updated_key';
    el('questionText').value = 'Updated question';
    el('questionForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await tick();
    const save = calls.find(call => call.method === 'PUT');
    assert.equal(save.url.searchParams.get('mode'), mode);
    assert.equal(save.body.placeholder, 'Updated hint');
    assert.equal(save.body.field_key, 'updated_key');
    assert.match(el('formStatus').textContent, /saved/);
    el('deactivateBtn').click();
    await tick();
    assert.equal(data[mode][0].is_active, false, 'editor uses saved state');
    el('newQuestionBtn').click();
    assert.equal(el('fieldKey').value, '');
    assert.equal(el('placeholder').value, '');
    el('questionText').value = 'New question';
    el('questionForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await tick();
    assert.equal(calls.find(call => call.method === 'POST').url.searchParams.get('mode'), mode);
    assert.equal(el('questionId').value, '2');
    assert.equal(data[mode].length, 2);
    for (const other of ['ladder', 'fire', 'firstaid'].filter(m => m !== mode)) {
      assert.equal(data[other][0].question, `${other} question`);
      assert.equal(data[other][0].is_active, true);
    }
  });
}

test('section filters survive editing, resets, and reloads; text editors hide options', async t => {
  const { window, data, el } = await setup(t);
  data.ladder.push({ ...fixture('ladder', 2), category: 'section_1', question: 'Employee name', question_type: 'text', options: [] });
  window.showApp('ladder');
  await tick();
  el('sectionFilter').value = 'section_1';
  el('sectionFilter').dispatchEvent(new window.Event('change'));
  window.editQuestion(2);
  assert.equal(el('category').value, 'section_1');
  assert.equal(el('optionsSection').style.display, 'none');
  assert.doesNotMatch(el('questionRows').textContent, /ladder question/);
  await window.loadQuestions();
  assert.doesNotMatch(el('questionRows').textContent, /ladder question/);
  window.resetForm(false);
  assert.doesNotMatch(el('questionRows').textContent, /ladder question/);
  assert.equal(el('optionsSection').style.display, '');
});

test('mode changes clear selected questions and ignore older responses', async t => {
  const harness = await setup(t);
  const { window, el } = harness;
  let resolveOld;
  harness.intercept(call => call.url.pathname === '/api/questions' && call.url.searchParams.get('mode') === 'fire'
    ? new Promise(resolve => { resolveOld = resolve; }) : null);
  window.showApp('ladder');
  await tick();
  window.editQuestion(1);
  window.showApp('fire');
  window.showApp('firstaid');
  await tick();
  resolveOld({ ok: true, headers: { get: () => 'application/json' }, json: async () => [fixture('fire')] });
  await tick();
  assert.equal(el('questionId').value, '');
  assert.match(el('questionRows').textContent, /firstaid question/);
  assert.doesNotMatch(el('questionRows').textContent, /fire question/);
});

test('failed saves are visible and duplicate submissions are blocked', async t => {
  const harness = await setup(t);
  const { window, el, calls } = harness;
  window.showApp('fire');
  await tick();
  window.editQuestion(1);
  let resolveSave;
  harness.intercept(call => call.method === 'PUT' ? new Promise(resolve => { resolveSave = resolve; }) : null);
  el('questionForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
  el('questionForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
  assert.equal(calls.filter(call => call.method === 'PUT').length, 1);
  resolveSave({ ok: false, status: 500, headers: { get: () => 'application/json' }, json: async () => ({ error: 'Database unavailable' }) });
  await tick();
  assert.match(el('errorModalText').textContent, /Database unavailable/);
  assert.match(el('formStatus').textContent, /could not be saved/);
  assert.equal(el('questionText').disabled, false);
});

test('first aid records and PDFs use box labels, dates, EPF, and no ladder heights', async t => {
  const { window, el } = await setup(t);
  window.showApp('firstaid');
  await tick();
  const records = [{ id: 7, inspection_date: '2026-11-04T00:00:00.000Z', ladder_no: 'BOX-1', section: 'Office', inspector_name: 'Test Inspector', epf_number: '123', overall_result: 'EXPIRED', answer_count: 1, fail_count: 1, height_feet: '' }];
  window.currentRecords = records;
  window.renderRecords(records);
  window.renderRecordStats(records);
  assert.doesNotMatch(el('recordRows').textContent, / ft|T00:00/);
  assert.match(el('recordRows').textContent, /123/);
  assert.match(el('recordStats').textContent, /Failed1/);
  window.fetch = async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => [] });
  let pdfText;
  window.html2pdf = () => ({ set() { return this; }, from(wrapper) { pdfText = wrapper.textContent; return this; }, save: async () => {} });
  await window.printRecord('7');
  assert.match(pdfText, /Box No.: BOX-1/);
  assert.match(pdfText, /EPF: 123/);
  assert.doesNotMatch(pdfText, /Height|Ladder No/);
});

test('switching registers resets filters and targets chemical links even when API access fails', async t => {
  const { window, el, calls, intercept } = await setup(t);
  t.mock.method(window.console, 'error', () => {});
  let resolveOld;
  intercept(call => {
    if (call.url.pathname === '/api/sheets/data') {
      if (call.url.searchParams.get('register') === 'near-missing') {
        return new Promise(resolve => { resolveOld = resolve; });
      }
      return { ok: false, status: 403, headers: { get: () => 'application/json' }, json: async () => ({ error: 'Access denied' }) };
    }
    return null;
  });
  assert.match(el('btnModeSheet').textContent, /Near Missing Accident Register/);
  el('btnModeSheet').click();
  el('filterSheetSearch').value = 'old search';
  el('filterSheetSearch').dispatchEvent(new window.Event('input'));
  el('btnSheetViewEmbed').click();
  el('btnModeChemicalSpill').click();
  await tick();
  assert.equal(window.adminMode, 'chemical-spill');
  assert.equal(el('sheetTitle').textContent, 'Chemical Spill Incident Record');
  assert.equal(el('filterSheetSearch').value, '');
  assert.equal(el('sheetTableViewContainer').classList.contains('hidden'), false);
  assert.match(el('sheetBodyRows').textContent, /Access denied/);
  assert.match(el('googleSheetIframe').src, /1wUjuUrK9ORu7E2yqL0JCqABAW2JsSAQsruUpydJXpZ0\/edit\?gid=833722442/);
  el('sheetsTab').querySelectorAll('a[href*="docs.google.com/spreadsheets"]').forEach(link => {
    assert.match(link.href, /1wUjuUrK9ORu7E2yqL0JCqABAW2JsSAQsruUpydJXpZ0/);
  });
  assert.ok(calls.some(call => call.url.pathname === '/api/sheets/info' && call.url.searchParams.get('register') === 'chemical-spill'));
  resolveOld({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ headers: ['Old register'], rows: [['Old data']], sheets: [] }) });
  await tick();
  assert.doesNotMatch(el('sheetBodyRows').textContent, /Old data/);
  el('btnRetrySheetAccess').click();
  await tick();
  assert.equal(calls.filter(call => call.url.pathname === '/api/sheets/data').at(-1).url.searchParams.get('register'), 'chemical-spill');
});

test('Google Sheet search finds zero values and worksheet selection updates embedded view', async t => {
  const { window, el, intercept } = await setup(t);
  intercept(call => call.url.pathname === '/api/sheets/data' ? {
    ok: true, headers: { get: () => 'application/json' }, json: async () => ({
      headers: ['Name', 'Count'], rows: [['Empty', 0], ['Full', 4]],
      activeSheet: { title: "Inspector's list", sheetId: 42 }, sheets: [],
      spreadsheetId: 'test-sheet', sheetUrl: 'https://docs.google.com/spreadsheets/d/test-sheet/edit#gid=42',
      totalRows: 2, totalCols: 2, lastUpdated: '2026-11-04T00:00:00Z'
    })
  } : null);
  window.showApp('sheet');
  await tick();
  el('filterSheetSearch').value = '0';
  el('filterSheetSearch').dispatchEvent(new window.Event('input'));
  assert.match(el('sheetBodyRows').textContent, /Empty/);
  assert.doesNotMatch(el('sheetBodyRows').textContent, /Full/);
  assert.match(el('googleSheetIframe').src, /test-sheet\/edit\?gid=42/);
  assert.match(el('btnOpenSheetUrl').href, /test-sheet/);
  el('btnSheetViewEmbed').click();
  assert.equal(el('sheetEmbedViewContainer').classList.contains('hidden'), false);
  el('btnSheetViewTable').click();
  assert.equal(el('sheetTableViewContainer').classList.contains('hidden'), false);
});

for (const mode of ['ladder', 'fire', 'firstaid']) {
  test(`${mode}: permanent deletion requires confirmation and clears the question and stale records`, async t => {
    const { window, el, calls } = await setup(t);
    window.showApp(mode);
    await tick();
    window.editQuestion(1);
    assert.equal(el('deleteQuestionBtn').style.display, '');
    window.confirm = () => false;
    el('deleteQuestionBtn').click();
    await tick();
    assert.equal(calls.filter(call => call.method === 'DELETE').length, 0);
    window.currentRecords = [{ id: 'old' }];
    window.confirm = message => { assert.match(message, /all recorded answers or values/); return true; };
    el('deleteQuestionBtn').click();
    await tick();
    const deletion = calls.find(call => call.method === 'DELETE');
    assert.equal(deletion.url.searchParams.get('mode'), mode);
    assert.doesNotMatch(el('questionRows').textContent, new RegExp(`${mode} question`));
    assert.equal(el('questionId').value, '');
    assert.equal(el('deleteQuestionBtn').style.display, 'none');
    assert.equal(window.currentRecords.length, 0);
    assert.match(el('formStatus').textContent, /recorded data deleted/);
  });
}
