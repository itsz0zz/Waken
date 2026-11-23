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
  # Built by tunnel/build.sh (Go c-archive), copied here by that script. Linked by path, per SDK: CocoaPods'
  # xcframework copy step runs too late in a clean build (after this pod's Swift needs it).
  s.preserve_paths = 'WakenTunnel.xcframework/**/*'
  s.frameworks = 'Security', 'CoreFoundation', 'SystemConfiguration'
  s.libraries = 'resolv'
  lib = '${PODS_ROOT}/../../../../modules/waken-tunnel/ios/WakenTunnel.xcframework'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    # The C header is the same in both slices.
    'SWIFT_INCLUDE_PATHS' => '$(inherited) "$(PODS_TARGET_SRCROOT)/WakenTunnel.xcframework/ios-arm64/Headers"',
    'EXCLUDED_ARCHS[sdk=iphonesimulator*]' => 'x86_64',
  }
  # A per-SDK OTHER_LDFLAGS line would replace every other pod's flags: the path goes through its own variable.
  s.user_target_xcconfig = {
    'WAKEN_TUNNEL_LIB[sdk=iphoneos*]' => "#{lib}/ios-arm64/libwakennet.a",
    'WAKEN_TUNNEL_LIB[sdk=iphonesimulator*]' => "#{lib}/ios-arm64-simulator/libwakennet.a",
    'OTHER_LDFLAGS' => '$(inherited) "$(WAKEN_TUNNEL_LIB)"',
    # The tunnel is built for Apple silicon only: no Intel simulator.
    'EXCLUDED_ARCHS[sdk=iphonesimulator*]' => 'x86_64',
  }
end
