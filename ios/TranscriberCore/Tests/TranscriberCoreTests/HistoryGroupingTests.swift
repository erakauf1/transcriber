import Foundation
import Testing
@testable import TranscriberCore

struct HistoryGroupingTests {
    var cal: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Asia/Jerusalem")!
        return c
    }()

    func at(_ y: Int, _ m: Int, _ d: Int, _ h: Int, _ min: Int = 0) -> Date {
        cal.date(from: DateComponents(year: y, month: m, day: d, hour: h, minute: min))!
    }

    @Test func emptyInputGivesNoGroups() {
        let groups = groupByDay([Date](), date: { $0 }, now: at(2026, 11, 27, 12), calendar: cal)
        #expect(groups.isEmpty)
    }

    @Test func labelsTodayYesterdayAndOlder() {
        let now = at(2026, 11, 27, 12)
        let items = [at(2026, 11, 27, 9), at(2026, 11, 26, 18), at(2026, 11, 20, 8)]
        let groups = groupByDay(items, date: { $0 }, now: now, calendar: cal)
        #expect(groups.map(\.title) == [.today, .yesterday, .date(at(2026, 11, 20, 0))])
        #expect(groups.map(\.items.count) == [1, 1, 1])
    }

    @Test func midnightBoundaries() {
        let now = at(2026, 11, 27, 0, 5)
        let items = [at(2026, 11, 27, 0, 0), at(2026, 11, 26, 23, 59), at(2026, 11, 26, 0, 0), at(2026, 11, 25, 23, 59)]
        let groups = groupByDay(items, date: { $0 }, now: now, calendar: cal)
        #expect(groups.map(\.title) == [.today, .yesterday, .date(at(2026, 11, 25, 0))])
        #expect(groups.map(\.items.count) == [1, 2, 1])
    }

    @Test func keepsOrderWithinAndAcrossGroups() {
        let now = at(2026, 11, 27, 12)
        let items = [at(2026, 11, 27, 11), at(2026, 11, 27, 9), at(2026, 11, 26, 20), at(2026, 11, 26, 7)]
        let groups = groupByDay(items, date: { $0 }, now: now, calendar: cal)
        #expect(groups.flatMap(\.items) == items)
        #expect(groups[0].start == at(2026, 11, 27, 0))
    }
}
