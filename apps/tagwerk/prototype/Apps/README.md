# Prototype apps (Mac peripheral)

`ProtoMac` is a menu-bar app that advertises one Bluetooth service, pings a subscribed phone about once a minute,
shows the prototype check-in and the pairing code, and writes a JSON-lines log in the ProtoKit format to the temp
folder; it prints the log path at start. `ProtoPhone` is a placeholder. UUIDs and the text messages are in
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
