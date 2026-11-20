// swift-tools-version:5.9
import PackageDescription

// A Mac must compile this package: the sandbox only parses the sources. Local path dependency, nothing downloaded.
let package = Package(
    name: "Apps",
    platforms: [.macOS(.v13), .iOS(.v16)],
    dependencies: [.package(path: "../ProtoKit")],
    targets: [
        .executableTarget(name: "ProtoMac", dependencies: [.product(name: "ProtoKit", package: "ProtoKit")]),
        .executableTarget(name: "ProtoPhone", dependencies: [.product(name: "ProtoKit", package: "ProtoKit")]),
    ]
)
