#pragma once
#include "platform.hpp"
#include <magnification.h>

namespace mp {
// Only the independent guard calls Magnification: a broker/UI stall cannot
// prevent its heartbeat watchdog from restoring the desktop cursor.
class SystemCursor {
    struct alignas(8) Shared {
        volatile LONG command = 0, hidden = 0, error = 0, supported = 0, recovered = 0;
        alignas(8) volatile LONG64 heartbeat = 0;
    };
    Handle mapping, request, ack, child;
    Shared* shared = nullptr;
    DWORD localError = 0;
    bool attempted = false;
    uint64_t visibilityCommands = 0;
    static LONG read(volatile LONG& value) { return InterlockedCompareExchange(&value,0,0); }
    static DWORD failure() { const DWORD error=GetLastError(); return error ? error : ERROR_GEN_FAILURE; }
    static std::wstring argument(HANDLE value) { return std::to_wstring(reinterpret_cast<uintptr_t>(value)); }
    bool exchange(LONG command) {
        if (!shared || !child.value || WaitForSingleObject(child.value,0)!=WAIT_TIMEOUT) { localError=ERROR_PROCESS_ABORTED; return false; }
        ++visibilityCommands;
        ResetEvent(ack.value); InterlockedExchange(&shared->command,command);
        InterlockedExchange64(&shared->heartbeat,static_cast<LONG64>(GetTickCount64()));
        if (!SetEvent(request.value)) { localError=failure(); return false; }
        HANDLE waits[]{child.value,ack.value};
        if (WaitForMultipleObjects(2,waits,FALSE,750)!=WAIT_OBJECT_0+1) { localError=ERROR_TIMEOUT; return false; }
        if (read(shared->error)) { localError=static_cast<DWORD>(read(shared->error)); return false; }
        return read(shared->hidden)==(command==1 ? 1 : 0);
    }
    bool start(HANDLE watchedParent=nullptr) {
        if (attempted) return shared && child.value && !localError && WaitForSingleObject(child.value,0)==WAIT_TIMEOUT;
        attempted=true;
        SECURITY_ATTRIBUTES sa{sizeof(sa),nullptr,TRUE};
        mapping=Handle(CreateFileMappingW(INVALID_HANDLE_VALUE,&sa,PAGE_READWRITE,0,sizeof(Shared),nullptr));
        request=Handle(CreateEventW(&sa,FALSE,FALSE,nullptr)); ack=Handle(CreateEventW(&sa,TRUE,FALSE,nullptr));
        Handle parent;
        if (watchedParent) {
            HANDLE duplicate=nullptr;
            if (DuplicateHandle(GetCurrentProcess(),watchedParent,GetCurrentProcess(),&duplicate,SYNCHRONIZE,TRUE,0)) parent=Handle(duplicate);
        } else parent=Handle(OpenProcess(SYNCHRONIZE,TRUE,GetCurrentProcessId()));
        if (!mapping.value || !request.value || !ack.value || !parent.value) { localError=failure(); return false; }
        shared=static_cast<Shared*>(MapViewOfFile(mapping.value,FILE_MAP_ALL_ACCESS,0,0,sizeof(Shared)));
        if (!shared) { localError=failure(); return false; }
        InterlockedExchange64(&shared->heartbeat,static_cast<LONG64>(GetTickCount64()));
        wchar_t executable[32768]{};
        const DWORD length=GetModuleFileNameW(nullptr,executable,32768);
        if (!length || length>=32768) { localError=ERROR_BAD_PATHNAME; return false; }
        std::wstring command=L"\""+std::wstring(executable)+L"\" --cursor-guard "+argument(mapping.value)+L" "+argument(request.value)+L" "+argument(ack.value)+L" "+argument(parent.value);
        SIZE_T bytes=0; InitializeProcThreadAttributeList(nullptr,1,0,&bytes);
        std::vector<unsigned char> storage(bytes); STARTUPINFOEXW startup{}; startup.StartupInfo.cb=sizeof(startup);
        startup.StartupInfo.dwFlags=STARTF_USESHOWWINDOW; startup.StartupInfo.wShowWindow=SW_HIDE;
        startup.lpAttributeList=reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(storage.data());
        if (!InitializeProcThreadAttributeList(startup.lpAttributeList,1,0,&bytes)) { localError=failure(); return false; }
        HANDLE handles[]{mapping.value,request.value,ack.value,parent.value};
        const BOOL listed=UpdateProcThreadAttribute(startup.lpAttributeList,0,PROC_THREAD_ATTRIBUTE_HANDLE_LIST,handles,sizeof(handles),nullptr,nullptr);
        PROCESS_INFORMATION process{};
        const BOOL launched=listed && CreateProcessW(executable,command.data(),nullptr,nullptr,TRUE,
            EXTENDED_STARTUPINFO_PRESENT|CREATE_NO_WINDOW,nullptr,nullptr,&startup.StartupInfo,&process);
        if (!launched) localError=failure();
        DeleteProcThreadAttributeList(startup.lpAttributeList);
        // No later children may inherit the control channel accidentally.
        for (HANDLE handle:handles) SetHandleInformation(handle,HANDLE_FLAG_INHERIT,0);
        if (!launched) return false;
        CloseHandle(process.hThread); child=Handle(process.hProcess);
        HANDLE waits[]{child.value,ack.value};
        if (WaitForMultipleObjects(2,waits,FALSE,1000)!=WAIT_OBJECT_0+1) { localError=ERROR_TIMEOUT; return false; }
        localError=static_cast<DWORD>(read(shared->error));
        return !localError && read(shared->supported);
    }
public:
    SystemCursor()=default;
    SystemCursor(const SystemCursor&)=delete;
    SystemCursor& operator=(const SystemCursor&)=delete;
    bool hide() {
        if (!start()) return false;
        // The acknowledged mode is stable until we request a transition.
        // Health remains checked without waiting; this is not a measurement of
        // the compositor or protection against another app changing visibility.
        if (read(shared->error)) { localError=static_cast<DWORD>(read(shared->error)); return false; }
        if (read(shared->hidden)) return true;
        return exchange(1);
    }
    bool show() {
        if (!shared || !child.value) return !localError;
        if (WaitForSingleObject(child.value,0)==WAIT_OBJECT_0) return !read(shared->hidden) && !read(shared->error);
        if (!read(shared->hidden) && !localError && !read(shared->error)) return true;
        return exchange(0);
    }
    void tick() {
        if (shared && !localError) InterlockedExchange64(&shared->heartbeat,static_cast<LONG64>(GetTickCount64()));
        if (child.value && WaitForSingleObject(child.value,0)==WAIT_OBJECT_0 && !localError) localError=ERROR_PROCESS_ABORTED;
    }
    json status() {
        const DWORD error=localError ? localError : shared ? static_cast<DWORD>(read(shared->error)) : 0;
        return {{"backend","magnification_guard"},{"visibilityCommands",visibilityCommands},{"supported",shared && read(shared->supported)!=0},
            {"hidden",shared && read(shared->hidden)!=0},{"restorePending",shared && read(shared->hidden)!=0 && error!=0},
            {"lastError",error ? "win32_"+std::to_string(error) : ""},
            {"guardReady",child.value && WaitForSingleObject(child.value,0)==WAIT_TIMEOUT && !error},
            {"recovered",shared && read(shared->recovered)!=0}};
    }
    bool stop() {
        bool ok=true;
        if (child.value && WaitForSingleObject(child.value,0)==WAIT_TIMEOUT) {
            ok=exchange(2);
            // On a missed ACK stop renewing: the guard still owns restoration.
            const DWORD waited=WaitForSingleObject(child.value,3500);
            DWORD exit=STILL_ACTIVE;
            ok=waited==WAIT_OBJECT_0 && GetExitCodeProcess(child.value,&exit) && exit==0 && ok;
            if (!ok && !localError) localError=ERROR_PROCESS_ABORTED;
        }
        if (child.value && WaitForSingleObject(child.value,0)==WAIT_OBJECT_0) {
            DWORD exit=STILL_ACTIVE;
            if (!GetExitCodeProcess(child.value,&exit) || exit!=0) ok=false;
        }
        return ok;
    }
    ~SystemCursor() { stop(); if (shared) UnmapViewOfFile(shared); }

