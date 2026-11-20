// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "TagwerkCore",
    platforms: [.iOS(.v18), .macOS(.v14)],
    products: [.library(name: "TagwerkCore", targets: ["TagwerkCore"])],
    targets: [
        .target(name: "TagwerkCore"),
        .testTarget(name: "TagwerkCoreTests", dependencies: ["TagwerkCore"]),
    ]
)
