# Android target and app identity

Arithmoslayer records its identity and Android target in the project so a
release is reproducible, but it deliberately contains **no export preset, no
Android build template, and no signing material**. Those artifacts belong to
the human owner of the release and stay outside this repository.

## Recorded values

| Value | Source |
| --- | --- |
| App name | `project.godot` → `application/config/name` = `Arithmoslayer` |
| Package id | `project.godot` → `application/config/android_package` = `de.derschweigert.arithmoslayer` |
| versionName | `VERSION` → `versionName`, mirrored in `project.godot` → `application/config/version` |
| versionCode | `VERSION` → `versionCode` |
| minSdk | `data/android_targets.json` → `minSdk` = `24` |
| targetSdk | `data/android_targets.json` → `targetSdk` = `36` |
| Orientation | `project.godot` → `display/window/handheld/orientation=0` (landscape on phones and tablets) |
| Permissions | `data/android_targets.json` → `permissions` = `com.android.vending.BILLING` only |

`data/android_targets.json` carries a `source` note that records where the SDK
levels come from. `test/unit/test_app_identity.gd` fails when any of these
values drift or when the project requests a second permission.

## Human-owned export preset

The release owner creates the Android export preset in the Godot editor. It
must use the recorded values:

1. Install the Android build template for Godot 4.7.2 (`Project → Install
   Android Build Template`); the template is generated locally and is not
   committed.
2. Create an `Android` export preset and set **Package → Unique Name** to
   `de.derschweigert.arithmoslayer`.
3. Set **Version → Code** to the `versionCode` from `VERSION` and
   **Version → Name** to its `versionName`.
4. Set **Min SDK** to `24` and **Target SDK** to `36`, matching
   `data/android_targets.json`.
5. Set **Screen → Orientation** to `Landscape`; the project setting already
   forces landscape on phones and tablets.
6. Under **Permissions**, add `com.android.vending.BILLING` as the only custom
   permission. Leave the Internet switch and every other permission off; the
   game is offline first and `tools/check_offline.py` rejects additional
   permissions in tracked files.
7. Configure signing with a keystore that lives outside the repository. Never
   commit the keystore, its passwords, or a generated `export_presets.cfg`.

## AndroidManifest step

Godot generates the Android manifest from the export preset. If the release
uses a hand-maintained manifest, it must contain the billing permission and
nothing else beyond the permissions Godot adds by default. Do not add network,
storage, location, camera, or contacts permissions. `tools/check_offline.py`
fails the build when a tracked file requests a permission other than
`com.android.vending.BILLING`.

## Safe area

`scenes/ui/root.tscn` is the UI root and runs `scripts/ui/safe_area.gd`. On
startup and after every viewport resize it reads
`DisplayServer.get_display_safe_area()` and applies the four insets as margins
on the root `Control`, so the labels stay clear of notches, rounded corners,
and system bars in landscape. The conversion is a pure function tested with a
fake `Rect2i`, so it needs no device to verify.

## Verification

Run from `apps/arithmoslayer/`:

```sh
godot-test . -gtest=test_app_identity.gd
python3 tools/check_offline.py
python3 tools/check_isolation.py
```

Publishing to Play Console, signing, and production deployment are out of
scope for this project directory.
