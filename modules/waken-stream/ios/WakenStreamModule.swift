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

    // PS5 and PS4 (MLPlayStation, chiaki): found on this network, linked with their code, woken.
    AsyncFunction("discoverConsoles") { (seconds: Double, promise: Promise) in
      MLPlayStation.discover(for: seconds) { promise.resolve($0) }
    }

    AsyncFunction("registerConsole") { (host: String, ps5: Bool, accountId: String, pin: String, promise: Promise) in
      MLPlayStation.registerConsole(host, ps5: ps5, accountId: accountId, pin: pin) { console, error in
        if let console { promise.resolve(console) } else { promise.reject("ERR_REGIST", error ?? "Liaison impossible") }
      }
    }

    AsyncFunction("wakeConsole") { (host: String, registKey: String, ps5: Bool) throws in
      if let error = MLPlayStation.wake(host, registKey: registKey, ps5: ps5) { throw Exception(name: "ERR_WAKE", description: error) }
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
