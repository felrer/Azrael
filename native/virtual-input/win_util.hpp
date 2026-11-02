#pragma once
#include "common.hpp"
#include <string>
#include <stdexcept>
#include <vector>
#include <tlhelp32.h>

namespace vi {
struct Handle {
  HANDLE h = nullptr;
  Handle() = default;
  explicit Handle(HANDLE value) : h(value) {}
  ~Handle() { reset(); }
  Handle(const Handle&) = delete;
  Handle& operator=(const Handle&) = delete;
  Handle(Handle&& v) noexcept : h(v.h) { v.h = nullptr; }
  Handle& operator=(Handle&& v) noexcept { if (this != &v) { reset(); h=v.h; v.h=nullptr; } return *this; }
  void reset(HANDLE value=nullptr) { if(h && h!=INVALID_HANDLE_VALUE) CloseHandle(h); h=value; }
  explicit operator bool() const { return h && h!=INVALID_HANDLE_VALUE; }
};
inline std::wstring Wide(const std::string& s) {
  if(s.empty()) return {};
  int n=MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, s.data(), static_cast<int>(s.size()), nullptr,0);
  if(!n) throw std::runtime_error("Invalid UTF-8");
  std::wstring w(n,L'\0'); MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,s.data(),static_cast<int>(s.size()),w.data(),n); return w;
}
inline std::string Utf8(const std::wstring& w) {
  if(w.empty()) return {};
  int n=WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,w.data(),static_cast<int>(w.size()),nullptr,0,nullptr,nullptr);
  if(!n) throw std::runtime_error("Invalid UTF-16");
  std::string s(n,'\0'); WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,w.data(),static_cast<int>(w.size()),s.data(),n,nullptr,nullptr); return s;
}
inline std::wstring Executable(HANDLE p) {
  std::wstring w(32768,L'\0'); DWORD n=static_cast<DWORD>(w.size());
  if(!QueryFullProcessImageNameW(p,0,w.data(),&n)) throw std::runtime_error("Cannot query executable");
  w.resize(n); return w;
}
inline std::wstring Sibling(const wchar_t* name) {
  std::wstring w(32768,L'\0'); DWORD n=GetModuleFileNameW(nullptr,w.data(),static_cast<DWORD>(w.size()));
  if(!n || n>=w.size()) throw std::runtime_error("Cannot resolve sibling");
  w.resize(n); return w.substr(0,w.find_last_of(L"\\/")+1)+name;
}
inline uint64_t Creation(HANDLE p) {
  FILETIME c,e,k,u; if(!GetProcessTimes(p,&c,&e,&k,&u)) throw std::runtime_error("Cannot query creation time"); return FileTimeValue(c);
}
inline uintptr_t Module(DWORD pid,const std::wstring& path,bool full=true) {
  Handle snap(CreateToolhelp32Snapshot(TH32CS_SNAPMODULE|TH32CS_SNAPMODULE32,pid));
  if(!snap) throw std::runtime_error("Cannot enumerate modules");
  MODULEENTRY32W entry{}; entry.dwSize=sizeof(entry);
  if(Module32FirstW(snap.h,&entry)) do {
    if(!_wcsicmp(full?entry.szExePath:entry.szModule,path.c_str())) return reinterpret_cast<uintptr_t>(entry.modBaseAddr);
  } while(Module32NextW(snap.h,&entry));
  return 0;
}
inline std::string Hex(uint64_t value) { char b[24]; sprintf_s(b,"0x%llx",static_cast<unsigned long long>(value)); return b; }
} // namespace vi
