import SwiftUI

struct ContentView: View {
    let model: Model
    @State private var number = ""

    private let markers: [(String, String)] = [
        ("At the desk", "near"), ("1 m", "distance_1m"), ("2 m", "distance_2m"), ("5 m", "distance_5m"),
        ("Next room", "distance_next_room"), ("Left", "away"), ("Back", "near"),
        ("Face up", "face_up"), ("Face down", "face_down"), ("Locked", "locked"), ("In a bag", "in_bag"),
    ]

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                ForEach(markers, id: \.0) { title, label in
                    big(title) { model.marker(label) }
                }
                big("Sensor prompt seen") { model.sensorPrompt(seen: true) }
                big("Sensor prompt not seen") { model.sensorPrompt(seen: false) }
                TextField("Code from the computer", text: $number)
                    .keyboardType(.numberPad).textFieldStyle(.roundedBorder).font(.title2)
                big("Pair with number") { model.pair(method: "number", code: number); number = "" }
                ShareLink(item: model.logURL) { Text("Share log").font(.title2).frame(maxWidth: .infinity, minHeight: 56) }
                    .buttonStyle(.bordered)
            }
            .padding()
        }
    }

    private func big(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Text(title).font(.title2).frame(maxWidth: .infinity, minHeight: 56) }
            .buttonStyle(.borderedProminent)
    }
}
