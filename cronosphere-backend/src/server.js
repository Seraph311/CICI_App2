import express from 'express';
import dotenv from 'dotenv';
import jobsRouter from './routes/jobs.js';
import { initScheduler } from './scheduler.js';
import { pool } from './db.js';

dotenv.config();

const app = express();
app.use(express.json());

app.use('/api/jobs', jobsRouter);

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // 🧠 Try to connect to PostgreSQL
    const client = await pool.connect();
    console.log('✅ Connected to PostgreSQL database!'); // see if it connects
    client.release();

    app.listen(PORT, async () => {
      console.log(`Server listening on ${PORT}`);
      await initScheduler();
    });
  } catch (err) {
    console.error('❌ Failed to connect to the database:', err.message); // did not connect
    process.exit(1);
  }
}

startServer();
