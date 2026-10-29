import CryptoKit
import Foundation
import Security

struct UndecryptableError: Error, CustomStringConvertible {
  let description = "Stored payload cannot be decrypted (Keychain key missing or changed)"
}

/// AES-256-GCM field encryption. The key lives in the Keychain with
/// AfterFirstUnlockThisDeviceOnly, so background tasks can read it while the device is locked
/// and it never leaves the device through backups.
/// Values are stored as "enc:v1:" + base64(combined sealed box); unprefixed values are plaintext.
final class PayloadCrypto {
  private let prefix = "enc:v1:"
  private let service = "com.syncvault"
  private let account = "payload_key_v1"
  private let lock = NSLock()
  private var cachedKey: SymmetricKey?

  private func key() throws -> SymmetricKey {
    lock.lock()
    defer { lock.unlock() }
    if let cachedKey { return cachedKey }

    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    if SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data {
      let key = SymmetricKey(data: data)
      cachedKey = key
      return key
    }

    let key = SymmetricKey(size: .bits256)
    let data = key.withUnsafeBytes { Data($0) }
    let add: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
      kSecValueData as String: data,
    ]
    let status = SecItemAdd(add as CFDictionary, nil)
    guard status == errSecSuccess else {
      throw SQLiteError(message: "Keychain write failed (\(status))")
    }
    cachedKey = key
    return key
  }

  /// Never loses data: if the Keychain is unavailable the value is stored as plaintext.
  func encrypt(_ plain: String?) -> String? {
    guard let plain else { return nil }
    do {
      let sealed = try AES.GCM.seal(Data(plain.utf8), using: key())
      guard let combined = sealed.combined else { return plain }
      return prefix + combined.base64EncodedString()
    } catch {
      NSLog("[SyncVault] Keychain encryption unavailable, storing plaintext: \(error)")
      return plain
    }
  }

  func decrypt(_ stored: String?) throws -> String? {
    guard let stored, stored.hasPrefix(prefix) else { return stored }
    guard let data = Data(base64Encoded: String(stored.dropFirst(prefix.count))) else { throw UndecryptableError() }
    do {
      let box = try AES.GCM.SealedBox(combined: data)
      let plain = try AES.GCM.open(box, using: key())
      return String(decoding: plain, as: UTF8.self)
    } catch {
      throw UndecryptableError()
    }
  }
}
