# Contributing to react-native-sync-vault

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing to the project.

## Code of Conduct

By participating in this project, you agree to abide by our Code of Conduct. Be respectful, inclusive, and constructive in all interactions.

## Getting Started

### Prerequisites

- Node.js >= 18.x
- npm or yarn
- React Native development environment (for testing native features)
- TypeScript knowledge

### Development Setup

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/react-native-sync-vault.git
   cd react-native-sync-vault
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the project**
   ```bash
   npm run build
   ```

4. **Run tests**
   ```bash
   npm test
   ```

5. **Run linting**
   ```bash
   npm run lint
   ```

## Development Workflow

### Branching Strategy

- `main` - Stable, production-ready code
- `develop` - Integration branch for features
- `feature/*` - New features
- `fix/*` - Bug fixes
- `docs/*` - Documentation updates

### Making Changes

1. **Create a branch**
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

2. **Make your changes**
   - Write clean, readable code
   - Follow existing code style
   - Add tests for new features
   - Update documentation as needed

3. **Test your changes**
   ```bash
   npm test
   npm run lint
   npm run build
   ```

4. **Commit your changes**
   - Use clear, descriptive commit messages
   - Follow conventional commits format when possible:
     - `feat: add new feature`
     - `fix: resolve bug`
     - `docs: update documentation`
     - `test: add tests`
     - `refactor: improve code structure`

5. **Push and create a Pull Request**
   ```bash
   git push origin feature/your-feature-name
   ```

## Coding Standards

### TypeScript

- Use TypeScript strict mode
- Provide types for all public APIs
- Avoid `any` - use proper types or `unknown`
- Use interfaces for object shapes
- Use type aliases for unions and complex types

### Code Style

- Follow existing code patterns
- Use meaningful variable and function names
- Keep functions focused and single-purpose
- Add JSDoc comments for public APIs
- Keep line length reasonable (100 chars max)

### Testing

- Write tests for all new features
- Maintain or improve test coverage
- Test both success and error cases
- Mock native modules appropriately
- Test edge cases and boundary conditions

### File Structure

- Keep related code together
- Use clear file and directory names
- Export types from `types.ts`
- Group hooks in `hooks/` directory
- Keep utilities in `utils/` directory

## Pull Request Process

1. **Ensure your PR is ready**
   - All tests pass
   - Code is linted
   - TypeScript compiles without errors
   - Documentation is updated
   - No merge conflicts

2. **Create a descriptive PR**
   - Clear title describing the change
   - Detailed description of what and why
   - Reference related issues
   - Include screenshots/videos if UI changes
   - Update CHANGELOG.md if applicable

3. **Respond to feedback**
   - Be open to suggestions
   - Make requested changes promptly
   - Engage in constructive discussion

## Areas for Contribution

### High Priority

- **Test Coverage**: Help improve test coverage, especially for native modules
- **Documentation**: Improve docs, add examples, fix typos
- **Performance**: Identify and fix performance bottlenecks
- **Bug Fixes**: Fix reported issues

### Feature Development

- **Cache Layer**: Help build the intelligent caching system
- **State Management**: Build adapters for Redux, Zustand, etc.
- **Optimistic Updates**: Implement optimistic update system
- **Examples**: Create example applications

### Documentation

- **API Documentation**: Improve JSDoc comments
- **Guides**: Write how-to guides and tutorials
- **Examples**: Add more code examples
- **Migration Guides**: Help users migrate from other solutions

## Testing Native Modules

Testing native modules requires additional setup:

### iOS
```bash
cd ios
pod install
```

### Android
Ensure Android SDK and build tools are installed.

## Questions?

- Open an issue with the `question` label
- Check existing issues and discussions
- Reach out to maintainers

## Recognition

Contributors will be:
- Listed in CONTRIBUTORS.md
- Mentioned in release notes for significant contributions
- Credited in relevant documentation

Thank you for contributing to react-native-sync-vault! 🎉

