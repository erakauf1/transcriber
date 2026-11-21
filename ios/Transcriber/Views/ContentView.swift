import SwiftUI

struct ContentView: View {
    @Environment(AppModel.self) private var model
    @Environment(HistoryLock.self) private var lock
    @Environment(\.scenePhase) private var scenePhase
    @State private var showSettings = false
    @State private var showHistory = false

    var body: some View {
        NavigationStack {
            Group {
                switch model.state.phase {
                case .idle: IdleView()
                case .recording: RecordingView()
                case .transcribing, .cleaning: ProcessingView()
                case .result: ResultView()
                case .interrupted: InterruptedView()
                }
            }
            .padding()
            .toolbar {
                if model.state.phase == .idle {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("History", systemImage: "clock") { showHistory = true }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Settings", systemImage: "gear") { showSettings = true }
                    }
                }
            }
        }
        .sheet(isPresented: $showSettings) { SettingsView(settings: model.settings) }
        .sheet(isPresented: $showHistory) { HistoryView() }
        .overlay(alignment: .top) {
            if let toast = model.toast {
                Text(toast).padding(.horizontal, 16).padding(.vertical, 8)
                    .background(.thinMaterial, in: Capsule()).padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.default, value: model.toast)
        .onChange(of: scenePhase) { _, phase in
            model.scenePhaseChanged(phase)
            if phase == .background { lock.didEnterBackground() }
            if phase == .active { lock.didBecomeActive() }
        }
        .onChange(of: model.state.phase) { _, phase in if phase != .idle { showHistory = false } }
    }
}

private struct InterruptedView: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        VStack(spacing: 16) {
            Text("Recording was interrupted").font(.headline)
            Text("The audio up to the interruption was kept.").foregroundStyle(.secondary)
            Button("Transcribe it") { model.transcribeInterrupted() }.buttonStyle(.borderedProminent)
            Button("Discard", role: .destructive) { model.reset() }
        }
    }
}
