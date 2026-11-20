# Tagwerk

Tagwerk records a working day on an iPhone and a computer and derives one day from the two. No server, no account,
no third-party code. Design: `docs/architecture.md`. Owner prerequisites: `docs/owner-setup.md`.

## Layout

| Path | What |
| --- | --- |
| `Core/` | Foundation-only Swift package (not yet created) |
| `Apple/` | Packages with Apple-framework targets (not yet created) |
| `App/` | Owner-created Xcode project with thin targets (not yet created) |
| `prototype/` | Throwaway Bluetooth-link prototype |
| `docs/` | Architecture, owner setup, `ci/tagwerk-workflow.yml` (a proposal text; the owner copies it) |
| `scripts/` | `check-swift-syntax.sh`, `check-no-third-party.sh`; run both from here with `.` as argument |

## What the sandbox proves, and what it does not

Proven in the sandbox: `swift test` for Foundation-only packages, the syntax of every Swift file (`swiftc -parse`),
and that no manifest declares a downloaded dependency.

Not proven by any worker: that the Mac and iPhone sources compile, and every device result. Only a Mac, and for
Bluetooth an iPhone, proves those.
