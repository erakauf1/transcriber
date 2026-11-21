import SwiftUI

@main
struct TranscriberApp: App {
    @State private var model: AppModel
    @State private var history: HistoryStore
    @State private var lock = HistoryLock()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        let history = HistoryStore(container: HistoryStore.makeContainer())
        let model = AppModel(settings: Settings())
        model.onNoteChanged = { [weak history] in history?.upsert($0) }
        model.onNoteDiscarded = { [weak history] in history?.discardUntranscribed(id: $0) }
        history.ownedAudioFile = { [weak model] in model?.activeAudioFile }
        history.removeExports()
        history.retryPending()
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
        .onChange(of: scenePhase) { _, phase in
            model.scenePhaseChanged(phase)
            if phase != .active { lock.didEnterBackground() } else { lock.didBecomeActive() }
        }
    }
}
