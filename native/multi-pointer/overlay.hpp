#pragma once
#include "platform.hpp"
#include "mouse-routing.hpp"
#include "system-cursor.hpp"
#include "cursor-renderer.hpp"
#include <oleacc.h>
#include <exception>
#include <functional>
#include <map>

namespace mp {
struct Signals {
    enum class ForeignKind : uint32_t { none, mouse, keyboard, windowDestroy };
    std::atomic<uint64_t> epoch{0};
    std::atomic<bool> emergency{false};
    std::atomic<bool> disconnected{false};
    std::atomic<bool> collaborationRequested{false};
    std::atomic<bool> explicitStop{false};
    std::atomic<uint64_t> stopGeneration{0};
    std::atomic<uint64_t> brokerHeartbeat{0};
    std::array<std::atomic<bool>, 256> physical{};
    ULONG_PTR tag = 0;
    // Hooks and WinEvent callbacks all write on the original UI thread. The
    // sequence protects a bounded reader snapshot; every payload field is also
    // atomic, so an overlapping read never has a C++ data race. No hook allocates,
    // logs, waits or acquires a lock. Epoch may also change on disconnect/hotkey.
    std::atomic<uint64_t> sampleSequence{0};
    std::atomic<uint64_t> ownMouse{0}, ownKeyboard{0}, foreignMouse{0}, foreignKeyboard{0}, windowDestroy{0};
    std::atomic<uint32_t> lastKind{0}, lastMessage{0}, lastEventTime{0};
    std::atomic<uint64_t> lastTick{0};
    std::atomic<LONG> lastX{0}, lastY{0};
    std::atomic<bool> lastInjected{false}, lastLowerIntegrity{false}, lastExtraInfoZero{false};
    std::atomic<bool> lastLow32MatchesOwnTag{false}, lastExtraInfoUpper32Zero{false};
    static_assert(std::atomic<uint64_t>::is_always_lock_free && std::atomic<uint32_t>::is_always_lock_free &&
        std::atomic<LONG>::is_always_lock_free && std::atomic<bool>::is_always_lock_free, "Hook telemetry requires lock-free atomics");

