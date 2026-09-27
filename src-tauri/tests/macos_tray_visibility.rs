//! QUOTABAR_NATIVE_TRAY_TEST=1 cargo test --test macos_tray_visibility
//! Exercises real AppKit objects; no quota accounts or saved app settings.
#[cfg(target_os = "macos")]
#[path = "../src/services/native_tray.rs"]
mod native_tray;

#[cfg(target_os = "macos")]
fn main() {
    use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy, NSStatusBar};
    use objc2_foundation::{MainThreadMarker, NSDate, NSRunLoop, NSString};

    if std::env::var("QUOTABAR_NATIVE_TRAY_TEST").as_deref() != Ok("1") {
        println!("SKIP: set QUOTABAR_NATIVE_TRAY_TEST=1 in an interactive macOS session");
        return;
    }
    let mtm = MainThreadMarker::new().expect("native test must run on the main thread");
    let app = NSApplication::sharedApplication(mtm);
    app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);
    app.finishLaunching();
    let bar = NSStatusBar::systemStatusBar();
    let item = bar.statusItemWithLength(-1.0);
    item.button(mtm)
        .expect("status button")
        .setTitle(&NSString::from_str("QB-test"));
    let identity = &*item as *const _;
    let settle =
        || NSRunLoop::currentRunLoop().runUntilDate(&NSDate::dateWithTimeIntervalSinceNow(0.3));

    NSRunLoop::currentRunLoop().runUntilDate(&NSDate::dateWithTimeIntervalSinceNow(1.0));

    // The old approach leaves the status item visible, even with no content width.
    item.setVisible(true);
    item.setLength(0.0);
    settle();
    assert!(item.isVisible(), "zero width does not hide the native item");

    for cycle in 0..8 {
        native_tray::set_visible(&item, false);
        settle();
        assert!(
            !item.isVisible(),
            "hidden item still visible in cycle {cycle}"
        );
        native_tray::set_visible(&item, true);
        settle();
        assert!(item.isVisible(), "item failed to return in cycle {cycle}");
        assert_eq!(&*item as *const _, identity, "native identity changed");
        let button = item.button(mtm).expect("restored status button");
        assert_eq!(button.title().to_string(), "QB-test");
        assert!(
            button.frame().size.width > 0.0,
            "restored item has no width"
        );
    }
    native_tray::set_visible(&item, false);
    bar.removeStatusItem(&item);
    println!("PASS: zero-width control remained visible; 8 native hide/show cycles retained identity, title and nonzero button width");
}

#[cfg(not(target_os = "macos"))]
fn main() {
    println!("SKIP: AppKit regression requires macOS");
}
