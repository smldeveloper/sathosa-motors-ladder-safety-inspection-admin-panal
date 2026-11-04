import { buildInspectionWorkbook } from './lib/inspection-export.cjs';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

import ExcelJS from 'exceljs';
import fs from 'node:fs';
import crypto from 'node:crypto';


import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import pg from 'pg';
import XLSX from 'xlsx';
import { google } from 'googleapis';

const { Pool } = pg;


const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const sessions = new Set();

function getSessionSecret() {
  return process.env.ADMIN_PASSWORD || 'safety_inspection_secret_fallback';
}

function isValidSession(token) {
  if (typeof token !== 'string' || sessions.has(`revoked:${token}`)) return false;
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const [payload, sig] = parts;
    const expectedSig = crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('hex');
    if (sig.length !== expectedSig.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return false;
    const ts = Number(payload.split(':')[0]);
    if (Number.isFinite(ts) && ts > 0 && ts <= Date.now() && (Date.now() - ts) < 7 * 24 * 60 * 60 * 1000) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function resolveTemplatePath(fileName) {
  const candidates = [
    path.join(__dirname, fileName),
    path.join(process.cwd(), fileName),
    path.join(__dirname, '..', fileName)
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(__dirname, fileName);
}

function getTables(req) {
  if (req.query.mode !== undefined && !['ladder', 'fire', 'firstaid'].includes(req.query.mode)) {
    throw Object.assign(new Error('Invalid inspection mode.'), { status: 400 });
  }
  const mode = req.query.mode === 'fire' ? 'fire' : req.query.mode === 'firstaid' ? 'firstaid' : 'ladder';
  if (mode === 'fire') {
    return {
      points: 'fire_inspection_points',
      options: 'fire_question_options',
      inspections: 'fire_inspections',
      results: 'fire_inspection_results'
    };
  }
  if (mode === 'firstaid') {
    return {
      points: 'firstaid_inspection_points',
      options: 'firstaid_question_options',
      inspections: 'firstaid_inspections',
      results: 'firstaid_inspection_results'
    };
  }
  return {
    points: 'inspection_points',
    options: 'question_options',
    inspections: 'inspections',
    results: 'inspection_results'
  };
}


const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
  max: 5,
});
app.locals.pool = pool;

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
const publicDir = fs.existsSync(path.join(__dirname, 'public'))
  ? path.join(__dirname, 'public')
  : path.join(process.cwd(), 'public');
app.use(express.static(publicDir));

function requireAdmin(req, res, next) {
  if (isValidSession(req.cookies?.admin_session)) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

function normalizeQuestion(row, index) {
  const text = String(row.Question || row.question || row.question_text || '').trim();
  const section = String(row.Section || row.section || row.Category || row.category || 'general').trim().toLowerCase();
  const questionType = String(row['Question Type'] || row.question_type || row.Type || 'decision').trim().toLowerCase();
  const requiredRaw = row.Required ?? row.required ?? true;
  const activeRaw = row.Active ?? row.active ?? true;
  const sortRaw = row['Question Number'] ?? row.sort_order ?? row.display_order ?? index + 1;
  const optionsRaw = String(row.Options || row.options || '').trim();
  const options = optionsRaw
    ? optionsRaw.split('|').map((part, optionIndex) => {
        const [labelValue, flag] = part.split(':');
        const [label, value] = labelValue.includes('=')
          ? labelValue.split('=')
          : [labelValue, labelValue];
        return {
          option_label: String(label || '').trim(),
          option_value: String(value || label || '').trim(),
          sort_order: optionIndex + 1,
          is_fail_value: String(flag || '').trim().toLowerCase() === 'fail',
        };
      })
    : [];

  return {
    category: section,
    question: text,
    question_type: questionType,
    display_order: Number(sortRaw),
    is_required: ['true', 'yes', '1', 'required'].includes(String(requiredRaw).trim().toLowerCase()),
    is_active: !['false', 'no', '0', 'inactive'].includes(String(activeRaw).trim().toLowerCase()),
    options,
  };
}

function validateQuestions(questions) {
  const errors = [];
  const seen = new Set();
  const validTypes = new Set(['decision', 'yes_no', 'multiple_choice', 'text', 'long_text', 'number', 'date']);
  const validSections = new Set(['section_1', 'section_2', 'general', 'extension', 'step', 'fire', 'firstaid']);

  questions.forEach((q, index) => {
    const row = index + 2;
    if (!q.question) errors.push(`Row ${row}: missing question text.`);
    if (!validSections.has(q.category)) errors.push(`Row ${row}: invalid section "${q.category}".`);
    if (!validTypes.has(q.question_type)) errors.push(`Row ${row}: invalid question type "${q.question_type}".`);
    if (!Number.isFinite(q.display_order) || q.display_order <= 0) errors.push(`Row ${row}: invalid question number/order.`);
    const key = `${q.category}|${q.question.toLowerCase()}`;
    if (seen.has(key)) errors.push(`Row ${row}: duplicate question in the same section.`);
    seen.add(key);
    const needsOptions = ['decision', 'yes_no', 'multiple_choice'].includes(q.question_type);
    if (needsOptions && !q.options.length) errors.push(`Row ${row}: selectable question requires options.`);
    q.options.forEach((option, optionIndex) => {
      if (!option.option_label || !option.option_value) errors.push(`Row ${row}: option ${optionIndex + 1} is missing a label or value.`);
    });
  });

  return errors;
}

async function getQuestions(mode = 'ladder') {
  const tables = getTables({ query: { mode } });
  const query = `select id, category, question, display_order, is_required, is_active, question_type, placeholder, field_key, created_at, updated_at from ${tables.points} order by display_order, id`;




  const { rows: questions } = await pool.query(query);
  const { rows: options } = await pool.query(`
    select id, question_id, option_label, option_value, sort_order, is_fail_value, is_active
    from ${tables.options}
    where is_active = true
    order by sort_order, id
  `);
  const grouped = new Map();
  for (const option of options) {
    if (!grouped.has(option.question_id)) grouped.set(option.question_id, []);
    grouped.get(option.question_id).push(option);
  }
  return questions.map(q => ({
    ...q,
    category: q.category || (mode === 'fire' ? 'fire' : mode === 'firstaid' ? 'firstaid' : 'general'),
    question_type: q.question_type || 'decision',
    placeholder: q.placeholder || '',
    field_key: q.field_key || '',
    allow_remarks: true,
    options: grouped.get(q.id) || []
  }));
}

async function replaceOptions(client, questionId, options = [], mode = 'ladder') {
  const tables = getTables({query: {mode}});
  // Keep option IDs stable and retain removed options for historical references.
  const { rows: existing } = await client.query(`select id, option_value from ${tables.options} where question_id = $1`, [questionId]);
  await client.query(`update ${tables.options} set is_active = false where question_id = $1`, [questionId]);
  for (const [index, option] of options.entries()) {
    const previous = existing.find(o => o.option_value === option.option_value);
    if (previous) {
      await client.query(`update ${tables.options} set option_label=$1, sort_order=$2, is_fail_value=$3, is_active=true where id=$4`,
        [option.option_label, index + 1, option.is_fail_value === true, previous.id]);
    } else {
      await client.query(
        `insert into ${tables.options} (question_id, option_label, option_value, sort_order, is_fail_value, is_active)
         values ($1, $2, $3, $4, $5, true)`,
        [questionId, option.option_label, option.option_value, index + 1, option.is_fail_value === true],
      );
    }
  }
}

function questionData(body, mode, existing = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('A question object is required.'), { status: 400 });
  }
  const data = { category: mode === 'fire' ? 'fire' : mode === 'firstaid' ? 'firstaid' : 'general',
    question_type: 'decision', is_active: true, is_required: true, placeholder: '', field_key: '', ...existing, ...body };
  for (const key of ['question', 'category', 'question_type', 'placeholder', 'field_key']) {
    if (typeof data[key] !== 'string') throw Object.assign(new Error(`Invalid ${key}.`), { status: 400 });
    data[key] = data[key].trim();
  }
  const sections = ['section_1', 'section_2', ...(mode === 'fire' ? ['fire', 'fire_extinguisher', 'general'] : mode === 'firstaid' ? ['firstaid', 'general'] : ['general', 'extension', 'step'])];
  if (!data.question || !sections.includes(data.category) || !['decision', 'yes_no', 'multiple_choice', 'text', 'long_text', 'number', 'date'].includes(data.question_type)) {
    throw Object.assign(new Error('Question text, section, and question type must be valid.'), { status: 400 });
  }
  if (!Number.isSafeInteger(data.display_order) || data.display_order < 1) throw Object.assign(new Error('Sort order must be a positive whole number.'), { status: 400 });
  if (typeof data.is_active !== 'boolean' || typeof data.is_required !== 'boolean') throw Object.assign(new Error('Active and required must be booleans.'), { status: 400 });
  if (body.options !== undefined) {
    if (!Array.isArray(body.options)) throw Object.assign(new Error('Options must be an array.'), { status: 400 });
    const seen = new Set();
    data.options = body.options.map(option => {
      if (!option || typeof option.option_label !== 'string' || typeof option.option_value !== 'string' || !option.option_label.trim() || !option.option_value.trim()) {
        throw Object.assign(new Error('Each option needs a label and value.'), { status: 400 });
      }
      const value = option.option_value.trim();
      if (seen.has(value)) throw Object.assign(new Error('Option values must be unique.'), { status: 400 });
      seen.add(value);
      return { ...option, option_label: option.option_label.trim(), option_value: value };
    });
  }
  if (['decision', 'yes_no', 'multiple_choice'].includes(data.question_type) && data.options?.length === 0) {
    throw Object.assign(new Error('Selectable questions require at least one option.'), { status: 400 });
  }
  return data;
}

