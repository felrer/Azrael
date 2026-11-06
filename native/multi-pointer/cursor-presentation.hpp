#pragma once
#include <algorithm>
#include <cstdint>
#include <cmath>

namespace mp {
// Presentation has no input or position side effects. All times are monotonic ms.
struct CursorTween {
    float from = 0, to = 0;
    uint64_t began = 0, duration = 0;
    float value(uint64_t now) const {
        const float t = duration ? std::clamp(static_cast<float>(now - std::min(now,began)) / duration,0.f,1.f) : 1.f;
        const float ease = t*t*(3-2*t);
        return from+(to-from)*ease;
    }
    void set(float target, uint64_t now, uint64_t ms) {
        if (to==target) return;
        from=value(now); to=target; began=now; duration=ms;
    }
};
struct CursorFrame {
    float alpha=1, scale=1, arrow=1, arrowScale=1, dot=0, label=1;
    float ordinary=0, seed=0, waiting=0;
    bool operator==(const CursorFrame& b) const {
        return alpha==b.alpha && scale==b.scale && arrow==b.arrow && arrowScale==b.arrowScale && dot==b.dot &&
            label==b.label && ordinary==b.ordinary && seed==b.seed && waiting==b.waiting;
    }
};
class CursorPresentation {
    bool user, reduced;
    uint64_t born, entered=0, exitAt=0, clickAt=0;
    bool exiting=false, didEnter=false, clicked=false;
    CursorTween activity, drag, waiting;
    static float progress(uint64_t now,uint64_t start,uint64_t duration) {
        const float t=std::clamp(static_cast<float>(now-std::min(now,start))/duration,0.f,1.f);
        return t*t*(3-2*t);
    }
public:
    CursorPresentation(bool isUser,uint64_t now,bool reduce=false) : user(isUser), reduced(reduce), born(now) {
        activity.from=activity.to=.32f;
    }
    void enter(uint64_t now) { if (!didEnter) { entered=now; didEnter=true; } }
    void setWaiting(bool value,uint64_t now) { waiting.set(value?1.f:0.f,now,reduced?0:120); }
    void setActive(bool active,bool dragging,uint64_t now) {
        activity.set(active?1.f:.32f,now,reduced?0:200);
        drag.set(dragging?1.f:0.f,now,reduced?0:(dragging?180:140));
    }
    void click(uint64_t now) { clicked=true; clickAt=now; }
    void exit(uint64_t now) { if (!exiting) { exiting=true; exitAt=now; } }
    bool expired(uint64_t now) const { return exiting && (reduced || now-exitAt>=220); }
    CursorFrame frame(uint64_t now) const {
        CursorFrame f;
        const float exitLife=exiting?(reduced?0.f:1-progress(now,exitAt,220)):1.f;
        f.scale=.55f+.45f*exitLife;
        if (user) {
            const float on=didEnter?(reduced?1.f:progress(now,entered,550)):0.f;
            const float grow=didEnter?(reduced?1.f:progress(now,entered,380)):0.f;
            f.alpha=exitLife; f.arrow=on*grow; f.arrowScale=.02f+.98f*grow;
            f.label=on; f.ordinary=didEnter?1-on:0.f;
            f.seed=didEnter&&!reduced?1-progress(now,entered,240):0.f;
            f.waiting=waiting.value(now)*on;
        } else {
            const float life=reduced?1.f:progress(now,born,240);
            const float dot=drag.value(now);
            f.alpha=life*activity.value(now)*exitLife;
            f.arrow=1-dot; f.arrowScale=1-.82f*dot; f.dot=dot;
            f.label=1-.4f*dot;
            if (clicked && !reduced && now-clickAt<280) {
                const float pulse=1-std::abs(static_cast<float>(now-clickAt)-140)/140;
                f.scale*=1-.1f*pulse;
            }
        }
        return f;
    }
    static float ghostAlpha(uint64_t now,uint64_t began,bool reduced=false) {
        return reduced?0.f:.24f*(1-progress(now,began,180));
    }
};
} // namespace mp
