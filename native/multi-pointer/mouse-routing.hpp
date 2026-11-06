#pragma once
#include "platform.hpp"
#include "raw-origin.hpp"
#include <functional>
#include <string_view>

namespace mp {
struct HumanGesture {
    enum class Kind { click, drag, wheel };
    Kind kind = Kind::click;
    std::shared_ptr<Target> target;
    HWND focus = nullptr, leaf = nullptr;
    RECT outer{};
    POINT start{}, end{};
    std::vector<POINT> path;
    int button = 0, delta = 0;
    uint64_t durationMs = 0;
    uint64_t submittedAt = 0;
    std::atomic<bool> ready{false}, aborted{false};
    std::atomic<bool> started{false};
    const char* failure = "none";
};
class MouseRouting {
public:
    enum class Phase : uint32_t { off, awaitingRaw, probe, ready, failed };
    enum class Fault : uint32_t { none, rawRegistration, rawSurvival, unsupportedDevice, physicalKeyboard, foreignInjection,
        rawLost, hookLost, queueFull, gestureTooLong, unsupportedTarget, staleIntent, restoration };
    static_assert(std::atomic<Phase>::is_always_lock_free && std::atomic<Fault>::is_always_lock_free,"Routing hook state must be lock-free");
    std::atomic<Phase> phase{Phase::off};
    std::atomic<Fault> fault{Fault::none};
    std::atomic<bool> requested{false}, enabled{false}, capture{false}, modelActive{false};
    std::atomic<uint64_t> rawPackets{0}, suppressed{0}, suppressedMotion{0}, pairedProbePackets{0}, faults{0};
    std::atomic<uint64_t> lastSuppressedTick{0}, firstUnmatchedTick{0}, rawWithoutHookTick{0};
    std::atomic<DWORD> lastSuppressedTime{0};
    std::atomic<DWORD> lastSuppressedMotionTime{0}, lastPhysicalRawMotionTime{0};
    std::atomic<bool> physicalRawMotionSeen{false};
    std::atomic<unsigned> pendingHuman{0};
    std::atomic<uint64_t> completedHuman{0}, skippedHuman{0};
    std::atomic<uint64_t> lastHumanApplicationInputs{0};
    std::atomic<uint32_t> lastHumanFailure{0};
    std::function<bool(std::shared_ptr<HumanGesture>)> admit;
    POINT userPosition{}; // UI-thread state, read via Ui::invoke only.
    POINT userAtModelStart{}, lastHumanSubmission{};
    bool hasHumanSubmission=false;
    const char* restorationReason = "not_attempted"; // Bounded diagnostic category, UI-thread only.
    std::shared_ptr<HumanGesture> recording;
private:
    HWND controller = nullptr;
    uint64_t pendingDeadline = 0, probeDeadline = 0, probeSuppressedBaseline = 0;
    uint64_t probeLastMatched = 0;
    uint64_t lastPathSample = 0;
    uint64_t idleCaptureStarted = 0;
    DWORD lastRawTime = 0;
    struct KnownMouse { HANDLE handle = nullptr; RID_DEVICE_INFO_MOUSE info{}; bool initialArrivalSeen = false; };
    std::vector<KnownMouse> initialMice;
    bool mouseSnapshotReady = false;
    const char* mouseSnapshotReason = "not_requested";
    uint64_t initialArrivalDeadline = 0, allowedInitialArrivals = 0, rejectedDeviceChanges = 0;
    bool hasDeviceChange = false, lastChangeKnown = false, lastChangeInfoVerified = false;
    UINT lastChange = 0;
    DWORD lastChangeDeviceType = MAXDWORD;
    HANDLE lastChangeHandle = nullptr;
    Phase lastChangePhase = Phase::off;
    uint64_t lastChangeTick = 0;
    const char* lastChangeReason = "none";
    bool hasRawSample = false, lastRawKnown = false;
    HANDLE lastRawHandle = nullptr;
    DWORD lastRawType = MAXDWORD;
    USHORT lastRawFlags = 0, lastRawButtonFlags = 0;
    const char* lastRawReason = "none";
    bool lastRawOwnExtraInfoLow32 = false, lastRawOwnReceiptMatched = false;
    uint64_t ignoredOwnRawPackets = 0;
    ULONG_PTR ownRawTag = 0;
    RawDesktop ownRawDesktop{};
    std::array<OwnMouseReceipt,64> ownReceipts{};
    size_t ownReceiptNext = 0;
    struct PendingOwnRaw { bool active=false; RAWINPUT packet{}; DWORD time=0; uint64_t observedTick=0; };
    std::array<PendingOwnRaw,8> pendingOwnRaw{};
    bool receivingExpiredOwnRaw = false;
    struct ReceiptMismatch {
        const char* kind = "unknown";
        const char* reason = "none";
        const char* shapeReason = "none";
        int32_t timeDelta = 0;
        int64_t age = 0;
        bool consumed = false;
    };
    std::array<ReceiptMismatch,8> lastReceiptMismatches{};
    size_t lastReceiptMismatchCount = 0;
    const char* preparationWaitReason = "relative_motion_required";
    std::vector<std::weak_ptr<Target>> humanTargets;
    std::vector<std::weak_ptr<HumanGesture>> humanIntents;
    struct CursorSample {
        const char* source="none"; uint64_t tick=0; DWORD eventTime=0;
        POINT logical{}, observed{}, model{};
        bool hookProposed=false, capturing=false, modelActive=false;
        Phase phase=Phase::off;
    };
    std::array<CursorSample,64> cursorSamples{};
    size_t cursorSampleCount=0;
    bool cursorTraceActive=false;
    POINT lastModelCursor{};
    static const char* phaseName(Phase value) {
        return value==Phase::off?"off":value==Phase::awaitingRaw?"awaiting_relative_motion":value==Phase::probe?"probing_suppressed_raw":value==Phase::ready?"ready":"failed";
    }
    static const char* deviceTypeName(DWORD value) {
        return value==RIM_TYPEMOUSE?"mouse":value==RIM_TYPEKEYBOARD?"keyboard":value==RIM_TYPEHID?"hid":"unavailable";
    }
    static const char* heldPreparationReason() {
        for (int vk : {VK_LBUTTON,VK_RBUTTON,VK_MBUTTON,VK_XBUTTON1,VK_XBUTTON2})
            if (GetAsyncKeyState(vk)&0x8000) return "physical_buttons_held";
        for (int vk : {VK_SHIFT,VK_CONTROL,VK_MENU,VK_LWIN,VK_RWIN})
            if (GetAsyncKeyState(vk)&0x8000) return "physical_modifiers_held";
        return "relative_motion_required";
    }
    static bool deviceInfo(HANDLE handle, RID_DEVICE_INFO& info) {
        info={}; info.cbSize=sizeof(info); UINT bytes=sizeof(info);
        const UINT copied=GetRawInputDeviceInfoW(handle,RIDI_DEVICEINFO,&info,&bytes);
        return copied!=static_cast<UINT>(-1) && copied>=sizeof(info);
    }
    bool snapshotMice() {
        initialMice.clear(); mouseSnapshotReady=false;
        UINT count=0;
        if (GetRawInputDeviceList(nullptr,&count,sizeof(RAWINPUTDEVICELIST))!=0) { mouseSnapshotReason="device_count_failed"; return false; }
        if (count>256) { mouseSnapshotReason="device_count_exceeds_256"; return false; }
        std::array<RAWINPUTDEVICELIST,256> devices{}; UINT capacity=static_cast<UINT>(devices.size());
        const UINT copied=GetRawInputDeviceList(devices.data(),&capacity,sizeof(RAWINPUTDEVICELIST));
        if (copied==static_cast<UINT>(-1) || copied>devices.size()) { mouseSnapshotReason="device_list_unavailable_or_changed"; return false; }
        for (UINT i=0;i<copied;++i) if (devices[i].dwType==RIM_TYPEMOUSE) {
            RID_DEVICE_INFO info{};
            if (!devices[i].hDevice || !deviceInfo(devices[i].hDevice,info) || info.dwType!=RIM_TYPEMOUSE) { mouseSnapshotReason="mouse_info_unavailable"; return false; }
            initialMice.push_back({devices[i].hDevice,info.mouse,false});
        }
        mouseSnapshotReady=!initialMice.empty(); mouseSnapshotReason=mouseSnapshotReady?"ready":"no_mouse_devices"; return mouseSnapshotReady;
    }
    static const char* faultName(Fault value) {
        switch (value) {
        case Fault::none: return "none";
        case Fault::rawRegistration: return "raw_registration_failed";
        case Fault::rawSurvival: return "raw_survival_unproven";
        case Fault::unsupportedDevice: return "unsupported_absolute_touch_pen_or_device";
        case Fault::physicalKeyboard: return "physical_keyboard_fail_open";
        case Fault::foreignInjection: return "foreign_injection_fail_open";
        case Fault::rawLost: return "raw_delivery_lost";
        case Fault::hookLost: return "hook_observation_lost";
        case Fault::queueFull: return "human_queue_full";
        case Fault::gestureTooLong: return "human_gesture_exceeds_two_seconds";
        case Fault::unsupportedTarget: return "human_target_unverifiable";
        case Fault::staleIntent: return "human_intent_changed";
        case Fault::restoration: return "user_position_restore_failed";
        }
        return "unknown";
    }
    std::shared_ptr<HumanGesture> pin(POINT p) {
        auto intent=std::make_shared<HumanGesture>();
        intent->leaf=WindowFromPoint(p); HWND root=GetAncestor(intent->leaf,GA_ROOT); DWORD pid=0;
        const DWORD thread=GetWindowThreadProcessId(root,&pid);
        require(root && pid && pid!=GetCurrentProcessId() && thread,"human_target","Cannot identify the intended human window");
        DWORD ownSession=0,targetSession=0;
        require(ProcessIdToSessionId(GetCurrentProcessId(),&ownSession) && ProcessIdToSessionId(pid,&targetSession) && ownSession==targetSession,
            "human_target","Human target belongs to another session");
        auto target=std::make_shared<Target>(); target->id="human"; target->pid=pid; target->hwnd=root; target->thread=thread;
        target->process=Handle(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|SYNCHRONIZE,FALSE,pid));
        require(target->process.value!=nullptr,"human_target","Cannot verify human target process");
        target->born=creation(target->process.value); target->path=normalizedPath(executable(target->process.value)); target->validate();
        require(GetWindowRect(root,&intent->outer) != FALSE,"human_target","Cannot pin human target geometry");
        GUITHREADINFO info{}; info.cbSize=sizeof(info);
        require(GetGUIThreadInfo(thread,&info) != FALSE,"human_target","Cannot pin human target focus");
        intent->focus=info.hwndFocus; intent->target=std::move(target); intent->start=p; intent->end=p; intent->submittedAt=GetTickCount64();
        humanTargets.erase(std::remove_if(humanTargets.begin(),humanTargets.end(),[](const auto& entry) { return entry.expired(); }),humanTargets.end());
        require(humanTargets.size()<64,"human_target","Too many live human target pins"); humanTargets.push_back(intent->target);
        intent->path.reserve(128); intent->path.push_back(p);
        return intent;
    }
    void submit(const std::shared_ptr<HumanGesture>& intent) {
        pendingHuman.fetch_add(1);
        if (!admit || !admit(intent)) { pendingHuman.fetch_sub(1); fail(Fault::queueFull); return; }
        lastHumanSubmission=intent->start; hasHumanSubmission=true;
        humanIntents.erase(std::remove_if(humanIntents.begin(),humanIntents.end(),[](const auto& entry) { return entry.expired(); }),humanIntents.end());
        humanIntents.push_back(intent);
    }
public:
    // Bounded UI-thread diagnostics. Hook callers supply the proposed event
    // point; cursor queries are identified separately so the two cannot be
    // mistaken for an already committed OS cursor observation.
    void sampleCursor(const char* source, POINT point, DWORD eventTime=0, bool hookProposed=false) {
        if (!cursorTraceActive || cursorSampleCount>=cursorSamples.size()) return;
        cursorSamples[cursorSampleCount++]={source,GetTickCount64(),eventTime,userPosition,point,lastModelCursor,
            hookProposed,capture.load(),modelActive.load(),phase.load()};
    }
    void observeCursorBoundary(const char* source) {
        POINT point{}; if (GetCursorPos(&point)) sampleCursor(source,point);
    }
    void syncUserCursor(const char* source) {
        POINT point{};
        if (GetCursorPos(&point)) { sampleCursor(source,point); userPosition=point; }
    }
    void configureOwnTag(ULONG_PTR tag) { ownRawTag=tag; }
    void observeOwnMouse(UINT message, const MSLLHOOKSTRUCT& event) {
        if (!requested.load() || !ownRawTag || event.dwExtraInfo!=ownRawTag || !(event.flags&LLMHF_INJECTED)) return;
        if (modelActive.load() && message==WM_MOUSEMOVE) lastModelCursor=event.pt;
        auto& receipt=ownReceipts[ownReceiptNext]; receipt={};
        receipt.trustedFullTag=true; receipt.injected=true; receipt.message=message; receipt.time=event.time;
        receipt.mouseData=event.mouseData; receipt.observedTick=GetTickCount64(); receipt.point=event.pt;
        ownReceiptNext=(ownReceiptNext+1)%ownReceipts.size();
        // RAW and low-level hook notifications can arrive in either order.
        // Quarantine never admits an input: only the unchanged full receipt
        // predicate can consume a pending packet. No hook allocation or wait.
        for (auto& pending : pendingOwnRaw) if (pending.active &&
            matchesOwnRawMouse(pending.packet,pending.time,GetTickCount64(),ownRawTag,receipt,ownRawDesktop)) {
            receipt.consumed=true; pending.active=false; ++ignoredOwnRawPackets; break;
        }
    }
    void fail(Fault value) {
        if (!requested.load()) return;
        auto previous=phase.load();
        if (previous==Phase::off || previous==Phase::failed || !phase.compare_exchange_strong(previous,Phase::failed)) return;
        fault.store(value); faults.fetch_add(1); enabled.store(false); capture.store(false);
    }
    // Hook-safe subset: only lock-free state changes; recording is UI-thread
    // state and callbacks on this UI thread cannot interleave without pumping.
    bool intercept(UINT message, const MSLLHOOKSTRUCT& event) {
        const auto current=phase.load();
        if (current==Phase::ready && !capture.load()) sampleCursor("idle_physical_hook",event.pt,event.time,true);
        if (current!=Phase::probe && !(current==Phase::ready && capture.load())) return false;
        if (message==WM_XBUTTONDOWN || message==WM_XBUTTONUP) { fail(Fault::unsupportedDevice); return false; }
        if (current==Phase::probe && message!=WM_MOUSEMOVE) { fail(Fault::rawSurvival); return false; }
        suppressed.fetch_add(1);
        lastSuppressedTime.store(event.time); lastSuppressedTick.store(GetTickCount64());
        if (message==WM_MOUSEMOVE) {
            suppressedMotion.fetch_add(1);
            lastSuppressedMotionTime.store(event.time);
            if (physicalRawMotionSeen.load() && static_cast<int32_t>(lastPhysicalRawMotionTime.load()-event.time)>=0) {
                firstUnmatchedTick.store(0); rawWithoutHookTick.store(0);
            } else {
                uint64_t zero=0; firstUnmatchedTick.compare_exchange_strong(zero,GetTickCount64());
            }
        }
        return true;
    }
    void enable(HWND window) {
        disable(); controller=window; requested.store(true); fault.store(Fault::none);
        phase.store(Phase::awaitingRaw); pendingDeadline=GetTickCount64()+10000;
        allowedInitialArrivals=0; rejectedDeviceChanges=0; hasDeviceChange=false; hasRawSample=false;
        preparationWaitReason=heldPreparationReason();
        restorationReason="not_attempted";
        hasHumanSubmission=false; physicalRawMotionSeen.store(false);
        ownRawDesktop={GetSystemMetrics(SM_XVIRTUALSCREEN),GetSystemMetrics(SM_YVIRTUALSCREEN),
            GetSystemMetrics(SM_CXVIRTUALSCREEN),GetSystemMetrics(SM_CYVIRTUALSCREEN)};
        if (!snapshotMice()) { lastChangeReason="enable_mouse_snapshot_unavailable"; fail(Fault::rawRegistration); return; }
        initialArrivalDeadline=GetTickCount64()+1000;
        RAWINPUTDEVICE device{0x01,0x02,RIDEV_INPUTSINK|RIDEV_DEVNOTIFY,controller};
        if (!RegisterRawInputDevices(&device,1,sizeof(device))) { fail(Fault::rawRegistration); return; }
        syncUserCursor("enable_sync");
    }
    void disable() {
        requested.store(false); enabled.store(false); capture.store(false); modelActive.store(false); phase.store(Phase::off);
        fault.store(Fault::none);
        if (recording) { recording->failure="collaboration_disabled"; recording->aborted.store(true); recording->ready.store(true); recording.reset(); }
        if (controller) { RAWINPUTDEVICE remove{0x01,0x02,RIDEV_REMOVE,nullptr}; RegisterRawInputDevices(&remove,1,sizeof(remove)); }
        controller=nullptr; firstUnmatchedTick.store(0); rawWithoutHookTick.store(0);
        ownReceipts.fill(OwnMouseReceipt{}); ownReceiptNext=0;
        pendingOwnRaw.fill(PendingOwnRaw{}); receivingExpiredOwnRaw=false;
    }
    void deviceChanged(UINT change, HANDLE handle) {
        hasDeviceChange=true; lastChange=change; lastChangeHandle=handle; lastChangePhase=phase.load(); lastChangeTick=GetTickCount64();
        const auto known=std::find_if(initialMice.begin(),initialMice.end(),[&](const KnownMouse& entry) { return entry.handle==handle; });
        lastChangeKnown=known!=initialMice.end();
        RID_DEVICE_INFO info{}; lastChangeInfoVerified=deviceInfo(handle,info); lastChangeDeviceType=lastChangeInfoVerified?info.dwType:MAXDWORD;
        if (!requested.load() || lastChangePhase==Phase::off) { lastChangeReason="ignored_not_requested"; return; }
        if (lastChangePhase==Phase::failed) { lastChangeReason="ignored_already_failed"; return; }
        const bool matchingMouse=lastChangeKnown && lastChangeInfoVerified && info.dwType==RIM_TYPEMOUSE &&
            info.mouse.dwId==known->info.dwId && info.mouse.dwNumberOfButtons==known->info.dwNumberOfButtons &&
            info.mouse.dwSampleRate==known->info.dwSampleRate && info.mouse.fHasHorizontalWheel==known->info.fHasHorizontalWheel;
        if (change==GIDC_ARRIVAL && matchingMouse && !known->initialArrivalSeen && lastChangeTick<=initialArrivalDeadline) {
            known->initialArrivalSeen=true; ++allowedInitialArrivals; lastChangeReason="initial_known_mouse_arrival"; return;
        }
        ++rejectedDeviceChanges;
        lastChangeReason=change==GIDC_REMOVAL?"device_removed":change!=GIDC_ARRIVAL?"unknown_change_category":!lastChangeKnown?"arrival_not_in_enable_snapshot":
            !matchingMouse?"arrival_device_info_changed_or_unavailable":"arrival_outside_initial_window_or_duplicate";
        fail(Fault::unsupportedDevice);
    }
    void receive(const RAWINPUT& input, DWORD time) {
        if (!requested.load() || phase.load()==Phase::failed) return;
        if (!receivingExpiredOwnRaw) rawPackets.fetch_add(1);
        lastRawTime=time;
        hasRawSample=true; lastRawHandle=input.header.hDevice; lastRawType=input.header.dwType; lastRawFlags=0; lastRawButtonFlags=0;
        lastRawOwnExtraInfoLow32=false; lastRawOwnReceiptMatched=false; lastReceiptMismatchCount=0;
        lastRawKnown=std::any_of(initialMice.begin(),initialMice.end(),[&](const KnownMouse& entry) { return entry.handle==input.header.hDevice; });
        if (input.header.dwType!=RIM_TYPEMOUSE) { lastRawReason="non_mouse_raw_packet"; fail(Fault::unsupportedDevice); return; }
        const auto& mouse=input.data.mouse; lastRawFlags=mouse.usFlags; lastRawButtonFlags=mouse.usButtonFlags;
        lastRawOwnExtraInfoLow32=ownRawTag!=0 && mouse.ulExtraInformation==static_cast<ULONG>(ownRawTag);
        if (lastRawOwnExtraInfoLow32 && !input.header.hDevice) {
            const RawDesktop desktop{GetSystemMetrics(SM_XVIRTUALSCREEN),GetSystemMetrics(SM_YVIRTUALSCREEN),
                GetSystemMetrics(SM_CXVIRTUALSCREEN),GetSystemMetrics(SM_CYVIRTUALSCREEN)};
            const auto now=GetTickCount64();
            for (size_t offset=0;offset<ownReceipts.size();++offset) {
                auto& receipt=ownReceipts[(ownReceiptNext+ownReceipts.size()-1-offset)%ownReceipts.size()];
                const auto mismatch=ownRawMouseMismatch(input,time,now,ownRawTag,receipt,desktop);
                if (!mismatch) {
                    receipt.consumed=true; lastRawOwnReceiptMatched=true; ++ignoredOwnRawPackets;
                    lastReceiptMismatchCount=0; lastRawReason="own_synthetic_raw_ignored"; return;
                }
                if (receipt.trustedFullTag && lastReceiptMismatchCount<lastReceiptMismatches.size()) {
                    auto& sample=lastReceiptMismatches[lastReceiptMismatchCount++];
                    sample.kind=ownMouseReceiptKind(receipt.message); sample.reason=mismatch;
                    // Diagnose shape separately when consumed/time/age is the
                    // first rejection. This copy never admits an input packet.
                    auto shapeReceipt=receipt; shapeReceipt.consumed=false;
                    shapeReceipt.time=time; shapeReceipt.observedTick=now;
                    const auto shape=ownRawMouseMismatch(input,time,now,ownRawTag,shapeReceipt,desktop);
                    sample.shapeReason=shape ? shape : "none";
                    sample.timeDelta=static_cast<int32_t>(time-receipt.time);
                    sample.age=now>=receipt.observedTick ? static_cast<int64_t>(now-receipt.observedTick) : -1;
                    sample.consumed=receipt.consumed;
                }
            }
            if (!receivingExpiredOwnRaw) {
                for (auto& pending : pendingOwnRaw) if (!pending.active) {
                    pending={true,input,time,now}; lastRawReason="awaiting_own_hook_receipt"; return;
                }
                lastRawReason="own_raw_quarantine_full"; fail(Fault::rawLost); return;
            }
        }
        if (!input.header.hDevice || !lastRawKnown || (mouse.usFlags&MOUSE_MOVE_ABSOLUTE) ||
            (mouse.usButtonFlags&(RI_MOUSE_BUTTON_4_DOWN|RI_MOUSE_BUTTON_4_UP|RI_MOUSE_BUTTON_5_DOWN|RI_MOUSE_BUTTON_5_UP|RI_MOUSE_HWHEEL))) {
            lastRawReason=!input.header.hDevice?"zero_device_handle":!lastRawKnown?"device_not_in_enable_snapshot":
                (mouse.usFlags&MOUSE_MOVE_ABSOLUTE)?"absolute_motion":"unsupported_button_or_horizontal_wheel";
            fail(Fault::unsupportedDevice); return;
        }
        lastRawReason="relative_known_mouse";
        const uint64_t now=GetTickCount64();
        const bool moved=mouse.lLastX!=0 || mouse.lLastY!=0;
        if (moved) { lastPhysicalRawMotionTime.store(time); physicalRawMotionSeen.store(true); }
        if (phase.load()==Phase::awaitingRaw) {
            preparationWaitReason=heldPreparationReason();
            if (mouse.usButtonFlags) preparationWaitReason=(mouse.usButtonFlags&(RI_MOUSE_LEFT_BUTTON_DOWN|RI_MOUSE_RIGHT_BUTTON_DOWN|RI_MOUSE_MIDDLE_BUTTON_DOWN)) ?
                "physical_buttons_held":"physical_mouse_event";
        }
        if (phase.load()==Phase::awaitingRaw && moved) {
            if (std::string_view(preparationWaitReason)!="relative_motion_required") { syncUserCursor("preparation_sync"); return; }
            preparationWaitReason="none";
            phase.store(Phase::probe); probeDeadline=now+250; probeSuppressedBaseline=suppressedMotion.load(); probeLastMatched=probeSuppressedBaseline; pairedProbePackets.store(0);
        }
        if (phase.load()==Phase::probe && moved && suppressedMotion.load()>probeLastMatched && time==lastSuppressedMotionTime.load()) {
            probeLastMatched=suppressedMotion.load(); pairedProbePackets.fetch_add(1); firstUnmatchedTick.store(0);
            if (pairedProbePackets.load()>=2) { enabled.store(true); phase.store(Phase::ready); capture.store(false); }
        }
        if (phase.load()!=Phase::ready || !capture.load()) { syncUserCursor("inactive_raw_sync"); return; }
        if (moved && static_cast<int32_t>(time-lastSuppressedMotionTime.load())>=0 && firstUnmatchedTick.load()) firstUnmatchedTick.store(0);
        if (moved) {
            const int x=GetSystemMetrics(SM_XVIRTUALSCREEN),y=GetSystemMetrics(SM_YVIRTUALSCREEN);
            const int w=GetSystemMetrics(SM_CXVIRTUALSCREEN),h=GetSystemMetrics(SM_CYVIRTUALSCREEN);
            userPosition.x=static_cast<LONG>(std::clamp<int64_t>(static_cast<int64_t>(userPosition.x)+mouse.lLastX,x,static_cast<int64_t>(x)+w-1));
            userPosition.y=static_cast<LONG>(std::clamp<int64_t>(static_cast<int64_t>(userPosition.y)+mouse.lLastY,y,static_cast<int64_t>(y)+h-1));
            if (static_cast<int32_t>(time-lastSuppressedMotionTime.load())>20) { uint64_t zero=0; rawWithoutHookTick.compare_exchange_strong(zero,now); }
            else rawWithoutHookTick.store(0);
            if (recording && now-lastPathSample>=16) {
                if (recording->path.size()>=127) { fail(Fault::gestureTooLong); return; }
                recording->path.push_back(userPosition); lastPathSample=now;
            }
        }
        try {
            const USHORT flags=mouse.usButtonFlags;
            const USHORT downs[3]{RI_MOUSE_LEFT_BUTTON_DOWN,RI_MOUSE_RIGHT_BUTTON_DOWN,RI_MOUSE_MIDDLE_BUTTON_DOWN};
            const USHORT ups[3]{RI_MOUSE_LEFT_BUTTON_UP,RI_MOUSE_RIGHT_BUTTON_UP,RI_MOUSE_MIDDLE_BUTTON_UP};
            for (int button=0;button<3;++button) {
                if (flags&downs[button]) {
                    if (recording) { fail(Fault::unsupportedDevice); return; }
                    recording=pin(userPosition); recording->button=button; lastPathSample=now; submit(recording);
                    if (phase.load()==Phase::failed) return;
                }
                if ((flags&ups[button]) && recording && recording->button==button) {
                    recording->end=userPosition; recording->path.push_back(userPosition);
                    recording->durationMs=now-recording->submittedAt;
                    recording->kind=recording->path.size()>2 || userPosition.x!=recording->start.x || userPosition.y!=recording->start.y ? HumanGesture::Kind::drag : HumanGesture::Kind::click;
                    if (now-recording->submittedAt>2000) { fail(Fault::gestureTooLong); return; }
                    recording->ready.store(true); recording.reset();
                }
            }
            if (flags&RI_MOUSE_WHEEL) {
                if (recording) { fail(Fault::unsupportedDevice); return; }
                auto wheel=pin(userPosition); wheel->kind=HumanGesture::Kind::wheel; wheel->delta=static_cast<SHORT>(mouse.usButtonData);
                wheel->ready.store(true); submit(wheel);
            }
        } catch (const Failure&) { fail(Fault::unsupportedTarget); }
    }
    void tick() {
        const auto now=GetTickCount64();
        if (requested.load() && phase.load()!=Phase::failed) for (auto& pending : pendingOwnRaw)
            if (pending.active && now-pending.observedTick>=20) {
                const auto expired=pending; pending.active=false;
                receivingExpiredOwnRaw=true; receive(expired.packet,expired.time); receivingExpiredOwnRaw=false;
                if (phase.load()==Phase::failed) break;
            }
        if (phase.load()==Phase::awaitingRaw) preparationWaitReason=heldPreparationReason();
        if ((phase.load()==Phase::awaitingRaw && now>=pendingDeadline) || (phase.load()==Phase::probe && now>=probeDeadline)) fail(Fault::rawSurvival);
        if (recording && now-recording->submittedAt>2000) fail(Fault::gestureTooLong);
        for (const auto& entry : humanIntents) if (auto intent=entry.lock()) if (!intent->started.load() && now-intent->submittedAt>5000) {
            intent->aborted.store(true); intent->ready.store(true); fail(Fault::staleIntent);
        }
        if (capture.load() && firstUnmatchedTick.load() && now-firstUnmatchedTick.load()>40) fail(Fault::rawLost);
        if (capture.load() && rawWithoutHookTick.load() && now-rawWithoutHookTick.load()>20) fail(Fault::hookLost);
        if (capture.load() && !modelActive.load() && !pendingHuman.load() && !recording) {
            if (!idleCaptureStarted) idleCaptureStarted=now;
            else if (now-idleCaptureStarted>250) fail(Fault::restoration);
        } else idleCaptureStarted=0;
        if (phase.load()==Phase::failed && recording) {
            recording->failure=faultName(fault.load()); recording->aborted.store(true); recording->ready.store(true); recording.reset();
        }
        if ((phase.load()==Phase::ready && !capture.load()) || phase.load()==Phase::failed) syncUserCursor("idle_timer_sync");
    }
    bool hasWaitingHuman() const {
        for (const auto& entry : humanIntents) if (auto intent=entry.lock())
            if (!intent->started.load() && !intent->aborted.load()) return true;
        return false;
    }
    void beginModel() {
        require(requested.load() && enabled.load() && phase.load()==Phase::ready,"capability_pending","Mouse collaboration has no current proven routing capability");
        cursorSampleCount=0; cursorTraceActive=true;
        if (!capture.load()) syncUserCursor("model_begin_sync");
        userAtModelStart=userPosition;
        lastModelCursor=userPosition;
        modelActive.store(true); capture.store(true); firstUnmatchedTick.store(0); rawWithoutHookTick.store(0);
        observeCursorBoundary("model_begin");
        idleCaptureStarted=0;
    }
    void endModel() { modelActive.store(false); observeCursorBoundary("model_end"); }
    bool ownMouseSettled() const {
        for (const auto& pending : pendingOwnRaw) if (pending.active) return false;
        for (const auto& receipt : ownReceipts) if (receipt.trustedFullTag && !receipt.consumed) return false;
        return true;
    }
    void windowDestroyed(HWND window) {
        for (const auto& entry : humanTargets) if (auto target=entry.lock()) if (target->hwnd==window) target->destroyed->store(true);
    }
    json status() const {
        const auto current=phase.load(); const auto now=GetTickCount64();
        auto cursorTrace=json::array();
        for (size_t i=0;i<cursorSampleCount;++i) {
            const auto& sample=cursorSamples[i];
            cursorTrace.push_back({{"source",sample.source},{"tick",sample.tick},{"eventTime",sample.eventTime},
                {"sampleKind",sample.hookProposed?"hook_proposed":"cursor_query"},
                {"logical",{{"x",sample.logical.x},{"y",sample.logical.y}}},
                {"observed",{{"x",sample.observed.x},{"y",sample.observed.y}}},
                {"model",{{"x",sample.model.x},{"y",sample.model.y}}},
                {"capture",sample.capturing},{"modelActive",sample.modelActive},{"phase",phaseName(sample.phase)}});
        }
        const uint64_t remaining=current==Phase::awaitingRaw && pendingDeadline>now ? pendingDeadline-now : current==Phase::probe && probeDeadline>now ? probeDeadline-now : 0;
        json diagnostics{{"mouseSnapshotReady",mouseSnapshotReady},{"snapshotReason",mouseSnapshotReason},{"snapshotMouseCount",initialMice.size()},{"allowedInitialArrivals",allowedInitialArrivals},
            {"rejectedDeviceChanges",rejectedDeviceChanges},{"ignoredOwnRawPackets",ignoredOwnRawPackets},{"preparationWaitReason",preparationWaitReason},{"restorationReason",restorationReason},
            {"lastDeviceChange",nullptr},{"lastRaw",nullptr}};
        if (hasDeviceChange) diagnostics["lastDeviceChange"]={{"change",lastChange==GIDC_ARRIVAL?"arrival":lastChange==GIDC_REMOVAL?"removal":"unknown"},
            {"deviceHandle",hex(reinterpret_cast<uintptr_t>(lastChangeHandle))},{"deviceType",deviceTypeName(lastChangeDeviceType)},{"phase",phaseName(lastChangePhase)},
            {"knownAtEnable",lastChangeKnown},{"infoVerified",lastChangeInfoVerified},{"observedAtTick64",lastChangeTick},{"reason",lastChangeReason}};
        if (hasRawSample) diagnostics["lastRaw"]={{"deviceHandle",hex(reinterpret_cast<uintptr_t>(lastRawHandle))},{"deviceType",deviceTypeName(lastRawType)},
            {"knownAtEnable",lastRawKnown},{"mouseFlags",lastRawFlags},{"buttonFlags",lastRawButtonFlags},{"absolute",(lastRawFlags&MOUSE_MOVE_ABSOLUTE)!=0},
            {"eventTime",lastRawTime},{"reason",lastRawReason},{"ownExtraInfoLow32",lastRawOwnExtraInfoLow32},{"ownReceiptMatched",lastRawOwnReceiptMatched}};
        if (hasRawSample) {
            auto samples=json::array();
            for (size_t i=0;i<lastReceiptMismatchCount;++i) {
                const auto& sample=lastReceiptMismatches[i];
                samples.push_back({{"kind",sample.kind},{"reason",sample.reason},{"shapeReason",sample.shapeReason},
                    {"timeDeltaMs",sample.timeDelta},{"ageMs",sample.age},{"consumed",sample.consumed}});
            }
            diagnostics["lastRaw"]["receiptMismatches"]=std::move(samples);
        }
        return {{"requested",requested.load()},{"enabled",enabled.load()},{"capability_pending",current==Phase::awaitingRaw || current==Phase::probe},
            {"cursorTrace",std::move(cursorTrace)},
            {"userAtModelStart",{{"x",userAtModelStart.x},{"y",userAtModelStart.y}}},
            {"lastHumanSubmission",hasHumanSubmission?json{{"x",lastHumanSubmission.x},{"y",lastHumanSubmission.y}}:json(nullptr)},
            {"failed",current==Phase::failed},{"phase",current==Phase::off?"off":current==Phase::awaitingRaw?"awaiting_relative_motion":current==Phase::probe?"probing_suppressed_raw":current==Phase::ready?"ready":"failed"},
            {"probeRemainingMs",remaining},{"suppression",current==Phase::probe || capture.load()},{"modelActive",modelActive.load()},
            {"user",{{"x",userPosition.x},{"y",userPosition.y}}},{"rawPackets",rawPackets.load()},{"suppressedMouseEvents",suppressed.load()},
            {"rawSuppressionPairs",pairedProbePackets.load()},{"queuedHumanOperations",pendingHuman.load()},{"failureCount",faults.load()},{"lastFailure",faultName(fault.load())},
            {"lastRawEventTime",lastRawTime},{"lastSuppressedEventTime",lastSuppressedTime.load()},
            {"completedHumanOperations",completedHuman.load()},{"skippedHumanOperations",skippedHuman.load()},
            {"lastHumanApplicationInputs",lastHumanApplicationInputs.load()},{"lastHumanObserveRequired",lastHumanFailure.load()!=0 && lastHumanApplicationInputs.load()>0},
            {"lastHumanFailure",lastHumanFailure.load()==0?"none":lastHumanFailure.load()==1?"intent_changed":lastHumanFailure.load()==2?"stopped_or_unroutable":lastHumanFailure.load()==3?"delivery_or_hook_unverified":"internal_failure"},
            {"physicalKeyboard","fail_open_and_stop_model"},{"rawConsumerAppsVerified",false},{"pointerAccelerationEmulated",false},{"deviceDiagnostics",diagnostics}};
    }
};
} // namespace mp
