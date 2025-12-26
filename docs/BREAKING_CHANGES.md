# Breaking Changes Policy

This document outlines how breaking changes are handled in react-native-sync-vault.

## Definition

A **breaking change** is any modification that:
- Requires code changes in user applications
- Changes the behavior of existing APIs in incompatible ways
- Removes or significantly alters public APIs
- Changes TypeScript types in ways that break existing code

## Process for Breaking Changes

### 1. Planning Phase

Before introducing a breaking change:

1. **Justify the change**: Document why the breaking change is necessary
2. **Propose alternatives**: Consider if the goal can be achieved without breaking changes
3. **Community discussion**: Open an issue or discussion for feedback
4. **Migration path**: Plan how users will migrate to the new API

### 2. Deprecation Phase

Before removing an API:

1. **Mark as deprecated**: Add `@deprecated` JSDoc tag
2. **Add deprecation notice**: Log warnings in development mode
3. **Document migration**: Provide clear migration guide
4. **Wait period**: Keep deprecated API for at least one minor version

### 3. Implementation Phase

When implementing breaking changes:

1. **Major version bump**: Breaking changes only in major versions
2. **Clear CHANGELOG**: Document all breaking changes
3. **Migration guide**: Provide step-by-step migration instructions
4. **Backward compatibility**: Consider compatibility layer if feasible

### 4. Communication Phase

When releasing breaking changes:

1. **Release notes**: Highlight breaking changes prominently
2. **Blog post**: Explain the reasoning and benefits
3. **Community announcement**: Notify users via GitHub Discussions
4. **Support period**: Provide support for migration questions

## Examples of Breaking Changes

### ✅ Breaking Change

```typescript
// v1.0.0
function useOfflineQueue(baseUrl: string): QueueManager;

// v2.0.0 - BREAKING: Parameter changed from string to object
function useOfflineQueue(config: OfflineQueueConfig): QueueManager;
```

**Migration:**
```typescript
// Old code
const queue = useOfflineQueue('https://api.com');

// New code
const queue = useOfflineQueue({ baseUrl: 'https://api.com' });
```

### ❌ NOT a Breaking Change

```typescript
// v1.0.0
function useOfflineQueue(baseUrl: string): QueueManager;

// v1.1.0 - NOT BREAKING: New overload, old one still works
function useOfflineQueue(baseUrl: string): QueueManager;
function useOfflineQueue(config: OfflineQueueConfig): QueueManager;
```

## Version History

### v1.0.0
- Initial stable release
- No breaking changes (first version)

### v1.1.0
- ✅ No breaking changes
- Added automatic API interception (opt-in feature)
- All v1.0.0 APIs remain compatible

## Future Breaking Changes

When planning major version upgrades:

### Potential v2.0.0 Changes

None currently planned. If breaking changes are needed:

1. They will be announced at least 3 months in advance
2. Deprecation warnings will be added in v1.x
3. Migration guides will be provided
4. Compatibility layer may be provided for critical APIs

## Reporting Breaking Changes

If you encounter what you believe is an unintended breaking change:

1. **Open an issue** with the `breaking-change` label
2. **Describe the impact** on your code
3. **Provide code examples** showing the issue
4. **Suggest alternatives** if you have ideas

## Minimizing Breaking Changes

We commit to:

- **Stability**: Maintain stable APIs across minor versions
- **Communication**: Clearly communicate any breaking changes
- **Migration support**: Provide tools and guides for migration
- **Feedback**: Listen to community concerns about breaking changes

## Compatibility Matrix

| Your Version | Latest v1.x | Latest v2.x | Migration Required |
|-------------|-------------|-------------|-------------------|
| v1.0.0      | ✅ Compatible | ❌ Breaking | Yes (when v2.0.0 released) |
| v1.1.0      | ✅ Compatible | ❌ Breaking | Yes (when v2.0.0 released) |
| v2.0.0      | ❌ Breaking   | ✅ Compatible | N/A |

## Questions?

If you have questions about breaking changes:

- Check the [CHANGELOG.md](../CHANGELOG.md)
- Review the [Migration Guide](./MIGRATION.md)
- Open an issue with the `question` label


