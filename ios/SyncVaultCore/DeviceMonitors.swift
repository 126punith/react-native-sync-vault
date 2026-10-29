import Foundation
import Network
import UIKit

struct NetworkSnapshot: Equatable {
  var isConnected = false
  var isInternetReachable = false
  var type = "unknown"
  var isExpensive = false
  var isConstrained = false

  var dictionary: [String: Any] {
    [
      "isConnected": isConnected,
      "isInternetReachable": isInternetReachable,
      "type": type,
      "isExpensive": isExpensive,
      "isConstrained": isConstrained,
    ]
  }
}

/// NWPathMonitor-based connectivity (replaces the deprecated SCNetworkReachability).
/// isExpensive covers cellular/personal hotspot, isConstrained covers Low Data Mode.
final class NetworkMonitor {
  private let monitor = NWPathMonitor()
  private let queue = DispatchQueue(label: "com.syncvault.network")
  private let lock = NSLock()
  private var snapshot = NetworkSnapshot()
  private let onChange: (NetworkSnapshot, Bool) -> Void

  init(onChange: @escaping (NetworkSnapshot, Bool) -> Void) {
    self.onChange = onChange
  }

  var current: NetworkSnapshot {
    lock.lock()
    defer { lock.unlock() }
    return snapshot
  }

  func start() {
    monitor.pathUpdateHandler = { [weak self] path in
      guard let self else { return }
      let next = Self.snapshot(from: path)
      self.lock.lock()
      let previous = self.snapshot
      self.snapshot = next
      self.lock.unlock()
      if next != previous {
        self.onChange(next, !previous.isConnected && next.isConnected)
      }
    }
    monitor.start(queue: queue)
    lock.lock()
    snapshot = Self.snapshot(from: monitor.currentPath)
    lock.unlock()
  }

  private static func snapshot(from path: NWPath) -> NetworkSnapshot {
    let satisfied = path.status == .satisfied
    let type: String
    if !satisfied {
      type = "none"
    } else if path.usesInterfaceType(.wifi) {
      type = "wifi"
    } else if path.usesInterfaceType(.cellular) {
      type = "cellular"
    } else if path.usesInterfaceType(.wiredEthernet) {
      type = "ethernet"
    } else {
      type = "other"
    }
    return NetworkSnapshot(
      isConnected: satisfied,
      isInternetReachable: satisfied,
      type: type,
      isExpensive: path.isExpensive,
      isConstrained: path.isConstrained
    )
  }
}

enum PowerMonitor {
  /// Never blocks on the main queue: getPowerState is a synchronous JSI call from the JS thread.
  static func start() {
    DispatchQueue.main.async { UIDevice.current.isBatteryMonitoringEnabled = true }
  }

  static func snapshot() -> [String: Any] {
    let device = UIDevice.current
    let level = device.batteryLevel
    return [
      "batteryLevel": level < 0 ? -1.0 : Double(level),
      "isCharging": device.batteryState == .charging || device.batteryState == .full,
      "isLowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled,
    ]
  }
}
