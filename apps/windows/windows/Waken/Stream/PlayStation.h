// PS5 and PS4 for the Windows app, through libchiaki (Chiaki\Chiaki.vcxproj): found on the home network, linked
// once with the PSN account and the console's 8-digit code, woken. The same as MLPlayStation on iPhone and Mac.
// Every call blocks: the app runs them off its UI thread.
#pragma once

#include <string>

namespace Waken::Stream::PlayStation {

/// The consoles answering on this network for a few seconds, as JSON:
/// [{host, name, id, ps5, state: ready|standby|unknown, systemVersion, app}].
std::string Discover(double seconds);

/// Links this PC with a console. On success, JSON {registKey, rpKey, rpKeyType, mac, nickname, ps5, target}; on
/// failure, throws std::runtime_error with the reason (in French, shown as is).
std::string Register(std::string const &host, bool ps5, std::string const &accountId, std::string const &pin);

/// Wakes a linked console from rest mode on this network. Empty, or the reason it could not.
std::string Wake(std::string const &host, std::string const &registKey, bool ps5);

} // namespace Waken::Stream::PlayStation
