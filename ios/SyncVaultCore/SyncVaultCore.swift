import Foundation
import UIKit

/// Receives engine events. Implemented by the Turbo Module (RNSyncVault.mm) while JS is alive.
@objc public protocol SyncVaultEventSink: AnyObject {
  func onRequestEvent(_ event: [String: Any])
  func onNetworkChange(_ state: [String: Any])
  func onAuthHeadersNeeded(_ event: [String: Any])
  func onConflict(_ event: [String: Any])
}

/// Process-wide engine, independent of React. BGTaskScheduler and the background URLSession
/// drive it directly when the app was launched in the background without a JS runtime.
@objc(SyncVaultCore)
public final class SyncVaultCore: NSObject {
  @objc public static let shared = SyncVaultCore()

  @objc public weak var eventSink: SyncVaultEventSink?

  private enum Emission {
    case request([String: Any])
    case auth([String: Any])
    case conflict([String: Any])
  }

  private struct HTTPOutcome {
    var status: Int
    var body: String?
    var headers: [String: String]
    var networkError: String?
  }

  private static let succeededRetentionMs = 7.0 * 24 * 60 * 60 * 1000
  private static let minWakeDelayMs = 250.0
  private static let transferLeaseMs = 24.0 * 60 * 60 * 1000

  private let crypto = PayloadCrypto()
  private var database: SQLiteDatabase?
  private var store: OutboxStore?
  private var cacheStore: CacheStore?
  private var initError: Error?

  private let stateLock = NSLock()
  private var configCache: VaultConfig?
  private var authHeadersCache: [String: String]?
  private var session: URLSession?
  private var sessionTimeoutMs = 0
  private var draining = false
  private var drainRequested = false
  private var wakeItem: DispatchWorkItem?
  private var backgroundTaskId: UIBackgroundTaskIdentifier = .invalid

  private lazy var network = NetworkMonitor { [weak self] state, cameOnline in
    guard let self else { return }
    self.eventSink?.onNetworkChange(state.dictionary)
    if cameOnline { self.requestDrain(reason: "network") }
  }

  private lazy var transfer = BackgroundTransfer { [weak self] id, status, body, headers, error in
    self?.handleTransferCompletion(requestId: id, status: status, body: body, headers: headers, error: error)
  }

