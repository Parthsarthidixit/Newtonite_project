import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

// Uses MONGODB_TEST_URI when provided, otherwise an in-memory MongoDB (mongodb-memory-server).
let app, memory, User, Team, WorkItem, Activity;
const tokens = {};
const ids = {};

async function login(email, password = 'Password123!') {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  return res.body.token;
}
const as = (who) => ({ Authorization: `Bearer ${tokens[who]}` });
async function createItem(who, teamKey = 'teamA', extra = {}) {
  const res = await request(app).post('/api/work-items').set(as(who)).send({ title: 'Test work item', teamId: ids[teamKey], ...extra });
  expect(res.status).toBe(201);
  return res.body.data;
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
  process.env.AUTH_RATE_LIMIT = '10000';
  process.env.API_RATE_LIMIT = '100000';
  let uri = process.env.MONGODB_TEST_URI;
  if (!uri) {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memory = await MongoMemoryServer.create();
    uri = memory.getUri();
  }
  // Indexes are created explicitly (unique constraints are what the tests rely on) so the suite also runs on
  // MongoDB-compatible servers that lack TTL-index support.
  mongoose.set('autoIndex', false);
  await mongoose.connect(uri, { dbName: `newtonite_test_${Date.now()}` });
  ({ default: app } = await import('../src/app.js'));
  ({ default: User } = await import('../src/models/User.js'));
  ({ default: Team } = await import('../src/models/Team.js'));
  ({ default: WorkItem } = await import('../src/models/WorkItem.js'));
  ({ default: Activity } = await import('../src/models/Activity.js'));
  const { default: IdempotencyRecord } = await import('../src/models/IdempotencyRecord.js');
  await Promise.all([
    User.collection.createIndex({ email: 1 }, { unique: true }),
    Team.collection.createIndex({ name: 1 }, { unique: true }),
    IdempotencyRecord.collection.createIndex({ userId: 1, key: 1 }, { unique: true })
  ]);

  const [teamA, teamB] = await Team.create([{ name: 'Team A' }, { name: 'Team B' }]);
  ids.teamA = String(teamA._id); ids.teamB = String(teamB._id);
  const passwordHash = await bcrypt.hash('Password123!', 4);
  const mk = (name, role, teamIds) => User.create({ name, email: `${name}@test.dev`, passwordHash, role, teamIds });
  const [admin, manager, member1, member2, memberB, loner] = await Promise.all([
    mk('admin', 'admin', [teamA._id]), mk('manager', 'manager', [teamA._id]), mk('member1', 'member', [teamA._id]),
    mk('member2', 'member', [teamA._id]), mk('memberB', 'member', [teamB._id]), mk('loner', 'member', [])
  ]);
  Object.entries({ admin, manager, member1, member2, memberB, loner }).forEach(([k, u]) => { ids[k] = String(u._id); });
  for (const who of ['admin', 'manager', 'member1', 'member2', 'memberB', 'loner']) tokens[who] = await login(`${who}@test.dev`);
});

afterAll(async () => {
  if (mongoose.connection.readyState) { await mongoose.connection.dropDatabase().catch(() => {}); await mongoose.disconnect(); }
  if (memory) await memory.stop();
});

describe('authentication', () => {
  it('registers only member accounts and ignores a self-assigned role', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: 'Eve Example', email: 'eve@test.dev', password: 'Password123!', role: 'admin' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('member');
    expect(res.body.token).toBeTruthy();
  });
  it('rejects duplicate emails and weak input', async () => {
    expect((await request(app).post('/api/auth/register').send({ name: 'Eve Again', email: 'eve@test.dev', password: 'Password123!' })).status).toBe(409);
    expect((await request(app).post('/api/auth/register').send({ name: 'X', email: 'bad', password: '1' })).status).toBe(400);
  });
  it('rejects wrong passwords and missing/invalid tokens', async () => {
    expect((await request(app).post('/api/auth/login').send({ email: 'admin@test.dev', password: 'wrong' })).status).toBe(401);
    expect((await request(app).get('/api/work-items')).status).toBe(401);
    expect((await request(app).get('/api/work-items').set({ Authorization: 'Bearer garbage' })).status).toBe(401);
  });
  it('never returns the password hash', async () => {
    const res = await request(app).get('/api/auth/me').set(as('admin'));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
  });
});

