import express from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
const router = express.Router();

// All script endpoints require authentication
router.use(requireAuth);

const FORBIDDEN_PATTERNS = [
  /\bsudo\b/i,
  /\brm\s+-[^\s]*f[^\s]*\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bhalt\b/i,
  /\bmkfs\./i,
  /\bfsck\b/i,
  /\bdd\s+if=/i,
  /\bfork\b/i,
  /:(){:|:&};:/,
  /\bchown\b.*\broot\b/i,
  /\bchmod\s+0{3,4}\b/i,
  /\bmount\b/i,
  /\bumount\b/i,
  /\bservice\b/i,
  /\bsystemctl\b/i,
  // More specific patterns to avoid false positives:
  /\bwget\b.*\s+-\s*O\s+.*\/etc\//i,
  /\bcurl\b.*\s+-\s*O\s+.*\/etc\//i,
  /\bchmod\s+[0-7]{3,4}\s+\/etc\//i,
  /\bchmod\s+[0-7]{3,4}\s+\/bin\//i,
  /\bchmod\s+[0-7]{3,4}\s+\/usr\//i,
  /\becho\s+.*>\s*\/etc\//i,
  /\bcat\s+.*>\s*\/etc\//i,
  /\bnc\s+-l\s+/i,
  /\bncat\s+-l\s+/i,
  /\bsocat\s+/i,
  /\bpython\s+-c\s+/i,
  /\bperl\s+-e\s+/i,
  /\bruby\s+-e\s+/i,
  /\bphp\s+-r\s+/i,
  /eval\s*\([^)]*\)[^;]*[;&|]/i, // More specific eval pattern
  /exec\s*\([^)]*\)[^;]*[;&|]/i, // More specific exec pattern
  // Remove or fix these problematic patterns:
  // /\$\{.*:.*\}/, // Too broad - matches template literals
  // /\$\(.*\)/i,   // Too broad - matches harmless things
  // /`.*`/i,       // Too broad - matches backticks in general

  // Network related - make more specific
  /\bssh\s+.*@.*\s+.*(sudo|rm|shutdown)/i,
  /\bscp\s+.*\s+.*@.*:.*\/(etc|bin|sbin|usr)/i,
  /\bsftp\s+.*@.*/i,
  /\bwget\s+.*\s+-\s*O\s+.*\/(etc|bin|sbin|usr|root)/i,
  /\bcurl\s+.*\s+-\s*O\s+.*\/(etc|bin|sbin|usr|root)/i,

  // Process manipulation - make more specific
  /\bkill\s+-\s*9\s+.*(init|systemd|ssh)/i,
  /\bpkill\s+.*(ssh|system|init)/i,
  /\bkillall\s+.*(ssh|system|init)/i,

  // File system manipulation in system directories - more specific
  /\bmv\s+.*\s+\/(etc|bin|sbin|usr|lib|var|root|home|boot|dev|proc|sys)\/\S+/i,
  /\bcp\s+.*\s+\/(etc|bin|sbin|usr|lib|var|root|home|boot|dev|proc|sys)\/\S+/i,

  // Dangerous file operations - more specific
  /\b>.*\s+\/(etc|bin|sbin|usr|lib|var|root|home)\/\S+/i,
  /\b>>.*\s+\/(etc|bin|sbin|usr|lib|var|root|home)\/\S+/i,

  // Environment tampering - more specific
  /\bexport\s+.*=.*\/etc\/\S+/i,
  /\bunset\s+PATH\b/i,

  // Shell escapes - more specific
  /\$\([^)]*(rm|sudo|shutdown|reboot|halt|chmod|chown|mount|umount)[^)]*\)/i,
  /`[^`]*(rm|sudo|shutdown|reboot|halt|chmod|chown|mount|umount)[^`]*`/i,

  // Database access - more specific
  /\bpsql\s+.*\s+-c\s+.*(DROP|DELETE|TRUNCATE|ALTER)/i,
  /\bmysql\s+.*\s+-e\s+.*(DROP|DELETE|TRUNCATE|ALTER)/i,
  /\bsqlite3\s+.*\s+.*(DROP|DELETE|TRUNCATE|ALTER)/i,
];

