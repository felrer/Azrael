//! Thread-scoped immutable snapshots for explicitly attached inter-agent images.

use std::collections::HashMap;
use std::io::Cursor;
use std::io::Read;
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;

use base64::Engine;
use codex_exec_server::GetMetadataOptions;
use codex_exec_server::ReadFileOptions;
use codex_protocol::models::AgentMessageInputContent;
use codex_protocol::models::ContentItem;
use codex_protocol::models::ImageReference;
use codex_protocol::models::ResponseItem;
use codex_protocol::protocol::ImageAttachment;
use codex_utils_image::data_url_from_bytes;
use serde::Deserialize;
use sha2::Digest;
use sha2::Sha256;
use tokio::sync::Mutex;

use crate::function_tool::FunctionCallError;
use crate::session::session::Session;
use crate::session::step_context::StepContext;
use crate::tools::handlers::resolve_tool_environment;

const MAX_IMAGES: usize = 8;
const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES: usize = 40 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES: u64 = (MAX_IMAGE_BYTES as u64 * 4 / 3) + 4096;

#[derive(Debug, Deserialize)]
#[serde(untagged, deny_unknown_fields)]
pub(crate) enum ImageAttachmentInput {
    Path { path: String },
    Id { attachment_id: String },
}

#[derive(Default)]
struct RegisteredImages(Mutex<HashMap<String, ImageAttachment>>);

fn error(message: impl Into<String>) -> FunctionCallError {
    FunctionCallError::RespondToModel(message.into())
}

pub(crate) fn image_attachment_id(url: &str) -> String {
    format!("img_{:x}", Sha256::digest(url.as_bytes()))
}

fn valid_id(id: &str) -> bool {
    id.strip_prefix("img_").is_some_and(|hash| {
        hash.len() == 64
            && hash
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    })
}

/// Prepare transport-owned bytes without registering anything before delivery is accepted.
pub(crate) async fn prepare_attachments(
    session: &Arc<Session>,
    step: &StepContext,
    inputs: &[ImageAttachmentInput],
) -> Result<Vec<ImageAttachment>, FunctionCallError> {
    if inputs.len() > MAX_IMAGES {
        return Err(error("at most 8 image attachments are allowed per request"));
    }
    let mut images = Vec::with_capacity(inputs.len());
    let mut total = 0usize;
    for input in inputs {
        let (bytes, existing_url) = match input {
            ImageAttachmentInput::Path { path } => {
                let environment = resolve_tool_environment(
                    step,
                    None,
                    "image attachments are unavailable in this session",
                )?;
                let uri = environment.cwd().join(path).map_err(|err| {
                    error(format!("unable to resolve image attachment path: {err}"))
                })?;
                let sandbox = environment.sandbox_context(None);
                let fs = environment.environment.get_filesystem();
                let metadata = fs
                    .get_metadata(&uri, GetMetadataOptions::default(), Some(&sandbox))
                    .await
                    .map_err(|err| error(format!("unable to locate image attachment: {err}")))?;
                if !metadata.is_file {
                    return Err(error("image attachment path is not a file"));
                }
                if metadata.size > MAX_IMAGE_BYTES as u64
                    || metadata.size > (MAX_TOTAL_BYTES - total) as u64
                {
                    return Err(error(
                        "image attachments exceed the 20 MiB per image or 40 MiB request limit",
                    ));
                }
                let bytes = fs
                    .read_file(&uri, ReadFileOptions::default(), Some(&sandbox))
                    .await
                    .map_err(|err| error(format!("unable to read image attachment: {err}")))?;
                (bytes, None)
            }
            ImageAttachmentInput::Id { attachment_id } => {
                let image = resolve_registered(session, attachment_id).await?;
                let bytes = decode_data_url(&image.image_url)?;
                (bytes, Some(image.image_url))
            }
        };
        if bytes.len() > MAX_IMAGE_BYTES || bytes.len() > MAX_TOTAL_BYTES - total {
            return Err(error(
                "image attachments exceed the 20 MiB per image or 40 MiB request limit",
            ));
        }
        total += bytes.len();
        images.push((bytes, existing_url));
    }
    // Check the entire encoded request before any image decompression.
    images
        .into_iter()
        .map(|(bytes, existing_url)| {
            let mime = validate_image(&bytes)?;
            let image_url = existing_url.unwrap_or_else(|| data_url_from_bytes(mime, &bytes));
            Ok(ImageAttachment {
                attachment_id: image_attachment_id(&image_url),
                image_url,
            })
        })
        .collect()
}

