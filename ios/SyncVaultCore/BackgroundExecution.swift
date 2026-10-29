import BackgroundTasks
import Foundation

/// BGTaskScheduler integration. Identifiers must be listed in Info.plist under
/// BGTaskSchedulerPermittedIdentifiers (the sync-vault-init CLI adds them); unlisted
/// identifiers are skipped instead of crashing at registration.
enum BackgroundTasksBridge {
  static let drainIdentifier = "com.syncvault.drain"
  static let refreshIdentifier = "com.syncvault.refresh"

  private static let lock = NSLock()
  private static var registered = false

  static func isPermitted(_ identifier: String) -> Bool {
    let ids = Bundle.main.object(forInfoDictionaryKey: "BGTaskSchedulerPermittedIdentifiers") as? [String]
    return ids?.contains(identifier) == true
  }

  /// Must run before the app finishes launching. Idempotent.
  static func register() {
    lock.lock()
    defer { lock.unlock() }
    guard !registered else { return }
    registered = true
    for identifier in [drainIdentifier, refreshIdentifier] where isPermitted(identifier) {
      BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) { task in
        handle(task)
      }
    }
  }

  private static func handle(_ task: BGTask) {
    let core = SyncVaultCore.shared
    let completed = NSLock()
    var done = false
    func finish(_ success: Bool) {
      completed.lock()
      defer { completed.unlock() }
      guard !done else { return }
      done = true
      task.setTaskCompleted(success: success)
    }
    let work = Task {
      await core.drain(reason: "bgtask")
      core.scheduleBackgroundRefreshIfConfigured()
      finish(true)
    }
    task.expirationHandler = {
      work.cancel()
      finish(false)
    }
  }

  static func scheduleProcessing(earliest: Date?, requiresExternalPower: Bool) {
    guard isPermitted(drainIdentifier) else { return }
    let request = BGProcessingTaskRequest(identifier: drainIdentifier)
    request.requiresNetworkConnectivity = true
    request.requiresExternalPower = requiresExternalPower
    request.earliestBeginDate = earliest
    do {
      try BGTaskScheduler.shared.submit(request)
    } catch {
      NSLog("[SyncVault] BGProcessingTask submit failed: \(error)")
    }
  }

  static func scheduleRefresh(intervalMinutes: Int) {
    guard isPermitted(refreshIdentifier), intervalMinutes > 0 else { return }
    let request = BGAppRefreshTaskRequest(identifier: refreshIdentifier)
    request.earliestBeginDate = Date(timeIntervalSinceNow: Double(intervalMinutes) * 60)
    do {
      try BGTaskScheduler.shared.submit(request)
    } catch {
      NSLog("[SyncVault] BGAppRefreshTask submit failed: \(error)")
    }
  }

  static func cancelAll() {
    BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: drainIdentifier)
    BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: refreshIdentifier)
  }
}

/// Background URLSession for large payloads: uploads continue while the app is suspended
/// or after it is killed, and iOS relaunches the app to deliver the result.
final class BackgroundTransfer: NSObject, URLSessionDataDelegate {
  typealias Completion = (_ requestId: String, _ status: Int, _ body: String?, _ headers: [String: String], _ error: String?) -> Void

  static var identifier: String { (Bundle.main.bundleIdentifier ?? "app") + ".syncvault.transfer" }

  private let onComplete: Completion
  private let lock = NSLock()
  private var buffers: [Int: Data] = [:]
  private var eventsCompletionHandler: (() -> Void)?

  private lazy var session: URLSession = {
    let config = URLSessionConfiguration.background(withIdentifier: Self.identifier)
    config.sessionSendsLaunchEvents = true
    config.isDiscretionary = false
    return URLSession(configuration: config, delegate: self, delegateQueue: nil)
  }()

  init(onComplete: @escaping Completion) {
    self.onComplete = onComplete
    super.init()
  }

  func activeRequestIds(_ completion: @escaping (Set<String>) -> Void) {
    session.getAllTasks { tasks in
      completion(Set(tasks.filter { $0.state == .running || $0.state == .suspended }.compactMap { $0.taskDescription }))
    }
  }

  func upload(requestId: String, request: URLRequest, fileURL: URL) {
    let task = session.uploadTask(with: request, fromFile: fileURL)
    task.taskDescription = requestId
    task.resume()
  }

  func setEventsCompletionHandler(_ handler: @escaping () -> Void) {
    lock.lock()
    eventsCompletionHandler = handler
    lock.unlock()
    _ = session
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    lock.lock()
    buffers[dataTask.taskIdentifier, default: Data()].append(data)
    lock.unlock()
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    lock.lock()
    let data = buffers.removeValue(forKey: task.taskIdentifier)
    lock.unlock()
    guard let requestId = task.taskDescription else { return }
    let http = task.response as? HTTPURLResponse
    var headers: [String: String] = [:]
    http?.allHeaderFields.forEach { key, value in headers["\(key)".lowercased()] = "\(value)" }
    onComplete(requestId, http?.statusCode ?? 0, data.map { String(decoding: $0, as: UTF8.self) }, headers,
               error.map { $0.localizedDescription })
  }

  func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    lock.lock()
    let handler = eventsCompletionHandler
    eventsCompletionHandler = nil
    lock.unlock()
    DispatchQueue.main.async { handler?() }
  }
}
