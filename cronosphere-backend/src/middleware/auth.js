import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

export function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing token' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { id, username, iat, exp }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'invalid or expired token' });
  }
}