fn decode_data_url(url: &str) -> Result<Vec<u8>, FunctionCallError> {
    if url.len() as u64 > MAX_SNAPSHOT_BYTES {
        return Err(error("image attachment exceeds the 20 MiB limit"));
    }
    let (header, encoded) = url
        .split_once(',')
        .ok_or_else(|| error("invalid image data URL"))?;
    if !header.starts_with("data:") || !header.ends_with(";base64") {
        return Err(error(
            "only inline base64 image snapshots can be attached; file-backed and remote image references are unsupported",
        ));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| error("invalid image attachment base64"))?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(error("image attachment exceeds the 20 MiB limit"));
    }
    Ok(bytes)
}

fn validate_image(bytes: &[u8]) -> Result<&'static str, FunctionCallError> {
    let mut reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| error("invalid image attachment"))?;
    let format = reader
        .format()
        .ok_or_else(|| error("attachment is not a supported image"))?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(16_384);
    limits.max_image_height = Some(16_384);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    reader
        .decode()
        .map_err(|_| error("invalid image attachment or decoded image exceeds safety limits"))?;
    Ok(format.to_mime_type())
}

async fn resolve_registered(
    session: &Arc<Session>,
    id: &str,
) -> Result<ImageAttachment, FunctionCallError> {
    if !valid_id(id) {
        return Err(error("invalid image attachment ID"));
    }
    let cache = session
        .services
        .thread_extension_data
        .get_or_init(RegisteredImages::default);
    if let Some(image) = cache.0.lock().await.get(id).cloned() {
        return Ok(image);
    }
    let config = session.get_config().await;
    if !config.ephemeral {
        let directory =
            snapshot_directory(config.codex_home.as_path(), session.thread_id(), false)?;
        if let Some(directory) = directory
            && let Some(image) = read_snapshot(&directory.join(format!("{id}.json")))?
        {
            return Ok(image);
        }
    }
    let history = session.clone_history().await;
    for item in history.raw_items().rev() {
        let images: Vec<&ImageReference> = match item {
            ResponseItem::Message { content, .. } => content
                .iter()
                .filter_map(|part| {
                    if let ContentItem::InputImage { image, .. } = part {
                        Some(image)
                    } else {
                        None
                    }
                })
                .collect(),
            ResponseItem::AgentMessage { content, .. } => content
                .iter()
                .filter_map(|part| {
                    if let AgentMessageInputContent::InputImage { image, .. } = part {
                        Some(image)
                    } else {
                        None
                    }
                })
                .collect(),
            _ => Vec::new(),
        };
        for image in images {
            if let ImageReference::Inline { image_url } = image
                && image_attachment_id(image_url) == id
            {
                return Ok(ImageAttachment {
                    attachment_id: id.to_owned(),
                    image_url: image_url.clone(),
                });
            }
        }
    }
    Err(error(format!(
        "image attachment `{id}` is not registered in this sender thread or its current inline image history"
    )))
}

/// Call only after accepted delivery. A registration error must never imply delivery failed.
pub(crate) async fn commit_attachments(
    session: &Session,
    attachments: &[ImageAttachment],
) -> Result<(), FunctionCallError> {
    if attachments.is_empty() {
        return Ok(());
    }
    let cache = session
        .services
        .thread_extension_data
        .get_or_init(RegisteredImages::default);
    let mut registered = cache.0.lock().await;
    let config = session.get_config().await;
    for image in attachments {
        if image_attachment_id(&image.image_url) != image.attachment_id {
            return Err(error(
                "image attachment snapshot ID does not match its contents",
            ));
        }
        registered.insert(image.attachment_id.clone(), image.clone());
    }
    if config.ephemeral {
        return Ok(());
    }
    drop(registered);
    let live_thread = session
        .live_thread()
        .ok_or_else(|| error("image snapshot persistence requires a live thread writer"))?;
    live_thread
        .write_local_thread_data(|| {
            let write = || -> Result<(), FunctionCallError> {
                let directory =
                    snapshot_directory(config.codex_home.as_path(), session.thread_id(), true)?
                        .ok_or_else(|| error("image attachment directory was not created"))?;
                for image in attachments {
                    write_snapshot(&directory, image)?;
                }
                Ok(())
            };
            write().map_err(|err| codex_thread_store::ThreadStoreError::Internal {
                message: err.to_string(),
            })
        })
        .await
        .map_err(|err| {
            error(format!(
                "unable to persist image attachment snapshot: {err}"
            ))
        })
}

