// The picture of the computer played on: H.264 or HEVC decoded by Media Foundation on the graphics card (D3D11),
// turned into RGB by the D3D11 video processor, shown through a swap chain the stream view lays in its visual.
#pragma once

#include <d3d11_4.h>
#include <dxgi1_3.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mftransform.h>

#include <atomic>
#include <cstdint>
#include <mutex>
#include <string>
#include <vector>

#include <winrt/base.h>

#include "Limelight.h"

namespace Waken::Stream {

class VideoRenderer {
 public:
  /// On the UI thread, before the connection: the device and the swap chain the view shows, at the video size.
  bool Create(int width, int height, std::string &error);
  IDXGISwapChain1 *SwapChain() const { return m_swapChain.get(); }

  /// moonlight-common-c's decoder callbacks, on its decoder thread.
  int Setup(int videoFormat, int width, int height, int fps);
  int Submit(PDECODE_UNIT unit);
  void Cleanup();

  std::atomic<uint64_t> frames{0}, bytes{0}, dropped{0};

 private:
  bool SetOutputType();
  bool Present(IMFSample *sample);
  bool EnsureProcessor(UINT inputWidth, UINT inputHeight);

  std::mutex m_lock;
  int m_width = 0, m_height = 0, m_fps = 60;
  winrt::com_ptr<ID3D11Device> m_device;
  winrt::com_ptr<ID3D11DeviceContext> m_context;
  winrt::com_ptr<ID3D11VideoDevice> m_videoDevice;
  winrt::com_ptr<ID3D11VideoContext> m_videoContext;
  winrt::com_ptr<IDXGISwapChain1> m_swapChain;
  winrt::com_ptr<IMFDXGIDeviceManager> m_manager;
  UINT m_resetToken = 0;
  winrt::com_ptr<IMFTransform> m_decoder;
  bool m_providesSamples = false;
  UINT m_processorWidth = 0, m_processorHeight = 0;
  winrt::com_ptr<ID3D11VideoProcessorEnumerator> m_enumerator;
  winrt::com_ptr<ID3D11VideoProcessor> m_processor;
  std::vector<uint8_t> m_picture;
  LONGLONG m_time = 0;
};

} // namespace Waken::Stream
