// Schema additions of the Zenelo fork. Kept out of the numbered MIGRATIONS
// (schema.js) on purpose: those numbers are upstream's, and a fork-side
// version would collide with the next one upstream ships. Each step here is
// idempotent and runs on every boot, after the migrations.
//
//   user_metadata.liked_at  when the track was liked (rating went from none
//                           to > 0), ISO-8601 UTC; NULL for likes from before
//                           this column, and cleared with the like.

export function ensureForkSchema(db) {
  const cols = db.prepare('PRAGMA table_info(user_metadata)').all().map((c) => c.name);
  if (!cols.includes('liked_at')) {
    db.exec('ALTER TABLE user_metadata ADD COLUMN liked_at TEXT');
  }
}
