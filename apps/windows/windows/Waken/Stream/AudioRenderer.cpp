#include "pch.h"

#include "AudioRenderer.h"

#include <mferror.h>

#include "StreamLog.h"

#pragma comment(lib, "mfplat.lib")
#pragma comment(lib, "mfuuid.lib")
#pragma comment(lib, "ole32.lib")

namespace Waken::Stream {

namespace {
// MFAudioFormat_Opus ('Opus' as a wave format tag, 0x704F), spelled out: older SDKs do not name it.
constexpr GUID kOpus = {0x0000704F, 0x0000, 0x0010, {0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71}};
// Held in the device: enough to cover a late packet, never more (the sound must stay with the picture).
constexpr double kMaxBacklogSeconds = 0.06;

void EnsureCom() {
  thread_local bool done = false;
  if (!done) {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    done = true;
  }
}
} // namespace

int AudioRenderer::Init(const OPUS_MULTISTREAM_CONFIGURATION *opus) {
  std::lock_guard lock(m_lock);
  EnsureCom();
  m_sampleRate = opus->sampleRate;
  m_channels = opus->channelCount;
  // Without sound the stream still goes on: a missing decoder is not worth stopping the game.
  if (!CreateDecoder(opus)) {
    m_decoder = nullptr;
    return 0;
  }
  if (!CreateOutput()) {
    m_decoder = nullptr;
    m_client = nullptr;
  }
  return 0;
}

bool AudioRenderer::CreateDecoder(const OPUS_MULTISTREAM_CONFIGURATION *opus) {
  if (opus->channelCount != 2 || opus->streams != 1) {
    Log("[stream] son : configuration Opus non prise en charge");
    return false;
  }
  MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET);
  MFT_REGISTER_TYPE_INFO input{MFMediaType_Audio, kOpus};
  IMFActivate **activates = nullptr;
  UINT32 count = 0;
  HRESULT hr = MFTEnumEx(MFT_CATEGORY_AUDIO_DECODER, MFT_ENUM_FLAG_SYNCMFT | MFT_ENUM_FLAG_LOCALMFT | MFT_ENUM_FLAG_SORTANDFILTER, &input, nullptr, &activates, &count);
  if (FAILED(hr) || count == 0) {
    Log("[stream] son : pas de décodeur Opus dans Windows, partie sans son");
    return false;
  }
  hr = activates[0]->ActivateObject(IID_PPV_ARGS(m_decoder.put()));
  for (UINT32 i = 0; i < count; i++) activates[i]->Release();
  CoTaskMemFree(activates);
  if (FAILED(hr)) return false;

  // Opus as in a WebM file: its header (OpusHead, RFC 7845) as the type's user data.
  BYTE head[19] = {'O', 'p', 'u', 's', 'H', 'e', 'a', 'd', 1, static_cast<BYTE>(opus->channelCount), 0, 0};
  head[12] = static_cast<BYTE>(opus->sampleRate & 0xff);
  head[13] = static_cast<BYTE>((opus->sampleRate >> 8) & 0xff);
  head[14] = static_cast<BYTE>((opus->sampleRate >> 16) & 0xff);
  head[15] = static_cast<BYTE>((opus->sampleRate >> 24) & 0xff);
  winrt::com_ptr<IMFMediaType> type;
  MFCreateMediaType(type.put());
  type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio);
  type->SetGUID(MF_MT_SUBTYPE, kOpus);
  type->SetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, static_cast<UINT32>(opus->sampleRate));
  type->SetUINT32(MF_MT_AUDIO_NUM_CHANNELS, static_cast<UINT32>(opus->channelCount));
  type->SetBlob(MF_MT_USER_DATA, head, sizeof(head));
  hr = m_decoder->SetInputType(0, type.get(), 0);
  if (FAILED(hr)) {
    Log("[stream] son : format Opus refusé par le décodeur");
    return false;
  }
  // Floating point when offered, else 16-bit: WASAPI converts either.
  winrt::com_ptr<IMFMediaType> chosen;
  for (DWORD i = 0;; i++) {
    winrt::com_ptr<IMFMediaType> candidate;
    if (FAILED(m_decoder->GetOutputAvailableType(0, i, candidate.put()))) break;
    GUID subtype{};
    candidate->GetGUID(MF_MT_SUBTYPE, &subtype);
    if (subtype == MFAudioFormat_Float) {
      chosen = candidate;
      break;
    }
    if (subtype == MFAudioFormat_PCM && !chosen) chosen = candidate;
  }
  if (!chosen || FAILED(m_decoder->SetOutputType(0, chosen.get(), 0))) {
    Log("[stream] son : aucune sortie du décodeur Opus");
    return false;
  }
  UINT32 size = 0;
  if (FAILED(MFCreateWaveFormatExFromMFMediaType(chosen.get(), &m_format, &size, MFWaveFormatExConvertFlag_Normal))) return false;
  m_bytesPerFrame = m_format->nBlockAlign;

  MFT_OUTPUT_STREAM_INFO info{};
  m_decoder->GetOutputStreamInfo(0, &info);
  m_providesSamples = (info.dwFlags & (MFT_OUTPUT_STREAM_PROVIDES_SAMPLES | MFT_OUTPUT_STREAM_CAN_PROVIDE_SAMPLES)) != 0;
  // A 20 ms packet at most, with room to spare.
  m_outputSize = info.cbSize > 0 ? info.cbSize : static_cast<DWORD>(m_format->nAvgBytesPerSec / 10);
  m_decoder->ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0);
  m_decoder->ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0);
  return true;
}

