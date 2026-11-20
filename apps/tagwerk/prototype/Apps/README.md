# Prototype apps (Mac peripheral)

`ProtoMac` is a menu-bar app that advertises one Bluetooth service, pings a subscribed phone about once a minute,
shows the prototype check-in and the pairing code, and writes a JSON-lines log (path printed at start) in the
ProtoKit format. `ProtoPhone` is a placeholder. UUIDs and the text messages are in `ProtoKit/ProtoWire.swift`.

**Not proven by any worker:** a Mac must compile and run this package (`swift build` in this folder). The sandbox
only parses the sources and checks that the manifest has no downloaded dependency. Subscriber counts, acknowledgement
round-trip times and pairing methods are logged as `marker` labels (`ping_sent seq=… subscribers=…`,
`ack seq=… rtt_ms=…`, `subscribe …`, `pairing_shown …`).
