import Foundation

enum Status {
  static let pending = "pending"
  static let inflight = "inflight"
  static let succeeded = "succeeded"
  static let conflict = "conflict"
  static let deadLetter = "dead_letter"
}

struct VaultConfig {
  var baseUrl = ""
  var maxConcurrency = 4
  var requestTimeoutMs = 30_000
  var leaseMs = 120_000
  var defaultMaxAttempts = 8
  var retryBaseDelayMs = 1_000
  var retryMaxDelayMs = 300_000
  var encryptPayloads = true
  var wifiOnly = false
  var requiresCharging = false
  var minBatteryLevel = 0.0
  var backgroundIntervalMinutes = 15
  var largePayloadThresholdBytes = 512 * 1024
  var notificationTitle = "Syncing changes"

  /// A lease must outlive the request timeout, or a slow request could be sent twice.
  var effectiveLeaseMs: Double { Double(max(leaseMs, requestTimeoutMs * 2 + 10_000)) }

  init() {}

  init(dictionary d: [String: Any]) {
    let base = VaultConfig()
    func int(_ k: String, _ fallback: Int) -> Int { (d[k] as? NSNumber)?.intValue ?? fallback }
    func bool(_ k: String, _ fallback: Bool) -> Bool { (d[k] as? NSNumber)?.boolValue ?? fallback }
    baseUrl = d["baseUrl"] as? String ?? base.baseUrl
    maxConcurrency = int("maxConcurrency", base.maxConcurrency)
    requestTimeoutMs = int("requestTimeoutMs", base.requestTimeoutMs)
    leaseMs = int("leaseMs", base.leaseMs)
    defaultMaxAttempts = int("defaultMaxAttempts", base.defaultMaxAttempts)
    retryBaseDelayMs = int("retryBaseDelayMs", base.retryBaseDelayMs)
    retryMaxDelayMs = int("retryMaxDelayMs", base.retryMaxDelayMs)
    encryptPayloads = bool("encryptPayloads", base.encryptPayloads)
    wifiOnly = bool("wifiOnly", base.wifiOnly)
    requiresCharging = bool("requiresCharging", base.requiresCharging)
    minBatteryLevel = (d["minBatteryLevel"] as? NSNumber)?.doubleValue ?? base.minBatteryLevel
    backgroundIntervalMinutes = int("backgroundIntervalMinutes", base.backgroundIntervalMinutes)
    largePayloadThresholdBytes = int("largePayloadThresholdBytes", base.largePayloadThresholdBytes)
    notificationTitle = d["notificationTitle"] as? String ?? base.notificationTitle
  }

  var dictionary: [String: Any] {
    [
      "baseUrl": baseUrl, "maxConcurrency": maxConcurrency, "requestTimeoutMs": requestTimeoutMs,
      "leaseMs": leaseMs, "defaultMaxAttempts": defaultMaxAttempts, "retryBaseDelayMs": retryBaseDelayMs,
      "retryMaxDelayMs": retryMaxDelayMs, "encryptPayloads": encryptPayloads, "wifiOnly": wifiOnly,
      "requiresCharging": requiresCharging, "minBatteryLevel": minBatteryLevel,
      "backgroundIntervalMinutes": backgroundIntervalMinutes,
      "largePayloadThresholdBytes": largePayloadThresholdBytes, "notificationTitle": notificationTitle,
    ]
  }
}

struct EnqueueInput {
  var method: String
  var url: String
  var headers: [String: String]
  var body: String?
  var contentType: String?
  var idempotencyKey: String?
  var queueKey: String?
  var dedupeKey: String?
  var ifMatch: String?
  var priority: Int
  var maxAttempts: Int
  var conflictStrategy: String
  var metadata: String?
}

struct OutboxRow {
  let seq: Int64
  let id: String
  let idempotencyKey: String
  let queueKey: String?
  let dedupeKey: String?
  let method: String
  let url: String
  let queryParams: String?
  let headers: [String: String]
  let body: String?
  let payloadRef: String?
  let contentType: String?
  let ifMatch: String?
  var status: String
  let priority: Int
  var attempt: Int
  let maxAttempts: Int
  let nextAttemptAt: Double
  let authBlocked: Bool
  let conflictStrategy: String
  let lastError: String?
  let lastHttpStatus: Int
  let serverResponse: String?
  let serverVersion: String?
  let metadata: String?
  let createdAt: Double
  let updatedAt: Double
  let completedAt: Double
}

