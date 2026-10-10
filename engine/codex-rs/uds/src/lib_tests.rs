use std::io::ErrorKind;

use pretty_assertions::assert_eq;
use tokio::io::AsyncReadExt;
use tokio::io::AsyncWriteExt;

use super::*;

#[cfg(unix)]
#[tokio::test]
async fn private_connection_accepts_current_user_peer_without_sending_data() {
    let temp = tempfile::TempDir::new().unwrap();
    let directory = temp.path().join("private");
    prepare_private_socket_directory(&directory).await.unwrap();
    let socket_path = directory.join("socket");
    let mut listener = UnixListener::bind(&socket_path).await.unwrap();
    let client = UnixStream::connect_private(&socket_path).await.unwrap();
    drop(client);
    let mut server = listener.accept().await.unwrap();
    let mut byte = [0];
    assert_eq!(server.read(&mut byte).await.unwrap(), 0);
}

#[cfg(unix)]
#[tokio::test]
async fn private_connection_rejects_insecure_directory_without_repair() {
    use std::os::unix::fs::PermissionsExt;

    let temp = tempfile::TempDir::new().unwrap();
    let directory = temp.path().join("private");
    prepare_private_socket_directory(&directory).await.unwrap();
    let socket_path = directory.join("socket");
    let _listener = UnixListener::bind(&socket_path).await.unwrap();
    for mode in [0o755, 0o600] {
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(mode)).unwrap();
        assert_eq!(
            UnixStream::connect_private(&socket_path)
                .await
                .err()
                .unwrap()
                .kind(),
            ErrorKind::PermissionDenied,
        );
        assert_eq!(
            std::fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
            mode
        );
    }
}

#[cfg(unix)]
#[tokio::test]
async fn private_connection_rejects_directory_symlinks_and_regular_files() {
    use std::os::unix::fs::symlink;

    let temp = tempfile::TempDir::new().unwrap();
    let directory = temp.path().join("private");
    prepare_private_socket_directory(&directory).await.unwrap();
    let socket_path = directory.join("socket");
    let _listener = UnixListener::bind(&socket_path).await.unwrap();
    let linked_directory = temp.path().join("linked-directory");
    symlink(&directory, &linked_directory).unwrap();
    let regular_file = directory.join("file");
    std::fs::write(&regular_file, b"not a socket").unwrap();
    for path in [linked_directory.join("socket"), regular_file] {
        assert_eq!(
            UnixStream::connect_private(path)
                .await
                .err()
                .unwrap()
                .kind(),
            ErrorKind::PermissionDenied,
        );
    }
}

#[cfg(unix)]
#[tokio::test]
async fn private_connection_accepts_owned_absolute_and_relative_rendezvous_links() {
    use std::os::unix::fs::symlink;

    let temp = tempfile::TempDir::new().unwrap();
    let advertised = temp.path().join("advertised");
    let physical = temp.path().join("physical");
    prepare_private_socket_directory(&advertised).await.unwrap();
    prepare_private_socket_directory(&physical).await.unwrap();
    let socket_path = physical.join("socket");
    let mut listener = UnixListener::bind(&socket_path).await.unwrap();
    for (name, target) in [
        ("absolute", socket_path),
        ("relative", std::path::PathBuf::from("../physical/socket")),
    ] {
        let alias = advertised.join(name);
        symlink(target, &alias).unwrap();
        let client = UnixStream::connect_private(alias).await.unwrap();
        drop(client);
        let mut server = listener.accept().await.unwrap();
        assert_eq!(server.read(&mut [0]).await.unwrap(), 0);
    }
}

