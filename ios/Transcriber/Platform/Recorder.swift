import AVFoundation
import TranscriberCore

@MainActor
final class Recorder: NSObject, AVAudioRecorderDelegate {
    enum FinishReason { case user, cap, interrupted }
    struct StartError: LocalizedError { var errorDescription: String? { "Could not start recording" } }

    static let maxDuration: TimeInterval = 300

    var onTick: (TimeInterval) -> Void = { _ in }
    var onLevel: (Double) -> Void = { _ in }
    var onVAD: (VADEvent) -> Void = { _ in }
    var onFinish: (URL, FinishReason) -> Void = { _, _ in }

    private var recorder: AVAudioRecorder?
    private var meterTimer: Timer?
    private var detector = SilenceDetector()
    private var interruptionObserver: NSObjectProtocol?

    var isRecording: Bool { recorder != nil }

    static func requestPermission() async -> Bool { await AVAudioApplication.requestRecordPermission() }

    func start() throws {
        guard recorder == nil else { throw StartError() }
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .default)
        try session.setActive(true)
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]
        let r = try AVAudioRecorder(url: try AudioFiles.newURL(), settings: settings)
        r.delegate = self
        r.isMeteringEnabled = true
        guard r.record(forDuration: Self.maxDuration) else { throw StartError() }
        recorder = r
        detector = SilenceDetector()
        meterTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.meterTick() }
        }
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { [weak self] note in
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            guard raw == AVAudioSession.InterruptionType.began.rawValue else { return }
            MainActor.assumeIsolated { self?.finish(.interrupted) }
        }
    }

    func stop() { finish(.user) }

    private func meterTick() {
        guard let r = recorder else { return }
        r.updateMeters()
        let peak = pow(10, Double(r.peakPower(forChannel: 0)) / 20)
        onLevel(peak)
        onTick(r.currentTime)
        if let event = detector.update(peak: peak, now: .now) { onVAD(event) }
    }

    private func finish(_ reason: FinishReason) {
        guard let r = recorder else { return }
        recorder = nil
        meterTimer?.invalidate(); meterTimer = nil
        if let o = interruptionObserver { NotificationCenter.default.removeObserver(o); interruptionObserver = nil }
        r.stop()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        onFinish(r.url, reason)
    }

    // Fires for the 5:00 cap, and also after our own stop() — by then `recorder` is nil, so it's a no-op.
    nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        Task { @MainActor in self.finish(.cap) }
    }
}
