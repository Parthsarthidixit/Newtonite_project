import mongoose from 'mongoose';
const teamSchema = new mongoose.Schema({ name: { type: String, required: true, trim: true, unique: true }, description: { type: String, maxlength: 300, default: '' } }, { timestamps: true });
export default mongoose.model('Team', teamSchema);
