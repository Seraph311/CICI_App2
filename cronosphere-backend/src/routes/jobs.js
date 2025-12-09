import express from 'express';
import cron from 'node-cron';
import { pool } from '../db.js';
import { scheduleJob, cancelJob, scheduledJobs } from '../scheduler.js';
import { requireAuth } from '../middleware/auth.js';
const router = express.Router();

router.use(requireAuth);

// Forbidden patterns - expanded for both commands and scripts
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

// Node.js specific forbidden patterns
const NODE_FORBIDDEN_PATTERNS = [
  /require\s*\(\s*['"]child_process['"]/i,
  /require\s*\(\s*['"]fs['"]\s*\)\s*\.\s*(writeFileSync|appendFileSync|unlinkSync|rmSync|rmdirSync)\s*\(/i,
  /require\s*\(\s*['"]os['"]\s*\)\s*\.\s*(userInfo|hostname|totalmem|freemem|cpus)/i,
  /execSync\s*\(/i,
  /spawnSync\s*\(/i,
  /fork\s*\(/i,
  /process\.(exit|kill|abort)\s*\(/i,
  /require\s*\(\s*['"]net['"]/i,
  /require\s*\(\s*['"]http['"]/i,
  /require\s*\(\s*['"]https['"]/i,
  /\.listen\s*\(/i,
];

function isForbidden(content, type = 'bash') {
  if (!content) return false;

  // Check for general forbidden patterns
  const hasForbiddenPattern = FORBIDDEN_PATTERNS.some(re => re.test(content));

  // Additional checks for Node.js scripts
  if (type === 'node') {
    const hasNodeForbidden = NODE_FORBIDDEN_PATTERNS.some(re => re.test(content));
    if (hasNodeForbidden) return true;

    // Also check for eval and Function constructor
    if (content.includes('eval(') || content.includes('Function(') || content.includes('setTimeout(') || content.includes('setInterval(')) {
      return true;
    }
  }

  return hasForbiddenPattern;
}

// Create new job (owner bound)
router.post('/', async (req, res) => {
  try {
    const owner = req.user.id;
    const { name, command, schedule, script_id } = req.body;

    if (!name || (!command && !script_id) || !schedule)
      return res.status(400).json({ error: 'name, schedule and (command or script_id) required' });

    if (command && command.length > 2000)
      return res.status(400).json({ error: 'command too long' });

    if (command && isForbidden(command))
      return res.status(400).json({ error: 'command contains forbidden operations' });

    if (!cron.validate(schedule))
      return res.status(400).json({ error: 'invalid cron expression' });

    // If script_id is provided, ensure it belongs to the user AND validate its content
    if (script_id) {
      const sres = await pool.query('SELECT content, type FROM scripts WHERE id=$1 AND owner=$2', [script_id, owner]);
      if (sres.rows.length === 0) return res.status(400).json({ error: 'script not found or not owned by you' });

      // Validate script content
      const script = sres.rows[0];
      if (isForbidden(script.content, script.type)) {
        return res.status(400).json({ error: 'script contains forbidden operations' });
      }
    }

    const result = await pool.query(
      'INSERT INTO jobs (name, command, schedule, status, owner, script_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
                                    [name, command || null, schedule, 'active', owner, script_id || null]
    );

    const job = result.rows[0];

    if (job.status === 'active') {
      await scheduleJob(job);
    }

    res.status(201).json(job);
  } catch (err) {
    console.error('POST /api/jobs error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// List jobs for user
router.get('/', async (req, res) => {
  try {
    const owner = req.user.id;
    const result = await pool.query('SELECT * FROM jobs WHERE owner=$1 ORDER BY id DESC', [owner]);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/jobs error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// Run job manually (only owner)
router.post('/:id/run', async (req, res) => {
  try {
    const owner = req.user.id;
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM jobs WHERE id = $1 AND owner=$2', [id, owner]);
    const job = result.rows[0];
    if (!job) return res.status(404).json({ error: 'job not found' });

    await scheduleJob(job, true);
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/jobs/:id/run error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// Toggle status (pause/resume)
router.put('/:id/status', async (req, res) => {
  try {
    const owner = req.user.id;
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'paused'].includes(status))
      return res.status(400).json({ error: 'invalid status' });

    // ensure job owned by user
    const result = await pool.query('SELECT * FROM jobs WHERE id=$1 AND owner=$2', [id, owner]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'job not found' });

    await pool.query('UPDATE jobs SET status=$1 WHERE id=$2', [status, id]);

    if (status === 'paused') {
      cancelJob(id);
    } else {
      if (!scheduledJobs.has(Number(id))) {
        const r = await pool.query('SELECT * FROM jobs WHERE id=$1', [id]);
        const job = r.rows[0];
        if (job) await scheduleJob(job);
      }
    }

    res.json({ ok: true, status });
  } catch (err) {
    console.error('PUT /api/jobs/:id/status error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// Get runs for a job (owner)
router.get('/:id/runs', async (req, res) => {
  try {
    const owner = req.user.id;
    const { id } = req.params;

    // ensure ownership
    const r = await pool.query('SELECT id FROM jobs WHERE id=$1 AND owner=$2', [id, owner]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'job not found' });

    const result = await pool.query('SELECT * FROM job_runs WHERE job_id=$1 ORDER BY id DESC', [id]);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/jobs/:id/runs error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// Get single run by runId (owner of parent job)
router.get('/runs/:runId', async (req, res) => {
  try {
    const owner = req.user.id;
    const { runId } = req.params;

    const rr = await pool.query('SELECT jr.* FROM job_runs jr JOIN jobs j ON jr.job_id=j.id WHERE jr.id=$1 AND j.owner=$2', [runId, owner]);
    if (rr.rows.length === 0) return res.status(404).json({ error: 'not found' });
    res.json(rr.rows[0]);
  } catch (err) {
    console.error('GET /api/jobs/runs/:runId error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// Delete job (owner)
router.delete('/:id', async (req, res) => {
  try {
    const owner = req.user.id;
    const { id } = req.params;
    await pool.query('DELETE FROM jobs WHERE id=$1 AND owner=$2', [id, owner]);
    cancelJob(id);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/jobs/:id error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

export default router;
