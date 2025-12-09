import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import jobsRouter from './routes/jobs.js';
import authRouter from './routes/auth.js';
import { initScheduler } from './scheduler.js';
import { pool } from './db.js';

dotenv.config();

const app = express();

// CORS FIX
app.use(
  cors({
    origin: "*", // you can restrict later
    methods: "GET,POST,PUT,DELETE,OPTIONS",
    allowedHeaders: "Content-Type, Authorization, x-api-key"
  })
);

app.use(express.json());

// Auth routes
app.use('/api/auth', authRouter);

// Protected job routes mounted at /api/jobs
app.use('/api/jobs', jobsRouter);

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    const client = await pool.connect();
    console.log('✅ Connected to PostgreSQL database!');
    client.release();

    app.listen(PORT, async () => {
      console.log(`Server listening on ${PORT}`);
      await initScheduler();
    });
  } catch (err) {
    console.error('❌ Failed to connect to the database:', err.message);
    process.exit(1);
  }
}

startServer();
