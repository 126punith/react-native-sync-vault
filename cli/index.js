#!/usr/bin/env node
'use strict';

/**
 * react-native-sync-vault setup CLI.
 *
 *   npx sync-vault-init [--dry-run] [--skip-pods]
 *
 * - iOS: adds BGTaskSchedulerPermittedIdentifiers and UIBackgroundModes (processing, fetch) to
 *   Info.plist, and forwards background URLSession events from the AppDelegate.
 * - Android: verifies newArchEnabled=true and that the merged manifest entries (network,
 *   foreground service dataSync) are not removed by the app manifest.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PACKAGE_NAME = 'react-native-sync-vault';
const BG_TASK_IDS = ['com.syncvault.drain', 'com.syncvault.refresh'];
const BACKGROUND_MODES = ['processing', 'fetch'];
const ANDROID_PERMISSIONS = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
];

const COLORS = { info: '\x1b[36m', success: '\x1b[32m', warning: '\x1b[33m', error: '\x1b[31m', reset: '\x1b[0m' };
const ICONS = { info: 'i', success: '✓', warning: '!', error: '✗' };

function log(message, type = 'info') {
  console.log(`${COLORS[type]}${ICONS[type]} ${message}${COLORS.reset}`);
}

// ------------------------------------------------------------------ Info.plist

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Ensures `<key>name</key><array>` contains every value. Returns the new XML. */
function ensurePlistArray(xml, key, values) {
  const pattern = new RegExp(`(<key>${escapeRegExp(key)}</key>\\s*)(<array>([\\s\\S]*?)</array>|<array\\s*/>)`);
  const match = xml.match(pattern);
  if (match) {
    const existing = match[3] || '';
    const missing = values.filter((v) => !new RegExp(`<string>\\s*${escapeRegExp(v)}\\s*</string>`).test(existing));
    if (missing.length === 0) return xml;
    const indentMatch = existing.match(/\n([ \t]*)<string>/);
    const indent = indentMatch ? indentMatch[1] : '\t\t';
    const closingIndent = indent.length > 0 ? indent.slice(0, -1) : '';
    const body = existing.replace(/\s*$/, '') + missing.map((v) => `\n${indent}<string>${v}</string>`).join('') + `\n${closingIndent}`;
    return xml.replace(pattern, `${match[1]}<array>${body}</array>`);
  }
  const lastDict = xml.lastIndexOf('</dict>');
  if (lastDict === -1) throw new Error('Info.plist has no top-level <dict>');
  const entry = `\t<key>${key}</key>\n\t<array>\n${values.map((v) => `\t\t<string>${v}</string>\n`).join('')}\t</array>\n`;
  return xml.slice(0, lastDict) + entry + xml.slice(lastDict);
}

function patchInfoPlist(xml) {
  let next = ensurePlistArray(xml, 'BGTaskSchedulerPermittedIdentifiers', BG_TASK_IDS);
  next = ensurePlistArray(next, 'UIBackgroundModes', BACKGROUND_MODES);
  return { xml: next, changed: next !== xml };
}

// ------------------------------------------------------------------ AppDelegate

const OBJC_IMPORT = `#if __has_include(<react-native-sync-vault/SyncVaultAppDelegate.h>)
#import <react-native-sync-vault/SyncVaultAppDelegate.h>
#else
#import "SyncVaultAppDelegate.h"
#endif`;

const OBJC_METHOD = `
- (void)application:(UIApplication *)application
    handleEventsForBackgroundURLSession:(NSString *)identifier
                      completionHandler:(void (^)(void))completionHandler
{
  [SyncVaultAppDelegate handleEventsForBackgroundURLSession:identifier completionHandler:completionHandler];
}
`;

const SWIFT_METHOD = `
  func application(
    _ application: UIApplication,
    handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
  ) {
    SyncVaultCore.shared.handleEventsForBackgroundURLSession(identifier, completionHandler: completionHandler)
  }
`;

