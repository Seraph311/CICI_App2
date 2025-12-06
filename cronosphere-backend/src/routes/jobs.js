// src/routes/jobs.js
import express from 'express';
import cron from 'node-cron';
import { pool } from '../db.js';
import { scheduleJob, cancelJob, scheduledJobs } from '../scheduler.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Protect all job routes
router.use(requireAuth);

// Forbidden commands
const FORBIDDEN_PATTERNS = [
  /(^|\s)sudo(\s|$)/i,
  /rm\s+-rf/i,
/:\s*\(\)\s*{\s*:\s*\|\s*:\s*;\s*}/,
/dd\s+if=/i,
/mkfs\./i,
/:(){:|:&};:/
];

function isForbidden(command) {
  if (!command) return false;
  return FORBIDDEN_PATTERNS.some(re => re.test(command));
}

// Create new job — owner is the authenticated user
router.post('/', async (req, res) => {
  try {
    const ownerId = req.user.id;
    const { name, command, schedule } = req.body;
    if (!name || !command || !schedule)
      return res.status(400).json({ error: 'name, command, schedule required' });

    if (command.length > 2000)
      return res.status(400).json({ error: 'command too long' });

    if (isForbidden(command))
      return res.status(400).json({ error: 'command contains forbidden operations' });

    if (!cron.validate(schedule))
      return res.status(400).json({ error: 'invalid cron expression' });

    const result = await pool.query(
      'INSERT INTO jobs (name, command, schedule, status, owner) VALUES ($1, $2, $3, $4, $5) RETURNING *',
                                    [name, command, schedule, 'active', ownerId]
    );

    const job = result.rows[0];
    if (job.status === 'active') await scheduleJob(job);
    res.status(201).json(job);
  } catch (err) {
    console.error('POST /api/jobs error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// List jobs for authenticated user
router.get('/', async (req, res) => {
  try {
    const ownerId = req.user.id;
    const result = await pool.query('SELECT * FROM jobs WHERE owner=$1 ORDER BY id DESC', [ownerId]);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/jobs error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// Run job manually (owner-only)
router.post('/:id/run', async (req, res) => {
  try {
    const ownerId = req.user.id;
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM jobs WHERE id=$1 AND owner=$2', [id, ownerId]);
    const job = result.rows[0];
    if (!job) return res.status(404).json({ error: 'job not found' });

    await scheduleJob(job, true);
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/jobs/:id/run error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// Toggle job status (pause/resume) — owner-only
router.put('/:id/status', async (req, res) => {
  try {
    const ownerId = req.user.id;
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'paused'].includes(status))
      return res.status(400).json({ error: 'invalid status' });

    // Ensure owner
    const check = await pool.query('SELECT * FROM jobs WHERE id=$1 AND owner=$2', [id, ownerId]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'job not found' });

    await pool.query('UPDATE jobs SET status=$1 WHERE id=$2', [status, id]);

    if (status === 'paused') {
      cancelJob(id);
    } else {
      if (!scheduledJobs.has(Number(id))) {
        const result = await pool.query('SELECT * FROM jobs WHERE id=$1', [id]);
        const job = result.rows[0];
        if (job) await scheduleJob(job);
      }
    }

    res.json({ ok: true, status });
  } catch (err) {
    console.error('PUT /api/jobs/:id/status error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// Get all runs for a specific job (owner-only)
router.get('/:id/runs', async (req, res) => {
  try {
    const ownerId = req.user.id;
    const { id } = req.params;
    const check = await pool.query('SELECT id FROM jobs WHERE id=$1 AND owner=$2', [id, ownerId]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'job not found' });

    const result = await pool.query('SELECT * FROM job_runs WHERE job_id=$1 ORDER BY id DESC', [id]);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/jobs/:id/runs error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// Get single run by ID (owner-only)
router.get('/runs/:runId', async (req, res) => {
  try {
    const ownerId = req.user.id;
    const { runId } = req.params;

    // join to ensure owner
    const result = await pool.query(
      `SELECT jr.* FROM job_runs jr
      JOIN jobs j ON j.id = jr.job_id
      WHERE jr.id=$1 AND j.owner=$2`,
      [runId, ownerId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /api/jobs/runs/:runId error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// Delete a job (owner-only)
router.delete('/:id', async (req, res) => {
  try {
    const ownerId = req.user.id;
    const { id } = req.params;
    const result = await pool.query('DELETE FROM jobs WHERE id=$1 AND owner=$2 RETURNING id', [id, ownerId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'job not found or not yours' });

    cancelJob(id);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/jobs/:id error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

export default router;
