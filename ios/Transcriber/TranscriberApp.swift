import SwiftUI

@main
struct TranscriberApp: App {
    @State private var model: AppModel
    @State private var history: HistoryStore
    @State private var lock = HistoryLock()

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
                .id(ObjectIdentifier(history.container))
                .environment(model)
                .environment(history)
                .environment(lock)
                .modelContainer(history.container)
        }
    }
}