fn no_link(metadata: &std::fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return false;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return false;
        }
    }
    true
}

fn snapshot_directory(
    home: &Path,
    thread: codex_protocol::ThreadId,
    create: bool,
) -> Result<Option<PathBuf>, FunctionCallError> {
    let home = std::fs::canonicalize(home)
        .map_err(|err| error(format!("unable to resolve attachment home: {err}")))?;
    let mut directory = home.clone();
    for component in ["image_attachments".to_owned(), thread.to_string()] {
        directory.push(component);
        if create {
            match std::fs::create_dir(&directory) {
                Ok(()) => {}
                Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(err) => {
                    return Err(error(format!(
                        "unable to create image attachment directory: {err}"
                    )));
                }
            }
        }
        let metadata = match std::fs::symlink_metadata(&directory) {
            Ok(metadata) => metadata,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(err) => {
                return Err(error(format!(
                    "unable to inspect image attachment directory: {err}"
                )));
            }
        };
        if !no_link(&metadata)
            || !metadata.is_dir()
            || std::fs::canonicalize(&directory).map_err(|err| error(err.to_string()))? != directory
        {
            return Err(error("unsafe image attachment directory"));
        }
    }
    Ok(Some(directory))
}

fn read_snapshot(path: &Path) -> Result<Option<ImageAttachment>, FunctionCallError> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(error(format!("unable to inspect image snapshot: {err}"))),
    };
    if !no_link(&metadata) || !metadata.is_file() || metadata.len() > MAX_SNAPSHOT_BYTES {
        return Err(error("unsafe or oversized image attachment snapshot"));
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .and_then(|file| file.take(MAX_SNAPSHOT_BYTES + 1).read_to_end(&mut bytes))
        .map_err(|err| error(format!("unable to read image snapshot: {err}")))?;
    if bytes.len() as u64 > MAX_SNAPSHOT_BYTES {
        return Err(error("oversized image attachment snapshot"));
    }
    let image: ImageAttachment =
        serde_json::from_slice(&bytes).map_err(|_| error("invalid image attachment snapshot"))?;
    if image_attachment_id(&image.image_url) != image.attachment_id
        || path.file_stem().and_then(|stem| stem.to_str()) != Some(image.attachment_id.as_str())
    {
        return Err(error("image attachment snapshot identity mismatch"));
    }
    Ok(Some(image))
}

