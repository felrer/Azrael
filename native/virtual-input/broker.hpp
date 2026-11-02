#pragma once
#include "win_util.hpp"
#include <nlohmann/json.hpp>
namespace vi {
using Json=nlohmann::json;
struct Failure : std::runtime_error {
  std::string code, outcome;
  Failure(std::string c,std::string message,std::string o="none") : std::runtime_error(message),code(std::move(c)),outcome(std::move(o)) {}
};
class Broker {
  Handle process_, mapping_, request_, ack_;
  Packet* packet_=nullptr;
  HWND window_=nullptr;
  DWORD pid_=0, thread_=0;
  uint64_t created_=0;
  uintptr_t module_=0;
  std::wstring executable_, dll_;
  bool poisoned_=false, initialized_=false, ambiguous_=false;
  uint32_t sequence_=0;
  void validate();
  void command(Op op,int x=0,int y=0,int value=0,const std::wstring& text={});
  void attach(const Json& params);
  void release();
  Json snapshot();
public:
  ~Broker();
  Json invoke(const Json& request);
  Json status();
  void detach();
  bool shutdown=false;
};
} // namespace vi
