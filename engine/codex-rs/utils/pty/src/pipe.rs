//! Pipe I/O and process-tree ownership on top of the shared local child launcher.

use std::collections::HashMap;
use std::ffi::OsStr;
use std::io;
use std::io::ErrorKind;
use std::path::Path;
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use std::sync::atomic::AtomicBool;

use crate::ChildStdin;
use crate::Command;
#[cfg(unix)]
use crate::DescriptorPolicy;
#[cfg(unix)]
use crate::ProcessMode;
use crate::child_command::ChildDropPolicy;
use anyhow::Result;
use tokio::io::AsyncRead;
use tokio::io::AsyncReadExt;
use tokio::io::AsyncWriteExt;
use tokio::io::BufReader;
use tokio::sync::mpsc;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

use crate::process::ChildTerminator;
use crate::process::ProcessHandle;
use crate::process::ProcessSignal;
use crate::process::SpawnedProcess;
use crate::process::exit_code_from_status;

#[cfg(windows)]
enum WindowsChildTerminator {
    Job {
        job: Arc<crate::win::JobObject>,
        tree: Arc<crate::win::process_tree::OwnedProcessTree>,
    },
    Process(Arc<crate::win::process_tree::OwnedProcessTree>),
}

struct PipeChildTerminator {
    #[cfg(windows)]
    windows: WindowsChildTerminator,
    #[cfg(unix)]
    process_group_id: u32,
}

impl ChildTerminator for PipeChildTerminator {
    fn signal(&mut self, signal: ProcessSignal) -> io::Result<()> {
        match signal {
            ProcessSignal::Interrupt => {
                #[cfg(unix)]
                {
                    crate::process_group::interrupt_process_group(self.process_group_id)
                }

                #[cfg(windows)]
                {
                    self.kill()
                }

                #[cfg(not(any(unix, windows)))]
                {
                    Err(crate::process::unsupported_signal(signal))
                }
            }
        }
    }

    fn kill(&mut self) -> io::Result<()> {
        #[cfg(unix)]
        {
            crate::process_group::kill_process_group(self.process_group_id)
        }

        #[cfg(windows)]
        {
            let (pid, result) = match &self.windows {
                WindowsChildTerminator::Job { job, tree } => {
                    (tree.pid(), tree.terminate(Some(job)))
                }
                WindowsChildTerminator::Process(tree) => (tree.pid(), tree.terminate(None)),
            };
            if let Err(error) = &result {
                log::warn!("Windows pipe explicit termination failed pid={pid}: {error}");
            }
            log::debug!("Windows pipe explicit termination pid={pid} result={result:?}");
            result
        }

        #[cfg(not(any(unix, windows)))]
        {
            Ok(())
        }
    }
}

