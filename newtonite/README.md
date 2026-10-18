# Newtonite Operations Workspace

A focused MERN application for coordinating operational work items: authentication, team-aware authorization, server-side search/filter/pagination, a status workflow, comments, an immutable activity history, optimistic concurrency control, an admin console for teams and roles, and an automated test suite.

## Requirements
- Node.js 20+
- npm
- A MongoDB database (MongoDB Atlas free tier works)

## 1. Configure environment
```bash
cd backend
cp .env.example .env
```
Edit `backend/.env`:
- `MONGODB_URI` – your Atlas (or local) connection string
- `JWT_SECRET` – a long random value. The server refuses to start with a short or placeholder secret. Generate one with:
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `CLIENT_ORIGIN=http://localhost:5173`
- `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` (min. 12 chars), `SEED_ADMIN_NAME`

Never commit `.env`. The frontend reads an optional `VITE_API_URL` (see `frontend/.env.example`; defaults to `http://localhost:5000/api`).

## 2. Install and run
From the repository root:
```bash
npm install
npm run install:all
npm run seed:admin                    # creates the first admin and a default "Operations" team
npm run dev
```
- Frontend: http://localhost:5173
- API health: http://localhost:5000/api/health

(Or run `npm run dev --prefix backend` and `npm run dev --prefix frontend` in two terminals.)

## 3. First-run walkthrough
1. Sign in with the seeded admin account.
2. Open **Administration**: create teams and, for each person, set their **role** (member / manager / admin) and **team memberships**.
3. Register a second account. Public registration only ever creates a `member` with no team; that user sees a "not assigned to a team" notice until an admin adds them.
4. Create, search, filter, assign (manager/admin), comment on, and move work items through their workflow. Open an item to see its activity history.
5. Open the same item in two browsers, change it in one, then save in the other: the stale save is rejected with a conflict message instead of overwriting.

## Roles and permissions
| Capability | member | manager | admin |
|---|---|---|---|
| Read items of own team(s) | yes | yes | all teams |
| Create items in own team(s) | yes | yes | any team |
| Update / comment on items | only ones they created or are assigned to | any item in own team(s) | any |
| Assign work | no | yes (to active members of the item's team) | yes |
| Delete items | no | no | yes |
| Create teams, set roles and memberships | no | no | yes (cannot change own role) |

All checks are enforced on the server; the UI only mirrors them.

## Core behavior
- **Server-side search/filter/pagination**: `page`, `limit` (max 50), `q` (case-insensitive partial match on title/description), `status`, `priority`, `teamId`, `assigneeId`. Query parameters are schema-validated, so operator injection such as `status[$ne]=Open` returns `400`.
- **Workflow**: status changes are validated against an allowed-transition map (`422` on an invalid move).
- **Optimistic concurrency**: every item has a numeric `version`. Updates and assignments send the version they last saw; the write is a single conditional update (`_id` + `version`) that increments the version. A stale version returns `409 STALE_VERSION`. Comments are append-only (`$push`) and intentionally do not bump the version, so a comment never invalidates someone else's in-progress edit.
- **Idempotent creation**: send an `Idempotency-Key` header on `POST /api/work-items`. The key is claimed per user before the item is created (unique index on `userId + key`), so simultaneous retries create exactly one item; later retries return the original item (`200`, `deduplicated: true`).
- **Activity history**: every create/update/assign/comment/delete appends an activity record, listed newest first.
- **Session freshness**: the UI re-reads `/api/auth/me` on load so role/team changes made by an admin apply without logging out; any `401` signs the user out.

## Tests
```bash
cd backend
npm test
```
- `tests/workflow.test.js`: unit tests for workflow and permission rules.
- `tests/api.test.js`: 24 HTTP integration tests (supertest) covering auth, resource-level authorization, workflow, validation, optimistic concurrency (sequential and simultaneous writers), assignment, comments, activity, pagination/search/filter hardening, idempotency (including simultaneous retries) and admin operations.

By default the integration tests start an in-memory MongoDB (`mongodb-memory-server`, which downloads a `mongod` binary on first run, so it needs internet access). To use your own server instead, set `MONGODB_TEST_URI` to a **dedicated test** server/user; the suite creates a uniquely named database and drops it when finished. The simultaneous-writer concurrency test relies on MongoDB's atomic single-document updates and must run against a real MongoDB (the default).

## API overview
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `GET /api/users`, `GET /api/teams` (scoped to the caller's teams unless admin)
- Admin only: `POST /api/teams`, `PATCH /api/users/:id/team` (`{ teamIds }`), `PATCH /api/users/:id/role` (`{ role }`)
- `GET/POST /api/work-items`
- `GET/PATCH/DELETE /api/work-items/:id`
- `POST /api/work-items/:id/assign`
- `POST /api/work-items/:id/comments`
- `GET /api/work-items/:id/activity`

## Known limitations
- Not a hardened production service. Before production add structured logging/monitoring, an audit-log retention policy, password reset, email verification, a user deactivation UI and CSRF-aware session handling.
- Bearer JWTs are kept in `localStorage` for demo simplicity; production should prefer secure, HttpOnly cookies.
- Work-item writes and their activity records are separate writes, not a transaction (see ENGINEERING_DECISIONS.md).
- Offset pagination and regex substring search are simple but degrade on very large collections; cursor pagination and Atlas Search are the next steps.
- Notifications, background jobs and real-time updates are intentionally out of scope.
