# Bluetooth link prototype: procedure for the owner

This prototype measures one thing: whether an iPhone can keep a Bluetooth link to your computer through a normal
working day, well enough to build Tagwerk on it. It is throwaway. Nothing here is production code.

**Not proven by any worker:** that the Mac and iPhone sources compile, and every device result. A worker can only run
`swift test` on `ProtoKit` and parse the other sources. Nobody has compiled `Apps/Sources` before step 6. Report a
compiler error as a GitHub issue with the full error text and the Xcode version.

**Not measured** (other phases cover them): geofence timing, Live Activity updates, and a Windows computer. The
prototype also has no buttons for the interruption markers (`interruption_call`, `interruption_meeting`,
`interruption_break`), so no time is excluded from the ping share; stay at the desk during the "at the desk" parts.

## 1. Build (once, about 30 minutes)

You need a Mac with Xcode 15 or newer, an iPhone on iOS 16 or newer, and your Apple team for signing.

1. In Xcode choose File > New > Project > **iOS > App** (SwiftUI) named `ProtoPhone`. Save the project
   **outside the repository**. Never commit it: it holds your team ID.
2. In the same project add a target: File > New > Target > **macOS > App** named `ProtoMac`.
3. Delete the template Swift files Xcode made. Drag the files of `Apps/Sources/ProtoPhone` into the iOS target only
   (untick the macOS target) and `Apps/Sources/ProtoMac` into the macOS target only. Choose "Reference files in place".
   `ProtoMac/main.swift` is the entry point; remove any `@main` template.
4. Add the package: File > Add Package Dependencies > Add Local > `prototype/ProtoKit`. Add the product `ProtoKit` to
   both targets. Nothing is downloaded.
5. Info.plist and capabilities:
   - iOS target: `NSBluetoothAlwaysUsageDescription` = "Tagwerk prototype measures the link to your computer";
     `UIBackgroundModes` = `bluetooth-central`; URL type with scheme `tagwerkproto`.
   - macOS target: `NSBluetoothAlwaysUsageDescription` (same text); `LSUIElement` = YES; under Signing & Capabilities
     tick App Sandbox > Hardware > Bluetooth.
6. Signing: pick your team for both targets (automatic signing). Run `ProtoMac` on the Mac, then `ProtoPhone` on the
   iPhone. Allow Bluetooth on both and allow notifications on the phone. Run the phone app once, then leave it.
7. The Mac prints `log file: <path>` in the Xcode console. Start it with the argument `--checkin-after 90`
   (Product > Scheme > Edit Scheme > Arguments) so a check-in appears every 90 minutes.

## 2. Day protocol

Run the apps for a whole working day (at least 6 hours) with the Mac plugged in and the phone unplugged. Note the
phone battery percentage at the start and end. Each row names the phone button to tap, shown as `button` (the label
it logs). Tap the marker at the moment you do the step.

| When | Step | Marker button (label) |
| --- | --- | --- |
| Start | Sit at the desk with the phone beside the Mac | `At the desk` (`near`) |
| Start | Calibrate RSSI: stand 1 m, 2 m and 5 m away for 2 minutes each, then in the next room for 2 minutes | `1 m` (`distance_1m`), `2 m` (`distance_2m`), `5 m` (`distance_5m`), `Next room` (`distance_next_room`) |
| Start | Back at the desk | `At the desk` (`near`) |
| Hour 1 | Lay the phone face up for 3 minutes, then face down for 3 minutes. Repeat once. | `Face up` (`face_up`), `Face down` (`face_down`) |
| Hour 1 | Lock the phone for 10 minutes | `Locked` (`locked`) |
| Hour 2 | Put the phone in a bag at the desk for 10 minutes | `In a bag` (`in_bag`) |
| Hour 2 | Leave the room for 20 minutes with the phone, then return | `Left` (`away`), then `Back` (`near`) |
| Hour 3 | Turn phone Bluetooth off for 3 minutes, then on. No marker: the log records the state. | none |
| Hour 3 | Close the Mac lid for 5 minutes (sleep), then wake it. No marker. | none |
| Hour 4 | Restart the phone, do not open the app. Wait 10 minutes. No marker. | none |
| Hour 4 | Swipe `ProtoPhone` away in the app switcher, do not open it. Wait 10 minutes. No marker. | none |
| Any time | Answer two check-ins on the phone (notification) and two on the Mac (panel) | none; the apps log them |
| Any time | Pair twice: once with `Pair with number` (type the code from the Mac menu "Show pairing code"), once by pointing the Camera app at the QR code | none; the apps log `pairing` |
| First hour | Note whether iOS asked for a motion or sensor permission | `Sensor prompt seen` or `Sensor prompt not seen` |
| Rest | Work as usual with the phone in a pocket or on the desk | none |

At the end, tap `At the desk` once more if you are at the desk. Get the phone log with `Share log` (AirDrop it to the
Mac) and take the Mac log from the path printed in step 1.7.

## 3. Analyse

From `apps/tagwerk`:

```
swift run --package-path prototype/ProtoKit ProtoAnalyse <phone.log> <computer.log> prototype/thresholds.json
```

The analyser prints a verdict per threshold and an overall verdict: `go`, `no-go` (a threshold is not met) or
`incomplete` (a threshold could not be measured, usually because a marker or event is missing: repeat that step).

## 4. Thresholds

Each key is in `prototype/thresholds.json`. `min_` needs the value at or above the limit, `max_` at or below.

| Threshold | Proposed | Protects | If not met |
| --- | --- | --- | --- |
| `min_ping_share_near_awake` | 0.95 | T1 | Stop and revise the link design before P7 |
| `max_ordinary_gap_minutes` | 5 | T1 | Go with a changed grace default if the gap is under 15 minutes, otherwise stop and revise |
| `min_orientation_read_share` | 0.95 | C1 | Stop and revise: orientation cannot be read in the background |
| `max_rssi_error_rate` | 0.1 | C1 | Go with a changed grace default: near and away cannot rely on RSSI alone |
| `max_reconnect_minutes_max` | 2 | T2 | Go with a changed grace default equal to the longest reconnect |
| `min_idle_agree_share` | 0.95 | T2 | Stop and revise: the computer idle time does not match what you did |
| `min_checkin_complete_share` | 0.95 | K3 | Stop and revise: a check-in on either device does not clear the other |
| `max_checkin_latency_s_max` | 10 | K3 | Go with a changed grace default (a slow check-in answer must not count as absent) |
| `max_battery_drop_per_hour` | 10 | T1 | Stop and revise the link design: the phone cost is too high |

If every threshold is met the plan is **go**. The pairing table in the report is informational: pick the method that
succeeded more often and was faster, and record it.

## 5. Record the decision

Save this as `apps/tagwerk/prototype/RESULT.md` and send it with the two logs (check them for personal data first):

```
# Prototype result
Date:
Devices (Mac model, iPhone model):
OS versions (macOS, iOS):
Xcode version:
Verdict per threshold (met / not met / not measured, with the value):
- min_ping_share_near_awake:
- max_ordinary_gap_minutes:
- min_orientation_read_share:
- max_rssi_error_rate:
- max_reconnect_minutes_max:
- min_idle_agree_share:
- min_checkin_complete_share:
- max_checkin_latency_s_max:
- max_battery_drop_per_hour:
Sensor prompt seen: yes / no
Pairing: number x of y, QR x of y
Decision: go / go with a changed grace default (value) / stop and revise the link design before P7
```