describe('authorization', () => {
  it('hides other teams work items (403) and from lists', async () => {
    const item = await createItem('member1');
    expect((await request(app).get(`/api/work-items/${item._id}`).set(as('memberB'))).status).toBe(403);
    expect((await request(app).get(`/api/work-items/${item._id}`).set(as('member2'))).status).toBe(200);
    const list = await request(app).get('/api/work-items?limit=50').set(as('memberB'));
    expect(list.body.data.some(i => i._id === item._id)).toBe(false);
  });
  it('blocks cross-team filtering and creation', async () => {
    expect((await request(app).get(`/api/work-items?teamId=${ids.teamA}`).set(as('memberB'))).status).toBe(403);
    expect((await request(app).post('/api/work-items').set(as('memberB')).send({ title: 'Sneaky item', teamId: ids.teamA })).status).toBe(403);
    expect((await request(app).post('/api/work-items').set(as('loner')).send({ title: 'No team item', teamId: ids.teamA })).status).toBe(403);
  });
  it('lets members update only items they created or are assigned to', async () => {
    const item = await createItem('member1');
    const denied = await request(app).patch(`/api/work-items/${item._id}`).set(as('member2')).send({ title: 'Hijacked title', version: item.version });
    expect(denied.status).toBe(403);
    const ok = await request(app).patch(`/api/work-items/${item._id}`).set(as('member1')).send({ title: 'Renamed by owner', version: item.version });
    expect(ok.status).toBe(200);
    const byManager = await request(app).patch(`/api/work-items/${item._id}`).set(as('manager')).send({ priority: 'High', version: ok.body.data.version });
    expect(byManager.status).toBe(200);
  });
  it('only admins can delete, manage teams, roles and memberships', async () => {
    const item = await createItem('member1');
    expect((await request(app).delete(`/api/work-items/${item._id}`).set(as('manager'))).status).toBe(403);
    expect((await request(app).delete(`/api/work-items/${item._id}`).set(as('admin'))).status).toBe(204);
    expect((await request(app).post('/api/teams').set(as('manager')).send({ name: 'Nope' })).status).toBe(403);
    expect((await request(app).patch(`/api/users/${ids.member1}/role`).set(as('member1')).send({ role: 'admin' })).status).toBe(403);
    expect((await request(app).patch(`/api/users/${ids.member1}/team`).set(as('member1')).send({ teamIds: [ids.teamA] })).status).toBe(403);
  });
  it('rejects invalid ids with 400 and unknown items with 404', async () => {
    expect((await request(app).get('/api/work-items/not-an-id').set(as('admin'))).status).toBe(400);
    expect((await request(app).get(`/api/work-items/${new mongoose.Types.ObjectId()}`).set(as('admin'))).status).toBe(404);
  });
});

describe('workflow rules', () => {
  it('enforces allowed status transitions', async () => {
    const item = await createItem('member1');
    const bad = await request(app).patch(`/api/work-items/${item._id}`).set(as('member1')).send({ status: 'Resolved', version: item.version });
    expect(bad.status).toBe(422);
    const ok = await request(app).patch(`/api/work-items/${item._id}`).set(as('member1')).send({ status: 'In Progress', version: item.version });
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('In Progress');
  });
  it('validates body fields', async () => {
    const item = await createItem('member1');
    expect((await request(app).patch(`/api/work-items/${item._id}`).set(as('member1')).send({ status: 'Nonsense', version: item.version })).status).toBe(400);
    expect((await request(app).patch(`/api/work-items/${item._id}`).set(as('member1')).send({ title: 'Missing version' })).status).toBe(400);
    expect((await request(app).post('/api/work-items').set(as('member1')).send({ title: 'ab', teamId: ids.teamA })).status).toBe(400);
  });
});

