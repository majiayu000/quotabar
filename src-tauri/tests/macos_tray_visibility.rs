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

    // A per-run name keeps cleanup away from the real tray ids. The relaunch
    // below reuses this name with VisibleCC already false.
    let autosave_name = format!("quotabar-macos-tray-visibility-{}", std::process::id());
    let position_key =
        NSString::from_str(&format!("NSStatusItem Preferred Position {autosave_name}"));
    let visible_key = NSString::from_str(&format!("NSStatusItem Visible {autosave_name}"));
    let visible_cc_key = NSString::from_str(&format!("NSStatusItem VisibleCC {autosave_name}"));
    let defaults = NSUserDefaults::standardUserDefaults();
    let _clear_position = ClearStatusItemDefaults(autosave_name.clone());
    defaults.removeObjectForKey(&position_key);
    defaults.removeObjectForKey(&visible_key);
    defaults.removeObjectForKey(&visible_cc_key);
    defaults.setDouble_forKey(4242.0, &position_key);
    item.setLength(-1.0);
    native_tray::assign_autosave_name(&item, &autosave_name);
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
    // Next launch: hide persists VisibleCC=false, removeStatusItem leaves the
    // restored position, and a new item is assigned the same autosave name
    // before it is shown. Clearing VisibleCC here would skip that failure.
    native_tray::set_visible(&item, false);
    settle();
    assert!(!item.isVisible(), "item stayed visible before relaunch");
    assert_preferred_position(&defaults, &position_key, 4242.0);
    assert_visible_cc_false(&defaults, &visible_cc_key);
    bar.removeStatusItem(&item);
    settle();
    assert_preferred_position(&defaults, &position_key, 4242.0);
    assert_visible_cc_false(&defaults, &visible_cc_key);

    let relaunched = bar.statusItemWithLength(-1.0);
    relaunched
        .button(mtm)
        .expect("relaunched status button")
        .setTitle(&NSString::from_str("QB-test"));
    assert_visible_cc_false(&defaults, &visible_cc_key);
    native_tray::assign_autosave_name(&relaunched, &autosave_name);
    assert_preferred_position(&defaults, &position_key, 4242.0);
    native_tray::set_visible(&relaunched, true);
    NSRunLoop::currentRunLoop().runUntilDate(&NSDate::dateWithTimeIntervalSinceNow(1.0));
    assert!(relaunched.isVisible(), "relaunched item stayed hidden");
    assert_preferred_position(&defaults, &position_key, 4242.0);
    assert_eq!(
        button_window_origin_x(&relaunched, mtm),
        origin_x,
        "relaunch moved the status item"
    );

    native_tray::set_visible(&relaunched, false);
    bar.removeStatusItem(&relaunched);
    clear_status_item_defaults(&autosave_name);
    println!("PASS: zero-width control remained visible; 8 native hide/show cycles retained identity, title, nonzero button width, preferred position and window origin; relaunch with VisibleCC false kept the saved slot");
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
fn assert_visible_cc_false(defaults: &NSUserDefaults, key: &NSString) {
    assert!(
        defaults.objectForKey(key).is_some(),
        "VisibleCC was cleared before autosave assignment"
    );
    assert!(
        !defaults.boolForKey(key),
        "VisibleCC was not false before autosave assignment"
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
struct ClearStatusItemDefaults(String);

#[cfg(target_os = "macos")]
impl Drop for ClearStatusItemDefaults {
    fn drop(&mut self) {
        clear_status_item_defaults(&self.0);
    }
}

#[cfg(target_os = "macos")]
fn clear_status_item_defaults(autosave_name: &str) {
    let defaults = NSUserDefaults::standardUserDefaults();
    for suffix in [
        "NSStatusItem Preferred Position",
        "NSStatusItem Visible",
        "NSStatusItem VisibleCC",
    ] {
        defaults.removeObjectForKey(&NSString::from_str(&format!("{suffix} {autosave_name}")));
    }
    let _ = defaults.synchronize();
}

#[cfg(not(target_os = "macos"))]
fn main() {
    println!("SKIP: AppKit regression requires macOS");
}
