# MSL Trading Journal V10 Premium — Firestore Security Specification

## 1. Data Invariants
1. **Verified Owner Isolation**: Every path under `/users/{userId}` requires `request.auth != null`, `request.auth.token.email_verified == true`, and `request.auth.uid == userId`. No user can ever read, list, create, update, or delete another user's workspace or subcollections.
2. **No Workspace Enumeration**: `list` on `/users` is explicitly denied (`allow list: if false;`) to prevent account enumeration.
3. **Master Gate Integrity**: All subcollections (`journals`, `trades`, `tradeImages`, `models`, `customFields`, `alarms`, `aiMemories`) require the parent `/users/{userId}` document to exist on single-document reads/creates (`exists(...)`), and enforce `userId == request.auth.uid` on every document and query (`allow list` uses `resource.data.userId == request.auth.uid` without `get()`/`exists()`).
4. **Trade Image Referential Integrity**: Every `tradeImages/{imageId}` document must reference an existing (or same-batch created) parent trade via `existsAfter(/databases/$(database)/documents/users/$(userId)/trades/$(incoming().tradeId))` and must stay under 750,000 bytes (`dataUrl.size() <= 750000`) with a valid `^data:image\/` prefix.
5. **Immutable Identity & Creation Timestamps**: `uid` / `userId` / `id` and `createdAt` can never change after document creation. Both `createdAt` (on create) and `updatedAt` (on create & update) must strictly equal `request.time`.
6. **Strict Schema & Bounded Arrays**: Every write validates exact required and allowed keys (`keys().hasAll(...) && keys().hasOnly(...)`), journal bounds (`(currency == 'R' && startingBalance == 0) || (startingBalance >= 10 && startingBalance <= 1000000000)`, optional `target >= 0 && target <= 1000000000`, `name <= 80`, `propFirm <= 80`, `description <= 400`, `isDeleted is bool`, optional `deletedAt`), optional `journalId` on trades, optional workspace/trade metric unit & currency keys (`pnlUnit`, `riskUnit`, `currency`, `defaultPnlUnit`, `defaultRiskUnit`) plus `'Missed'` outcome, `affectedKeys().hasOnly(...)` on updates, string `.size()` bounds on every string, numeric range bounds (`[-100000000, 100000000]` for P&L and `[0, 100000000]` for risk to accommodate money/point units), bounded lists (`tags.size() <= 15`, `options.size() <= 30`), and bounded map keys (`custom.keys().size() <= 40`).

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unverified Email Bypass**: Authenticated request where `request.auth.token.email_verified == false` writes to `/users/{uid}` -> **PERMISSION_DENIED**.
2. **Cross-Tenant Read/List**: Authenticated user `userB` attempts `get` or `list` on `/users/userA/trades` -> **PERMISSION_DENIED**.
3. **Root Users Collection Listing**: Authenticated user runs `getDocs(collection(db, 'users'))` -> **PERMISSION_DENIED**.
4. **Identity Spoofing in Payload**: User `userA` writes to `/users/userA/trades/t1` with `userId: "userB"` -> **PERMISSION_DENIED**.
5. **Shadow / Ghost Field Injection**: User `userA` creates `/users/userA` with extra field `isAdmin: true` or `role: "admin"` -> **PERMISSION_DENIED**.
6. **Update-Gap Shadow Field**: User `userA` updates `/users/userA/trades/t1` adding an undeclared key `verifiedByServer: true` -> **PERMISSION_DENIED**.
7. **ID Poisoning**: User `userA` writes to `/users/userA/trades/bad$id.with spaces` or a 200-char ID -> **PERMISSION_DENIED**.
8. **Forged Timestamp / Immortal Field Mutation**: User `userA` creates a trade with client-forged `createdAt: "2020-01-01T00:00:00Z"` or updates `createdAt` -> **PERMISSION_DENIED**.
9. **Orphan Trade Image**: User `userA` creates `/users/userA/tradeImages/img1` pointing to a nonexistent `tradeId: "missing-trade"` -> **PERMISSION_DENIED**.
10. **Denial-of-Wallet Oversized String / Payload**: User `userA` sets `notes` > 10,000 chars or `dataUrl` > 750,000 chars or `tags` array > 15 items -> **PERMISSION_DENIED**.
11. **Array Type Poisoning**: User `userA` sets `tags: [123, true]` or `options: [{}]` -> **PERMISSION_DENIED**.
12. **Immutable Ownership Hijack on Update**: User `userA` attempts to update `userId` or `id` on an existing trade or model -> **PERMISSION_DENIED**.