fn write_snapshot(directory: &Path, image: &ImageAttachment) -> Result<(), FunctionCallError> {
    let path = directory.join(format!("{}.json", image.attachment_id));
    if let Some(existing) = read_snapshot(&path)? {
        if existing != *image {
            return Err(error("image snapshot cannot be overwritten"));
        }
        return Ok(());
    }
    let bytes = serde_json::to_vec(image).map_err(|err| error(err.to_string()))?;
    if bytes.len() as u64 > MAX_SNAPSHOT_BYTES {
        return Err(error("oversized image attachment snapshot"));
    }
    let mut temporary = tempfile::Builder::new()
        .prefix(".image-")
        .tempfile_in(directory)
        .map_err(|err| error(format!("unable to create image snapshot: {err}")))?;
    temporary
        .write_all(&bytes)
        .and_then(|()| temporary.as_file().sync_all())
        .map_err(|err| error(format!("unable to write image snapshot: {err}")))?;
    match temporary.persist_noclobber(&path) {
        Ok(_) => Ok(()),
        Err(err) if err.error.kind() == std::io::ErrorKind::AlreadyExists => {
            if read_snapshot(&path)?.as_ref() == Some(image) {
                Ok(())
            } else {
                Err(error(
                    "image snapshot already exists with different contents",
                ))
            }
        }
        Err(err) => Err(error(format!(
            "unable to persist image snapshot: {}",
            err.error
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::tests::make_session_and_context_with_auth_and_config_and_rx;
    use codex_login::CodexAuth;
    use codex_protocol::models::PermissionProfile;
    use core_test_support::TempDirExt;

    // Retain these entry-point checks: changing snapshot timing or simplifying ID lookup
    // could accidentally restore dependencies on mutable original files or persist ephemeral data.
    #[tokio::test(flavor = "multi_thread")]
    async fn prepared_image_survives_original_deletion_and_registered_cache_loss() {
        exercise_snapshot_round_trip(false).await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn ephemeral_image_is_registered_only_in_its_session_cache() {
        exercise_snapshot_round_trip(true).await;
    }

    async fn exercise_snapshot_round_trip(ephemeral: bool) {
        // The session helpers discard their own temporary home on return. Override it
        // with this fixture, which stays alive through every filesystem operation.
        let fixture = tempfile::tempdir().expect("image attachment fixture");
        let fixture_home = fixture.abs().join("home");
        let fixture_workspace = fixture.abs().join("workspace");
        std::fs::create_dir(fixture_home.as_path()).expect("fixture home");
        std::fs::create_dir(fixture_workspace.as_path()).expect("fixture workspace");
        {
            let config_home = fixture_home.clone();
            let config_workspace = fixture_workspace.clone();
            let (mut session, turn, _events) =
                make_session_and_context_with_auth_and_config_and_rx(
                    CodexAuth::from_api_key("Test API Key"),
                    Vec::new(),
                    move |config| {
                        config.codex_home = config_home;
                        config.cwd = config_workspace;
                        config.ephemeral = ephemeral;
                        config
                            .permissions
                            .set_permission_profile(PermissionProfile::Disabled)
                            .expect("disable fixture filesystem sandbox");
                    },
                )
                .await;
            if !ephemeral {
                let thread_id = session.thread_id();
                let live_thread = codex_thread_store::LiveThread::create(
                    Arc::clone(&session.services.thread_store),
                    codex_thread_store::CreateThreadParams {
                        role_profile: None,
                        computer_use_mode: None,
                        creator_user_id: None,
                        creator_account_id: None,
                        session_id: thread_id.into(),
                        thread_id,
                        extra_config: None,
                        forked_from_id: None,
                        parent_thread_id: None,
                        source: codex_protocol::protocol::SessionSource::Exec,
                        thread_source: None,
                        originator: "image-attachment-test".to_owned(),
                        base_instructions: Default::default(),
                        dynamic_tools: Vec::new(),
                        selected_capability_roots: Vec::new(),
                        multi_agent_version: None,
                        history_mode: codex_protocol::protocol::ThreadHistoryMode::Legacy,
                        history_base: None,
                        subagent_history_start_ordinal: None,
                        initial_window_id: uuid::Uuid::now_v7().to_string(),
                        runtime_workspace_roots: None,
                        metadata: codex_thread_store::ThreadPersistenceMetadata {
                            cwd: Some(fixture_workspace.to_path_buf()),
                            model_provider: "test-provider".to_owned(),
                            memory_mode: codex_protocol::protocol::ThreadMemoryMode::Disabled,
                        },
                    },
                )
                .await
                .expect("create actual fixture thread writer");
                Arc::get_mut(&mut session)
                    .expect("fixture owns session exclusively")
                    .services
                    .live_thread = Some(live_thread);
            }
            let step = StepContext::for_test(turn);
            let original_path = fixture_workspace.join("original.png");
            let mut png = Cursor::new(Vec::new());
            image::DynamicImage::new_rgb8(1, 1)
                .write_to(&mut png, image::ImageFormat::Png)
                .expect("encode fixture PNG");
            std::fs::write(original_path.as_path(), png.get_ref()).expect("write original PNG");
            let prepared = prepare_attachments(
                &session,
                &step,
                &[ImageAttachmentInput::Path {
                    path: "original.png".to_owned(),
                }],
            )
            .await
            .expect("prepare actual local image");
            assert_eq!(prepared.len(), 1);
            assert_eq!(
                decode_data_url(&prepared[0].image_url).unwrap(),
                *png.get_ref()
            );
            let snapshot_root = fixture_home.join("image_attachments");
            assert!(
                !snapshot_root.as_path().exists(),
                "preparation must not persist rejected delivery data"
            );
            let id_input = [ImageAttachmentInput::Id {
                attachment_id: prepared[0].attachment_id.clone(),
            }];
            assert!(
                prepare_attachments(&session, &step, &id_input)
                    .await
                    .is_err(),
                "preparation alone must not register an ID"
            );

            std::fs::write(original_path.as_path(), b"changed original").expect("mutate original");
            std::fs::remove_file(original_path.as_path()).expect("delete original");
            commit_attachments(&session, &prepared)
                .await
                .expect("register accepted snapshot");
            let resolved = prepare_attachments(&session, &step, &id_input)
                .await
                .expect("resolve registered image ID");
            assert_eq!(resolved, prepared);
            let unknown = [ImageAttachmentInput::Id {
                attachment_id: image_attachment_id("unregistered"),
            }];
            assert!(
                prepare_attachments(&session, &step, &unknown)
                    .await
                    .is_err()
            );

            session
                .services
                .thread_extension_data
                .remove::<RegisteredImages>();
            if ephemeral {
                assert!(
                    !snapshot_root.as_path().exists(),
                    "ephemeral snapshots must never touch durable storage"
                );
                assert!(
                    prepare_attachments(&session, &step, &id_input)
                        .await
                        .is_err()
                );
            } else {
                let snapshot_path = snapshot_root
                    .join(session.thread_id().to_string())
                    .join(format!("{}.json", prepared[0].attachment_id));
                assert!(snapshot_path.as_path().is_file());
                assert_eq!(
                    prepare_attachments(&session, &step, &id_input)
                        .await
                        .expect("resolve durable snapshot without cache"),
                    prepared
                );
                session
                    .live_thread()
                    .expect("fixture live writer")
                    .discard()
                    .await
                    .expect("release fixture thread writer");
            }
        }
        fixture
            .close()
            .expect("remove image attachment fixture after session drop");
    }

    #[test]
    fn input_requires_exactly_one_selector() {
        for input in [
            r#"{}"#,
            r#"{"path":"a","attachment_id":"b"}"#,
            r#"{"path":"a","unknown":1}"#,
        ] {
            assert!(serde_json::from_str::<ImageAttachmentInput>(input).is_err());
        }
        assert!(serde_json::from_str::<ImageAttachmentInput>(r#"{"path":"a"}"#).is_ok());
        assert!(serde_json::from_str::<ImageAttachmentInput>(r#"{"attachment_id":"a"}"#).is_ok());
    }

    #[test]
    fn snapshot_identity_and_bytes_are_immutable() {
        assert_eq!(
            image_attachment_id("abc"),
            "img_ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let home = tempfile::tempdir().expect("temporary home");
        let thread = codex_protocol::ThreadId::new();
        let directory = snapshot_directory(home.path(), thread, true)
            .unwrap()
            .unwrap();
        let url = data_url_from_bytes("image/png", b"original bytes");
        let image = ImageAttachment {
            attachment_id: image_attachment_id(&url),
            image_url: url,
        };
        write_snapshot(&directory, &image).unwrap();
        write_snapshot(&directory, &image).unwrap();
        let changed = ImageAttachment {
            attachment_id: image.attachment_id.clone(),
            image_url: "changed".to_owned(),
        };
        assert!(write_snapshot(&directory, &changed).is_err());
        assert_eq!(
            read_snapshot(&directory.join(format!("{}.json", image.attachment_id))).unwrap(),
            Some(image)
        );
        home.close().expect("remove temporary home");
    }

    #[test]
    fn invalid_or_unbounded_image_data_is_rejected() {
        assert!(validate_image(b"plain text").is_err());
        assert!(decode_data_url("https://example.com/image.png").is_err());
        assert!(decode_data_url("data:image/png;base64,!").is_err());
        let mut png = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(1, 1)
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        assert_eq!(validate_image(png.get_ref()).unwrap(), "image/png");
        let url = data_url_from_bytes("image/png", png.get_ref());
        assert_eq!(decode_data_url(&url).unwrap(), *png.get_ref());
    }
}
