import AVKit
import ExpoModulesCore

/**
 * The standard AirPlay button. Tapping it opens the system's own device sheet (AirPlay
 * speakers, Apple TVs, AirPods, the phone's speaker), so the app never lists devices or
 * routes audio itself: the shared expo-video player already plays through whatever route
 * the system picks, and `allowsExternalPlayback` (on by default) sends video to an Apple TV.
 */
public class AirPlayButtonModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AirPlayButton")

    View(AirPlayButtonView.self) {
      Prop("tintColor") { (view: AirPlayButtonView, color: UIColor?) in
        view.picker.tintColor = color
      }
      Prop("activeTintColor") { (view: AirPlayButtonView, color: UIColor?) in
        view.picker.activeTintColor = color
      }
      // Puts Apple TVs first in the sheet for a video sermon, speakers first for audio.
      Prop("prioritizesVideoDevices") { (view: AirPlayButtonView, value: Bool?) in
        view.picker.prioritizesVideoDevices = value ?? false
      }
    }
  }
}

final class AirPlayButtonView: ExpoView {
  let picker = AVRoutePickerView()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    picker.backgroundColor = .clear
    addSubview(picker)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    picker.frame = bounds
  }
}
