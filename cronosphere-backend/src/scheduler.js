// src/scheduler.js
import cron from 'node-cron';
import { pool } from './db.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';

dotenv.config();

const scheduledJobs = new Map(); // cron tasks
const runningJobs = new Map();   // jobId => Set of currently executing child processes
const VERBOSE = process.env.VERBOSE_LOGS === 'true';
const execAsync = promisify(exec); // For async/await with exec

// Logging helpers
const log = (...args) => { if (VERBOSE) console.log(...args); };
const info = (...args) => console.log(...args);
const warn = (...args) => console.warn(...args);
const error = (...args) => console.error(...args);

/**
 * Run a job immediately and log to job_runs
 */
async function runJobNow(job) {
  // Double-check status from DB before executing
  const dbRes = await pool.query('SELECT status FROM jobs WHERE id=$1', [job.id]);
  const currentStatus = dbRes.rows[0]?.status;
  if (currentStatus === 'paused') {
    info(`⏸️ Job #${job.id} "${job.name}" is paused; skipping execution`);
    return;
  }

  const { id, command, name, owner } = job;
  let runId;
  const startTimestamp = new Date().toISOString();
  info(`⚡ [${startTimestamp}] Starting job #${id}: "${name}"`);
  log(`   ├─ Command: ${command}`);

  // Create user-specific temporary directory
  const userTempDir = `/tmp/user_${owner}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  try {
    // Create the directory
    await execAsync(`mkdir -p ${userTempDir}`);

    const start = await pool.query(
      'INSERT INTO job_runs (job_id, status, started_at) VALUES ($1, $2, NOW()) RETURNING id',
                                   [id, 'running']
    );
    runId = start.rows[0].id;
    log(`   ├─ Logged new job run ID: ${runId}`);
    log(`   ├─ User temp directory: ${userTempDir}`);

    const startTime = Date.now();

    // Set environment variables for the job
    const env = {
      ...process.env,
      USER_TEMP_DIR: userTempDir,
      JOB_ID: id.toString(),
      USER_ID: owner.toString(),
      JOB_NAME: name
    };

    const child = exec(command, {
      timeout: 60000,
      env: env,
      cwd: userTempDir  // Run in user's temp directory
    }, async (err, stdout, stderr) => {
      // Remove child from runningJobs
      const set = runningJobs.get(id);
      if (set) {
        set.delete(child);
        if (set.size === 0) runningJobs.delete(id);
      }

      const output = (stdout || '') + (stderr || '');
      const status = err ? 'error' : 'success';
      const finished_at = new Date();
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      try {
        await pool.query(
          'UPDATE job_runs SET status=$1, output=$2, finished_at=$3 WHERE id=$4',
          [status, output.trim() || '(no output)', finished_at, runId]
        );

        info(`✅ [${new Date().toISOString()}] Job #${id} "${name}" completed: ${status.toUpperCase()}`);
        log(`   ├─ Duration: ${duration}s`);
        log(`   ├─ Finished at: ${finished_at.toISOString()}`);
        log(`   └─ Output: ${output.trim() || '(no output)'}`);

        // Cleanup user's temp directory (after job completion)
        try {
          await execAsync(`rm -rf ${userTempDir}`);
          log(`   ├─ Cleaned up temp directory: ${userTempDir}`);
        } catch (cleanupErr) {
          warn(`⚠️ Failed to cleanup temp directory ${userTempDir}: ${cleanupErr.message}`);
        }
      } catch (dbErr) {
        error(`❌ Failed to update job run #${runId}: ${dbErr.message}`);
        // Still try to cleanup temp directory
        try {
          await execAsync(`rm -rf ${userTempDir}`);
        } catch (cleanupErr) {
          // Ignore cleanup errors if DB update already failed
        }
      }
    });

    // Track multiple concurrent executions
    if (!runningJobs.has(id)) runningJobs.set(id, new Set());
    runningJobs.get(id).add(child);

  } catch (err) {
    // Cleanup temp directory if job failed to start
    try {
      await execAsync(`rm -rf ${userTempDir}`);
    } catch (cleanupErr) {
      // Ignore cleanup errors
    }

    const set = runningJobs.get(id);
    if (set && runId) set.delete(runId);
    error(`❌ [${new Date().toISOString()}] Job "${name}" (id=${id}) failed: ${err.message}`);
    if (runId) {
      await pool.query(
        'UPDATE job_runs SET status=$1, output=$2, finished_at=NOW() WHERE id=$3',
                       ['error', err.message, runId]
      );
      log(`   └─ Recorded error in job_runs table for run ID ${runId}`);
    }
  }
}

