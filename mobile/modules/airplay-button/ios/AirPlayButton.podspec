Pod::Spec.new do |s|
  s.name           = 'AirPlayButton'
  s.version        = '1.0.0'
  s.summary        = 'The system AirPlay route picker as an Expo view.'
  s.description    = 'Wraps AVRoutePickerView so the player screen can show the standard AirPlay button.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  # Same minimum as rpa-crypto. AVRoutePickerView needs iOS 11; a podspec minimum above
  # the app's own target silently drops the pod from the build.
  s.platforms      = {
    :ios => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift}"
end