describe('optimistic concurrency', () => {
  it('returns 409 for a stale version instead of overwriting', async () => {
    const item = await createItem('member1');
    const first = await request(app).patch(`/api/work-items/${item._id}`).set(as('member1')).send({ title: 'First writer wins', version: item.version });
    expect(first.status).toBe(200);
    const stale = await request(app).patch(`/api/work-items/${item._id}`).set(as('manager')).send({ title: 'Stale writer loses', version: item.version });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_VERSION');
    const current = await request(app).get(`/api/work-items/${item._id}`).set(as('member1'));
    expect(current.body.data.title).toBe('First writer wins');
  });
  // Needs a real MongoDB (atomic single-document updates). Set SKIP_ATOMICITY_TESTS=1 only for MongoDB-compatible stand-ins.
  it.skipIf(process.env.SKIP_ATOMICITY_TESTS)('lets exactly one of several simultaneous updates succeed', async () => {
    const item = await createItem('member1');
    const results = await Promise.all(['A', 'B', 'C'].map(t => request(app).patch(`/api/work-items/${item._id}`).set(as('manager')).send({ title: `Concurrent ${t}`, version: item.version })));
    const codes = results.map(r => r.status).sort();
    expect(codes).toEqual([200, 409, 409]);
  });
});

describe('assignment', () => {
  it('lets managers assign to team members only', async () => {
    const item = await createItem('member1');
    expect((await request(app).post(`/api/work-items/${item._id}/assign`).set(as('member1')).send({ assigneeId: ids.member2, version: item.version })).status).toBe(403);
    expect((await request(app).post(`/api/work-items/${item._id}/assign`).set(as('manager')).send({ assigneeId: ids.memberB, version: item.version })).status).toBe(400);
    const ok = await request(app).post(`/api/work-items/${item._id}/assign`).set(as('manager')).send({ assigneeId: ids.member2, version: item.version });
    expect(ok.status).toBe(200);
    expect(String(ok.body.data.assigneeId)).toBe(ids.member2);
    const stale = await request(app).post(`/api/work-items/${item._id}/assign`).set(as('manager')).send({ assigneeId: null, version: item.version });
    expect(stale.status).toBe(409);
    // the newly assigned member can now update it
    const upd = await request(app).patch(`/api/work-items/${item._id}`).set(as('member2')).send({ status: 'In Progress', version: ok.body.data.version });
    expect(upd.status).toBe(200);
  });
});

describe('comments and activity history', () => {
  it('stores comments with author names and does not bump the version', async () => {
    const item = await createItem('member1');
    const c = await request(app).post(`/api/work-items/${item._id}/comments`).set(as('member1')).send({ body: 'Looking into this now' });
    expect(c.status).toBe(201);
    expect(c.body.version).toBe(item.version);
    expect((await request(app).post(`/api/work-items/${item._id}/comments`).set(as('member1')).send({ body: '   ' })).status).toBe(400);
    expect((await request(app).post(`/api/work-items/${item._id}/comments`).set(as('memberB')).send({ body: 'outsider' })).status).toBe(403);
    const detail = await request(app).get(`/api/work-items/${item._id}`).set(as('member2'));
    expect(detail.body.data.comments[0].authorId.name).toBe('member1');
    // an edit made with the version loaded before the comment still succeeds
    expect((await request(app).patch(`/api/work-items/${item._id}`).set(as('member1')).send({ priority: 'Urgent', version: item.version })).status).toBe(200);
  });
  it('records an immutable activity trail', async () => {
    const item = await createItem('member1');
    await request(app).patch(`/api/work-items/${item._id}`).set(as('member1')).send({ status: 'In Progress', version: item.version });
    await request(app).post(`/api/work-items/${item._id}/comments`).set(as('member1')).send({ body: 'hello' });
    const res = await request(app).get(`/api/work-items/${item._id}/activity`).set(as('member2'));
    expect(res.status).toBe(200);
    expect(res.body.data.map(a => a.action).sort()).toEqual(['commented', 'created', 'updated']);
    expect(res.body.data[0].actorId.name).toBe('member1');
    expect((await request(app).get(`/api/work-items/${item._id}/activity`).set(as('memberB'))).status).toBe(403);
  });
});

