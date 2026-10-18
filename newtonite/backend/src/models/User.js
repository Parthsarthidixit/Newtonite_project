import mongoose from 'mongoose';
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['admin', 'manager', 'member'], default: 'member' },
  teamIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Team' }],
  isActive: { type: Boolean, default: true }
}, { timestamps: true });
export default mongoose.model('User', userSchema);
