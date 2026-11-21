import SwiftUI

@main
struct TranscriberApp: App {
    @State private var model = AppModel(settings: Settings())

    var body: some Scene {
        WindowGroup { ContentView().environment(model) }
    }
}
