/* ═══════════════════════════════════════════════════════════
   Safety Inspection Admin Panel — Client-side JavaScript
   ═══════════════════════════════════════════════════════════ */

'use strict';

/* ─── State ──────────────────────────────────────────────── */
let questions = [];
let selectedQuestion = null;
let importedPreview = null;


document.getElementById('adminModeSelector')?.addEventListener('change', (e) => {
  showApp(e.target.value);
});


/* ─── Utility helpers ────────────────────────────────────── */
const esc = str => String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const q = id => document.getElementById(id);

function showErrorModal(msg) {
  const el = q('errorModalText');
  if (el) el.textContent = msg;
  const modal = q('errorModal');
  if (modal) modal.classList.add('active');
}

const show = el => el?.classList.remove('hidden');
const hide = el => el?.classList.add('hidden');

function showErrorModal(msg) {
  const modal = document.getElementById('errorModal');
  const text = document.getElementById('errorModalText');
  if (modal && text) {
    text.textContent = msg;
    modal.classList.add('active');
  } else {
    alert('Error: ' + msg);
  }
}

function sectionBadge(s) {
  const cls = {
    general: 'badge-section-general',
    extension: 'badge-section-extension',
    step: 'badge-section-step',
    fire: 'badge-section-general',
    fire_extinguisher: 'badge-section-general',
    firstaid: 'badge-section-general'
  };
  const lbl = {
    general: 'General',
    extension: 'Extension',
    step: 'Step',
    fire: 'Fire Ext.',
    fire_extinguisher: 'Fire Ext.',
    firstaid: 'First Aid'
  };
  return `<span class="badge ${cls[s] || 'badge-section-general'}">${lbl[s] || s}</span>`;
}

function typeBadge(t) {
  const labels = { decision: 'Decision', yes_no: 'Yes/No', multiple_choice: 'Choice', text: 'Text', long_text: 'Long Text', number: 'Number', date: 'Date' };
  return labels[t] || t;
}

/* ─── API calls ──────────────────────────────────────────── */
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin'
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch('/api' + path, opts);
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data && data.error) || data || `HTTP ${res.status}`);
  return data;
}

/* ─── Auth ───────────────────────────────────────────────── */
async function checkSession() {
  try {
    const d = await api('GET', '/session');
    if (d.authenticated) {
      showModeSelect();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
}

function showLogin() {
  hide(q('appView'));
  const m = q('modeSelectView'); if (m) hide(m);
  show(q('loginView'));
}

function showModeSelect() {
  hide(q('loginView'));
  hide(q('appView'));
  const m = q('modeSelectView'); if (m) show(m);
}

function showApp(mode) {
  window.adminMode = mode || 'ladder';
  if (q('adminModeSelector')) {
    q('adminModeSelector').value = window.adminMode;
  }
  const sub = document.querySelector('.topbar-brand .sub');
  if (sub) {
    sub.textContent = window.adminMode === 'fire' ? 'Sathosa Motors · Fire Extinguisher Admin' :
                      window.adminMode === 'firstaid' ? 'Sathosa Motors · First Aid Box Admin' :
                      window.adminMode === 'sheet' ? 'Sathosa Motors · Google Sheet Viewer' :
                      'Sathosa Motors · Ladder Inspection Admin';
  }

  const icon = document.getElementById('topbarIcon');
  if (icon) {
    icon.textContent = window.adminMode === 'fire' ? '🧯' :
                       window.adminMode === 'firstaid' ? '🩹' :
                       window.adminMode === 'sheet' ? '📊' : '🪜';
  }
  
  const thLocation = document.getElementById('thLocation');
  const thType = document.getElementById('thType');
  if (thLocation) thLocation.textContent = window.adminMode === 'fire' ? 'Point No / Location' : window.adminMode === 'firstaid' ? 'Box No / Location' : 'Ladder No / Location';
  if (thType) thType.textContent = window.adminMode === 'fire' ? 'Type / Qty' : window.adminMode === 'firstaid' ? 'Status' : 'Type / Height';
  if (q('filterLadder')) q('filterLadder').placeholder = window.adminMode === 'fire' ? 'Point No / Location' : window.adminMode === 'firstaid' ? 'Box No / Location' : 'Ladder / equipment';
  
  const catSelect = q('category');
  if (catSelect) {
    if (window.adminMode === 'fire') {
      catSelect.innerHTML = '<option value="fire">🧯 Fire Extinguisher</option>';
    } else if (window.adminMode === 'firstaid') {
      catSelect.innerHTML = '<option value="firstaid">🩹 First Aid Box</option>';
    } else {
      catSelect.innerHTML = `
        <option value="general">🔧 General</option>
        <option value="extension">🔄 Extension</option>
        <option value="step">🪜 Step</option>
      `;
    }
  }

  hide(q('loginView'));
  const m = q('modeSelectView'); if (m) hide(m);
  show(q('appView'));
  
  const navTabs = document.querySelector('nav.tabs');

  if (window.adminMode === 'sheet') {
    if (navTabs) navTabs.classList.add('hidden');
    document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
    const sPanel = q('sheetsTab');
    if (sPanel) sPanel.classList.remove('hidden');
    loadSheetData();
  } else {
    if (navTabs) navTabs.classList.remove('hidden');
    document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
    const qTab = document.querySelector('.tab[data-tab="questions"]');
    if (qTab) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      qTab.classList.add('active');
    }
    const qPanel = q('questionsTab');
    if (qPanel) qPanel.classList.remove('hidden');
    loadQuestions();
  }
}

q('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const errEl = q('loginError');
  errEl.textContent = '';
  const pw = q('password').value;
  try {
    await api('POST', '/login', { password: pw });
    q('password').value = '';
    showModeSelect();
  } catch (err) {
    errEl.textContent = err.message === 'Invalid password' ? 'Incorrect password. Try again.' : err.message;
  }
});

