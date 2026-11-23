// <WakenStreamView> for the Windows app (apps/windows/src/WakenStreamViewNativeComponent.ts): a native Fabric
// component that shows the stream (StreamSession) and sends this PC's keyboard, mouse and controllers to it.
#pragma once

#include "NativeModules.h"

namespace Waken::Stream {

void RegisterStreamView(winrt::Microsoft::ReactNative::IReactPackageBuilder const &packageBuilder) noexcept;

}
