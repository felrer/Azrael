#pragma once
#include "platform.hpp"
#include "cursor-assets.hpp"
#include "cursor-presentation.hpp"
#include <objidl.h>
#include <gdiplus.h>
#include <cmath>

namespace mp {
class CursorGraphics {
    ULONG_PTR token=0;
public:
    void start() {
        Gdiplus::GdiplusStartupInput input;
        require(Gdiplus::GdiplusStartup(&token,&input,nullptr)==Gdiplus::Ok,"overlay","Cannot start vector cursor renderer");
    }
    ~CursorGraphics() { if (token) Gdiplus::GdiplusShutdown(token); }
};
class CursorSurface {
    HDC dc=nullptr;
    HBITMAP bitmap=nullptr;
    HGDIOBJ previous=nullptr;
    void* pixels=nullptr;
    std::vector<uint32_t> blurScratch;
public:
    static constexpr int padding=16, width=144, height=88;
    int pixelWidth=0,pixelHeight=0;
    float dpiScale=1;
    explicit CursorSurface(float scale=1) : dpiScale(scale) {
        pixelWidth=static_cast<int>(std::ceil(width*scale)); pixelHeight=static_cast<int>(std::ceil(height*scale));
        BITMAPINFO info{}; info.bmiHeader.biSize=sizeof(BITMAPINFOHEADER);
        info.bmiHeader.biWidth=pixelWidth; info.bmiHeader.biHeight=-pixelHeight;
        info.bmiHeader.biPlanes=1; info.bmiHeader.biBitCount=32; info.bmiHeader.biCompression=BI_RGB;
        dc=CreateCompatibleDC(nullptr); bitmap=CreateDIBSection(nullptr,&info,DIB_RGB_COLORS,&pixels,nullptr,0);
        if (dc && bitmap) previous=SelectObject(dc,bitmap);
    }
    CursorSurface(const CursorSurface&)=delete;
    CursorSurface& operator=(const CursorSurface&)=delete;
    ~CursorSurface() {
        if (dc && previous) SelectObject(dc,previous);
        if (bitmap) DeleteObject(bitmap);
        if (dc) DeleteDC(dc);
    }
    bool valid() const { return dc && bitmap && pixels && previous && previous!=HGDI_ERROR; }
    const uint32_t* data() const { return static_cast<const uint32_t*>(pixels); }
    static Gdiplus::Color rgb(uint32_t value,float alpha=1) {
        return Gdiplus::Color(static_cast<BYTE>(std::clamp(alpha,0.f,1.f)*255+.5f),
            static_cast<BYTE>(value>>16),static_cast<BYTE>(value>>8),static_cast<BYTE>(value));
    }
    static uint32_t rgbValue(COLORREF value) { return (GetRValue(value)<<16)|(GetGValue(value)<<8)|GetBValue(value); }
    template<size_t N> static void vector(Gdiplus::Graphics& g,const std::array<cursor_assets::PathPoint,N>& input,
        uint32_t color,float alpha,float scale=1,bool model=false,bool outline=false) {
        std::array<Gdiplus::PointF,N> points{}; std::array<BYTE,N> types{};
        for (size_t i=0;i<N;++i) {
            points[i]=Gdiplus::PointF((input[i].x-(model?4.3f:0))*scale,(input[i].y-(model?2.2f:0))*scale);
            types[i]=input[i].type;
        }
        Gdiplus::GraphicsPath path(points.data(),types.data(),static_cast<INT>(N));
        Gdiplus::SolidBrush brush(rgb(color,alpha)); g.FillPath(&brush,&path);
        if (outline) {
            Gdiplus::Pen pen(rgb(0xffffff,alpha),.9f*scale); pen.SetLineJoin(Gdiplus::LineJoinRound); g.DrawPath(&pen,&path);
        }
    }
    static void roundRect(Gdiplus::Graphics& g,float x,float y,float w,float h,float r,uint32_t color,uint32_t border,float alpha) {
        Gdiplus::GraphicsPath p;
        p.AddArc(x,y,2*r,2*r,180,90); p.AddArc(x+w-2*r,y,2*r,2*r,270,90);
        p.AddArc(x+w-2*r,y+h-2*r,2*r,2*r,0,90); p.AddArc(x,y+h-2*r,2*r,2*r,90,90); p.CloseFigure();
        Gdiplus::SolidBrush b(rgb(color,alpha)); Gdiplus::Pen pen(rgb(border,alpha),.7f);
        g.FillPath(&b,&p); g.DrawPath(&pen,&p);
    }
    bool draw(bool user,COLORREF color,const CursorFrame& frame,bool ghost=false,HICON ordinary=nullptr) {
        if (!valid()) return false;
        auto f=frame; f.alpha=1;
        Gdiplus::Bitmap target(pixelWidth,pixelHeight,pixelWidth*4,PixelFormat32bppPARGB,static_cast<BYTE*>(pixels));
        Gdiplus::Graphics g(&target);
        g.SetCompositingMode(Gdiplus::CompositingModeSourceCopy); g.Clear(Gdiplus::Color(0,0,0,0));
        g.SetCompositingMode(Gdiplus::CompositingModeSourceOver);
        g.SetSmoothingMode(Gdiplus::SmoothingModeAntiAlias); g.SetPixelOffsetMode(Gdiplus::PixelOffsetModeHalf);
        g.SetTextRenderingHint(Gdiplus::TextRenderingHintAntiAliasGridFit);
        g.ScaleTransform(dpiScale,dpiScale); g.TranslateTransform(padding,padding);
        if (user && f.ordinary>0 && ordinary) {
            std::unique_ptr<Gdiplus::Bitmap> icon(Gdiplus::Bitmap::FromHICON(ordinary));
            if (icon && icon->GetLastStatus()==Gdiplus::Ok) {
                Gdiplus::ColorMatrix matrix={1,0,0,0,0, 0,1,0,0,0, 0,0,1,0,0, 0,0,0,f.ordinary,0, 0,0,0,0,1};
                Gdiplus::ImageAttributes attributes; attributes.SetColorMatrix(&matrix);
                g.DrawImage(icon.get(),Gdiplus::RectF(0,0,32,32),0,0,static_cast<float>(icon->GetWidth()),static_cast<float>(icon->GetHeight()),Gdiplus::UnitPixel,&attributes);
            }
        }
        g.ScaleTransform(f.scale,f.scale);
        const uint32_t body=rgbValue(color);
        auto glyph=[&](float weight) {
            const auto bodyState=g.Save(); g.ScaleTransform(f.arrowScale,f.arrowScale);
            if (user) { vector(g,cursor_assets::userOuter,0x10131c,f.alpha*f.arrow*weight); vector(g,cursor_assets::userInner,0xffffff,f.alpha*f.arrow*weight); }
            else vector(g,cursor_assets::modelBody,body,f.alpha*f.arrow*weight,2,true,true);
            g.Restore(bodyState);
            Gdiplus::SolidBrush dot(rgb(user?0xffffff:body,f.alpha*(user?f.seed:f.dot)*weight));
            if (user) g.FillEllipse(&dot,-3.f,-3.f,6.f,6.f);
            else { Gdiplus::Pen edge(rgb(0xffffff,f.alpha*f.dot*weight),1.4f); g.FillEllipse(&dot,-5.f,-5.f,10.f,10.f); g.DrawEllipse(&edge,-5.f,-5.f,10.f,10.f); }
        };
        glyph(1);
        if (!ghost) {
            uint32_t paper=0xffffff,ink=0x333d35,border=0xd6dbd5;
            if (!user) {
                // Any of the 72 registered body colors keeps its own family label.
                bool matched=false;
                for (const auto& family : cursor_assets::palette) {
                    if (body==family.bright || body==family.pastel || body==family.deep || body==family.clear || body==family.porcelain || body==family.luminous) {
                        paper=family.pastel; ink=family.clear; border=family.clear; matched=true; break;
                    }
                }
                if (!matched) {
                    auto blend=[&](float amount,unsigned targetByte) { uint32_t result=0; for (int shift : {16,8,0}) result|=static_cast<uint32_t>(std::lround(((body>>shift)&255)*(1-amount)+targetByte*amount))<<shift; return result; };
                    paper=blend(.88f,255); ink=blend(.6f,0); border=blend(.55f,255);
                }
            }
            const float x=user?14.f:26.f,y=user?21.f:34.f,w=user?56.f:48.f;
            const float alpha=f.alpha*f.label;
            roundRect(g,x,y,w,23,7,paper,border,alpha);
            Gdiplus::FontFamily family(L"Malgun Gothic"); Gdiplus::Font font(&family,12,Gdiplus::FontStyleRegular,Gdiplus::UnitPixel);
            Gdiplus::SolidBrush text(rgb(ink,alpha));
            g.DrawString(user?L"사용자":L"모델",-1,&font,Gdiplus::PointF(x+9,y+3),&text);
            if (user && f.waiting>0) {
                const float a=f.alpha*f.waiting;
                roundRect(g,18,5,18,18,4,0xffffff,0xd6dbd5,a);
                Gdiplus::Pen pen(rgb(0x333d35,a),1.2f);
                g.DrawRectangle(&pen,22.f,8.f,10.f,11.f); g.DrawRectangle(&pen,24.f,8.f,6.f,4.f); g.DrawRectangle(&pen,24.f,15.f,6.f,4.f);
            }
        }
        g.Flush(Gdiplus::FlushIntentionSync);
        if (g.GetLastStatus()!=Gdiplus::Ok || target.GetLastStatus()!=Gdiplus::Ok) return false;
        auto data=static_cast<uint32_t*>(pixels); const size_t count=static_cast<size_t>(pixelWidth)*pixelHeight;
        if (ghost) {
            // Blur the completed premultiplied glyph, without a label or moving
            // its origin. A cached small kernel avoids an extra graphics API.
            blurScratch.assign(data,data+count);
            const int step=std::max(1,static_cast<int>(std::lround(.55f*dpiScale)));
            for (int y=step;y<pixelHeight-step;++y) for (int x=step;x<pixelWidth-step;++x) {
                const int p=y*pixelWidth+x; uint32_t value=0;
                for (int shift : {0,8,16,24}) {
                    const unsigned sum=((blurScratch[p]>>shift)&255)*8+
                        (((blurScratch[p-step]>>shift)&255)+((blurScratch[p+step]>>shift)&255)+
                        ((blurScratch[p-step*pixelWidth]>>shift)&255)+((blurScratch[p+step*pixelWidth]>>shift)&255))*3;
                    value|=((sum+10)/20)<<shift;
                }
                data[p]=value;
            }
        }
        // SVG group opacity applies after composing fill, border and label.
        // Applying it to every primitive makes overlapping borders too opaque.
        const unsigned opacity=static_cast<unsigned>(std::clamp(frame.alpha,0.f,1.f)*255+.5f);
        if (opacity!=255) for (size_t p=0;p<count;++p) {
            const auto pixel=data[p]; uint32_t value=0;
            for (int shift : {0,8,16,24}) value|=((((pixel>>shift)&255)*opacity+127)/255)<<shift;
            data[p]=value;
        }
        return true;
    }
    POINT origin(POINT hotspot) const {
        const LONG pad=static_cast<LONG>(std::lround(padding*dpiScale)); return {hotspot.x-pad,hotspot.y-pad};
    }
    bool present(HWND hwnd,POINT hotspot) const {
        auto p=origin(hotspot); SIZE size{pixelWidth,pixelHeight}; POINT source{};
        BLENDFUNCTION blend{AC_SRC_OVER,0,255,AC_SRC_ALPHA};
        return UpdateLayeredWindow(hwnd,nullptr,&p,&size,dc,&source,0,&blend,ULW_ALPHA)!=FALSE;
    }
    static bool saveBitmapPng(Gdiplus::Bitmap& target,const std::wstring& file) {
        UINT count=0,bytes=0; if (Gdiplus::GetImageEncodersSize(&count,&bytes)!=Gdiplus::Ok || !bytes) return false;
        std::vector<BYTE> buffer(bytes); auto codecs=reinterpret_cast<Gdiplus::ImageCodecInfo*>(buffer.data());
        if (Gdiplus::GetImageEncoders(count,bytes,codecs)!=Gdiplus::Ok) return false;
        for (UINT i=0;i<count;++i) if (std::wstring(codecs[i].MimeType)==L"image/png") return target.Save(file.c_str(),&codecs[i].Clsid)==Gdiplus::Ok;
        return false;
    }
    bool savePng(const std::wstring& file) {
        Gdiplus::Bitmap target(pixelWidth,pixelHeight,pixelWidth*4,PixelFormat32bppPARGB,static_cast<BYTE*>(pixels));
        return saveBitmapPng(target,file);
    }
};
} // namespace mp
