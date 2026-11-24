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

    // The Manettes page (MLGamepads, the bridge): GameController lives on the main thread.
    AsyncFunction("gamepads") { () -> [[String: Any]] in
      MLGamepads.connected()
    }.runOnQueue(.main)

    AsyncFunction("testGamepad") { (id: String) in
      MLGamepads.test(id)
    }.runOnQueue(.main)

    Function("setGamepadOptions") { (rumble: Double, motion: Bool, kind: String) in
      DispatchQueue.main.async { MLGamepads.setRumble(Float(rumble), motion: motion, kind: kind) }
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
      Prop("muted") { (view: WakenStreamView, v: Bool) in view.muted = v }

      OnViewDidUpdateProps { view in view.startIfReady() }
    }
  }
}
