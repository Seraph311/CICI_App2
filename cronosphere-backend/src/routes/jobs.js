import express from 'express';
import cron from 'node-cron';
import { pool } from '../db.js';
import { scheduleJob, cancelJob, scheduledJobs } from '../scheduler.js';

const router = express.Router();

// Simple API key check
router.use((req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!process.env.API_KEY) return next(); // skip if not configured
  if (apiKey !== process.env.API_KEY)
    return res.status(401).json({ error: 'unauthorized' });
  next();
});

// Forbidden commands
const FORBIDDEN_PATTERNS = [
  /(^|\s)sudo(\s|$)/i,
  /rm\s+-rf/i,
/:\s*\(\)\s*{\s*:\s*\|\s*:\s*;\s*}/, // fork bomb
/dd\s+if=/i,
/mkfs\./i,
/:(){:|:&};:/ // another fork bomb
];

function isForbidden(command) {
  if (!command) return false;
  return FORBIDDEN_PATTERNS.some(re => re.test(command));
}

// Create new job
router.post('/', async (req, res) => {
  try {
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
      'INSERT INTO jobs (name, command, schedule, status) VALUES ($1, $2, $3, $4) RETURNING *',
                                    [name, command, schedule, 'active']
    );

    const job = result.rows[0];
    // Only schedule active jobs
    if (job.status === 'active') {
      await scheduleJob(job);
    }

    res.status(201).json(job);
  } catch (err) {
    console.error('POST /api/jobs error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// List jobs
router.get('/', async (req, res) => {
  const result = await pool.query('SELECT * FROM jobs ORDER BY id DESC');
  res.json(result.rows);
});

// Run job manually
router.post('/:id/run', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM jobs WHERE id = $1', [id]);
    const job = result.rows[0];
    if (!job) return res.status(404).json({ error: 'job not found' });

    // Run manually without adding to scheduledJobs
    await scheduleJob(job, true);

    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/jobs/:id/run error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// Toggle job status (pause/resume)
router.put('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'paused'].includes(status))
      return res.status(400).json({ error: 'invalid status' });

    // Update DB
    await pool.query('UPDATE jobs SET status=$1 WHERE id=$2', [status, id]);

    if (status === 'paused') {
      // Stop any scheduled task
      cancelJob(id);
    } else {
      // Resume job only if not already scheduled
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

// Get all runs for a specific job
router.get('/:id/runs', async (req, res) => {
  const { id } = req.params;
  const result = await pool.query(
    'SELECT * FROM job_runs WHERE job_id=$1 ORDER BY id DESC',
    [id]
  );
  res.json(result.rows);
});

// Get single run by ID
router.get('/runs/:runId', async (req, res) => {
  const { runId } = req.params;
  const result = await pool.query(
    'SELECT * FROM job_runs WHERE id=$1',
    [runId]
  );
  if (result.rows.length === 0)
    return res.status(404).json({ error: 'not found' });
  res.json(result.rows[0]);
});

// Delete a job
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  await pool.query('DELETE FROM jobs WHERE id=$1', [id]);
  cancelJob(id);
  res.json({ ok: true });
});

export default router;
