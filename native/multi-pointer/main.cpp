#include "broker.hpp"
#include "cursor-render-selftest.hpp"
#include <bcrypt.h>

int wmain(int argc, wchar_t** argv) {
    try {
        if (argc>1 && std::wstring(argv[1])==L"--cursor-guard") return mp::SystemCursor::guardMain(argc,argv);
        if (argc==2 && std::wstring(argv[1])==L"--cursor-guard-selftest") return mp::SystemCursor::selftest();
        if (argc==2 && std::wstring(argv[1])==L"--cursor-visibility-probe") return mp::SystemCursor::visibilityProbe();
        if (argc==2 && std::wstring(argv[1])==L"--cursor-guard-selftest-victim") { Sleep(INFINITE); return 0; }
        if (argc==3 && std::wstring(argv[1])==L"--cursor-render-selftest") {
            mp::require(SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)!=FALSE,"dpi","Per-monitor-v2 DPI awareness is required");
            return mp::cursorRenderSelftest(argv[2]);
        }
        mp::require(argc == 3 && std::wstring(argv[1]) == L"--targets", "usage", "Usage: azrael-multi-pointer.exe --targets <absolute-json-file>");
        mp::require(SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) != FALSE,
            "dpi", "Per-monitor-v2 physical-pixel DPI awareness is required");
        auto targets=mp::loadTargets(argv[2]); mp::Signals signals;
        DWORD marker = 0;
        mp::require(BCryptGenRandom(nullptr,reinterpret_cast<PUCHAR>(&marker),static_cast<ULONG>(sizeof(marker)),BCRYPT_USE_SYSTEM_PREFERRED_RNG)>=0,
            "random", "Cannot generate private injected-event tag");
        marker &= 0x7fffffffUL;
        mp::require(marker != 0, "random", "Generated injected-event tag was zero");
        signals.tag = static_cast<ULONG_PTR>(marker);
        mp::Ui ui(signals,targets); ui.start();
        for (const auto& target : targets) target.validate();
        mp::Broker broker(signals,ui,targets); int workerExit=1;
        std::thread worker([&] { workerExit=broker.run(); });
        const int uiExit=ui.loop();
        if (uiExit) { signals.disconnected.store(true); signals.epoch.fetch_add(1); }
        worker.join();
        return uiExit ? uiExit : workerExit;
    } catch (const std::exception& e) {
        mp::diagnostic("ERROR","startup_failed");
        const auto* failure=dynamic_cast<const mp::Failure*>(&e);
        const mp::json response{{"id",nullptr},{"error",{{"code",failure?failure->code:"startup_failed"},
            {"message",failure?failure->what():"Invalid target file or startup failure"},{"actionExecuted",false}}}};
        const auto line=response.dump()+"\n"; DWORD written=0;
        WriteFile(GetStdHandle(STD_OUTPUT_HANDLE),line.data(),static_cast<DWORD>(line.size()),&written,nullptr);
        return 1;
    }
}
