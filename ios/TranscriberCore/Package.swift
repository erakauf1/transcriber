// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "TranscriberCore",
    platforms: [.iOS(.v26), .macOS(.v26)],
    products: [.library(name: "TranscriberCore", targets: ["TranscriberCore"])],
    targets: [
        .target(name: "TranscriberCore"),
        .testTarget(name: "TranscriberCoreTests", dependencies: ["TranscriberCore"]),
    ]
)
