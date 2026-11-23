// The stream's lines in waken.log (written by Waken.cpp).
#pragma once

#include <string>

namespace Waken::Stream {
void Log(std::string const &line) noexcept;
}
