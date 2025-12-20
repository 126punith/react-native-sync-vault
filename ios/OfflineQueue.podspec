require "json"

package = JSON.parse(File.read(File.join(__dir__, "..", "package.json")))

Pod::Spec.new do |s|
  s.name         = "OfflineQueue"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.description  = <<-DESC
                  A reliable, persistent network operation queue for React Native
                   DESC
  s.homepage     = "https://github.com/yourusername/react-native-offline-queue"
  s.license      = "MIT"
  s.author       = { "author" => "author@example.com" }
  s.platforms    = { :ios => "11.0" }
  s.source       = { :git => "https://github.com/yourusername/react-native-offline-queue.git", :tag => "#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift}"
  s.requires_arc = true

  s.dependency "React-Core"
  s.dependency "react-native-nitro-sqlite", "~> 1.0.0"
end

