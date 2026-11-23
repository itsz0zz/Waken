#include "pch.h"

#include "VideoRenderer.h"

#include <codecapi.h>
#include <mferror.h>

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

  winrt::com_ptr<IDXGIDevice> dxgiDevice = m_device.as<IDXGIDevice>();
  winrt::com_ptr<IDXGIAdapter> adapter;
  winrt::check_hresult(dxgiDevice->GetAdapter(adapter.put()));
  winrt::com_ptr<IDXGIFactory2> factory;
  winrt::check_hresult(adapter->GetParent(IID_PPV_ARGS(factory.put())));

  DXGI_SWAP_CHAIN_DESC1 desc{};
  desc.Width = static_cast<UINT>(width);
  desc.Height = static_cast<UINT>(height);
  desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
  desc.SampleDesc.Count = 1;
  desc.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
  desc.BufferCount = 2;
  desc.SwapEffect = DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL;
  desc.AlphaMode = DXGI_ALPHA_MODE_IGNORE;
  desc.Scaling = DXGI_SCALING_STRETCH;
  hr = factory->CreateSwapChainForComposition(m_device.get(), &desc, nullptr, m_swapChain.put());
  if (FAILED(hr)) {
    error = "Affichage de la vidéo impossible (" + Hex(hr) + ")";
    return false;
  }

  winrt::check_hresult(MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET));
  winrt::check_hresult(MFCreateDXGIDeviceManager(&m_resetToken, m_manager.put()));
  winrt::check_hresult(m_manager->ResetDevice(m_device.get(), m_resetToken));
  return true;
}

int VideoRenderer::Setup(int videoFormat, int width, int height, int fps) {
  std::lock_guard lock(m_lock);
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
  std::lock_guard lock(m_lock);
  if (!m_decoder) return DR_NEED_IDR;

  // One element per RTP packet: a start code can straddle two of them, so the whole frame is put together first.
  m_picture.clear();
  for (PLENTRY entry = unit->bufferList; entry; entry = entry->next) {
    m_picture.insert(m_picture.end(), entry->data, entry->data + entry->length);
  }

  winrt::com_ptr<IMFMediaBuffer> buffer;
  if (FAILED(MFCreateMemoryBuffer(static_cast<DWORD>(m_picture.size()), buffer.put()))) return DR_NEED_IDR;
  BYTE *data = nullptr;
  buffer->Lock(&data, nullptr, nullptr);
  memcpy(data, m_picture.data(), m_picture.size());
  buffer->Unlock();
  buffer->SetCurrentLength(static_cast<DWORD>(m_picture.size()));
  winrt::com_ptr<IMFSample> sample;
  MFCreateSample(sample.put());
  sample->AddBuffer(buffer.get());
  const LONGLONG duration = 10'000'000LL / m_fps;
  sample->SetSampleTime(m_time);
  sample->SetSampleDuration(duration);
  m_time += duration;
  if (unit->frameType == FRAME_TYPE_IDR) sample->SetUINT32(MFSampleExtension_CleanPoint, TRUE);

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
  }
  bytes += static_cast<uint64_t>(unit->fullLength);
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

  winrt::com_ptr<ID3D11Texture2D> backBuffer;
  if (FAILED(m_swapChain->GetBuffer(0, IID_PPV_ARGS(backBuffer.put())))) return false;
  D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC outputDesc{};
  outputDesc.ViewDimension = D3D11_VPOV_DIMENSION_TEXTURE2D;
  winrt::com_ptr<ID3D11VideoProcessorOutputView> outputView;
  if (FAILED(m_videoDevice->CreateVideoProcessorOutputView(backBuffer.get(), m_enumerator.get(), &outputDesc, outputView.put()))) return false;

  RECT source{0, 0, m_width, m_height};
  m_videoContext->VideoProcessorSetStreamSourceRect(m_processor.get(), 0, TRUE, &source);
  D3D11_VIDEO_PROCESSOR_STREAM stream{};
  stream.Enable = TRUE;
  stream.pInputSurface = inputView.get();
  if (FAILED(m_videoContext->VideoProcessorBlt(m_processor.get(), outputView.get(), 0, 1, &stream))) return false;
  // No wait for the screen's refresh: the compositor shows the newest picture, the decoder never waits.
  return SUCCEEDED(m_swapChain->Present(0, 0));
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
}

} // namespace Waken::Stream