    // This is a visual observation aid, not an automatic visibility assertion.
    // A successful Mag API call and our acknowledged state do not prove what a
    // local display, remote client or capture renderer actually draws.
    static int visibilityProbe() {
        SystemCursor cursor;
        const auto started=GetTickCount64();
        auto emit=[&](const char* phase,bool acknowledged) {
            CURSORINFO info{}; info.cbSize=sizeof(info);
            const bool queried=GetCursorInfo(&info)!=FALSE;
            const DWORD queryError=queried ? 0 : GetLastError();
            json record{{"probe","cursor_visibility"},{"phase",phase},{"elapsedMs",GetTickCount64()-started},
                {"acknowledged",acknowledged},{"systemCursor",cursor.status()},
                {"visualVerified",false},{"observationSource","api_state_only"},
                {"remoteSessionReported",GetSystemMetrics(SM_REMOTESESSION)!=0},
                {"cursorInfo",{{"queried",queried},{"lastError",queryError},
                    {"flags",queried ? json(info.flags) : json(nullptr)},
                    {"showingFlag",queried ? json((info.flags&CURSOR_SHOWING)!=0) : json(nullptr)},
                    {"suppressedFlag",queried ? json((info.flags&CURSOR_SUPPRESSED)!=0) : json(nullptr)}}}};
            const auto line=record.dump()+"\n"; DWORD written=0;
            return WriteFile(GetStdHandle(STD_OUTPUT_HANDLE),line.data(),static_cast<DWORD>(line.size()),&written,nullptr)!=FALSE && written==line.size();
        };
        const bool hidden=cursor.hide();
        bool outputOk=emit("hide_acknowledged",hidden);
        bool healthy=hidden;
        if (hidden && outputOk) {
            const auto hiddenAt=GetTickCount64(); auto nextSample=hiddenAt+1000;
            while (GetTickCount64()-hiddenAt<5000) {
                cursor.tick();
                healthy=cursor.shared && !cursor.localError && !read(cursor.shared->error) &&
                    read(cursor.shared->hidden) && WaitForSingleObject(cursor.child.value,0)==WAIT_TIMEOUT;
                if (!healthy) break;
                if (GetTickCount64()>=nextSample) {
                    outputOk=emit("holding_hide",true); nextSample+=1000;
                    if (!outputOk) break;
                }
                Sleep(16);
            }
        }
        // Restore even if hiding, observation output or heartbeat checks fail.
        const bool restored=cursor.show();
        outputOk=emit("show_acknowledged",restored) && outputOk;
        const bool stopped=cursor.stop();
        outputOk=emit("guard_exit_observed",stopped) && outputOk;
        return hidden && healthy && restored && stopped && outputOk ? 0 : 20;
    }

