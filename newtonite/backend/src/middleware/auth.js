import jwt from 'jsonwebtoken';
import User from '../models/User.js';
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Authentication required' });
    if (!process.env.JWT_SECRET) return res.status(500).json({ message: 'JWT_SECRET is not configured' });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub).select('name email role teamIds isActive');
    if (!user || !user.isActive) return res.status(401).json({ message: 'Account is unavailable' });
    req.user = { id: user._id.toString(), name: user.name, email: user.email, role: user.role, teamIds: user.teamIds.map(String) };
    next();
  } catch (e) { return res.status(401).json({ message: 'Invalid or expired token' }); }
}
export const requireRole = (...roles) => (req, res, next) => roles.includes(req.user?.role) ? next() : res.status(403).json({ message: 'Insufficient permissions' });
