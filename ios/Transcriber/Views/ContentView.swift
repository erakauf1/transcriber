import SwiftUI

struct ContentView: View {
    @Environment(AppModel.self) private var model
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
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(.systemGroupedBackground).ignoresSafeArea())
            .toolbar {
                if model.state.phase == .idle {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("History", systemImage: "clock") { showHistory = true }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Settings", systemImage: "gearshape") { showSettings = true }
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
        .onChange(of: model.state.phase) { _, phase in if phase != .idle { showHistory = false } }
    }
}

private struct InterruptedView: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        VStack(spacing: 16) {
            Spacer()
            VStack(spacing: 8) {
                Image(systemName: "pause.circle.fill").font(.largeTitle).foregroundStyle(.orange)
                Text("Recording was interrupted").font(.headline)
                Text("The audio up to the interruption was kept.")
                    .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .card(padding: 20)
            Button("Transcribe it") { model.transcribeInterrupted() }.buttonStyle(PrimaryButtonStyle())
            Button("Discard", role: .destructive) { model.reset() }
            Spacer()
        }
    }
}