    void observeOwn(bool mouseEvent) {
        sampleSequence.fetch_add(1);
        if (mouseEvent) ownMouse.fetch_add(1); else ownKeyboard.fetch_add(1);
        sampleSequence.fetch_add(1);
    }
    void observeForeign(ForeignKind kind, UINT message, DWORD time, bool injected, bool lowerIntegrity, ULONG_PTR extraInfo, POINT point = {}, bool interrupt = true) {
        sampleSequence.fetch_add(1);
        if (interrupt) epoch.fetch_add(1);
        if (kind == ForeignKind::mouse) foreignMouse.fetch_add(1);
        else if (kind == ForeignKind::keyboard) foreignKeyboard.fetch_add(1);
        else if (kind == ForeignKind::windowDestroy) windowDestroy.fetch_add(1);
        lastKind.store(static_cast<uint32_t>(kind)); lastMessage.store(message); lastEventTime.store(time);
        lastTick.store(GetTickCount64()); lastX.store(point.x); lastY.store(point.y);
        lastInjected.store(injected); lastLowerIntegrity.store(lowerIntegrity); lastExtraInfoZero.store(extraInfo == 0);
        lastLow32MatchesOwnTag.store(static_cast<DWORD>(extraInfo) == static_cast<DWORD>(tag));
        lastExtraInfoUpper32Zero.store((static_cast<uint64_t>(extraInfo) >> 32) == 0);
        sampleSequence.fetch_add(1);
    }
    json snapshot(uint64_t baseline) const {
        uint64_t ownM = 0, ownK = 0, foreignM = 0, foreignK = 0, destroyed = 0, tick = 0;
        uint32_t kind = 0, message = 0, eventTime = 0;
        LONG x = 0, y = 0; bool injected = false, lower = false, extraZero = false, coherent = false;
        bool low32Matches = false, upper32Zero = false;
        for (int attempt = 0; attempt < 3; ++attempt) {
            const auto before = sampleSequence.load();
            if (before & 1) continue;
            ownM = ownMouse.load(); ownK = ownKeyboard.load(); foreignM = foreignMouse.load(); foreignK = foreignKeyboard.load(); destroyed = windowDestroy.load();
            kind = lastKind.load(); message = lastMessage.load(); eventTime = lastEventTime.load(); tick = lastTick.load();
            x = lastX.load(); y = lastY.load(); injected = lastInjected.load(); lower = lastLowerIntegrity.load(); extraZero = lastExtraInfoZero.load();
            low32Matches = lastLow32MatchesOwnTag.load(); upper32Zero = lastExtraInfoUpper32Zero.load();
            if (sampleSequence.load() == before) { coherent = true; break; }
        }
        if (!coherent) {
            // Counters remain individual atomic observations; omit a potentially
            // mixed latest sample rather than waiting on the hook writer.
            ownM = ownMouse.load(); ownK = ownKeyboard.load(); foreignM = foreignMouse.load(); foreignK = foreignKeyboard.load(); destroyed = windowDestroy.load();
        }
        const auto current = epoch.load();
        json out{{"baselineEpoch",baseline},{"currentEpoch",current},{"epochChanged",current != baseline},
            {"ownTaggedMouseEvents",ownM},{"ownTaggedKeyboardEvents",ownK},{"foreignMouseEvents",foreignM},{"foreignKeyboardEvents",foreignK},
            {"targetWindowDestroyEvents",destroyed},{"snapshotCoherent",coherent},{"emergencyRequested",emergency.load()},
            {"disconnected",disconnected.load()},{"lastForeign",nullptr}};
        if (coherent && kind != static_cast<uint32_t>(ForeignKind::none)) {
            const bool mouseEvent = kind == static_cast<uint32_t>(ForeignKind::mouse);
            const bool keyboardEvent = kind == static_cast<uint32_t>(ForeignKind::keyboard);
            const char* category = "other";
            if (mouseEvent) {
                switch (message) {
                case WM_MOUSEMOVE: category = "move"; break;
                case WM_LBUTTONDOWN: case WM_RBUTTONDOWN: case WM_MBUTTONDOWN: case WM_XBUTTONDOWN: category = "button_down"; break;
                case WM_LBUTTONUP: case WM_RBUTTONUP: case WM_MBUTTONUP: case WM_XBUTTONUP: category = "button_up"; break;
                case WM_MOUSEWHEEL: category = "wheel"; break;
                case WM_MOUSEHWHEEL: category = "horizontal_wheel"; break;
                default: break;
                }
            } else if (keyboardEvent) {
                switch (message) {
                case WM_KEYDOWN: category = "key_down"; break;
                case WM_KEYUP: category = "key_up"; break;
                case WM_SYSKEYDOWN: category = "system_key_down"; break;
                case WM_SYSKEYUP: category = "system_key_up"; break;
                default: break;
                }
            } else category = "window_destroy";
            json last{{"kind",mouseEvent ? "mouse" : keyboardEvent ? "keyboard" : "window-destroy"},
                {"messageCategory",category},{"observedAtTick64",tick},{"eventTime",eventTime}};
            if (mouseEvent || keyboardEvent) {
                last["injected"] = injected; last["lowerIntegrityInjected"] = lower; last["extraInfoZero"] = extraZero;
                last["low32MatchesOwnTag"] = low32Matches; last["extraInfoUpper32Zero"] = upper32Zero;
            }
            if (mouseEvent) last["point"] = {{"x",x},{"y",y}};
            out["lastForeign"] = std::move(last);
        }
        return out;
    }
};
struct Overlay {
    HWND hwnd = nullptr;
    HWND ghost = nullptr;
    std::string id;
    bool userPointer = false;
    bool rendered = false, replacementReady = false, waiting = false;
    POINT point{}, ghostPoint{};
    uint64_t ghostAt=0;
    bool hasGhost=false;
    COLORREF color = RGB(56,189,248);
    CursorPresentation presentation;
    CursorFrame lastFrame{},ghostFrame{};
    std::unique_ptr<CursorSurface> surface,ghostSurface;
    Overlay(bool user,bool reduced) : userPointer(user),presentation(user,GetTickCount64(),reduced) {}
    ~Overlay() { if (ghost) DestroyWindow(ghost); if (hwnd) DestroyWindow(hwnd); }
};
// All window/GDI/hook work stays on the original message thread. The broker only
// invokes short UI tasks; no stdin or actuation loop can starve these callbacks.
class Ui {
    static inline Ui* instance = nullptr;
    static constexpr UINT invokeMessage = WM_APP + 1;
    Signals& signals;
    std::vector<Target>& targets;
    HWND controller = nullptr;
    HHOOK mouse = nullptr, keyboard = nullptr;
    HWINEVENTHOOK events = nullptr;
    std::map<std::string, std::unique_ptr<Overlay>> overlays;
    std::vector<std::unique_ptr<Overlay>> retiring;
    CursorGraphics graphics;
    bool reducedMotion = false;
    HCURSOR ordinaryCursor = nullptr; // Shared system resource; never destroyed.
    static LRESULT CALLBACK mouseHook(int code, WPARAM wp, LPARAM lp) {
        if (code == HC_ACTION && instance) {
            const auto& e = *reinterpret_cast<const MSLLHOOKSTRUCT*>(lp);
            auto& s = instance->signals;
            if (e.dwExtraInfo == s.tag) { instance->routing.observeOwnMouse(static_cast<UINT>(wp),e); s.observeOwn(true); }
            else {
                if (instance->routing.requested.load() && (s.disconnected.load() || s.explicitStop.load() || s.emergency.load())) instance->routing.fail(MouseRouting::Fault::staleIntent);
                const bool routed=!(e.flags&LLMHF_INJECTED) && instance->routing.intercept(static_cast<UINT>(wp),e);
                if ((e.flags&LLMHF_INJECTED) && (instance->routing.capture.load() || instance->routing.phase.load()==MouseRouting::Phase::probe))
                    instance->routing.fail(MouseRouting::Fault::foreignInjection);
                s.observeForeign(Signals::ForeignKind::mouse, static_cast<UINT>(wp), e.time,
                    (e.flags & LLMHF_INJECTED) != 0, (e.flags & LLMHF_LOWER_IL_INJECTED) != 0, e.dwExtraInfo, e.pt,
                    (e.flags&LLMHF_INJECTED)!=0 || (!routed && !instance->routing.enabled.load()));
                if (!(e.flags & LLMHF_INJECTED)) {
                    int vk = 0; bool down = false;
                    switch (wp) {
                    case WM_LBUTTONDOWN: vk = VK_LBUTTON; down = true; break;
                    case WM_LBUTTONUP: vk = VK_LBUTTON; break;
                    case WM_RBUTTONDOWN: vk = VK_RBUTTON; down = true; break;
                    case WM_RBUTTONUP: vk = VK_RBUTTON; break;
                    case WM_MBUTTONDOWN: vk = VK_MBUTTON; down = true; break;
                    case WM_MBUTTONUP: vk = VK_MBUTTON; break;
                    case WM_XBUTTONDOWN: vk = HIWORD(e.mouseData) == XBUTTON1 ? VK_XBUTTON1 : VK_XBUTTON2; down = true; break;
                    case WM_XBUTTONUP: vk = HIWORD(e.mouseData) == XBUTTON1 ? VK_XBUTTON1 : VK_XBUTTON2; break;
                    default: break;
                    }
                    if (vk) s.physical[static_cast<size_t>(vk)].store(down);
                }
                if (routed) return 1;
            }
        }
        return CallNextHookEx(nullptr, code, wp, lp);
    }
    static LRESULT CALLBACK keyboardHook(int code, WPARAM wp, LPARAM lp) {
        if (code == HC_ACTION && instance) {
            const auto& e = *reinterpret_cast<const KBDLLHOOKSTRUCT*>(lp);
            auto& s = instance->signals;
            if (e.dwExtraInfo == s.tag) s.observeOwn(false);
            else {
                if (instance->routing.capture.load() || instance->routing.phase.load()==MouseRouting::Phase::probe)
                    instance->routing.fail(MouseRouting::Fault::physicalKeyboard);
                s.observeForeign(Signals::ForeignKind::keyboard, static_cast<UINT>(wp), e.time,
                    (e.flags & LLKHF_INJECTED) != 0, (e.flags & LLKHF_LOWER_IL_INJECTED) != 0, e.dwExtraInfo);
                if (!(e.flags & LLKHF_INJECTED) && e.vkCode < 256) {
                    s.physical[e.vkCode].store(wp == WM_KEYDOWN || wp == WM_SYSKEYDOWN);
                }
            }
        }
        return CallNextHookEx(nullptr, code, wp, lp);
    }
    static void CALLBACK windowEvent(HWINEVENTHOOK, DWORD event, HWND hwnd, LONG object, LONG child, DWORD, DWORD time) {
        if (!instance || event != EVENT_OBJECT_DESTROY || object != OBJID_WINDOW || child != CHILDID_SELF) return;
        instance->routing.windowDestroyed(hwnd);
        for (auto& t : instance->targets) if (t.hwnd == hwnd) {
            t.destroyed->store(true);
            instance->signals.observeForeign(Signals::ForeignKind::windowDestroy, event, time, false, false, 0);
        }
    }
    static LRESULT CALLBACK controlProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
        if (msg == invokeMessage) { (*reinterpret_cast<std::function<void()>*>(lp))(); return 0; }
        if (msg==WM_INPUT && instance) {
            RAWINPUT input{}; UINT size=sizeof(input);
            if (GetRawInputData(reinterpret_cast<HRAWINPUT>(lp),RID_INPUT,&input,&size,sizeof(RAWINPUTHEADER))!=static_cast<UINT>(-1))
                instance->routing.receive(input,static_cast<DWORD>(GetMessageTime()));
            else if (instance->routing.requested.load()) instance->routing.fail(MouseRouting::Fault::rawLost);
            instance->refreshUserOverlay();
            return DefWindowProcW(hwnd,msg,wp,lp);
        }
        if (msg==WM_TIMER && wp==2 && instance) {
            instance->routing.tick();
            instance->refreshUserOverlay();
            instance->animateOverlays();
            instance->syncSystemCursor();
            return 0;
        }
        if (msg==WM_INPUT_DEVICE_CHANGE && instance) { instance->routing.deviceChanged(static_cast<UINT>(wp),reinterpret_cast<HANDLE>(lp)); return 0; }
        if (msg == WM_HOTKEY && wp == 1 && instance) {
            instance->signals.emergency.store(true);
            instance->routing.fail(MouseRouting::Fault::staleIntent);
            instance->signals.epoch.fetch_add(1);
            return 0;
        }
        if (msg == WM_CLOSE) { DestroyWindow(hwnd); return 0; }
        if (msg == WM_DESTROY) { PostQuitMessage(0); return 0; }
        return DefWindowProcW(hwnd, msg, wp, lp);
    }
    static LRESULT CALLBACK overlayProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
        if (msg == WM_NCCREATE) {
            auto cs = reinterpret_cast<CREATESTRUCTW*>(lp);
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(cs->lpCreateParams));
        }
        if (msg == WM_NCHITTEST) return HTTRANSPARENT;
        if (msg == WM_MOUSEACTIVATE) return MA_NOACTIVATE;
        if (msg == WM_ERASEBKGND) return 1;
        if (msg == WM_PAINT) { PAINTSTRUCT ps{}; BeginPaint(hwnd,&ps); EndPaint(hwnd,&ps); return 0; }
        return DefWindowProcW(hwnd, msg, wp, lp);
    }
    static HWND makeOverlay(POINT p) {
        return CreateWindowExW(WS_EX_TOPMOST|WS_EX_LAYERED|WS_EX_TRANSPARENT|WS_EX_NOACTIVATE|WS_EX_TOOLWINDOW,
            L"AzraelSwitchedCursor",L"",WS_POPUP,p.x,p.y,CursorSurface::width,CursorSurface::height,
            nullptr,nullptr,GetModuleHandleW(nullptr),nullptr);
    }
    bool render(Overlay& o,uint64_t now,bool force=false) {
        const auto frame=o.presentation.frame(now);
        const UINT dpi=GetDpiForWindow(o.hwnd);
        const float scale=static_cast<float>(dpi?dpi:96)/96;
        if (!o.surface || o.surface->dpiScale!=scale) { o.surface=std::make_unique<CursorSurface>(scale); force=true; }
        if (!force && o.rendered && frame==o.lastFrame) return true;
        if (!o.surface->draw(o.userPointer,o.color,frame,false,ordinaryCursor) || !o.surface->present(o.hwnd,o.point)) return false;
        o.lastFrame=frame; o.rendered=true;
        return true;
    }
    void animateOverlays() {
        const auto now=GetTickCount64();
        for (auto& item : overlays) {
            auto& o=*item.second;
            if (!render(o,now)) { routing.fail(MouseRouting::Fault::restoration); ShowWindow(o.hwnd,SW_HIDE); }
            if (o.hasGhost) {
                o.ghostFrame.alpha=CursorPresentation::ghostAlpha(now,o.ghostAt,reducedMotion);
                if (!o.ghostFrame.alpha) { ShowWindow(o.ghost,SW_HIDE); o.hasGhost=false; }
                else if (!o.ghostSurface->draw(false,o.color,o.ghostFrame,true) || !o.ghostSurface->present(o.ghost,o.ghostPoint)) {
                    ShowWindow(o.ghost,SW_HIDE); o.hasGhost=false;
                }
            }
        }
        for (auto i=retiring.begin();i!=retiring.end();) {
            auto& o=**i;
            if (o.presentation.expired(now)) { i=retiring.erase(i); continue; }
            // A fading user label must continue following the physical pointer.
            if (o.userPointer) GetCursorPos(&o.point);
            if (!render(o,now)) { i=retiring.erase(i); continue; }
            ++i;
        }
    }
