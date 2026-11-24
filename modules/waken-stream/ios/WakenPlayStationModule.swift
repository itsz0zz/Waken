import ExpoModulesCore

/// The PS5 / PS4 stream view for the iPhone app's JavaScript (modules/waken-stream/src/index.ts, PlayStationView).
public class WakenPlayStationModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WakenPlayStation")

    View(WakenPlayStationView.self) {
      Events("onStateChange", "onStats")

      Prop("link") { (view: WakenPlayStationView, link: [String: Any]) in view.link = link }
      Prop("videoHeight") { (view: WakenPlayStationView, v: Int) in view.videoHeight = v }
      Prop("fps") { (view: WakenPlayStationView, v: Int) in view.fps = v }
      Prop("bitrateKbps") { (view: WakenPlayStationView, v: Int) in view.bitrateKbps = v }
      Prop("hevc") { (view: WakenPlayStationView, v: Bool) in view.hevc = v }
      Prop("muted") { (view: WakenPlayStationView, v: Bool) in view.muted = v }

      OnViewDidUpdateProps { view in view.startIfReady() }
    }
  }
}