/**
 * Schedule a job normally
 */
export async function scheduleJob(job, runNow = false) {
  if (runNow) return runJobNow(job);

  if (!cron.validate(job.schedule)) {
    warn(`⚠️ Invalid cron expression for job #${job.id}: ${job.schedule}`);
    return;
  }

  if (scheduledJobs.has(job.id)) {
    info(`ℹ️ Job #${job.id} "${job.name}" is already scheduled`);
    return;
  }

  const task = cron.schedule(job.schedule, async () => {
    // Always fetch latest job status before running
    const result = await pool.query('SELECT * FROM jobs WHERE id=$1', [job.id]);
    const freshJob = result.rows[0];
    if (!freshJob) return; // job deleted
    if (freshJob.status === 'paused') {
      info(`⏸️ Skipping paused job #${job.id}: "${job.name}"`);
      return;
    }
    await runJobNow(freshJob);
  });

  scheduledJobs.set(job.id, task);
  info(`⏰ Scheduled job #${job.id}: "${job.name}" (${job.schedule})`);
}

/**
 * Cancel a scheduled job and kill all currently running processes
 */
export function cancelJob(id) {
  const task = scheduledJobs.get(id);
  if (task) {
    task.stop();
    scheduledJobs.delete(id);
    info(`🛑 Canceled scheduled job #${id}`);
  } else {
    info(`ℹ️ Job #${id} is not currently scheduled; nothing to cancel`);
  }

  const set = runningJobs.get(id);
  if (set) {
    for (const child of set) {
      child.kill('SIGTERM'); // terminate the process
    }
    runningJobs.delete(id);
    info(`🛑 Killed all running processes for job #${id}`);
  }
}

/**
 * Initialize scheduler on server start
 */
export async function initScheduler() {
  info('🔄 Initializing scheduler and loading jobs from database...');
  const result = await pool.query('SELECT * FROM jobs');
  let loaded = 0;
  let skipped = 0;

  for (const job of result.rows) {
    if (job.status === 'paused') {
      log(`⏸️ Skipping paused job: "${job.name}" (id=${job.id})`);
      skipped++;
      continue;
    }
    await scheduleJob(job);
    loaded++;
  }

  info(`✅ Scheduler initialization complete. Loaded ${loaded} active jobs, skipped ${skipped} paused jobs`);
}

/**
 * Cleanup old job runs (older than 30 days)
 */
export async function cleanupOldRuns() {
  info(`🧹 [${new Date().toISOString()}] Cleaning old job runs...`);
  try {
    const before = VERBOSE ? await pool.query('SELECT COUNT(*) FROM job_runs') : null;
    const res = await pool.query("DELETE FROM job_runs WHERE finished_at < NOW() - INTERVAL '30 days'");
    const after = VERBOSE ? await pool.query('SELECT COUNT(*) FROM job_runs') : null;

    if (VERBOSE && before && after) {
      log(`   ├─ Total runs before cleanup: ${before.rows[0].count}`);
      log(`   ├─ Deleted ${res.rowCount} old job runs (>30 days)`);
      log(`   └─ Total runs after cleanup: ${after.rows[0].count}`);
    } else if (res.rowCount > 0) {
      info(`🧹 Deleted ${res.rowCount} old job runs (>30 days)`);
    } else {
      log('🧹 No old job runs to clean up');
    }
  } catch (err) {
    error(`[Cleanup] ❌ Failed to clean old runs: ${err.message}`);
  }
}

// Schedule cleanup once per day at midnight
cron.schedule('0 0 * * *', cleanupOldRuns);

export { scheduledJobs, runningJobs };
