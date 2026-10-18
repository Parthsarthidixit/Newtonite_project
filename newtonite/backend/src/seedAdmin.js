import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from './models/User.js';
import Team from './models/Team.js';
try {
  await mongoose.connect(process.env.MONGODB_URI);
  let team = await Team.findOne({ name: 'Operations' });
  if (!team) team = await Team.create({ name: 'Operations', description: 'Default operational work team' });
  const email = (process.env.SEED_ADMIN_EMAIL || '').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || '';
  if (!email || password.length < 12 || password === 'change-this-before-running') throw new Error('Set SEED_ADMIN_EMAIL and a unique SEED_ADMIN_PASSWORD of at least 12 characters in .env first.');
  let admin = await User.findOne({ email });
  if (!admin) admin = await User.create({ name: process.env.SEED_ADMIN_NAME || 'Newtonite Admin', email, passwordHash: await bcrypt.hash(password, 12), role: 'admin', teamIds: [team._id] });
  else { admin.role = 'admin'; if (!admin.teamIds.some(id => String(id) === String(team._id))) admin.teamIds.push(team._id); await admin.save(); }
  console.log(`Admin ready: ${admin.email}. Sign in through the UI.`);
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally { await mongoose.disconnect(); }