app.post('/api/login', (req, res) => {
  const expected = process.env.ADMIN_PASSWORD || '';
  const supplied = String(req.body?.password || '');
  if (!expected || supplied !== expected) return res.status(401).json({ error: 'Invalid password' });
  const ts = `${Date.now()}:${crypto.randomBytes(16).toString('hex')}`;
  const sig = crypto.createHmac('sha256', getSessionSecret()).update(ts).digest('hex');
  const token = `${ts}.${sig}`;
  const isSecure = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
  res.cookie('admin_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
  res.json({ ok: true });
});

app.post('/api/logout', requireAdmin, (req, res) => {
  if (req.cookies?.admin_session) {
    sessions.delete(req.cookies.admin_session);
    sessions.add(`revoked:${req.cookies.admin_session}`);
  }
  res.clearCookie('admin_session');
  res.json({ ok: true });
});

app.get('/api/session', (req, res) => {
  res.json({ authenticated: isValidSession(req.cookies?.admin_session) });
});

app.get('/api/questions', requireAdmin, async (req, res, next) => {
  try {
    res.json(await getQuestions(req.query.mode));
  } catch (error) {
    next(error);
  }
});

app.post('/api/questions', requireAdmin, async (req, res, next) => {
  let client;
  try {
    const tables = getTables(req);
    const q = questionData({ options: [], ...req.body }, req.query.mode);
    client = await pool.connect();
    await client.query('begin');
    const { rows } = await client.query(
      `insert into ${tables.points} (category, question, display_order, is_required, is_active, question_type, placeholder, field_key)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id`,
      [
        q.category,
        q.question,
        q.display_order,
        !!q.is_required,
        q.is_active !== false,
        q.question_type || 'decision',
        q.placeholder || '',
        q.field_key || ''
      ]
    );
    await replaceOptions(client, rows[0].id, q.options || [], req.query.mode);
    await client.query('commit');
    res.json({ id: rows[0].id });
  } catch (error) {
    if (client) await client.query('rollback');
    next(error);
  } finally {
    client?.release();
  }
});

app.put('/api/questions/:id', requireAdmin, async (req, res, next) => {
  let client;
  try {
    const tables = getTables(req);
    client = await pool.connect();
    await client.query('begin');
    const { rows: existing } = await client.query(`select * from ${tables.points} where id=$1 for update`, [req.params.id]);
    if (!existing.length) throw Object.assign(new Error('Question not found.'), { status: 404 });
    const q = questionData(req.body, req.query.mode, existing[0]);
    await client.query(
      `update ${tables.points}
          set category=$1, question=$2, display_order=$3,
              is_required=$4, is_active=$5, question_type=$6,
              placeholder=$7, field_key=$8, updated_at=now()
        where id=$9`,
      [
        q.category,
        q.question,
        q.display_order,
        !!q.is_required,
        q.is_active !== false,
        q.question_type || 'decision',
        q.placeholder || '',
        q.field_key || '',
        req.params.id
      ]
    );
    if (q.options !== undefined) await replaceOptions(client, req.params.id, q.options, req.query.mode);
    await client.query('commit');
    res.json({ ok: true });
  } catch (error) {
    if (client) await client.query('rollback');
    next(error);
  } finally {
    client?.release();
  }
});

app.patch('/api/questions/:id/active', requireAdmin, async (req, res, next) => {
  try {
    const tables = getTables(req);
    if (typeof req.body?.is_active !== 'boolean') return res.status(400).json({ error: 'Active must be a boolean.' });
    const { rows } = await pool.query(`update ${tables.points} set is_active=$1, updated_at=now() where id=$2 returning id, is_active`, [req.body.is_active, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Question not found.' });
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/questions/:id', requireAdmin, async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(`update ${getTables(req).points} set is_active=false, updated_at=now() where id=$1`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Question not found.' });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

function inspectionFilters(req) {
  const mode = req.query.mode || 'ladder';
  getTables(req);
  const equipment = mode === 'fire' ? 'point_no' : mode === 'firstaid' ? 'box_no' : 'ladder_no';
  const location = mode === 'ladder' ? 'section' : 'location';
  const filters = [];
  const values = [];
  for (const name of ['from', 'to']) {
    if (!req.query[name]) continue;
    const date = req.query[name];
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
      throw Object.assign(new Error('Invalid date filter.'), { status: 400 });
    }
    values.push(date);
    filters.push(`i.inspection_date ${name === 'from' ? '>=' : '<='} $${values.length}`);
  }
  if (req.query.from && req.query.to && req.query.from > req.query.to) throw Object.assign(new Error('From date must be before or equal to To date.'), { status: 400 });
  if (req.query.ladder) {
    values.push(`%${req.query.ladder}%`);
    filters.push(`(i.${equipment} ilike $${values.length} or i.${location} ilike $${values.length})`);
  }
  if (req.query.inspector) { values.push(`%${req.query.inspector}%`); filters.push(`i.inspector_name ilike $${values.length}`); }
  if (req.query.status) {
    if (!['PASS', 'FAIL', 'EXPIRED'].includes(req.query.status)) throw Object.assign(new Error('Invalid result filter.'), { status: 400 });
    values.push(req.query.status); filters.push(`i.overall_result = $${values.length}`);
  }
  return { where: filters.length ? `where ${filters.join(' and ')}` : '', values };
}

function dateOnly(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  // PostgreSQL DATE values are calendar dates, independent of the server timezone.
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

app.get('/api/inspections', requireAdmin, async (req, res, next) => {
  try {
    const t = getTables(req);
    const mode = req.query.mode || 'ladder';
    const isFire = mode === 'fire';
    const isFirstAid = mode === 'firstaid';

    const ladderNoCol = isFire ? 'point_no' : isFirstAid ? 'box_no' : 'ladder_no';
    const sectionCol = isFire ? 'location' : isFirstAid ? 'location' : 'section';
    const heightExpr = isFire ? 'i.quantity::text' : isFirstAid ? "''" : 'i.height_feet::text';
    const typeExpr = isFire ? 'i.extinguisher_type' : isFirstAid ? "''" : 'i.ladder_type';
    const pressureExpr = isFire ? 'i.pressure_weight' : 'null';

    const { where, values } = inspectionFilters(req);
    const { rows } = await pool.query(`
      select i.id, i.inspection_date, i.${ladderNoCol} as ladder_no, i.${sectionCol} as section,
             ${heightExpr} as height_feet, ${typeExpr} as ladder_type,
             ${pressureExpr} as pressure_weight,
             i.inspector_name, i.epf_number, i.overall_result, i.remarks, i.created_at,
             count(r.id)::int as answer_count,
             count(*) filter (where r.result = 'FAIL' or r.result = 'EXPIRED')::int as fail_count
        from ${t.inspections} i
        left join ${t.results} r on r.inspection_id = i.id
        ${where}
       group by i.id
       order by i.inspection_date asc, i.created_at asc
       limit 500
    `, values);
    res.json(rows.map(row => ({ ...row, inspection_date: dateOnly(row.inspection_date) })));
  } catch (error) {
    next(error);
  }
});

app.get('/api/inspections/:id', requireAdmin, async (req, res, next) => {
  try {
    const t = getTables(req);
    const mode = req.query.mode || 'ladder';
    const catExpr = mode === 'ladder' ? 'r.category_snapshot' : `'${mode}'`;
    const { rows } = await pool.query(`
      select r.display_order_snapshot as order,
             ${catExpr} as category,
             r.question_text_snapshot as question,
             r.result, coalesce(r.answer_label, r.result) as answer_label, r.remarks
        from ${t.results} r
       where r.inspection_id = $1
       order by r.display_order_snapshot asc
    `, [req.params.id]);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.get('/api/export/questionnaire', requireAdmin, async (req, res, next) => {
  try {
    const questions = await getQuestions(req.query.mode);
    const rows = questions.map(q => ({
      'Question Number': q.display_order,
      Section: q.category,
      Question: q.question,
      'Question Type': q.question_type,
      Required: q.is_required ? 'yes' : 'no',
      Active: q.is_active ? 'yes' : 'no',
      Options: q.options.map(o => `${o.option_label}=${o.option_value}${o.is_fail_value ? ':fail' : ''}`).join('|'),
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Questionnaire');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="questionnaire.xlsx"');
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

app.get('/api/export/inspections', requireAdmin, async (req, res, next) => {
  try {
    const mode = req.query.mode || 'ladder';
    if (!['ladder', 'fire', 'firstaid'].includes(mode)) return res.status(400).json({ error: 'Invalid inspection mode.' });
    const tables = getTables(req);
    const { where, values } = inspectionFilters(req);
    const { rows: questions } = await pool.query(`
      select id, category, question, display_order, is_active, field_key, updated_at
      from ${tables.points} order by display_order, id
    `);
    const category = mode === 'ladder' ? 'r.category_snapshot' : `'${mode}'`;
    const { rows } = await pool.query(`
      select i.*, i.id as inspection_id, i.remarks as overall_remarks,
             r.inspection_point_id as question_id,
             r.display_order_snapshot as question_number, ${category} as category,
             r.question_text_snapshot as question, r.result as answer,
             coalesce(r.answer_label, r.result) as answer_label, r.remarks as answer_remarks
      from ${tables.inspections} i
      left join ${tables.results} r on r.inspection_id = i.id
      ${where}
      order by i.inspection_date, i.created_at, i.id, r.display_order_snapshot, r.id
    `, values);
    const workbook = await buildInspectionWorkbook({ mode, questions, rows, templatePath: path.join(__dirname, 'fire_extinguisher_template.xlsx') });
    const filenames = { ladder: 'LADDER-CHECKLIST-EXPORT.xlsx', fire: 'FIRE-EXTINGUISHER-CHECKLIST-EXPORT.xlsx', firstaid: 'FIRST-AID-CHECKLIST-EXPORT.xlsx' };
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filenames[mode]}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(await workbook.xlsx.writeBuffer());
  } catch (error) {
    next(error);
  }
});

/* ════════════════════════════════════════════════════════════════
   Google Sheets Integration
   ════════════════════════════════════════════════════════════════ */

function getGoogleAuthCredentials() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      let raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON.trim();
      if (!raw.startsWith('{')) {
        raw = Buffer.from(raw, 'base64').toString('utf8');
      }
      const parsed = JSON.parse(raw);
      if (parsed.client_email && (parsed.private_key || parsed.type === 'service_account')) {
        return {
          keyPath: null,
          credentials: {
            client_email: parsed.client_email,
            private_key: parsed.private_key,
            project_id: parsed.project_id
          },
          clientEmail: parsed.client_email,
          projectId: parsed.project_id
        };
      }
    } catch (e) {
      console.error('Error parsing GOOGLE_SERVICE_ACCOUNT_JSON:', e.message);
    }
  }
  const candidates = [
    process.env.GOOGLE_SERVICE_ACCOUNT_PATH,
    path.join(__dirname, 'google-service-account.json'),
    path.join(process.cwd(), 'google-service-account.json'),
    'C:\\Users\\buddhimas\\Downloads\\hsc-admin-513009-ee2995912500.json',
    path.join(__dirname, 'hsc-admin-513009-ee2995912500.json')
  ].filter(Boolean);

  for (const candidatePath of candidates) {
    try {
      const resolvedPath = path.isAbsolute(candidatePath) ? candidatePath : path.resolve(__dirname, candidatePath);
      if (fs.existsSync(resolvedPath)) {
        const raw = fs.readFileSync(resolvedPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed.client_email && (parsed.private_key || parsed.type === 'service_account')) {
          return {
            keyPath: resolvedPath,
            credentials: {
              client_email: parsed.client_email,
              private_key: parsed.private_key,
              project_id: parsed.project_id
            },
            clientEmail: parsed.client_email,
            projectId: parsed.project_id
          };
        }
      }
    } catch (e) {
      // ignore and try next
    }
  }
  return null;
}

function getSheetsClient(creds) {
  const auth = new google.auth.JWT({
    email: creds.credentials.client_email,
    key: creds.credentials.private_key ? creds.credentials.private_key.replace(/\\n/g, '\n') : creds.credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

app.get('/api/sheets/info', requireAdmin, async (req, res) => {
  const creds = getGoogleAuthCredentials();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID || '19GrdwA1nW6_xMfkkNzDr5GjFxQIvnzf1IitENNRS6UE';
  const targetGid = process.env.GOOGLE_SHEET_GID || '1278333149';
  const sheetUrl = process.env.GOOGLE_SHEET_URL || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?pli=1&gid=${targetGid}#gid=${targetGid}`;

  res.json({
    configured: !!creds,
    serviceAccountEmail: creds ? creds.clientEmail : null,
    keyFile: creds ? (creds.keyPath ? path.basename(creds.keyPath) : 'Environment Variable') : null,
    spreadsheetId,
    targetGid,
    sheetUrl
  });
});

app.get('/api/sheets/data', requireAdmin, async (req, res, next) => {
  const creds = getGoogleAuthCredentials();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID || '19GrdwA1nW6_xMfkkNzDr5GjFxQIvnzf1IitENNRS6UE';
  const targetGid = req.query.gid || process.env.GOOGLE_SHEET_GID || '1278333149';
  const requestedSheetName = req.query.sheetName;
  const sheetUrl = process.env.GOOGLE_SHEET_URL || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?pli=1&gid=${targetGid}#gid=${targetGid}`;

  if (!creds) {
    return res.status(400).json({
      error: 'Google Service Account credentials file not found.',
      serviceAccountFound: false,
      sheetUrl,
      spreadsheetId,
      targetGid
    });
  }

  try {
    const sheets = getSheetsClient(creds);

    // Fetch spreadsheet metadata
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const spreadsheetTitle = meta.data.properties?.title || 'Safety Inspection Sheet';

    const sheetList = (meta.data.sheets || []).map(s => ({
      title: s.properties.title,
      sheetId: s.properties.sheetId,
      rowCount: s.properties.gridProperties?.rowCount || 0,
      columnCount: s.properties.gridProperties?.columnCount || 0,
      isTarget: String(s.properties.sheetId) === String(targetGid)
    }));

    let activeSheet = null;
    if (requestedSheetName) {
      activeSheet = sheetList.find(s => s.title === requestedSheetName);
      if (!activeSheet) return res.status(404).json({ error: 'Requested worksheet not found.' });
    }
    if (!activeSheet && targetGid) {
      activeSheet = sheetList.find(s => String(s.sheetId) === String(targetGid));
    }
    if (!activeSheet && sheetList.length > 0) {
      activeSheet = sheetList[0];
    }

    if (!activeSheet) {
      return res.status(404).json({
        error: 'No sheets found in spreadsheet.',
        spreadsheetTitle,
        sheets: sheetList
      });
    }

    // Fetch values for the active sheet
    const sheetData = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${activeSheet.title.replace(/'/g, "''")}'`,
      valueRenderOption: 'FORMATTED_VALUE'
    });

    const rawValues = sheetData.data.values || [];
    let headers = [];
    let rows = [];

    if (rawValues.length > 0) {
      let headerIdx = rawValues.findIndex(r => r && r.some(c => String(c).trim().length > 0));
      if (headerIdx === -1) headerIdx = 0;

      headers = rawValues[headerIdx].map((h, i) => {
        const val = String(h ?? '').trim();
        return val.length > 0 ? val : `Column ${i + 1}`;
      });

      let maxCols = headers.length;
      for (let i = headerIdx + 1; i < rawValues.length; i++) {
        if (rawValues[i] && rawValues[i].length > maxCols) {
          maxCols = rawValues[i].length;
        }
      }
      while (headers.length < maxCols) {
        headers.push(`Column ${headers.length + 1}`);
      }

      for (let i = headerIdx + 1; i < rawValues.length; i++) {
        const row = rawValues[i] || [];
        if (!row.some(c => c !== undefined && c !== null && String(c).trim() !== '')) {
          continue;
        }
        const normalized = [];
        for (let c = 0; c < maxCols; c++) {
          normalized.push(row[c] !== undefined && row[c] !== null ? String(row[c]) : '');
        }
        rows.push(normalized);
      }
    }

    res.json({
      ok: true,
      spreadsheetTitle,
      spreadsheetId,
      sheetUrl,
      serviceAccountEmail: creds.clientEmail,
      sheets: sheetList,
      activeSheet: {
        title: activeSheet.title,
        sheetId: activeSheet.sheetId
      },
      headers,
      rows,
      totalRows: rows.length,
      totalCols: headers.length,
      lastUpdated: new Date().toISOString()
    });
  } catch (err) {
    const status = err.code || (err.response && err.response.status) || 500;
    const isPermissionDenied = status === 403 ||
      (err.message && err.message.toLowerCase().includes('caller does not have permission'));

    res.status(status === 403 ? 403 : 500).json({
      error: isPermissionDenied
        ? 'Google Sheets API access forbidden. The sheet has not been shared with the service account.'
        : (err.message || 'Error communicating with Google Sheets API'),
      isPermissionDenied,
      serviceAccountEmail: creds.clientEmail,
      spreadsheetId,
      targetGid,
      sheetUrl,
      details: err.message
    });
  }
});

app.get('/api/sheets/export', requireAdmin, async (req, res, next) => {
  const creds = getGoogleAuthCredentials();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID || '19GrdwA1nW6_xMfkkNzDr5GjFxQIvnzf1IitENNRS6UE';
  const targetGid = req.query.gid || process.env.GOOGLE_SHEET_GID || '1278333149';
  const requestedSheetName = req.query.sheetName;

  if (!creds) {
    return res.status(400).json({ error: 'Service account credentials missing' });
  }

  try {
    const sheets = getSheetsClient(creds);
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetList = meta.data.sheets || [];

    let activeSheet = null;
    if (requestedSheetName) {
      activeSheet = sheetList.find(s => s.properties.title === requestedSheetName);
      if (!activeSheet) return res.status(404).json({ error: 'Requested worksheet not found.' });
    }
    if (!activeSheet && targetGid) {
      activeSheet = sheetList.find(s => String(s.properties.sheetId) === String(targetGid));
    }
    if (!activeSheet && sheetList.length > 0) {
      activeSheet = sheetList[0];
    }

    if (!activeSheet) return res.status(404).json({ error: 'No sheets found in spreadsheet.' });
    const sheetTitle = activeSheet.properties.title;
    const sheetData = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetTitle.replace(/'/g, "''")}'`,
      valueRenderOption: 'FORMATTED_VALUE'
    });

    const values = sheetData.data.values || [];
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(sheetTitle.slice(0, 31));

    values.forEach((row, rIdx) => {
      const addedRow = worksheet.addRow(row);
      if (rIdx === 0) {
        addedRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        addedRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF1E293B' }
        };
      }
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `${sheetTitle.replace(/[^a-zA-Z0-9_-]/g, '_')}_export.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

app.get('/', (req, res) => {
  const indexPath = path.join(publicDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  res.status(404).send('Not Found');
});

app.use((error, req, res, next) => {
  if (!error.status || error.status >= 500) console.error(error);
  res.status(error.status || (error.code === '22P02' ? 400 : 500)).json({ error: error.message || 'Server error' });
});

const port = Number(process.env.PORT || 8081);
if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`Safety Inspection Admin running on http://localhost:${port}`);
  });
}

export default app;
