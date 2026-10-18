import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import User from '../models/User.js';
import Team from '../models/Team.js';

const router = Router();
const USER_FIELDS = 'name email role teamIds isActive';

router.get('/users', requireAuth, async (req, res, next) => {
  try {
    const filter = req.user.role === 'admin' ? {} : { teamIds: { $in: req.user.teamIds } };
    const users = await User.find(filter).select(USER_FIELDS).sort({ name: 1 }).limit(200).lean();
    res.json({ data: users });
  } catch (e) { next(e); }
});

router.get('/teams', requireAuth, async (req, res, next) => {
  try {
    const filter = req.user.role === 'admin' ? {} : { _id: { $in: req.user.teamIds } };
    res.json({ data: await Team.find(filter).select('name description').sort({ name: 1 }).lean() });
  } catch (e) { next(e); }
});

router.post('/teams', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const input = z.object({ name: z.string().trim().min(2).max(80), description: z.string().trim().max(300).optional() }).parse(req.body);
    const team = await Team.create({ name: input.name, description: input.description || '' });
    res.status(201).json({ data: team });
  } catch (e) { next(e); }
});

router.patch('/users/:id/team', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid user id' });
    const { teamIds } = req.body;
    if (!Array.isArray(teamIds) || teamIds.some(id => !mongoose.isValidObjectId(id))) return res.status(400).json({ message: 'teamIds must be an array of valid team ids' });
    const uniqueIds = [...new Set(teamIds.map(String))];
    const count = await Team.countDocuments({ _id: { $in: uniqueIds } });
    if (count !== uniqueIds.length) return res.status(400).json({ message: 'One or more teams do not exist' });
    const result = await User.updateOne({ _id: req.params.id }, { $set: { teamIds: uniqueIds } });
    if (!result.matchedCount) return res.status(404).json({ message: 'User not found' });
    res.json({ user: await User.findById(req.params.id).select(USER_FIELDS).lean() });
  } catch (e) { next(e); }
});

router.patch('/users/:id/role', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid user id' });
    const { role } = z.object({ role: z.enum(['admin', 'manager', 'member']) }).parse(req.body);
    if (req.params.id === req.user.id) return res.status(400).json({ message: 'You cannot change your own role' });
    const result = await User.updateOne({ _id: req.params.id }, { $set: { role } });
    if (!result.matchedCount) return res.status(404).json({ message: 'User not found' });
    res.json({ user: await User.findById(req.params.id).select(USER_FIELDS).lean() });
  } catch (e) { next(e); }
});

export default router;
