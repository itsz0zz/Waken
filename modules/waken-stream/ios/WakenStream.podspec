Pod::Spec.new do |s|
  s.name           = 'WakenStream'
  s.version        = '0.1.0'
  s.summary        = 'Waken native game streaming (Sunshine / GameStream) built on moonlight-common-c'
  s.license        = 'GPL-3.0'
  s.author         = 'Monarch'
  s.homepage       = 'https://github.com/hdm-soft/waken'
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
  ]
  # Vendored headers stay out of source_files: the pod's flat headermap would make
  # enet/time.h shadow the system <time.h>. HEADER_SEARCH_PATHS finds them instead.
  s.preserve_paths = 'vendor/moonlight-common-c/**/*.h'
  s.exclude_files = 'vendor/moonlight-common-c/enet/win32.c'
  s.public_header_files = 'Bridge/MLStreamSession.h'
  s.frameworks = 'VideoToolbox', 'AVFoundation', 'AudioToolbox', 'CoreMedia', 'GameController'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'HEADER_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/vendor/moonlight-common-c/src" "$(PODS_TARGET_SRCROOT)/vendor/moonlight-common-c/enet/include" "$(PODS_TARGET_SRCROOT)/vendor/moonlight-common-c/nanors" "$(PODS_TARGET_SRCROOT)/vendor/moonlight-common-c/nanors/deps/obl"',
    'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) HAS_SOCKLEN_T=1 HAS_FCNTL=1 HAS_IOCTL=1 HAS_POLL=1 HAS_GETADDRINFO=1 HAS_GETNAMEINFO=1 HAS_INET_PTON=1 HAS_INET_NTOP=1 HAS_MSGHDR_FLAGS=1 NDEBUG=1',
  }
end
