#!/usr/bin/env node

/**
 * react-native-sync-vault CLI
 * Setup tool for initializing offline queue in React Native projects
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PACKAGE_NAME = 'react-native-sync-vault';

function log(message, type = 'info') {
  const colors = {
    info: '\x1b[36m',    // Cyan
    success: '\x1b[32m', // Green
    warning: '\x1b[33m', // Yellow
    error: '\x1b[31m',   // Red
    reset: '\x1b[0m',
  };
  
  const icon = {
    info: 'ℹ',
    success: '✓',
    warning: '⚠',
    error: '✗',
  };
  
  console.log(`${colors[type]}${icon[type]} ${message}${colors.reset}`);
}

function checkReactNativeProject() {
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  
  if (!fs.existsSync(packageJsonPath)) {
    log('package.json not found. Are you in a React Native project?', 'error');
    process.exit(1);
  }
  
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  
  if (!packageJson.dependencies?.['react-native'] && !packageJson.devDependencies?.['react-native']) {
    log('This does not appear to be a React Native project.', 'error');
    process.exit(1);
  }
  
  return packageJson;
}

function checkInstalled() {
  const packageJson = checkReactNativeProject();
  return packageJson.dependencies?.[PACKAGE_NAME] || packageJson.devDependencies?.[PACKAGE_NAME];
}

function installPackage() {
  log('Installing react-native-sync-vault...', 'info');
  
  try {
    execSync(`npm install ${PACKAGE_NAME}`, { stdio: 'inherit' });
    log('Package installed successfully!', 'success');
  } catch (error) {
    log('Failed to install package. Try running: npm install react-native-sync-vault', 'error');
    process.exit(1);
  }
}

function setupAndroid() {
  const manifestPath = path.join(process.cwd(), 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  
  if (!fs.existsSync(manifestPath)) {
    log('AndroidManifest.xml not found. Skipping Android setup.', 'warning');
    return;
  }
  
  let manifest = fs.readFileSync(manifestPath, 'utf8');
  
  if (manifest.includes('ACCESS_NETWORK_STATE')) {
    log('Android permission already configured.', 'success');
    return;
  }
  
  // Add permission if not present
  if (manifest.includes('<manifest')) {
    manifest = manifest.replace(
      /<manifest([^>]*)>/,
      `<manifest$1>\n    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />`
    );
    
    fs.writeFileSync(manifestPath, manifest);
    log('Added ACCESS_NETWORK_STATE permission to AndroidManifest.xml', 'success');
  }
}

function setupIOS() {
  const iosDir = path.join(process.cwd(), 'ios');
  
  if (!fs.existsSync(iosDir)) {
    log('iOS directory not found. Skipping iOS setup.', 'warning');
    return;
  }
  
  log('Running pod install...', 'info');
  
  try {
    execSync('cd ios && pod install', { stdio: 'inherit' });
    log('iOS pods installed successfully!', 'success');
  } catch (error) {
    log('Failed to run pod install. You may need to run it manually: cd ios && pod install', 'warning');
  }
}

function createExampleFile() {
  const examplePath = path.join(process.cwd(), 'OfflineQueueExample.tsx');
  
  if (fs.existsSync(examplePath)) {
    log('Example file already exists. Skipping.', 'info');
    return;
  }
  
  const exampleCode = `import React from 'react';
import { View, Button, Text } from 'react-native';
import { useOfflineQueue, useQueueStatus } from 'react-native-sync-vault';

/**
 * Example: Basic offline queue usage
 * 
 * This example shows how to:
 * 1. Initialize the offline queue
 * 2. Queue requests when offline
 * 3. Monitor queue status
 */
export default function OfflineQueueExample() {
  const queue = useOfflineQueue({
    baseUrl: 'https://api.example.com',
    interceptor: {
      enabled: true, // Automatically intercept fetch() calls
      urlFilter: ['https://api.example.com'], // Only intercept these URLs
    },
  });

  const { status } = useQueueStatus();

  const handleSubmit = async () => {
    try {
      // Option 1: Use automatic interception (recommended)
      const response = await fetch('https://api.example.com/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'John Doe',
          email: 'john@example.com',
        }),
      });

      if (response.status === 202) {
        console.log('Request queued for offline sync');
      } else {
        const data = await response.json();
        console.log('Request successful:', data);
      }
    } catch (error) {
      console.error('Request failed:', error);
    }
  };

  return (
    <View style={{ padding: 20 }}>
      <Text>Network Status: {status?.networkStatus || 'unknown'}</Text>
      <Text>Pending Requests: {status?.totalPending || 0}</Text>
      <Text>Failed Requests: {status?.totalFailed || 0}</Text>
      
      <Button title="Submit Request" onPress={handleSubmit} />
    </View>
  );
}
`;

  fs.writeFileSync(examplePath, exampleCode);
  log('Created example file: OfflineQueueExample.tsx', 'success');
}

function showNextSteps() {
  console.log('\n');
  log('Setup complete! Next steps:', 'info');
  console.log('\n');
  console.log('1. Import and use the hook in your components:');
  console.log('   import { useOfflineQueue } from \'react-native-sync-vault\';');
  console.log('\n');
  console.log('2. Check out the example file: OfflineQueueExample.tsx');
  console.log('\n');
  console.log('3. Read the documentation:');
  console.log('   - API Reference: https://github.com/126punith/react-native-sync-vault#readme');
  console.log('   - Migration Guide: docs/MIGRATION.md');
  console.log('\n');
  console.log('4. Rebuild your app:');
  console.log('   - iOS: cd ios && pod install && cd .. && npx react-native run-ios');
  console.log('   - Android: npx react-native run-android');
  console.log('\n');
}

function main() {
  console.log('\n');
  log('react-native-sync-vault Setup', 'info');
  console.log('========================\n');
  
  // Check if package is installed
  if (!checkInstalled()) {
    log('Package not found. Installing...', 'info');
    installPackage();
  } else {
    log('Package already installed.', 'success');
  }
  
  // Setup Android
  log('Setting up Android...', 'info');
  setupAndroid();
  
  // Setup iOS
  log('Setting up iOS...', 'info');
  setupIOS();
  
  // Create example file
  log('Creating example file...', 'info');
  createExampleFile();
  
  // Show next steps
  showNextSteps();
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { main, checkReactNativeProject, setupAndroid, setupIOS };

