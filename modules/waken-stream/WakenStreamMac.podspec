Pod::Spec.new do |s|
  s.name           = 'WakenStreamMac'
  s.version        = '0.1.0'
  s.summary        = 'Waken game streaming for the Mac app: the iPhone stream bridge (moonlight-common-c) in a React Native macOS view'
  s.license        = 'GPL-3.0'
  s.author         = 'Monarch'
  s.homepage       = 'https://wakenplay.fr'
  s.platforms      = { :osx => '14.0' }
  s.source         = { git: '' }
  s.static_framework = true

  # React Native macOS (the view manager) and OpenSSL (moonlight-common-c's crypto).
  s.dependency 'React-Core'
  s.dependency 'OpenSSL-Universal'

  # The same bridge as the iPhone (ios/Bridge), the Mac view in macos/. moonlight-common-c is the git submodule
  # in ios/vendor (see the iPhone podspec, WakenStream.podspec, for why its headers stay out of source_files).
  s.source_files = [
    'macos/**/*.{h,m}',
    'ios/Bridge/**/*.{h,m,c}',
    'ios/vendor/moonlight-common-c/src/**/*.c',
    'ios/vendor/moonlight-common-c/nanors/rs.c',
    'ios/vendor/moonlight-common-c/nanors/deps/obl/oblas_common.c',
    'ios/vendor/moonlight-common-c/nanors/deps/obl/oblas_lite.c',
    'ios/vendor/moonlight-common-c/enet/*.c',
  ]
  s.preserve_paths = 'ios/vendor/moonlight-common-c/**/*.h'
  s.exclude_files = 'ios/vendor/moonlight-common-c/enet/win32.c'
  s.public_header_files = ['ios/Bridge/MLStreamSession.h', 'macos/WakenMacStreamView.h']
  s.frameworks = 'VideoToolbox', 'AVFoundation', 'AudioToolbox', 'CoreMedia', 'CoreVideo', 'GameController', 'CoreHaptics', 'IOKit', 'Carbon'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'HEADER_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/ios/vendor/moonlight-common-c/src" "$(PODS_TARGET_SRCROOT)/ios/vendor/moonlight-common-c/enet/include" "$(PODS_TARGET_SRCROOT)/ios/vendor/moonlight-common-c/nanors" "$(PODS_TARGET_SRCROOT)/ios/vendor/moonlight-common-c/nanors/deps/obl"',
    'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) HAS_SOCKLEN_T=1 HAS_FCNTL=1 HAS_IOCTL=1 HAS_POLL=1 HAS_GETADDRINFO=1 HAS_GETNAMEINFO=1 HAS_INET_PTON=1 HAS_INET_NTOP=1 HAS_MSGHDR_FLAGS=1 NDEBUG=1',
  }
end