func jsonString(_ map: [String: String]) -> String {
  guard let data = try? JSONSerialization.data(withJSONObject: map), let s = String(data: data, encoding: .utf8) else { return "{}" }
  return s
}

func stringMap(_ json: String?) -> [String: String] {
  guard let json, let data = json.data(using: .utf8),
        let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
  var out: [String: String] = [:]
  for (k, v) in object { out[k] = (v as? String) ?? "\(v)" }
  return out
}

/// All outbox state transitions. Every method must run on SQLiteDatabase.queue.
final class OutboxStore {
  static let maxStoredResponse = 64 * 1024

  private let db: SQLiteDatabase
  private let crypto: PayloadCrypto
  private let payloadDir: URL

  init(db: SQLiteDatabase, crypto: PayloadCrypto, payloadDir: URL) {
    self.db = db
    self.crypto = crypto
    self.payloadDir = payloadDir
  }

  private func truncate(_ s: String?) -> String? {
    guard let s, s.utf8.count > Self.maxStoredResponse else { return s }
    return String(s.prefix(Self.maxStoredResponse))
  }

  func payloadURL(_ id: String) -> URL { payloadDir.appendingPathComponent("\(id).body") }

  private func deletePayloadFile(_ id: String) {
    try? FileManager.default.removeItem(at: payloadURL(id))
  }

  /// Large bodies go to a file so a background URLSession can upload them after suspension.
  private func storeBody(id: String, body: String?, config: VaultConfig) throws -> (String?, String?) {
    guard let body else { return (nil, nil) }
    let data = Data(body.utf8)
    if data.count > config.largePayloadThresholdBytes {
      try FileManager.default.createDirectory(at: payloadDir, withIntermediateDirectories: true)
      let url = payloadURL(id)
      try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
      return (nil, url.path)
    }
    return (config.encryptPayloads ? crypto.encrypt(body) : body, nil)
  }

  func enqueue(_ input: EnqueueInput, config: VaultConfig, now: Double) throws -> (id: String, coalesced: Bool) {
    try db.transaction {
      let headersJson = jsonString(input.headers)
      let storedHeaders = config.encryptPayloads ? (crypto.encrypt(headersJson) ?? headersJson) : headersJson
      let maxAttempts = input.maxAttempts > 0 ? input.maxAttempts : config.defaultMaxAttempts

      if let dedupeKey = input.dedupeKey,
         let existing = try db.query(
           "SELECT id, status, (attempt > 0 OR last_http_status != 0 OR last_error IS NOT NULL) AS ever_sent FROM outbox " +
             "WHERE dedupe_key = ? AND status IN ('pending', 'inflight', 'conflict') ORDER BY seq DESC LIMIT 1", [dedupeKey]).first,
         // Only the newest unfinished row may absorb the change; anything older would be delivered first.
         existing["status"] as? String == Status.pending,
         let id = existing["id"] as? String {
        // Refunded attempts (offline, 401) may still have reached the server, so "ever sent" is
        // derived from the last result rather than the attempt counter.
        let everSent = ((existing["ever_sent"] as? Int64) ?? 0) == 1
        deletePayloadFile(id)
        let (body, ref) = try storeBody(id: id, body: input.body, config: config)
        var sql = "UPDATE outbox SET method = ?, url = ?, headers = ?, body = ?, payload_ref = ?, content_type = ?, if_match = ?, " +
          "priority = ?, max_attempts = ?, conflict_strategy = ?, metadata = ?, attempt = 0, next_attempt_at = 0, updated_at = ?"
        var params: [Any?] = [input.method.uppercased(), input.url, storedHeaders, body, ref, input.contentType, input.ifMatch,
                              input.priority, maxAttempts, input.conflictStrategy, input.metadata, now]
        if everSent {
          // The server may already hold the old body under the old key; a new body needs a new key.
          sql += ", idempotency_key = ?"
          params.append(input.idempotencyKey ?? UUIDv7.generate())
        }
        sql += " WHERE id = ?"
        params.append(id)
        try db.execute(sql, params)
        return (id, true)
      }

      let id = UUIDv7.generate()
      let (body, ref) = try storeBody(id: id, body: input.body, config: config)
      try db.execute(
        """
        INSERT INTO outbox (id, idempotency_key, queue_key, dedupe_key, method, url, headers, body, payload_ref, content_type,
          if_match, status, priority, attempt, max_attempts, next_attempt_at, auth_blocked, conflict_strategy, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?, 0, 0, ?, ?, ?, ?)
        """,
        [id, input.idempotencyKey ?? id, input.queueKey, input.dedupeKey, input.method.uppercased(), input.url, storedHeaders,
         body, ref, input.contentType, input.ifMatch, input.priority, maxAttempts, input.conflictStrategy, input.metadata, now, now]
      )
      return (id, false)
    }
  }

