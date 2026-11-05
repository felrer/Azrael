//! Bulk work yields I/O and memory priority without a fixed throughput cap.
//! Never hold this guard across a shared-state lock or a durable commit.

pub(crate) fn background<T>(work: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    #[cfg(windows)]
    let mut priority = windows::Background::enter()?;
    let result = work();
    #[cfg(windows)]
    if let Err(error) = priority.finish() {
        return Err(match result {
            Ok(_) => error,
            Err(original) => format!("{original}; {error}"),
        });
    }
    result
}

#[cfg(windows)]
mod windows {
    use std::marker::PhantomData;
    use std::rc::Rc;
    use windows_sys::Win32::Foundation::ERROR_THREAD_MODE_ALREADY_BACKGROUND;
    use windows_sys::Win32::System::Threading::{
        GetCurrentThread, SetThreadPriority, THREAD_MODE_BACKGROUND_BEGIN,
        THREAD_MODE_BACKGROUND_END,
    };

    // Background mode is thread-affine and restores more than CPU priority.
    pub(super) struct Background {
        owned: bool,
        _same_thread: PhantomData<Rc<()>>,
    }

    impl Background {
        pub(super) fn enter() -> Result<Self, String> {
            // The pseudo handle is valid for the calling thread and is not closed.
            let changed =
                unsafe { SetThreadPriority(GetCurrentThread(), THREAD_MODE_BACKGROUND_BEGIN) };
            let owned = if changed != 0 {
                true
            } else {
                let error = std::io::Error::last_os_error();
                if error.raw_os_error() == Some(ERROR_THREAD_MODE_ALREADY_BACKGROUND as i32) {
                    // Nested use must not end the caller's existing background mode.
                    false
                } else {
                    return Err(format!("bulk I/O background priority unavailable: {error}"));
                }
            };
            Ok(Self {
                owned,
                _same_thread: PhantomData,
            })
        }

        pub(super) fn finish(&mut self) -> Result<(), String> {
            if self.owned {
                if unsafe { SetThreadPriority(GetCurrentThread(), THREAD_MODE_BACKGROUND_END) } == 0
                {
                    return Err(format!(
                        "bulk I/O priority restoration failed: {}",
                        std::io::Error::last_os_error()
                    ));
                }
                self.owned = false;
            }
            Ok(())
        }
    }

    impl Drop for Background {
        fn drop(&mut self) {
            // Also restore on panic. The ordinary path reports a failed restore;
            // this best-effort second attempt must not hide the original outcome.
            let _ = self.finish();
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use windows_sys::Win32::Foundation::{
        ERROR_THREAD_MODE_ALREADY_BACKGROUND, ERROR_THREAD_MODE_NOT_BACKGROUND,
    };
    use windows_sys::Win32::System::Threading::{
        GetCurrentThread, SetThreadPriority, THREAD_MODE_BACKGROUND_BEGIN,
        THREAD_MODE_BACKGROUND_END,
    };

    fn assert_background() {
        assert_eq!(
            unsafe { SetThreadPriority(GetCurrentThread(), THREAD_MODE_BACKGROUND_BEGIN) },
            0
        );
        assert_eq!(
            std::io::Error::last_os_error().raw_os_error(),
            Some(ERROR_THREAD_MODE_ALREADY_BACKGROUND as i32)
        );
    }

    fn assert_foreground() {
        assert_eq!(
            unsafe { SetThreadPriority(GetCurrentThread(), THREAD_MODE_BACKGROUND_END) },
            0
        );
        assert_eq!(
            std::io::Error::last_os_error().raw_os_error(),
            Some(ERROR_THREAD_MODE_NOT_BACKGROUND as i32)
        );
    }

    #[test]
    fn background_restores_on_error_and_does_not_end_an_outer_scope() {
        // Never modify the test runner's reusable worker thread.
        std::thread::spawn(|| {
            assert_foreground();
            let result = background(|| {
                assert_background();
                background(|| {
                    assert_background();
                    Ok(())
                })?;
                assert_background();
                Err::<(), _>("measurement failed".to_string())
            });
            assert_eq!(result.unwrap_err(), "measurement failed");
            assert_foreground();
            assert!(
                std::panic::catch_unwind(|| {
                    let _ = background::<()>(|| panic!("measurement panicked"));
                })
                .is_err()
            );
            assert_foreground();
        })
        .join()
        .unwrap();
    }
}
