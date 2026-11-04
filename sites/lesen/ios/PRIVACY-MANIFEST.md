# iOS privacy manifest inventory

`App/App/PrivacyInfo.xcprivacy` ships inside the App target (it is listed in the
`PBXResourcesBuildPhase` of `App.xcodeproj/project.pbxproj`). The manifest is
owner-merged; this file records the audit behind it so a plugin or Capacitor
upgrade can be re-checked without guessing.

## Declared required-reason APIs

| Category | Reason | Where it is used | Why this reason |
| --- | --- | --- | --- |
| `NSPrivacyAccessedAPICategoryFileTimestamp` | `C617.1` | `@capacitor/filesystem` 8.1.5 `stat`, which calls `FileManager.attributesOfItem` through `IONFilesystemLib` 2.0.1 | The app reads creation/modification timestamps only for files it writes in its own container (cache export for the share sheet). `C617.1` covers timestamps and other metadata of files in the app container. |

No other required-reason API is declared because none is used by the shell or
its pinned dependencies:

- `NSPrivacyAccessedAPICategoryUserDefaults`: no `UserDefaults` use in
  Capacitor 8.6.0 core (checked in the `Capacitor.xcframework` binary) or in
  the app, filesystem, haptics, local-notifications and share plugin sources.
- `NSPrivacyAccessedAPICategoryDiskSpace`: no
  `volumeAvailableCapacity*`/`statfs` use in those sources.
- `NSPrivacyAccessedAPICategorySystemBootTime`: no `systemUptime` use.
- `NSPrivacyAccessedAPICategoryActiveKeyboards`: no keyboard enumeration.

## Data collection and tracking

`NSPrivacyTracking` is `false`, `NSPrivacyTrackingDomains` is empty and
`NSPrivacyCollectedDataTypes` is empty. The app has no analytics or advertising
SDK; its only dependencies are the Capacitor shell and the five local
capability plugins. All generated reports, progress and audio stay in the app
container or the system share sheet.

## Re-audit

Repeat the source check whenever `@capacitor/*` versions in `package-lock.json`
change:

```bash
npm ci
grep -rn 'UserDefaults\|systemUptime\|volumeAvailableCapacity\|attributesOfItem\|fileModificationDate' \
  node_modules/@capacitor/*/ios node_modules/@capacitor/*/*/ios
```

Then confirm the manifest still parses, carries a reason per category, and is
bundled:

```bash
python3 -c "import plistlib;m=plistlib.load(open('ios/App/App/PrivacyInfo.xcprivacy','rb'));a=m.get('NSPrivacyAccessedAPITypes',[]);assert a and all(x.get('NSPrivacyAccessedAPITypeReasons') for x in a);assert not m.get('NSPrivacyTracking');assert not m.get('NSPrivacyTrackingDomains');print('manifest ok')"
```

`plutil -lint` on the built app's `PrivacyInfo.xcprivacy` and the harness iOS
smoke check additionally verify the bundled copy.
