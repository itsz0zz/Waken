Pod::Spec.new do |s|
  s.name           = 'WakenStream'
  s.version        = '0.1.0'
  s.summary        = 'Waken native game streaming (Sunshine / GameStream) built on moonlight-common-c'
  s.license        = 'AGPL-3.0'  # GPLv3 (moonlight-common-c) with AGPLv3 (chiaki)
  s.author         = 'Monarch'
  s.homepage       = 'https://wakenplay.fr'
  s.platforms      = { :ios => '16.0', :tvos => '16.0' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # moonlight-common-c is a git submodule in vendor/ (see vendor/README.md),
  # with its own submodules enet and nanors (Reed-Solomon FEC). Crypto comes from OpenSSL.
  s.dependency 'OpenSSL-Universal'
  s.source_files = [
    '*.swift',
    'Bridge/**/*.{h,m,c}',
    'vendor/moonlight-common-c/src/**/*.c',
    'vendor/moonlight-common-c/nanors/rs.c',
    'vendor/moonlight-common-c/nanors/deps/obl/oblas_common.c',
    'vendor/moonlight-common-c/nanors/deps/obl/oblas_lite.c',
    'vendor/moonlight-common-c/enet/*.c',
    # chiaki (PlayStation Remote Play, AGPLv3): its core for the home network, its protocol messages (nanopb,
    # generated once in Chiaki/generated), its error correction (jerasure, gf-complete) and mbedtls for the crypto.
    'Chiaki/*.c',
    'Chiaki/generated/*.c',
    'vendor/chiaki-ng/lib/src/*.c',
    'vendor/chiaki-ng/lib/src/remote/rudpsendbuffer.c',
    'vendor/chiaki-ng/third-party/nanopb/pb_{common,encode,decode}.c',
    'vendor/chiaki-ng/third-party/jerasure/src/{galois,jerasure,reed_sol,cauchy,liberation}.c',
    'vendor/chiaki-ng/third-party/gf-complete/src/{gf,gf_wgen,gf_w4,gf_w8,gf_w16,gf_w32,gf_w64,gf_w128,gf_rand,gf_general,gf_cpu}.c',
    'vendor/mbedtls/library/*.c',
  ]
  # Vendored headers stay out of source_files: the pod's flat headermap would make
  # enet/time.h shadow the system <time.h>. HEADER_SEARCH_PATHS finds them instead.
  s.preserve_paths = ['vendor/moonlight-common-c/**/*.h', 'vendor/chiaki-ng/**/*.h', 'vendor/mbedtls/**/*.h', 'Chiaki/**/*.h']
  s.exclude_files = ['vendor/moonlight-common-c/enet/win32.c', 'vendor/chiaki-ng/lib/src/aia.c', 'vendor/chiaki-ng/lib/src/aia_openssl.c', 'vendor/chiaki-ng/lib/src/ffmpegdecoder.c', 'vendor/chiaki-ng/lib/src/pidecoder.c', 'vendor/chiaki-ng/lib/src/opusdecoder.c', 'vendor/chiaki-ng/lib/src/opusencoder.c']
  s.public_header_files = ['Bridge/MLStreamSession.h', 'Bridge/MLGamepads.h', 'Bridge/MLPlayStation.h']
  s.frameworks = 'VideoToolbox', 'AVFoundation', 'AudioToolbox', 'CoreMedia', 'GameController', 'CoreHaptics'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'HEADER_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/vendor/moonlight-common-c/src" "$(PODS_TARGET_SRCROOT)/vendor/moonlight-common-c/enet/include" "$(PODS_TARGET_SRCROOT)/vendor/moonlight-common-c/nanors" "$(PODS_TARGET_SRCROOT)/vendor/moonlight-common-c/nanors/deps/obl" "$(PODS_TARGET_SRCROOT)/Chiaki/include" "$(PODS_TARGET_SRCROOT)/Chiaki/generated" "$(PODS_TARGET_SRCROOT)/vendor/chiaki-ng/lib/include" "$(PODS_TARGET_SRCROOT)/vendor/chiaki-ng/third-party/nanopb" "$(PODS_TARGET_SRCROOT)/vendor/chiaki-ng/third-party/jerasure/include" "$(PODS_TARGET_SRCROOT)/vendor/chiaki-ng/third-party/gf-complete/include" "$(PODS_TARGET_SRCROOT)/vendor/mbedtls/include"',
    'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) HAS_SOCKLEN_T=1 HAS_FCNTL=1 HAS_IOCTL=1 HAS_POLL=1 HAS_GETADDRINFO=1 HAS_GETNAMEINFO=1 HAS_INET_PTON=1 HAS_INET_NTOP=1 HAS_MSGHDR_FLAGS=1 NDEBUG=1 CHIAKI_LIB_ENABLE_MBEDTLS=1 PB_C99_STATIC_ASSERT=1 CHIAKI_VERSION_MAJOR=1 CHIAKI_VERSION_MINOR=10 CHIAKI_VERSION_PATCH=1',
  }
end
