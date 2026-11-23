package fr.wakenplay.stream

import android.content.Context
import android.graphics.Color
import android.view.Gravity
import android.widget.TextView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.views.ExpoView
import expo.modules.kotlin.viewevent.EventDispatcher

/**
 * Android is V3: same contract as iOS, to be implemented with moonlight-common-c (JNI)
 * + MediaCodec rendering into a SurfaceView (see moonlight-android). For now the view
 * reports an error so the app falls back to the Moonlight app.
 */
class WakenStreamModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WakenStream")
    Function("stop") {}
    View(WakenStreamView::class) {
      Events("onStateChange", "onStats")
      Prop("launch") { _: WakenStreamView, _: Map<String, Any?> -> }
      Prop("width") { _: WakenStreamView, _: Int -> }
      Prop("height") { _: WakenStreamView, _: Int -> }
      Prop("fps") { _: WakenStreamView, _: Int -> }
      Prop("bitrateKbps") { _: WakenStreamView, _: Int -> }
      Prop("hevc") { _: WakenStreamView, _: Boolean -> }
      Prop("remote") { _: WakenStreamView, _: Boolean -> }
      OnViewDidUpdateProps { view: WakenStreamView -> view.notReady() }
    }
  }
}

class WakenStreamView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onStateChange by EventDispatcher()

  init {
    setBackgroundColor(Color.BLACK)
    addView(TextView(context).apply {
      text = "Stream Android : prévu en V3"
      setTextColor(Color.WHITE)
      gravity = Gravity.CENTER
    }, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  fun notReady() = onStateChange(mapOf("state" to "error", "message" to "Le stream intégré arrive sur Android en V3. Utilise l'app Moonlight."))
}
