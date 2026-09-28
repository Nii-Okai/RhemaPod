Pod::Spec.new do |s|
  s.name           = 'RpaCrypto'
  s.version        = '1.0.0'
  s.summary        = 'A sample project summary'
  s.description    = 'A sample project description'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  # Matches the app's actual deployment target (mobile/ios/Podfile: platform :ios, '15.1').
  # The scaffolded default (16.4) was never actually required — this file has no
  # @available/#available-gated API; CryptoKit's AES.GCM has been available since iOS 13.
  # A too-high podspec minimum doesn't error, it silently drops the pod from the build.
  s.platforms      = {
    :ios => '15.1',
    :tvos => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