public:
    MouseRouting routing;
    SystemCursor systemCursor;
    void refreshUserOverlay() {
        const auto user=overlays.find("@user");
        if (user==overlays.end()) return;
        auto& o=*user->second;
        const auto point=routing.userPosition;
        const bool ready=routing.enabled.load() && routing.phase.load()==MouseRouting::Phase::ready;
        bool changed=false;
        if (ready && !o.replacementReady) { o.presentation.enter(GetTickCount64()); o.replacementReady=true; changed=true; }
        const bool waiting=routing.hasWaitingHuman();
        if (waiting!=o.waiting) { o.waiting=waiting; o.presentation.setWaiting(waiting,GetTickCount64()); changed=true; }
        if (o.point.x!=point.x || o.point.y!=point.y) {
            o.point=point;
            const auto origin=o.surface->origin(point);
            if (!SetWindowPos(o.hwnd,HWND_TOPMOST,origin.x,origin.y,0,0,SWP_NOSIZE|SWP_NOACTIVATE))
                routing.fail(MouseRouting::Fault::restoration);
        }
        // High-rate Raw Input only relocates the existing alpha surface. The
        // timer advances visual tweens, so 1000Hz motion cannot cause 1000Hz GDI+
        // painting or hold up routing. Entry must paint before cursor hiding.
        if (changed && !render(o,GetTickCount64())) {
            routing.fail(MouseRouting::Fault::restoration);
            ShowWindow(o.hwnd,SW_HIDE);
        }
    }
    bool syncSystemCursor() {
        systemCursor.tick();
        const auto brokerTick=signals.brokerHeartbeat.load();
        if (routing.capture.load() && brokerTick && GetTickCount64()-brokerTick>1500)
            routing.fail(MouseRouting::Fault::restoration);
        const bool ready=signals.collaborationRequested.load() && routing.enabled.load() &&
            routing.phase.load()==MouseRouting::Phase::ready &&
            !signals.explicitStop.load() && !signals.disconnected.load() && !signals.emergency.load();
        const auto user=overlays.find("@user");
        const bool userVisible=user!=overlays.end() && user->second->replacementReady && user->second->rendered && IsWindowVisible(user->second->hwnd);
        if (ready && !userVisible) routing.fail(MouseRouting::Fault::restoration);
        // Pointer visibility follows the cooperative mode, not an individual
        // model gesture. Never hide before its replacement overlay is visible.
        const bool hide=ready && userVisible;
        const bool ok=hide ? systemCursor.hide() : systemCursor.show();
        if (!ok && signals.collaborationRequested.load()) routing.fail(MouseRouting::Fault::restoration);
        return ok;
    }
    void requireSystemCursor() {
        if (!signals.collaborationRequested.load()) return;
        invoke([&] {
            require(routing.enabled.load() && routing.capture.load() && syncSystemCursor(),
                "cursor_visibility","System cursor guard is unavailable; input stopped");
        });
    }
    bool hotkey = false;
    Ui(Signals& s, std::vector<Target>& t) : signals(s), targets(t) {}
    void start() {
        instance = this;
        graphics.start();
        BOOL animation=TRUE; if (SystemParametersInfoW(SPI_GETCLIENTAREAANIMATION,0,&animation,0)) reducedMotion=!animation;
        ordinaryCursor=LoadCursorW(nullptr,IDC_ARROW);
        routing.configureOwnTag(signals.tag);
        WNDCLASSW wc{}; wc.hInstance = GetModuleHandleW(nullptr); wc.lpfnWndProc = controlProc; wc.lpszClassName = L"AzraelSwitchedControl";
        require(RegisterClassW(&wc) != 0, "win32", "Cannot register controller class");
        controller = CreateWindowExW(0, wc.lpszClassName, L"", 0, 0, 0, 0, 0, HWND_MESSAGE, nullptr, wc.hInstance, nullptr);
        require(controller != nullptr, "win32", "Cannot create message controller");
        require(SetTimer(controller,2,16,nullptr)!=0,"win32","Cannot start routing safety timer");
        wc.lpfnWndProc = overlayProc; wc.lpszClassName = L"AzraelSwitchedCursor";
        require(RegisterClassW(&wc) != 0, "win32", "Cannot register overlay class");
        mouse = SetWindowsHookExW(WH_MOUSE_LL, mouseHook, GetModuleHandleW(nullptr), 0);
        keyboard = SetWindowsHookExW(WH_KEYBOARD_LL, keyboardHook, GetModuleHandleW(nullptr), 0);
        require(mouse && keyboard, "hook_unavailable", "Both low-level interference hooks are required");
        events = SetWinEventHook(EVENT_OBJECT_DESTROY, EVENT_OBJECT_DESTROY, nullptr, windowEvent, 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
        require(events != nullptr, "hook_unavailable", "Window destruction tracking is required");
        hotkey = RegisterHotKey(controller, 1, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, VK_PAUSE) != FALSE;
        for (int vk : {VK_LBUTTON, VK_RBUTTON, VK_MBUTTON, VK_XBUTTON1, VK_XBUTTON2, VK_LSHIFT, VK_RSHIFT, VK_LCONTROL, VK_RCONTROL, VK_LMENU, VK_RMENU, VK_LWIN, VK_RWIN}) {
            signals.physical[static_cast<size_t>(vk)].store((GetAsyncKeyState(vk) & 0x8000) != 0);
        }
    }
    void invoke(const std::function<void()>& action) {
        std::exception_ptr error;
        std::function<void()> wrapped = [&] { try { action(); } catch (...) { error = std::current_exception(); } };
        SendMessageW(controller, invokeMessage, 0, reinterpret_cast<LPARAM>(&wrapped));
        if (error) std::rethrow_exception(error);
    }
    void drainRawForHandoff() {
        // Called only on this window's UI thread. Sent invoke messages can
        // overtake queued RAW notifications during continuous physical motion.
        // Dispatch a bounded batch before deciding whether motion is settled;
        // normal controlProc/DefWindowProc still own RAW cleanup and routing.
        MSG message{};
        for (unsigned count=0;count<256 && PeekMessageW(&message,controller,WM_INPUT,WM_INPUT,PM_REMOVE);++count)
            DispatchMessageW(&message);
    }
    void create(const std::string& id, POINT p, COLORREF color) {
        invoke([&] {
            // A reused id cannot leave an old fading overlay at the same origin.
            retiring.erase(std::remove_if(retiring.begin(),retiring.end(),[&](const auto& o){return o->id==id;}),retiring.end());
            auto o = std::make_unique<Overlay>(id=="@user",reducedMotion); o->id=id; o->color = color; o->point=p;
            o->hwnd=makeOverlay(p);
            require(o->hwnd != nullptr, "overlay", "Cannot create cursor overlay");
            require(render(*o,GetTickCount64(),true),"overlay","Cannot render alpha cursor overlay");
            ShowWindow(o->hwnd, SW_SHOWNOACTIVATE);
            overlays.emplace(id, std::move(o));
        });
    }
    void move(const std::string& id, POINT p,bool teleport=false) {
        invoke([&] {
            auto& o=*overlays.at(id);
            if (teleport && !reducedMotion && (p.x!=o.point.x || p.y!=o.point.y)) {
                if (!o.ghost) o.ghost=makeOverlay(o.point);
                if (o.ghost) {
                    o.ghostPoint=o.point; o.ghostAt=GetTickCount64(); o.ghostFrame=o.presentation.frame(o.ghostAt);
                    o.ghostFrame.alpha=.24f; o.ghostSurface=std::make_unique<CursorSurface>(o.surface->dpiScale);
                    o.hasGhost=o.ghostSurface->draw(false,o.color,o.ghostFrame,true) && o.ghostSurface->present(o.ghost,o.ghostPoint);
                    if (o.hasGhost) ShowWindow(o.ghost,SW_SHOWNOACTIVATE);
                }
            }
            o.point=p; const auto origin=o.surface->origin(p);
            require(SetWindowPos(o.hwnd,HWND_TOPMOST,origin.x,origin.y,0,0,SWP_NOSIZE|SWP_NOACTIVATE)!=FALSE,"overlay","Cannot move cursor overlay");
            require(render(o,GetTickCount64()),"overlay","Cannot update cursor overlay");
        });
    }
    void activity(const std::string& id,bool drag,bool click=false) {
        invoke([&] { auto& o=*overlays.at(id); const auto now=GetTickCount64(); o.presentation.setActive(true,drag,now); if (click) o.presentation.click(now); require(render(o,now),"overlay","Cannot display model operation"); });
    }
    void idle(const std::string& id) {
        invoke([&] { auto& o=*overlays.at(id); const auto now=GetTickCount64(); o.presentation.setActive(false,false,now); require(render(o,now),"overlay","Cannot display idle pointer"); });
    }
    void endModel() {
        invoke([&] { routing.endModel(); for (auto& item : overlays) if (!item.second->userPointer) item.second->presentation.setActive(false,false,GetTickCount64()); });
    }
    void remove(const std::string& id) {
        invoke([&] { auto i=overlays.find(id); if (i!=overlays.end()) {
            auto o=std::move(i->second); overlays.erase(i); if (o->ghost) ShowWindow(o->ghost,SW_HIDE);
            o->presentation.exit(GetTickCount64());
            // Bounded visual-only retirement; stop/shutdown still destroy immediately.
            if (retiring.size()>=9) retiring.erase(retiring.begin()); retiring.push_back(std::move(o));
        } });
    }
    void collaboration(bool enabled) {
        invoke([&] {
            signals.collaborationRequested.store(enabled);
            if (enabled) {
                routing.enable(controller);
                if (!overlays.count("@user")) create("@user",routing.userPosition,RGB(255,255,255));
            } else { routing.disable(); require(syncSystemCursor(),"cursor_visibility","System cursor restoration failed"); remove("@user"); }
        });
    }
    json collaborationState() {
        json result; invoke([&] { result=routing.status(); result["systemCursor"]=systemCursor.status(); }); return result;
    }
    void clear() { invoke([&] { routing.disable(); signals.collaborationRequested.store(false); const bool restored=syncSystemCursor(); overlays.clear(); retiring.clear(); require(restored,"cursor_visibility","System cursor restoration failed"); }); }
    void close() { PostMessageW(controller, WM_CLOSE, 0, 0); }
    int loop() { MSG msg{}; int r = 0; while ((r = GetMessageW(&msg, nullptr, 0, 0)) > 0) { TranslateMessage(&msg); DispatchMessageW(&msg); } return r < 0 ? 1 : 0; }
    ~Ui() {
        routing.disable(); if (controller) KillTimer(controller,2);
        if (!systemCursor.stop()) std::fprintf(stderr,"{\"level\":\"ERROR\",\"event\":\"cursor_guard_shutdown_failed\"}\n");
        if (mouse) UnhookWindowsHookEx(mouse);
        if (keyboard) UnhookWindowsHookEx(keyboard);
        if (events) UnhookWinEvent(events);
        if (hotkey) UnregisterHotKey(controller, 1);
        instance = nullptr;
    }
};
} // namespace mp