q('homeBtn')?.addEventListener('click', () => {
  showModeSelect();
});

q('themeToggleBtn')?.addEventListener('click', () => {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const btn = q('themeToggleBtn');
  if (currentTheme === 'dark') {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('theme', 'light');
    if(btn) btn.textContent = '🌙';
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('theme', 'dark');
    if(btn) btn.textContent = '☀️';
  }
});

// Load theme on startup
if (localStorage.getItem('theme') === 'dark') {
  document.documentElement.setAttribute('data-theme', 'dark');
  const btn = q('themeToggleBtn');
  if (btn) btn.textContent = '☀️';
}

q('logoutBtn').addEventListener('click', async () => {
  try { await api('POST', '/logout'); } catch {}
  showLogin();
});

/* ─── Tab Navigation ─────────────────────────────────────── */
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
    btn.classList.add('active');
    const panel = q(target + 'Tab');
    if (panel) panel.classList.remove('hidden');

    if (target === 'records') loadRecords();
    if (target === 'preview') renderPreview();
    if (target === 'sheets') loadSheetData();
  });
});

/* ═══════════════════════════════════════════════════════════
   QUESTIONS TAB
   ═══════════════════════════════════════════════════════════ */
async function loadQuestions() {
  try {
    questions = await api('GET', `/questions?mode=${window.adminMode}`);
    renderQuestionsTable();
    updateQuestionCount();
  } catch (err) {
    showErrorModal('Failed to load questions: ' + err.message);
  }
}

function updateQuestionCount() {
  const active = questions.filter(q => q.is_active).length;
  const total = questions.length;
  if (q('questionCount')) q('questionCount').textContent = `${active} active · ${total} total questions`;
}

function renderQuestionsTable() {
  const tbody = q('questionRows');
  if (!questions.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">📋</div><p>No questions found. Add the first one using the form.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = questions.map(item => `
    <tr class="${selectedQuestion?.id === item.id ? 'selected' : ''}" data-id="${item.id}" style="cursor:pointer;">
      <td class="mono" style="color:var(--text-2); width:56px;">${item.display_order}</td>
      <td>${item.category === 'fire_extinguisher' ? '<span class="badge badge-section-general">Fire Ext</span>' : sectionBadge(item.category)}</td>
      <td><div class="q-text" title="${esc(item.question)}">${esc(item.question)}</div></td>
      <td style="white-space:nowrap;">${typeBadge(item.question_type)}</td>
      <td>${item.is_required ? '<span class="badge badge-required">Req</span>' : '<span style="color:var(--text-3);font-size:0.78rem;">opt</span>'}</td>
      <td>${item.is_active
        ? '<span class="badge badge-active">Active</span>'
        : '<span class="badge badge-inactive">Off</span>'}</td>
      <td>
        <div style="display:flex;gap:6px;">
          <button class="btn-icon btn-sm" onclick="editQuestion(${item.id})" title="Edit">✏️</button>
          <button class="btn-icon btn-sm" onclick="toggleActive(${item.id}, ${!item.is_active})" title="${item.is_active ? 'Deactivate' : 'Activate'}">${item.is_active ? '🔇' : '✅'}</button>
        </div>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('tr').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
      const id = Number(row.dataset.id);
      editQuestion(id);
    });
  });
}

/* ─── Question Form ──────────────────────────────────────── */
function resetForm() {
  selectedQuestion = null;
  if (q('editorTitle')) q('editorTitle').textContent = 'Add Question';
  q('questionId').value = '';
  q('questionText').value = '';
  q('category').value = window.adminMode === 'fire' ? 'fire' : window.adminMode === 'firstaid' ? 'firstaid' : 'general';
  q('questionType').value = 'decision';
  q('sortOrder').value = (Math.max(0, ...questions.map(x => x.display_order)) + 1) || 1;
  q('required').checked = true;
  q('active').checked = true;
  renderOptionsEditor([
    { option_label: 'PASS', option_value: 'PASS', is_fail_value: false },
    { option_label: 'FAIL', option_value: 'FAIL', is_fail_value: true },
    
  ]);
  if (q('formStatus')) q('formStatus').textContent = '';
  q('formStatus').className = 'status-msg';
  q('deactivateBtn').style.display = 'none';
  q('questionText').focus();
  renderQuestionsTable(); // deselect
}