  /// excludingIds keeps rows owned by a still-running background URLSession task.
  /// An interrupted attempt still counts, so rows that already used their whole budget are
  /// dead-lettered instead of being sent again (this also stops a crash-looping request).
  @discardableResult
  func recoverExpiredLeases(leaseCutoff: Double, now: Double = Date().timeIntervalSince1970 * 1000, excludingIds: Set<String> = []) throws -> Int {
    let rows = try db.query(
      "SELECT id, attempt, max_attempts FROM outbox WHERE status = 'inflight' AND (lease_until IS NULL OR lease_until < ?)",
      [leaseCutoff]
    )
    var recovered = 0
    for row in rows {
      guard let id = row["id"] as? String, !excludingIds.contains(id) else { continue }
      let attempt = (row["attempt"] as? Int64) ?? 0
      let maxAttempts = (row["max_attempts"] as? Int64) ?? 1
      if attempt >= maxAttempts {
        recovered += try db.execute(
          "UPDATE outbox SET status = 'dead_letter', lease_until = NULL, last_error = 'interrupted during the last allowed attempt', completed_at = ?, updated_at = ? WHERE id = ? AND status = 'inflight'",
          [now, now, id]
        )
      } else {
        recovered += try db.execute("UPDATE outbox SET status = 'pending', lease_until = NULL, updated_at = ? WHERE id = ? AND status = 'inflight'", [now, id])
      }
    }
    return recovered
  }

  private static let eligible = """
    o.status = 'pending' AND o.auth_blocked = 0
    AND (o.queue_key IS NULL OR NOT EXISTS (
      SELECT 1 FROM outbox p
      WHERE p.queue_key = o.queue_key AND p.seq < o.seq
        AND p.status IN ('pending', 'inflight', 'conflict')))
    AND (o.dedupe_key IS NULL OR NOT EXISTS (
      SELECT 1 FROM outbox p
      WHERE p.dedupe_key = o.dedupe_key AND p.seq < o.seq
        AND p.status IN ('pending', 'inflight', 'conflict')))
    """

  /// Within a queue_key (and a dedupe_key) only the oldest unfinished request is eligible: FIFO per
  /// key, parallel across keys. Ordering dedupe_key rows stops a retried older body overwriting a newer one.
  func claimBatch(now: Double, limit: Int, leaseMs: Double) throws -> [OutboxRow] {
    try db.transaction {
      let rows = try db.query(
        "SELECT o.* FROM outbox o WHERE \(Self.eligible) AND o.next_attempt_at <= ? ORDER BY o.priority DESC, o.seq ASC LIMIT ?",
        [now, limit]
      ).map(readRow)
      return try rows.compactMap { row in
        let changed = try db.execute(
          "UPDATE outbox SET status = 'inflight', attempt = attempt + 1, lease_until = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
          [now + leaseMs, now, row.id]
        )
        guard changed == 1 else { return nil }
        var claimed = row
        claimed.status = Status.inflight
        claimed.attempt += 1
        return claimed
      }
    }
  }

  func extendLease(id: String, until: Double) throws {
    try db.execute("UPDATE outbox SET lease_until = ? WHERE id = ? AND status = 'inflight'", [until, id])
  }

  func markSucceeded(id: String, httpStatus: Int, response: String?, version: String?, now: Double) throws {
    try db.execute(
      "UPDATE outbox SET status = 'succeeded', lease_until = NULL, last_http_status = ?, server_response = ?, server_version = ?, " +
        "last_error = NULL, completed_at = ?, updated_at = ? WHERE id = ?",
      [httpStatus, truncate(response), version, now, now, id]
    )
    deletePayloadFile(id)
  }

