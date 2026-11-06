#pragma once
#include "overlay.hpp"
#include "operations.hpp"
#include <chrono>
#include <condition_variable>
#include <deque>
#include <fstream>
#include <map>
#include <mutex>
#include <thread>

namespace mp {
inline void diagnostic(const char* level, const char* event, const std::string& code = {}) {
    SYSTEMTIME t{}; GetSystemTime(&t); char utc[40]{};
    sprintf_s(utc, "%04u-%02u-%02uT%02u:%02u:%02u.%03uZ", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond, t.wMilliseconds);
    json j{{"time",utc},{"level",level},{"component","multi-pointer"},{"event",event},{"version","prototype-1"},{"platform","win32-x64"}};
    if (!code.empty()) j["code"] = code;
    j["win32Error"] = GetLastError();
    const std::string line = j.dump() + "\n"; DWORD written = 0;
    WriteFile(GetStdHandle(STD_ERROR_HANDLE), line.data(), static_cast<DWORD>(line.size()), &written, nullptr);
}
inline Target pinTarget(const json& item, const std::string& id, bool outerWindow = false) {
    require(item.is_object(), "invalid_targets", "Target entry must be an object");
    Target t; t.id = id; t.outerWindow = outerWindow;
    require(item.contains("pid") && item.at("pid").is_number_integer(), "invalid_targets", "Target pid must be an integer");
    const auto pid = item.at("pid").get<int64_t>();
    require(pid > 0 && static_cast<uint64_t>(pid) <= MAXDWORD && pid != GetCurrentProcessId(), "invalid_targets", "Invalid or self target pid");
    t.pid = static_cast<DWORD>(pid);
    t.born = parseHex(item.at("createdFileTime")); t.hwnd = reinterpret_cast<HWND>(static_cast<uintptr_t>(parseHex(item.at("hwnd"))));
    t.path = normalizedPath(wide(item.at("executable").get<std::string>()));
    DWORD selfSession = 0, session = 0;
    require(ProcessIdToSessionId(GetCurrentProcessId(), &selfSession) && ProcessIdToSessionId(t.pid, &session) && session == selfSession,
        "identity", "Target belongs to another session");
    t.process = Handle(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, t.pid));
    require(t.process.value != nullptr, "identity", "Cannot open pinned target process");
    DWORD windowPid = 0; t.thread = GetWindowThreadProcessId(t.hwnd, &windowPid);
    require(windowPid == t.pid && t.thread != 0, "identity", "Root HWND does not belong to pinned process");
    t.validate(); return t;
}
inline TargetSet loadTargets(const std::wstring& file) {
    require(std::filesystem::path(file).is_absolute(), "invalid_targets", "--targets requires an absolute path");
    std::ifstream stream(std::filesystem::path(file), std::ios::binary);
    require(stream.good(), "invalid_targets", "Cannot read target file");
    std::string bytes(65537, '\0'); stream.read(bytes.data(), static_cast<std::streamsize>(bytes.size()));
    const auto count = stream.gcount(); require(count > 0 && count <= 65536, "invalid_targets", "Target file must be 1-65536 bytes");
    bytes.resize(static_cast<size_t>(count)); const auto document = json::parse(bytes);
    require(document.is_object() && document.contains("schema") && document.at("schema").is_number_integer() && document.at("schema") == 1 && document.contains("targets") && document.at("targets").is_array(),
        "invalid_targets", "Target file requires schema 1 and targets array");
    const auto& list = document.at("targets"); require(!list.empty() && list.size() <= 32, "invalid_targets", "Expected 1-32 pinned targets");
    checkDesktop(); checkToken(GetCurrentProcess());
    TargetSet out; out.reserve(32);
    require(!document.contains("desktop") || document.at("desktop").is_boolean(), "invalid_targets", "desktop must be boolean");
    out.desktop = document.value("desktop",false);
    for (const auto& item : list) {
        auto t = pinTarget(item,identifier(item,"id"),out.desktop);
        for (const auto& other : out) require(t.id != other.id && t.hwnd != other.hwnd, "invalid_targets", "Duplicate target id or root HWND");
        out.push_back(std::move(t));
    }
    return out;
}

struct Pointer { std::string id; size_t target = 0; POINT position{}; COLORREF color = RGB(74,144,226); };
struct InputTicket { std::string line; std::shared_ptr<Operation> operation; std::shared_ptr<HumanGesture> human; uint64_t stopGeneration = 0; };
class Broker {
    Signals& signals;
    Ui& ui;
    std::vector<Target>& targets;
    const bool desktopEnabled;
    std::map<uint64_t,std::pair<std::weak_ptr<Operation>,size_t>> operationTargets;
    std::map<std::string, Pointer> pointers;
    std::array<bool, 256> heldKeys{};
    std::array<bool, 3> heldButtons{};
    std::vector<WORD> heldUnicode;
    std::string owner;
    uint64_t baseline = 0, idleEpoch = 0;
    size_t delivered = 0;
    size_t activationDelivered = 0;
    std::string activationPath = "none";
    bool actionExecuted = false, foregroundAttempted = false;
    bool cleanupFailed = false;
    std::mutex queueMutex, outputMutex;
    std::condition_variable ready;
    std::deque<InputTicket> queue;
    Operations operations;
    std::shared_ptr<Operation> operation;
    uint64_t humanApplicationInputs = 0;
    uint64_t processingStopGeneration = 0;
    uint64_t handoffStarted = 0;
    std::deque<std::string> moves;
    std::deque<json> moveReplies;
    bool executingInput = false;
    bool observationTurn = false;
    bool visualTurn = false;
    std::atomic<bool> finishReader{false};
    std::thread reader;
    static constexpr size_t maxLine = 65536;
    static constexpr DWORD downFlags[3]{MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_MIDDLEDOWN};
    static constexpr DWORD upFlags[3]{MOUSEEVENTF_LEFTUP, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_MIDDLEUP};
    static constexpr int buttonVks[3]{VK_LBUTTON, VK_RBUTTON, VK_MBUTTON};

