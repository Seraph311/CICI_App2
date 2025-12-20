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

// Script timeout configuration
const SCRIPT_TIMEOUTS = {
  bash: 2 * 60 * 1000,                    // 2 minutes for bash scripts
  command: 2 * 60 * 1000,                 // 2 minutes for commands
  node: {
    default: 30 * 60 * 1000,              // 30 minutes for regular Node.js scripts
      longRunning: 24 * 60 * 60 * 1000      // 24 hours for long-running scripts (including Discord bots)
  }
};

// Keep-alive function that works in any environment
async function pingRenderService() {
  const renderUrl = process.env.RENDER_EXTERNAL_URL;

  if (!renderUrl) {
    console.log('⚠️ RENDER_EXTERNAL_URL is not set in environment variables');
    return { success: false, reason: 'No RENDER_EXTERNAL_URL set' };
  }

  console.log(`🔍 Attempting to ping: ${renderUrl}`);

  try {
    // Try using fetch (Node.js 18+ has built-in fetch)
    let fetchFunc;
    try {
      fetchFunc = fetch;
      console.log('📡 Using built-in fetch API');
    } catch {
      // Fallback to dynamic import
      console.log('📡 Falling back to node-fetch module');
      const { default: fetchModule } = await import('node-fetch');
      fetchFunc = fetchModule;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const start = Date.now();

    try {
      console.log(`🔄 Sending request to ${renderUrl}`);
      const response = await fetchFunc(renderUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Render-KeepAlive/1.0' }
      });
      clearTimeout(timeoutId);

      const duration = Date.now() - start;
      console.log(`📥 Response status: ${response.status} (${duration}ms)`);

      return {
        success: response.ok,
        status: response.status,
        duration
      };
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      console.log(`❌ Fetch error:`, fetchErr);

      // Check specific error types
      if (fetchErr.name === 'AbortError') {
        return { success: false, error: 'Request timeout (15s)' };
      }

      if (fetchErr.code === 'ENOTFOUND' || fetchErr.code === 'ECONNREFUSED') {
        return { success: false, error: `Cannot connect to ${renderUrl}` };
      }

      throw fetchErr; // Re-throw for outer catch block
    }
  } catch (error) {
    console.log(`💥 Unexpected error during ping:`, error);

    // Handle the case where error might not have a message property
    const errorMessage = error?.message || error?.toString() || 'Unknown error';

    // Additional diagnostics
    let detailedError = errorMessage;
    if (error?.code) {
      detailedError += ` (code: ${error.code})`;
    }
    if (error?.errno) {
      detailedError += ` (errno: ${error.errno})`;
    }
    if (error?.syscall) {
      detailedError += ` (syscall: ${error.syscall})`;
    }

    return { success: false, error: detailedError };
  }
}

// Schedule it with cron
cron.schedule('*/10 * * * *', async () => {
  console.log(`🕐 [${new Date().toISOString()}] Running keep-alive ping...`);
  const result = await pingRenderService();
  if (result.success) {
    console.log(`✅ Keep-alive ping successful: ${result.status} (${result.duration}ms)`);
  } else {
    console.warn(`⚠️ Keep-alive failed: ${result.error || result.reason || 'Unknown error'}`);
  }
});

// Run immediately on startup
setTimeout(async () => {
  console.log('🚀 Running initial keep-alive ping...');
  const result = await pingRenderService();
  if (result.success) {
    console.log(`🚀 Initial keep-alive successful: ${result.status} (${result.duration}ms)`);
  } else {
    console.warn(`⚠️ Initial keep-alive failed: ${result.error || result.reason || 'Unknown error'}`);
  }
}, 5000);

// ensure /tmp/scripts exists
const SCRIPTS_DIR = '/tmp/scripts';
try {
  if (!fs.existsSync(SCRIPTS_DIR)) fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
} catch (e) {
  // best effort
  log('Could not create scripts dir:', e.message);
}

const FORBIDDEN_PATTERNS = [
  // Removed for now
];

const NODE_FORBIDDEN_PATTERNS = [
  // Removed for now
];

// === SHARED MODULE CACHE ===
const sharedModuleCache = new Map();

/**
 * Pre-load heavy modules at startup
 */
