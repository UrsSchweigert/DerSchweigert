import XCTest
@testable import TagwerkCore

/// Fails when any key of `table` lacks German or English text; later modules call this on their own tables.
func assertComplete(_ table: TextTable, file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertEqual(table.missing, [], "missing translations", file: file, line: line)
}
