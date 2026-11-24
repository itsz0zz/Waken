Pod::Spec.new do |s|
  s.name           = 'WakenStreamMac'
  s.version        = '0.1.0'
  s.summary        = 'Waken game streaming for the Mac app: the iPhone stream bridge (moonlight-common-c) in a React Native macOS view'
  s.license        = 'AGPL-3.0'  # GPLv3 (moonlight-common-c) with AGPLv3 (chiaki)
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
    # chiaki (PlayStation Remote Play, AGPLv3): its core for the home network, its protocol messages (nanopb,
    # generated once in Chiaki/generated), its error correction (jerasure, gf-complete) and mbedtls for the crypto.
    'ios/Chiaki/*.c',
    'ios/Chiaki/generated/*.c',
    'ios/vendor/chiaki-ng/lib/src/*.c',
    'ios/vendor/chiaki-ng/lib/src/remote/rudpsendbuffer.c',
    'ios/vendor/chiaki-ng/third-party/nanopb/pb_{common,encode,decode}.c',
    'ios/vendor/chiaki-ng/third-party/jerasure/src/{galois,jerasure,reed_sol,cauchy,liberation}.c',
    'ios/vendor/chiaki-ng/third-party/gf-complete/src/{gf,gf_wgen,gf_w4,gf_w8,gf_w16,gf_w32,gf_w64,gf_w128,gf_rand,gf_general,gf_cpu}.c',
    'ios/vendor/mbedtls/library/*.c',
  ]
  s.preserve_paths = ['ios/vendor/moonlight-common-c/**/*.h', 'ios/vendor/chiaki-ng/**/*.h', 'ios/vendor/mbedtls/**/*.h', 'ios/Chiaki/**/*.h']
  s.exclude_files = ['ios/vendor/moonlight-common-c/enet/win32.c', 'ios/vendor/chiaki-ng/lib/src/aia.c', 'ios/vendor/chiaki-ng/lib/src/aia_openssl.c', 'ios/vendor/chiaki-ng/lib/src/ffmpegdecoder.c', 'ios/vendor/chiaki-ng/lib/src/pidecoder.c', 'ios/vendor/chiaki-ng/lib/src/opusdecoder.c', 'ios/vendor/chiaki-ng/lib/src/opusencoder.c']
  s.public_header_files = ['ios/Bridge/MLStreamSession.h', 'macos/WakenMacStreamView.h']
  s.frameworks = 'VideoToolbox', 'AVFoundation', 'AudioToolbox', 'CoreMedia', 'CoreVideo', 'GameController', 'CoreHaptics', 'CoreServices', 'IOKit', 'Carbon'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'HEADER_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/ios/vendor/moonlight-common-c/src" "$(PODS_TARGET_SRCROOT)/ios/vendor/moonlight-common-c/enet/include" "$(PODS_TARGET_SRCROOT)/ios/vendor/moonlight-common-c/nanors" "$(PODS_TARGET_SRCROOT)/ios/vendor/moonlight-common-c/nanors/deps/obl" "$(PODS_TARGET_SRCROOT)/ios/Chiaki/include" "$(PODS_TARGET_SRCROOT)/ios/Chiaki/generated" "$(PODS_TARGET_SRCROOT)/ios/vendor/chiaki-ng/lib/include" "$(PODS_TARGET_SRCROOT)/ios/vendor/chiaki-ng/third-party/nanopb" "$(PODS_TARGET_SRCROOT)/ios/vendor/chiaki-ng/third-party/jerasure/include" "$(PODS_TARGET_SRCROOT)/ios/vendor/chiaki-ng/third-party/gf-complete/include" "$(PODS_TARGET_SRCROOT)/ios/vendor/mbedtls/include"',
    'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) HAS_SOCKLEN_T=1 HAS_FCNTL=1 HAS_IOCTL=1 HAS_POLL=1 HAS_GETADDRINFO=1 HAS_GETNAMEINFO=1 HAS_INET_PTON=1 HAS_INET_NTOP=1 HAS_MSGHDR_FLAGS=1 NDEBUG=1 CHIAKI_LIB_ENABLE_MBEDTLS=1 PB_C99_STATIC_ASSERT=1 CHIAKI_VERSION_MAJOR=1 CHIAKI_VERSION_MINOR=10 CHIAKI_VERSION_PATCH=1',
  }
end
