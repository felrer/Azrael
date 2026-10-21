use codex_apply_patch::CODEX_CORE_APPLY_PATCH_ARG1;
#[cfg(unix)]
use codex_exec_server::CODEX_ARG0_EXEC_HELPER_ARG1;
use codex_exec_server::CODEX_FS_HELPER_ARG1;
use codex_sandboxing::landlock::CODEX_LINUX_SANDBOX_ARG0;
use codex_test_binary_support::TestBinaryDispatchGuard;
use codex_test_binary_support::TestBinaryDispatchMode;
use codex_test_binary_support::configure_test_binary_dispatch;
use ctor::ctor;

// This code runs before any other tests are run.
// It allows the test binary to behave like codex and dispatch to apply_patch and codex-linux-sandbox
// based on the arg0.
// NOTE: this doesn't work on ARM
#[ctor]
pub static CODEX_ALIASES_TEMP_DIR: Option<TestBinaryDispatchGuard> = {
    configure_test_binary_dispatch("codex-core-tests", |exe_name, argv1| {
        if argv1 == Some(CODEX_CORE_APPLY_PATCH_ARG1) {
            return TestBinaryDispatchMode::DispatchArg0Only;
        }
        #[cfg(unix)]
        if argv1 == Some(CODEX_ARG0_EXEC_HELPER_ARG1) {
            return TestBinaryDispatchMode::DispatchArg0Only;
        }
        if argv1 == Some(CODEX_FS_HELPER_ARG1) {
            return TestBinaryDispatchMode::DispatchArg0Only;
        }
        if argv1 == Some(codex_sandboxing::CODEX_WINDOWS_MXC_ARG1) {
            return TestBinaryDispatchMode::DispatchArg0Only;
        }
        if exe_name == CODEX_LINUX_SANDBOX_ARG0 {
            return TestBinaryDispatchMode::DispatchArg0Only;
        }
        TestBinaryDispatchMode::InstallAliases
    })
};
