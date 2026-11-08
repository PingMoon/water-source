/**
 * migrations.js —— DDL 与版本化迁移
 *
 * 规则：
 *   - 每个迁移一个事务，失败整体回滚；
 *   - 版本记在 PRAGMA user_version，不用额外表（M0 只有一个版本，不值得加表）；
 *   - 已发布的迁移不许改，只能追加新的。
 *
 * DDL 依据 BLUEPRINT-M0-v1 §3。content 的 8192 是**物理上限**（防打爆），
 * 不是设计预算——token 预算在派生层管，两个数不许互相冒充。
 */

import { StoreError } from '../util/errors.js'

export const SCHEMA_VERSION = 3

const M1 = `
CREATE TABLE IF NOT EXISTS event (
  id        TEXT PRIMARY KEY,
  schema_v  INTEGER NOT NULL DEFAULT 1,
  ts        TEXT NOT NULL,
  type      TEXT NOT NULL,
  source    TEXT NOT NULL DEFAULT 'system',
  person    TEXT NOT NULL DEFAULT 'third',
  content   TEXT NOT NULL CHECK (length(CAST(content AS BLOB)) <= 8192),
  refs_json TEXT NOT NULL DEFAULT '[]',
  meta_json TEXT NOT NULL DEFAULT '{}'
) STRICT;

CREATE INDEX IF NOT EXISTS event_ts ON event(ts);
CREATE INDEX IF NOT EXISTS event_type ON event(type);

CREATE TRIGGER IF NOT EXISTS event_no_update
BEFORE UPDATE ON event
BEGIN SELECT RAISE(ABORT, 'event is append-only'); END;

CREATE TRIGGER IF NOT EXISTS event_no_delete
BEFORE DELETE ON event
BEGIN SELECT RAISE(ABORT, 'event is append-only'); END;

CREATE TABLE IF NOT EXISTS event_tombstone (
  event_id TEXT PRIMARY KEY,
  reason   TEXT NOT NULL,
  at       TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS consolidate_run (
  id          TEXT PRIMARY KEY,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  status      TEXT NOT NULL CHECK (status IN ('running','done','failed')),
  stats_json  TEXT NOT NULL DEFAULT '{}'
) STRICT;
`

const M2 = `
CREATE TABLE IF NOT EXISTS thread (
  key        TEXT PRIMARY KEY,
  room       TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  last_at    TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS thread_room ON thread(room, last_at);

-- 被 Eval 丢弃的消息：必须可见、可推翻
CREATE TABLE IF NOT EXISTS eval_drop (
  id         TEXT PRIMARY KEY,
  thread_key TEXT,
  text       TEXT NOT NULL,
  rule       TEXT NOT NULL,
  reason     TEXT NOT NULL,
  at         TEXT NOT NULL,
  overturned INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE INDEX IF NOT EXISTS eval_drop_at ON eval_drop(at);
`

const M3 = `
-- skill 被用过的记录：晋升的依据，也是「她到底会不会用」的证据
CREATE TABLE IF NOT EXISTS skill_use (
  id       TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  task     TEXT NOT NULL,
  outcome  TEXT NOT NULL DEFAULT 'unknown',
  at       TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS skill_use_id ON skill_use(skill_id, at);
`

/** 迁移表：版本 -> SQL */
const MIGRATIONS = [
  { version: 1, sql: M1 },
  { version: 2, sql: M2 },
  { version: 3, sql: M3 }
]

export function currentVersion(db) {
  const row = db.prepare('PRAGMA user_version').get()
  return Number(row?.user_version ?? 0)
}

/**
 * 把库迁到 SCHEMA_VERSION。
 * @returns {{ from:number, to:number, applied:number[] }}
 */
export function migrate(db) {
  const from = currentVersion(db)
  if (from > SCHEMA_VERSION) {
    throw new StoreError(
      '数据库版本比代码新：库 v' + from + '，代码 v' + SCHEMA_VERSION + '。拒绝降级运行，避免静默丢字段。'
    )
  }
  const applied = []
  for (const m of MIGRATIONS) {
    if (m.version <= from) continue
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(m.sql)
      db.exec('PRAGMA user_version = ' + Number(m.version))
      db.exec('COMMIT')
      applied.push(m.version)
    } catch (err) {
      try { db.exec('ROLLBACK') } catch { /* ignore */ }
      throw new StoreError('迁移 v' + m.version + ' 失败：' + (err?.message ?? err))
    }
  }
  return { from, to: currentVersion(db), applied }
}
