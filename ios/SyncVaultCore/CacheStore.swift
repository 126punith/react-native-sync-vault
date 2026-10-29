import Foundation

/// Response cache with TTL, tag/prefix invalidation and LRU eviction. Runs on SQLiteDatabase.queue.
final class CacheStore {
  private let db: SQLiteDatabase

  init(db: SQLiteDatabase) {
    self.db = db
  }

  private func escapeLike(_ s: String) -> String {
    s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "%", with: "\\%").replacingOccurrences(of: "_", with: "\\_")
  }

  func get(key: String, now: Double) throws -> [String: Any]? {
    guard let row = try db.query("SELECT key, value, tags, expires_at, created_at FROM cache WHERE key = ?", [key]).first else { return nil }
    let expiresAt = Double((row["expires_at"] as? Int64) ?? 0)
    if expiresAt > 0 && expiresAt < now {
      try db.execute("DELETE FROM cache WHERE key = ?", [key])
      return nil
    }
    try db.execute("UPDATE cache SET last_accessed_at = ? WHERE key = ?", [now, key])
    let tags = ((row["tags"] as? String) ?? "").split(separator: ",").map(String.init)
    return [
      "key": key,
      "value": row["value"] as? String ?? "",
      "tags": tags,
      "expiresAt": expiresAt,
      "createdAt": Double((row["created_at"] as? Int64) ?? 0),
    ]
  }

  func set(key: String, value: String, ttlMs: Double, tags: [String], now: Double) throws {
    try db.execute(
      "INSERT OR REPLACE INTO cache (key, value, tags, expires_at, size, created_at, last_accessed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [key, value, tags.isEmpty ? "" : ",\(tags.joined(separator: ",")),", ttlMs > 0 ? now + ttlMs : 0, value.utf8.count, now, now]
    )
  }

  func delete(key: String) throws {
    try db.execute("DELETE FROM cache WHERE key = ?", [key])
  }

  func invalidate(prefix: String?, tags: [String]) throws -> Int {
    var removed = 0
    if let prefix {
      removed += try db.execute("DELETE FROM cache WHERE key LIKE ? ESCAPE '\\'", [escapeLike(prefix) + "%"])
    }
    for tag in tags {
      removed += try db.execute("DELETE FROM cache WHERE tags LIKE ? ESCAPE '\\'", ["%," + escapeLike(tag) + ",%"])
    }
    return removed
  }

  func clear() throws {
    try db.execute("DELETE FROM cache")
  }

  func stats() throws -> (entries: Int, sizeBytes: Double) {
    let row = try db.query("SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS total FROM cache").first ?? [:]
    return (Int((row["n"] as? Int64) ?? 0), Double((row["total"] as? Int64) ?? 0))
  }

  func evict(maxBytes: Double, now: Double) throws -> Int {
    var removed = try db.execute("DELETE FROM cache WHERE expires_at > 0 AND expires_at < ?", [now])
    var total = try stats().sizeBytes
    guard total > maxBytes else { return removed }
    for row in try db.query("SELECT key, size FROM cache ORDER BY last_accessed_at ASC") {
      guard total > maxBytes else { break }
      try db.execute("DELETE FROM cache WHERE key = ?", [row["key"] as? String ?? ""])
      total -= Double((row["size"] as? Int64) ?? 0)
      removed += 1
    }
    return removed
  }
}