async function preloadCommonModules() {
  console.log('📦 Pre-loading common modules...');

  // List of heavy modules to pre-load - only load what's actually needed
  const heavyModules = [
    { name: 'discord.js', optional: false },
    { name: 'minecraft-server-util', optional: true },
    { name: 'axios', optional: true },
    { name: 'node-fetch', optional: true },
    { name: 'ws', optional: true }
  ];

  let loadedCount = 0;
  let skippedCount = 0;

  for (const module of heavyModules) {
    try {
      const start = Date.now();

      // First check if module exists in node_modules
      const modulePath = path.join(process.cwd(), 'node_modules', module.name);
      if (!fs.existsSync(modulePath) && module.optional) {
        console.log(`   ⏭️ Skipping optional module ${module.name} (not installed)`);
        skippedCount++;
        continue;
      }

      // Try to load the module
      let mod;
      try {
        // Try with the module directly first
        const moduleSpecifier = module.name;
        mod = await import(moduleSpecifier);
      } catch (importErr) {
        if (module.optional) {
          console.log(`   ⏭️ Skipping optional module ${module.name}: ${importErr.message}`);
          skippedCount++;
          continue;
        }
        // For required modules, try alternative import methods
        try {
          // Try with file:// prefix for absolute path
          mod = await import(`file://${modulePath}/index.js`);
        } catch (fileErr) {
          // Last resort: try to find the main entry point
          const packageJsonPath = path.join(modulePath, 'package.json');
          if (fs.existsSync(packageJsonPath)) {
            try {
              const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, 'utf8'));
              const mainFile = packageJson.main || 'index.js';
              mod = await import(`file://${path.join(modulePath, mainFile)}`);
            } catch (packageErr) {
              if (module.optional) {
                console.log(`   ⏭️ Skipping optional module ${module.name}: ${packageErr.message}`);
                skippedCount++;
                continue;
              }
              throw importErr; // Re-throw original error for required modules
            }
          } else {
            if (module.optional) {
              console.log(`   ⏭️ Skipping optional module ${module.name} (no package.json found)`);
              skippedCount++;
              continue;
            }
            throw importErr;
          }
        }
      }

      const loadTime = Date.now() - start;
      sharedModuleCache.set(module.name, mod);
      loadedCount++;
      console.log(`   ✅ ${module.name} loaded in ${loadTime}ms`);
    } catch (err) {
      if (module.optional) {
        console.log(`   ⏭️ Skipping optional module ${module.name}: ${err.message}`);
        skippedCount++;
      } else {
        console.error(`   ❌ Failed to load required module ${module.name}: ${err.message}`);
        // For required modules, we might want to exit or handle differently
      }
    }
  }

  console.log(`✅ Pre-loaded ${loadedCount} modules, skipped ${skippedCount} optional modules`);
  console.log('Available modules:', Array.from(sharedModuleCache.keys()));
}

// Pre-load modules on startup
preloadCommonModules().catch(err => {
  console.warn('Could not pre-load modules:', err.message);
});

