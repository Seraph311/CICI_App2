import cron from 'node-cron';
import { pool } from './db.js';
import { exec, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const scheduledJobs = new Map(); // cron tasks
const runningJobs = new Map();   // jobId => Set of currently executing child processes
const VERBOSE = process.env.VERBOSE_LOGS === 'true';

// Logging helpers
const log = (...args) => { if (VERBOSE) console.log(...args); };
const info = (...args) => console.log(...args);
const warn = (...args) => console.warn(...args);
const error = (...args) => console.error(...args);

// ensure /tmp/scripts exists
const SCRIPTS_DIR = '/tmp/scripts';
try {
  if (!fs.existsSync(SCRIPTS_DIR)) fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
} catch (e) {
  // best effort
  log('Could not create scripts dir:', e.message);
}

const FORBIDDEN_PATTERNS = [
];

const NODE_FORBIDDEN_PATTERNS = [
];

function isScriptContentForbidden(content, type = 'bash') {
  if (!content) return false;

  // Check for general forbidden patterns
  const hasForbiddenPattern = FORBIDDEN_PATTERNS.some(re => re.test(content));

  // Additional checks for Node.js scripts
  if (type === 'node') {
    const hasNodeForbidden = NODE_FORBIDDEN_PATTERNS.some(re => re.test(content));
    if (hasNodeForbidden) return true;

    // Also check for eval and Function constructor
    // if (content.includes('eval(') || content.includes('Function(') ||
    //     content.includes('setTimeout(') || content.includes('setInterval(')) {
    //   return true;
    // }
  }

  return hasForbiddenPattern;
}

function validateCommand(command) {
  if (!command) return null;

  const hasForbiddenPattern = FORBIDDEN_PATTERNS.some(re => re.test(command));
  if (hasForbiddenPattern) {
    return 'Command contains forbidden operations';
  }

  return null;
}

/**
 * Helper: write script content to disk and return filepath
 */
async function writeScriptToFile(scriptId, content, type) {
  const ext = (type === 'node') ? 'js' : 'sh';
  const filename = path.join(SCRIPTS_DIR, `script_${scriptId}.${ext}`);
  await fs.promises.writeFile(filename, content, { mode: 0o700 });
  return filename;
}

/**
 * Create user-specific temporary directory
 */
async function createUserTempDir(owner) {
  const userTempDir = `/tmp/user_${owner}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  await fs.promises.mkdir(userTempDir, { recursive: true });
  return userTempDir;
}

/**
 * Cleanup user temp directory
 */
async function cleanupUserTempDir(userTempDir) {
  try {
    await fs.promises.rm(userTempDir, { recursive: true, force: true });
    return true;
  } catch (err) {
    warn(`⚠️ Failed to cleanup temp directory ${userTempDir}: ${err.message}`);
    return false;
  }
}

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

  const { id, command, name, script_id, owner } = job;
  let runId;
  let userTempDir = null;
  const startTimestamp = new Date().toISOString();
  info(`⚡ [${startTimestamp}] Starting job #${id}: "${name}"`);
  log(`   ├─ Command: ${command}`);
  log(`   ├─ Script ID: ${script_id || '(none)'}`);
  log(`   ├─ Owner: ${owner}`);

  try {
    // Create user-specific temporary directory
    userTempDir = await createUserTempDir(owner);
    log(`   ├─ User temp directory: ${userTempDir}`);

    const start = await pool.query(
      'INSERT INTO job_runs (job_id, status, started_at) VALUES ($1, $2, NOW()) RETURNING id',
                                   [id, 'running']
    );
    runId = start.rows[0].id;
    log(`   ├─ Logged new job run ID: ${runId}`);

    const startTime = Date.now();

    // Determine execution: script or command
    let child;
    if (script_id) {
      // Fetch script content and type
      const sres = await pool.query('SELECT content, type FROM scripts WHERE id=$1', [script_id]);
      const script = sres.rows[0];
      if (!script) {
        // Cleanup temp directory before returning
        if (userTempDir) await cleanupUserTempDir(userTempDir);

        await pool.query('UPDATE job_runs SET status=$1, output=$2, finished_at=NOW() WHERE id=$3',
                         ['error', 'script not found', runId]);
        error(`❌ Script ${script_id} not found for job ${id}`);
        return;
      }

      // Validate script content before execution (defense in depth)
      if (isScriptContentForbidden(script.content, script.type)) {
        if (userTempDir) await cleanupUserTempDir(userTempDir);

        await pool.query('UPDATE job_runs SET status=$1, output=$2, finished_at=NOW() WHERE id=$3',
                         ['error', 'script contains forbidden operations and was blocked', runId]);
        error(`❌ Script ${script_id} for job ${id} contains forbidden operations - blocked`);
        return;
      }

      const filepath = await writeScriptToFile(script_id, script.content, script.type);

      // Get project root and node_modules path
      const projectRoot = process.cwd();
      const nodeModulesPath = path.join(projectRoot, 'node_modules');

      // Debug logging
      console.log('=== DEBUG: Module Resolution ===');
      console.log('Project root:', projectRoot);
      console.log('Node modules path:', nodeModulesPath);
      console.log('Node modules exists?', fs.existsSync(nodeModulesPath));
      console.log('discord.js exists?', fs.existsSync(path.join(nodeModulesPath, 'discord.js')));
      console.log('Script path:', filepath);
      console.log('Script type:', script.type);

      // Set environment variables for the job with NODE_PATH
      const env = {
        ...process.env,
        USER_TEMP_DIR: userTempDir,
        JOB_ID: id.toString(),
        USER_ID: owner.toString(),
        JOB_NAME: name,
        SCRIPT_ID: script_id.toString(),
        NODE_PATH: `${nodeModulesPath}:${process.env.NODE_PATH || ''}`
      };

      // Spawn the appropriate interpreter
      if (script.type === 'node') {
        // For Node.js scripts, we need to modify them to handle module resolution
        const originalContent = await fs.promises.readFile(filepath, 'utf8');

        // Create a wrapper that handles module resolution
        const wrapperContent = `
        // Module resolution wrapper for Render environment
        const Module = require('module');
        const originalResolveFilename = Module._resolveFilename;
        const path = require('path');

        const projectRoot = '${projectRoot.replace(/'/g, "\\'")}';
        const nodeModulesPath = path.join(projectRoot, 'node_modules');

        Module._resolveFilename = function(request, parent, isMain) {
          try {
            return originalResolveFilename.call(this, request, parent, isMain);
          } catch (err) {
            if (err.code === 'MODULE_NOT_FOUND') {
              // Try project's node_modules
              try {
                return require.resolve(request, { paths: [nodeModulesPath] });
              } catch (e1) {
                // Try parent directory's node_modules
                if (parent && parent.filename) {
                  const parentDir = path.dirname(parent.filename);
                  const parentNodeModules = path.join(parentDir, 'node_modules');
                  try {
                    return require.resolve(request, { paths: [parentNodeModules] });
                  } catch (e2) {
                    // Try default paths
                    const defaultPaths = require.resolve.paths(request) || [];
                    for (const p of defaultPaths) {
                      try {
                        return require.resolve(request, { paths: [p] });
                      } catch (e3) {
                        // Continue
                      }
                    }
                  }
                }
              }
            }
            throw err;
          }
        };

        // Add project's node_modules to require paths
        if (!require.resolve.paths) {
          require.resolve.paths = function(request) {
            return [nodeModulesPath];
          };
        } else {
          const originalPaths = require.resolve.paths;
          require.resolve.paths = function(request) {
            const paths = originalPaths.call(this, request) || [];
            return [nodeModulesPath, ...paths];
          };
        }

        // Load the original script
        try {
          // First test if we can load discord.js
          console.log('Attempting to load dependencies...');

          ${originalContent}

        } catch (scriptErr) {
          console.error('Script execution error:', scriptErr.message);
          console.error('Stack:', scriptErr.stack);
          process.exit(1);
        }
        `;

        // Write the wrapped script
        await fs.promises.writeFile(filepath, wrapperContent, { mode: 0o700 });

        child = spawn(process.execPath || 'node', [filepath], {
          timeout: 120000, // Increased timeout for Discord bot startup
          env: env,
          cwd: projectRoot  // Run from project root
        });
      } else { // bash
        child = spawn('bash', [filepath], {
          timeout: 60000,
          env: env,
          cwd: userTempDir  // Bash scripts run in temp dir
        });
      }

      // capture output
      let out = '';
      child.stdout.on('data', chunk => out += chunk.toString());
      child.stderr.on('data', chunk => out += chunk.toString());

      child.on('close', async (code, signal) => {
        const status = code === 0 ? 'success' : 'error';
        const finished_at = new Date();
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        try {
          await pool.query(
            'UPDATE job_runs SET status=$1, output=$2, finished_at=$3 WHERE id=$4',
            [status, (out || '(no output)').trim(), finished_at, runId]
          );
          info(`✅ [${new Date().toISOString()}] Job #${id} "${name}" completed: ${status.toUpperCase()}`);
          log(`   ├─ Duration: ${duration}s`);
          log(`   └─ Output: ${out.trim() || '(no output)'}`);
        } catch (dbErr) {
          error(`❌ Failed to update job run #${runId}: ${dbErr.message}`);
        }

        // Cleanup user's temp directory
        if (userTempDir) {
          await cleanupUserTempDir(userTempDir);
        }

        // cleanup runningJobs set
        const set = runningJobs.get(id);
        if (set) {
          set.delete(child);
          if (set.size === 0) runningJobs.delete(id);
        }
      });

    } else {
      // Validate command before execution
      const commandError = validateCommand(command);
      if (commandError) {
        if (userTempDir) await cleanupUserTempDir(userTempDir);

        await pool.query('UPDATE job_runs SET status=$1, output=$2, finished_at=NOW() WHERE id=$3',
                         ['error', commandError, runId]);
        error(`❌ Command for job ${id} contains forbidden operations - blocked`);
        return;
      }

      // Execute plain command with user temp directory
      const env = {
        ...process.env,
        USER_TEMP_DIR: userTempDir,
        JOB_ID: id.toString(),
        USER_ID: owner.toString(),
        JOB_NAME: name
      };

      child = exec(command, {
        timeout: 60000,
        env: env,
        cwd: userTempDir  // Run in user's temp directory
      }, async (err, stdout, stderr) => {
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
          log(`   └─ Output: ${output.trim() || '(no output)'}`);
        } catch (dbErr) {
          error(`❌ Failed to update job run #${runId}: ${dbErr.message}`);
        }

        // Cleanup user's temp directory
        if (userTempDir) {
          await cleanupUserTempDir(userTempDir);
        }
      });
    }

    // Track multiple concurrent executions
    if (!runningJobs.has(id)) runningJobs.set(id, new Set());
    runningJobs.get(id).add(child);

  } catch (err) {
    // Cleanup temp directory if job failed to start
    if (userTempDir) {
      await cleanupUserTempDir(userTempDir);
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
      try { child.kill('SIGTERM'); } catch(e) {}
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
