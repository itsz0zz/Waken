#include "pch.h"

#include "VideoRenderer.h"

#include <codecapi.h>
#include <mferror.h>
#include <strmif.h> // ICodecAPI (codecapi.h only names its settings)

#include "StreamLog.h"

#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "dxgi.lib")
#pragma comment(lib, "mfplat.lib")
#pragma comment(lib, "mfuuid.lib")

namespace Waken::Stream {

namespace {
std::string Hex(HRESULT hr) {
  char text[16];
  sprintf_s(text, "0x%08lx", static_cast<unsigned long>(hr));
  return text;
}
} // namespace

bool VideoRenderer::Create(int width, int height, std::string &error) {
  std::lock_guard lock(m_lock);
  m_width = width;
  m_height = height;

  // A hardware device that also decodes video, used from the decoder thread and by Media Foundation.
  D3D_FEATURE_LEVEL levels[] = {D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0};
  HRESULT hr = D3D11CreateDevice(
      nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT, levels,
      ARRAYSIZE(levels), D3D11_SDK_VERSION, m_device.put(), nullptr, m_context.put());
  if (FAILED(hr)) {
    error = "Carte graphique indisponible pour la vidéo (" + Hex(hr) + ")";
    return false;
  }
  if (auto multithread = m_device.try_as<ID3D11Multithread>()) multithread->SetMultithreadProtected(TRUE);
  m_videoDevice = m_device.try_as<ID3D11VideoDevice>();
  m_videoContext = m_context.try_as<ID3D11VideoContext>();
  if (!m_videoDevice || !m_videoContext) {
    error = "La carte graphique ne décode pas la vidéo";
    return false;
  }

  winrt::check_hresult(MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET));
  winrt::check_hresult(MFCreateDXGIDeviceManager(&m_resetToken, m_manager.put()));
  winrt::check_hresult(m_manager->ResetDevice(m_device.get(), m_resetToken));
  return true;
}

bool VideoRenderer::CanDecode(bool hevc) {
  MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET);
  MFT_REGISTER_TYPE_INFO input{MFMediaType_Video, hevc ? MFVideoFormat_HEVC : MFVideoFormat_H264};
  IMFActivate **activates = nullptr;
  UINT32 count = 0;
  HRESULT hr = MFTEnumEx(MFT_CATEGORY_VIDEO_DECODER, MFT_ENUM_FLAG_SYNCMFT | MFT_ENUM_FLAG_LOCALMFT | MFT_ENUM_FLAG_SORTANDFILTER, &input, nullptr, &activates, &count);
  for (UINT32 i = 0; i < count; i++) activates[i]->Release();
  CoTaskMemFree(activates);
  return SUCCEEDED(hr) && count > 0;
}

void VideoRenderer::SetTarget(winrt::com_ptr<winrt::Microsoft::UI::Composition::ICompositionDrawingSurfaceInterop> target) {
  std::lock_guard lock(m_lock);
  m_target = std::move(target);
}

