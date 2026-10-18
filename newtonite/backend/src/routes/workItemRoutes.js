import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import WorkItem from '../models/WorkItem.js';
import Team from '../models/Team.js';
import User from '../models/User.js';
import Activity from '../models/Activity.js';
import IdempotencyRecord from '../models/IdempotencyRecord.js';
import { canReadWorkItem, canMutateWorkItem, canTransition } from '../utils/workflow.js';

const router = Router();
router.use(requireAuth);

const CATEGORIES = ['Customer Issue', 'Engineering', 'Payment', 'Incident', 'Compliance', 'Operations'];
const STATUSES = ['Open', 'In Progress', 'Blocked', 'In Review', 'Resolved', 'Cancelled'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
const objectId = z.string().refine(v => mongoose.isValidObjectId(v), 'Invalid id');
const dateString = z.string().refine(v => !Number.isNaN(Date.parse(v)), 'Invalid date');

const createSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().max(5000).optional(),
  category: z.enum(CATEGORIES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  teamId: objectId,
  assigneeId: objectId.optional().nullable(),
  dueDate: dateString.optional().nullable()
});
const patchSchema = z.object({
  title: z.string().trim().min(3).max(160).optional(),
  description: z.string().max(5000).optional(),
  category: z.enum(CATEGORIES).optional(),
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  dueDate: dateString.nullable().optional(),
  version: z.number().int().nonnegative()
});
const assignSchema = z.object({ assigneeId: objectId.nullable(), version: z.number().int().nonnegative() });
const commentSchema = z.object({ body: z.string().trim().min(1).max(2000) });
// Query params are validated so operator objects such as status[$ne]=x are rejected instead of reaching MongoDB.
const listSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  teamId: objectId.optional(),
  assigneeId: objectId.optional(),
  q: z.string().trim().max(100).optional()
});

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
async function logActivity(workItemId, actorId, action, details = {}) { await Activity.create({ workItemId, actorId, action, details }); }
const validId = id => mongoose.isValidObjectId(id);

async function getAccessibleItem(id, user) {
  if (!validId(id)) return { error: [400, 'Invalid work item id'] };
  const item = await WorkItem.findById(id);
  if (!item) return { error: [404, 'Work item not found'] };
  if (!canReadWorkItem(user, item)) return { error: [403, 'You do not have access to this team work item'] };
  return { item };
}

router.get('/', async (req, res, next) => {
  try {
    const query = listSchema.parse(req.query);
    const filter = {};
    if (req.user.role !== 'admin') filter.teamId = { $in: req.user.teamIds };
    if (query.teamId) {
      if (req.user.role !== 'admin' && !req.user.teamIds.includes(query.teamId)) return res.status(403).json({ message: 'You do not have access to this team' });
      filter.teamId = query.teamId;
    }
    if (query.status) filter.status = query.status;
    if (query.priority) filter.priority = query.priority;
    if (query.assigneeId) filter.assigneeId = query.assigneeId;
    if (query.q) {
      const re = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [{ title: re }, { description: re }];
    }
    const [items, total] = await Promise.all([
      WorkItem.find(filter).select('-comments').sort({ updatedAt: -1, _id: -1 }).skip((query.page - 1) * query.limit).limit(query.limit)
        .populate('assigneeId', 'name email').populate('createdBy', 'name email').populate('teamId', 'name').lean(),
      WorkItem.countDocuments(filter)
    ]);
    res.json({ data: items, pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) } });
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  let claimed = null;
  try {
    const input = createSchema.parse(req.body);
    if (req.user.role !== 'admin' && !req.user.teamIds.includes(input.teamId)) return res.status(403).json({ message: 'You cannot create work in this team' });
    if (!(await Team.exists({ _id: input.teamId }))) return res.status(400).json({ message: 'Team does not exist' });
    if (input.assigneeId) {
      const assignee = await User.findById(input.assigneeId);
      if (!assignee || !assignee.isActive || !assignee.teamIds.some(id => String(id) === input.teamId)) return res.status(400).json({ message: 'Assignee must be an active member of the selected team' });
    }
    const key = req.get('Idempotency-Key');
    if (key) {
      if (key.length > 200) return res.status(400).json({ message: 'Idempotency-Key is too long' });
      try {
        await IdempotencyRecord.create({ key, userId: req.user.id });
        claimed = { key, userId: req.user.id };
      } catch (e) {
        if (e.code !== 11000) throw e;
        const existing = await IdempotencyRecord.findOne({ key, userId: req.user.id }).lean();
        if (existing?.response) return res.status(200).json({ data: existing.response, deduplicated: true });
        return res.status(409).json({ message: 'A request with this Idempotency-Key is still being processed', code: 'IDEMPOTENCY_IN_PROGRESS' });
      }
    }
    const item = await WorkItem.create({ ...input, dueDate: input.dueDate || null, createdBy: req.user.id });
    await logActivity(item._id, req.user.id, 'created', { title: item.title });
    if (claimed) await IdempotencyRecord.updateOne(claimed, { $set: { response: item.toObject() } });
    res.status(201).json({ data: item });
  } catch (e) {
    if (claimed) await IdempotencyRecord.deleteOne(claimed).catch(() => {});
    next(e);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const result = await getAccessibleItem(req.params.id, req.user);
    if (result.error) return res.status(result.error[0]).json({ message: result.error[1] });
    const item = await WorkItem.findById(req.params.id)
      .populate('assigneeId', 'name email').populate('createdBy', 'name email').populate('teamId', 'name').populate('comments.authorId', 'name email').lean();
    res.json({ data: item });
  } catch (e) { next(e); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const input = patchSchema.parse(req.body);
    const result = await getAccessibleItem(req.params.id, req.user);
    if (result.error) return res.status(result.error[0]).json({ message: result.error[1] });
    const current = result.item;
    if (!canMutateWorkItem(req.user, current)) return res.status(403).json({ message: 'You cannot update this work item' });
    if (input.status && !canTransition(current.status, input.status)) return res.status(422).json({ message: `Invalid status transition: ${current.status} → ${input.status}` });
    const { version, ...changes } = input;
    if (changes.dueDate !== undefined) changes.dueDate = changes.dueDate || null;
    const updated = await WorkItem.findOneAndUpdate({ _id: current._id, version }, { $set: changes, $inc: { version: 1 } }, { new: true, runValidators: true });
    if (!updated) return res.status(409).json({ message: 'This item changed since you opened it. Refresh and retry.', code: 'STALE_VERSION' });
    const changedFields = {};
    for (const k of Object.keys(changes)) {
      if (String(current[k] ?? '') !== String(updated[k] ?? '')) changedFields[k] = { from: current[k] ?? null, to: updated[k] ?? null };
    }
    if (Object.keys(changedFields).length) await logActivity(updated._id, req.user.id, 'updated', changedFields);
    res.json({ data: updated });
  } catch (e) { next(e); }
});

