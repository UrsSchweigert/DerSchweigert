// swift-tools-version:5.9
import PackageDescription

// Foundation only and no dependencies: a worker sandbox can build and test this package without a Mac.
let package = Package(
    name: "ProtoKit",
    products: [
        .library(name: "ProtoKit", targets: ["ProtoKit"]),
        .executable(name: "ProtoAnalyse", targets: ["ProtoAnalyse"]),
    ],
    targets: [
        .target(name: "ProtoKit"),
        .executableTarget(name: "ProtoAnalyse", dependencies: ["ProtoKit"]),
        .testTarget(name: "ProtoKitTests", dependencies: ["ProtoKit"]),
    ]
)
