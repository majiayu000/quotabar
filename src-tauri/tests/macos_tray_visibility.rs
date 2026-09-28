//! QUOTABAR_NATIVE_TRAY_TEST=1 cargo test --test macos_tray_visibility
//! Exercises real AppKit objects; no quota accounts or saved app settings.
#[cfg(target_os = "macos")]
#[path = "../src/services/native_tray.rs"]
mod native_tray;

#[cfg(target_os = "macos")]
use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy, NSStatusBar, NSStatusItem};
#[cfg(target_os = "macos")]
use objc2_foundation::{MainThreadMarker, NSDate, NSRunLoop, NSString, NSUserDefaults};

#[cfg(target_os = "macos")]
fn main() {
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

    let autosave_name = "quotabar-macos-tray-visibility-test";
    let position_key =
        NSString::from_str(&format!("NSStatusItem Preferred Position {autosave_name}"));
    let defaults = NSUserDefaults::standardUserDefaults();
    let _clear_position = ClearPreferredPosition(position_key.to_string());
    defaults.removeObjectForKey(&position_key);
    defaults.setDouble_forKey(4242.0, &position_key);
    item.setLength(-1.0);
    item.setAutosaveName(Some(&NSString::from_str(autosave_name)));
    // The menu bar keeps the previous slot briefly, then applies the preferred position.
    NSRunLoop::currentRunLoop().runUntilDate(&NSDate::dateWithTimeIntervalSinceNow(1.0));
    assert_preferred_position(&defaults, &position_key, 4242.0);
    let origin_x = button_window_origin_x(&item, mtm);

    for cycle in 0..8 {
        native_tray::set_visible(&item, false);
        settle();
        assert!(
            !item.isVisible(),
            "hidden item still visible in cycle {cycle}"
        );
        assert_preferred_position(&defaults, &position_key, 4242.0);
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
        assert_preferred_position(&defaults, &position_key, 4242.0);
        assert_eq!(
            button_window_origin_x(&item, mtm),
            origin_x,
            "status item moved in cycle {cycle}"
        );
    }
    native_tray::set_visible(&item, false);
    bar.removeStatusItem(&item);
    defaults.removeObjectForKey(&position_key);
    println!("PASS: zero-width control remained visible; 8 native hide/show cycles retained identity, title, nonzero button width, preferred position and window origin");
}

#[cfg(target_os = "macos")]
fn assert_preferred_position(defaults: &NSUserDefaults, key: &NSString, expected: f64) {
    assert!(
        defaults.objectForKey(key).is_some(),
        "preferred position default was deleted"
    );
    assert_eq!(
        defaults.doubleForKey(key),
        expected,
        "preferred position default changed"
    );
}

#[cfg(target_os = "macos")]
fn button_window_origin_x(item: &NSStatusItem, mtm: MainThreadMarker) -> f64 {
    item.button(mtm)
        .expect("status button")
        .window()
        .expect("status button window")
        .frame()
        .origin
        .x
}

#[cfg(target_os = "macos")]
struct ClearPreferredPosition(String);

#[cfg(target_os = "macos")]
impl Drop for ClearPreferredPosition {
    fn drop(&mut self) {
        NSUserDefaults::standardUserDefaults().removeObjectForKey(&NSString::from_str(&self.0));
    }
}

#[cfg(not(target_os = "macos"))]
fn main() {
    println!("SKIP: AppKit regression requires macOS");
}
