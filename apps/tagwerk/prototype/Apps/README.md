# Prototype apps (Mac peripheral)

`ProtoMac` is a menu-bar app that advertises one Bluetooth service, pings a subscribed phone about once a minute,
shows the prototype check-in and the pairing code, and writes a JSON-lines log in the ProtoKit format to the temp
folder; it prints the log path at start. `ProtoPhone` is the iPhone app (below). UUIDs and the text messages are in
`ProtoKit/Sources/ProtoKit/ProtoWire.swift`, the log events in `LogEvent.swift`.

Run on a Mac: `swift run ProtoMac [--checkin-after <minutes>]`. The check-in also opens from the menu.

What the computer log carries, by `event` (every value is a JSON key, none is hidden in a `marker` label):

| Event | Keys |
| --- | --- |
| `ping_sent` | `seq`, `sender_ms`, `subscribers` (centrals on the ping characteristic), `queued` (false: the stack refused it and the ping is dropped) |
| `subscribe`, `unsubscribe` | `characteristic`, `subscribers` |
| `ack` | `seq`, `rtt_ms` (absent for an unknown or repeated sequence) |
| `bluetooth_state` | `state` |
| `computer_idle` | `idle_s`: seconds since the last input, from `CGEventSource`, once a minute |
| `computer_sleep`, `computer_wake` | none; from `NSWorkspace` notifications |
| `checkin_shown`, `checkin_answered`, `checkin_dismissed` | `id`; dismissed when the phone answered first or the panel closed unanswered |
| `pairing_shown` | none |
| `pairing` | `method` as the phone reports it (`qr` or `number`), `success` (the code matches), `duration_ms` from `pairing_shown` |

**Not proven by any worker:** a Mac must compile and run this package (`swift build` in this folder). The sandbox
only parses the sources and checks that the manifest has no downloaded dependency.

## ProtoPhone (iPhone central)

A SwiftUI app: `CBCentralManager` with restoration identifier `de.derschweigert.tagwerk.proto.central`, scans for the
service, connects without a timeout and reconnects after every disconnect, subscribes to the ping and events
characteristics, and on each ping logs `ping_received`, reads the accelerometer once (`orientation`) and writes the
acknowledgement. The log is `Documents/tagwerk-proto-phone-<time>.jsonl`; the screen has a share button. The screen
also has the marker buttons, the number field for pairing and the two sensor-prompt buttons. Pairing through the
Camera app arrives as a `tagwerkproto://pair?code=` link; the app never asks for the camera.

Owner setup in Xcode (the sandbox cannot do this): an iOS app target using these sources; Info.plist keys
`NSBluetoothAlwaysUsageDescription`, `UIBackgroundModes` = `bluetooth-central`, and URL scheme `tagwerkproto`.

Phone log, by `event` (keys not repeated from above):

| Event | Keys |
| --- | --- |
| `launch` | none; a launch by Bluetooth restoration is followed by `restore` |
| `bluetooth_state` | `state`: the raw `CBManagerState` number |
| `connect`, `disconnect` | `disconnect` has `reason` (error text; absent for a clean one) |
| `subscribe` | `characteristic`, `subscribers` (always 1 here) |
| `restore` | none; from `willRestoreState` |
| `ping_received` | `seq`, `sender_ms`, `app_state`, `restored_launch`, `rssi`, `background_remaining_s` (absent when unlimited) |
| `orientation` | `x`, `y`, `z`, `class`, `read_latency_ms` or `error` |
| `battery` | `level`, `charging`, `low_power_mode`; on every tenth ping |
| `notification_scheduled`, `notification_cancelled`, `checkin_shown`, `checkin_answered`, `checkin_dismissed` | `id` |
| `pairing` | `method`, `success` (the write to the computer succeeded), `duration_ms` from entry to the write result |
| `sensor_permission` | `prompt_seen`, from the two buttons |
| `marker` | `label`: `near`, `away`, `distance_1m`, `distance_2m`, `distance_5m`, `distance_next_room`, `face_up`, `face_down`, `locked`, `in_bag` |

**Not proven by any worker:** that ProtoPhone compiles or runs, and every device result. The sandbox only parses it.
