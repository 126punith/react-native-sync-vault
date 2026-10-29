require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "react-native-sync-vault"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"] || "https://github.com/react-native-sync-vault/react-native-sync-vault"
  s.license      = package["license"]
  s.authors      = package["author"]
  s.platforms    = { :ios => "15.1" }
  s.source       = { :git => "https://github.com/react-native-sync-vault/react-native-sync-vault.git", :tag => "v#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift}"
  # RNSyncVault.h includes C++ codegen headers and must stay out of the Swift module's umbrella
  # header; only the plain Objective-C app delegate helper is public.
  s.public_header_files = "ios/SyncVaultAppDelegate.h"
  s.private_header_files = "ios/RNSyncVault.h"
  s.swift_version = "5.9"
  s.resource_bundles = { "SyncVaultSchema" => ["schema/sync_vault/*.sql"] }
  s.frameworks = "BackgroundTasks", "CryptoKit", "Network", "Security"
  s.library = "sqlite3"

  s.pod_target_xcconfig = {
    "DEFINES_MODULE" => "YES",
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20"
  }

  install_modules_dependencies(s)
end
