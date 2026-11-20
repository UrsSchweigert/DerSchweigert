// swift-tools-version:5.9
import PackageDescription

// Foundation only and no dependencies: a worker sandbox can build and test this package without a Mac.
let package = Package(
    name: "ProtoKit",
    products: [
        .library(name: "ProtoKit", targets: ["ProtoKit"]),
        .library(name: "ProtoAnalysis", targets: ["ProtoAnalysis"]),
        .executable(name: "ProtoAnalyse", targets: ["ProtoAnalyse"]),
    ],
    targets: [
        .target(name: "ProtoKit"),
        // The analysis is a library so tests can import it; the executable is only argument handling.
        .target(name: "ProtoAnalysis", dependencies: ["ProtoKit"]),
        .executableTarget(name: "ProtoAnalyse", dependencies: ["ProtoAnalysis"]),
        .testTarget(name: "ProtoKitTests", dependencies: ["ProtoKit"]),
        .testTarget(name: "ProtoAnalyseTests", dependencies: ["ProtoAnalysis", "ProtoKit"]),
    ]
)
