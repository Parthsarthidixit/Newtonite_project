import mongoose from 'mongoose';
const activitySchema = new mongoose.Schema({
  workItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkItem', required: true, index: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, required: true, maxlength: 80 },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now, index: true }
}, { versionKey: false });
activitySchema.index({ workItemId: 1, createdAt: -1 });
export default mongoose.model('Activity', activitySchema);
