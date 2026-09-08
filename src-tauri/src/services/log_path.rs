use std::path::PathBuf;

pub(crate) fn diagnostic_log_dir() -> Option<PathBuf> {
    resolve_diagnostic_log_dir(dirs::home_dir(), dirs::cache_dir(), dirs::data_local_dir())
}

pub(crate) fn resolve_diagnostic_log_dir(
    home_dir: Option<PathBuf>,
    cache_dir: Option<PathBuf>,
    data_local_dir: Option<PathBuf>,
) -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let _ = (cache_dir, data_local_dir);
        home_dir.map(|home| home.join("Library/Logs/quotabar"))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = home_dir;
        cache_dir.or(data_local_dir).map(|dir| dir.join("quotabar"))
    }
}

#[cfg(test)]
mod tests {
    use super::resolve_diagnostic_log_dir;
    use std::path::PathBuf;

    #[test]
    fn uses_os_correct_log_dir() {
        #[cfg(target_os = "macos")]
        {
            let dir = resolve_diagnostic_log_dir(
                Some(PathBuf::from("/Users/quota")),
                Some(PathBuf::from("/Users/quota/Library/Caches")),
                Some(PathBuf::from("/Users/quota/Library/Application Support")),
            )
            .expect("macOS log dir");
            assert_eq!(dir, PathBuf::from("/Users/quota/Library/Logs/quotabar"));
        }
        #[cfg(not(target_os = "macos"))]
        {
            let via_cache = resolve_diagnostic_log_dir(
                Some(PathBuf::from("/home/quota")),
                Some(PathBuf::from("/home/quota/.cache")),
                Some(PathBuf::from("/home/quota/.local/share")),
            )
            .expect("cache log dir");
            assert_eq!(via_cache, PathBuf::from("/home/quota/.cache/quotabar"));
            assert!(!via_cache
                .components()
                .any(|component| component.as_os_str() == "Library"));

            let via_data = resolve_diagnostic_log_dir(
                Some(PathBuf::from("/home/quota")),
                None,
                Some(PathBuf::from("/home/quota/.local/share")),
            )
            .expect("data-local log dir");
            assert_eq!(via_data, PathBuf::from("/home/quota/.local/share/quotabar"));
        }
    }

    #[test]
    fn skips_logging_when_os_dir_is_missing() {
        #[cfg(target_os = "macos")]
        {
            assert_eq!(
                resolve_diagnostic_log_dir(
                    None,
                    Some(PathBuf::from("/cache")),
                    Some(PathBuf::from("/data")),
                ),
                None
            );
        }
        #[cfg(not(target_os = "macos"))]
        {
            assert_eq!(
                resolve_diagnostic_log_dir(Some(PathBuf::from("/home/quota")), None, None),
                None
            );
        }
    }
}
