import mongoose from 'mongoose';
const workItemSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, minlength: 3, maxlength: 160 },
  description: { type: String, default: '', maxlength: 5000 },
  category: { type: String, enum: ['Customer Issue', 'Engineering', 'Payment', 'Incident', 'Compliance', 'Operations'], default: 'Operations' },
  status: { type: String, enum: ['Open', 'In Progress', 'Blocked', 'In Review', 'Resolved', 'Cancelled'], default: 'Open', index: true },
  priority: { type: String, enum: ['Low', 'Medium', 'High', 'Urgent'], default: 'Medium', index: true },
  teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true, index: true },
  assigneeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  dueDate: { type: Date, default: null },
  version: { type: Number, default: 0 },
  comments: [{ body: { type: String, required: true, maxlength: 2000 }, authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, createdAt: { type: Date, default: Date.now } }]
}, { timestamps: true });
workItemSchema.index({ teamId: 1, status: 1, priority: 1, updatedAt: -1 });
workItemSchema.index({ assigneeId: 1, status: 1 });
export default mongoose.model('WorkItem', workItemSchema);