  func markRetry(id: String, nextAttemptAt: Double, httpStatus: Int, error: String?, now: Double, refundAttempt: Bool) throws {
    try db.execute(
      "UPDATE outbox SET status = 'pending', lease_until = NULL, next_attempt_at = ?, last_http_status = ?, last_error = ?, " +
        "updated_at = ?, attempt = attempt - ? WHERE id = ?",
      [nextAttemptAt, httpStatus, error, now, refundAttempt ? 1 : 0, id]
    )
  }

  func markDeadLetter(id: String, httpStatus: Int, error: String?, response: String?, now: Double) throws {
    try db.execute(
      "UPDATE outbox SET status = 'dead_letter', lease_until = NULL, last_http_status = ?, last_error = ?, server_response = ?, " +
        "completed_at = ?, updated_at = ? WHERE id = ?",
      [httpStatus, error, truncate(response), now, now, id]
    )
  }

  func markConflict(id: String, httpStatus: Int, serverBody: String?, version: String?, now: Double) throws {
    try db.execute(
      "UPDATE outbox SET status = 'conflict', lease_until = NULL, last_http_status = ?, server_response = ?, server_version = ?, " +
        "updated_at = ? WHERE id = ?",
      [httpStatus, truncate(serverBody), version, now, id]
    )
  }

  func requeueWithVersion(id: String, version: String, now: Double) throws {
    try db.execute(
      "UPDATE outbox SET status = 'pending', lease_until = NULL, if_match = ?, next_attempt_at = 0, updated_at = ? WHERE id = ?",
      [version, now, id]
    )
  }

  /// 401: park without burning an attempt until fresh auth headers arrive.
  func markAuthBlocked(id: String, httpStatus: Int, now: Double) throws {
    try db.execute(
      "UPDATE outbox SET status = 'pending', lease_until = NULL, auth_blocked = 1, last_http_status = ?, " +
        "last_error = 'unauthorized', attempt = MAX(attempt - 1, 0), updated_at = ? WHERE id = ?",
      [httpStatus, now, id]
    )
  }

  @discardableResult
  func clearAuthBlocked(now: Double) throws -> Int {
    try db.execute("UPDATE outbox SET auth_blocked = 0, next_attempt_at = 0, updated_at = ? WHERE auth_blocked = 1", [now])
  }

  func resolveConflict(id: String, payload: String?, version: String?, config: VaultConfig, now: Double) throws -> Bool {
    try db.transaction {
      guard let payload else { return try delete(id: id) }
      deletePayloadFile(id)
      return try db.execute(
        "UPDATE outbox SET status = 'pending', body = ?, payload_ref = NULL, if_match = ?, attempt = 0, next_attempt_at = 0, " +
          "idempotency_key = ?, updated_at = ? WHERE id = ? AND status = 'conflict'",
        [config.encryptPayloads ? crypto.encrypt(payload) : payload, version, UUIDv7.generate(), now, id]
      ) == 1
    }
  }

  func retry(id: String, now: Double) throws -> Bool {
    try db.execute(
      "UPDATE outbox SET status = 'pending', attempt = 0, next_attempt_at = 0, auth_blocked = 0, completed_at = 0, updated_at = ? " +
        "WHERE id = ? AND status IN ('dead_letter', 'conflict')",
      [now, id]
    ) == 1
  }

  func retryAllDeadLetters(now: Double) throws -> Int {
    try db.execute(
      "UPDATE outbox SET status = 'pending', attempt = 0, next_attempt_at = 0, completed_at = 0, updated_at = ? WHERE status = 'dead_letter'",
      [now]
    )
  }

  @discardableResult
  func delete(id: String, allowInflight: Bool = false) throws -> Bool {
    let sql = allowInflight ? "DELETE FROM outbox WHERE id = ?" : "DELETE FROM outbox WHERE id = ? AND status != 'inflight'"
    let deleted = try db.execute(sql, [id]) == 1
    if deleted { deletePayloadFile(id) }
    return deleted
  }

