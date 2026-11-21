import SwiftUI

@main
struct TranscriberApp: App {
    @State private var model: AppModel
    @State private var history: HistoryStore

    init() {
        let history = HistoryStore(container: HistoryStore.makeContainer())
        let model = AppModel(settings: Settings())
        model.onNoteChanged = { [weak history] in history?.upsert($0) }
        _history = State(initialValue: history)
        _model = State(initialValue: model)
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(model)
                .environment(history)
                .modelContainer(history.container)
        }
    }
}
