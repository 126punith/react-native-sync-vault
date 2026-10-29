import Foundation

/// Mirrors src/core/retryPolicy.ts and RetryPolicy.kt; keep all three in sync.
enum RetryPolicy {
  enum Outcome { case success, conflict, auth, retryable, permanent }

  static func classify(_ status: Int) -> Outcome {
    switch status {
    case 200...299: return .success
    case 409, 412: return .conflict
    case 401: return .auth
    case 408, 425, 429: return .retryable
    case 500...: return .retryable
    default: return .permanent
    }
  }

  /// Exponential backoff with full jitter: random(0, min(max, base * 2^(attempt-1))).
  static func backoffMs(attempt: Int, baseMs: Double, maxMs: Double, random: Double) -> Double {
    let exp = min(maxMs, baseMs * pow(2, Double(max(attempt - 1, 0))))
    return (exp * min(max(random, 0), 1)).rounded(.down)
  }

  /// Parses Retry-After as delta-seconds or an HTTP-date. Returns a delay in ms.
  static func parseRetryAfterMs(_ value: String?, nowMs: Double) -> Double? {
    guard let raw = value?.trimmingCharacters(in: .whitespaces), !raw.isEmpty else { return nil }
    if let seconds = Double(raw) { return max(seconds, 0) * 1000 }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: "GMT")
    formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
    guard let date = formatter.date(from: raw) else { return nil }
    return max(date.timeIntervalSince1970 * 1000 - nowMs, 0)
  }

  static func nextAttemptAt(nowMs: Double, attempt: Int, baseMs: Double, maxMs: Double, retryAfterMs: Double?, random: Double) -> Double {
    nowMs + max(retryAfterMs ?? 0, backoffMs(attempt: attempt, baseMs: baseMs, maxMs: maxMs, random: random))
  }
}

/// RFC 9562 UUIDv7: 48-bit ms timestamp, monotonic within the same millisecond.
enum UUIDv7 {
  private static let lock = NSLock()
  private static var lastMs: UInt64 = 0
  private static var counter: UInt16 = 0

  static func generate(nowMs: UInt64 = UInt64(Date().timeIntervalSince1970 * 1000)) -> String {
    lock.lock()
    var ms = nowMs
    if ms <= lastMs {
      counter &+= 1
      if counter > 0xFFF {
        lastMs += 1
        counter = 0
      }
      ms = lastMs
    } else {
      lastMs = ms
      counter = UInt16.random(in: 0..<0x800)
    }
    let seq = counter
    lock.unlock()

    var bytes = [UInt8](repeating: 0, count: 16)
    for i in 0..<16 { bytes[i] = UInt8.random(in: 0...255) }
    bytes[0] = UInt8((ms >> 40) & 0xFF)
    bytes[1] = UInt8((ms >> 32) & 0xFF)
    bytes[2] = UInt8((ms >> 24) & 0xFF)
    bytes[3] = UInt8((ms >> 16) & 0xFF)
    bytes[4] = UInt8((ms >> 8) & 0xFF)
    bytes[5] = UInt8(ms & 0xFF)
    bytes[6] = 0x70 | UInt8((seq >> 8) & 0x0F)
    bytes[7] = UInt8(seq & 0xFF)
    bytes[8] = (bytes[8] & 0x3F) | 0x80
    let hex = bytes.map { String(format: "%02x", $0) }.joined()
    let c = Array(hex)
    return "\(String(c[0..<8]))-\(String(c[8..<12]))-\(String(c[12..<16]))-\(String(c[16..<20]))-\(String(c[20..<32]))"
  }
}