function isForbidden(content) {
  if (!content) return false;

  // Check for forbidden patterns
  const hasForbiddenPattern = FORBIDDEN_PATTERNS.some(re => re.test(content));

  // Additional checks for Node.js scripts
  if (content.includes('require(') || content.includes('import ')) {
    const nodeForbidden = [
      /require\s*\(\s*['"]child_process['"]/i,
                   /require\s*\(\s*['"]fs['"]\s*\)\s*\.\s*(writeFileSync|appendFileSync|unlinkSync)\s*\(/i,
                                                                                                        /require\s*\(\s*['"]os['"]\s*\)\s*\.\s*(userInfo|hostname)/i,
                                                                                                        /execSync\s*\(/i,
                                                                                                                      /spawnSync\s*\(/i,
                                                                                                                                     /fork\s*\(/i,
                                                                                                                                               /process\.exit\s*\(/i,
    ];
    const hasNodeForbidden = nodeForbidden.some(re => re.test(content));
    if (hasNodeForbidden) return true;
  }

  return hasForbiddenPattern;
}

// Create a script
router.post('/', async (req, res) => {
  try {
    const owner = req.user.id;
    const { name, content, type } = req.body;

    if (!name || !content) return res.status(400).json({ error: 'name and content required' });

    // Validate content length
    if (content.length > 10000) {
      return res.status(400).json({ error: 'script content too long (max 10000 characters)' });
    }

    // Check for forbidden operations
    if (isForbidden(content)) {
      return res.status(400).json({ error: 'script contains forbidden operations' });
    }

    // Validate script type
    const validTypes = ['bash', 'node'];
    const t = validTypes.includes(type) ? type : 'bash';

    const result = await pool.query(
      'INSERT INTO scripts (owner, name, content, type) VALUES ($1,$2,$3,$4) RETURNING *',
                                    [owner, name, content, t]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /api/scripts error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// Update a script
router.put('/:id', async (req, res) => {
  try {
    const owner = req.user.id;
    const { id } = req.params;
    const { name, content, type } = req.body;

    // First, check ownership
    const check = await pool.query('SELECT id FROM scripts WHERE id=$1 AND owner=$2', [id, owner]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'script not found' });

    // Validate inputs
    if (!name && !content && !type) {
      return res.status(400).json({ error: 'nothing to update' });
    }

    // Validate content if provided
    if (content) {
      if (content.length > 10000) {
        return res.status(400).json({ error: 'script content too long (max 10000 characters)' });
      }

      if (isForbidden(content)) {
        return res.status(400).json({ error: 'script contains forbidden operations' });
      }
    }

    // Build dynamic update query
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }
    if (content) {
      updates.push(`content = $${paramCount++}`);
      values.push(content);
    }
    if (type) {
      const validTypes = ['bash', 'node'];
      const t = validTypes.includes(type) ? type : 'bash';
      updates.push(`type = $${paramCount++}`);
      values.push(t);
    }

    // Add script id and owner for WHERE clause
    values.push(id, owner);

    const result = await pool.query(
      `UPDATE scripts SET ${updates.join(', ')} WHERE id = $${paramCount} AND owner = $${paramCount + 1} RETURNING *`,
                                    values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'script not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT /api/scripts/:id error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// List scripts for current user
router.get('/', async (req, res) => {
  try {
    const owner = req.user.id;
    const result = await pool.query('SELECT id, name, type, created_at FROM scripts WHERE owner=$1 ORDER BY id DESC', [owner]);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/scripts error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// Get single script (content) - owner only
router.get('/:id', async (req, res) => {
  try {
    const owner = req.user.id;
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM scripts WHERE id=$1 AND owner=$2', [id, owner]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'not found' });
    res.json(result.rows[0]);
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
    // ensure owner or 0 rows effected
    await pool.query('DELETE FROM scripts WHERE id=$1 AND owner=$2', [id, owner]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/scripts/:id error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

export default router;
