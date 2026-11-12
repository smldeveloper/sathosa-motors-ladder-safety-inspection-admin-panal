import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('server.js');
let content = fs.readFileSync(file, 'utf8');

const targetRegex = /app\.post\('\/api\/questions', requireAdmin, async \(req, res, next\) => \{[\s\S]*?app\.delete\('\/api\/questions\/:id'/;

const replacement = `app.post('/api/questions', requireAdmin, async (req, res, next) => {
  const q = req.body;
  const client = await pool.connect();
  const tables = getTables(req);
  const defaultCat = req.query.mode === 'fire' ? 'fire' : req.query.mode === 'firstaid' ? 'firstaid' : 'general';
  try {
    await client.query('begin');
    const { rows } = await client.query(
      \`insert into \${tables.points} (category, question, display_order, is_required, is_active, question_type, placeholder, field_key)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id\`,
      [
        q.category || defaultCat,
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
    await client.query('rollback');
    next(error);
  } finally {
    client.release();
  }
});

app.put('/api/questions/:id', requireAdmin, async (req, res, next) => {
  const q = req.body;
  const client = await pool.connect();
  const tables = getTables(req);
  const defaultCat = req.query.mode === 'fire' ? 'fire' : req.query.mode === 'firstaid' ? 'firstaid' : 'general';
  try {
    await client.query('begin');
    await client.query(
      \`update \${tables.points}
          set category=$1, question=$2, display_order=$3,
              is_required=$4, is_active=$5, question_type=$6,
              placeholder=$7, field_key=$8, updated_at=now()
        where id=$9\`,
      [
        q.category || defaultCat,
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
    await replaceOptions(client, req.params.id, q.options || [], req.query.mode);
    await client.query('commit');
    res.json({ ok: true });
  } catch (error) {
    await client.query('rollback');
    next(error);
  } finally {
    client.release();
  }
});

app.delete('/api/questions/:id'`;

if (targetRegex.test(content)) {
  content = content.replace(targetRegex, replacement);
  fs.writeFileSync(file, content, 'utf8');
  console.log('Successfully patched server.js!');
} else {
  console.error('Target regex not matched in server.js');
}