    // Target-free lifecycle check. Only the cursor visibility API is exercised;
    // no application activation, cursor movement or input injection occurs.
    static int selftest() {
        {
            SystemCursor normal;
            if (!normal.hide()) return 10;
            const auto commands=normal.visibilityCommands;
            for (unsigned repeat=0;repeat<100;++repeat) if (!normal.hide()) return 18;
            if (normal.visibilityCommands!=commands) return 19;
            SystemCursor competing;
            if (competing.hide() || !competing.shared || read(competing.shared->error)!=ERROR_BUSY) return 11;
            if (!normal.show() || !normal.hide() || !normal.stop()) return 12;
        }
        {
            SystemCursor stalled;
            if (!stalled.hide()) return 13;
            DWORD exit=STILL_ACTIVE;
            if (WaitForSingleObject(stalled.child.value,3500)!=WAIT_OBJECT_0 ||
                !GetExitCodeProcess(stalled.child.value,&exit) || exit ||
                read(stalled.shared->hidden) || !read(stalled.shared->recovered)) return 14;
        }
        {
            wchar_t executable[32768]{};
            if (!GetModuleFileNameW(nullptr,executable,32768)) return 15;
            std::wstring command=L"\""+std::wstring(executable)+L"\" --cursor-guard-selftest-victim";
            STARTUPINFOW startup{}; startup.cb=sizeof(startup); PROCESS_INFORMATION process{};
            if (!CreateProcessW(executable,command.data(),nullptr,nullptr,FALSE,CREATE_NO_WINDOW,nullptr,nullptr,&startup,&process)) return 16;
            Handle victim(process.hProcess), thread(process.hThread);
            SystemCursor orphaned;
            const bool armed=orphaned.start(victim.value) && orphaned.hide();
            // This exact process was created above solely as the watch target.
            const bool killed=TerminateProcess(victim.value,0)!=FALSE && WaitForSingleObject(victim.value,1000)==WAIT_OBJECT_0;
            DWORD exit=STILL_ACTIVE;
            if (!armed || !killed || WaitForSingleObject(orphaned.child.value,1500)!=WAIT_OBJECT_0 ||
                !GetExitCodeProcess(orphaned.child.value,&exit) || exit ||
                read(orphaned.shared->hidden) || !read(orphaned.shared->recovered)) return 17;
        }
        return 0;
    }

