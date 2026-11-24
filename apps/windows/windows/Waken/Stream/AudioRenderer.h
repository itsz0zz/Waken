// The sound of the computer played on: Opus decoded by Windows' own Media Foundation decoder, played through
// WASAPI (the default output, shared with the other apps). Without that decoder the stream plays without sound
// and says so in waken.log.
#pragma once

#include <audioclient.h>
#include <mfapi.h>
#include <mftransform.h>
#include <mmdeviceapi.h>

#include <atomic>
#include <mutex>

#include <winrt/base.h>

#include "Limelight.h"

namespace Waken::Stream {

class AudioRenderer {
 public:
  int Init(const OPUS_MULTISTREAM_CONFIGURATION *opus);
  void Play(const char *data, int length);
  void Cleanup();
  /// The sound off, the picture on (the HUD's menu).
  void SetMuted(bool muted) { m_muted = muted; }

 private:
  bool CreateDecoder(const OPUS_MULTISTREAM_CONFIGURATION *opus);
  bool CreateOutput();
  void Write(const BYTE *pcm, UINT32 frameCount);

  std::mutex m_lock;
  winrt::com_ptr<IMFTransform> m_decoder;
  bool m_providesSamples = false;
  DWORD m_outputSize = 0;
  int m_sampleRate = 48000, m_channels = 2;
  UINT32 m_bytesPerFrame = 0;
  WAVEFORMATEX *m_format = nullptr; // the decoder's output, also the device's input
  winrt::com_ptr<IAudioClient> m_client;
  winrt::com_ptr<IAudioRenderClient> m_render;
  UINT32 m_bufferFrames = 0;
  bool m_started = false;
  std::atomic<bool> m_muted{false};
  LONGLONG m_time = 0;
};

} // namespace Waken::Stream
