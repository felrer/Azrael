#include "raw-origin.hpp"
#include <cstdio>
#include <cstring>

int main() {
    int failures=0,checks=0;
    auto check=[&](bool actual,bool expected,const char* name) { ++checks; if (actual!=expected) { ++failures; std::fprintf(stderr,"FAIL: %s\n",name); } };
    constexpr ULONG_PTR tag=0x1234567;
    const mp::RawDesktop desktop{-1920,0,5760,2160};
    mp::OwnMouseReceipt receipt; receipt.trustedFullTag=true; receipt.injected=true; receipt.message=WM_MOUSEMOVE;
    receipt.time=1000; receipt.observedTick=2000; receipt.point={33,25};
    RAWINPUT move{}; move.header.dwType=RIM_TYPEMOUSE; move.data.mouse.usFlags=MOUSE_MOVE_ABSOLUTE|MOUSE_VIRTUAL_DESKTOP;
    move.data.mouse.ulExtraInformation=static_cast<ULONG>(tag);
    move.data.mouse.lLastX=static_cast<LONG>(((static_cast<int64_t>(receipt.point.x)-desktop.x)*65536+32768)/desktop.width);
    move.data.mouse.lLastY=static_cast<LONG>(((static_cast<int64_t>(receipt.point.y)-desktop.y)*65536+32768)/desktop.height);
    auto matches=[&](const RAWINPUT& raw,const mp::OwnMouseReceipt& r,DWORD time=1000,uint64_t now=2001) { return mp::matchesOwnRawMouse(raw,time,now,tag,r,desktop); };
    check(matches(move,receipt),true,"own absolute move with negative desktop origin");
    auto raw=move; raw.header.hDevice=reinterpret_cast<HANDLE>(1); check(matches(raw,receipt),false,"physical-device packet never ignored");
    raw=move; raw.data.mouse.ulExtraInformation=0; check(matches(raw,receipt),false,"zero extra-info marker rejected");
    raw=move; raw.data.mouse.ulExtraInformation=static_cast<ULONG>(tag)+1; check(matches(raw,receipt),false,"foreign marker rejected");
    auto r=receipt; r.trustedFullTag=false; check(matches(move,r),false,"low32 marker without full-width trusted receipt rejected");
    r=receipt; r.injected=false; check(matches(move,r),false,"uninjected receipt rejected");
    r=receipt; r.consumed=true; check(matches(move,r),false,"receipt cannot consume two packets");
    check(matches(move,receipt,1000,2101),false,"expired receipt rejected");
    check(matches(move,receipt,1000,1999),false,"future receipt rejected");
    check(matches(move,receipt,1003),false,"event-time mismatch rejected");
    check(matches(move,receipt,999),true,"bounded one-ms event-time skew");
    r=receipt; r.time=0xfffffffeUL; check(matches(move,r,0),true,"DWORD event-time wrap");
    r=receipt; ++r.point.x; check(matches(move,r),false,"absolute point mismatch rejected");
    raw=move; raw.data.mouse.usButtonFlags=RI_MOUSE_LEFT_BUTTON_DOWN; check(matches(raw,receipt),false,"move cannot consume button packet");
    raw=move; raw.data.mouse.usFlags=0; check(matches(raw,receipt),false,"relative motion cannot impersonate own absolute move");
    raw=move; raw.data.mouse.usFlags|=MOUSE_ATTRIBUTES_CHANGED; check(matches(raw,receipt),false,"unexpected own packet flags rejected");
    RAWINPUT button{}; button.header.dwType=RIM_TYPEMOUSE; button.data.mouse.ulExtraInformation=static_cast<ULONG>(tag);
    button.data.mouse.usButtonFlags=RI_MOUSE_LEFT_BUTTON_DOWN; r=receipt; r.message=WM_LBUTTONDOWN;
    check(matches(button,r),true,"own relative button-only packet");
    button.data.mouse.usButtonFlags|=RI_MOUSE_LEFT_BUTTON_UP; check(matches(button,r),false,"combined button transitions rejected");
    button.data.mouse.usButtonFlags=RI_MOUSE_RIGHT_BUTTON_UP; r.message=WM_RBUTTONUP; check(matches(button,r),true,"own right-button release");
    button.data.mouse.usButtonFlags=RI_MOUSE_MIDDLE_BUTTON_DOWN; r.message=WM_MBUTTONDOWN; check(matches(button,r),true,"own middle-button down");
    button.data.mouse.usButtonFlags=RI_MOUSE_WHEEL; button.data.mouse.usButtonData=static_cast<USHORT>(static_cast<SHORT>(-120));
    r.message=WM_MOUSEWHEEL; r.mouseData=static_cast<DWORD>(static_cast<USHORT>(static_cast<SHORT>(-120)))<<16;
    check(matches(button,r),true,"own negative wheel delta");
    button.data.mouse.usButtonData=120; check(matches(button,r),false,"wheel delta mismatch rejected");
    raw=move; raw.header.dwType=RIM_TYPEKEYBOARD; check(matches(raw,receipt),false,"non-mouse packet never classified");
    check(mp::matchesOwnRawMouse(move,1000,2001,0x100000001ULL,receipt,desktop),false,"out-of-contract marker width rejected");
    // Diagnostics call the same predicate as acceptance, including left-up.
    auto reason=[&](const RAWINPUT& packet,const mp::OwnMouseReceipt& candidate,const char* expected,DWORD time=1000,uint64_t now=2001) {
        const auto actual=mp::ownRawMouseMismatch(packet,time,now,tag,candidate,desktop);
        check(actual && std::strcmp(actual,expected)==0,true,expected);
    };
    button.data.mouse.usButtonFlags=RI_MOUSE_LEFT_BUTTON_UP; button.data.mouse.usButtonData=0;
    r=receipt; r.message=WM_LBUTTONUP;
    check(matches(button,r),true,"own left-up remains accepted");
    reason(button,r,"time_delta",1003);
    reason(button,r,"age",1000,2101);
    auto consumed=r; consumed.consumed=true; reason(button,consumed,"consumed");
    button.data.mouse.lLastX=1; reason(button,r,"relative_delta_nonzero");
    button.data.mouse.lLastX=0; button.data.mouse.usButtonData=1; reason(button,r,"data");
    button.data.mouse.usButtonData=0; button.data.mouse.usButtonFlags=RI_MOUSE_LEFT_BUTTON_DOWN; reason(button,r,"button_kind");
    button.data.mouse.usButtonFlags=RI_MOUSE_LEFT_BUTTON_UP; button.data.mouse.usFlags=MOUSE_ATTRIBUTES_CHANGED; reason(button,r,"flags");
    button.data.mouse.usFlags=0; button.data.mouse.ulExtraInformation=0; reason(button,r,"tag");
    std::printf("raw-origin: %d checks, %d failures\n",checks,failures);
    return failures ? 1 : 0;
}