describe('listing: pagination, search and filters', () => {
  it('paginates on the server, searches partially and validates filters', async () => {
    for (let i = 0; i < 12; i++) await createItem('admin', 'teamA', { title: `Paginate invoice ${i}`, priority: i % 2 ? 'Urgent' : 'Low' });
    const p1 = await request(app).get('/api/work-items?limit=5&page=1&q=invoice').set(as('manager'));
    expect(p1.status).toBe(200);
    expect(p1.body.data).toHaveLength(5);
    expect(p1.body.pagination.total).toBe(12);
    expect(p1.body.pagination.pages).toBe(3);
    const p3 = await request(app).get('/api/work-items?limit=5&page=3&q=invoic').set(as('manager'));
    expect(p3.body.data).toHaveLength(2);
    const urgent = await request(app).get('/api/work-items?priority=Urgent&q=invoice').set(as('manager'));
    expect(urgent.body.pagination.total).toBe(6);
    expect((await request(app).get('/api/work-items?status[$ne]=Open').set(as('manager'))).status).toBe(400);
    expect((await request(app).get('/api/work-items?limit=9999').set(as('manager'))).status).toBe(400);
    const regexChars = await request(app).get('/api/work-items?q=.*(').set(as('manager'));
    expect(regexChars.status).toBe(200);
    expect(regexChars.body.data).toHaveLength(0);
  });
});

describe('idempotent creation', () => {
  it('returns the same item for a retried request', async () => {
    const key = `key-${Date.now()}`;
    const body = { title: 'Idempotent create', teamId: ids.teamA };
    const a = await request(app).post('/api/work-items').set(as('member1')).set('Idempotency-Key', key).send(body);
    const b = await request(app).post('/api/work-items').set(as('member1')).set('Idempotency-Key', key).send(body);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.deduplicated).toBe(true);
    expect(b.body.data._id).toBe(a.body.data._id);
    expect(await WorkItem.countDocuments({ title: 'Idempotent create' })).toBe(1);
  });
  it('never creates duplicates for simultaneous retries', async () => {
    const key = `race-${Date.now()}`;
    const body = { title: 'Race create', teamId: ids.teamA };
    const results = await Promise.all([1, 2, 3, 4].map(() => request(app).post('/api/work-items').set(as('member1')).set('Idempotency-Key', key).send(body)));
    expect(results.filter(r => r.status === 201)).toHaveLength(1);
    expect(await WorkItem.countDocuments({ title: 'Race create' })).toBe(1);
    expect(results.every(r => [200, 201, 409].includes(r.status))).toBe(true);
  });
  it('scopes keys per user', async () => {
    const key = `shared-${Date.now()}`;
    const a = await request(app).post('/api/work-items').set(as('member1')).set('Idempotency-Key', key).send({ title: 'User one item', teamId: ids.teamA });
    const b = await request(app).post('/api/work-items').set(as('member2')).set('Idempotency-Key', key).send({ title: 'User two item', teamId: ids.teamA });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
  });
});

describe('administration', () => {
  it('lets an admin create teams, assign memberships and change roles', async () => {
    const team = await request(app).post('/api/teams').set(as('admin')).send({ name: 'Finance Ops', description: 'Payments' });
    expect(team.status).toBe(201);
    expect((await request(app).post('/api/teams').set(as('admin')).send({ name: 'Finance Ops' })).status).toBe(409);
    const assign = await request(app).patch(`/api/users/${ids.loner}/team`).set(as('admin')).send({ teamIds: [team.body.data._id] });
    expect(assign.status).toBe(200);
    expect((await request(app).patch(`/api/users/${ids.loner}/team`).set(as('admin')).send({ teamIds: [String(new mongoose.Types.ObjectId())] })).status).toBe(400);
    const role = await request(app).patch(`/api/users/${ids.loner}/role`).set(as('admin')).send({ role: 'manager' });
    expect(role.status).toBe(200);
    expect(role.body.user.role).toBe('manager');
    expect((await request(app).patch(`/api/users/${ids.admin}/role`).set(as('admin')).send({ role: 'member' })).status).toBe(400);
    expect((await request(app).patch(`/api/users/${ids.loner}/role`).set(as('admin')).send({ role: 'superuser' })).status).toBe(400);
  });
  it('scopes user and team listings for non-admins', async () => {
    const users = await request(app).get('/api/users').set(as('memberB'));
    expect(users.body.data.map(u => u.name)).toEqual(['memberB']);
    const teams = await request(app).get('/api/teams').set(as('memberB'));
    expect(teams.body.data.map(t => t.name)).toEqual(['Team B']);
  });
});

describe('platform', () => {
  it('serves a health check and JSON 404s', async () => {
    expect((await request(app).get('/api/health')).body.status).toBe('ok');
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/Route not found/);
  });
  it('returns 400 for malformed JSON', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{bad json');
    expect(res.status).toBe(400);
  });
});
