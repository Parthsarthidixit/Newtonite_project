# Engineering Decisions

## 1. MERN stack and REST API
React/Vite and Express/Mongoose allow fast delivery with one primary language across the stack. REST endpoints keep the frontend/backend boundary explicit and are easy to test. Trade-off: a single API service is less independently scalable than service-oriented architecture, but is appropriate for a one-day MVP.

## 2. Resource-level authorization on the server
The server checks authentication, role, and team membership before allowing protected operations. UI controls are not treated as a security boundary. Admins can manage all work items; members can read work items in their teams and update items they created or are assigned to. Managers can update and comment on any item in their teams and are the only non-admin role that can assign work. Trade-off: the policy is intentionally compact and would need finer-grained permissions for a larger organization.

## 3. Optimistic concurrency with a version field
Each work item has an integer `version`. Updates include the version last seen by the client and the database update matches both `_id` and `version`, incrementing the version atomically. If another update wins first, the second receives `409 Conflict`. This avoids silent lost updates without distributed locks. Trade-off: clients must refresh and reconcile conflicts.

## 4. Activity history stored separately
Important work-item actions append immutable activity documents, which can be paginated independently from the main work item. This keeps the work item document small as history grows. Trade-off: the work-item update and activity insert are separate writes in this MVP; production-grade guaranteed atomicity would use a MongoDB transaction or an outbox pattern on a replica set.

## 5. Server-side pagination, validated filters and substring search
The API uses `limit`, `page`, search, and filters, with indexes on common fields. It does not load the full collection into the browser. All query parameters are validated with zod before they reach MongoDB, so operator-injection payloads are rejected. Search is a case-insensitive, regex-escaped substring match on title and description, because users expect "pay" to find "payment" (a MongoDB `$text` index only matches whole words). Trade-off: offset pagination and unanchored regex search are simple but degrade on very large collections; cursor pagination and Atlas Search are the future improvements.

## 6. Idempotency by claiming the key first
A check-then-insert approach lets two simultaneous retries both create an item. Instead the `(userId, Idempotency-Key)` pair is inserted first under a unique index; only the request that wins the insert creates the item, and the others receive the stored response (or `409` while it is still in flight). If creation fails, the claim is released so the client can retry. Records expire after 24 hours (TTL index).

## 7. Comments do not use the version check
Comments are append-only and applied with an atomic `$push`, so there is no lost-update risk to protect against. Bumping `version` on every comment would make unrelated edits fail with `409`, so comments leave the version unchanged; the activity log still records them.

## 8. Admin console instead of database edits
Teams, roles and memberships are managed through admin-only endpoints and an Administration screen. Public registration can only create `member` accounts, an admin cannot change their own role (preventing accidental lock-out), and the UI refreshes the signed-in user from `/api/auth/me` so permission changes take effect without re-login.

## Intentionally not built
Email/push notifications, background workers, real-time updates, password recovery, SSO, per-team permission policies, and a complex approval designer were excluded to protect core reliability within the one-day time budget.