function editQuestion(id) {
  const q_item = questions.find(x => x.id === id);
  if (!q_item) return;
  selectedQuestion = q_item;
  if (q('editorTitle')) q('editorTitle').textContent = 'Edit Question';
  q('questionId').value = q_item.id;
  q('questionText').value = q_item.question;
  q('category').value = q_item.category;
  q('questionType').value = q_item.question_type;
  q('sortOrder').value = q_item.display_order;
  q('required').checked = q_item.is_required;
  q('active').checked = q_item.is_active;
  renderOptionsEditor(q_item.options || []);
  if (q('formStatus')) q('formStatus').textContent = '';
  q('formStatus').className = 'status-msg';
  q('deactivateBtn').style.display = '';
  if (q('deactivateBtn')) q('deactivateBtn').textContent = q_item.is_active ? '🔇 Deactivate' : '✅ Activate';
  renderQuestionsTable();
  q('questionForm').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ─── Options Editor ─────────────────────────────────────── */
function getOptions() {
  const rows = document.querySelectorAll('#optionsList .option-row');
  return Array.from(rows).map((row, i) => ({
    option_label: row.querySelector('.opt-label').value.trim(),
    option_value: row.querySelector('.opt-value').value.trim(),
    sort_order: i + 1,
    is_fail_value: row.querySelector('.fail-toggle').classList.contains('is-fail'),
  }));
}

function renderOptionsEditor(opts) {
  const list = q('optionsList');
  list.innerHTML = '';
  opts.forEach((opt, i) => addOptionRow(opt));
}

function addOptionRow(opt = { option_label: '', option_value: '', is_fail_value: false }) {
  const list = q('optionsList');
  const row = document.createElement('div');
  row.className = 'option-row';
  row.innerHTML = `
    <input type="text" class="opt-label" placeholder="Label" value="${esc(opt.option_label)}" required title="Display label">
    <input type="text" class="opt-value" placeholder="Value" value="${esc(opt.option_value)}" required title="Stored value">
    <button type="button" class="fail-toggle ${opt.is_fail_value ? 'is-fail' : ''}" title="Mark as fail outcome">FAIL</button>
    <button type="button" class="remove-opt" title="Remove option">✕</button>
  `;
  row.querySelector('.opt-label').addEventListener('input', function() {
    const valField = row.querySelector('.opt-value');
    if (!valField._edited) valField.value = this.value;
  });
  row.querySelector('.opt-value').addEventListener('input', function() {
    this._edited = true;
  });
  row.querySelector('.fail-toggle').addEventListener('click', function() {
    this.classList.toggle('is-fail');
  });
  row.querySelector('.remove-opt').addEventListener('click', () => row.remove());
  list.appendChild(row);
}

q('addOptionBtn')?.addEventListener('click', () => addOptionRow());

/* Show/hide options editor based on question type */
q('questionType').addEventListener('change', function() {
  const needsOptions = ['decision', 'yes_no', 'multiple_choice'].includes(this.value);
  q('optionsSection').style.display = needsOptions ? '' : 'none';
  if (needsOptions && !q('optionsList').children.length) {
    addOptionRow({ option_label: 'PASS', option_value: 'PASS', is_fail_value: false });
    addOptionRow({ option_label: 'FAIL', option_value: 'FAIL', is_fail_value: true });
    
  }
});

function getFormData() {
  const needsOptions = ['decision', 'yes_no', 'multiple_choice'].includes(q('questionType').value);
  return {
    question:      q('questionText').value.trim(),
    category:      q('category').value,
    question_type: q('questionType').value,
    display_order: Number(q('sortOrder').value),
    is_required:   q('required').checked,
    is_active:     q('active').checked,
    options:       needsOptions ? getOptions() : [],
  };
}

function setStatus(msg, type = 'ok') {
  const el = q('formStatus');
  if (el) {
    el.textContent = msg;
    el.className = `status-msg ${type}`;
  }
}

q('newQuestionBtn').addEventListener('click', resetForm);
q('resetFormBtn').addEventListener('click', resetForm);

q('deactivateBtn').addEventListener('click', async () => {
  if (!selectedQuestion) return;
  const newActive = !selectedQuestion.is_active;
  try {
    await toggleActive(selectedQuestion.id, newActive);
  } catch {}
});

async function toggleActive(id, newActive) {
  const item = questions.find(x => x.id === id);
  if (!item) return;
  try {
    await api('PUT', `/questions/${id}`, { ...item, is_active: newActive, options: item.options || [] });
    await loadQuestions();
    if (selectedQuestion?.id === id) editQuestion(id);
    setStatus(`Question ${newActive ? 'activated' : 'deactivated'}.`, 'ok');
  } catch (err) {
    showErrorModal('Error: ' + err.message);
  }
}

q('questionForm').addEventListener('submit', async e => {
  e.preventDefault();
  const data = getFormData();
  if (!data.question) { setStatus('Question text is required.', 'err'); return; }
  const needsOptions = ['decision', 'yes_no', 'multiple_choice'].includes(data.question_type);
  if (needsOptions && (!data.options.length || data.options.some(o => !o.option_label || !o.option_value))) {
    setStatus('All options must have a label and value.', 'err');
    return;
  }
  if (!Number.isFinite(data.display_order) || data.display_order <= 0) {
    setStatus('Sort order must be a positive number.', 'err');
    return;
  }

  setStatus('Saving…', 'ok');
  try {
    const id = q('questionId').value;
    if (id) {
      await api('PUT', `/questions/${id}`, data);
    } else {
      const result = await api('POST', '/questions', data);
      q('questionId').value = result.id;
    }
    await loadQuestions();
    setStatus('Question saved ✓', 'ok');
    if (!id) {
      // After adding, select the new question
      const created = questions.find(x => String(x.id) === String(q('questionId').value));
      if (created) editQuestion(created.id);
    }
  } catch (err) {
    showErrorModal('Error: ' + err.message);
  }
});

/* ═══════════════════════════════════════════════════════════
   PREVIEW TAB
   ═══════════════════════════════════════════════════════════ */
function renderPreview() {
  const container = q('previewList');
  if (!container) return;
  if (!questions || !questions.length) {
    container.innerHTML = '<p style="color:var(--text-3);padding:24px;">No questions found.</p>';
    return;
  }

  let sections = [];
  if (window.adminMode === 'fire') {
    sections = [
      {
        key: 'fire',
        match: cat => cat === 'fire' || cat === 'fire_extinguisher' || cat === 'general',
        label: '🧯 Fire Extinguisher Inspection Checklist',
        icon: '🧯'
      }
    ];
  } else if (window.adminMode === 'firstaid') {
    sections = [
      {
        key: 'firstaid',
        match: cat => cat === 'firstaid' || cat === 'general',
        label: '🩹 First Aid Box Inspection Checklist',
        icon: '🩹'
      }
    ];
  } else {
    sections = [
      { key: 'general', match: cat => cat === 'general', label: '🔧 General Inspection Points', icon: '🔧' },
      { key: 'extension', match: cat => cat === 'extension', label: '🔄 Extension Ladder Specific', icon: '🔄' },
      { key: 'step', match: cat => cat === 'step', label: '🪜 Step Ladder Specific', icon: '🪜' }
    ];
  }

  const renderedIds = new Set();
  let html = '';

  for (const sec of sections) {
    const items = questions.filter(x => sec.match ? sec.match(x.category) : x.category === sec.key);
    if (!items.length) continue;
    items.forEach(x => renderedIds.add(x.id));

    html += `
      <div class="preview-section fade-in">
        <div class="preview-section-title">
          <span>${sec.label}</span>
          <span style="margin-left:auto;font-size:0.75rem;opacity:0.8;font-weight:normal;">${items.length} questions</span>
        </div>
        ${items.map(item => renderPreviewQuestion(item)).join('')}
      </div>
    `;
  }

  const remaining = questions.filter(x => !renderedIds.has(x.id));
  if (remaining.length > 0) {
    html += `
      <div class="preview-section fade-in">
        <div class="preview-section-title">
          <span>📋 Additional Inspection Points</span>
          <span style="margin-left:auto;font-size:0.75rem;opacity:0.8;font-weight:normal;">${remaining.length} questions</span>
        </div>
        ${remaining.map(item => renderPreviewQuestion(item)).join('')}
      </div>
    `;
  }

  container.innerHTML = html;
}

function renderPreviewQuestion(item) {
  const optionsHtml = item.options && item.options.length ? `
    <div class="preview-options">
      ${item.options.map(opt => `
        <span class="preview-option-pill ${opt.is_fail_value ? 'pill-fail' : ''}">${esc(opt.option_label)}</span>
      `).join('')}
    </div>
  ` : '';

  return `
    <div class="preview-question ${item.is_active ? '' : 'inactive'}" style="${item.is_active ? '' : 'opacity:0.6;'}">
      <span class="preview-num">#${item.display_order}</span>
      <div style="flex:1;">
        <div class="preview-text">
          ${esc(item.question)}
          ${item.is_required ? ' <span style="color:var(--fail);font-size:0.85em;font-weight:bold;">*</span>' : ''}
        </div>
        ${optionsHtml}
      </div>
      <span class="preview-type-badge">${typeBadge(item.question_type)}</span>
      ${!item.is_active 
        ? '<span class="badge badge-inactive" style="margin-left:8px;">Inactive</span>' 
        : '<span class="badge badge-active" style="margin-left:8px;">Active</span>'}
    </div>
  `;
}



/* ═══════════════════════════════════════════════════════════
   RECORDS TAB
   ═══════════════════════════════════════════════════════════ */
async function loadRecords() {
  const params = new URLSearchParams();
  const from = q('filterFrom').value;
  const to = q('filterTo').value;
  const ladder = q('filterLadder').value.trim();
  const inspector = q('filterInspector').value.trim();
  const status = q('filterStatus').value;
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (ladder) params.set('ladder', ladder);
  if (inspector) params.set('inspector', inspector);
  if (status) params.set('status', status);

  const tbody = q('recordRows');
  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text-3);">Loading...</td></tr>`;

  try {
    params.set('mode', window.adminMode);
    const records = await api('GET', '/inspections?' + params);
    window.currentRecords = records;
    renderRecords(records);
    renderRecordStats(records);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--fail);padding:12px;">${esc(err.message)}</td></tr>`;
  }
}

