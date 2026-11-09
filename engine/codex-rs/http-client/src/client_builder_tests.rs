use super::*;
use http::HeaderValue;
use std::io::Read;
use std::io::Write;
use std::path::PathBuf;

#[tokio::test]
async fn custom_ca_fallback_preserves_builder_configuration() {
    let listener =
        std::net::TcpListener::bind(("127.0.0.1", 0)).expect("HTTP listener should bind");
    let address = listener
        .local_addr()
        .expect("HTTP listener should have an address");
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("HTTP listener should accept");
        let mut request = Vec::new();
        let mut chunk = [0_u8; 1024];
        while !request.windows(4).any(|window| window == b"\r\n\r\n") {
            let bytes_read = stream.read(&mut chunk).expect("HTTP request should read");
            assert!(bytes_read > 0, "HTTP request should include headers");
            request.extend_from_slice(&chunk[..bytes_read]);
        }
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .expect("HTTP listener should write response");
        String::from_utf8(request).expect("HTTP request should be UTF-8")
    });
    let mut headers = HeaderMap::new();
    headers.insert("x-builder-test", HeaderValue::from_static("preserved"));
    let client = HttpClientBuilder::new()
        .default_headers(headers)
        .build_with_custom_ca_fallback_using(ProxyRouting::Direct, |_| {
            Err(BuildCustomCaTransportError::InvalidCaFile {
                source_env: "TEST_CA_ENV",
                path: PathBuf::from("invalid-test-ca.pem"),
                detail: "synthetic invalid CA".to_string(),
            })
        });

    let client = HttpClient {
        backend: HttpClientBackend::Direct(client),
    };

    let response = client
        .get(format!("http://{address}/fallback"))
        .send()
        .await
        .expect("fallback client should send request");
    assert!(response.status().is_success());
    let request = server.join().expect("HTTP listener should finish");
    assert!(
        request
            .lines()
            .any(|line| line.eq_ignore_ascii_case("x-builder-test: preserved"))
    );
}

#[tokio::test]
async fn native_redirect_authority_survives_legacy_custom_ca_fallback() {
    struct Authority(std::sync::Mutex<Vec<String>>);
    impl crate::NetworkPolicyAuthority for Authority {
        fn acquire(
            &self,
            url: &reqwest::Url,
        ) -> Result<crate::NetworkPermit, crate::NetworkPolicyDenied> {
            self.0.lock().unwrap().push(url.to_string());
            crate::NetworkPolicy::unmanaged().acquire(url)
        }
    }
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        use std::io::BufRead;
        for turn in 0..2 {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut reader = std::io::BufReader::new(&mut stream);
            let mut first = String::new();
            reader.read_line(&mut first).unwrap();
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
                assert!(!line.is_empty());
            }
            drop(reader);
            if turn == 0 {
                write!(stream,"HTTP/1.1 302 Redirect\r\nLocation: http://{address}/final\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
            } else {
                assert!(first.starts_with("GET /final "));
                stream
                    .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                    .unwrap();
            }
        }
    });
    let authority = Arc::new(Authority(std::sync::Mutex::new(Vec::new())));
    let built = HttpClientBuilder::new()
        .with_native_redirect_authority(authority.clone())
        .build_with_custom_ca_fallback_using(ProxyRouting::Direct, |_| {
            Err(BuildCustomCaTransportError::InvalidCaFile {
                source_env: "TEST_CA_ENV",
                path: PathBuf::from("invalid-test-ca.pem"),
                detail: "synthetic invalid CA".into(),
            })
        });
    let client = HttpClient {
        backend: HttpClientBackend::Direct(built),
    };
    assert!(
        client
            .get(format!("http://{address}/initial"))
            .send()
            .await
            .unwrap()
            .status()
            .is_success()
    );
    assert_eq!(
        authority.0.lock().unwrap().as_slice(),
        [format!("http://{address}/final")]
    );
    server.join().unwrap();
}
