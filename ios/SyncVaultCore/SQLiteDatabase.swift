import Foundation
import SQLite3

private let SQLITE_TRANSIENT_DESTRUCTOR = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

struct SQLiteError: Error, CustomStringConvertible {
  let message: String
  var description: String { message }
}

/// Thin SQLite wrapper. Every call must happen on `queue`, the single serial DB queue.
final class SQLiteDatabase {
  let queue = DispatchQueue(label: "com.syncvault.db", qos: .utility)
  private var handle: OpaquePointer?

  init(path: String) throws {
    let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX
    guard sqlite3_open_v2(path, &handle, flags, nil) == SQLITE_OK else {
      let message = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "unknown error"
      sqlite3_close(handle)
      throw SQLiteError(message: "Cannot open database: \(message)")
    }
    sqlite3_busy_timeout(handle, 5000)
    try execute("PRAGMA journal_mode = WAL")
    try execute("PRAGMA synchronous = NORMAL")
    try execute("PRAGMA foreign_keys = ON")
  }

  deinit {
    sqlite3_close(handle)
  }

  private func lastError() -> SQLiteError {
    SQLiteError(message: String(cString: sqlite3_errmsg(handle)))
  }

  private func prepare(_ sql: String, _ params: [Any?]) throws -> OpaquePointer? {
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(handle, sql, -1, &stmt, nil) == SQLITE_OK else { throw lastError() }
    for (i, param) in params.enumerated() {
      let index = Int32(i + 1)
      let rc: Int32
      switch param {
      case nil, is NSNull:
        rc = sqlite3_bind_null(stmt, index)
      case let v as Bool:
        rc = sqlite3_bind_int64(stmt, index, v ? 1 : 0)
      case let v as Int:
        rc = sqlite3_bind_int64(stmt, index, Int64(v))
      case let v as Int64:
        rc = sqlite3_bind_int64(stmt, index, v)
      case let v as Double:
        rc = sqlite3_bind_double(stmt, index, v)
      case let v as String:
        rc = sqlite3_bind_text(stmt, index, v, -1, SQLITE_TRANSIENT_DESTRUCTOR)
      default:
        rc = sqlite3_bind_text(stmt, index, String(describing: param!), -1, SQLITE_TRANSIENT_DESTRUCTOR)
      }
      if rc != SQLITE_OK {
        sqlite3_finalize(stmt)
        throw lastError()
      }
    }
    return stmt
  }

  /// Executes a statement that returns no rows. Returns the number of changed rows.
  @discardableResult
  func execute(_ sql: String, _ params: [Any?] = []) throws -> Int {
    let stmt = try prepare(sql, params)
    defer { sqlite3_finalize(stmt) }
    var rc = sqlite3_step(stmt)
    while rc == SQLITE_ROW { rc = sqlite3_step(stmt) }
    guard rc == SQLITE_DONE else { throw lastError() }
    return Int(sqlite3_changes(handle))
  }

  func query(_ sql: String, _ params: [Any?] = []) throws -> [[String: Any]] {
    let stmt = try prepare(sql, params)
    defer { sqlite3_finalize(stmt) }
    var rows: [[String: Any]] = []
    while true {
      let rc = sqlite3_step(stmt)
      if rc == SQLITE_DONE { break }
      guard rc == SQLITE_ROW else { throw lastError() }
      var row: [String: Any] = [:]
      for i in 0..<sqlite3_column_count(stmt) {
        let name = String(cString: sqlite3_column_name(stmt, i))
        switch sqlite3_column_type(stmt, i) {
        case SQLITE_INTEGER: row[name] = sqlite3_column_int64(stmt, i)
        case SQLITE_FLOAT: row[name] = sqlite3_column_double(stmt, i)
        case SQLITE_TEXT: row[name] = String(cString: sqlite3_column_text(stmt, i))
        case SQLITE_BLOB:
          if let bytes = sqlite3_column_blob(stmt, i) {
            row[name] = Data(bytes: bytes, count: Int(sqlite3_column_bytes(stmt, i)))
          }
        default: break
        }
      }
      rows.append(row)
    }
    return rows
  }

  func transaction<T>(_ body: () throws -> T) throws -> T {
    try execute("BEGIN IMMEDIATE")
    do {
      let result = try body()
      try execute("COMMIT")
      return result
    } catch {
      _ = try? execute("ROLLBACK")
      throw error
    }
  }

  /// Splits a shared schema file on lines containing only "--;;", dropping comment lines.
  static func splitStatements(_ sql: String) -> [String] {
    var chunks: [String] = []
    var current: [String] = []
    for line in sql.components(separatedBy: "\n") {
      let trimmed = line.trimmingCharacters(in: .whitespaces)
      if trimmed == "--;;" {
        chunks.append(current.joined(separator: "\n"))
        current = []
      } else if !trimmed.hasPrefix("--") {
        current.append(line)
      }
    }
    chunks.append(current.joined(separator: "\n"))
    return chunks.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
  }
}