int VideoRenderer::Setup(int videoFormat, int width, int height, int fps) {
  std::lock_guard lock(m_lock);
  {
    std::lock_guard timing(m_timingLock);
    m_timing = {};
    const int enabled = m_smoothing.enabled;
    m_smoothing = {};
    m_smoothing.enabled = enabled;
    m_smoothing.primed = 1;
    m_lastShownUs = 0;
  }
  if (!m_timer) m_timer = CreateWaitableTimerExW(nullptr, nullptr, CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS);
  m_fps = fps > 0 ? fps : 60;
  const GUID subtype = (videoFormat & VIDEO_FORMAT_MASK_H265) ? MFVideoFormat_HEVC : MFVideoFormat_H264;
  const char *name = (videoFormat & VIDEO_FORMAT_MASK_H265) ? "HEVC" : "H.264";

  // Windows' own decoder (synchronous), which decodes on the graphics card once given the D3D11 device.
  MFT_REGISTER_TYPE_INFO input{MFMediaType_Video, subtype};
  IMFActivate **activates = nullptr;
  UINT32 count = 0;
  HRESULT hr = MFTEnumEx(MFT_CATEGORY_VIDEO_DECODER, MFT_ENUM_FLAG_SYNCMFT | MFT_ENUM_FLAG_LOCALMFT | MFT_ENUM_FLAG_SORTANDFILTER, &input, nullptr, &activates, &count);
  if (FAILED(hr) || count == 0) {
    Log(std::string("[stream] aucun décodeur ") + name + " (" + Hex(hr) + ")");
    return -1;
  }
  hr = activates[0]->ActivateObject(IID_PPV_ARGS(m_decoder.put()));
  for (UINT32 i = 0; i < count; i++) activates[i]->Release();
  CoTaskMemFree(activates);
  if (FAILED(hr)) {
    Log("[stream] décodeur non créé " + Hex(hr));
    return -1;
  }

  winrt::com_ptr<IMFAttributes> attributes;
  if (SUCCEEDED(m_decoder->GetAttributes(attributes.put())) && attributes) {
    UINT32 aware = 0;
    attributes->GetUINT32(MF_SA_D3D11_AWARE, &aware);
    attributes->SetUINT32(MF_LOW_LATENCY, TRUE);
    if (!aware) {
      Log(std::string("[stream] le décodeur ") + name + " ne décode pas sur la carte graphique");
      return -1;
    }
  }
  hr = m_decoder->ProcessMessage(MFT_MESSAGE_SET_D3D_MANAGER, reinterpret_cast<ULONG_PTR>(m_manager.get()));
  if (FAILED(hr)) {
    Log("[stream] décodage matériel refusé " + Hex(hr));
    return -1;
  }
  if (auto codec = m_decoder.try_as<ICodecAPI>()) {
    VARIANT on{};
    on.vt = VT_BOOL;
    on.boolVal = VARIANT_TRUE;
    codec->SetValue(&CODECAPI_AVLowLatencyMode, &on);
  }

  winrt::com_ptr<IMFMediaType> type;
  winrt::check_hresult(MFCreateMediaType(type.put()));
  type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
  type->SetGUID(MF_MT_SUBTYPE, subtype);
  MFSetAttributeSize(type.get(), MF_MT_FRAME_SIZE, static_cast<UINT32>(width), static_cast<UINT32>(height));
  MFSetAttributeRatio(type.get(), MF_MT_FRAME_RATE, static_cast<UINT32>(m_fps), 1);
  type->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
  hr = m_decoder->SetInputType(0, type.get(), 0);
  if (FAILED(hr) || !SetOutputType()) {
    Log("[stream] format vidéo refusé par le décodeur " + Hex(hr));
    return -1;
  }

  MFT_OUTPUT_STREAM_INFO info{};
  m_decoder->GetOutputStreamInfo(0, &info);
  m_providesSamples = (info.dwFlags & (MFT_OUTPUT_STREAM_PROVIDES_SAMPLES | MFT_OUTPUT_STREAM_CAN_PROVIDE_SAMPLES)) != 0;
  m_decoder->ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0);
  m_decoder->ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0);
  Log(std::string("[stream] décodeur ") + name + " prêt, " + std::to_string(width) + "x" + std::to_string(height));
  return 0;
}

/// NV12 out of the decoder: what the video processor turns into the swap chain's RGB.
bool VideoRenderer::SetOutputType() {
  for (DWORD i = 0;; i++) {
    winrt::com_ptr<IMFMediaType> type;
    if (FAILED(m_decoder->GetOutputAvailableType(0, i, type.put()))) return false;
    GUID subtype{};
    type->GetGUID(MF_MT_SUBTYPE, &subtype);
    if (subtype == MFVideoFormat_NV12) return SUCCEEDED(m_decoder->SetOutputType(0, type.get(), 0));
  }
}

int VideoRenderer::Submit(PDECODE_UNIT unit) {
  const uint64_t submittedUs = LiGetMicroseconds();
  {
    std::lock_guard timing(m_timingLock);
    WakenFrameReceived(&m_timing, unit->frameHostProcessingLatency, unit->receiveTimeUs, unit->enqueueTimeUs, submittedUs);
    WakenSmoothingFrame(&m_smoothing, unit->presentationTimeUs, unit->enqueueTimeUs);
  }
  Pace(unit);
  // One element per RTP packet: a start code can straddle two of them, so the whole frame is put together first.
  std::vector<uint8_t> picture;
  picture.reserve(static_cast<size_t>(unit->fullLength));
  for (PLENTRY entry = unit->bufferList; entry; entry = entry->next) {
    picture.insert(picture.end(), entry->data, entry->data + entry->length);
  }
  return SubmitAnnexB(picture.data(), picture.size(), unit->frameType == FRAME_TYPE_IDR, submittedUs);
}