bool AudioRenderer::CreateOutput() {
  winrt::com_ptr<IMMDeviceEnumerator> devices;
  if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(devices.put())))) return false;
  winrt::com_ptr<IMMDevice> device;
  if (FAILED(devices->GetDefaultAudioEndpoint(eRender, eConsole, device.put()))) {
    Log("[stream] son : pas de sortie audio sur ce PC");
    return false;
  }
  if (FAILED(device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, m_client.put_void()))) return false;
  const REFERENCE_TIME buffer = 1'000'000; // 100 ms of room, kept mostly empty (kMaxBacklogSeconds)
  HRESULT hr = m_client->Initialize(
      AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, buffer, 0, m_format, nullptr);
  if (FAILED(hr)) {
    Log("[stream] son : sortie audio refusée");
    return false;
  }
  m_client->GetBufferSize(&m_bufferFrames);
  if (FAILED(m_client->GetService(IID_PPV_ARGS(m_render.put())))) return false;
  Log("[stream] son prêt");
  return true;
}

void AudioRenderer::Play(const char *data, int length) {
  std::lock_guard lock(m_lock);
  if (!m_decoder || !m_client || length <= 0) return;
  EnsureCom();

  winrt::com_ptr<IMFMediaBuffer> buffer;
  if (FAILED(MFCreateMemoryBuffer(static_cast<DWORD>(length), buffer.put()))) return;
  BYTE *bytes = nullptr;
  buffer->Lock(&bytes, nullptr, nullptr);
  memcpy(bytes, data, static_cast<size_t>(length));
  buffer->Unlock();
  buffer->SetCurrentLength(static_cast<DWORD>(length));
  winrt::com_ptr<IMFSample> sample;
  MFCreateSample(sample.put());
  sample->AddBuffer(buffer.get());
  sample->SetSampleTime(m_time);
  m_time += 50'000; // 5 ms: only the order matters to the decoder
  // Always decoded, even when the device is full: each packet builds on the previous one.
  if (FAILED(m_decoder->ProcessInput(0, sample.get(), 0))) return;

  for (;;) {
    MFT_OUTPUT_DATA_BUFFER output{};
    winrt::com_ptr<IMFSample> allocated;
    if (!m_providesSamples) {
      winrt::com_ptr<IMFMediaBuffer> outBuffer;
      MFCreateMemoryBuffer(m_outputSize, outBuffer.put());
      MFCreateSample(allocated.put());
      allocated->AddBuffer(outBuffer.get());
      output.pSample = allocated.get();
    }
    DWORD status = 0;
    HRESULT hr = m_decoder->ProcessOutput(0, 1, &output, &status);
    if (output.pEvents) output.pEvents->Release();
    if (FAILED(hr)) break;
    winrt::com_ptr<IMFMediaBuffer> pcm;
    if (output.pSample && SUCCEEDED(output.pSample->ConvertToContiguousBuffer(pcm.put()))) {
      BYTE *samples = nullptr;
      DWORD bytesLength = 0;
      pcm->Lock(&samples, nullptr, &bytesLength);
      Write(samples, bytesLength / m_bytesPerFrame);
      pcm->Unlock();
    }
    if (m_providesSamples && output.pSample) output.pSample->Release();
  }
}

void AudioRenderer::Write(const BYTE *pcm, UINT32 frameCount) {
  UINT32 padding = 0;
  if (FAILED(m_client->GetCurrentPadding(&padding))) return;
  // Late: the device already holds enough. Dropping this packet brings the sound back with the picture.
  if (padding > static_cast<UINT32>(m_sampleRate * kMaxBacklogSeconds)) return;
  UINT32 frames = (std::min)(frameCount, m_bufferFrames - padding);
  if (frames == 0) return;
  BYTE *target = nullptr;
  if (FAILED(m_render->GetBuffer(frames, &target))) return;
  memcpy(target, pcm, static_cast<size_t>(frames) * m_bytesPerFrame);
  m_render->ReleaseBuffer(frames, 0);
  if (!m_started) {
    m_client->Start();
    m_started = true;
  }
}

void AudioRenderer::Cleanup() {
  std::lock_guard lock(m_lock);
  if (m_client && m_started) m_client->Stop();
  m_started = false;
  m_render = nullptr;
  m_client = nullptr;
  m_decoder = nullptr;
  if (m_format) {
    CoTaskMemFree(m_format);
    m_format = nullptr;
  }
}

} // namespace Waken::Stream