/** Index of the brace closing the block opened at `openIndex`. */
function matchingBrace(source, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function patchAppDelegate(source, language) {
  if (source.includes('handleEventsForBackgroundURLSession')) return { source, changed: false };

  if (language === 'objc') {
    const importAnchor = source.match(/#import\s+"AppDelegate\.h"\s*\n/);
    let next = importAnchor
      ? source.replace(importAnchor[0], `${importAnchor[0]}${OBJC_IMPORT}\n`)
      : `${OBJC_IMPORT}\n${source}`;
    const implStart = next.search(/@implementation\s+AppDelegate\b/);
    if (implStart === -1) throw new Error('@implementation AppDelegate not found');
    const end = next.indexOf('@end', implStart);
    if (end === -1) throw new Error('@end for AppDelegate not found');
    next = next.slice(0, end) + OBJC_METHOD.trimStart() + '\n' + next.slice(end);
    return { source: next, changed: true };
  }

  const classMatch = source.match(/class\s+AppDelegate\b[^{]*\{/);
  if (!classMatch || classMatch.index == null) throw new Error('class AppDelegate not found');
  const open = classMatch.index + classMatch[0].length - 1;
  const close = matchingBrace(source, open);
  if (close === -1) throw new Error('Unbalanced braces in AppDelegate.swift');
  let next = source.slice(0, close).replace(/\s*$/, '\n') + SWIFT_METHOD + source.slice(close);
  if (!/^import\s+react_native_sync_vault[^\S\n]*$/m.test(next)) {
    const lastImport = [...next.matchAll(/^import[^\S\n]+\S+[^\S\n]*$/gm)].pop();
    next = lastImport
      ? next.slice(0, lastImport.index + lastImport[0].length) + '\nimport react_native_sync_vault' + next.slice(lastImport.index + lastImport[0].length)
      : `import react_native_sync_vault\n${next}`;
  }
  return { source: next, changed: true };
}

// ------------------------------------------------------------------ Android

function checkAndroidManifest(xml) {
  const problems = [];
  for (const permission of ANDROID_PERMISSIONS) {
    const removed = new RegExp(`<uses-permission[^>]*android:name="${escapeRegExp(permission)}"[^>]*tools:node="remove"`).test(xml);
    if (removed) problems.push(`${permission} is removed with tools:node="remove"; the outbox needs it.`);
  }
  if (/SystemForegroundService[^>]*tools:node="remove"/.test(xml)) {
    problems.push('androidx.work SystemForegroundService is removed; large uploads cannot run as a foreground service.');
  }
  return problems;
}

function patchGradleProperties(text) {
  if (/^\s*newArchEnabled\s*=\s*true\s*$/m.test(text)) return { text, changed: false };
  if (/^\s*newArchEnabled\s*=.*$/m.test(text)) {
    return { text: text.replace(/^\s*newArchEnabled\s*=.*$/m, 'newArchEnabled=true'), changed: true };
  }
  return { text: `${text.replace(/\s*$/, '\n')}newArchEnabled=true\n`, changed: true };
}

// ------------------------------------------------------------------ project discovery

function findFile(dir, predicate, depth = 3) {
  if (!fs.existsSync(dir) || depth < 0) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['Pods', 'build', 'node_modules', '.git'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isFile() && predicate(entry.name, full)) return full;
    if (entry.isDirectory()) {
      const found = findFile(full, predicate, depth - 1);
      if (found) return found;
    }
  }
  return null;
}

function writeIfChanged(file, content, original, dryRun, label) {
  if (content === original) {
    log(`${label}: already configured`, 'success');
    return;
  }
  if (dryRun) {
    log(`${label}: would update ${file}`, 'info');
    return;
  }
  fs.writeFileSync(file, content);
  log(`${label}: updated ${path.relative(process.cwd(), file)}`, 'success');
}

function setupIOS({ root, dryRun, skipPods }) {
  const iosDir = path.join(root, 'ios');
  if (!fs.existsSync(iosDir)) {
    log('ios/ not found, skipping iOS setup', 'warning');
    return;
  }
  const plist = findFile(iosDir, (name, full) => name === 'Info.plist' && !full.includes('Tests') && fs.readFileSync(full, 'utf8').includes('CFBundleExecutable'));
  if (plist) {
    const original = fs.readFileSync(plist, 'utf8');
    writeIfChanged(plist, patchInfoPlist(original).xml, original, dryRun, 'Info.plist');
  } else {
    log('App Info.plist not found; add BGTaskSchedulerPermittedIdentifiers manually (see README)', 'warning');
  }

  const delegate = findFile(iosDir, (name) => name === 'AppDelegate.mm' || name === 'AppDelegate.m' || name === 'AppDelegate.swift');
  if (delegate) {
    const original = fs.readFileSync(delegate, 'utf8');
    try {
      const { source } = patchAppDelegate(original, delegate.endsWith('.swift') ? 'swift' : 'objc');
      writeIfChanged(delegate, source, original, dryRun, 'AppDelegate');
    } catch (error) {
      log(`AppDelegate: ${error.message}; add the background URLSession hook manually (see README)`, 'warning');
    }
  } else {
    log('AppDelegate not found; add the background URLSession hook manually (see README)', 'warning');
  }

  if (!skipPods && !dryRun) {
    try {
      execSync('pod install', { cwd: iosDir, stdio: 'inherit', env: { ...process.env, RCT_NEW_ARCH_ENABLED: '1' } });
    } catch {
      log('pod install failed; run it manually: cd ios && pod install', 'warning');
    }
  }
}

function setupAndroid({ root, dryRun }) {
  const androidDir = path.join(root, 'android');
  if (!fs.existsSync(androidDir)) {
    log('android/ not found, skipping Android setup', 'warning');
    return;
  }
  const props = path.join(androidDir, 'gradle.properties');
  if (fs.existsSync(props)) {
    const original = fs.readFileSync(props, 'utf8');
    writeIfChanged(props, patchGradleProperties(original).text, original, dryRun, 'gradle.properties (newArchEnabled)');
  }
  const manifest = path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml');
  if (fs.existsSync(manifest)) {
    const problems = checkAndroidManifest(fs.readFileSync(manifest, 'utf8'));
    if (problems.length === 0) log('AndroidManifest.xml: permissions and dataSync foreground service merge from the library', 'success');
    problems.forEach((p) => log(`AndroidManifest.xml: ${p}`, 'warning'));
  }
}

function main(argv = process.argv.slice(2)) {
  const root = process.cwd();
  const dryRun = argv.includes('--dry-run');
  const skipPods = argv.includes('--skip-pods');
  const pkgPath = path.join(root, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    log('package.json not found. Run this from your React Native app root.', 'error');
    process.exit(1);
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!deps['react-native']) {
    log('This does not look like a React Native app (react-native is not a dependency).', 'error');
    process.exit(1);
  }
  if (!deps[PACKAGE_NAME]) log(`${PACKAGE_NAME} is not in package.json; install it first: npm install ${PACKAGE_NAME}`, 'warning');

  log(`${PACKAGE_NAME} setup${dryRun ? ' (dry run)' : ''}`);
  setupIOS({ root, dryRun, skipPods });
  setupAndroid({ root, dryRun });

  console.log(`
Next steps:
  1. Configure once at startup (outside React), e.g. in index.js:
       import { SyncVault } from '${PACKAGE_NAME}';
       SyncVault.configure({ baseUrl: 'https://api.example.com', getAuthHeaders: async () => ({ Authorization: \`Bearer \${await getToken()}\` }) });
  2. Queue writes:  await SyncVault.enqueue({ method: 'POST', url: '/todos', body: todo, queueKey: \`todo:\${todo.id}\` });
  3. Make your API follow docs/BACKEND_CONTRACT.md (Idempotency-Key, If-Match, Retry-After).
  4. Rebuild the app (native code changed).
`);
}

if (require.main === module) main();

module.exports = {
  main,
  patchInfoPlist,
  ensurePlistArray,
  patchAppDelegate,
  patchGradleProperties,
  checkAndroidManifest,
  BG_TASK_IDS,
  BACKGROUND_MODES,
};