WakenFrameTimes VideoRenderer::CloseTimes() {
  std::lock_guard timing(m_timingLock);
  WakenSmoothingUpdate(&m_smoothing, 1000.0 / (m_fps > 0 ? m_fps : 60));
  return WakenFrameClose(&m_timing);
}

void VideoRenderer::SetSmoothing(bool on) {
  std::lock_guard timing(m_timingLock);
  m_smoothing.enabled = on ? 1 : 0;
  if (!on) {
    m_smoothing.target = 0;
    m_smoothing.primed = 1;
  }
}

int VideoRenderer::ReserveFrames() {
  std::lock_guard timing(m_timingLock);
  return m_smoothing.target;
}

void VideoRenderer::SleepUs(int64_t us) {
  if (us <= 0) return;
  if (!m_timer) {
    Sleep(static_cast<DWORD>((us + 999) / 1000));
    return;
  }
  LARGE_INTEGER due{};
  due.QuadPart = -us * 10; // relative, in 100 ns
  if (SetWaitableTimer(m_timer, &due, 0, nullptr, nullptr, FALSE)) WaitForSingleObject(m_timer, 100);
}

void VideoRenderer::Pace(PDECODE_UNIT unit) {
  const double frameMs = 1000.0 / (m_fps > 0 ? m_fps : 60);
  int target = 0;
  bool primed = true;
  uint64_t lastShown = 0;
  {
    std::lock_guard timing(m_timingLock);
    target = m_smoothing.target;
    primed = m_smoothing.primed != 0;
    lastShown = m_lastShownUs;
  }
  // No reserve: decoded and shown at once, as moonlight hands it over.
  if (target == 0) return;
  // The frames moonlight holds after this one are the reserve (the decoder thread waits here, they queue there).
  if (!primed) {
    // Fills again after running dry: enough frames, or this one waited the reserve's time (a still screen).
    const double reserveMs = target * frameMs;
    while (LiGetPendingVideoFrames() + 1 < target) {
      const uint64_t now = LiGetMicroseconds();
      if (unit->enqueueTimeUs > 0 && now > unit->enqueueTimeUs && (now - unit->enqueueTimeUs) / 1000.0 >= reserveMs) break;
      SleepUs(1000);
    }
    std::lock_guard timing(m_timingLock);
    m_smoothing.primed = 1;
  } else if (lastShown > 0 && LiGetPendingVideoFrames() <= target + 1) {
    // One frame per frame interval; more than the reserve and a margin waiting, the late ones go at once.
    const uint64_t due = lastShown + static_cast<uint64_t>(frameMs * 1000.0);
    const uint64_t now = LiGetMicroseconds();
    if (due > now) SleepUs(static_cast<int64_t>(due - now));
  }
}

