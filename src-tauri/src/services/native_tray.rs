use objc2_app_kit::NSStatusItem;

/// Hide the item from menu-bar layout without destroying its native identity.
/// tray-icon's set_visible(false) removes the object instead. A zero length
/// does not change the native visibility state.
pub fn set_visible(item: &NSStatusItem, visible: bool) {
    if visible {
        item.setLength(-1.0); // NSVariableStatusItemLength
    }
    item.setVisible(visible);
}
