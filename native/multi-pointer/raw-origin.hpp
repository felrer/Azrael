#pragma once
#include <windows.h>
#include <cstdint>

namespace mp {
struct OwnMouseReceipt {
    bool trustedFullTag = false, injected = false, consumed = false;
    UINT message = 0;
    DWORD time = 0, mouseData = 0;
    uint64_t observedTick = 0;
    POINT point{};
};
struct RawDesktop { LONG x = 0, y = 0; int width = 0, height = 0; };

// Pure classifier. A receipt is produced only by an exact full-ULONG_PTR own-tag
// low-level hook observation; low32 equality alone never proves raw origin.
inline const char* ownRawMouseMismatch(const RAWINPUT& raw, DWORD rawTime, uint64_t now, ULONG_PTR ownTag,
    const OwnMouseReceipt& receipt, const RawDesktop& desktop) noexcept {
    if (raw.header.dwType!=RIM_TYPEMOUSE) return "raw_kind";
    if (raw.header.hDevice) return "physical_device";
    if (!ownTag || ownTag>0x7fffffffULL) return "tag_width";
    if (!receipt.trustedFullTag || !receipt.injected) return "untrusted_receipt";
    if (receipt.consumed) return "consumed";
    if (now<receipt.observedTick) return "future_receipt";
    if (now-receipt.observedTick>100) return "age";
    const auto& mouse=raw.data.mouse;
    if (mouse.ulExtraInformation!=static_cast<ULONG>(ownTag)) return "tag";
    const auto timeDelta=static_cast<int32_t>(rawTime-receipt.time);
    if (timeDelta < -2 || timeDelta > 2) return "time_delta";
    constexpr USHORT allowedFlags=MOUSE_MOVE_ABSOLUTE|MOUSE_VIRTUAL_DESKTOP|MOUSE_MOVE_NOCOALESCE;
    if (mouse.usFlags & static_cast<USHORT>(~allowedFlags)) return "flags";
    const bool absolute=(mouse.usFlags&MOUSE_MOVE_ABSOLUTE)!=0;
    if (absolute) {
        if (!(mouse.usFlags&MOUSE_VIRTUAL_DESKTOP) || desktop.width<2 || desktop.height<2 || desktop.width>32768 || desktop.height>32768 ||
            mouse.lLastX<0 || mouse.lLastX>65535 || mouse.lLastY<0 || mouse.lLastY>65535) return "absolute_shape";
        const int64_t x=static_cast<int64_t>(desktop.x)+static_cast<int64_t>(mouse.lLastX)*desktop.width/65536;
        const int64_t y=static_cast<int64_t>(desktop.y)+static_cast<int64_t>(mouse.lLastY)*desktop.height/65536;
        if (x!=receipt.point.x || y!=receipt.point.y) return "point";
    } else {
        if (mouse.usFlags&MOUSE_VIRTUAL_DESKTOP) return "flags";
        if (mouse.lLastX!=0 || mouse.lLastY!=0) return "relative_delta_nonzero";
    }
    USHORT expected=0;
    switch (receipt.message) {
    case WM_MOUSEMOVE: return !absolute ? "move_kind" : mouse.usButtonFlags!=0 ? "button_kind" : mouse.usButtonData!=0 ? "data" : nullptr;
    case WM_LBUTTONDOWN: expected=RI_MOUSE_LEFT_BUTTON_DOWN; break;
    case WM_LBUTTONUP: expected=RI_MOUSE_LEFT_BUTTON_UP; break;
    case WM_RBUTTONDOWN: expected=RI_MOUSE_RIGHT_BUTTON_DOWN; break;
    case WM_RBUTTONUP: expected=RI_MOUSE_RIGHT_BUTTON_UP; break;
    case WM_MBUTTONDOWN: expected=RI_MOUSE_MIDDLE_BUTTON_DOWN; break;
    case WM_MBUTTONUP: expected=RI_MOUSE_MIDDLE_BUTTON_UP; break;
    case WM_MOUSEWHEEL: return mouse.usButtonFlags!=RI_MOUSE_WHEEL ? "button_kind" :
        static_cast<SHORT>(mouse.usButtonData)!=static_cast<SHORT>(HIWORD(receipt.mouseData)) ? "data" : nullptr;
    default: return "receipt_kind";
    }
    return mouse.usButtonFlags!=expected ? "button_kind" : mouse.usButtonData!=0 ? "data" : nullptr;
}
inline bool matchesOwnRawMouse(const RAWINPUT& raw, DWORD rawTime, uint64_t now, ULONG_PTR ownTag,
    const OwnMouseReceipt& receipt, const RawDesktop& desktop) noexcept {
    return ownRawMouseMismatch(raw,rawTime,now,ownTag,receipt,desktop)==nullptr;
}
inline const char* ownMouseReceiptKind(UINT message) noexcept {
    switch (message) {
    case WM_MOUSEMOVE: return "move";
    case WM_LBUTTONDOWN: return "left_down";
    case WM_LBUTTONUP: return "left_up";
    case WM_RBUTTONDOWN: return "right_down";
    case WM_RBUTTONUP: return "right_up";
    case WM_MBUTTONDOWN: return "middle_down";
    case WM_MBUTTONUP: return "middle_up";
    case WM_MOUSEWHEEL: return "wheel";
    default: return "unknown";
    }
}
} // namespace mp