int VideoRenderer::SubmitAnnexB(const uint8_t *data, size_t size, bool keyframe, uint64_t submittedUs) {
  std::lock_guard lock(m_lock);
  if (!m_decoder) return DR_NEED_IDR;
  m_picture.assign(data, data + size);

  winrt::com_ptr<IMFMediaBuffer> buffer;
  if (FAILED(MFCreateMemoryBuffer(static_cast<DWORD>(m_picture.size()), buffer.put()))) return DR_NEED_IDR;
  BYTE *target = nullptr;
  buffer->Lock(&target, nullptr, nullptr);
  memcpy(target, m_picture.data(), m_picture.size());
  buffer->Unlock();
  buffer->SetCurrentLength(static_cast<DWORD>(m_picture.size()));
  winrt::com_ptr<IMFSample> sample;
  MFCreateSample(sample.put());
  sample->AddBuffer(buffer.get());
  const LONGLONG duration = 10'000'000LL / m_fps;
  sample->SetSampleTime(m_time);
  sample->SetSampleDuration(duration);
  m_time += duration;
  if (keyframe) sample->SetUINT32(MFSampleExtension_CleanPoint, TRUE);

  HRESULT hr = m_decoder->ProcessInput(0, sample.get(), 0);
  if (FAILED(hr)) {
    dropped++;
    return DR_NEED_IDR;
  }

  // Everything the decoder has ready: with low latency, the picture of this frame.
  for (;;) {
    MFT_OUTPUT_DATA_BUFFER output{};
    winrt::com_ptr<IMFSample> allocated;
    if (!m_providesSamples) {
      MFT_OUTPUT_STREAM_INFO info{};
      m_decoder->GetOutputStreamInfo(0, &info);
      winrt::com_ptr<IMFMediaBuffer> outBuffer;
      MFCreateMemoryBuffer(info.cbSize, outBuffer.put());
      MFCreateSample(allocated.put());
      allocated->AddBuffer(outBuffer.get());
      output.pSample = allocated.get();
    }
    DWORD status = 0;
    hr = m_decoder->ProcessOutput(0, 1, &output, &status);
    if (output.pEvents) output.pEvents->Release();
    if (hr == MF_E_TRANSFORM_NEED_MORE_INPUT) break;
    if (hr == MF_E_TRANSFORM_STREAM_CHANGE) {
      if (!SetOutputType()) return DR_NEED_IDR;
      continue;
    }
    if (FAILED(hr)) {
      dropped++;
      return DR_NEED_IDR;
    }
    bool shown = Present(output.pSample);
    if (m_providesSamples && output.pSample) output.pSample->Release();
    if (!shown) {
      dropped++;
      return DR_NEED_IDR;
    }
    frames++;
    if (submittedUs) {
      const uint64_t shown = LiGetMicroseconds();
      std::lock_guard timing(m_timingLock);
      WakenFrameShown(&m_timing, submittedUs, shown);
      m_lastShownUs = shown;
      // Nothing left behind this one: the reserve ran dry and fills again before the next frames go.
      if (m_smoothing.target > 0 && LiGetPendingVideoFrames() == 0) m_smoothing.primed = 0;
    }
  }
  bytes += static_cast<uint64_t>(size);
  return DR_OK;
}

bool VideoRenderer::EnsureProcessor(UINT inputWidth, UINT inputHeight) {
  if (m_processor && m_processorWidth == inputWidth && m_processorHeight == inputHeight) return true;
  D3D11_VIDEO_PROCESSOR_CONTENT_DESC content{};
  content.InputFrameFormat = D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE;
  content.InputWidth = inputWidth;
  content.InputHeight = inputHeight;
  content.OutputWidth = static_cast<UINT>(m_width);
  content.OutputHeight = static_cast<UINT>(m_height);
  content.Usage = D3D11_VIDEO_USAGE_PLAYBACK_NORMAL;
  m_enumerator = nullptr;
  m_processor = nullptr;
  if (FAILED(m_videoDevice->CreateVideoProcessorEnumerator(&content, m_enumerator.put()))) return false;
  if (FAILED(m_videoDevice->CreateVideoProcessor(m_enumerator.get(), 0, m_processor.put()))) return false;
  // Sunshine sends BT.709, limited range (asked in the stream configuration): to full-range RGB.
  D3D11_VIDEO_PROCESSOR_COLOR_SPACE input{};
  input.YCbCr_Matrix = 1;
  input.Nominal_Range = D3D11_VIDEO_PROCESSOR_NOMINAL_RANGE_16_235;
  m_videoContext->VideoProcessorSetStreamColorSpace(m_processor.get(), 0, &input);
  D3D11_VIDEO_PROCESSOR_COLOR_SPACE output{};
  output.RGB_Range = 0;
  m_videoContext->VideoProcessorSetOutputColorSpace(m_processor.get(), &output);
  m_videoContext->VideoProcessorSetStreamAutoProcessingMode(m_processor.get(), 0, FALSE);
  // An opaque picture: the video has no alpha, and a transparent one would let the black behind show through.
  m_videoContext->VideoProcessorSetOutputAlphaFillMode(m_processor.get(), D3D11_VIDEO_PROCESSOR_ALPHA_FILL_MODE_OPAQUE, 0);
  // Our own RGB texture as the processor's output: a view on the compositor's shared texture is refused by some drivers.
  D3D11_TEXTURE2D_DESC frameDesc{};
  frameDesc.Width = static_cast<UINT>(m_width);
  frameDesc.Height = static_cast<UINT>(m_height);
  frameDesc.MipLevels = 1;
  frameDesc.ArraySize = 1;
  frameDesc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
  frameDesc.SampleDesc.Count = 1;
  frameDesc.Usage = D3D11_USAGE_DEFAULT;
  frameDesc.BindFlags = D3D11_BIND_RENDER_TARGET;
  m_frame = nullptr;
  m_frameView = nullptr;
  if (FAILED(m_device->CreateTexture2D(&frameDesc, nullptr, m_frame.put()))) return false;
  D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC outputDesc{};
  outputDesc.ViewDimension = D3D11_VPOV_DIMENSION_TEXTURE2D;
  if (FAILED(m_videoDevice->CreateVideoProcessorOutputView(m_frame.get(), m_enumerator.get(), &outputDesc, m_frameView.put()))) return false;
  m_processorWidth = inputWidth;
  m_processorHeight = inputHeight;
  return true;
}

