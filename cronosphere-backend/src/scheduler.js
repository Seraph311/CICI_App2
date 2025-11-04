import cron from 'node-cron';
import { exec } from 'child_process';
import { pool } from './db.js';

const tasks = new Map(); // jobId -> cron task

export async function initScheduler() {
  // load active jobs from DB and schedule them
  const res = await pool.query('SELECT * FROM jobs WHERE status=$1', ['active']);
  for (const job of res.rows) {
    scheduleJob(job);
  }
}

export function scheduleJob(job, runNow=false) {
  // Cancel existing if exists
  if (tasks.has(String(job.id))) {
    tasks.get(String(job.id)).stop();
    tasks.delete(String(job.id));
  }

  const run = async () => {
    const insert = await pool.query(
      'INSERT INTO job_runs (job_id, started_at) VALUES ($1, NOW()) RETURNING id',
      [job.id]
    );
    const runId = insert.rows[0].id;
    const child = exec(job.command, { timeout: 1000 * 60 * 10 }, async (error, stdout, stderr) => {
      const exit_code = error ? (error.code || 1) : 0;
      await pool.query(
        'UPDATE job_runs SET finished_at=NOW(), exit_code=$1, stdout=$2, stderr=$3 WHERE id=$4',
        [exit_code, stdout || '', stderr || '', runId]
      );
    });
  };

  // If runNow true, immediately run once
  if (runNow) {
    run();
  }

  // Validate cron expression? node-cron will throw if invalid
  const task = cron.schedule(job.schedule, run, { scheduled: !runNow });
  tasks.set(String(job.id), task);
}

export function cancelJob(jobId) {
  const t = tasks.get(String(jobId));
  if (t) {
    t.stop();
    tasks.delete(String(jobId));
  }
}
