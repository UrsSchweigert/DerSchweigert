# Tagwerk architecture

Tagwerk records a working day on the iPhone and on a computer and shows one derived day. There is no server and no
account: nothing leaves the owner's devices except over the direct Bluetooth link between them.

## Layers

- **Core** (`Core/`, Foundation-only Swift package). Observations, edits, the derivation of the day, the link
  protocol's wire format and the log format. It imports nothing but Foundation, so `swift test` runs it in the Linux
  sandbox and on CI.
- **Apple** (`Apple/`, Swift package). The targets that need Apple frameworks (CoreBluetooth, CoreLocation, SwiftUI,
  WidgetKit and similar). Only a Mac compiles and tests them. Packages depend on Core by local path.
- **App** (`App/`, Xcode project the owner creates). Thin targets that only wire Apple packages together. No logic
  lives here, so the part nobody can test without Xcode stays small.
- **prototype** (`prototype/`). Throwaway: measures the Bluetooth link alone. Nothing moves from it into Core, Apple
  or App except lessons.

No package takes a downloaded dependency (`scripts/check-no-third-party.sh`).

## The link

The iPhone is the BLE **central**; the computer is the **GATT peripheral** that advertises one service. The protocol
is defined in terms of GATT characteristics and Core's wire format only, so nothing in it is Mac-only: any computer
that can act as a peripheral can take the Mac's place later. The iPhone connects directly, with no relay and no
cloud (requirements D3 direct link, D5 no third parties).

## The day

State is a list of **observations** (what a device saw: link up or down, place entered or left, with a timestamp and
the device that saw it) plus **edits** (what the owner corrected). The day is a pure function of both: nothing
stores a derived day, so a better derivation re-reads old data and an edit never rewrites an observation. Each
device keeps its own list; the link exchanges the entries the other side lacks, and both sides derive the same day.
