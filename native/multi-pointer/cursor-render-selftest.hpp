#pragma once
#include "cursor-renderer.hpp"

namespace mp {
// Non-actuating test of the actual native painter. No hooks, routing, cursor
// visibility changes, foreground activation or target application are involved.
inline int cursorRenderSelftest(const std::wstring& directory) {
    const auto dir=std::filesystem::path(directory);
    require(dir.is_absolute() && std::filesystem::is_directory(dir),"selftest","Existing absolute output directory required");
    const auto output=dir/L"cursor-frames.png";
    require(!std::filesystem::exists(output),"selftest","Refusing to overwrite render evidence");
    POINT before{}; require(GetCursorPos(&before)!=FALSE,"selftest","Cannot observe cursor");
    const HWND foreground=GetForegroundWindow();
    CursorGraphics session; session.start();
    unsigned checks=0;
    auto check=[&](bool ok,const char* reason) { require(ok,"selftest",reason); ++checks; };
    CursorPresentation user(true,1000); user.enter(1000);
    auto ready=user.frame(1600); check(ready.alpha==1 && ready.arrow==1 && ready.ordinary==0,"User transition did not settle");
    user.setWaiting(true,1600); auto waiting=user.frame(1720);
    check(waiting.waiting==1 && waiting.arrow==ready.arrow && waiting.alpha==ready.alpha,"Waiting must only add an icon");
    CursorPresentation model(false,1000); model.setActive(true,false,1000);
    auto active=model.frame(1600); check(active.alpha==1 && active.arrow==1,"Model active shape did not settle");
    model.setActive(true,true,1600); auto drag=model.frame(1780);
    check(drag.dot==1 && drag.arrow==0 && drag.arrowScale<.2f,"Drag must fade/shrink in place to a dot");
    model.setActive(false,false,1800); auto idle=model.frame(2100);
    check(std::abs(idle.alpha-.32f)<.0001f && idle.arrow==1 && idle.dot==0,"Idle must restore translucent arrow");
    model.exit(2200); auto exiting=model.frame(2310);
    check(exiting.alpha>0 && exiting.alpha<idle.alpha && exiting.scale<1,"Exit must shrink and fade");
    check(model.expired(2420),"Exit retirement did not finish");
    check(CursorPresentation::ghostAlpha(1000,1000)==.24f && CursorPresentation::ghostAlpha(1180,1000)==0,"Ghost lifetime must be bounded to 180ms");
    CursorPresentation reduced(true,1000,true); reduced.enter(1000);
    check(reduced.frame(1000).arrow==1 && reduced.frame(1000).seed==0,"Reduced motion must skip growth");
    check(CursorPresentation::ghostAlpha(1000,1000,true)==0,"Reduced motion must suppress ghost");
    CursorPresentation entry(true,1000); entry.enter(1000);
    auto entering=entry.frame(1190);
    struct Scene { const wchar_t* name; bool user; CursorFrame frame; bool ghost=false; };
    auto ghost=active; ghost.alpha=.24f;
    const Scene scenes[]{{L"User",true,ready},{L"User / queued",true,waiting},{L"Model / active",false,active},
        {L"Model / drag",false,drag},{L"Model / idle",false,idle},{L"Teleport remnant",false,ghost,true},
        {L"Model / exit",false,exiting},{L"User / enter",true,entering}};
    Gdiplus::Bitmap sheet(928,680,PixelFormat32bppPARGB); Gdiplus::Graphics paper(&sheet);
    Gdiplus::FontFamily family(L"Segoe UI"); Gdiplus::Font font(&family,13,Gdiplus::FontStyleRegular,Gdiplus::UnitPixel);
    for (unsigned theme=0;theme<2;++theme) for (unsigned i=0;i<8;++i) {
        const int x=(i%4)*232,y=theme*340+(i/4)*170;
        Gdiplus::SolidBrush background(CursorSurface::rgb(theme?0x202124:0xf5f5f4)); paper.FillRectangle(&background,x,y,232,170);
        Gdiplus::SolidBrush ink(CursorSurface::rgb(theme?0xeeeeee:0x333333)); paper.DrawString(scenes[i].name,-1,&font,Gdiplus::PointF(static_cast<float>(x+12),static_cast<float>(y+12)),&ink);
        CursorSurface surface(1.5f);
        check(surface.draw(scenes[i].user,RGB(56,189,248),scenes[i].frame,scenes[i].ghost,LoadCursorW(nullptr,IDC_ARROW)),"Native frame rendering failed");
        Gdiplus::Bitmap bitmap(surface.pixelWidth,surface.pixelHeight,surface.pixelWidth*4,PixelFormat32bppPARGB,
            reinterpret_cast<BYTE*>(const_cast<uint32_t*>(surface.data())));
        paper.DrawImage(&bitmap,x+8,y+32);
        check(surface.data()[0]==0,"Surface background must be transparent");
        bool premultiplied=true;
        unsigned maxAlpha=0;
        for (int p=0;p<surface.pixelWidth*surface.pixelHeight;++p) {
            const auto pixel=surface.data()[p],a=pixel>>24;
            maxAlpha=std::max(maxAlpha,a);
            if (((pixel>>16)&255)>a || ((pixel>>8)&255)>a || (pixel&255)>a) premultiplied=false;
        }
        check(premultiplied,"Layered surface must be premultiplied alpha");
        check(maxAlpha<=static_cast<unsigned>(scenes[i].frame.alpha*255+.5f),"Composed border/label must not exceed whole-cursor opacity");
    }
    paper.Flush(Gdiplus::FlushIntentionSync);
    check(CursorSurface::saveBitmapPng(sheet,output.wstring()),"Cannot save native rendered frames");
    // Probe the real layered-window upload and physical hotspot anchoring while
    // keeping the window hidden; a bitmap alone would not cover this boundary.
    WNDCLASSW wc{}; wc.lpfnWndProc=DefWindowProcW; wc.hInstance=GetModuleHandleW(nullptr); wc.lpszClassName=L"AzraelCursorRenderSelftest";
    check(RegisterClassW(&wc)!=0,"Cannot register test window");
    HWND window=CreateWindowExW(WS_EX_LAYERED|WS_EX_TRANSPARENT|WS_EX_NOACTIVATE|WS_EX_TOOLWINDOW,wc.lpszClassName,L"",WS_POPUP,0,0,1,1,nullptr,nullptr,wc.hInstance,nullptr);
    check(window!=nullptr,"Cannot create hidden layered window");
    bool uploaded=true;
    for (float dpi : {1.f,1.5f,2.f}) {
        CursorSurface surface(dpi); const POINT hotspot{200,200};
        uploaded=uploaded && surface.draw(true,RGB(255,255,255),ready) && surface.present(window,hotspot);
        RECT rect{}; uploaded=uploaded && GetWindowRect(window,&rect) && rect.left==surface.origin(hotspot).x && rect.top==surface.origin(hotspot).y;
    }
    const auto styles=GetWindowLongPtrW(window,GWL_EXSTYLE);
    DestroyWindow(window); UnregisterClassW(wc.lpszClassName,wc.hInstance);
    check(uploaded,"Layered upload / DPI hotspot anchoring failed");
    check((styles&(WS_EX_TRANSPARENT|WS_EX_NOACTIVATE))==(WS_EX_TRANSPARENT|WS_EX_NOACTIVATE),"Overlay must remain click-through and nonactivating");
    POINT after{}; check(GetCursorPos(&after)!=FALSE,"Cannot observe final cursor");
    // Physical user motion can change the OS pointer while this non-actuating
    // test runs. Record observations; never relocate it to force a passing test.
    json result{{"kind","cursor-render-selftest"},{"checks",checks},{"applicationInputs",0},{"cursorVisibilityChanged",false},
        {"foregroundUnchanged",foreground==GetForegroundWindow()},{"pointerObservedBefore",{{"x",before.x},{"y",before.y}}},
        {"pointerObservedAfter",{{"x",after.x},{"y",after.y}}},{"previewSha256",cursor_assets::previewSha256},{"frames",utf8(output.wstring())}};
    const auto line=result.dump()+"\n"; DWORD written=0; WriteFile(GetStdHandle(STD_OUTPUT_HANDLE),line.data(),static_cast<DWORD>(line.size()),&written,nullptr);
    return 0;
}
} // namespace mp
