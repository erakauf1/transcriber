import SwiftUI

@main
struct TranscriberApp: App {
    @State private var settings = Settings()
    var body: some Scene {
        WindowGroup { SettingsView(settings: settings) }
    }
}
