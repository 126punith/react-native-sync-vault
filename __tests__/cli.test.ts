import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const cli = require('../cli/index.js');

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
	<key>CFBundleExecutable</key>
	<string>$(EXECUTABLE_NAME)</string>
	<key>UIBackgroundModes</key>
	<array>
		<string>remote-notification</string>
	</array>
</dict>
</plist>
`;

const OBJC = `#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

@end
`;

const SWIFT = `import UIKit
import React

@main
class AppDelegate: RCTAppDelegate {
  override func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey : Any]? = nil) -> Bool {
    if true { print("nested") }
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`;

describe('sync-vault-init', () => {
  describe('Info.plist', () => {
    it('adds the BGTaskScheduler identifiers and merges background modes', () => {
      const { xml, changed } = cli.patchInfoPlist(PLIST);
      expect(changed).toBe(true);
      expect(xml).toMatch(/<key>BGTaskSchedulerPermittedIdentifiers<\/key>\s*<array>\s*<string>com.syncvault.drain<\/string>\s*<string>com.syncvault.refresh<\/string>/);
      expect(xml).toMatch(/<string>remote-notification<\/string>\s*<string>processing<\/string>\s*<string>fetch<\/string>\s*<\/array>/);
      expect(cli.patchInfoPlist(xml)).toEqual({ xml, changed: false });
    });

    it('fills an empty array and rejects files without a dict', () => {
      const xml = cli.ensurePlistArray('<plist><dict><key>UIBackgroundModes</key><array/></dict></plist>', 'UIBackgroundModes', ['fetch']);
      expect(xml).toContain('<array>');
      expect(xml).toContain('<string>fetch</string>');
      expect(() => cli.ensurePlistArray('<plist/>', 'X', ['y'])).toThrow(/dict/);
    });
  });

  describe('AppDelegate', () => {
    it('adds the ObjC import and background URLSession hook once', () => {
      const { source, changed } = cli.patchAppDelegate(OBJC, 'objc');
      expect(changed).toBe(true);
      expect(source.indexOf('SyncVaultAppDelegate.h')).toBeGreaterThan(source.indexOf('#import "AppDelegate.h"'));
      expect(source).toMatch(/handleEventsForBackgroundURLSession:\(NSString \*\)identifier[\s\S]*\[SyncVaultAppDelegate handleEventsForBackgroundURLSession:identifier completionHandler:completionHandler\];\n}\n\n?@end/);
      expect(cli.patchAppDelegate(source, 'objc')).toEqual({ source, changed: false });
    });

    it('adds the Swift method inside the AppDelegate class and the module import', () => {
      const { source } = cli.patchAppDelegate(SWIFT, 'swift');
      expect(source).toMatch(/^import React\nimport react_native_sync_vault$/m);
      const method = source.indexOf('handleEventsForBackgroundURLSession identifier');
      expect(method).toBeGreaterThan(source.indexOf('return super.application'));
      expect(source.trimEnd().endsWith('}')).toBe(true);
      // The method sits before the class's closing brace.
      expect(source.slice(method).match(/}/g)!.length).toBe(2);
    });

    it('fails clearly on unrecognised files', () => {
      expect(() => cli.patchAppDelegate('int main() {}', 'objc')).toThrow(/@implementation AppDelegate/);
      expect(() => cli.patchAppDelegate('struct App {}', 'swift')).toThrow(/class AppDelegate/);
    });
  });

  describe('Android', () => {
    it('enables the New Architecture in gradle.properties', () => {
      expect(cli.patchGradleProperties('a=b')).toEqual({ text: 'a=b\nnewArchEnabled=true\n', changed: true });
      expect(cli.patchGradleProperties('newArchEnabled=false\n').text).toBe('newArchEnabled=true\n');
      expect(cli.patchGradleProperties('newArchEnabled=true\n').changed).toBe(false);
    });

    it('flags manifests that strip permissions the outbox needs', () => {
      const xml = `<manifest xmlns:tools="http://schemas.android.com/tools">
        <uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" tools:node="remove" />
        <service android:name="androidx.work.impl.foreground.SystemForegroundService" tools:node="remove" />
      </manifest>`;
      const problems = cli.checkAndroidManifest(xml);
      expect(problems.join('\n')).toMatch(/FOREGROUND_SERVICE_DATA_SYNC/);
      expect(problems.join('\n')).toMatch(/SystemForegroundService/);
      expect(cli.checkAndroidManifest('<manifest/>')).toEqual([]);
    });
  });

  describe('end to end', () => {
    let root: string;
    let cwd: string;
    let log: jest.SpyInstance;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'sv-cli-'));
      cwd = process.cwd();
      writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { 'react-native': '0.76.0', 'react-native-sync-vault': '2.0.0' } }));
      mkdirSync(join(root, 'ios', 'App'), { recursive: true });
      writeFileSync(join(root, 'ios', 'App', 'Info.plist'), PLIST);
      writeFileSync(join(root, 'ios', 'App', 'AppDelegate.mm'), OBJC);
      mkdirSync(join(root, 'android', 'app', 'src', 'main'), { recursive: true });
      writeFileSync(join(root, 'android', 'gradle.properties'), 'org.gradle.jvmargs=-Xmx2048m\n');
      writeFileSync(join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), '<manifest/>');
      process.chdir(root);
      log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
      log.mockRestore();
      process.chdir(cwd);
      rmSync(root, { recursive: true, force: true });
    });

    it('patches a project and is idempotent', () => {
      cli.main(['--skip-pods']);
      const plist = readFileSync(join(root, 'ios', 'App', 'Info.plist'), 'utf8');
      const delegate = readFileSync(join(root, 'ios', 'App', 'AppDelegate.mm'), 'utf8');
      const props = readFileSync(join(root, 'android', 'gradle.properties'), 'utf8');
      expect(plist).toContain('com.syncvault.drain');
      expect(delegate).toContain('SyncVaultAppDelegate');
      expect(props).toContain('newArchEnabled=true');

      cli.main(['--skip-pods']);
      expect(readFileSync(join(root, 'ios', 'App', 'AppDelegate.mm'), 'utf8')).toBe(delegate);
      expect(readFileSync(join(root, 'ios', 'App', 'Info.plist'), 'utf8')).toBe(plist);
    });

    it('changes nothing in --dry-run mode', () => {
      cli.main(['--dry-run']);
      expect(readFileSync(join(root, 'ios', 'App', 'Info.plist'), 'utf8')).toBe(PLIST);
      expect(readFileSync(join(root, 'ios', 'App', 'AppDelegate.mm'), 'utf8')).toBe(OBJC);
    });
  });
});