function isScriptContentForbidden(content, type = 'bash') {
  if (!content) return false;

  // Check for general forbidden patterns
  const hasForbiddenPattern = FORBIDDEN_PATTERNS.some(re => re.test(content));

  // Additional checks for Node.js scripts
  if (type === 'node') {
    const hasNodeForbidden = NODE_FORBIDDEN_PATTERNS.some(re => re.test(content));
    if (hasNodeForbidden) return true;

    // Check for potentially dangerous patterns in Node.js scripts
    const dangerousPatterns = [
      /*
       / eval\s*\(/,                  **
       /new\s+Function\s*\(/,
       /require\s*\(\s*["']child_process["']/,
       /require\s*\(\s*["']fs["']/,
       /process\.exit\s*\(/,
       /process\.kill\s*\(/
       */
    ];

    if (dangerousPatterns.some(pattern => pattern.test(content))) {
      return true;
    }
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
 * Create a Node.js script wrapper with shared module support
 */
async function createNodeScriptWrapper(originalContent, projectRoot, nodeModulesPath) {
  // List of modules that can be shared (only those actually loaded)
  const shareableModules = Array.from(sharedModuleCache.keys());

  return `
  // === SCRIPT WRAPPER ===
  // This wrapper sets up the environment for the script

  // Available shared modules from parent process
  const availableSharedModules = ${JSON.stringify(shareableModules)};

  console.log('=== Script Environment ===');
  console.log('Project root:', '${projectRoot}');
  console.log('Available shared modules:', availableSharedModules);

  // Set up NODE_PATH for module resolution
  const currentPaths = process.env.NODE_PATH ? process.env.NODE_PATH.split(':') : [];
  process.env.NODE_PATH = '${nodeModulesPath}:' + currentPaths.join(':');
  process.env.PROJECT_ROOT = '${projectRoot}';

  // Add node_modules to module.paths for require resolution
  if (module.paths) {
    module.paths.unshift('${nodeModulesPath}');
  }

  // === ORIGINAL SCRIPT ===
  ${originalContent}
  `;
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

      // Check if this is a Discord bot script or long-running script
      const isDiscordBot = script.content.includes('discord.js') ||
      script.content.includes('new Client') ||
      script.content.includes('GatewayIntentBits');

      // Check for long-running directive
      const hasLongRunningDirective =
      script.content.includes('// @timeout: long-running') ||
      script.content.includes('// timeout: long-running');

      // Set timeout based on script type and directives
      let timeout;
      if (script.type === 'node') {
        if (isDiscordBot || hasLongRunningDirective) {
          timeout = SCRIPT_TIMEOUTS.node.longRunning; // 24 hours for Discord bots and long-running scripts
        } else {
          timeout = SCRIPT_TIMEOUTS.node.default; // 30 minutes for regular scripts
        }
      } else {
        timeout = SCRIPT_TIMEOUTS.bash; // 2 minutes for bash scripts
      }

      // Set environment variables for the job
      const env = {
        ...process.env,
        USER_TEMP_DIR: userTempDir,
        JOB_ID: id.toString(),
        USER_ID: owner.toString(),
        JOB_NAME: name,
        SCRIPT_ID: script_id.toString(),
        NODE_PATH: `${nodeModulesPath}:${process.env.NODE_PATH || ''}`,
        PROJECT_ROOT: projectRoot,
        // Increase Node.js memory and timeout settings
        NODE_OPTIONS: '--max-old-space-size=512 --max-semi-space-size=64 --no-deprecation',
        UV_THREADPOOL_SIZE: '4'
      };

      // Spawn the appropriate interpreter
      if (script.type === 'node') {
        // For Node.js scripts, create wrapper with environment setup
        const originalContent = await fs.promises.readFile(filepath, 'utf8');

        // Only wrap if it's not a Discord bot or long-running script
        let finalContent;
        if (isDiscordBot || hasLongRunningDirective) {
          // For Discord bots and long-running scripts, ensure they handle SIGTERM properly
          // Check if the script already has SIGTERM handling
          if (!originalContent.includes('SIGTERM') && !originalContent.includes('process.on')) {
            // Add basic SIGTERM handling
            finalContent = originalContent + `

            // Auto-added SIGTERM handler for scheduler compatibility
            process.on('SIGTERM', () => {
              console.log('Received SIGTERM from scheduler, shutting down...');
              if (typeof client !== 'undefined' && client.destroy) {
                client.destroy();
              }
              // For non-Discord long-running scripts, they should clean up resources here
              process.exit(0);
            });

            console.log('⏳ Long-running script with scheduler timeout of ${timeout/1000/60} minutes');
            `;
          } else {
            finalContent = originalContent;
          }
        } else {
          const wrappedContent = await createNodeScriptWrapper(originalContent, projectRoot, nodeModulesPath);
          finalContent = wrappedContent;
        }

        // Write the final script
        await fs.promises.writeFile(filepath, finalContent, { mode: 0o700 });

        // Spawn with appropriate timeout
        child = spawn(process.execPath || 'node', [filepath], {
          timeout: timeout,
          env: env,
          cwd: projectRoot
        });

      } else { // bash
        child = spawn('bash', [filepath], {
          timeout: timeout,
          env: env,
          cwd: userTempDir
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
        const timedOut = signal === 'SIGTERM' && duration >= (timeout/1000 - 10); // Check if timed out

        try {
          await pool.query(
            'UPDATE job_runs SET status=$1, output=$2, finished_at=$3 WHERE id=$4',
            [status, (out || '(no output)').trim(), finished_at, runId]
          );

          if (timedOut) {
            info(`⏰ [${new Date().toISOString()}] Job #${id} "${name}" TIMED OUT after ${duration}s`);
          } else {
            info(`✅ [${new Date().toISOString()}] Job #${id} "${name}" completed: ${status.toUpperCase()}`);
          }
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
        timeout: SCRIPT_TIMEOUTS.command,
        env: env,
        cwd: userTempDir
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
