Pod::Spec.new do |s|
  s.name           = 'WakenTunnel'
  s.version        = '0.1.0'
  s.summary        = "Waken's private network: an embedded Tailscale node (tsnet), built from tunnel/ in this repository"
  s.license        = 'BSD-3-Clause'
  s.author         = 'HDM-SOFT'
  s.homepage       = 'https://github.com/hdm-soft/waken'
  s.platforms      = { :ios => '17.0' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.source_files = '*.swift'
  # Built by tunnel/build.sh (Go c-archive), copied here by that script.
  s.vendored_frameworks = 'WakenTunnel.xcframework'
  s.frameworks = 'Security', 'CoreFoundation', 'SystemConfiguration'
  s.libraries = 'resolv'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