    void reply(const json& value) {
        const auto line = value.dump() + "\n"; std::lock_guard<std::mutex> guard(outputMutex);
        size_t offset = 0;
        while (offset < line.size()) {
            DWORD written = 0;
            if (!WriteFile(GetStdHandle(STD_OUTPUT_HANDLE), line.data() + offset, static_cast<DWORD>(line.size() - offset), &written, nullptr) || !written) {
                disconnect(); return;
            }
            offset += written;
        }
    }
    void disconnect() { signals.disconnected.store(true); signals.epoch.fetch_add(1); ready.notify_all(); }
    void readLoop() {
        std::array<char,4096> bytes{}; std::string line; bool oversized = false;
        while (!finishReader.load()) {
            DWORD n = 0;
            if (!ReadFile(GetStdHandle(STD_INPUT_HANDLE), bytes.data(), static_cast<DWORD>(bytes.size()), &n, nullptr) || !n) break;
            for (DWORD i = 0; i < n; ++i) {
                if (finishReader.load()) break;
                if (bytes[i] == '\n') {
                    if (oversized) {
                        reply({{"id",nullptr},{"error",{{"code","line_too_long"},{"message","Input line exceeds 65536 bytes; discarded without replay"},{"actionExecuted",false}}}});
                    } else {
                        if (!line.empty() && line.back() == '\r') line.pop_back();
                        bool logicalMove=false;
                        uint64_t stopGeneration=0;
                        try {
                            const auto observed=json::parse(line);
                            if (observed.is_object() && observed.contains("method") && observed.at("method").is_string()) {
                                const auto method=observed.at("method").get<std::string>(); logicalMove=method=="move";
                                if (method=="stop" || method=="shutdown" || (method=="collaboration" && observed.contains("params") && observed.at("params").is_object() &&
                                    observed.at("params").contains("enabled") && observed.at("params").at("enabled")==false)) {
                                    stopGeneration=signals.stopGeneration.fetch_add(1)+1; signals.explicitStop.store(true); signals.epoch.fetch_add(1);
                                }
                            }
                        } catch (const json::exception&) { /* Main parser returns the error. */ }
                        bool full = false;
                        { std::lock_guard<std::mutex> guard(queueMutex);
                            full=(logicalMove ? moves.size() : queue.size())>=16;
                            if (!full) { if (logicalMove) moves.push_back(std::move(line)); else queue.push_back({std::move(line),nullptr,nullptr,stopGeneration}); }
                        }
                        if (full) reply({{"id",nullptr},{"error",{{"code","queue_full"},{"message","Request discarded without replay"},{"actionExecuted",false}}}});
                        ready.notify_all();
                    }
                    line.clear(); oversized = false;
                } else if (!oversized) {
                    if (line.size() == maxLine) { line.clear(); oversized = true; }
                    else line.push_back(bytes[i]);
                }
            }
        }
        // A final unterminated line is never executed. Disconnect cancels queued
        // work as well as the current action; callers must keep stdin open.
        disconnect();
    }
    INPUT mouseInput(DWORD flags, DWORD data = 0) const {
        INPUT e{}; e.type = INPUT_MOUSE; e.mi.dwFlags = flags; e.mi.mouseData = data; e.mi.dwExtraInfo = signals.tag; return e;
    }
    INPUT keyInput(WORD vk, bool down) const {
        INPUT e{}; e.type = INPUT_KEYBOARD; e.ki.wVk = vk; e.ki.dwExtraInfo = signals.tag;
        e.ki.dwFlags = down ? 0 : KEYEVENTF_KEYUP;
        if (vk == VK_RCONTROL || vk == VK_RMENU || vk == VK_INSERT || vk == VK_DELETE || vk == VK_HOME || vk == VK_END ||
            vk == VK_PRIOR || vk == VK_NEXT || vk == VK_LEFT || vk == VK_RIGHT || vk == VK_UP || vk == VK_DOWN || vk == VK_DIVIDE ||
            vk == VK_NUMLOCK || vk == VK_SNAPSHOT || vk == VK_LWIN || vk == VK_RWIN || vk == VK_APPS) e.ki.dwFlags |= KEYEVENTF_EXTENDEDKEY;
        return e;
    }
    bool sendRelease(INPUT e) {
        return SendInput(1, &e, sizeof(e)) == 1;
    }
    void trackDelivery(const INPUT& e) {
        if (e.type==INPUT_MOUSE) {
            for (size_t i=0;i<3;++i) { if (e.mi.dwFlags&downFlags[i]) heldButtons[i]=true; if (e.mi.dwFlags&upFlags[i]) heldButtons[i]=false; }
        } else if (e.type==INPUT_KEYBOARD) {
            const bool up=(e.ki.dwFlags&KEYEVENTF_KEYUP)!=0;
            if (e.ki.dwFlags&KEYEVENTF_UNICODE) {
                if (!up) heldUnicode.push_back(e.ki.wScan);
                else { const auto found=std::find(heldUnicode.begin(),heldUnicode.end(),e.ki.wScan); if (found!=heldUnicode.end()) heldUnicode.erase(found); }
            } else if (e.ki.wVk<256) heldKeys[e.ki.wVk]=!up;
        }
    }
    void requireHookObservation(bool mouseEvent, uint64_t before, bool handoff = false) {
        if ((!handoff && !ui.routing.capture.load()) || !signals.collaborationRequested.load()) return;
        const auto deadline=std::chrono::steady_clock::now()+std::chrono::milliseconds(20);
        bool settled=false;
        while (std::chrono::steady_clock::now()<deadline) {
            boundary();
            if ((mouseEvent?signals.ownMouse.load():signals.ownKeyboard.load())>before) {
                settled=true;
                if (mouseEvent) ui.invoke([&] { ui.routing.tick(); settled=ui.routing.ownMouseSettled(); });
                boundary();
                if (settled) return;
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
        if (!settled) {
            ui.routing.fail(MouseRouting::Fault::hookLost);
            throw Failure("hook_unverified","Own injected event did not obtain matching hook and RAW receipts before the deadline; routing failed open");
        }
    }
    bool releaseHeld() {
        bool ok = true;
        for (size_t i = 0; i < heldButtons.size(); ++i) if (heldButtons[i]) {
            if (sendRelease(mouseInput(upFlags[i]))) heldButtons[i] = false; else ok = false;
        }
        for (size_t i = 0; i < heldKeys.size(); ++i) if (heldKeys[i]) {
            if (sendRelease(keyInput(static_cast<WORD>(i), false))) heldKeys[i] = false; else ok = false;
        }
        for (auto it = heldUnicode.begin(); it != heldUnicode.end();) {
            INPUT e{}; e.type = INPUT_KEYBOARD; e.ki.wScan = *it; e.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP; e.ki.dwExtraInfo = signals.tag;
            if (sendRelease(e)) it = heldUnicode.erase(it); else { ok = false; ++it; }
        }
        if (ok) owner.clear();
        cleanupFailed = !ok;
        return ok;
    }
    void clear() { const bool ok = releaseHeld(); ui.clear(); pointers.clear(); require(ok, "cleanup_failed", "One or more synthetic releases were not delivered"); }
    void boundary() {
        signals.brokerHeartbeat.store(GetTickCount64());
        processMoves();
        require(!signals.disconnected.load(), "disconnected", "Input/output stream disconnected");
        require(!signals.explicitStop.load(),"stopped","Explicit stop or collaboration revocation requested");
        require(!signals.collaborationRequested.load() || ui.routing.phase.load()!=MouseRouting::Phase::failed,"collaboration_failed","Mouse routing failed open; model input stopped safely");
        require(!signals.emergency.load() && signals.epoch.load() == baseline, "interrupted", "Physical or foreign input interrupted this operation; no replay");
    }
    bool synthetic(int vk) const {
        if (vk >= 0 && vk < 256 && heldKeys[static_cast<size_t>(vk)]) return true;
        for (size_t i = 0; i < heldButtons.size(); ++i) if (buttonVks[i] == vk && heldButtons[i]) return true;
        return false;
    }
    void physicalGate() const {
        for (int vk : {VK_LBUTTON,VK_RBUTTON,VK_MBUTTON,VK_XBUTTON1,VK_XBUTTON2,VK_LSHIFT,VK_RSHIFT,VK_LCONTROL,VK_RCONTROL,VK_LMENU,VK_RMENU,VK_LWIN,VK_RWIN}) {
            if (ui.routing.capture.load() && ui.routing.enabled.load() && (vk==VK_LBUTTON || vk==VK_RBUTTON || vk==VK_MBUTTON)) continue;
            require(!signals.physical[static_cast<size_t>(vk)].load() && (!(GetAsyncKeyState(vk) & 0x8000) || synthetic(vk)),
                "physical_held", "Release physical mouse buttons and modifiers before actuation");
        }
    }
    Target& target(const Pointer& p) { return targets.at(p.target); }
    void checkHit(Pointer& p, POINT point) { boundary(); physicalGate(); target(p).hit(point); boundary(); }
    void send(Pointer& p, INPUT e, POINT point) {
        checkHit(p, point);
        ui.requireSystemCursor(); boundary();
        const auto before=e.type==INPUT_MOUSE?signals.ownMouse.load():signals.ownKeyboard.load();
        require(SendInput(1, &e, sizeof(e)) == 1, "send_input", "SendInput did not deliver the event (possible UIPI or desktop change)");
        trackDelivery(e);
        ++delivered; actionExecuted = true;
        if (operation) {
            ++operation->deliveredInputs; operation->actionExecuted = true;
            if (e.type != INPUT_MOUSE || !(e.mi.dwFlags & MOUSEEVENTF_MOVE)) ++operation->applicationInputs;
        }
        requireHookObservation(e.type==INPUT_MOUSE,before);
    }
    INPUT absoluteMove(POINT point) const {
        const int x = GetSystemMetrics(SM_XVIRTUALSCREEN), y = GetSystemMetrics(SM_YVIRTUALSCREEN);
        const int w = GetSystemMetrics(SM_CXVIRTUALSCREEN), h = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        require(w > 1 && h > 1, "screen", "Invalid virtual desktop dimensions");
        require(w <= 32768 && h <= 32768, "screen_precision", "Virtual desktop dimensions exceed the exact-pixel absolute-input precision limit (32768 per axis)");
        require(point.x >= x && point.y >= y && static_cast<int64_t>(point.x) < static_cast<int64_t>(x) + w &&
            static_cast<int64_t>(point.y) < static_cast<int64_t>(y) + h, "point_outside_screen", "Input point must be on the virtual screen");
        INPUT e = mouseInput(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK);
        // Windows maps normalized coordinates using dimension / 65536. Select
        // the center of the requested pixel's bin, rather than interpolating
        // endpoints with 65535/(dimension-1), which can land one pixel short.
        // The axis limit leaves at least two normalized units per pixel, so
        // integer truncation of the center cannot cross into the previous bin.
        e.mi.dx = static_cast<LONG>(((static_cast<int64_t>(point.x) - x) * 65536 + 32768) / w);
        e.mi.dy = static_cast<LONG>(((static_cast<int64_t>(point.y) - y) * 65536 + 32768) / h);
        return e;
    }
    void verifyCursor(POINT point) const {
        POINT actual{}; require(GetCursorPos(&actual) && actual.x == point.x && actual.y == point.y,
            "cursor_position", "OS cursor did not reach the requested physical pixel");
    }
    void position(Pointer& p, POINT point) {
        send(p, absoluteMove(point), point); verifyCursor(point);
        ui.move(p.id,point);
    }
    bool visibleRootPoint(const Target& t, POINT point) const {
        HWND hitWindow = WindowFromPoint(point); DWORD pid = 0;
        GetWindowThreadProcessId(hitWindow, &pid);
        return hitWindow && pid == t.pid && GetAncestor(hitWindow, GA_ROOT) == t.hwnd &&
            IsWindowVisible(hitWindow) && IsWindowEnabled(hitWindow);
    }
    bool captionPoint(Pointer& p, POINT point, std::chrono::steady_clock::time_point deadline) {
        boundary(); physicalGate(); auto& t = target(p); t.validate();
        if (std::chrono::steady_clock::now() >= deadline) return false;
        // WM_NCHITTEST encodes signed 16-bit screen coordinates. Never let a
        // truncation query a different point on an unusually large desktop.
        if (point.x < -32768 || point.x > 32767 || point.y < -32768 || point.y > 32767) return false;
        const int sx = GetSystemMetrics(SM_XVIRTUALSCREEN), sy = GetSystemMetrics(SM_YVIRTUALSCREEN);
        if (point.x < sx || point.y < sy || static_cast<int64_t>(point.x) >= static_cast<int64_t>(sx) + GetSystemMetrics(SM_CXVIRTUALSCREEN) ||
            static_cast<int64_t>(point.y) >= static_cast<int64_t>(sy) + GetSystemMetrics(SM_CYVIRTUALSCREEN)) return false;
        RECT outer{}; POINT client{0,0};
        require(GetWindowRect(t.hwnd, &outer) && ClientToScreen(t.hwnd, &client), "identity", "Cannot inspect caption geometry");
        if (point.x < outer.left || point.x >= outer.right || point.y < outer.top || point.y >= client.y || point.y >= outer.bottom) return false;
        // Occluded points do not cause even a hit-test message to the target.
        if (!visibleRootPoint(t, point)) return false;
        const auto remaining = std::chrono::duration_cast<std::chrono::milliseconds>(deadline - std::chrono::steady_clock::now()).count();
        if (remaining <= 0) return false;
        DWORD_PTR hit = 0;
        const auto replied = SendMessageTimeoutW(t.hwnd, WM_NCHITTEST, 0,
            MAKELPARAM(static_cast<WORD>(point.x), static_cast<WORD>(point.y)),
            SMTO_ABORTIFHUNG | SMTO_BLOCK | SMTO_ERRORONEXIT, static_cast<UINT>(std::min<int64_t>(100, remaining)), &hit);
        boundary(); physicalGate(); t.validate();
        if (!replied || hit != HTCAPTION || std::chrono::steady_clock::now() >= deadline) return false;
        RECT now{}; POINT clientNow{0,0};
        require(GetWindowRect(t.hwnd, &now) && ClientToScreen(t.hwnd, &clientNow), "identity", "Cannot recheck caption geometry");
        if (!EqualRect(&outer, &now) || client.x != clientNow.x || client.y != clientNow.y || !visibleRootPoint(t, point)) return false;
        boundary(); physicalGate(); return true;
    }
    void sendCaption(Pointer& p, POINT point, INPUT e, std::chrono::steady_clock::time_point deadline) {
        require(captionPoint(p, point, deadline), "occluded", "Exposed exact HTCAPTION changed before activation input; no replay");
        ui.requireSystemCursor();
        if (!(e.mi.dwFlags & MOUSEEVENTF_MOVE)) verifyCursor(point);
        boundary(); physicalGate(); boundary();
        require(std::chrono::steady_clock::now() < deadline, "foreground", "Caption activation budget expired before input; no replay");
        const auto before=signals.ownMouse.load();
        require(SendInput(1, &e, sizeof(e)) == 1, "send_input", "SendInput did not deliver caption activation input"); trackDelivery(e);
        ++delivered; ++activationDelivered; actionExecuted = true;
        if (operation) { ++operation->deliveredInputs; ++operation->activationInputs; operation->actionExecuted=true; operation->captionAttempted=true; }
        requireHookObservation(true,before);
    }
    void activateCaption(Pointer& p) {
        require(!operation || !operation->captionAttempted,"foreground","Caption activation was already attempted for this operation; no click replay");
        require(std::none_of(heldKeys.begin(), heldKeys.end(), [](bool held) { return held; }) &&
            std::none_of(heldButtons.begin(), heldButtons.end(), [](bool held) { return held; }),
            "held_state", "Release synthetic keys and buttons before visible-caption activation");
        activationPath = "caption_scan";
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(750);
        RECT outer{}; POINT client{0,0};
        boundary(); physicalGate(); target(p).validate();
        require(GetWindowRect(target(p).hwnd, &outer) && ClientToScreen(target(p).hwnd, &client), "identity", "Cannot find caption strip");
        const auto width = static_cast<int64_t>(outer.right) - outer.left;
        const auto height = static_cast<int64_t>(std::min(client.y, outer.bottom)) - outer.top;
        require(width > 0 && height > 0, "foreground", "OS refused foreground activation and no top nonclient caption strip exists");
        POINT candidate{}; bool found = false;
        std::vector<POINT> candidates; candidates.reserve(64);
        auto append = [&](int64_t x, int64_t y) {
            if (candidates.size() >= 64) return;
            const POINT point{static_cast<LONG>(std::clamp<int64_t>(x, outer.left, static_cast<int64_t>(outer.right) - 1)),
                static_cast<LONG>(std::clamp<int64_t>(y, outer.top, static_cast<int64_t>(outer.top) + height - 1))};
            if (std::none_of(candidates.begin(), candidates.end(), [&](POINT old) { return old.x == point.x && old.y == point.y; }))
                candidates.push_back(point);
        };
        // Probe narrow exposed edge strips before the coarse center-out grid.
        // All candidates share the same 64-point cap and activation deadline;
        // clamping/deduplication also handles very small caption rectangles.
        const std::array<int64_t,7> preferredXs{{static_cast<int64_t>(outer.left) + 48, static_cast<int64_t>(outer.left) + 64,
            static_cast<int64_t>(outer.right) - 48, static_cast<int64_t>(outer.right) - 64,
            static_cast<int64_t>(outer.left) + width / 2, static_cast<int64_t>(outer.left) + width / 4,
            static_cast<int64_t>(outer.left) + width * 3 / 4}};
        for (int row = 0; row < 4; ++row) {
            const int64_t y = static_cast<int64_t>(outer.top) + height * (2 * row + 1) / 8;
            for (int64_t x : preferredXs) append(x, y);
        }
        for (int row = 0; row < 4 && candidates.size() < 64; ++row) {
            for (int column = 0; column < 16 && candidates.size() < 64; ++column) {
                const int index = column % 2 == 0 ? 8 + column / 2 : 7 - column / 2;
                append(static_cast<int64_t>(outer.left) + width * (2 * index + 1) / 32,
                    static_cast<int64_t>(outer.top) + height * (2 * row + 1) / 8);
            }
        }
        // Exact HTCAPTION still excludes the system menu, resize edges and
        // min/max/close controls, regardless of candidate ordering.
        for (POINT point : candidates) {
            if (std::chrono::steady_clock::now() >= deadline) break;
            if (captionPoint(p, point, deadline)) { candidate = point; found = true; break; }
        }
        require(found, "foreground", "OS refused foreground activation; no exposed exact HTCAPTION found within the bounded scan");
        activationPath = "caption_click";
        diagnostic("INFO", "foreground_activation", "caption_click");
        sendCaption(p, candidate, absoluteMove(candidate), deadline); verifyCursor(candidate);
        sendCaption(p, candidate, mouseInput(MOUSEEVENTF_LEFTDOWN), deadline); heldButtons[0] = true;
        sendCaption(p, candidate, mouseInput(MOUSEEVENTF_LEFTUP), deadline); heldButtons[0] = false;
        const auto foregroundDeadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(200);
        do {
            boundary(); physicalGate(); target(p).validate();
            if (GetAncestor(GetForegroundWindow(), GA_ROOT) == target(p).hwnd) return;
            std::this_thread::sleep_for(std::chrono::milliseconds(2));
        } while (std::chrono::steady_clock::now() < foregroundDeadline);
        throw Failure("foreground", "Caption activation click was delivered but exact foreground was not observed within 200ms; no replay");
    }
    RECT clientGeometry(const Target& t) const {
        if (t.outerWindow) {
            RECT r{}; require(GetWindowRect(t.hwnd,&r) != FALSE,"identity","Cannot inspect outer-window geometry"); return r;
        }
        RECT r{}; require(GetClientRect(t.hwnd,&r) != FALSE,"identity","Cannot inspect client geometry");
        POINT a{r.left,r.top},b{r.right,r.bottom};
        require(ClientToScreen(t.hwnd,&a) && ClientToScreen(t.hwnd,&b),"identity","Cannot map client geometry");
        return RECT{a.x,a.y,b.x,b.y};
    }
    void prepareOnce(Pointer& p) {
        boundary(); physicalGate(); target(p).validate(); target(p).point(p.position);
        if (operation) {
            const auto geometry=clientGeometry(target(p));
            if (!operation->intentPinned) {
                operation->intentPoint=p.position; operation->intentClient=geometry; operation->intentPinned=true;
            } else require(EqualRect(&geometry,&operation->intentClient) != FALSE,"intent_changed","Target client geometry changed since operation admission; observe before a new operation");
        }
        if (owner != p.id) require(releaseHeld(), "cleanup_failed", "Cannot release previous pointer synthetic state");
        boundary(); physicalGate(); owner = p.id;
        if (signals.collaborationRequested.load() && !ui.routing.modelActive.load()) ui.invoke([&] { ui.routing.beginModel(); });
        ui.requireSystemCursor(); boundary();
        foregroundAttempted = true;
        activationPath = "already_foreground";
        if (!target(p).surface(GetAncestor(GetForegroundWindow(), GA_ROOT)).accepted) {
            activationPath = "set_foreground_window";
            const bool activated = SetForegroundWindow(target(p).hwnd) != FALSE;
            actionExecuted = actionExecuted || activated;
            if (operation && activated) operation->actionExecuted=true;
            if (!target(p).surface(GetAncestor(GetForegroundWindow(), GA_ROOT)).accepted) activateCaption(p);
        }
        checkHit(p, p.position);
        position(p, p.position);
    }
    void prepare(Pointer& p) {
        if (operation) {
            require(operation->rounds<3 && operation->activeRecoveryMs<5000,"recovery_exhausted","Operation recovery budget exhausted");
            ++operation->rounds; operation->preparing=true;
        }
        const auto started=std::chrono::steady_clock::now();
        auto account=[&] {
            if (operation) operation->activeRecoveryMs+=static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now()-started).count());
        };
        try { prepareOnce(p); }
        catch (...) { account(); throw; }
        account();
        if (operation) {
            operation->preparing=false;
            require(operation->activeRecoveryMs<=5000,"recovery_exhausted","Operation active recovery exceeded five seconds before application input");
        }
    }
    void waitUntil(std::chrono::steady_clock::time_point end) {
        while (std::chrono::steady_clock::now() < end) {
            boundary(); std::this_thread::sleep_for(std::chrono::milliseconds(2));
        }
        boundary();
    }
    void processMoves() {
        std::deque<std::string> admitted;
        { std::lock_guard<std::mutex> guard(queueMutex);
            const size_t capacity=executingInput ? 16-moveReplies.size() : 16;
            while (!moves.empty() && admitted.size()<capacity) { admitted.push_back(std::move(moves.front())); moves.pop_front(); }
        }
        auto emit=[&](json value) { if (executingInput) moveReplies.push_back(std::move(value)); else reply(value); };
        for (const auto& line : admitted) {
            json id=nullptr;
            try {
                const auto request=json::parse(line);
                require(request.is_object() && request.contains("id"),"invalid_request","Move requires an id");
                const auto& candidate=request.at("id");
                require(candidate.is_null() || candidate.is_number_integer() || (candidate.is_string() && candidate.get_ref<const std::string&>().size()<=128),"invalid_request","Invalid move id");
                id=candidate; const auto params=request.value("params",json::object());
                const auto pointerId=identifier(params,"pointerId"); const auto found=pointers.find(pointerId);
                require(found!=pointers.end(),"pointer_missing","Unknown pointer id"); const POINT next=point(params);
                target(found->second).validate(); target(found->second).point(next);
                require(!signals.explicitStop.load() && !signals.disconnected.load(),"stopped","Move rejected after stop/disconnect");
                ui.move(pointerId,next,true); found->second.position=next;
                auto result=state(); result.erase("operationId"); result.erase("recovery"); result["actionExecuted"]=true;
                result["deliveredInputs"]=0; result["activationDeliveredInputs"]=0;
                emit({{"id",id},{"result",result}});
            } catch (const Failure& error) {
                emit({{"id",id},{"error",{{"code",error.code},{"message",error.what()},{"actionExecuted",false}}}});
            } catch (const std::exception&) {
                emit({{"id",id},{"error",{{"code","invalid_request"},{"message","Malformed logical move"},{"actionExecuted",false}}}});
            }
        }
    }
    void flushMoveReplies() {
        while (!moveReplies.empty()) { auto response=std::move(moveReplies.front()); moveReplies.pop_front(); reply(response); }
    }
    void validateHuman(const HumanGesture& intent, POINT point, bool initial) {
        boundary();
        require(ui.routing.enabled.load() && !intent.aborted.load(),"human_skipped","Human gesture is no longer routable");
        intent.target->validate(); RECT outer{};
        require(GetWindowRect(intent.target->hwnd,&outer) && EqualRect(&outer,&intent.outer),"human_intent_changed","Pinned human target geometry changed; gesture skipped without replay");
        require(PtInRect(&outer,point)!=FALSE,"human_intent_changed","Queued human path left its pinned window bounds");
        HWND leaf=WindowFromPoint(point); DWORD pid=0; GetWindowThreadProcessId(leaf,&pid);
        require(leaf && pid==intent.target->pid && IsWindowVisible(leaf) && IsWindowEnabled(leaf) &&
            intent.target->surface(GetAncestor(leaf,GA_ROOT)).accepted,"human_intent_changed","Human target is covered or replaced");
        if (initial) {
            require(GetTickCount64()-intent.submittedAt<=5000,"human_intent_changed","Queued human intent exceeded its five-second lifetime");
            require(leaf==intent.leaf,"human_intent_changed","Human hit control changed since submission");
            GUITHREADINFO info{}; info.cbSize=sizeof(info);
            require(GetGUIThreadInfo(intent.target->thread,&info) && info.hwndFocus==intent.focus,"human_intent_changed","Human target focus changed since submission");
        }
    }
    void sendHuman(const HumanGesture& intent, POINT point, INPUT input, bool initial=false) {
        validateHuman(intent,point,initial); const auto before=signals.ownMouse.load();
        ui.requireSystemCursor(); boundary();
        require(SendInput(1,&input,sizeof(input))==1,"human_send_input","Queued human input was not delivered");
        trackDelivery(input); if (!(input.mi.dwFlags&MOUSEEVENTF_MOVE)) ++humanApplicationInputs;
        requireHookObservation(true,before);
    }
    void executeHuman(const std::shared_ptr<HumanGesture>& intent) {
        operation.reset(); baseline=signals.epoch.load(); humanApplicationInputs=0; intent->started.store(true); executingInput=true; observationTurn=false;
        std::string failureCode;
        try {
            require(!intent->aborted.load() && ui.routing.enabled.load(),"human_skipped","Queued human gesture was aborted");
            require(releaseHeld(),"cleanup_failed","Synthetic cleanup prevents human gesture execution"); owner="@user";
            sendHuman(*intent,intent->start,absoluteMove(intent->start),true); verifyCursor(intent->start);
            if (intent->kind==HumanGesture::Kind::wheel) {
                require(intent->delta!=0 && intent->delta>=-12000 && intent->delta<=12000,"human_skipped","Human wheel delta exceeds the bounded operation");
                sendHuman(*intent,intent->start,mouseInput(MOUSEEVENTF_WHEEL,static_cast<DWORD>(intent->delta)));
            } else {
                sendHuman(*intent,intent->start,mouseInput(downFlags[intent->button]));
                const auto began=std::chrono::steady_clock::now();
                if (intent->kind==HumanGesture::Kind::drag) {
                    for (size_t i=1;i<intent->path.size();++i) {
                        waitUntil(began+std::chrono::milliseconds(intent->durationMs*i/(intent->path.size()-1)));
                        sendHuman(*intent,intent->path[i],absoluteMove(intent->path[i])); verifyCursor(intent->path[i]);
                    }
                } else waitUntil(began+std::chrono::milliseconds(intent->durationMs));
                sendHuman(*intent,intent->end,mouseInput(upFlags[intent->button]));
            }
            require(releaseHeld(),"cleanup_failed","Human synthetic state did not release"); ui.routing.completedHuman.fetch_add(1); ui.routing.lastHumanFailure.store(0);
        } catch (const Failure& error) {
            releaseHeld(); ui.routing.skippedHuman.fetch_add(1);
            ui.routing.lastHumanFailure.store(error.code=="human_intent_changed"?1:error.code=="human_send_input" || error.code=="hook_unverified"?3:2);
            failureCode=error.code;
        } catch (const std::exception&) {
            releaseHeld(); ui.routing.skippedHuman.fetch_add(1); ui.routing.lastHumanFailure.store(4); failureCode="internal_failure";
        }
        ui.routing.lastHumanApplicationInputs.store(humanApplicationInputs);
        executingInput=false;
        ui.routing.pendingHuman.fetch_sub(1);
        if (!failureCode.empty()) diagnostic("WARN","human_gesture_skipped",failureCode);
    }
    void restoreUserIfIdle() {
        if (!ui.routing.requested.load() || !ui.routing.enabled.load() || !ui.routing.capture.load() || ui.routing.pendingHuman.load()) { handoffStarted=0; return; }
        if (!handoffStarted) handoffStarted=GetTickCount64();
        if (GetTickCount64()-handoffStarted>200) { ui.routing.fail(MouseRouting::Fault::restoration); handoffStarted=0; return; }
        try {
            bool sent=false; uint64_t before=0;
            ui.invoke([&] {
            // Keep the system cursor hidden across handoff and idle. Restore
            // once before pumping the queued tail, then revalidate and restore
            // the latest logical position. Release capture without visibility
            // IPC; display restoration belongs to mode disable/error/shutdown.
            for (unsigned pass=0;pass<2;++pass) {
            ui.drainRawForHandoff();
            ui.routing.restorationReason="routing_failed";
            require(ui.routing.enabled.load(),"restore","User routing failed before handoff");
            if (ui.routing.recording) { ui.routing.restorationReason="human_recording"; return; }
            if (ui.routing.modelActive.load()) { ui.routing.restorationReason="model_active"; return; }
            if (ui.routing.pendingHuman.load()) { ui.routing.restorationReason="human_pending"; return; }
            const POINT restore=ui.routing.userPosition;
            ui.routing.observeCursorBoundary("handoff_latched");
            // This is the user's own physical-pointer restoration, not a model
            // target fallback. Verify the currently exposed same-user process.
            HWND leaf=WindowFromPoint(restore),root=GetAncestor(leaf,GA_ROOT); DWORD pid=0;
            const DWORD thread=GetWindowThreadProcessId(root,&pid);
            ui.routing.restorationReason="target_surface";
            require(root && pid && pid!=GetCurrentProcessId() && IsWindowVisible(leaf) && IsWindowEnabled(leaf),"restore","Cannot verify user cursor restoration point");
            Handle process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|SYNCHRONIZE,FALSE,pid));
            ui.routing.restorationReason="target_process";
            require(process.value && WaitForSingleObject(process.value,0)==WAIT_TIMEOUT,"restore","User restoration process is unavailable");
            ui.routing.restorationReason="target_security"; checkDesktop(); checkToken(process.value);
            HDESK desktop=GetThreadDesktop(thread);
            ui.routing.restorationReason="target_desktop";
            require(desktop && objectName(desktop)==L"Default","restore","User restoration target desktop is unavailable");
            DWORD session=0,ownSession=0;
            ui.routing.restorationReason="target_session";
            require(ProcessIdToSessionId(pid,&session) && ProcessIdToSessionId(GetCurrentProcessId(),&ownSession) && session==ownSession,"restore","User cursor restoration crossed sessions");
            DWORD recheckedPid=0;
            ui.routing.restorationReason="target_changed";
            require(WindowFromPoint(restore)==leaf && GetWindowThreadProcessId(root,&recheckedPid)==thread && recheckedPid==pid &&
                GetAncestor(leaf,GA_ROOT)==root && IsWindowVisible(leaf) && IsWindowEnabled(leaf),"restore","User restoration target changed");
            ui.routing.restorationReason="stop_requested";
            require(!signals.disconnected.load() && !signals.explicitStop.load() && !signals.emergency.load(),"restore","User handoff was stopped");
            // Latch, restore and release capture on the routing thread. Waiting
            // on another thread before releasing capture chases every physical
            // delta and can never finish while the user keeps moving.
            INPUT move=absoluteMove(restore); before=signals.ownMouse.load();
            ui.routing.restorationReason="input_delivery";
            require(SendInput(1,&move,sizeof(move))==1,"restore","User cursor restoration did not deliver");
            sent=true; POINT observed{};
            ui.routing.restorationReason="awaiting_hook_and_cursor";
            const bool observedCursor=GetCursorPos(&observed)!=FALSE;
            if (observedCursor) ui.routing.sampleCursor("handoff_move_observed",observed);
            if (signals.ownMouse.load()>before && observedCursor && observed.x==restore.x && observed.y==restore.y &&
                !ui.routing.recording && !ui.routing.pendingHuman.load() &&
                ui.routing.userPosition.x==restore.x && ui.routing.userPosition.y==restore.y) {
                if (pass==0) {
                    ui.routing.observeCursorBoundary("handoff_hidden_tail_drain");
                    continue;
                }
                // End the suppression interval at the latest available RAW
                // position. Continuous motion need not become quiescent.
                // The routing watchdog remains active until this handoff;
                // subsequent physical events use the ordinary Windows path.
                ui.routing.capture.store(false); ui.routing.firstUnmatchedTick.store(0);
                ui.routing.restorationReason="restored";
                ui.routing.sampleCursor("handoff_released",observed);
            }
            break;
            } });
            if (sent) requireHookObservation(true,before,true);
            if (!ui.routing.capture.load()) handoffStarted=0;
        } catch (const std::exception&) { ui.routing.fail(MouseRouting::Fault::restoration); }
    }
    json collaborationSnapshot() {
        auto result=ui.collaborationState();
        std::lock_guard<std::mutex> guard(queueMutex);
        result["queuedInputOperations"]=queue.size(); result["pendingLogicalMoves"]=moves.size(); return result;
    }
    json state(bool observeHits = false) {
        POINT cursor{}; const bool observed = GetCursorPos(&cursor) != FALSE;
        json list = json::array(), ts = json::array();
        for (const auto& item : pointers) {
            const auto& p = item.second;
            json entry{{"pointerId",p.id},{"targetId",targets[p.target].id},{"x",p.position.x},{"y",p.position.y}};
            if (observeHits) {
                const auto& t = targets[p.target];
                try {
                    const auto workerHit = t.describeHit(p.position, Target::observeHit(p.position));
                    json uiHit;
                    ui.invoke([&] { uiHit = t.describeHit(p.position, Target::observeHit(p.position)); });
                    entry["hitObservation"] = {{"worker",workerHit},{"ui",uiHit}};
                } catch (const Failure& e) {
                    if (!desktopEnabled) throw;
                    entry["hitObservation"]={{"unavailable",true},{"code",e.code}};
                }
            }
            list.push_back(std::move(entry));
        }
        for (const auto& t : targets) ts.push_back({{"targetId",t.id},{"pid",t.pid},{"createdFileTime",hex(t.born)},
            {"hwnd",hex(reinterpret_cast<uintptr_t>(t.hwnd))},{"executable",utf8(t.path)}});
        json result{{"mode","switched"},{"globalInput",true},{"appEffectVerified",false},{"targets",ts},{"pointers",list},
            {"physicalCursorObserved",observed},{"foregroundHwnd",hex(reinterpret_cast<uintptr_t>(GetForegroundWindow()))},
            {"foregroundRootHwnd",hex(reinterpret_cast<uintptr_t>(GetAncestor(GetForegroundWindow(), GA_ROOT)))},
            {"emergencyHotkey",{{"chord","Ctrl+Alt+Pause"},{"registered",ui.hotkey}}},
            {"cleanupPending",cleanupFailed},{"syntheticOwner",owner},{"actionExecuted",actionExecuted},{"deliveredInputs",delivered},
            {"activationPath",activationPath},{"activationDeliveredInputs",activationDelivered},{"interference",signals.snapshot(baseline)},
            {"operations",operations.status()}};
        result["collaboration"]=collaborationSnapshot();
        result["desktopEnabled"]=desktopEnabled;
        result["targetCapacity"]=32;
        if (operation) {
            result["recovery"]=operation->status(); result["operationId"]=operation->id;
            result["deliveredInputs"]=operation->deliveredInputs; result["activationDeliveredInputs"]=operation->activationInputs;
            result["actionExecuted"]=operation->actionExecuted;
        }
        if (observed) result["physicalCursor"] = {{"x",cursor.x},{"y",cursor.y}};
        return result;
    }
    static POINT point(const json& p) { return POINT{integer(p,"x",-1000000,1000000), integer(p,"y",-1000000,1000000)}; }
    static void presentationPoint(POINT xy) {
        const int vx=GetSystemMetrics(SM_XVIRTUALSCREEN), vy=GetSystemMetrics(SM_YVIRTUALSCREEN);
        require(xy.x>=vx && xy.y>=vy && static_cast<int64_t>(xy.x)<static_cast<int64_t>(vx)+GetSystemMetrics(SM_CXVIRTUALSCREEN) &&
            static_cast<int64_t>(xy.y)<static_cast<int64_t>(vy)+GetSystemMetrics(SM_CYVIRTUALSCREEN),"point_outside_screen","Presentation point must be on the virtual screen");
    }
    json dispatch(const std::string& method, const json& params, bool& shutdown) {
        if (method == "stop" || method == "shutdown") {
            clear(); signals.emergency.store(false);
            if (signals.stopGeneration.load()==processingStopGeneration) signals.explicitStop.store(false);
            idleEpoch = signals.epoch.load();
            discardQueue("stopped");
            actionExecuted = true; shutdown = method == "shutdown"; return state();
        }
        if (method=="collaboration") {
            require(params.contains("enabled") && params.at("enabled").is_boolean(),"invalid_params","collaboration requires enabled:boolean");
            require(releaseHeld(),"cleanup_failed","Cannot change collaboration while synthetic cleanup is pending");
            const bool enabled=params.at("enabled").get<bool>();
            require(!enabled || !signals.explicitStop.load(),"stopped","Collaboration enable is superseded by a pending stop");
            ui.collaboration(enabled);
            if (!enabled) { discardQueue("revoked"); if (signals.stopGeneration.load()==processingStopGeneration) signals.explicitStop.store(false); }
            actionExecuted=true; return state();
        }
        if (method=="hello" || method=="status") {
            require(!signals.disconnected.load(),"disconnected","Input/output stream disconnected");
            checkDesktop(); if (!desktopEnabled) for (const auto& t : targets) t.validate();
            return state(true);
        }
        boundary();
        if (!desktopEnabled) for (const auto& t : targets) t.validate();
        require(method!="key" || !signals.collaborationRequested.load(),"unsupported_atomicity","Use atomic press while collaboration is requested; cross-request key holds are disabled");
        if (actuation(method) && signals.collaborationRequested.load())
            require(ui.routing.enabled.load(),"capability_pending","Collaboration needs a successful explicit relative-motion probe before model input");
        require(!cleanupFailed, "cleanup_failed", "Synthetic cleanup is pending; stop must succeed before new actions");
        if (method == "create_pointer") {
            auto id = identifier(params,"pointerId"), tid = identifier(params,"targetId");
            require(pointers.size() < 8 && !pointers.count(id), "invalid_params", "Pointer already exists or eight-pointer limit reached");
            const auto found = std::find_if(targets.begin(), targets.end(), [&](const Target& t) { return t.id == tid; });
            require(found != targets.end(), "target_not_allowed", "Target id is not in the startup allowlist");
            found->validate();
            require(!params.contains("presentationOnly") || params.at("presentationOnly").is_boolean(),"invalid_params","presentationOnly must be boolean");
            const POINT xy = point(params);
            // Cosmetic UIA presentation may start outside the bound client.
            // This does not change any subsequent target.point/hit checks.
            if (params.value("presentationOnly",false)) presentationPoint(xy); else found->point(xy);
            COLORREF color = RGB(56,189,248);
            if (params.contains("color")) {
                require(params.at("color").is_string(), "invalid_params", "Color must be #RRGGBB");
                auto text = params.at("color").get<std::string>();
                require(text.size() == 7 && text[0] == '#', "invalid_params", "Color must be #RRGGBB");
                const auto rgb = parseHex("0x" + text.substr(1));
                color = RGB((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255);
                require(color != RGB(1,2,3), "invalid_params", "Reserved transparent color");
            }
            ui.create(id,xy,color); pointers.emplace(id, Pointer{id,static_cast<size_t>(found-targets.begin()),xy,color});
            actionExecuted = true; return state();
        }
        const auto id = identifier(params,"pointerId"); auto found = pointers.find(id);
        require(found != pointers.end(), "pointer_missing", "Unknown pointer id"); auto& stored = found->second; Pointer p = stored;
        if (method == "present_pointer") {
            const POINT xy = point(params);
            presentationPoint(xy);
            require(params.contains("phase") && params.at("phase").is_string(),"invalid_params","Presentation phase required");
            const auto phase=params.at("phase").get<std::string>();
            require(phase=="active" || phase=="idle","invalid_params","Presentation phase must be active or idle");
            require(!params.contains("click") || params.at("click").is_boolean(),"invalid_params","click must be boolean");
            ui.move(id,xy,true);
            if (phase=="active") ui.activity(id,false,params.value("click",false)); else ui.idle(id);
            actionExecuted=true; return state();
        }
        if (method == "desktop_target") {
            require(desktopEnabled,"desktop_not_enabled","Desktop retarget requires immutable startup desktop authority");
            require(!params.contains("operationId"),"invalid_params","Retarget cannot change an admitted operation");
            require(params.contains("target") && params.at("target").is_object(),"invalid_params","Exact target identity required");
            auto identity=params.at("target"); identity["createdFileTime"]=identity.at("processCreated");
            auto candidate=pinTarget(identity,"desktop",true);
            const POINT xy=point(params); candidate.point(xy);
            const auto hit=Target::observeHit(xy);
            require(hit.hwnd && hit.pid==candidate.pid && hit.visible && hit.enabled && candidate.surface(hit.root).accepted,
                "occluded","Retarget requires a visible exact target hit");
            size_t slot=targets.size();
            for (size_t i=0;i<targets.size();++i) {
                const auto& t=targets[i];
                if (t.outerWindow && !t.destroyed->load() && t.hwnd==candidate.hwnd && t.pid==candidate.pid && t.born==candidate.born &&
                    t.thread==candidate.thread && _wcsicmp(t.path.c_str(),candidate.path.c_str())==0) { t.validate(); slot=i; break; }
            }
            require(slot<targets.size() || targets.size()<32,"target_capacity","Desktop target capacity exhausted; no application input delivered");
            require(owner!=id || (std::none_of(heldKeys.begin(),heldKeys.end(),[](bool v){return v;}) &&
                std::none_of(heldButtons.begin(),heldButtons.end(),[](bool v){return v;}) && heldUnicode.empty()),
                "held_state","Release synthetic input before retargeting");
            if (slot==targets.size()) {
                candidate.id="desktop_"+std::to_string(slot);
                unsigned suffix=0;
                while (std::any_of(targets.begin(),targets.end(),[&](const Target& t){return t.id==candidate.id;}))
                    candidate.id="desktop_"+std::to_string(slot)+"_"+std::to_string(++suffix);
            }
            // Append on the UI thread: destruction callbacks cannot iterate
            // concurrently, and reserved capacity prevents relocation.
            ui.invoke([&] {
                candidate.validate(); candidate.point(xy);
                const auto current=Target::observeHit(xy);
                require(current.hwnd && current.pid==candidate.pid && current.visible && current.enabled && candidate.surface(current.root).accepted,
                    "occluded","Retarget hit changed during validation");
                if (slot==targets.size()) targets.push_back(std::move(candidate));
            });
            stored.target=slot; stored.position=xy; ui.move(id,xy,true);
            actionExecuted=true; return state();
        }
        if (operation) {
            for (auto i=operationTargets.begin();i!=operationTargets.end();) {
                if (i->second.first.expired()) i=operationTargets.erase(i); else ++i;
            }
            const auto pinned=operationTargets.emplace(operation->id,std::make_pair(std::weak_ptr<Operation>(operation),p.target));
            p.target=pinned.first->second.second;
        }
        if (operation && operation->intentPinned) p.position=operation->intentPoint;
        if (method == "remove_pointer") {
            if (owner == id) require(releaseHeld(), "cleanup_failed", "Cannot release pointer synthetic state");
            ui.remove(id); pointers.erase(found); actionExecuted = true; return state();
        }
        if (method == "move") {
            const POINT xy = point(params); target(p).point(xy); ui.move(id,xy,true); stored.position=xy;
            actionExecuted=true; return state();
        }
        if (actuation(method)) ui.activity(id,method=="drag",method=="click");
        if (method == "click") {
            require(params.contains("button") && params.at("button").is_string(), "invalid_params", "Button is required");
            const auto button = params.at("button").get<std::string>();
            const int b = button == "left" ? 0 : button == "right" ? 1 : button == "middle" ? 2 : -1;
            require(b >= 0, "invalid_params", "Unsupported mouse button");
            prepare(p); require(!heldButtons[static_cast<size_t>(b)], "held_state", "Button already synthetically held");
            send(p,mouseInput(downFlags[b]),p.position); heldButtons[static_cast<size_t>(b)]=true;
            send(p,mouseInput(upFlags[b]),p.position); heldButtons[static_cast<size_t>(b)]=false;
        } else if (method == "drag") {
            const POINT end = point(params); target(p).point(end);
            const int duration = params.contains("durationMs") ? integer(params,"durationMs",1,2000) : 300;
            prepare(p); require(std::none_of(heldButtons.begin(),heldButtons.end(),[](bool held) { return held; }), "held_state", "A synthetic button is already held");
            send(p,mouseInput(MOUSEEVENTF_LEFTDOWN),p.position); heldButtons[0]=true;
            const POINT start = p.position; const auto began = std::chrono::steady_clock::now();
            const int steps = std::max(1,duration/10);
            POINT last = start;
            for (int step=1; step<=steps; ++step) {
                waitUntil(began+std::chrono::milliseconds(static_cast<int64_t>(duration)*step/steps));
                last = POINT{start.x+static_cast<LONG>(static_cast<int64_t>(end.x-start.x)*step/steps),start.y+static_cast<LONG>(static_cast<int64_t>(end.y-start.y)*step/steps)};
                position(p,last);
            }
            send(p,mouseInput(MOUSEEVENTF_LEFTUP),last); heldButtons[0]=false;
            // Logical position changes only once the full drag completes.
            if (stored.position.x==start.x && stored.position.y==start.y) stored.position=end;
            ui.move(id,stored.position,true);
        } else if (method == "scroll") {
            const int delta = integer(params,"delta",-12000,12000); require(delta != 0,"invalid_params","Scroll delta must be nonzero");
            prepare(p); send(p,mouseInput(MOUSEEVENTF_WHEEL,static_cast<DWORD>(delta)),p.position);
        } else if (method == "press") {
            require(params.contains("keys") && params.at("keys").is_array() && !params.at("keys").empty() && params.at("keys").size()<=8,
                "invalid_params","press requires 1-8 unique concrete virtual keys");
            std::vector<int> keys;
            for (const auto& value : params.at("keys")) {
                json one{{"vk",value}}; const int vk=integer(one,"vk",8,254); validateKey(vk);
                require(std::find(keys.begin(),keys.end(),vk)==keys.end(),"invalid_params","press keys must be unique"); keys.push_back(vk);
            }
            const bool control=std::find(keys.begin(),keys.end(),VK_LCONTROL)!=keys.end() || std::find(keys.begin(),keys.end(),VK_RCONTROL)!=keys.end();
            require(!control || std::find(keys.begin(),keys.end(),VK_ESCAPE)==keys.end(),"unsupported_shortcut","Ctrl+Escape and Ctrl+Shift+Escape are unsupported");
            require(releaseHeld(),"cleanup_failed","Cannot begin an atomic chord while synthetic cleanup is pending");
            prepare(p);
            const auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(2);
            for (int vk : keys) { require(std::chrono::steady_clock::now()<deadline,"timeout","Atomic chord exceeded two seconds"); send(p,keyInput(static_cast<WORD>(vk),true),p.position); }
            for (auto it=keys.rbegin();it!=keys.rend();++it) { require(std::chrono::steady_clock::now()<deadline,"timeout","Atomic chord exceeded two seconds"); send(p,keyInput(static_cast<WORD>(*it),false),p.position); }
        } else if (method == "key") {
            require(!signals.collaborationRequested.load(),"unsupported_atomicity","Use atomic press while collaboration is requested; cross-request key holds are disabled");
            const int vk = integer(params,"vk",8,254);
            validateKey(vk);
            require(params.contains("down") && params.at("down").is_boolean(),"invalid_params","Key down must be boolean");
            const bool down = params.at("down").get<bool>();
            const bool ownControl = owner == id && (heldKeys[VK_LCONTROL] || heldKeys[VK_RCONTROL]);
            const bool ownEscape = owner == id && heldKeys[VK_ESCAPE];
            require(!down || !((vk == VK_ESCAPE && ownControl) || ((vk == VK_LCONTROL || vk == VK_RCONTROL) && ownEscape)),
                "unsupported_shortcut", "Ctrl+Escape and Ctrl+Shift+Escape are unsupported in either key order");
            if (!down) require(owner == id && heldKeys[static_cast<size_t>(vk)],"held_state","Cannot release a key this pointer does not own");
            else require(owner != id || !heldKeys[static_cast<size_t>(vk)],"held_state","Key is already held; repeat requests are not replayed");
            prepare(p); send(p,keyInput(static_cast<WORD>(vk),down),p.position); heldKeys[static_cast<size_t>(vk)]=down;
        } else if (method == "text") {
            require(params.contains("text") && params.at("text").is_string(),"invalid_params","Text is required");
            const auto text = params.at("text").get<std::string>();
            require(!text.empty() && text.size() <= 4096,"invalid_params","Text must be 1-4096 UTF-8 bytes");
            const auto units = wide(text); require(units.size()<=1024,"invalid_params","Text exceeds 1024 UTF-16 units");
            require(owner != id || std::none_of(heldKeys.begin(),heldKeys.end(),[](bool held) { return held; }),"held_state","Release this pointer's synthetic keys before Unicode text");
            prepare(p); const auto deadline = std::chrono::steady_clock::now()+std::chrono::seconds(2);
            for (wchar_t unit : units) {
                require(std::chrono::steady_clock::now()<deadline,"timeout","Text exceeded two seconds; partial delivery, no replay");
                INPUT e{}; e.type=INPUT_KEYBOARD; e.ki.wScan=static_cast<WORD>(unit); e.ki.dwFlags=KEYEVENTF_UNICODE; e.ki.dwExtraInfo=signals.tag;
                send(p,e,p.position);
                e.ki.dwFlags|=KEYEVENTF_KEYUP; send(p,e,p.position);
            }
        } else throw Failure("method_not_found","Unsupported method");
        boundary(); return state();
    }
    static bool actuation(const std::string& method) {
        return method=="click" || method=="drag" || method=="scroll" || method=="key" || method=="press" || method=="text";
    }
    static void validateKey(int vk) {
        require(vk != VK_PACKET && vk != VK_PROCESSKEY && vk != VK_SHIFT && vk != VK_CONTROL && vk != VK_MENU,
            "invalid_params","Use concrete virtual keys; generic modifiers, VK_PACKET and VK_PROCESSKEY are unsupported");
        require(vk != VK_LWIN && vk != VK_RWIN && vk != VK_LMENU && vk != VK_RMENU && vk != VK_APPS && vk != VK_SNAPSHOT &&
            !(vk>=VK_BROWSER_BACK && vk<=VK_LAUNCH_APP2),"unsupported_key","Windows, Alt, shell/app-launch, browser, media and screenshot keys are unsupported");
    }
    void awaitNativeHumanGesture() {
        if (!signals.collaborationRequested.load() || !ui.routing.enabled.load() || ui.routing.capture.load()) return;
        const auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(2);
        for (;;) {
            boundary(); bool down=false;
            for (int vk : {VK_LBUTTON,VK_RBUTTON,VK_MBUTTON}) if (signals.physical[static_cast<size_t>(vk)].load() || (GetAsyncKeyState(vk)&0x8000)) down=true;
            if (!down) return;
            require(std::chrono::steady_clock::now()<deadline,"human_busy","Native human gesture exceeded the two-second admission wait; physical input remains available");
            std::this_thread::sleep_for(std::chrono::milliseconds(2));
        }
    }
    void handle(InputTicket ticket, bool& shutdown) {
        json id = nullptr;
        operation=ticket.operation;
        processingStopGeneration=ticket.stopGeneration;
        executingInput=false;
        observationTurn=false;
        visualTurn=false;
        delivered=0; activationDelivered=0; activationPath="none"; actionExecuted=false; foregroundAttempted=false;
        baseline = signals.epoch.load();
        try {
            const auto request=json::parse(ticket.line);
            require(request.is_object() && request.contains("id"),"invalid_request","Expected object with id, method and params");
            const auto& candidateId=request.at("id");
            require(candidateId.is_null() || candidateId.is_number_integer() || (candidateId.is_string() && candidateId.get_ref<const std::string&>().size()<=128),"invalid_request","id must be null, integer or a string up to 128 bytes");
            id=candidateId;
            require(request.contains("method") && request.at("method").is_string(),"invalid_request","Method is required");
            const auto method=request.at("method").get<std::string>();
            visualTurn=method=="present_pointer" || method=="desktop_target";
            observationTurn=method=="hello" || method=="status" || visualTurn;
            require(method.size()<=32,"invalid_request","Method is too long");
            const auto params=request.value("params",json::object());
            require(params.is_object(),"invalid_params","params must be an object");
            if (method=="create_pointer" && params.contains("presentationOnly") && params.at("presentationOnly").is_boolean() && params.at("presentationOnly").get<bool>())
                visualTurn=observationTurn=true;
            if (actuation(method) && !operation) {
                auto admitted=operations.admit(method,params,id); operation=admitted.first;
                if (!admitted.second) {
                    if (operation->outcome.is_null()) {
                        reply({{"id",id},{"error",{{"code","operation_pending"},{"message","Operation is already admitted; no duplicate execution"},{"actionExecuted",false},
                            {"partial",{{"recovery",operation->status()}}}}}});
                    } else {
                        auto cached=operation->outcome;
                        if (cached.contains("result")) cached["result"]["duplicateOperation"]=true;
                        else cached["error"]["partial"]["duplicateOperation"]=true;
                        cached["id"]=id; reply(cached);
                    }
                    return;
                }
            }
            if (actuation(method)) { executingInput=true; awaitNativeHumanGesture(); }
            auto result=dispatch(method,params,shutdown);
            executingInput=false;
            if (operation) result["recovery"]["completed"]=true;
            if (!observationTurn) {
                ui.endModel(); restoreUserIfIdle();
                result["collaboration"]=collaborationSnapshot();
                // dispatch() observed the cursor before idle handoff. Do not
                // label that earlier model endpoint as the returned OS cursor.
                POINT cursor{}; const bool observed=GetCursorPos(&cursor)!=FALSE;
                result["physicalCursorObserved"]=observed;
                result["physicalCursor"]=observed?json{{"x",cursor.x},{"y",cursor.y}}:json(nullptr);
            }
            const json outcome{{"result",result}}; if (operation) operation->outcome=outcome;
            reply({{"id",id},{"result",result}});
            diagnostic("INFO","request_complete",method);
        } catch (const Failure& e) {
            const auto interference = signals.snapshot(baseline);
            const auto collaboration = collaborationSnapshot();
            const bool released=visualTurn ? false : releaseHeld();
            executingInput=false;
            if (!observationTurn) { ui.endModel(); restoreUserIfIdle(); }
            if (operation) {
                operation->lastBlocker=e.code;
                operation->observeRequired=operation->applicationInputs>0 || operation->uncertain;
                operation->exhausted=!operation->observeRequired && (e.code=="foreground" || e.code=="occluded") && (operation->rounds>=3 || operation->activeRecoveryMs>=5000);
                if (released && !operation->observeRequired && (e.code=="foreground" || e.code=="occluded") && operation->rounds<3 && operation->activeRecoveryMs<5000 &&
                    !signals.disconnected.load() && !signals.emergency.load()) {
                    std::lock_guard<std::mutex> guard(queueMutex);
                    if (queue.size()<16 && !signals.explicitStop.load() && (!signals.collaborationRequested.load() || ui.routing.enabled.load())) {
                        ticket.operation=operation; queue.push_back(std::move(ticket)); return;
                    }
                }
            }
            json partial{{"deliveredInputs",delivered},{"foregroundAttempted",foregroundAttempted},{"activationPath",activationPath},
                {"activationDeliveredInputs",activationDelivered},{"syntheticReleased",released},{"appEffectVerified",false},{"noReplay",true},
                {"interference",interference},{"collaboration",collaboration}};
            if (!e.details.is_null()) partial["hitObservation"] = e.details;
            if (operation) { partial["recovery"]=operation->status(); partial["operationId"]=operation->id; partial["observeRequired"]=operation->observeRequired;
                partial["recovery"]["completed"]=true; partial["deliveredInputs"]=operation->deliveredInputs; partial["activationDeliveredInputs"]=operation->activationInputs; }
            const json outcome{{"error",{{"code",e.code},{"message",e.what()},{"actionExecuted",operation?operation->actionExecuted:actionExecuted},{"partial",partial}}}};
            if (operation) operation->outcome=outcome;
            auto response=outcome; response["id"]=id; reply(response);
            diagnostic("WARN","request_failed",e.code);
        } catch (const std::exception&) {
            const auto interference = signals.snapshot(baseline);
            const auto collaboration = collaborationSnapshot();
            const bool released=visualTurn ? false : releaseHeld();
            executingInput=false;
            if (!observationTurn) { ui.endModel(); restoreUserIfIdle(); }
            json response{{"id",id},{"error",{{"code","invalid_request"},{"message","Malformed request, encoding or parameter type"},{"actionExecuted",actionExecuted},
                {"partial",{{"deliveredInputs",delivered},{"activationPath",activationPath},{"activationDeliveredInputs",activationDelivered},
                    {"syntheticReleased",released},{"appEffectVerified",false},{"noReplay",true},{"interference",interference},{"collaboration",collaboration}}}}}};
            if (operation) {
                operation->observeRequired=operation->applicationInputs>0; response["error"]["partial"]["recovery"]=operation->status();
                response["error"]["partial"]["recovery"]["completed"]=true;
                response["error"]["partial"]["operationId"]=operation->id; response["error"]["partial"]["observeRequired"]=operation->observeRequired;
                response["error"]["partial"]["deliveredInputs"]=operation->deliveredInputs; response["error"]["partial"]["activationDeliveredInputs"]=operation->activationInputs;
                response["error"]["actionExecuted"]=operation->actionExecuted; operation->outcome=response; operation->outcome.erase("id");
            }
            reply(response);
            diagnostic("WARN","request_failed","invalid_request");
        }
        idleEpoch=signals.epoch.load();
    }
    void discardQueue(const char* code = "interrupted") {
        std::deque<InputTicket> discarded;
        { std::lock_guard<std::mutex> guard(queueMutex); discarded.swap(queue); }
        for (const auto& ticket : discarded) {
            if (ticket.stopGeneration>processingStopGeneration) {
                bool kept=false;
                { std::lock_guard<std::mutex> guard(queueMutex); if (queue.size()<16) { queue.push_back(ticket); kept=true; } }
                if (kept) continue;
            }
            if (ticket.human) { ui.routing.pendingHuman.fetch_sub(1); ui.routing.skippedHuman.fetch_add(1); continue; }
            json id=nullptr;
            auto canceled=ticket.operation;
            try {
                const auto request=json::parse(ticket.line);
                if (request.is_object() && request.contains("id")) {
                    const auto& candidate=request.at("id");
                    if (candidate.is_null() || candidate.is_number_integer() || (candidate.is_string() && candidate.get_ref<const std::string&>().size()<=128)) id=candidate;
                }
                if (!canceled && request.is_object() && request.contains("method") && request.at("method").is_string() && actuation(request.at("method").get<std::string>())) {
                    const auto params=request.value("params",json::object());
                    if (params.is_object()) { const auto admitted=operations.admit(request.at("method").get<std::string>(),params,id); if (admitted.second || admitted.first->outcome.is_null()) canceled=admitted.first; }
                }
            } catch (...) { /* Cancellation does not execute malformed requests. */ }
            json outcome{{"error",{{"code",code},{"message","Queued request was canceled without replay"},{"actionExecuted",canceled?canceled->actionExecuted:false}}}};
            if (canceled) {
                canceled->lastBlocker=code; canceled->observeRequired=canceled->applicationInputs>0;
                outcome["error"]["partial"]={{"recovery",canceled->status()},{"operationId",canceled->id},{"observeRequired",canceled->observeRequired}};
                outcome["error"]["partial"]["recovery"]["completed"]=true; canceled->outcome=outcome;
            }
            outcome["id"]=id; reply(outcome);
        }
    }
public:
    Broker(Signals& s, Ui& u, TargetSet& t) : signals(s),ui(u),targets(t),desktopEnabled(t.desktop) {
        heldUnicode.reserve(2);
        ui.routing.admit=[this](std::shared_ptr<HumanGesture> intent) {
            std::lock_guard<std::mutex> guard(queueMutex); if (queue.size()>=16) return false;
            queue.push_back({"",nullptr,std::move(intent)}); ready.notify_all(); return true;
        };
    }
    int run() {
        diagnostic("INFO","startup");
        reader=std::thread([this] { readLoop(); });
        bool shutdown=false; int exitCode=0;
        try {
            while (!shutdown && !signals.disconnected.load()) {
                signals.brokerHeartbeat.store(GetTickCount64());
                processMoves();
                if (signals.explicitStop.load()) { releaseHeld(); if (ui.routing.requested.load()) ui.collaboration(false); }
                restoreUserIfIdle();
                if (signals.emergency.exchange(false)) {
                    clear(); diagnostic("WARN","emergency_stop"); idleEpoch=signals.epoch.load();
                    discardQueue();
                }
                if (signals.epoch.load()!=idleEpoch || cleanupFailed) { releaseHeld(); idleEpoch=signals.epoch.load(); }
                InputTicket ticket;
                { std::unique_lock<std::mutex> guard(queueMutex);
                    ready.wait_for(guard,std::chrono::milliseconds(20),[&] { return !queue.empty() || signals.disconnected.load(); });
                    if (signals.disconnected.load()) break;
                    if (queue.empty()) continue;
                    if (queue.front().human && !queue.front().human->ready.load()) { ready.wait_for(guard,std::chrono::milliseconds(20)); continue; }
                    ticket=std::move(queue.front()); queue.pop_front();
                }
                if (ticket.human) executeHuman(ticket.human);
                else handle(std::move(ticket),shutdown);
                if (!observationTurn) { ui.endModel(); restoreUserIfIdle(); }
                flushMoveReplies();
            }
        } catch (const std::exception&) { diagnostic("ERROR","broker_failure"); exitCode=1; }
        finishReader.store(true);
        // Cancel only this broker's blocked stdin read, never a target process.
        // Retry cancellation until the reader exits: one cancellation can race
        // between its loop condition and the next synchronous ReadFile call.
        while (WaitForSingleObject(reader.native_handle(),20)==WAIT_TIMEOUT) CancelSynchronousIo(reader.native_handle());
        if (reader.joinable()) reader.join();
        try { clear(); } catch (...) { diagnostic("ERROR","cleanup_failed"); exitCode=2; }
        diagnostic("INFO","shutdown"); ui.close(); return exitCode;
    }
};
} // namespace mp
