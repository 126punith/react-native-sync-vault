# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- CI/CD pipeline with GitHub Actions
- Comprehensive documentation (API stability, breaking changes, migration guide)
- Contributing guidelines and code of conduct
- Issue templates for bug reports, feature requests, and questions
- Pull request template

### Changed
- Improved error handling documentation
- Enhanced test coverage infrastructure

## [1.1.0] - 2024-XX-XX

### Added
- ✨ Automatic API interception - intercepts `fetch()` calls automatically
- ✨ URL filtering for selective interception
- Support for custom API call handlers (axios, custom fetch wrappers)

### Fixed
- 🐛 Fixed dependency array issue in `useOfflineQueue` hook
- 📝 Enhanced debug logging for troubleshooting

### Changed
- Improved error messages for better debugging
- Enhanced TypeScript types for better IDE support

## [1.0.0] - 2024-XX-XX

### Added
- Initial release with manual queuing support
- Native network monitoring (iOS/Android)
- Progressive sync engine
- Conflict resolution strategies
- React hooks for easy integration
- Performance tracking
- Debug tools (DebugScreen, QueueLogger)

### Features
- Offline request queue with SQLite persistence
- Automatic sync when network is restored
- Retry logic with exponential backoff
- Failed request tracking
- Queue status monitoring
- Custom conflict resolution

---

## Types of Changes

- **Added** for new features
- **Changed** for changes in existing functionality
- **Deprecated** for soon-to-be removed features
- **Removed** for now removed features
- **Fixed** for any bug fixes
- **Security** for vulnerability fixes


