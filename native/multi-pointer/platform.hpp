#pragma once
#include <windows.h>
#include <nlohmann/json.hpp>
#include <algorithm>
#include <array>
#include <atomic>
#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace mp {
using json = nlohmann::json;
struct Failure : std::runtime_error {
    std::string code;
    json details = nullptr;
    Failure(std::string c, const std::string& m, json d = nullptr) : std::runtime_error(m), code(std::move(c)), details(std::move(d)) {}
};
inline void require(bool ok, const char* code, const char* message) {
    if (!ok) throw Failure(code, message);
}
struct Handle {
    HANDLE value = nullptr;
    explicit Handle(HANDLE h = nullptr) : value(h) {}
    ~Handle() { if (value && value != INVALID_HANDLE_VALUE) CloseHandle(value); }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    Handle(Handle&& h) noexcept : value(h.value) { h.value = nullptr; }
    Handle& operator=(Handle&& h) noexcept {
        if (this != &h) { if (value && value != INVALID_HANDLE_VALUE) CloseHandle(value); value = h.value; h.value = nullptr; }
        return *this;
    }
};
inline std::wstring wide(const std::string& s) {
    require(s.size() <= 65536, "invalid_params", "UTF-8 input too long");
    if (s.empty()) return {};
    const int n = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, s.data(), static_cast<int>(s.size()), nullptr, 0);
    require(n > 0, "invalid_params", "Invalid UTF-8");
    std::wstring w(static_cast<size_t>(n), L'\0');
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, s.data(), static_cast<int>(s.size()), w.data(), n);
    return w;
}
inline std::string utf8(const std::wstring& s) {
    if (s.empty()) return {};
    const int n = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, s.data(), static_cast<int>(s.size()), nullptr, 0, nullptr, nullptr);
    require(n > 0, "win32", "Cannot encode UTF-16");
    std::string out(static_cast<size_t>(n), '\0');
    WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, s.data(), static_cast<int>(s.size()), out.data(), n, nullptr, nullptr);
    return out;
}
inline std::string hex(uint64_t n) { char s[24]{}; sprintf_s(s, "0x%llx", static_cast<unsigned long long>(n)); return s; }
inline uint64_t parseHex(const json& j) {
    require(j.is_string(), "invalid_params", "Identity must be a 0x hexadecimal string");
    const auto s = j.get<std::string>();
    require(s.size() >= 3 && s.size() <= 18 && s[0] == '0' && s[1] == 'x', "invalid_params", "Invalid hexadecimal identity");
    uint64_t n = 0;
    for (size_t i = 2; i < s.size(); ++i) {
        const char c = s[i];
        int d = c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1;
        require(d >= 0, "invalid_params", "Invalid hexadecimal identity");
        n = n * 16 + static_cast<unsigned>(d);
    }
    return n;
}
inline uint64_t creation(HANDLE process) {
    FILETIME c{}, e{}, k{}, u{};
    require(GetProcessTimes(process, &c, &e, &k, &u) != FALSE, "identity", "Cannot query process creation time");
    return (static_cast<uint64_t>(c.dwHighDateTime) << 32) | c.dwLowDateTime;
}
inline std::wstring executable(HANDLE process) {
    std::wstring out(32768, L'\0'); DWORD n = static_cast<DWORD>(out.size());
    require(QueryFullProcessImageNameW(process, 0, out.data(), &n) != FALSE, "identity", "Cannot query process executable");
    out.resize(n); return out;
}
inline std::wstring normalizedPath(std::wstring p) {
    require(p.find(L'\0') == std::wstring::npos, "identity", "Executable path contains NUL");
    std::replace(p.begin(), p.end(), L'/', L'\\');
    require(std::filesystem::path(p).is_absolute(), "identity", "Executable path must be absolute");
    return std::filesystem::path(p).lexically_normal().wstring();
}
inline std::vector<BYTE> userSid(HANDLE token) {
    DWORD n = 0; GetTokenInformation(token, TokenUser, nullptr, 0, &n);
    require(n > 0 && n < 65536, "identity", "Cannot query token user");
    std::vector<BYTE> data(n);
    require(GetTokenInformation(token, TokenUser, data.data(), n, &n) != FALSE, "identity", "Cannot read token user");
    return data;
}
inline DWORD integrity(HANDLE token) {
    DWORD size=0; GetTokenInformation(token,TokenIntegrityLevel,nullptr,0,&size);
    require(size>0 && size<65536,"identity","Cannot query process integrity");
    std::vector<BYTE> data(size);
    require(GetTokenInformation(token,TokenIntegrityLevel,data.data(),size,&size)!=FALSE,"identity","Cannot read process integrity");
    const auto* label=reinterpret_cast<const TOKEN_MANDATORY_LABEL*>(data.data());
    require(IsValidSid(label->Label.Sid)!=FALSE,"identity","Invalid process integrity SID");
    const UCHAR count=*GetSidSubAuthorityCount(label->Label.Sid);
    require(count>0,"identity","Missing process integrity level");
    return *GetSidSubAuthority(label->Label.Sid,count-1);
}
inline void checkToken(HANDLE process) {
    HANDLE raw = nullptr;
    require(OpenProcessToken(process, TOKEN_QUERY, &raw) != FALSE, "identity", "Cannot open process token");
    Handle token(raw); TOKEN_ELEVATION elevation{}; DWORD n = 0;
    require(GetTokenInformation(token.value, TokenElevation, &elevation, sizeof(elevation), &n) != FALSE && !elevation.TokenIsElevated,
        "identity", "Elevated processes are forbidden");
    raw = nullptr;
    require(OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &raw) != FALSE, "identity", "Cannot open broker token");
    Handle self(raw); const auto a = userSid(token.value); const auto b = userSid(self.value);
    require(EqualSid(reinterpret_cast<const TOKEN_USER*>(a.data())->User.Sid, reinterpret_cast<const TOKEN_USER*>(b.data())->User.Sid) != FALSE,
        "identity", "Process belongs to another user");
    require(integrity(token.value)<=integrity(self.value),"identity","Higher-integrity processes are forbidden");
}
inline std::wstring objectName(HANDLE object) {
    std::array<wchar_t, 256> name{}; DWORD n = 0;
    require(GetUserObjectInformationW(object, UOI_NAME, name.data(), static_cast<DWORD>(sizeof(name)), &n) != FALSE,
        "desktop", "Cannot inspect desktop identity");
    return name.data();
}
inline void checkDesktop() {
    require(objectName(GetProcessWindowStation()) == L"WinSta0", "desktop", "Interactive WinSta0 is required");
    require(objectName(GetThreadDesktop(GetCurrentThreadId())) == L"Default", "desktop", "Default desktop is required");
    HDESK input = OpenInputDesktop(0, FALSE, DESKTOP_READOBJECTS);
    require(input != nullptr, "desktop", "Cannot open current input desktop");
    bool isDefault = false;
    try { isDefault = objectName(input) == L"Default"; } catch (...) { CloseDesktop(input); throw; }
    CloseDesktop(input);
    require(isDefault, "desktop", "Default desktop is not the current input desktop");
}
inline int integer(const json& j, const char* name, int lo, int hi) {
    require(j.contains(name) && j.at(name).is_number_integer(), "invalid_params", "Expected integer parameter");
    const auto n = j.at(name).get<int64_t>();
    require(n >= lo && n <= hi, "invalid_params", "Integer parameter out of range");
    return static_cast<int>(n);
}
inline std::string identifier(const json& j, const char* name) {
    require(j.contains(name) && j.at(name).is_string(), "invalid_params", "Expected identifier");
    auto s = j.at(name).get<std::string>();
    require(!s.empty() && s.size() <= 32 && std::all_of(s.begin(), s.end(), [](char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_';
    }), "invalid_params", "Identifiers must be 1-32 ASCII letters, digits, hyphens or underscores");
    return s;
}
struct HitSnapshot {
    HWND hwnd = nullptr, root = nullptr, foreground = nullptr, foregroundRoot = nullptr;
    DWORD pid = 0, thread = 0, foregroundPid = 0, foregroundThread = 0;
    DWORD observerThread = 0;
    ULONGLONG tick = 0;
    bool visible = false, enabled = false;
};
struct SurfaceMatch {
    bool accepted = false, ownedPopup = false;
    const char* reason = "uninspected";
    std::array<HWND,17> chain{};
    std::array<DWORD,17> threads{};
    size_t length = 0;
};
struct Target {
    std::string id;
    bool outerWindow = false;
    DWORD pid = 0;
    uint64_t born = 0;
    HWND hwnd = nullptr;
    DWORD thread = 0;
    std::wstring path;
    Handle process;
    std::shared_ptr<std::atomic<bool>> destroyed = std::make_shared<std::atomic<bool>>(false);
    void validate() const {
        checkDesktop();
        require(!destroyed->load(), "identity", "Pinned window was destroyed; broker restart and a new target file are required");
        require(WaitForSingleObject(process.value, 0) == WAIT_TIMEOUT && creation(process.value) == born,
            "identity", "Pinned process has exited or changed");
        require(_wcsicmp(normalizedPath(executable(process.value)).c_str(), path.c_str()) == 0, "identity", "Executable identity changed");
        checkToken(process.value);
        DWORD currentPid = 0; const DWORD currentThread = GetWindowThreadProcessId(hwnd, &currentPid);
        require(IsWindow(hwnd) && GetAncestor(hwnd, GA_ROOT) == hwnd && currentPid == pid && currentThread == thread,
            "identity", "Pinned root window is missing or has changed");
        HDESK targetDesktop = GetThreadDesktop(thread);
        require(targetDesktop != nullptr && objectName(targetDesktop) == L"Default", "desktop", "Target root is not on the Default desktop");
        require(IsWindowVisible(hwnd) && !IsIconic(hwnd) && IsWindowEnabled(hwnd), "target_unavailable", "Target must be visible, enabled and restored");
    }
    void point(POINT p) const {
        RECT r{};
        if (outerWindow) require(GetWindowRect(hwnd, &r) != FALSE, "identity", "Cannot query target window bounds");
        else {
            require(GetClientRect(hwnd, &r) != FALSE, "identity", "Cannot query target client bounds");
            POINT a{r.left, r.top}, b{r.right, r.bottom};
            require(ClientToScreen(hwnd, &a) && ClientToScreen(hwnd, &b), "identity", "Cannot map target client bounds");
            r = RECT{a.x,a.y,b.x,b.y};
        }
        require(p.x >= r.left && p.x < r.right && p.y >= r.top && p.y < r.bottom, "point_outside_target", "Point must be inside the pinned target bounds");
        const int vx = GetSystemMetrics(SM_XVIRTUALSCREEN), vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
        require(p.x >= vx && p.y >= vy && p.x < vx + GetSystemMetrics(SM_CXVIRTUALSCREEN) && p.y < vy + GetSystemMetrics(SM_CYVIRTUALSCREEN),
            "point_outside_screen", "Point must be on the virtual screen");
    }
    bool surfaceWindowIdentity(HWND window, DWORD& currentThread) const {
        DWORD currentPid = 0; currentThread = GetWindowThreadProcessId(window, &currentPid);
        if (!IsWindow(window) || !currentThread || currentPid != pid || GetAncestor(window, GA_ROOT) != window) return false;
        HDESK desktop = GetThreadDesktop(currentThread);
        if (!desktop) return false;
        try { return objectName(desktop) == L"Default"; }
        catch (const Failure&) { return false; }
    }
    SurfaceMatch surface(HWND root) const {
        validate();
        SurfaceMatch match;
        if (!surfaceWindowIdentity(root, match.threads[0])) { match.reason = "surface_identity_or_desktop_unavailable"; return match; }
        match.chain[0] = root; match.length = 1;
        if (root == hwnd) {
            if (match.threads[0] != thread) { match.reason = "bound_root_thread_changed"; return match; }
            match.accepted = true; match.reason = "exact_bound_root"; return match;
        }
        const auto popupStyle = [](HWND window) {
            const auto style = static_cast<ULONG_PTR>(GetWindowLongPtrW(window, GWL_STYLE));
            return (style & WS_POPUP) != 0 && (style & WS_CHILD) == 0;
        };
        if (!popupStyle(root) || !IsWindowVisible(root) || !IsWindowEnabled(root)) {
            match.reason = "surface_is_not_visible_enabled_top_level_popup"; return match;
        }
        HWND current = root;
        // At most 16 owner edges and 17 distinct windows, including the pinned
        // main. Same-process unowned siblings never pass this ownership proof.
        for (size_t edge = 0; edge < 16; ++edge) {
            HWND owner = GetWindow(current, GW_OWNER);
            if (!owner) { match.reason = "owner_chain_ended_before_bound_root"; return match; }
            for (size_t i = 0; i < match.length; ++i) if (match.chain[i] == owner) {
                match.reason = "owner_chain_cycle"; return match;
            }
            DWORD ownerThread = 0;
            if (!surfaceWindowIdentity(owner, ownerThread)) { match.reason = "owner_identity_or_desktop_unavailable"; return match; }
            match.chain[match.length] = owner; match.threads[match.length] = ownerThread; ++match.length;
            if (owner == hwnd) {
                validate();
                if (!popupStyle(root) || !IsWindowVisible(root) || !IsWindowEnabled(root)) {
                    match.reason = "popup_availability_changed"; return match;
                }
                for (size_t i = 0; i < match.length; ++i) {
                    DWORD nowThread = 0;
                    if (!surfaceWindowIdentity(match.chain[i], nowThread) || nowThread != match.threads[i] ||
                        (i + 1 < match.length && GetWindow(match.chain[i], GW_OWNER) != match.chain[i + 1])) {
                        match.reason = "owner_chain_identity_changed"; return match;
                    }
                }
                match.accepted = true; match.ownedPopup = true; match.reason = "owned_popup_of_bound_root"; return match;
            }
            current = owner;
        }
        match.reason = "owner_chain_depth_exceeded"; return match;
    }
    static json describeSurface(const SurfaceMatch& match) {
        json chain = json::array();
        for (size_t i = 0; i < match.length; ++i)
            chain.push_back({{"hwnd",hex(reinterpret_cast<uintptr_t>(match.chain[i]))},{"threadId",match.threads[i]}});
        return {{"accepted",match.accepted},{"ownedPopup",match.ownedPopup},{"reason",match.reason},{"ownerChain",chain}};
    }
    static HitSnapshot observeHit(POINT p) {
        HitSnapshot o;
        o.observerThread = GetCurrentThreadId(); o.tick = GetTickCount64();
        o.hwnd = WindowFromPoint(p); o.thread = GetWindowThreadProcessId(o.hwnd, &o.pid);
        o.root = GetAncestor(o.hwnd, GA_ROOT);
        o.visible = IsWindowVisible(o.hwnd) != FALSE; o.enabled = IsWindowEnabled(o.hwnd) != FALSE;
        o.foreground = GetForegroundWindow(); o.foregroundRoot = GetAncestor(o.foreground, GA_ROOT);
        o.foregroundThread = GetWindowThreadProcessId(o.foreground, &o.foregroundPid);
        return o;
    }
    json describeHit(POINT p, const HitSnapshot& o, const SurfaceMatch& hitSurface, const SurfaceMatch& foregroundSurface) const {
        return {{"point",{{"x",p.x},{"y",p.y}}},{"observerThreadId",o.observerThread},{"observerProcessId",GetCurrentProcessId()},
            {"observedAtTick64",o.tick},
            {"expected",{{"targetId",id},{"pid",pid},{"rootHwnd",hex(reinterpret_cast<uintptr_t>(hwnd))},{"threadId",thread}}},
            {"observed",{{"hwnd",hex(reinterpret_cast<uintptr_t>(o.hwnd))},{"pid",o.pid},{"threadId",o.thread},
                {"rootHwnd",hex(reinterpret_cast<uintptr_t>(o.root))},{"visible",o.visible},{"enabled",o.enabled},
                {"brokerOwned",o.pid == GetCurrentProcessId()}}},
            {"foreground",{{"hwnd",hex(reinterpret_cast<uintptr_t>(o.foreground))},{"rootHwnd",hex(reinterpret_cast<uintptr_t>(o.foregroundRoot))},
                {"pid",o.foregroundPid},{"threadId",o.foregroundThread}}},
            {"hitSurface",describeSurface(hitSurface)},{"foregroundSurface",describeSurface(foregroundSurface)},
            {"matchesExpectedHit",o.hwnd && o.pid == pid && hitSurface.accepted && o.visible && o.enabled},
            {"matchesExpectedForeground",o.foregroundPid == pid && foregroundSurface.accepted}};
    }
    json describeHit(POINT p, const HitSnapshot& o) const {
        const auto hitSurface = surface(o.root), foregroundSurface = surface(o.foregroundRoot);
        return describeHit(p, o, hitSurface, foregroundSurface);
    }
    void hit(POINT p) const {
        validate(); point(p);
        const auto o = observeHit(p);
        const auto hitSurface = surface(o.root), foregroundSurface = surface(o.foregroundRoot);
        if (o.foregroundPid != pid || !foregroundSurface.accepted)
            throw Failure("foreground", "Foreground is neither the bound root nor an accepted owned popup", describeHit(p, o, hitSurface, foregroundSurface));
        if (!(o.hwnd && o.pid == pid && hitSurface.accepted && o.visible && o.enabled))
            throw Failure("occluded", "Visible hit target is neither the bound root nor an accepted owned popup", describeHit(p, o, hitSurface, foregroundSurface));
    }
};
// Capacity is reserved before hooks start. Desktop pins are append-only and
// never replace a live identity; UI event observers retain stable addresses.
struct TargetSet : std::vector<Target> { bool desktop = false; };
} // namespace mp
