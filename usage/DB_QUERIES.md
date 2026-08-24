# DB Query Reference

## Paths

| Environment | DB path |
|-------------|---------|
| Product | `src/db/voting.db` |
| Demo | `src/db/voting_demo.db` |

All examples below use the Product path; substitute `voting_demo.db` for Demo.

Optional aliases:

```bash
alias db-prod="sqlite3 src/db/voting.db"
alias db-demo="sqlite3 src/db/voting_demo.db"
```

---

## 1. Basic queries

```bash
sqlite3 src/db/voting.db ".tables"                              # table list
sqlite3 src/db/voting.db "SELECT * FROM active_votes;"          # active votes
sqlite3 src/db/voting.db "SELECT * FROM snapshot;"              # voter list
sqlite3 src/db/voting.db "SELECT * FROM leaf_data;"             # leaves + merkle paths
sqlite3 src/db/voting.db "SELECT * FROM root_history;"          # root history
sqlite3 src/db/voting.db "SELECT * FROM used_nullifiers;"       # used nullifiers
sqlite3 src/db/voting.db "SELECT * FROM permits;"               # encrypted votes
```

---

## 2. Per-voteId queries

Replace `1` with the voteId you want:

```bash
sqlite3 src/db/voting.db "SELECT * FROM snapshot WHERE voteId = 1;"
sqlite3 src/db/voting.db "SELECT * FROM leaf_data WHERE voteId = 1;"
sqlite3 src/db/voting.db "SELECT * FROM root_history WHERE voteId = 1;"
sqlite3 src/db/voting.db "SELECT * FROM used_nullifiers WHERE voteId = 1;"
sqlite3 src/db/voting.db "SELECT * FROM permits WHERE voteId = 1;"
```

---

## 3. Aggregate queries

```bash
# open vote count
sqlite3 src/db/voting.db "SELECT COUNT(*) FROM active_votes WHERE closedAt IS NULL;"

# voters for a voteId
sqlite3 src/db/voting.db "SELECT COUNT(*) FROM snapshot WHERE voteId = 1;"

# submitted votes (permits) for a voteId
sqlite3 src/db/voting.db "SELECT COUNT(*) FROM permits WHERE voteId = 1;"

# total weight for a voteId
sqlite3 src/db/voting.db "SELECT SUM(weight) FROM snapshot WHERE voteId = 1;"

# per-voteId summary (voters, total weight)
sqlite3 src/db/voting.db "SELECT voteId, COUNT(*) as voters, SUM(weight) as totalWeight FROM snapshot GROUP BY voteId;"

# per-voteId permit count
sqlite3 src/db/voting.db "SELECT voteId, COUNT(*) as permits FROM permits GROUP BY voteId;"
```

### Leaf registrations vs snapshot size (registration-cap check)

```bash
sqlite3 src/db/voting.db "
WITH vote_ids AS (
  SELECT voteId FROM snapshot
  UNION
  SELECT voteId FROM leaf_data
),
snapshot_cnt AS (
  SELECT voteId, COUNT(*) AS snapshot_voters
  FROM snapshot
  GROUP BY voteId
),
leaf_cnt AS (
  SELECT voteId, COUNT(*) AS leaf_registered
  FROM leaf_data
  GROUP BY voteId
)
SELECT
  v.voteId,
  COALESCE(s.snapshot_voters, 0) AS snapshot_voters,
  COALESCE(l.leaf_registered, 0) AS leaf_registered,
  CASE
    WHEN COALESCE(l.leaf_registered, 0) <= COALESCE(s.snapshot_voters, 0) THEN 'OK'
    ELSE 'OVER'
  END AS cap_status
FROM vote_ids v
LEFT JOIN snapshot_cnt s ON v.voteId = s.voteId
LEFT JOIN leaf_cnt l ON v.voteId = l.voteId
ORDER BY v.voteId;
"
```

---

## 4. Combined overview

```bash
sqlite3 src/db/voting.db "
SELECT '=== active_votes ===' as '';
SELECT * FROM active_votes;
SELECT '';
SELECT '=== snapshot (per voteId) ===' as '';
SELECT voteId, COUNT(*) as voters, SUM(weight) as totalWeight FROM snapshot GROUP BY voteId;
SELECT '';
SELECT '=== permits (per voteId) ===' as '';
SELECT voteId, COUNT(*) as permits FROM permits GROUP BY voteId;
"
```

---

## 5. File logs (not SQL)

Append-only JSONL logs written by the server:

```bash
# Product
tail -n 20 recovery_logs/submit_vote_recovery_product.jsonl
tail -n 20 recovery_logs/leaf_audit_product.jsonl

# Demo
tail -n 20 recovery_logs/submit_vote_recovery_demo.jsonl
tail -n 20 recovery_logs/leaf_audit_demo.jsonl
```
