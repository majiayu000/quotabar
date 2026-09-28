use objc2_app_kit::NSStatusItem;
use objc2_foundation::{NSObjectNSKeyValueCoding, NSString, NSUserDefaults};

/// Hide the item from menu-bar layout without destroying its native identity.
/// tray-icon's set_visible(false) removes the object instead. A zero length
/// does not change the native visibility state.
pub fn set_visible(item: &NSStatusItem, visible: bool) {
    // setVisible deletes `NSStatusItem Preferred Position <autosaveName>`.
    // Write that value back so the item returns to the same menu-bar slot.
    let defaults = NSUserDefaults::standardUserDefaults();
    let position_key = preferred_position_key(item).map(|key| NSString::from_str(&key));
    let saved_position = position_key.as_deref().and_then(|key| {
        defaults
            .objectForKey(key)
            .map(|_| defaults.doubleForKey(key))
    });

    if visible {
        item.setLength(-1.0); // NSVariableStatusItemLength
    }
    item.setVisible(visible);

    if let (Some(key), Some(position)) = (position_key.as_deref(), saved_position) {
        defaults.setDouble_forKey(position, key);
    }
}

fn preferred_position_key(item: &NSStatusItem) -> Option<String> {
    let name = autosave_name(item)?;
    Some(format!("NSStatusItem Preferred Position {name}"))
}

fn autosave_name(item: &NSStatusItem) -> Option<String> {
    // The generated getter panics when AppKit returns nil. KVC preserves that.
    let value = NSObjectNSKeyValueCoding::valueForKey(
        std::ops::Deref::deref(item),
        &NSString::from_str("autosaveName"),
    )?;
    let name = value.downcast::<NSString>().ok()?.to_string();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}
