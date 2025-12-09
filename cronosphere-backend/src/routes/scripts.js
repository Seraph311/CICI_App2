// src/routes/scripts.js
import express from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
const router = express.Router();

// All script endpoints require authentication
router.use(requireAuth);

// Create a script
router.post('/', async (req, res) => {
  try {
    const owner = req.user.id;
    const { name, content, type } = req.body;
    if (!name || !content) return res.status(400).json({ error: 'name and content required' });
    const t = (type === 'node') ? 'node' : 'bash';
    const result = await pool.query(
      'INSERT INTO scripts (owner, name, content, type) VALUES ($1,$2,$3,$4) RETURNING *',
      [owner, name, content, t]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /api/scripts error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// List scripts for current user
router.get('/', async (req, res) => {
  try {
    const owner = req.user.id;
    const result = await pool.query('SELECT id, name, type, created_at FROM scripts WHERE owner=$1 ORDER BY id DESC', [owner]);
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/scripts error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// Get single script (content) - owner only
router.get('/:id', async (req, res) => {
  try {
    const owner = req.user.id;
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM scripts WHERE id=$1 AND owner=$2', [id, owner]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('GET /api/scripts/:id error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// Delete script
router.delete('/:id', async (req, res) => {
  try {
    const owner = req.user.id;
    const { id } = req.params;
    // ensure owner or 0 rows effected
    await pool.query('DELETE FROM scripts WHERE id=$1 AND owner=$2', [id, owner]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/scripts/:id error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

export default router;