router.post('/:id/assign', async (req, res, next) => {
  try {
    const input = assignSchema.parse(req.body);
    const result = await getAccessibleItem(req.params.id, req.user);
    if (result.error) return res.status(result.error[0]).json({ message: result.error[1] });
    const current = result.item;
    if (!(req.user.role === 'admin' || req.user.role === 'manager')) return res.status(403).json({ message: 'Only a manager or admin can assign work' });
    if (input.assigneeId) {
      const user = await User.findById(input.assigneeId);
      if (!user || !user.isActive || !user.teamIds.some(id => String(id) === String(current.teamId))) return res.status(400).json({ message: 'Assignee must be an active member of this team' });
    }
    const updated = await WorkItem.findOneAndUpdate({ _id: current._id, version: input.version }, { $set: { assigneeId: input.assigneeId }, $inc: { version: 1 } }, { new: true });
    if (!updated) return res.status(409).json({ message: 'This item changed since you opened it. Refresh and retry.', code: 'STALE_VERSION' });
    await logActivity(updated._id, req.user.id, 'assigned', { from: current.assigneeId, to: input.assigneeId });
    res.json({ data: updated });
  } catch (e) { next(e); }
});

// Comments are append-only ($push is atomic), so they do not need the version check and do not bump the version:
// adding a comment must not invalidate another user's in-progress edit.
router.post('/:id/comments', async (req, res, next) => {
  try {
    const input = commentSchema.parse(req.body);
    const result = await getAccessibleItem(req.params.id, req.user);
    if (result.error) return res.status(result.error[0]).json({ message: result.error[1] });
    if (!canMutateWorkItem(req.user, result.item)) return res.status(403).json({ message: 'You cannot comment on this work item' });
    const updated = await WorkItem.findByIdAndUpdate(result.item._id, { $push: { comments: { body: input.body, authorId: req.user.id } } }, { new: true });
    await logActivity(updated._id, req.user.id, 'commented', { commentPreview: input.body.slice(0, 100) });
    res.status(201).json({ data: updated.comments.at(-1), version: updated.version });
  } catch (e) { next(e); }
});

router.get('/:id/activity', async (req, res, next) => {
  try {
    const result = await getAccessibleItem(req.params.id, req.user);
    if (result.error) return res.status(result.error[0]).json({ message: result.error[1] });
    const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit || '30', 10) || 30));
    const data = await Activity.find({ workItemId: result.item._id }).sort({ createdAt: -1, _id: -1 }).limit(limit).populate('actorId', 'name email').lean();
    res.json({ data });
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const result = await getAccessibleItem(req.params.id, req.user);
    if (result.error) return res.status(result.error[0]).json({ message: result.error[1] });
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Only admins can delete work items' });
    await WorkItem.deleteOne({ _id: result.item._id });
    await logActivity(result.item._id, req.user.id, 'deleted', { title: result.item.title });
    res.status(204).end();
  } catch (e) { next(e); }
});
export default router;