  func purgeSucceeded(olderThan: Double) throws -> Int {
    try db.execute("DELETE FROM outbox WHERE status = 'succeeded' AND completed_at < ?", [olderThan])
  }

  func get(id: String) throws -> OutboxRow? {
    try db.query("SELECT * FROM outbox WHERE id = ?", [id]).first.map(readRow)
  }

  func query(statuses: [String], queueKey: String?, limit: Int, offset: Int) throws -> [OutboxRow] {
    var sql = "SELECT * FROM outbox WHERE 1 = 1"
    var params: [Any?] = []
    if !statuses.isEmpty {
      sql += " AND status IN (\(statuses.map { _ in "?" }.joined(separator: ",")))"
      params.append(contentsOf: statuses)
    }
    if let queueKey {
      sql += " AND queue_key = ?"
      params.append(queueKey)
    }
    sql += " ORDER BY priority DESC, seq ASC LIMIT ? OFFSET ?"
    params.append(max(limit, 1))
    params.append(max(offset, 0))
    return try db.query(sql, params).map(readRow)
  }

  func counts() throws -> [String: Int] {
    let row = try db.query(
      """
      SELECT
        COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
        COALESCE(SUM(CASE WHEN status = 'inflight' THEN 1 ELSE 0 END), 0) AS inflight,
        COALESCE(SUM(CASE WHEN status = 'conflict' THEN 1 ELSE 0 END), 0) AS conflict,
        COALESCE(SUM(CASE WHEN status = 'dead_letter' THEN 1 ELSE 0 END), 0) AS deadLetter,
        COALESCE(SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END), 0) AS succeeded,
        COALESCE(SUM(CASE WHEN status = 'pending' AND auth_blocked = 1 THEN 1 ELSE 0 END), 0) AS authBlocked
      FROM outbox
      """
    ).first ?? [:]
    var out: [String: Int] = [:]
    for key in ["pending", "inflight", "conflict", "deadLetter", "succeeded", "authBlocked"] {
      out[key] = Int((row[key] as? Int64) ?? 0)
    }
    return out
  }

  /// Earliest time an eligible request becomes ready; rows blocked behind their queue head are excluded.
  func nextWakeAt() throws -> Double? {
    let row = try db.query("SELECT MIN(o.next_attempt_at) AS next FROM outbox o WHERE \(Self.eligible)").first
    if let v = row?["next"] as? Int64 { return Double(v) }
    if let v = row?["next"] as? Double { return v }
    return nil
  }

  func hasPending() throws -> Bool {
    try !db.query("SELECT 1 FROM outbox WHERE status = 'pending' LIMIT 1").isEmpty
  }

  func readBody(_ row: OutboxRow) throws -> String? {
    try crypto.decrypt(row.body)
  }

  private func readRow(_ r: [String: Any]) -> OutboxRow {
    func s(_ k: String) -> String? { r[k] as? String }
    func i(_ k: String) -> Int { Int((r[k] as? Int64) ?? 0) }
    func d(_ k: String) -> Double {
      if let v = r[k] as? Int64 { return Double(v) }
      return (r[k] as? Double) ?? 0
    }
    let headers = (try? crypto.decrypt(s("headers"))).flatMap { stringMap($0) } ?? [:]
    return OutboxRow(
      seq: (r["seq"] as? Int64) ?? 0, id: s("id") ?? "", idempotencyKey: s("idempotency_key") ?? "",
      queueKey: s("queue_key"), dedupeKey: s("dedupe_key"), method: s("method") ?? "GET", url: s("url") ?? "",
      queryParams: s("query_params"), headers: headers, body: s("body"), payloadRef: s("payload_ref"),
      contentType: s("content_type"), ifMatch: s("if_match"), status: s("status") ?? Status.pending,
      priority: i("priority"), attempt: i("attempt"), maxAttempts: i("max_attempts"), nextAttemptAt: d("next_attempt_at"),
      authBlocked: i("auth_blocked") == 1, conflictStrategy: s("conflict_strategy") ?? "manual", lastError: s("last_error"),
      lastHttpStatus: i("last_http_status"), serverResponse: s("server_response"), serverVersion: s("server_version"),
      metadata: s("metadata"), createdAt: d("created_at"), updatedAt: d("updated_at"), completedAt: d("completed_at")
    )
  }
}
