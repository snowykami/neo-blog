// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "NeoBlogIsland",
    platforms: [
        .macOS(.v15)
    ],
    products: [
        .executable(name: "NeoBlogIsland", targets: ["NeoBlogIsland"])
    ],
    targets: [
        .executableTarget(
            name: "NeoBlogIsland",
            path: "Sources/NeoBlogIsland",
            swiftSettings: [
                .swiftLanguageMode(.v5)
            ]
        ),
        .testTarget(
            name: "NeoBlogIslandTests",
            dependencies: ["NeoBlogIsland"],
            path: "Tests/NeoBlogIslandTests",
            swiftSettings: [
                .swiftLanguageMode(.v5)
            ]
        )
    ],
    swiftLanguageModes: [.v5]
)
