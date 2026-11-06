#pragma once
#include <windows.h>
#include <cstdint>
#include <type_traits>

namespace vi {
constexpr uint32_t kMagic = 0x41564931;
constexpr uint32_t kVersion = 2;
constexpr DWORD kTimeout = 3000;
constexpr size_t kTextCapacity = 2048;
enum class Op : uint32_t { Status, Move, Down, Up, Wheel, KeyDown, KeyUp, Text, Detach };
enum class Outcome : uint32_t { Ok, Rejected, Unknown, CleanupIncomplete };
// Only handles duplicated into the target cross this ABI. No pointers into broker memory.
struct Config {
  uint32_t magic = kMagic, version = kVersion;
  uint64_t mapping = 0, request = 0, ack = 0, controller = 0, window = 0;
  uint32_t pid = 0, thread = 0;
  uint64_t created = 0;
};
struct Packet {
  uint32_t magic = kMagic, version = kVersion;
  Op op = Op::Status;
  Outcome outcome = Outcome::Rejected;
  uint32_t sequence = 0, completed = 0;
  int32_t x = 0, y = 0, value = 0;
  uint32_t textLength = 0;
  wchar_t text[kTextCapacity]{};
  POINT position{};
  RECT client{};
  BYTE keys[256]{};
  uint32_t ready = 0, cleanup = 0;
  wchar_t error[160]{};
  uint64_t lastRecipient = 0;
  uint32_t lastMessage = 0, deliveredMessages = 0;
  int64_t lastMessageResult = 0;
};
static_assert(std::is_trivially_copyable_v<Config> && std::is_trivially_copyable_v<Packet>);
inline uint64_t FileTimeValue(FILETIME t) { return (uint64_t(t.dwHighDateTime) << 32) | t.dwLowDateTime; }
constexpr UINT kFixtureProbe = WM_APP + 41;
constexpr UINT kFixtureQuit = WM_APP + 42;
constexpr UINT kFixtureText = WM_APP + 43;
} // namespace vi