async fn read_output_stream<R>(mut reader: R, output_tx: mpsc::Sender<Vec<u8>>)
where
    R: AsyncRead + Unpin,
{
    let mut buf = vec![0u8; 8_192];
    loop {
        match reader.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => {
                let _ = output_tx.send(buf[..n].to_vec()).await;
            }
            Err(ref e) if e.kind() == ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
}

#[derive(Clone, Copy)]
enum PipeStdinMode {
    Piped,
    Null,
}

/// On Windows, assign the suspended root to its job before it can create children.
/// Restricted job environments retain the existing root-only fallback.
async fn spawn_process_with_stdin_mode(
    program: &OsStr,
    args: &[String],
    cwd: &Path,
    env: &HashMap<String, String>,
    arg0: &Option<String>,
    stdin_mode: PipeStdinMode,
    inherited_fds: &[i32],
) -> Result<SpawnedProcess> {
    if program.is_empty() {
        anyhow::bail!("missing program for pipe spawn");
    }

    #[cfg(not(unix))]
    let _ = inherited_fds;

    let mut command = Command::new(program);
    #[cfg(unix)]
    if let Some(arg0) = arg0 {
        command.arg0(arg0);
    }
    #[cfg(unix)]
    command
        .process_mode(ProcessMode::NewSession)
        .descriptor_policy(DescriptorPolicy::Explicit)
        .inherit_fds(inherited_fds);
    #[cfg(target_os = "linux")]
    command.terminate_on_parent_death();
    #[cfg(not(unix))]
    let _ = arg0;
    command
        .current_dir(cwd)
        .envs(env)
        .args(args)
        .drop_policy(ChildDropPolicy::ReapOnly)
        .stdin(match stdin_mode {
            PipeStdinMode::Piped => ChildStdin::Piped,
            PipeStdinMode::Null => ChildStdin::Null,
        });

    #[cfg(windows)]
    let job = crate::win::JobObject::create().map(Arc::new);
    #[cfg(windows)]
    if let Ok(job) = &job {
        command.prepare_suspended_spawn(job);
    }
    #[cfg(target_os = "linux")]
    let mut child =
        match crate::spawn_helper::spawn(&command, crate::spawn_helper::Setup::Pipe).await? {
            Some(child) => child,
            None => command.spawn()?,
        };
    #[cfg(not(target_os = "linux"))]
    let mut child = command.spawn()?;
    #[cfg(windows)]
    let windows_terminator = {
        let pid = child
            .id()
            .ok_or_else(|| io::Error::other("missing child pid"))?;
        let tree = {
            let crate::child::ChildKind::Tokio(process) = &child.inner;
            let handle = process
                .raw_handle()
                .ok_or_else(|| io::Error::other("missing child process handle"))?;
            match crate::win::process_tree::OwnedProcessTree::capture(handle, pid) {
                Ok(tree) => Arc::new(tree),
                Err(error) => {
                    if let Err(cleanup_error) = child.kill().await {
                        log::warn!(
                            "Windows pipe failed to reap child {pid} after identity capture failure: {cleanup_error}"
                        );
                    }
                    return Err(error.into());
                }
            }
        };
        match job {
            Ok(job) => match job.assign_and_resume_handle(tree.raw_handle(), pid) {
                Ok(true) => {
                    log::debug!("Windows pipe spawned pid={pid} containment_assigned=true");
                    WindowsChildTerminator::Job { job, tree }
                }
                // The helper resumes rejected assignments before returning false.
                Ok(false) => {
                    log::debug!("Windows pipe spawned pid={pid} containment_assigned=false");
                    WindowsChildTerminator::Process(tree)
                }
                Err(err) => {
                    // Never leave a suspended root behind after a setup failure.
                    if let Err(cleanup_error) = child.kill().await {
                        log::warn!(
                            "Windows pipe failed to reap child {pid} after setup failure: {cleanup_error}"
                        );
                    }
                    return Err(err.into());
                }
            },
            Err(err) => {
                log::debug!("Windows pipe spawned pid={pid} containment_assigned=false");
                log::warn!(
                    "Windows pipe process tree containment unavailable for pid {pid}: {err}"
                );
                WindowsChildTerminator::Process(tree)
            }
        }
    };
    #[cfg(unix)]
    let process_group_id = child
        .id()
        .ok_or_else(|| io::Error::other("missing child pid"))?;

    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let (writer_tx, mut writer_rx) = mpsc::channel::<Vec<u8>>(128);
    let (stdout_tx, stdout_rx) = mpsc::channel::<Vec<u8>>(128);
    let (stderr_tx, stderr_rx) = mpsc::channel::<Vec<u8>>(128);
    let writer_handle = if let Some(stdin) = stdin {
        tokio::spawn(async move {
            let mut writer = stdin;
            while let Some(bytes) = writer_rx.recv().await {
                let _ = writer.write_all(&bytes).await;
                let _ = writer.flush().await;
            }
        })
    } else {
        drop(writer_rx);
        tokio::spawn(async {})
    };

    let stdout_handle = stdout.map(|stdout| {
        let stdout_tx = stdout_tx.clone();
        tokio::spawn(async move {
            read_output_stream(BufReader::new(stdout), stdout_tx).await;
        })
    });
    let stderr_handle = stderr.map(|stderr| {
        let stderr_tx = stderr_tx.clone();
        tokio::spawn(async move {
            read_output_stream(BufReader::new(stderr), stderr_tx).await;
        })
    });
    let mut reader_abort_handles = Vec::new();
    if let Some(handle) = stdout_handle.as_ref() {
        reader_abort_handles.push(handle.abort_handle());
    }
    if let Some(handle) = stderr_handle.as_ref() {
        reader_abort_handles.push(handle.abort_handle());
    }
    let reader_handle = tokio::spawn(async move {
        if let Some(handle) = stdout_handle {
            let _ = handle.await;
        }
        if let Some(handle) = stderr_handle {
            let _ = handle.await;
        }
    });

    let (exit_tx, exit_rx) = oneshot::channel::<i32>();
    let exit_status = Arc::new(AtomicBool::new(false));
    let wait_exit_status = Arc::clone(&exit_status);
    let exit_code = Arc::new(StdMutex::new(None));
    let wait_exit_code = Arc::clone(&exit_code);
    #[cfg(windows)]
    let (wait_tree, wait_job) = match &windows_terminator {
        WindowsChildTerminator::Job { job, tree } => (Arc::clone(tree), Some(Arc::clone(job))),
        WindowsChildTerminator::Process(tree) => (Arc::clone(tree), None),
    };
    let wait_handle: JoinHandle<()> = tokio::spawn(async move {
        let code = match child.wait().await {
            Ok(status) => {
                #[cfg(windows)]
                if let Err(err) = wait_tree.preserve_after_root_exit(wait_job.as_deref()) {
                    log::warn!(
                        "Windows pipe failed to preserve descendants after root exit: {err}"
                    );
                }
                exit_code_from_status(status)
            }
            Err(_) => -1,
        };
        wait_exit_status.store(true, std::sync::atomic::Ordering::SeqCst);
        if let Ok(mut guard) = wait_exit_code.lock() {
            *guard = Some(code);
        }
        let _ = exit_tx.send(code);
    });

    let handle = ProcessHandle::new(
        writer_tx,
        Box::new(PipeChildTerminator {
            #[cfg(windows)]
            windows: windows_terminator,
            #[cfg(unix)]
            process_group_id,
        }),
        reader_handle,
        reader_abort_handles,
        writer_handle,
        wait_handle,
        exit_status,
        exit_code,
        /*pty_handles*/ None,
        /*resizer*/ None,
    );

    Ok(SpawnedProcess {
        session: handle,
        stdout_rx,
        stderr_rx,
        exit_rx,
    })
}

/// Spawn a process using regular pipes and preserve selected inherited file
/// descriptors across exec on Unix. The executable path retains its native encoding.
pub async fn spawn_process(
    program: impl AsRef<OsStr>,
    args: &[String],
    cwd: &Path,
    env: &HashMap<String, String>,
    arg0: &Option<String>,
    inherited_fds: &[i32],
) -> Result<SpawnedProcess> {
    spawn_process_with_stdin_mode(
        program.as_ref(),
        args,
        cwd,
        env,
        arg0,
        PipeStdinMode::Piped,
        inherited_fds,
    )
    .await
}

/// Spawn a process using regular pipes, close stdin immediately, and preserve
/// selected inherited file descriptors across exec on Unix. The executable path
/// retains its native encoding.
pub async fn spawn_process_no_stdin(
    program: impl AsRef<OsStr>,
    args: &[String],
    cwd: &Path,
    env: &HashMap<String, String>,
    arg0: &Option<String>,
    inherited_fds: &[i32],
) -> Result<SpawnedProcess> {
    spawn_process_with_stdin_mode(
        program.as_ref(),
        args,
        cwd,
        env,
        arg0,
        PipeStdinMode::Null,
        inherited_fds,
    )
    .await
}

#[cfg(all(test, windows))]
#[path = "pipe_tests.rs"]
mod tests;

#[cfg(all(test, unix))]
#[path = "pipe_unix_tests.rs"]
mod unix_tests;
