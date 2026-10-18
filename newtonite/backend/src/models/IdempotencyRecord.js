import mongoose from 'mongoose';
// One record per (user, Idempotency-Key). The record is "claimed" before the work item is created
// (response === null) and completed afterwards, so two simultaneous retries cannot both create an item.
const schema = new mongoose.Schema({
  key: { type: String, required: true, maxlength: 200 },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  response: { type: mongoose.Schema.Types.Mixed, default: null },
  createdAt: { type: Date, default: Date.now, expires: 86400 }
}, { versionKey: false });
schema.index({ userId: 1, key: 1 }, { unique: true });
export default mongoose.model('IdempotencyRecord', schema);
