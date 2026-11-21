import UIKit

@MainActor
struct BackgroundTask {
    private let id: UIBackgroundTaskIdentifier

    // The expiration handler needs the id it is being created for, so it reads it through a box.
    @MainActor private final class IDBox { var id = UIBackgroundTaskIdentifier.invalid }

    static func begin(_ name: String) -> BackgroundTask {
        let box = IDBox()
        box.id = UIApplication.shared.beginBackgroundTask(withName: name) {
            UIApplication.shared.endBackgroundTask(box.id)
        }
        return BackgroundTask(id: box.id)
    }

    func end() {
        if id != .invalid { UIApplication.shared.endBackgroundTask(id) }
    }
}
