import Foundation

public enum DayTitle: Equatable, Sendable {
    case today, yesterday, date(Date)
}

public struct DayGroup<Item> {
    public let start: Date
    public let title: DayTitle
    public var items: [Item]
}

public func groupByDay<Item>(_ items: [Item], date: (Item) -> Date, now: Date,
                             calendar: Calendar = .current) -> [DayGroup<Item>] {
    let today = calendar.startOfDay(for: now)
    let yesterday = calendar.date(byAdding: .day, value: -1, to: today)!
    var groups: [DayGroup<Item>] = []
    for item in items {
        let start = calendar.startOfDay(for: date(item))
        if let last = groups.indices.last, groups[last].start == start {
            groups[last].items.append(item)
        } else {
            let title: DayTitle = start == today ? .today : start == yesterday ? .yesterday : .date(start)
            groups.append(DayGroup(start: start, title: title, items: [item]))
        }
    }
    return groups
}