bool VideoRenderer::Present(IMFSample *sample) {
  if (!sample) return false;
  winrt::com_ptr<IMFMediaBuffer> buffer;
  if (FAILED(sample->GetBufferByIndex(0, buffer.put()))) return false;
  auto dxgiBuffer = buffer.try_as<IMFDXGIBuffer>();
  if (!dxgiBuffer) return false;
  winrt::com_ptr<ID3D11Texture2D> texture;
  UINT slice = 0;
  if (FAILED(dxgiBuffer->GetResource(IID_PPV_ARGS(texture.put()))) || FAILED(dxgiBuffer->GetSubresourceIndex(&slice))) return false;

  // The decoder's textures are aligned (1088 lines for 1080): only the picture itself is drawn.
  D3D11_TEXTURE2D_DESC textureDesc{};
  texture->GetDesc(&textureDesc);
  if (!EnsureProcessor(textureDesc.Width, textureDesc.Height)) return false;

  D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC inputDesc{};
  inputDesc.ViewDimension = D3D11_VPIV_DIMENSION_TEXTURE2D;
  inputDesc.Texture2D.ArraySlice = slice;
  winrt::com_ptr<ID3D11VideoProcessorInputView> inputView;
  if (FAILED(m_videoDevice->CreateVideoProcessorInputView(texture.get(), m_enumerator.get(), &inputDesc, inputView.put()))) return false;

  if (!m_target) return false;
  RECT source{0, 0, m_width, m_height};
  m_videoContext->VideoProcessorSetStreamSourceRect(m_processor.get(), 0, TRUE, &source);
  D3D11_VIDEO_PROCESSOR_STREAM stream{};
  stream.Enable = TRUE;
  stream.pInputSurface = inputView.get();
  if (FAILED(m_videoContext->VideoProcessorBlt(m_processor.get(), m_frameView.get(), 0, 1, &stream))) return false;

  // Into the surface's texture for this frame: an atlas shared by the compositor, ours at the given offset.
  winrt::com_ptr<ID3D11Texture2D> surface;
  POINT offset{};
  if (FAILED(m_target->BeginDraw(nullptr, __uuidof(ID3D11Texture2D), surface.put_void(), &offset))) return false;
  m_context->CopySubresourceRegion(surface.get(), 0, static_cast<UINT>(offset.x), static_cast<UINT>(offset.y), 0, m_frame.get(), 0, nullptr);
  // Our commands reach the GPU before the compositor reads the surface.
  m_context->Flush();
  if (frames == 0) {
    D3D11_TEXTURE2D_DESC desc{};
    surface->GetDesc(&desc);
    Log("[stream] première image : surface " + std::to_string(desc.Width) + "x" + std::to_string(desc.Height) + " format " +
        std::to_string(desc.Format) + ", décalage " + std::to_string(offset.x) + "," + std::to_string(offset.y));
  }
  // The compositor shows the newest picture at its next frame: the decoder never waits for the screen.
  return SUCCEEDED(m_target->EndDraw());
}

void VideoRenderer::Cleanup() {
  std::lock_guard lock(m_lock);
  if (m_decoder) {
    m_decoder->ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0);
    m_decoder->ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0);
    m_decoder = nullptr;
  }
  m_processor = nullptr;
  m_enumerator = nullptr;
  m_frameView = nullptr;
  m_frame = nullptr;
  m_target = nullptr;
  if (m_timer) {
    CloseHandle(m_timer);
    m_timer = nullptr;
  }
}

} // namespace Waken::Stream
