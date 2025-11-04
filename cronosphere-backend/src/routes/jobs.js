import express from 'express';
import { pool } from '../db.js';
import { scheduleJob, cancelJob } from '../scheduler.js';
const router = express.Router();

// Create job
router.post('/', async (req, res) => {
  const { name, command, schedule } = req.body;
  if (!name || !command || !schedule) {
    return res.status(400).json({ error: 'name, command, schedule required' });
  }

  // Basic cron expression check could be added (skip for brevity)
  const result = await pool.query(
    'INSERT INTO jobs (name, command, schedule) VALUES ($1,$2,$3) RETURNING *',
    [name, command, schedule]
  );
  const job = result.rows[0];

  // Register the job with the running scheduler
  scheduleJob(job);

  res.status(201).json(job);
});

// List jobs
router.get('/', async (req, res) => {
  const result = await pool.query('SELECT * FROM jobs ORDER BY id DESC');
  res.json(result.rows);
});

// Trigger run now
router.post('/:id/run', async (req, res) => {
  const id = req.params.id;
  const result = await pool.query('SELECT * FROM jobs WHERE id=$1', [id]);
  const job = result.rows[0];
  if (!job) return res.status(404).json({error:'job not found'});
  await scheduleJob(job, true); // immediate run
  res.json({ok:true});
});

// Delete job
router.delete('/:id', async (req, res) => {
  const id = req.params.id;
  await pool.query('DELETE FROM jobs WHERE id=$1', [id]);
  cancelJob(id);
  res.json({ok:true});
});

export default router;
