import 'dotenv/config';
import mongoose from 'mongoose';
import app from './app.js';

const port = process.env.PORT || 5000;
if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is missing. Copy backend/.env.example to backend/.env and configure Atlas.');
  process.exit(1);
}
const secret = process.env.JWT_SECRET || '';
if (secret.length < 24 || secret === 'replace-with-a-long-random-secret') {
  console.error('JWT_SECRET is missing, too short (min 24 chars) or still the placeholder. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  process.exit(1);
}
try {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('MongoDB connected');
  const server = app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
  const shutdown = async () => { server.close(); await mongoose.disconnect(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (error) {
  console.error('Could not connect to MongoDB:', error.message);
  process.exit(1);
}
