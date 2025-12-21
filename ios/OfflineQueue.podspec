require "json"

package = JSON.parse(File.read(File.join(__dir__, "..", "package.json")))

Pod::Spec.new do |s|
  s.name         = "OfflineQueue"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.description  = <<-DESC
                  A reliable offline-first sync vault for persistent network operations in React Native
                   DESC
  s.homepage     = "https://github.com/126punith/react-native-sync-vault"
  s.license      = "MIT"
  s.author       = { "Punith M" => "punithm300@gmail.com" }
  s.platforms    = { :ios => "11.0" }
  s.source       = { :git => "https://github.com/126punith/react-native-sync-vault.git", :tag => "#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift}"
  s.requires_arc = true

  s.dependency "React-Core"
  s.dependency "react-native-nitro-sqlite", "~> 1.0.0"
end