function renderRecordStats(records) {
  const total = records.length;
  const passed = records.filter(r => r.overall_result === 'PASS').length;
  const failed = records.filter(r => r.overall_result === 'FAIL').length;
  const statsEl = q('recordStats');
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat-card amber-accent"><div class="stat-label">Total</div><div class="stat-value">${total}</div></div>
      <div class="stat-card pass-accent"><div class="stat-label">Passed</div><div class="stat-value">${passed}</div></div>
      <div class="stat-card fail-accent"><div class="stat-label">Failed</div><div class="stat-value">${failed}</div></div>
    `;
  }
}

function renderRecords(records) {
  const tbody = q('recordRows');
  if (!records.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">📊</div><p>No records match the current filters.</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = records.map(r => `
    <tr>
      <td class="mono" style="white-space:nowrap;">${r.inspection_date || '—'}</td>
      <td><strong>${esc(r.ladder_no)}</strong><br><span style="font-size:0.78rem;color:var(--text-2);">${esc(r.section)}</span></td>
      <td>${esc(r.inspector_name)}<br><span style="font-size:0.78rem;color:var(--text-2);">EPF: ${esc(r.epf_number)}</span></td>
      <td style="text-transform:capitalize;">${esc(r.ladder_type)}<br><span style="font-size:0.78rem;color:var(--text-2);">${window.adminMode === 'fire' ? r.height_feet : r.height_feet + ' ft'}${window.adminMode === 'fire' && r.pressure_weight ? ' (' + esc(r.pressure_weight) + ')' : ''}</span></td>
      <td><span class="badge ${r.overall_result === 'PASS' ? 'badge-pass' : 'badge-fail'}">${r.overall_result}</span></td>
      <td class="mono" style="font-size:0.8rem;">${r.answer_count ?? '—'} / ${r.fail_count > 0 ? `<span style="color:var(--fail);">${r.fail_count} fail</span>` : '<span style="color:var(--pass);">0 fail</span>'}</td>
      <td>
        <button class="btn-secondary btn-sm" onclick="toggleRecordDetails('${r.id}', this)" style="padding: 4px 8px; font-size: 0.75rem;">View Details</button>
        <button class="btn-primary btn-sm" onclick="printRecord('${r.id}')" style="padding: 4px 8px; font-size: 0.75rem; margin-left: 4px;">PDF</button>
      </td>
    </tr>
    <tr id="details-${r.id}" class="record-details hidden" style="background: rgba(0,0,0,0.1);">
      <td colspan="7" style="padding: 0;">
        <div class="details-content" style="padding: 16px; border-left: 3px solid var(--primary);">Loading...</div>
      </td>
    </tr>
  `).join('');
}

window.toggleRecordDetails = async function(id, btn) {
  const row = document.getElementById(`details-${id}`);
  if (!row.classList.contains('hidden')) {
    row.classList.add('hidden');
    btn.textContent = 'View Details';
    return;
  }
  row.classList.remove('hidden');
  btn.textContent = 'Hide Details';
  const content = row.querySelector('.details-content');
  if (content.dataset.loaded) return;
  content.innerHTML = 'Loading answers...';
  try {
    const answers = await api('GET', `/inspections/${id}?mode=${window.adminMode}`);
    content.innerHTML = `<table style="width:100%; font-size:0.85rem; margin:0; background:transparent;">
      <thead>
        <tr><th style="padding:6px;border-bottom:1px solid var(--border);text-align:left;">#</th><th style="padding:6px;border-bottom:1px solid var(--border);text-align:left;">Section</th><th style="padding:6px;border-bottom:1px solid var(--border);text-align:left;">Question</th><th style="padding:6px;border-bottom:1px solid var(--border);text-align:left;">Result</th><th style="padding:6px;border-bottom:1px solid var(--border);text-align:left;">Remarks</th></tr>
      </thead>
      <tbody>
        ${answers.map(a => `
          <tr>
            <td style="padding:6px;border-bottom:1px solid rgba(255,255,255,0.05);">${a.order}</td>
            <td style="padding:6px;border-bottom:1px solid rgba(255,255,255,0.05);">${esc(a.category)}</td>
            <td style="padding:6px;border-bottom:1px solid rgba(255,255,255,0.05);">${esc(a.question)}</td>
            <td style="padding:6px;border-bottom:1px solid rgba(255,255,255,0.05);"><span class="badge ${a.result === 'FAIL' ? 'badge-fail' : (a.result === 'PASS' ? 'badge-pass' : 'badge-inactive')}">${esc(a.answer_label || a.result)}</span></td>
            <td style="padding:6px;border-bottom:1px solid rgba(255,255,255,0.05);">${esc(a.remarks || '')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
    content.dataset.loaded = 'true';
  } catch (err) {
    content.innerHTML = '<span style="color:var(--fail);">Failed to load details: ' + esc(err.message) + '</span>';
  }
}

q('loadRecordsBtn').addEventListener('click', loadRecords);


q('exportPdfBtn')?.addEventListener('click', () => {
  try {
    const table = q('recordRows').cloneNode(true);
    // Remove details rows from the clone
    table.querySelectorAll('.record-details').forEach(el => el.remove());
    // Remove the actions column header & cells if needed, or just let it be.
    
    let content = '<div style="font-family: sans-serif; padding: 20px; color: #000; background: #fff; max-width: 1000px; margin: 0 auto;">';
    content += '<h2 style="margin: 0 0 20px 0; border-bottom: 2px solid #333; padding-bottom: 10px;">Inspection Records Summary</h2>';
    content += '<table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">';
    content += '<tr style="background-color: #f3f4f6; border-bottom: 2px solid #d1d5db; text-align: left;">';
    content += '<th style="padding: 10px;">Date</th>';
    content += '<th style="padding: 10px;">' + (window.adminMode === 'fire' ? 'Point No / Location' : 'Ladder / Location') + '</th>';
    content += '<th style="padding: 10px;">Inspector / EPF</th>';
    content += '<th style="padding: 10px;">' + (window.adminMode === 'fire' ? 'Type / Qty' : 'Type / Height') + '</th>';
    content += '<th style="padding: 10px;">Result</th>';
    content += '<th style="padding: 10px;">Answers</th>';
    content += '</tr>';
    
    // Copy each non-details row
    Array.from(table.children).forEach(tr => {
      content += '<tr style="border-bottom: 1px solid #e5e7eb;">';
      const tds = tr.querySelectorAll('td');
      for(let i=0; i<6; i++) { // Skip the Actions column
        content += '<td style="padding: 10px; vertical-align: top;">' + (tds[i] ? tds[i].innerHTML : '') + '</td>';
      }
      content += '</tr>';
    });
    
    content += '</table></div>';
    
    const wrapper = document.createElement('div');
    wrapper.innerHTML = content;
    
    const opt = {
      margin:       0.5,
      filename:     'inspection-summary.pdf',
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 2 },
      jsPDF:        { unit: 'in', format: 'letter', orientation: 'landscape' }
    };
    
    html2pdf().set(opt).from(wrapper).save();
    
  } catch(e) {
    showErrorModal('Failed to export PDF summary: ' + e.message);
  }
});

q('exportInspectionsBtn')?.addEventListener('click', () => {
  const params = new URLSearchParams();
  const from = q('filterFrom').value;
  const to = q('filterTo').value;
  const ladder = q('filterLadder').value.trim();
  const inspector = q('filterInspector').value.trim();
  const status = q('filterStatus').value;
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (ladder) params.set('ladder', ladder);
  if (inspector) params.set('inspector', inspector);
  if (status) params.set('status', status);
  params.set('mode', window.adminMode || 'ladder');
  window.location.href = '/api/export/inspections?' + params.toString();
});


/* ─── Init ───────────────────────────────────────────────── */
checkSession();

window.printRecord = async function(id) {
  try {
    const answers = await api('GET', '/inspections/' + id + '?mode=' + (window.adminMode || 'ladder'));
    const r = window.currentRecords ? window.currentRecords.find(rec => rec.id === id) : null;
    
    let content = '<div style="font-family: sans-serif; padding: 30px; color: #000; background: #fff; max-width: 900px; margin: 0 auto;">';
    
    if (r) {
      content += '<div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 10px;">';
      content += '<div><h2 style="margin: 0 0 10px 0;">Inspection Report</h2>';
      content += '<p style="margin: 3px 0;"><strong>Ladder No.:</strong> ' + (r.ladder_no || 'N/A') + '</p>';
      content += '<p style="margin: 3px 0;"><strong>Type:</strong> ' + (r.ladder_type || 'N/A') + '</p>';
      content += '<p style="margin: 3px 0;"><strong>' + (window.adminMode === 'fire' ? 'Quantity:' : 'Height:') + '</strong> ' + (r.height_feet || 0) + (window.adminMode === 'fire' ? '' : ' ft') + (window.adminMode === 'fire' && r.pressure_weight ? ' (' + esc(r.pressure_weight) + ')' : '') + '</p></div>';
      content += '<div style="text-align: right;">';
      content += '<p style="margin: 3px 0;"><strong>Date:</strong> ' + (r.inspection_date ? r.inspection_date.split('T')[0] : 'N/A') + '</p>';
      content += '<p style="margin: 3px 0;"><strong>Inspector:</strong> ' + (r.inspector_name || 'N/A') + '</p>';
      content += '<p style="margin: 3px 0;"><strong>Result:</strong> <span style="color:' + (r.overall_result === 'PASS' ? 'green' : 'red') + ';font-weight:bold;">' + (r.overall_result || 'N/A') + '</span></p>';
      content += '</div></div>';
    }
    
    content += '<table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">';
    content += '<tr style="background-color: #f3f4f6; border-bottom: 2px solid #d1d5db;">';
    content += '<th style="text-align: left; padding: 10px; width: 5%;">#</th>';
    content += '<th style="text-align: left; padding: 10px; width: 65%;">Question</th>';
    content += '<th style="text-align: left; padding: 10px; width: 10%;">Result</th>';
    content += '<th style="text-align: left; padding: 10px; width: 20%;">Remarks</th>';
    content += '</tr>';
    
    answers.forEach(a => {
      content += '<tr style="border-bottom: 1px solid #e5e7eb;">';
      content += '<td style="padding: 10px; vertical-align: top;">' + (a.order || '-') + '</td>';
      content += '<td style="padding: 10px; vertical-align: top;">' + esc(a.question) + '</td>';
      content += '<td style="padding: 10px; vertical-align: top; font-weight: bold; color: ' + (a.result === 'PASS' ? 'green' : (a.result === 'FAIL' ? 'red' : 'black')) + ';">' + esc(a.answer_label || a.result) + '</td>';
      content += '<td style="padding: 10px; vertical-align: top; font-size: 0.9em;">' + (esc(a.remarks) || '') + '</td>';
      content += '</tr>';
    });
    content += '</table></div>';
    
    const wrapper = document.createElement('div');
    wrapper.innerHTML = content;
    
    const opt = {
      margin:       0.5,
      filename:     'inspection-' + (r ? r.ladder_no : id) + '.pdf',
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 2 },
      jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' }
    };
    
    html2pdf().set(opt).from(wrapper).save();
    
  } catch(e) {
    showErrorModal('Failed to export PDF: ' + e.message);
  }
};

/* ── Mode Selection Buttons ── */
if (q('btnModeLadder')) q('btnModeLadder').addEventListener('click', () => showApp('ladder'));
if (q('btnModeFire')) q('btnModeFire').addEventListener('click', () => showApp('fire'));
if (q('btnModeFirstAid')) q('btnModeFirstAid').addEventListener('click', () => showApp('firstaid'));
if (q('btnModeSheet')) q('btnModeSheet').addEventListener('click', () => showApp('sheet'));

/* ═══════════════════════════════════════════════════════════
   GOOGLE SHEET VIEWER IMPLEMENTATION
   ═══════════════════════════════════════════════════════════ */

let currentSheetData = null;
let currentSheetName = null;
let sheetSearchQuery = '';
let sheetCurrentPage = 1;
let sheetRowsPerPage = 50;
let sheetSortCol = -1;
let sheetSortAsc = true;
let sheetViewMode = 'table';

async function loadSheetData(sheetName = null, forceRefresh = false) {
  const tableBody = q('sheetBodyRows');
  const headerRow = q('sheetHeaderRow');
  const permBox = q('sheetPermissionBox');
  const subtitle = q('sheetSubtitle');

  if (sheetName) currentSheetName = sheetName;

  if (tableBody) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="12" style="padding:48px; text-align:center; color:var(--text-3);">
          <div style="font-size:2rem; margin-bottom:12px; display:inline-block; animation:spin 1s linear infinite;">🔄</div>
          <div style="font-size:0.95rem; font-weight:600; color:var(--text-2);">Connecting to Google Sheets API…</div>
          <div style="font-size:0.8rem; margin-top:4px;">Retrieving live data via Google Cloud Service Account</div>
        </td>
      </tr>
    `;
  }

  try {
    const url = `/sheets/data${currentSheetName ? `?sheetName=${encodeURIComponent(currentSheetName)}` : ''}`;
    const data = await api('GET', url);
    currentSheetData = data;
    currentSheetName = data.activeSheet ? data.activeSheet.title : null;

    if (permBox) permBox.classList.add('hidden');
    if (subtitle) {
      subtitle.textContent = `Spreadsheet: ${data.spreadsheetTitle || 'Safety Inspection Sheet'} · Sheet: ${data.activeSheet?.title || 'Data'} · Last synced ${new Date(data.lastUpdated).toLocaleTimeString()}`;
    }

    renderSheetTabsStrip();
    renderSheetStats();
    sheetCurrentPage = 1;
    renderGoogleSheetTable();

  } catch (err) {
    console.error('Error loading Google Sheet:', err);
    if (tableBody) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="12" style="padding:36px; text-align:center; color:var(--fail);">
            <div style="font-size:2.2rem; margin-bottom:10px;">🛡️</div>
            <div style="font-weight:700; font-size:1rem; margin-bottom:6px;">Google Sheet Access Required</div>
            <div style="font-size:0.85rem; color:var(--text-2); max-width:600px; margin:0 auto 16px auto;">
              ${esc(err.message)}
            </div>
            <div style="display:inline-flex; gap:10px;">
              <button type="button" class="btn-primary btn-sm" onclick="loadSheetData(currentSheetName, true)">🔄 Try Again</button>
              <button type="button" class="btn-secondary btn-sm" onclick="switchToSheetEmbedView()">🖥️ Switch to Embedded View</button>
            </div>
          </td>
        </tr>
      `;
    }

    // Always fetch info to display the exact service account email and sharing helper
    if (permBox) {
      permBox.classList.remove('hidden');
      api('GET', '/sheets/info').then(info => {
        if (info.serviceAccountEmail && q('saEmailDisplay')) {
          q('saEmailDisplay').textContent = info.serviceAccountEmail;
        }
      }).catch(() => {});
    }
  }
}

function renderSheetTabsStrip() {
  const container = q('sheetTabsStrip');
  if (!container || !currentSheetData || !currentSheetData.sheets) return;

  container.innerHTML = currentSheetData.sheets.map(s => {
    const isActive = currentSheetName ? s.title === currentSheetName : s.isTarget;
    return `
      <button type="button" class="sheet-tab-pill ${isActive ? 'active' : ''}" data-sheet-name="${esc(s.title)}">
        <span>📄 ${esc(s.title)}</span>
        ${s.rowCount ? `<span style="font-size:0.7rem; opacity:0.75;">(${s.rowCount} rows)</span>` : ''}
      </button>
    `;
  }).join('');

  container.querySelectorAll('.sheet-tab-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetName = btn.dataset.sheetName;
      loadSheetData(targetName);
    });
  });
}

function renderSheetStats() {
  const container = q('sheetStatsRow');
  if (!container || !currentSheetData) return;

  container.innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Active Sheet Tab</div>
      <div class="stat-value" style="font-size:1.15rem; word-break:break-all;">${esc(currentSheetData.activeSheet?.title || 'Sheet1')}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Total Rows</div>
      <div class="stat-value">${(currentSheetData.totalRows || 0).toLocaleString()}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Total Columns</div>
      <div class="stat-value">${(currentSheetData.totalCols || 0).toLocaleString()}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Google API Status</div>
      <div class="stat-value" style="font-size:1rem; color:var(--pass);">Connected 🟢</div>
    </div>
  `;
}

function renderGoogleSheetTable() {
  if (!currentSheetData) return;

  const headerRow = q('sheetHeaderRow');
  const tableBody = q('sheetBodyRows');
  const infoEl = q('sheetPaginationInfo');
  const navEl = q('sheetPaginationNav');
  const countEl = q('sheetSearchCount');

  const headers = currentSheetData.headers || [];
  let rows = currentSheetData.rows || [];

  // Filter rows
  if (sheetSearchQuery) {
    const qLower = sheetSearchQuery.toLowerCase();
    rows = rows.filter(row => row.some(cell => String(cell || '').toLowerCase().includes(qLower)));
  }

  // Sort rows
  if (sheetSortCol >= 0 && sheetSortCol < headers.length) {
    const idx = sheetSortCol;
    rows = [...rows].sort((a, b) => {
      const valA = String(a[idx] ?? '').trim();
      const valB = String(b[idx] ?? '').trim();
      const numA = Number(valA);
      const numB = Number(valB);
      let cmp = 0;
      if (!isNaN(numA) && !isNaN(numB) && valA !== '' && valB !== '') {
        cmp = numA - numB;
      } else {
        cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
      }
      return sheetSortAsc ? cmp : -cmp;
    });
  }

  // Render headers
  if (headerRow) {
    headerRow.innerHTML = `
      <th style="width:50px; text-align:center;">#</th>
      ${headers.map((h, i) => {
        const isSorted = sheetSortCol === i;
        const arrow = isSorted ? (sheetSortAsc ? ' ▲' : ' ▼') : '';
        return `<th data-col-idx="${i}" title="Click to sort by ${esc(h)}">${esc(h)}${arrow}</th>`;
      }).join('')}
    `;

    headerRow.querySelectorAll('th[data-col-idx]').forEach(th => {
      th.addEventListener('click', () => {
        const colIdx = Number(th.dataset.colIdx);
        if (sheetSortCol === colIdx) {
          sheetSortAsc = !sheetSortAsc;
        } else {
          sheetSortCol = colIdx;
          sheetSortAsc = true;
        }
        renderGoogleSheetTable();
      });
    });
  }

  // Pagination calculation
  const totalRows = rows.length;
  const isAll = sheetRowsPerPage === 'all';
  const pageSize = isAll ? totalRows : Number(sheetRowsPerPage);
  const totalPages = isAll ? 1 : Math.max(1, Math.ceil(totalRows / pageSize));

  if (sheetCurrentPage > totalPages) sheetCurrentPage = totalPages;
  if (sheetCurrentPage < 1) sheetCurrentPage = 1;

  const startIdx = isAll ? 0 : (sheetCurrentPage - 1) * pageSize;
  const endIdx = isAll ? totalRows : Math.min(startIdx + pageSize, totalRows);
  const pageRows = rows.slice(startIdx, endIdx);

  // Render rows
  if (tableBody) {
    if (pageRows.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="${headers.length + 1}" style="padding:36px; text-align:center; color:var(--text-3);">
            ${sheetSearchQuery ? 'No matching rows found for search query.' : 'This sheet has no data rows.'}
          </td>
        </tr>
      `;
    } else {
      tableBody.innerHTML = pageRows.map((row, rIdx) => {
        const actualRowNo = startIdx + rIdx + 1;
        const cellsHtml = headers.map((_, cIdx) => {
          const val = row[cIdx] ?? '';
          const strVal = String(val).trim();
          let formatted = esc(strVal);

          // Keyword badge formatting
          if (strVal.toUpperCase() === 'PASS') {
            formatted = `<span class="sheet-cell-pass">PASS</span>`;
          } else if (strVal.toUpperCase() === 'FAIL') {
            formatted = `<span class="sheet-cell-fail">FAIL</span>`;
          } else if (strVal.toUpperCase() === 'EXPIRED') {
            formatted = `<span class="sheet-cell-fail">EXPIRED</span>`;
          } else if (strVal.startsWith('http://') || strVal.startsWith('https://')) {
            formatted = `<a href="${esc(strVal)}" target="_blank" rel="noopener noreferrer" style="color:var(--text); text-decoration:underline;">Link ↗</a>`;
          }

          return `<td title="${esc(strVal)}">${formatted}</td>`;
        }).join('');

        return `<tr><td style="text-align:center; color:var(--text-3); font-size:0.78rem;">${actualRowNo}</td>${cellsHtml}</tr>`;
      }).join('');
    }
  }

  // Update stats & pagination info
  if (countEl) {
    countEl.textContent = sheetSearchQuery ? `Filtered: ${totalRows} of ${currentSheetData.rows?.length || 0}` : `${totalRows} rows`;
  }

  if (infoEl) {
    if (totalRows === 0) {
      infoEl.textContent = 'Showing 0 rows';
    } else {
      infoEl.textContent = `Showing rows ${startIdx + 1}–${endIdx} of ${totalRows.toLocaleString()}`;
    }
  }

  if (navEl) {
    if (isAll || totalPages <= 1) {
      navEl.innerHTML = '';
    } else {
      let navHtml = `
        <button class="pagination-btn" ${sheetCurrentPage <= 1 ? 'disabled' : ''} data-page="${sheetCurrentPage - 1}">◀ Prev</button>
      `;

      const maxButtons = 5;
      let startPage = Math.max(1, sheetCurrentPage - 2);
      let endPage = Math.min(totalPages, startPage + maxButtons - 1);
      if (endPage - startPage < maxButtons - 1) {
        startPage = Math.max(1, endPage - maxButtons + 1);
      }

      if (startPage > 1) {
        navHtml += `<button class="pagination-btn" data-page="1">1</button>`;
        if (startPage > 2) navHtml += `<span style="padding:4px 6px; color:var(--text-3);">…</span>`;
      }

      for (let p = startPage; p <= endPage; p++) {
        navHtml += `
          <button class="pagination-btn ${p === sheetCurrentPage ? 'active' : ''}" data-page="${p}">${p}</button>
        `;
      }

      if (endPage < totalPages) {
        if (endPage < totalPages - 1) navHtml += `<span style="padding:4px 6px; color:var(--text-3);">…</span>`;
        navHtml += `<button class="pagination-btn" data-page="${totalPages}">${totalPages}</button>`;
      }

      navHtml += `
        <button class="pagination-btn" ${sheetCurrentPage >= totalPages ? 'disabled' : ''} data-page="${sheetCurrentPage + 1}">Next ▶</button>
      `;
      navEl.innerHTML = navHtml;

      navEl.querySelectorAll('button[data-page]').forEach(btn => {
        btn.addEventListener('click', () => {
          sheetCurrentPage = Number(btn.dataset.page);
          renderGoogleSheetTable();
          const tableWrap = document.querySelector('#sheetTableViewContainer .table-wrap');
          if (tableWrap) tableWrap.scrollTop = 0;
        });
      });
    }
  }
}

function switchToSheetTableView() {
  sheetViewMode = 'table';
  q('btnSheetViewTable')?.classList.add('active');
  q('btnSheetViewEmbed')?.classList.remove('active');
  q('sheetTableViewContainer')?.classList.remove('hidden');
  q('sheetEmbedViewContainer')?.classList.add('hidden');
}

function switchToSheetEmbedView() {
  sheetViewMode = 'embed';
  q('btnSheetViewEmbed')?.classList.add('active');
  q('btnSheetViewTable')?.classList.remove('active');
  q('sheetTableViewContainer')?.classList.add('hidden');
  q('sheetEmbedViewContainer')?.classList.remove('hidden');
}

window.switchToSheetEmbedView = switchToSheetEmbedView;
window.loadSheetData = loadSheetData;

/* Google Sheet Toolbar Event Listeners */
q('btnSheetViewTable')?.addEventListener('click', switchToSheetTableView);
q('btnSheetViewEmbed')?.addEventListener('click', switchToSheetEmbedView);
q('btnRefreshSheet')?.addEventListener('click', () => loadSheetData(currentSheetName, true));
q('btnRetrySheetAccess')?.addEventListener('click', () => loadSheetData(currentSheetName, true));
q('btnFallbackEmbed')?.addEventListener('click', switchToSheetEmbedView);

q('filterSheetSearch')?.addEventListener('input', e => {
  sheetSearchQuery = e.target.value.trim();
  sheetCurrentPage = 1;
  renderGoogleSheetTable();
});

q('sheetPageSize')?.addEventListener('change', e => {
  sheetRowsPerPage = e.target.value;
  sheetCurrentPage = 1;
  renderGoogleSheetTable();
});

q('btnExportSheetXlsx')?.addEventListener('click', () => {
  const params = new URLSearchParams();
  if (currentSheetName) params.set('sheetName', currentSheetName);
  window.location.href = '/api/sheets/export?' + params.toString();
});

q('copySaEmailBtn')?.addEventListener('click', () => {
  const emailText = q('saEmailDisplay')?.textContent.trim();
  if (!emailText) return;

  const onCopied = () => {
    const btn = q('copySaEmailBtn');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✅ Copied!';
      btn.style.background = '#059669';
      setTimeout(() => {
        btn.textContent = orig;
        btn.style.background = '';
      }, 2500);
    }
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(emailText).then(onCopied).catch(() => fallbackCopy(emailText, onCopied));
  } else {
    fallbackCopy(emailText, onCopied);
  }

  function fallbackCopy(text, cb) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      cb();
    } catch (e) {
      alert('Email: ' + text);
    }
    document.body.removeChild(ta);
  }
});

