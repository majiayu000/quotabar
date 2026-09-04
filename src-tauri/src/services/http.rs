//! Shared reqwest client + transient OS error detection.
//!
//! All provider services route HTTP through `shared_http_client()` so we keep a
//! single bounded connection pool. Default reqwest pool size is unbounded, which
//! combined with 4 services polling on independent timers used to push the
//! per-process FD count uncomfortably close to the macOS 256 soft limit.

use std::io::ErrorKind;
use std::sync::OnceLock;
use std::time::Duration;

pub fn shared_http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        match reqwest::Client::builder()
            .pool_max_idle_per_host(4)
            .pool_idle_timeout(Duration::from_secs(30))
            .timeout(Duration::from_secs(10))
            .build()
        {
            Ok(client) => client,
            Err(err) => {
                eprintln!("[HTTP] failed to build shared reqwest client: {err}");
                reqwest::Client::new()
            }
        }
    })
}

/// Recognize transient OS errors that should not surface to the UI:
/// EMFILE, ENFILE, EAGAIN / EWOULDBLOCK.
/// These typically clear themselves within one poll cycle as the kernel
/// reclaims descriptors / restarts blocked syscalls.
pub fn is_transient_os_error(message: &str) -> bool {
    message.contains("Too many open files")
        || message.contains("Resource temporarily unavailable")
        || parsed_os_error_code(message).is_some_and(is_transient_os_code)
}

/// Walk an error chain so reqwest/hyper wrappers still count as transient
/// when the underlying IO error is EMFILE / EAGAIN.
pub fn error_is_transient(error: &(dyn std::error::Error + 'static)) -> bool {
    let mut current: Option<&(dyn std::error::Error + 'static)> = Some(error);
    while let Some(err) = current {
        if let Some(io_error) = err.downcast_ref::<std::io::Error>() {
            if io_error_is_transient(io_error) {
                return true;
            }
        }
        if is_transient_os_error(&err.to_string()) {
            return true;
        }
        current = err.source();
    }
    false
}

fn io_error_is_transient(error: &std::io::Error) -> bool {
    matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::Interrupted)
        || error.raw_os_error().is_some_and(is_transient_os_code)
}

fn parsed_os_error_code(message: &str) -> Option<i32> {
    const MARKER: &str = "os error ";
    let start = message.find(MARKER)? + MARKER.len();
    let digits: String = message[start..]
        .chars()
        .take_while(|ch| ch.is_ascii_digit())
        .collect();
    if digits.is_empty() {
        return None;
    }
    digits.parse().ok()
}

fn is_transient_os_code(code: i32) -> bool {
    #[cfg(unix)]
    {
        code == libc::EMFILE
            || code == libc::ENFILE
            || code == libc::EAGAIN
            || code == libc::EWOULDBLOCK
    }
    #[cfg(not(unix))]
    {
        matches!(code, 11 | 23 | 24)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Error, ErrorKind};

    #[test]
    fn detects_emfile_messages() {
        assert!(is_transient_os_error(
            "Failed to read auth.json: Too many open files (os error 24)"
        ));
        #[cfg(target_os = "macos")]
        assert!(is_transient_os_error("Network error: os error 35"));
        #[cfg(target_os = "linux")]
        assert!(is_transient_os_error("os error 11"));
    }

    #[test]
    fn rejects_other_errors_and_digit_prefixes() {
        assert!(!is_transient_os_error("API error: 429 Too Many Requests"));
        assert!(!is_transient_os_error("Token expired"));
        assert!(!is_transient_os_error("Network error: os error 60"));
        assert!(!is_transient_os_error("Network error: os error 240"));
        assert!(!is_transient_os_error("Network error: os error 230"));
        #[cfg(all(unix, not(target_os = "macos")))]
        assert!(!is_transient_os_error("os error 35"));
    }

    #[test]
    fn walks_io_source_chain() {
        assert!(io_error_is_transient(&Error::new(
            ErrorKind::WouldBlock,
            "blocked"
        )));
        assert!(!error_is_transient(&Error::new(
            ErrorKind::TimedOut,
            "timed out"
        )));
        #[cfg(unix)]
        {
            let io_error = Error::from_raw_os_error(libc::EMFILE);
            assert!(error_is_transient(&io_error));
        }
    }
}