    static int guardMain(int argc,wchar_t** argv) {
        if (argc!=6) return 2;
        auto parse=[](const wchar_t* text)->HANDLE {
            wchar_t* end=nullptr; const auto value=_wcstoui64(text,&end,10);
            return value && end && !*end ? reinterpret_cast<HANDLE>(static_cast<uintptr_t>(value)) : nullptr;
        };
        Handle map(parse(argv[2])), requestEvent(parse(argv[3])), ackEvent(parse(argv[4])), parent(parse(argv[5]));
        if (!map.value || !requestEvent.value || !ackEvent.value || !parent.value) return 2;
        auto* state=static_cast<Shared*>(MapViewOfFile(map.value,FILE_MAP_ALL_ACCESS,0,0,sizeof(Shared)));
        if (!state) return 2;
        DWORD session=0; ProcessIdToSessionId(GetCurrentProcessId(),&session);
        // Local is session-scoped; desktop identity further limits the lease.
        const std::wstring name=L"Local\\AzraelSwitchedSystemCursor-"+std::to_wstring(session)+L"-"+objectName(GetThreadDesktop(GetCurrentThreadId()));
        Handle lease(CreateMutexW(nullptr,FALSE,name.c_str()));
        const DWORD acquired=lease.value ? WaitForSingleObject(lease.value,0) : WAIT_FAILED;
        if (acquired!=WAIT_OBJECT_0 && acquired!=WAIT_ABANDONED) {
            InterlockedExchange(&state->error,ERROR_BUSY); SetEvent(ackEvent.value); UnmapViewOfFile(state); return 3;
        }
        bool initialized=MagInitialize()!=FALSE;
        DWORD error=initialized ? 0 : failure();
        auto visibility=[&](bool show) {
            if (!MagShowSystemCursor(show ? TRUE : FALSE)) { InterlockedExchange(&state->error,static_cast<LONG>(failure())); return false; }
            InterlockedExchange(&state->hidden,show ? 0 : 1); return true;
        };
        if (initialized) {
            InterlockedExchange(&state->supported,1);
            if (!visibility(true)) error=static_cast<DWORD>(read(state->error));
            if (acquired==WAIT_ABANDONED && !error) InterlockedExchange(&state->recovered,1);
        }
        InterlockedExchange(&state->error,static_cast<LONG>(error)); SetEvent(ackEvent.value);
        if (!error) {
            HANDLE waits[]{parent.value,requestEvent.value};
            for (;;) {
                const DWORD waited=WaitForMultipleObjects(2,waits,FALSE,100);
                const auto heartbeat=static_cast<ULONGLONG>(InterlockedCompareExchange64(&state->heartbeat,0,0));
                if (waited==WAIT_OBJECT_0 || waited==WAIT_FAILED || GetTickCount64()-heartbeat>2000) {
                    InterlockedExchange(&state->recovered,1); break;
                }
                if (waited==WAIT_OBJECT_0+1) {
                    const LONG command=read(state->command);
                    if (command<0 || command>2) { InterlockedExchange(&state->error,ERROR_INVALID_DATA); SetEvent(ackEvent.value); break; }
                    const bool ok=visibility(command!=1); SetEvent(ackEvent.value);
                    if (!ok || command==2) break;
                }
            }
        }
        if (initialized) {
            // Retry show on an API failure, never substitute cursor-theme edits.
            for (unsigned retry=0;retry<3;++retry) if (visibility(true)) break;
            if (!MagUninitialize() && !read(state->error)) InterlockedExchange(&state->error,static_cast<LONG>(failure()));
        }
        const int result=read(state->error) ? 4 : 0;
        ReleaseMutex(lease.value); UnmapViewOfFile(state); return result;
    }
};
} // namespace mp