  private override init() {
    super.init()
    do {
      try openDatabase()
    } catch {
      initError = error
      NSLog("[SyncVault] Failed to open database: \(error)")
    }
    network.start()
    PowerMonitor.start()
    let center = NotificationCenter.default
    center.addObserver(self, selector: #selector(appWillEnterForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
    center.addObserver(self, selector: #selector(appDidEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)

    // A fresh process owns no in-flight work except uploads still running in the background session.
    transfer.activeRequestIds { [weak self] activeIds in
      guard let self else { return }
      Task {
        _ = try? await self.db { db, store in try store.recoverExpiredLeases(leaseCutoff: .greatestFiniteMagnitude, now: Self.nowMs(), excludingIds: activeIds) }
        await self.drain(reason: "startup")
      }
    }
  }

  // MARK: - Setup

  private func openDatabase() throws {
    let fm = FileManager.default
    let support = try fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      .appendingPathComponent("SyncVault", isDirectory: true)
    // Readable by BGTasks while the device is locked (after first unlock).
    try fm.createDirectory(at: support, withIntermediateDirectories: true,
                           attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    // The Keychain key is ThisDeviceOnly, so a restored DB on another device would be undecryptable.
    var excluded = URLResourceValues()
    excluded.isExcludedFromBackup = true
    var dir = support
    try? dir.setResourceValues(excluded)

    let db = try SQLiteDatabase(path: support.appendingPathComponent("sync_vault.db").path)
    try db.queue.sync {
      try migrate(db)
      try importV1IfPresent(db)
    }
    database = db
    store = OutboxStore(db: db, crypto: crypto, payloadDir: support.appendingPathComponent("payloads", isDirectory: true))
    cacheStore = CacheStore(db: db)
  }

  private func schemaBundle() -> Bundle? {
    for candidate in [Bundle(for: SyncVaultCore.self), Bundle.main] {
      if let url = candidate.url(forResource: "SyncVaultSchema", withExtension: "bundle"), let bundle = Bundle(url: url) {
        return bundle
      }
    }
    return nil
  }

  private func migrate(_ db: SQLiteDatabase) throws {
    guard let bundle = schemaBundle() else { throw SQLiteError(message: "SyncVaultSchema.bundle is missing; run pod install") }
    try db.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)")
    let applied = Set(try db.query("SELECT version FROM schema_migrations").compactMap { ($0["version"] as? Int64).map(Int.init) })
    let files = (bundle.urls(forResourcesWithExtension: "sql", subdirectory: nil) ?? []).compactMap { url -> (Int, URL)? in
      let name = url.lastPathComponent
      guard name.count > 4, name[name.index(name.startIndex, offsetBy: 3)] == "_", let version = Int(name.prefix(3)) else { return nil }
      return (version, url)
    }.sorted { $0.0 < $1.0 }
    for (version, url) in files where !applied.contains(version) {
      let sql = try String(contentsOf: url, encoding: .utf8)
      try db.transaction {
        for statement in SQLiteDatabase.splitStatements(sql) { try db.execute(statement) }
        try db.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", [version, Self.nowMs()])
      }
    }
  }

  /// One-time import of unfinished requests from the v1 Documents/offline_queue.db via the shared import_v1.sql.
  private func importV1IfPresent(_ db: SQLiteDatabase) throws {
    let fm = FileManager.default
    let v1 = fm.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("offline_queue.db")
    guard fm.fileExists(atPath: v1.path) else { return }
    guard try db.query("SELECT value FROM kv WHERE key = 'v1_imported'").isEmpty else { return }
    guard let url = schemaBundle()?.url(forResource: "import_v1", withExtension: "sql"),
          let statement = SQLiteDatabase.splitStatements(try String(contentsOf: url, encoding: .utf8)).first else { return }
    do {
      try db.execute("ATTACH DATABASE ? AS v1", [v1.path])
      defer { _ = try? db.execute("DETACH DATABASE v1") }
      let now = Self.nowMs()
      try db.transaction {
        try db.execute(statement, [now])
        try db.execute("INSERT OR REPLACE INTO kv (key, value) VALUES ('v1_imported', ?)", [String(Int64(now))])
      }
    }
    for suffix in ["", "-wal", "-shm"] {
      let source = URL(fileURLWithPath: v1.path + suffix)
      if fm.fileExists(atPath: source.path) {
        try? fm.moveItem(at: source, to: URL(fileURLWithPath: v1.path + ".migrated" + suffix))
      }
    }
  }

  // MARK: - Helpers

  private static func nowMs() -> Double { (Date().timeIntervalSince1970 * 1000).rounded() }

  private func db<T>(_ body: @escaping (SQLiteDatabase, OutboxStore) throws -> T) async throws -> T {
    guard let database, let store else { throw initError ?? SQLiteError(message: "Database unavailable") }
    return try await withCheckedThrowingContinuation { continuation in
      database.queue.async {
        do {
          continuation.resume(returning: try body(database, store))
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }

  private func cacheOp<T>(_ body: @escaping (CacheStore) throws -> T) async throws -> T {
    guard let cacheStore else { throw initError ?? SQLiteError(message: "Database unavailable") }
    return try await db { _, _ in try body(cacheStore) }
  }

  private func kvGet(_ db: SQLiteDatabase, _ key: String) throws -> String? {
    try db.query("SELECT value FROM kv WHERE key = ?", [key]).first?["value"] as? String
  }

  private func withState<T>(_ body: () -> T) -> T {
    stateLock.lock()
    defer { stateLock.unlock() }
    return body()
  }

  private func config() async throws -> VaultConfig {
    if let cached = withState({ configCache }) { return cached }
    let loaded = try await db { db, _ -> VaultConfig in
      guard let json = try self.kvGet(db, "config"), let data = json.data(using: .utf8),
            let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { return VaultConfig() }
      return VaultConfig(dictionary: dict)
    }
    withState { configCache = loaded }
    return loaded
  }

  private func cachedConfig() -> VaultConfig {
    withState { configCache ?? VaultConfig() }
  }

  /// Must run on the DB queue.
  private func authHeadersOnQueue(_ db: SQLiteDatabase) -> [String: String] {
    if let cached = withState({ authHeadersCache }) { return cached }
    let headers = stringMap((try? crypto.decrypt(try? kvGet(db, "auth_headers"))) ?? nil)
    withState { authHeadersCache = headers }
    return headers
  }

  private func urlSession(for cfg: VaultConfig) -> URLSession {
    withState { makeSessionLocked(cfg) }
  }

  private func makeSessionLocked(_ cfg: VaultConfig) -> URLSession {
    if let session, sessionTimeoutMs == cfg.requestTimeoutMs { return session }
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = Double(cfg.requestTimeoutMs) / 1000
    configuration.timeoutIntervalForResource = Double(cfg.requestTimeoutMs) / 1000
    configuration.waitsForConnectivity = false
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    let created = URLSession(configuration: configuration)
    session = created
    sessionTimeoutMs = cfg.requestTimeoutMs
    return created
  }

  private func emit(_ emissions: [Emission]) {
    guard let sink = eventSink else { return }
    for emission in emissions {
      switch emission {
      case .request(let e): sink.onRequestEvent(e)
      case .auth(let e): sink.onAuthHeadersNeeded(e)
      case .conflict(let e): sink.onConflict(e)
      }
    }
  }

  private func requestEvent(_ type: String, id: String? = nil, status: String? = nil, attempt: Int = 0,
                            httpStatus: Int = 0, error: String? = nil, nextAttemptAt: Double = 0) -> Emission {
    .request([
      "type": type,
      "id": id ?? NSNull(),
      "status": status ?? NSNull(),
      "attempt": attempt,
      "httpStatus": httpStatus,
      "error": error ?? NSNull(),
      "nextAttemptAt": nextAttemptAt,
      "timestamp": Self.nowMs(),
    ])
  }

  private func run(_ completion: @escaping (Any?, Error?) -> Void, _ body: @escaping () async throws -> Any?) {
    Task {
      do {
        completion(try await body(), nil)
      } catch {
        completion(nil, error)
      }
    }
  }

  // MARK: - Public API (called from RNSyncVault.mm)

  @objc public static func registerBackgroundTasks() {
    BackgroundTasksBridge.register()
  }

  @objc public func handleEventsForBackgroundURLSession(_ identifier: String, completionHandler: @escaping () -> Void) {
    guard identifier == BackgroundTransfer.identifier else { return }
    transfer.setEventsCompletionHandler(completionHandler)
  }

  @objc public func configure(_ config: [String: Any], completion: @escaping (Any?, Error?) -> Void) {
    run(completion) {
      let cfg = VaultConfig(dictionary: config)
      let data = try JSONSerialization.data(withJSONObject: cfg.dictionary)
      let json = String(decoding: data, as: UTF8.self)
      _ = try await self.db { db, store in
        try db.execute("INSERT OR REPLACE INTO kv (key, value) VALUES ('config', ?)", [json])
        _ = try store.purgeSucceeded(olderThan: Self.nowMs() - Self.succeededRetentionMs)
      }
      self.withState { self.configCache = cfg }
      self.scheduleBackgroundRefreshIfConfigured()
      self.requestDrain(reason: "configure")
      return nil
    }
  }

  @objc public func enqueue(_ request: [String: Any], completion: @escaping (Any?, Error?) -> Void) {
    run(completion) {
      guard let method = request["method"] as? String, let url = request["url"] as? String else {
        throw SQLiteError(message: "method and url are required")
      }
      let input = EnqueueInput(
        method: method, url: url,
        headers: (request["headers"] as? [String: Any])?.mapValues { "\($0)" } ?? [:],
        body: request["body"] as? String, contentType: request["contentType"] as? String,
        idempotencyKey: request["idempotencyKey"] as? String, queueKey: request["queueKey"] as? String,
        dedupeKey: request["dedupeKey"] as? String, ifMatch: request["ifMatch"] as? String,
        priority: (request["priority"] as? NSNumber)?.intValue ?? 0,
        maxAttempts: (request["maxAttempts"] as? NSNumber)?.intValue ?? 0,
        conflictStrategy: request["conflictStrategy"] as? String ?? "manual",
        metadata: request["metadata"] as? String
      )
      let cfg = try await self.config()
      let result = try await self.db { _, store in try store.enqueue(input, config: cfg, now: Self.nowMs()) }
      self.emit([self.requestEvent(result.coalesced ? "coalesced" : "enqueued", id: result.id, status: Status.pending)])
      self.requestDrain(reason: "enqueue")
      return result.id
    }
  }

  @objc public func getRequests(_ statuses: [String], queueKey: String?, limit: Int, offset: Int,
                                completion: @escaping (Any?, Error?) -> Void) {
    run(completion) {
      try await self.db { _, store in
        try store.query(statuses: statuses, queueKey: queueKey, limit: limit, offset: offset).map { row -> [String: Any] in
          let body = (try? store.readBody(row)) ?? nil
          return self.dictionary(row, body: body)
        }
      }
    }
  }

  @objc public func counts(_ completion: @escaping (Any?, Error?) -> Void) {
    run(completion) { try await self.db { _, store in try store.counts() } }
  }

  @objc public func retry(_ id: String, completion: @escaping (Any?, Error?) -> Void) {
    run(completion) {
      if try await self.db({ _, store in try store.retry(id: id, now: Self.nowMs()) }) {
        self.requestDrain(reason: "retry")
      }
      return nil
    }
  }

  @objc public func retryAllDeadLetters(_ completion: @escaping (Any?, Error?) -> Void) {
    run(completion) {
      let count = try await self.db { _, store in try store.retryAllDeadLetters(now: Self.nowMs()) }
      if count > 0 { self.requestDrain(reason: "retry") }
      return count
    }
  }

  @objc public func discard(_ id: String, completion: @escaping (Any?, Error?) -> Void) {
    run(completion) {
      if try await self.db({ _, store in try store.delete(id: id) }) {
        self.emit([self.requestEvent("discarded", id: id)])
      }
      return nil
    }
  }

  @objc public func resolveConflict(_ id: String, payload: String?, version: String?, completion: @escaping (Any?, Error?) -> Void) {
    run(completion) {
      let cfg = try await self.config()
      let ok = try await self.db { _, store in
        try store.resolveConflict(id: id, payload: payload, version: version, config: cfg, now: Self.nowMs())
      }
      guard ok else { throw SQLiteError(message: "Request \(id) is not in conflict") }
      self.emit([self.requestEvent(payload == nil ? "discarded" : "conflict_resolved", id: id, status: payload == nil ? nil : Status.pending)])
      self.requestDrain(reason: "conflict_resolved")
      return nil
    }
  }

  @objc public func purgeSucceeded(_ olderThanMs: Double, completion: @escaping (Any?, Error?) -> Void) {
    run(completion) { try await self.db { _, store in try store.purgeSucceeded(olderThan: Self.nowMs() - olderThanMs) } }
  }

  @objc public func drainNow() {
    requestDrain(reason: "manual")
  }

  @objc public func scheduleBackgroundDrain(_ intervalMinutes: Int, requiresUnmetered: Bool, requiresCharging: Bool) {
    BackgroundTasksBridge.scheduleRefresh(intervalMinutes: intervalMinutes)
    BackgroundTasksBridge.scheduleProcessing(earliest: nil, requiresExternalPower: requiresCharging)
  }

  @objc public func cancelBackgroundDrain() {
    BackgroundTasksBridge.cancelAll()
  }

  @objc public func networkState() -> [String: Any] { network.current.dictionary }

  @objc public func powerState() -> [String: Any] { PowerMonitor.snapshot() }

  @objc public func generateId() -> String { UUIDv7.generate() }

  @objc public func setAuthHeaders(_ headers: [String: Any]) {
    let map = headers.mapValues { "\($0)" }
    Task {
      _ = try? await self.db { db, store in
        try db.execute("INSERT OR REPLACE INTO kv (key, value) VALUES ('auth_headers', ?)", [self.crypto.encrypt(jsonString(map)) ?? jsonString(map)])
        try store.clearAuthBlocked(now: Self.nowMs())
      }
      self.withState { self.authHeadersCache = map }
      self.requestDrain(reason: "auth")
    }
  }

  @objc public func cacheGet(_ key: String, completion: @escaping (Any?, Error?) -> Void) {
    run(completion) { try await self.cacheOp { try $0.get(key: key, now: Self.nowMs()) } }
  }

  @objc public func cacheSet(_ key: String, value: String, ttlMs: Double, tags: [String], completion: @escaping (Any?, Error?) -> Void) {
    run(completion) {
      try await self.cacheOp { try $0.set(key: key, value: value, ttlMs: ttlMs, tags: tags, now: Self.nowMs()) }
      return nil
    }
  }

  @objc public func cacheDelete(_ key: String, completion: @escaping (Any?, Error?) -> Void) {
    run(completion) {
      try await self.cacheOp { try $0.delete(key: key) }
      return nil
    }
  }

  @objc public func cacheInvalidate(_ prefix: String?, tags: [String], completion: @escaping (Any?, Error?) -> Void) {
    run(completion) { try await self.cacheOp { try $0.invalidate(prefix: prefix, tags: tags) } }
  }

  @objc public func cacheClear(_ completion: @escaping (Any?, Error?) -> Void) {
    run(completion) {
      try await self.cacheOp { try $0.clear() }
      return nil
    }
  }

  @objc public func cacheStats(_ completion: @escaping (Any?, Error?) -> Void) {
    run(completion) {
      let stats = try await self.cacheOp { try $0.stats() }
      return ["entries": stats.entries, "sizeBytes": stats.sizeBytes] as [String: Any]
    }
  }

  @objc public func cacheEvict(_ maxBytes: Double, completion: @escaping (Any?, Error?) -> Void) {
    run(completion) { try await self.cacheOp { try $0.evict(maxBytes: maxBytes, now: Self.nowMs()) } }
  }

  func scheduleBackgroundRefreshIfConfigured() {
    let cfg = cachedConfig()
    if cfg.backgroundIntervalMinutes > 0 {
      BackgroundTasksBridge.scheduleRefresh(intervalMinutes: cfg.backgroundIntervalMinutes)
    }
  }

  // MARK: - App lifecycle

  @objc private func appWillEnterForeground() {
    requestDrain(reason: "foreground")
  }

  /// Finish the in-flight batch with extra background time, and hand the rest to BGTaskScheduler.
  @objc private func appDidEnterBackground() {
    let app = UIApplication.shared
    if backgroundTaskId == .invalid {
      backgroundTaskId = app.beginBackgroundTask(withName: "SyncVaultDrain") { [weak self] in
        self?.endBackgroundTask()
      }
    }
    Task {
      let hasPending = (try? await self.db { _, store in try store.hasPending() }) ?? false
      if hasPending {
        BackgroundTasksBridge.scheduleProcessing(earliest: nil, requiresExternalPower: self.cachedConfig().requiresCharging)
      }
      await self.drain(reason: "background")
    }
  }

  private func endBackgroundTask() {
    DispatchQueue.main.async {
      guard self.backgroundTaskId != .invalid else { return }
      UIApplication.shared.endBackgroundTask(self.backgroundTaskId)
      self.backgroundTaskId = .invalid
    }
  }

  // MARK: - Drain

  func requestDrain(reason: String) {
    Task.detached(priority: .utility) { await self.drain(reason: reason) }
  }

  /// Single-flight drain: concurrent callers set a flag and the running drain loops again,
  /// so no trigger is lost and a request is never processed twice in-process.
  func drain(reason: String) async {
    let acquired: Bool = withState {
      drainRequested = true
      if draining { return false }
      draining = true
      return true
    }
    guard acquired else { return }

    while true {
      let cancelled = Task.isCancelled
      let proceed: Bool = withState {
        if !drainRequested || cancelled {
          draining = false
          return false
        }
        drainRequested = false
        return true
      }
      if !proceed { break }
      do {
        try await drainOnce(reason: reason)
      } catch {
        NSLog("[SyncVault] Drain failed: \(error)")
      }
    }
    await scheduleNextWake()
    endBackgroundTask()
  }

  private func policyAllows(_ cfg: VaultConfig) -> Bool {
    let net = network.current
    guard net.isConnected else { return false }
    if cfg.wifiOnly && (net.isExpensive || net.isConstrained) { return false }
    if cfg.requiresCharging || cfg.minBatteryLevel > 0 {
      let power = PowerMonitor.snapshot()
      let charging = power["isCharging"] as? Bool ?? false
      let level = power["batteryLevel"] as? Double ?? -1
      if cfg.requiresCharging && !charging { return false }
      if cfg.minBatteryLevel > 0 && !charging && level >= 0 && level < cfg.minBatteryLevel { return false }
    }
    return true
  }

  private func drainOnce(reason: String) async throws {
    let cfg = try await config()
    guard policyAllows(cfg) else { return }
    _ = try await db { _, store in try store.recoverExpiredLeases(leaseCutoff: Self.nowMs()) }
    emit([requestEvent("drain_started", error: reason)])
    while !Task.isCancelled {
      let batch = try await db { _, store in
        try store.claimBatch(now: Self.nowMs(), limit: max(cfg.maxConcurrency, 1), leaseMs: cfg.effectiveLeaseMs)
      }
      if batch.isEmpty { break }
      await withTaskGroup(of: Void.self) { group in
        for row in batch {
          group.addTask { await self.process(row, cfg: cfg) }
        }
      }
      if !policyAllows(cfg) { break }
    }
    emit([requestEvent("drain_finished")])
  }

  private func buildURL(_ cfg: VaultConfig, _ row: OutboxRow) -> URL? {
    let absolute = row.url.hasPrefix("http://") || row.url.hasPrefix("https://")
      ? row.url
      : cfg.baseUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/" + row.url.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    guard var components = URLComponents(string: absolute) else { return nil }
    let legacy = stringMap(row.queryParams)
    if !legacy.isEmpty {
      components.queryItems = (components.queryItems ?? []) + legacy.map { URLQueryItem(name: $0.key, value: $0.value) }
    }
    return components.url
  }

  private func buildRequest(_ row: OutboxRow, body: String?, cfg: VaultConfig, auth: [String: String]) -> URLRequest? {
    guard let url = buildURL(cfg, row) else { return nil }
    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: Double(cfg.requestTimeoutMs) / 1000)
    request.httpMethod = row.method
    var headers = row.headers
    auth.forEach { headers[$0.key] = $0.value }
    headers["Idempotency-Key"] = row.idempotencyKey
    if let ifMatch = row.ifMatch { headers["If-Match"] = ifMatch }
    if let contentType = row.contentType { headers["Content-Type"] = contentType }
    headers.forEach { request.setValue($0.value, forHTTPHeaderField: $0.key) }
    let method = row.method.uppercased()
    if let body, method != "GET", method != "HEAD" {
      request.httpBody = Data(body.utf8)
    } else if ["POST", "PUT", "PATCH"].contains(method), row.payloadRef == nil {
      request.httpBody = Data()
    }
    return request
  }

  private func process(_ row: OutboxRow, cfg: VaultConfig) async {
    emit([requestEvent("attempt", id: row.id, status: Status.inflight, attempt: row.attempt)])
    let prepared: (URLRequest?, Error?)
    do {
      prepared = try await db { db, store in
        let body = row.payloadRef == nil ? try store.readBody(row) : nil
        return (self.buildRequest(row, body: body, cfg: cfg, auth: self.authHeadersOnQueue(db)), nil)
      }
    } catch {
      prepared = (nil, error)
    }
    guard let request = prepared.0 else {
      let message = prepared.1.map { "\($0)" } ?? "Invalid URL: \(row.url)"
      let emissions: [Emission] = (try? await db { _, store -> [Emission] in
        try store.markDeadLetter(id: row.id, httpStatus: 0, error: message, response: nil, now: Self.nowMs())
        return [self.requestEvent("dead_lettered", id: row.id, status: Status.deadLetter, attempt: row.attempt, error: message)]
      }) ?? []
      emit(emissions)
      return
    }

    if let payloadRef = row.payloadRef {
      _ = try? await db { _, store in try store.extendLease(id: row.id, until: Self.nowMs() + Self.transferLeaseMs) }
      transfer.upload(requestId: row.id, request: request, fileURL: URL(fileURLWithPath: payloadRef))
      return
    }

    var outcome: HTTPOutcome
    do {
      let (data, response) = try await urlSession(for: cfg).data(for: request)
      let http = response as? HTTPURLResponse
      var headers: [String: String] = [:]
      http?.allHeaderFields.forEach { key, value in headers["\(key)".lowercased()] = "\(value)" }
      outcome = HTTPOutcome(status: http?.statusCode ?? 0, body: String(decoding: data, as: UTF8.self), headers: headers, networkError: nil)
    } catch {
      outcome = HTTPOutcome(status: 0, body: nil, headers: [:], networkError: error.localizedDescription)
    }
    let result = outcome
    let emissions = (try? await db { db, store in try self.applyResult(row, result, cfg: cfg, store: store) }) ?? []
    emit(emissions)
  }

  private func handleTransferCompletion(requestId: String, status: Int, body: String?, headers: [String: String], error: String?) {
    guard let database, let store else { return }
    let cfg = cachedConfig()
    let outcome = HTTPOutcome(status: status, body: body, headers: headers, networkError: error)
    // Synchronous so the DB is updated before iOS gets the background-session completion handler.
    let emissions: [Emission] = database.queue.sync {
      guard let row = try? store.get(id: requestId), row.status == Status.inflight else { return [] }
      return (try? applyResult(row, outcome, cfg: cfg, store: store)) ?? []
    }
    emit(emissions)
    requestDrain(reason: "transfer")
  }

  /// The single implementation of result handling. Runs on the DB queue.
  private func applyResult(_ row: OutboxRow, _ outcome: HTTPOutcome, cfg: VaultConfig, store: OutboxStore) throws -> [Emission] {
    let now = Self.nowMs()

    if let networkError = outcome.networkError {
      if !network.current.isConnected {
        // Lost connectivity mid-flight: do not burn an attempt; the path monitor resumes the drain.
        try store.markRetry(id: row.id, nextAttemptAt: now, httpStatus: 0, error: networkError, now: now, refundAttempt: true)
        return [requestEvent("retry_scheduled", id: row.id, status: Status.pending, attempt: row.attempt - 1, error: networkError, nextAttemptAt: now)]
      }
      return try retryOrDeadLetter(row, cfg: cfg, store: store, httpStatus: 0, error: networkError, body: nil, retryAfterMs: nil, now: now)
    }

    switch RetryPolicy.classify(outcome.status) {
    case .success:
      try store.markSucceeded(id: row.id, httpStatus: outcome.status, response: outcome.body, version: outcome.headers["etag"], now: now)
      return [requestEvent("succeeded", id: row.id, status: Status.succeeded, attempt: row.attempt, httpStatus: outcome.status)]

    case .conflict:
      let version = outcome.headers["etag"] ?? extractVersion(outcome.body)
      if row.conflictStrategy == "server_wins" {
        try store.delete(id: row.id, allowInflight: true)
        return [requestEvent("discarded", id: row.id, httpStatus: outcome.status, error: "server_wins")]
      }
      if row.conflictStrategy == "client_wins", let version, row.attempt < row.maxAttempts {
        try store.requeueWithVersion(id: row.id, version: version, now: now)
        return [requestEvent("conflict_resolved", id: row.id, status: Status.pending, attempt: row.attempt, httpStatus: outcome.status, error: "client_wins")]
      }
      try store.markConflict(id: row.id, httpStatus: outcome.status, serverBody: outcome.body, version: version, now: now)
      let localBody = (try? store.readBody(row)) ?? nil
      return [
        requestEvent("conflict", id: row.id, status: Status.conflict, attempt: row.attempt, httpStatus: outcome.status),
        .conflict([
          "id": row.id, "method": row.method, "url": row.url,
          "localBody": localBody ?? NSNull(), "serverBody": outcome.body ?? NSNull(),
          "serverVersion": version ?? NSNull(), "httpStatus": outcome.status,
        ]),
      ]

    case .auth:
      try store.markAuthBlocked(id: row.id, httpStatus: outcome.status, now: now)
      withState { authHeadersCache = nil }
      return [
        requestEvent("auth_blocked", id: row.id, status: Status.pending, attempt: row.attempt, httpStatus: outcome.status),
        .auth(["requestToken": UUIDv7.generate(), "requestId": row.id, "httpStatus": outcome.status]),
      ]

    case .retryable:
      return try retryOrDeadLetter(row, cfg: cfg, store: store, httpStatus: outcome.status, error: "HTTP \(outcome.status)",
                                   body: outcome.body, retryAfterMs: RetryPolicy.parseRetryAfterMs(outcome.headers["retry-after"], nowMs: now), now: now)

    case .permanent:
      try store.markDeadLetter(id: row.id, httpStatus: outcome.status, error: "HTTP \(outcome.status)", response: outcome.body, now: now)
      return [requestEvent("dead_lettered", id: row.id, status: Status.deadLetter, attempt: row.attempt, httpStatus: outcome.status, error: "HTTP \(outcome.status)")]
    }
  }

  private func retryOrDeadLetter(_ row: OutboxRow, cfg: VaultConfig, store: OutboxStore, httpStatus: Int, error: String,
                                 body: String?, retryAfterMs: Double?, now: Double) throws -> [Emission] {
    if row.attempt >= row.maxAttempts {
      let message = "max attempts reached (\(error))"
      try store.markDeadLetter(id: row.id, httpStatus: httpStatus, error: message, response: body, now: now)
      return [requestEvent("dead_lettered", id: row.id, status: Status.deadLetter, attempt: row.attempt, httpStatus: httpStatus, error: message)]
    }
    let next = RetryPolicy.nextAttemptAt(nowMs: now, attempt: row.attempt, baseMs: Double(cfg.retryBaseDelayMs),
                                         maxMs: Double(cfg.retryMaxDelayMs), retryAfterMs: retryAfterMs, random: Double.random(in: 0...1))
    try store.markRetry(id: row.id, nextAttemptAt: next, httpStatus: httpStatus, error: error, now: now, refundAttempt: false)
    return [requestEvent("retry_scheduled", id: row.id, status: Status.pending, attempt: row.attempt, httpStatus: httpStatus, error: error, nextAttemptAt: next)]
  }

  private func extractVersion(_ body: String?) -> String? {
    guard let body, let data = body.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
    for key in ["version", "_version", "etag"] {
      if let value = object[key], !(value is NSNull) { return "\(value)" }
    }
    return nil
  }

  /// Arms an in-process timer for the next backed-off request and mirrors it as a BGProcessingTask,
  /// which iOS runs at its discretion once the app is suspended.
  private func scheduleNextWake() async {
    DispatchQueue.main.async { self.wakeItem?.cancel() }
    guard let next = try? await db({ _, store in try store.nextWakeAt() }) else { return }
    let cfg = cachedConfig()
    guard policyAllows(cfg) else {
      BackgroundTasksBridge.scheduleProcessing(earliest: nil, requiresExternalPower: cfg.requiresCharging)
      return
    }
    let delayMs = max(next - Self.nowMs(), Self.minWakeDelayMs)
    DispatchQueue.main.async {
      let item = DispatchWorkItem { self.requestDrain(reason: "timer") }
      self.wakeItem = item
      DispatchQueue.main.asyncAfter(deadline: .now() + delayMs / 1000, execute: item)
    }
    BackgroundTasksBridge.scheduleProcessing(earliest: Date(timeIntervalSinceNow: delayMs / 1000), requiresExternalPower: cfg.requiresCharging)
  }

  private func dictionary(_ row: OutboxRow, body: String?) -> [String: Any] {
    [
      "id": row.id, "idempotencyKey": row.idempotencyKey, "queueKey": row.queueKey ?? NSNull(),
      "dedupeKey": row.dedupeKey ?? NSNull(), "method": row.method, "url": row.url, "headers": row.headers,
      "body": body ?? NSNull(), "contentType": row.contentType ?? NSNull(), "ifMatch": row.ifMatch ?? NSNull(),
      "status": row.status, "priority": row.priority, "attempt": row.attempt, "maxAttempts": row.maxAttempts,
      "nextAttemptAt": row.nextAttemptAt, "authBlocked": row.authBlocked, "conflictStrategy": row.conflictStrategy,
      "lastError": row.lastError ?? NSNull(), "lastHttpStatus": row.lastHttpStatus,
      "serverResponse": row.serverResponse ?? NSNull(), "serverVersion": row.serverVersion ?? NSNull(),
      "metadata": row.metadata ?? NSNull(), "createdAt": row.createdAt, "updatedAt": row.updatedAt,
      "completedAt": row.completedAt,
    ]
  }
}
