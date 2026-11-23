import ExpoModulesCore

public class WakenStreamModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WakenStream")

    Function("stop") {
      DispatchQueue.main.async { WakenStreamView.current?.stopStream() }
    }

    Function("toggleKeyboard") {
      DispatchQueue.main.async { WakenStreamView.current?.toggleKeyboard() }
    }

    View(WakenStreamView.self) {
      Events("onStateChange", "onStats")

      Prop("launch") { (view: WakenStreamView, launch: [String: Any]) in view.launch = launch }
      Prop("videoWidth") { (view: WakenStreamView, v: Int) in view.config.width = Int32(v) }
      Prop("videoHeight") { (view: WakenStreamView, v: Int) in view.config.height = Int32(v) }
      Prop("fps") { (view: WakenStreamView, v: Int) in view.config.fps = Int32(v) }
      Prop("bitrateKbps") { (view: WakenStreamView, v: Int) in view.config.bitrateKbps = Int32(v) }
      Prop("hevc") { (view: WakenStreamView, v: Bool) in view.config.hevc = v }
      Prop("remote") { (view: WakenStreamView, v: Bool) in view.config.remote = v }

      OnViewDidUpdateProps { view in view.startIfReady() }
    }
  }
}