#[cfg(unix)]
#[tokio::test]
async fn private_connection_rejects_unsafe_advertised_or_physical_parent() {
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::fs::symlink;

    let temp = tempfile::TempDir::new().unwrap();
    let advertised = temp.path().join("advertised");
    let physical = temp.path().join("physical");
    prepare_private_socket_directory(&advertised).await.unwrap();
    prepare_private_socket_directory(&physical).await.unwrap();
    let socket_path = physical.join("socket");
    let _listener = UnixListener::bind(&socket_path).await.unwrap();
    let alias = advertised.join("alias");
    symlink(socket_path, &alias).unwrap();
    for directory in [&advertised, &physical] {
        std::fs::set_permissions(directory, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(
            UnixStream::connect_private(&alias)
                .await
                .err()
                .unwrap()
                .kind(),
            ErrorKind::PermissionDenied,
        );
        assert_eq!(
            std::fs::metadata(directory).unwrap().permissions().mode() & 0o777,
            0o755
        );
        std::fs::set_permissions(directory, std::fs::Permissions::from_mode(0o700)).unwrap();
    }
}

#[cfg(unix)]
#[tokio::test]
async fn private_connection_rejects_chained_dangling_and_regular_file_links() {
    use std::os::unix::fs::symlink;

    let temp = tempfile::TempDir::new().unwrap();
    let directory = temp.path().join("private");
    prepare_private_socket_directory(&directory).await.unwrap();
    let socket_path = directory.join("socket");
    let _listener = UnixListener::bind(&socket_path).await.unwrap();
    let first = directory.join("first");
    symlink(socket_path, &first).unwrap();
    let chained = directory.join("chained");
    symlink(first, &chained).unwrap();
    let dangling = directory.join("dangling");
    symlink(directory.join("missing"), &dangling).unwrap();
    let file = directory.join("file");
    std::fs::write(&file, b"not a socket").unwrap();
    let file_link = directory.join("file-link");
    symlink(file, &file_link).unwrap();
    for (path, kind) in [
        (chained, ErrorKind::PermissionDenied),
        (dangling, ErrorKind::NotFound),
        (file_link, ErrorKind::PermissionDenied),
    ] {
        assert_eq!(
            UnixStream::connect_private(path)
                .await
                .err()
                .unwrap()
                .kind(),
            kind
        );
    }
}

#[cfg(unix)]
#[tokio::test]
async fn private_connection_recheck_rejects_replaced_or_retargeted_alias() {
    use std::os::unix::fs::symlink;

    let temp = tempfile::TempDir::new().unwrap();
    let directory = temp.path().join("private");
    prepare_private_socket_directory(&directory).await.unwrap();
    let socket_path = directory.join("socket");
    let second_path = directory.join("second-socket");
    let _listener = UnixListener::bind(&socket_path).await.unwrap();
    let _second_listener = UnixListener::bind(&second_path).await.unwrap();
    let alias = directory.join("alias");
    symlink(&socket_path, &alias).unwrap();
    for target in [&socket_path, &second_path] {
        let validated = platform::validate_private_socket_path(&alias)
            .await
            .unwrap();
        validated.ensure_unchanged(&alias).await.unwrap();
        let replacement = directory.join("replacement");
        symlink(target, &replacement).unwrap();
        std::fs::rename(replacement, &alias).unwrap();
        assert_eq!(
            validated.ensure_unchanged(&alias).await.unwrap_err().kind(),
            ErrorKind::PermissionDenied,
        );
    }
}

#[cfg(unix)]
#[test]
fn private_connection_rejects_another_user() {
    // SAFETY: geteuid has no preconditions and does not access caller memory.
    let uid = unsafe { libc::geteuid() };
    assert!(platform::ensure_current_user(uid).is_ok());
    assert_eq!(
        platform::ensure_current_user(uid.wrapping_add(1))
            .unwrap_err()
            .kind(),
        ErrorKind::PermissionDenied,
    );
}

#[cfg(windows)]
#[tokio::test]
async fn private_directory_rejects_volume_roots() {
    // A nonexistent volume keeps this regression safe even if root validation breaks.
    let root = Path::new(r"\\?\Volume{00000000-0000-0000-0000-000000000000}\");
    assert_eq!(
        prepare_private_socket_directory(root)
            .await
            .unwrap_err()
            .kind(),
        ErrorKind::InvalidInput,
    );
}

#[cfg(windows)]
#[tokio::test]
async fn private_directory_rejects_junctions() {
    let temp = tempfile::TempDir::new().expect("temp directory");
    let target = temp.path().join("target");
    let junction = temp.path().join("junction");
    std::fs::create_dir(&target).expect("target");
    let output = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference = 'Stop'; New-Item -ItemType Junction -Path $env:CODEX_TEST_LINK -Target $env:CODEX_TEST_TARGET | Out-Null"])
        .env("CODEX_TEST_LINK", &junction)
        .env("CODEX_TEST_TARGET", &target)
        .output().expect("create junction");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        prepare_private_socket_directory(&junction)
            .await
            .unwrap_err()
            .kind(),
        ErrorKind::PermissionDenied,
    );
    assert_eq!(
        validate_private_socket_path(&junction.join("socket"))
            .unwrap_err()
            .kind(),
        ErrorKind::PermissionDenied,
    );
}

#[cfg(windows)]
#[tokio::test]
async fn socket_validation_pins_private_directory_without_creating_missing_paths() {
    let temp = tempfile::TempDir::new().expect("temp directory");
    let directory = temp.path().join("private");
    let socket_path = directory.join("socket");
    assert!(validate_private_socket_path(&socket_path).is_err());
    assert!(!directory.exists());
    prepare_private_socket_directory(&directory).await.unwrap();
    let (_validated_path, _guard) = validate_private_socket_path(&socket_path).unwrap();
    assert!(std::fs::rename(&directory, temp.path().join("moved")).is_err());
}

#[cfg(windows)]
#[tokio::test]
async fn socket_validation_rejects_broad_acl_without_repairing_it() {
    let temp = tempfile::TempDir::new().expect("temp directory");
    let directory = temp.path().join("private");
    prepare_private_socket_directory(&directory).await.unwrap();
    let inspect = || {
        let output = std::process::Command::new("icacls.exe")
            .arg(&directory)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        output.stdout
    };
    // icacls modifies only the DACL: no SACL privilege or PowerShell module
    // environment is needed by a non-elevated fixture process.
    let output = std::process::Command::new("icacls.exe")
        .arg(&directory)
        .args(["/grant", "*S-1-1-0:(OI)(CI)F"])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let before = inspect();
    assert_eq!(
        validate_private_socket_path(&directory.join("socket"))
            .unwrap_err()
            .kind(),
        ErrorKind::PermissionDenied,
    );
    assert_eq!(
        prepare_private_socket_directory(&directory)
            .await
            .unwrap_err()
            .kind(),
        ErrorKind::PermissionDenied,
    );
    assert_eq!(before, inspect());
}

#[cfg(windows)]
#[tokio::test]
async fn private_directory_supports_extended_length_paths() {
    let temp = tempfile::TempDir::new().expect("temp directory");
    let directory = temp.path().join("a".repeat(150)).join("b".repeat(150));
    prepare_private_socket_directory(&directory)
        .await
        .expect("create long private directory");
    prepare_private_socket_directory(&directory)
        .await
        .expect("validate long private directory");
    assert!(directory.is_dir());
}

#[cfg(windows)]
#[tokio::test]
async fn private_directory_acl_is_user_only_and_inherited_by_files() {
    let temp = tempfile::TempDir::new().expect("temp directory");
    let directory = temp.path().join("private");
    // Cover reusing an existing private directory as well as inheriting its DACL.
    prepare_private_socket_directory(&directory)
        .await
        .expect("create user-owned directory");
    prepare_private_socket_directory(&directory)
        .await
        .expect("private directory");
    std::fs::write(directory.join("child"), b"").expect("child file");
    let _listener = UnixListener::bind(directory.join("socket"))
        .await
        .expect("private socket");
    let output = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", r#"
$ErrorActionPreference = 'Stop'
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$directory = Get-Acl -LiteralPath $env:CODEX_TEST_PRIVATE_DIRECTORY
if (-not $directory.AreAccessRulesProtected) { throw 'directory inherits broad access' }
foreach ($acl in @($directory, (Get-Acl -LiteralPath (Join-Path $env:CODEX_TEST_PRIVATE_DIRECTORY 'child')), (Get-Acl -LiteralPath (Join-Path $env:CODEX_TEST_PRIVATE_DIRECTORY 'socket')))) {
    $rules = @($acl.Access)
    if ($rules.Count -ne 1) { throw 'unexpected access rules' }
    if ($rules[0].IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -ne $sid) { throw 'wrong user' }
    if ($rules[0].AccessControlType -ne 'Allow') { throw 'user is denied access' }
}
"#])
        .env("CODEX_TEST_PRIVATE_DIRECTORY", &directory)
        .output().expect("inspect ACLs");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[tokio::test]
async fn prepare_private_socket_directory_creates_directory() {
    let temp_dir = tempfile::TempDir::new().expect("temp dir");
    let socket_dir = temp_dir.path().join("app-server-control");

    prepare_private_socket_directory(&socket_dir)
        .await
        .expect("socket dir should be created");

    assert!(socket_dir.is_dir());
}

#[cfg(unix)]
#[tokio::test]
async fn prepare_private_socket_directory_sets_existing_permissions_to_owner_only() {
    use std::os::unix::fs::PermissionsExt;

    let temp_dir = tempfile::TempDir::new().expect("temp dir");
    for mode in [0o755, 0o600] {
        let socket_dir = temp_dir.path().join(format!("app-server-control-{mode:o}"));
        std::fs::create_dir(&socket_dir).expect("socket dir should be created");
        std::fs::set_permissions(&socket_dir, std::fs::Permissions::from_mode(mode))
            .expect("socket dir permissions should be changed");

        prepare_private_socket_directory(&socket_dir)
            .await
            .expect("socket dir permissions should be set exactly");

        let mode = std::fs::metadata(&socket_dir)
            .expect("socket dir metadata")
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o700);
    }
}

#[cfg(unix)]
#[tokio::test]
async fn regular_file_path_is_not_stale_socket_path() {
    let temp_dir = tempfile::TempDir::new().expect("temp dir");
    let regular_file = temp_dir.path().join("not-a-socket");
    std::fs::write(&regular_file, b"not a socket").expect("regular file should be created");

    assert!(
        !is_stale_socket_path(&regular_file)
            .await
            .expect("stale socket check should succeed")
    );
}

#[tokio::test]
async fn bound_listener_path_is_stale_socket_path() {
    let temp_dir = tempfile::TempDir::new().expect("temp dir");
    let socket_path = temp_dir.path().join("socket");
    let _listener = match UnixListener::bind(&socket_path).await {
        Ok(listener) => listener,
        Err(err) if err.kind() == ErrorKind::PermissionDenied => {
            eprintln!("skipping test: failed to bind unix socket: {err}");
            return;
        }
        Err(err) => panic!("failed to bind test socket: {err}"),
    };

    assert!(
        is_stale_socket_path(&socket_path)
            .await
            .expect("stale socket check should succeed")
    );
}

#[tokio::test]
async fn stream_round_trips_data_between_listener_and_client() {
    let temp_dir = tempfile::TempDir::new().expect("temp dir");
    let socket_path = temp_dir.path().join("socket");
    let mut listener = match UnixListener::bind(&socket_path).await {
        Ok(listener) => listener,
        Err(err) if err.kind() == ErrorKind::PermissionDenied => {
            eprintln!("skipping test: failed to bind unix socket: {err}");
            return;
        }
        Err(err) => panic!("failed to bind test socket: {err}"),
    };

    let server_task = tokio::spawn(async move {
        let mut server_stream = listener.accept().await.expect("connection should accept");
        let mut request = [0; 7];
        server_stream
            .read_exact(&mut request)
            .await
            .expect("server should read request");
        assert_eq!(&request, b"request");
        server_stream
            .write_all(b"response")
            .await
            .expect("server should write response");
    });

    let mut client_stream = UnixStream::connect(&socket_path)
        .await
        .expect("client should connect");
    client_stream
        .write_all(b"request")
        .await
        .expect("client should write request");
    let mut response = [0; 8];
    client_stream
        .read_exact(&mut response)
        .await
        .expect("client should read response");
    assert_eq!(&response, b"response");

    server_task.await.expect("server task should join");
}

#[cfg(windows)]
#[tokio::test]
async fn implicit_peer_validation_rejects_elevated_listener() {
    let temp = tempfile::TempDir::new().unwrap();
    let path = temp.path().join("socket");
    let mut listener = UnixListener::bind(&path).await.unwrap();
    let client = UnixStream::connect(&path).await.unwrap();
    let _server = listener.accept().await.unwrap();
    // PowerShell inherits our token and supplies an independent elevation oracle.
    let output = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", "([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"])
        .output().unwrap();
    assert!(output.status.success());
    let expected = match String::from_utf8(output.stdout).unwrap().trim() {
        "True" => Err(ErrorKind::PermissionDenied),
        "False" => Ok(()),
        other => panic!("unexpected elevation result: {other}"),
    };
    assert_eq!(
        client.ensure_non_elevated_peer().map_err(|err| err.kind()),
        expected
    );
}
