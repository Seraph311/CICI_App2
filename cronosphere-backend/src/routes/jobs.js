import express from 'express';
import cron from 'node-cron';
import { pool } from '../db.js';
import { scheduleJob, cancelJob, scheduledJobs } from '../scheduler.js';
import { requireAuth } from '../middleware/auth.js'; // Changed from default import to named import
const router = express.Router();

// All routes require auth
router.use(requireAuth); // Changed from 'auth' to 'requireAuth'

// Forbidden commands (same as before)
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
];

function isForbidden(command) {
  if (!command) return false;
  return FORBIDDEN_PATTERNS.some(re => re.test(command));
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

    // If script_id is provided, ensure it belongs to the user
    if (script_id) {
      const sres = await pool.query('SELECT id FROM scripts WHERE id=$1 AND owner=$2', [script_id, owner]);
      if (sres.rows.length === 0) return res.status(400).json({ error: 'script not found or not owned by you' });
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
