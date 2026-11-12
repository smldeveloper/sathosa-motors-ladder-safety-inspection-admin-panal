import fs from 'node:fs';

const file = 'public/admin.js';
let src = fs.readFileSync(file, 'utf8');

// 1. Update sectionBadge to include section_1 and section_2
src = src.replace(
  `function sectionBadge(s) {\r\n  const cls = {\r\n    general: 'badge-section-general',\r\n    extension: 'badge-section-extension',\r\n    step: 'badge-section-step',\r\n    fire: 'badge-section-general',\r\n    fire_extinguisher: 'badge-section-general',\r\n    firstaid: 'badge-section-general'\r\n  };\r\n  const lbl = {\r\n    general: 'General',\r\n    extension: 'Extension',\r\n    step: 'Step',\r\n    fire: 'Fire Ext.',\r\n    fire_extinguisher: 'Fire Ext.',\r\n    firstaid: 'First Aid'\r\n  };\r\n  return \`<span class="badge \${cls[s] || 'badge-section-general'}">\${lbl[s] || s}</span>\`;\r\n}`,
  `function sectionBadge(s) {
  const cls = {
    section_1: 'badge-section-1',
    section_2: 'badge-section-2',
    general: 'badge-section-general',
    extension: 'badge-section-extension',
    step: 'badge-section-step',
    fire: 'badge-section-general',
    fire_extinguisher: 'badge-section-general',
    firstaid: 'badge-section-general'
  };
  const lbl = {
    section_1: '\u00a71 Info',
    section_2: '\u00a72 Equipment',
    general: '\u00a73 General',
    extension: '\u00a73 Extension',
    step: '\u00a73 Step',
    fire: '\u00a73 Fire Ext.',
    fire_extinguisher: '\u00a73 Fire Ext.',
    firstaid: '\u00a73 First Aid'
  };
  return \`<span class="badge \${cls[s] || 'badge-section-general'}">\${lbl[s] || s}</span>\`;
}`
);

// 2. Update the category selector in showApp to include section_1 / section_2
src = src.replace(
  `      catSelect.innerHTML = \`
        <option value="general">🔧 General</option>
        <option value="extension">🔄 Extension</option>
        <option value="step">🪜 Step</option>
      \`;`,
  `      catSelect.innerHTML = \`
        <option value="section_1">👤 Section 1: Employee Info</option>
        <option value="section_2">🏢 Section 2: Equipment Info</option>
        <option value="general">🔧 Section 3: General Checklist</option>
        <option value="extension">🔄 Section 3: Extension Ladder</option>
        <option value="step">🪜 Section 3: Step Ladder</option>
      \`;`
);

src = src.replace(
  `      catSelect.innerHTML = '<option value="fire">🧯 Fire Extinguisher</option>';`,
  `      catSelect.innerHTML = \`
        <option value="section_1">👤 Section 1: Employee Info</option>
        <option value="section_2">🏢 Section 2: Equipment Info</option>
        <option value="fire">🧯 Section 3: Fire Checklist</option>
      \`;`
);

src = src.replace(
  `      catSelect.innerHTML = '<option value="firstaid">🩹 First Aid Box</option>';`,
  `      catSelect.innerHTML = \`
        <option value="section_1">👤 Section 1: Employee Info</option>
        <option value="section_2">🏢 Section 2: Equipment Info</option>
        <option value="firstaid">🩹 Section 3: First Aid Checklist</option>
      \`;`
);

// 3. Update resetForm default category
src = src.replace(
  `  q('category').value = window.adminMode === 'fire' ? 'fire' : window.adminMode === 'firstaid' ? 'firstaid' : 'general';`,
  `  q('category').value = 'general';`
);

// 4. Update getFormData to include placeholder and field_key
src = src.replace(
  `    is_active:     q('active').checked,
    options:       needsOptions ? getOptions() : [],
  };
}`,
  `    is_active:     q('active').checked,
    placeholder:   (q('placeholder') ? q('placeholder').value.trim() : ''),
    field_key:     (q('fieldKey') ? q('fieldKey').value.trim() : ''),
    options:       needsOptions ? getOptions() : [],
  };
}`
);

// 5. Update editQuestion to populate placeholder/field_key
src = src.replace(
  `  q('required').checked = q_item.is_required;
  q('active').checked = q_item.is_active;`,
  `  q('required').checked = q_item.is_required;
  q('active').checked = q_item.is_active;
  if (q('placeholder')) q('placeholder').value = q_item.placeholder || '';
  if (q('fieldKey')) q('fieldKey').value = q_item.field_key || '';`
);

// 6. Add section filter logic after loadQuestions
const sectionFilterLogic = `
/* ─── Section Filter ─────────────────────────────────────── */
function applyFilteredTable() {
  const filter = (q('sectionFilter') ? q('sectionFilter').value : 'all') || 'all';
  const tbody = q('questionRows');
  if (!questions.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">📋</div><p>No questions found. Add the first one using the form.</p></div></td></tr>';
    return;
  }
  const isSection3 = cat => !['section_1','section_2'].includes(cat);
  const filtered = filter === 'all' ? questions
    : filter === 'section_3' ? questions.filter(x => isSection3(x.category))
    : questions.filter(x => x.category === filter);

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="padding:32px;text-align:center;color:var(--text-3);">No questions in this section. Try another filter or add one.</td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(item => \`
    <tr class="\${selectedQuestion?.id === item.id ? 'selected' : ''}" data-id="\${item.id}" style="cursor:pointer;">
      <td class="mono" style="color:var(--text-2); width:56px;">\${item.display_order}</td>
      <td>\${item.category === 'fire_extinguisher' ? '<span class="badge badge-section-general">Fire Ext</span>' : sectionBadge(item.category)}</td>
      <td><div class="q-text" title="\${esc(item.question)}">\${esc(item.question)}</div></td>
      <td style="white-space:nowrap;">\${typeBadge(item.question_type)}</td>
      <td>\${item.is_required ? '<span class="badge badge-required">Req</span>' : '<span style="color:var(--text-3);font-size:0.78rem;">opt</span>'}</td>
      <td>\${item.is_active
        ? '<span class="badge badge-active">Active</span>'
        : '<span class="badge badge-inactive">Off</span>'}</td>
      <td>
        <div style="display:flex;gap:6px;">
          <button class="btn-icon btn-sm" onclick="editQuestion(\${item.id})" title="Edit">✏️</button>
          <button class="btn-icon btn-sm" onclick="toggleActive(\${item.id}, \${!item.is_active})" title="\${item.is_active ? 'Deactivate' : 'Activate'}">\${item.is_active ? '🔇' : '✅'}</button>
        </div>
      </td>
    </tr>
  \`).join('');

  tbody.querySelectorAll('tr').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
      const id = Number(row.dataset.id);
      editQuestion(id);
    });
  });
}

if (q('sectionFilter')) {
  q('sectionFilter').addEventListener('change', applyFilteredTable);
}
`;

src = src.replace(
  `function renderQuestionsTable() {`,
  sectionFilterLogic + `function renderQuestionsTable() {`
);

// 7. Make renderQuestionsTable call applyFilteredTable
src = src.replace(
  `function renderQuestionsTable() {
  const tbody = q('questionRows');`,
  `function renderQuestionsTable() {
  applyFilteredTable();
  return;
  const tbody = q('questionRows');`
);

fs.writeFileSync(file, src, 'utf8');
console.log('Successfully patched admin.js!');

