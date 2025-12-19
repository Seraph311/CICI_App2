import express from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

/* =========================
 *   AUTH
 * ========================= */
router.use(requireAuth);

/* =========================
 *   CONFIG
 * ========================= */
const MAX_SCRIPT_LENGTH = 10_000;
const VALID_TYPES = new Set(['bash', 'node']);

/* =========================
 *   SECURITY RULES
 * ========================= */
const HARD_BLOCK = [
  /\bsudo\b/i,
/\b(systemctl|reboot|shutdown|mount|umount)\b/i,
/\brm\s+-rf\s+\/\b/i,
/\bdd\s+if=/i,
];

const SOFT_WARN = [
  /\bcurl\b/i,
/\bwget\b/i,
/\bchmod\b/i,
];

/* =========================
 *   HELPERS
 * ========================= */
function normalizeType(type) {
  return VALID_TYPES.has(type) ? type : 'bash';
}

function inspectScript(content, type) {
  if (!content) return { ok: true };

  if (content.length > MAX_SCRIPT_LENGTH) {
    return { ok: false, error: 'script content too long (max 10000 characters)' };
  }

  if (HARD_BLOCK.some(re => re.test(content))) {
    return { ok: false, error: 'script contains forbidden operations' };
  }

  const warnings = SOFT_WARN
  .filter(re => re.test(content))
  .map(re => re.source);

  if (type === 'node') {
    const NODE_HARD_BLOCK = [
      /require\s*\(\s*['"]child_process['"]\s*\)/i,
      /execSync\s*\(/i,
                    /spawnSync\s*\(/i,
                                   /fork\s*\(/i,
                                             /process\.exit\s*\(/i,
    ];

    if (NODE_HARD_BLOCK.some(re => re.test(content))) {
      return { ok: false, error: 'node script uses forbidden APIs' };
    }
  }

  return { ok: true, warnings };
}

async function assertOwnership(id, owner) {
  const { rowCount } = await pool.query(
    'SELECT 1 FROM scripts WHERE id=$1 AND owner=$2',
    [id, owner]
  );
  return rowCount > 0;
}

/* =========================
 *   ROUTES
 * ========================= */

// Create script
router.post('/', async (req, res) => {
  try {
    const owner = req.user.id;
    const { name, content, type } = req.body;

    if (!name || !content) {
      return res.status(400).json({ error: 'name and content required' });
    }

    const t = normalizeType(type);
    const inspection = inspectScript(content, t);

    if (!inspection.ok) {
      return res.status(400).json({ error: inspection.error });
    }

    const { rows } = await pool.query(
      'INSERT INTO scripts (owner, name, content, type) VALUES ($1,$2,$3,$4) RETURNING *',
                                      [owner, name, content, t]
    );

    res.status(201).json({
      ...rows[0],
      warnings: inspection.warnings ?? [],
    });
  } catch (err) {
    console.error('POST /api/scripts error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// Update script
router.put('/:id', async (req, res) => {
  try {
    const owner = req.user.id;
    const { id } = req.params;
    const { name, content, type } = req.body;

    if (!(await assertOwnership(id, owner))) {
      return res.status(404).json({ error: 'script not found' });
    }

    if (!name && !content && !type) {
      return res.status(400).json({ error: 'nothing to update' });
    }

    const updates = [];
    const values = [];
    let i = 1;

    if (name) {
      updates.push(`name=$${i++}`);
      values.push(name);
    }

    if (content) {
      const t = normalizeType(type);
      const inspection = inspectScript(content, t);

      if (!inspection.ok) {
        return res.status(400).json({ error: inspection.error });
      }

      updates.push(`content=$${i++}`);
      values.push(content);
    }

    if (type) {
      updates.push(`type=$${i++}`);
      values.push(normalizeType(type));
    }

    values.push(id, owner);

    const { rows } = await pool.query(
      `UPDATE scripts SET ${updates.join(', ')} WHERE id=$${i} AND owner=$${i + 1} RETURNING *`,
                                      values
    );

    res.json(rows[0]);
  } catch (err) {
    console.error('PUT /api/scripts/:id error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// List scripts
router.get('/', async (req, res) => {
  try {
    const owner = req.user.id;
    const { rows } = await pool.query(
      'SELECT id, name, type, created_at FROM scripts WHERE owner=$1 ORDER BY id DESC',
      [owner]
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/scripts error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// Get script
router.get('/:id', async (req, res) => {
  try {
    const owner = req.user.id;
    const { id } = req.params;

    const { rows } = await pool.query(
      'SELECT * FROM scripts WHERE id=$1 AND owner=$2',
      [id, owner]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'not found' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('GET /api/scripts/:id error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// Delete script
router.delete('/:id', async (req, res) => {
  try {
    const owner = req.user.id;
    const { id } = req.params;

    await pool.query(
      'DELETE FROM scripts WHERE id=$1 AND owner=$2',
      [id, owner]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/scripts/:id error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

export default router;
