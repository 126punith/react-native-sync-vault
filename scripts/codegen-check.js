#!/usr/bin/env node
'use strict';

/**
 * Verifies the Turbo Module spec is valid for React Native codegen and that both native modules
 * implement every method and emit every event it declares:
 *
 *   - src/specs/NativeSyncVault.ts parses with @react-native/codegen (the same parser the app build runs)
 *   - android/.../SyncVaultModule.kt overrides each method and calls emitOn<Event>
 *   - ios/RNSyncVault.mm implements each selector and calls emitOn<Event>
 *   - package.json codegenConfig points at the spec directory and Android package
 *
 * Exits non-zero with a list of problems. Run in CI (npm run codegen:check).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SPEC = path.join(ROOT, 'src/specs/NativeSyncVault.ts');
const KOTLIN = path.join(ROOT, 'android/src/main/java/com/syncvault/SyncVaultModule.kt');
const OBJC = path.join(ROOT, 'ios/RNSyncVault.mm');

function parseSpec() {
  let TypeScriptParser;
  try {
    ({ TypeScriptParser } = require('@react-native/codegen/lib/parsers/typescript/parser'));
  } catch (error) {
    throw new Error(`@react-native/codegen is not installed (it ships with react-native): ${error.message}`);
  }
  const schema = new TypeScriptParser().parseFile(SPEC);
  const modules = Object.values(schema.modules).filter((m) => m.type === 'NativeModule');
  if (modules.length !== 1) throw new Error(`expected exactly one NativeModule in the spec, found ${modules.length}`);
  return modules[0];
}

function check() {
  const problems = [];
  const module = parseSpec();
  const methods = module.spec.methods.map((m) => m.name);
  const events = (module.spec.eventEmitters || []).map((e) => e.name);
  const emitName = (event) => `emit${event[0].toUpperCase()}${event.slice(1)}`;

  const kotlin = fs.readFileSync(KOTLIN, 'utf8');
  const objc = fs.readFileSync(OBJC, 'utf8');

  for (const name of methods) {
    if (!new RegExp(`override\\s+fun\\s+${name}\\s*\\(`).test(kotlin)) problems.push(`Android: SyncVaultModule.kt does not override ${name}()`);
    if (!new RegExp(`^-\\s*\\([^)]*\\)\\s*${name}\\b`, 'm').test(objc)) problems.push(`iOS: RNSyncVault.mm does not implement -${name}`);
  }
  for (const event of events) {
    if (!kotlin.includes(`${emitName(event)}(`)) problems.push(`Android: SyncVaultModule.kt never calls ${emitName(event)}()`);
    if (!objc.includes(`${emitName(event)}:`)) problems.push(`iOS: RNSyncVault.mm never calls ${emitName(event)}:`);
  }

  if (!/RCT_EXPORT_MODULE\(SyncVault\)/.test(objc)) problems.push('iOS: RNSyncVault.mm must use RCT_EXPORT_MODULE(SyncVault)');
  if (!/NativeSyncVaultSpecJSI/.test(objc)) problems.push('iOS: getTurboModule must return NativeSyncVaultSpecJSI');
  if (!/:\s*NativeSyncVaultSpec\(/.test(kotlin)) problems.push('Android: SyncVaultModule must extend the generated NativeSyncVaultSpec');

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const cfg = pkg.codegenConfig || {};
  if (cfg.type !== 'modules') problems.push('package.json codegenConfig.type must be "modules"');
  if (path.resolve(ROOT, cfg.jsSrcsDir || '') !== path.dirname(SPEC)) problems.push('package.json codegenConfig.jsSrcsDir must be src/specs');
  if (!cfg.android || cfg.android.javaPackageName !== 'com.syncvault') problems.push('package.json codegenConfig.android.javaPackageName must be com.syncvault');

  return { problems, methods, events, name: module.moduleName };
}

function main() {
  let result;
  try {
    result = check();
  } catch (error) {
    console.error(`codegen check failed: ${error.message}`);
    process.exit(1);
  }
  if (result.problems.length > 0) {
    console.error(`codegen check found ${result.problems.length} problem(s):\n  - ${result.problems.join('\n  - ')}`);
    process.exit(1);
  }
  console.log(`codegen check passed: ${result.name} (${result.methods.length} methods, ${result.events.length} events) on Android and iOS`);
}

if (require.main === module) main();

module.exports = { check };
