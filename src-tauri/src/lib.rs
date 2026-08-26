use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, Rect, Url, WebviewWindow, WindowEvent,
};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::process::Command;

const DEFAULT_APP_URL: &str = "https://vibe-curator-production.up.railway.app";

/// The part of the status popover that belongs to the native host. Playback
/// details are deliberately owned by the wallpaper renderer and arrive over
/// `vibe://audio/*` events.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeControlsSnapshot {
    wallpaper_visible: bool,
    desktop_icons_visible: bool,
}

struct NativeControlsState(Mutex<NativeControlsSnapshot>);

/// Commands accepted by the small native-controls webview.
///
/// Renderer event contract:
/// - native -> wallpaper: `vibe://audio/start`, `vibe://audio/stop`,
///   `vibe://audio/set-master-volume` (number 0..1), and
///   `vibe://audio/set-muted` (boolean). The context menu also emits its
///   legacy `vibe://set-sound-muted` equivalent for older wallpaper builds.
/// - wallpaper -> native-controls: `vibe://audio/status`,
///   `vibe://audio/current-preset`, and `vibe://audio/volume`.
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase")]
enum NativeControlsAction {
    Start,
    Stop,
    SetMasterVolume { volume: f64 },
    SetWallpaperVisible { visible: bool },
    SetDesktopIconsVisible { visible: bool },
    OpenEditor,
}

fn hosted_url(path: &str, query: Option<&str>) -> Result<Url, String> {
    let base = if cfg!(debug_assertions) {
        "http://localhost:5178"
    } else {
        option_env!("VIBE_APP_URL").unwrap_or(DEFAULT_APP_URL)
    };
    let mut url = Url::parse(base).map_err(|error| format!("Invalid VIBE_APP_URL: {error}"))?;
    if !cfg!(debug_assertions) && url.scheme() != "https" {
        return Err("VIBE_APP_URL must use HTTPS in release builds".into());
    }
    url.set_path(path);
    url.set_query(query);
    Ok(url)
}

#[cfg(target_os = "macos")]
mod macos {
    use objc2::{msg_send, runtime::AnyObject};
    use std::ffi::c_void;
    use tauri::WebviewWindow;

    // CGWindowLevelKey::desktopIconWindow. One level below this keeps Finder's
    // icons clickable while placing the live surface above Apple's wallpaper.
    const DESKTOP_ICON_WINDOW_LEVEL_KEY: i32 = 18;
    const WALLPAPER_COLLECTION_BEHAVIOR: usize = (1 << 0) | (1 << 4) | (1 << 6) | (1 << 8);

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGWindowLevelForKey(key: i32) -> i32;
    }

    pub fn set_desktop_level(window: &WebviewWindow, enabled: bool) -> Result<(), String> {
        let pointer = window.ns_window().map_err(|error| error.to_string())? as *mut c_void;
        let native = pointer.cast::<AnyObject>();
        if native.is_null() {
            return Err("macOS did not return a native wallpaper window".into());
        }

        unsafe {
            let level = if enabled {
                CGWindowLevelForKey(DESKTOP_ICON_WINDOW_LEVEL_KEY) - 1
            } else {
                0
            };
            let ignores_mouse = enabled;
            let _: () = msg_send![native, setLevel: level as isize];
            let _: () = msg_send![native, setIgnoresMouseEvents: ignores_mouse];
            if enabled {
                let _: () = msg_send![native, setCollectionBehavior: WALLPAPER_COLLECTION_BEHAVIOR];
                let _: () = msg_send![native, orderFrontRegardless];
            }
        }
        Ok(())
    }

    pub fn set_click_through(window: &WebviewWindow, enabled: bool) -> Result<(), String> {
        let pointer = window.ns_window().map_err(|error| error.to_string())? as *mut c_void;
        let native = pointer.cast::<AnyObject>();
        if native.is_null() {
            return Err("macOS did not return a native wallpaper window".into());
        }
        unsafe {
            let _: () = msg_send![native, setIgnoresMouseEvents: enabled];
        }
        Ok(())
    }

    pub fn set_desktop_icons_hidden(window: &WebviewWindow, hidden: bool) -> Result<(), String> {
        let pointer = window.ns_window().map_err(|error| error.to_string())? as *mut c_void;
        let native = pointer.cast::<AnyObject>();
        if native.is_null() {
            return Err("macOS did not return a native wallpaper window".into());
        }
        unsafe {
            // This only changes our surface's stacking order. Finder and every
            // file on the Desktop remain untouched.
            let icon_level = CGWindowLevelForKey(DESKTOP_ICON_WINDOW_LEVEL_KEY);
            let level = if hidden { icon_level + 1 } else { icon_level - 1 };
            let _: () = msg_send![native, setLevel: level as isize];
            let _: () = msg_send![native, orderFrontRegardless];
        }
        Ok(())
    }
}

fn window_for_command(window: WebviewWindow) -> WebviewWindow {
    window
}

fn size_to_current_monitor(window: &WebviewWindow) -> Result<(), String> {
    if let Some(monitor) = window.current_monitor().map_err(|error| error.to_string())? {
        window
            .set_position(*monitor.position())
            .map_err(|error| error.to_string())?;
        window
            .set_size(*monitor.size())
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn activation_token_from_args(args: &[String]) -> Option<String> {
    args.iter().find_map(|value| {
        let url = Url::parse(value).ok()?;
        if url.scheme() != "vibecurator" || url.host_str() != Some("open") {
            return None;
        }
        let token = url
            .query_pairs()
            .find(|(key, _)| key == "activation")?
            .1
            .into_owned();
        (token.len() == 64 && token.chars().all(|character| character.is_ascii_hexdigit()))
            .then_some(token.to_ascii_lowercase())
    })
}

fn prepare_wallpaper_activation(window: &WebviewWindow) -> Result<(), String> {
    window.set_decorations(false).map_err(|error| error.to_string())?;
    window
        .set_simple_fullscreen(false)
        .map_err(|error| error.to_string())?;
    size_to_current_monitor(window)?;
    #[cfg(target_os = "macos")]
    {
        // Attach to the actual desktop immediately, but leave mouse input on
        // until the user gesture required by Web Audio has been received.
        macos::set_desktop_level(window, true)?;
        macos::set_click_through(window, false)?;
    }
    window.set_focusable(true).map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

fn activate_transfer_for_app(app: &AppHandle, token: &str) -> Result<(), String> {
    if token.len() != 64 || !token.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err("Invalid native activation".into());
    }
    let window = app
        .get_webview_window("wallpaper")
        .ok_or_else(|| "Wallpaper window is unavailable".to_string())?;
    prepare_wallpaper_activation(&window)?;
    app.emit_to(
        "wallpaper",
        "vibe://activate-transfer",
        serde_json::json!({ "token": token.to_ascii_lowercase() }),
    )
    .map_err(|error| error.to_string())
}

fn open_web_editor() -> Result<(), String> {
    let url = hosted_url("/explore", None)?.to_string();
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut value = Command::new("cmd");
        value.args(["/C", "start", ""]);
        value
    };
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let mut command = Command::new("xdg-open");
    command.arg(url).spawn().map_err(|error| error.to_string())?;
    Ok(())
}

/// A tiny alpha-only three-bar mark. macOS treats it as a template image, so
/// the system supplies the correct light/dark menu-bar color and it never
/// grows into a text title near the notch.
fn status_item_icon() -> tauri::image::Image<'static> {
    const SIZE: usize = 18;
    let mut rgba = vec![0_u8; SIZE * SIZE * 4];
    let bars = [(3_usize, 7_usize), (8, 12), (13, 9)];
    for (x, height) in bars {
        let top = (SIZE - height) / 2;
        for y in top..top + height {
            for dx in 0..2 {
                let index = ((y * SIZE) + x + dx) * 4;
                rgba[index..index + 4].copy_from_slice(&[255, 255, 255, 255]);
            }
        }
    }
    tauri::image::Image::new_owned(rgba, SIZE as u32, SIZE as u32)
}

fn native_controls_snapshot(app: &AppHandle) -> Result<NativeControlsSnapshot, String> {
    app.state::<NativeControlsState>()
        .0
        .lock()
        .map_err(|_| "Native controls state is unavailable".to_string())
        .map(|state| state.clone())
}

fn emit_native_controls_snapshot(app: &AppHandle) -> Result<(), String> {
    let snapshot = native_controls_snapshot(app)?;
    app.emit_to("native-controls", "vibe://native-controls/snapshot", snapshot)
        .map_err(|error| error.to_string())
}

fn show_native_controls(app: &AppHandle, anchor: Option<Rect>) -> Result<(), String> {
    let window = app
        .get_webview_window("native-controls")
        .ok_or_else(|| "Native controls window is unavailable".to_string())?;

    if let Some(anchor) = anchor {
        let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
        let anchor_position = anchor.position.to_physical::<f64>(scale_factor);
        let anchor_size = anchor.size.to_physical::<f64>(scale_factor);
        let size = window.outer_size().map_err(|error| error.to_string())?;
        let x = anchor_position.x + (anchor_size.width - f64::from(size.width)) / 2.0;
        let y = anchor_position.y + anchor_size.height + 8.0;
        window
            .set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))
            .map_err(|error| error.to_string())?;
    }

    emit_native_controls_snapshot(app)?;
    // The renderer uses these three events to keep this popover current. The
    // request is intentionally one-way: native owns visibility; the renderer
    // owns its scene/audio details.
    app.emit_to("wallpaper", "vibe://native-controls/request-state", ())
        .map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

fn hide_native_controls(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("native-controls") {
        let _ = window.hide();
    }
}

#[tauri::command]
fn native_controls_snapshot_command(app: AppHandle) -> Result<NativeControlsSnapshot, String> {
    native_controls_snapshot(&app)
}

#[tauri::command]
fn native_controls_close(app: AppHandle) {
    hide_native_controls(&app);
}

#[tauri::command]
fn native_controls_dispatch(app: AppHandle, action: NativeControlsAction) -> Result<(), String> {
    match action {
        NativeControlsAction::Start => app
            .emit_to("wallpaper", "vibe://audio/start", ())
            .map_err(|error| error.to_string()),
        NativeControlsAction::Stop => app
            .emit_to("wallpaper", "vibe://audio/stop", ())
            .map_err(|error| error.to_string()),
        NativeControlsAction::SetMasterVolume { volume } => {
            if !(0.0..=1.0).contains(&volume) {
                return Err("Master volume must be between 0 and 1".into());
            }
            app.emit_to("wallpaper", "vibe://audio/set-master-volume", volume)
                .map_err(|error| error.to_string())
        }
        NativeControlsAction::SetWallpaperVisible { visible } => {
            let window = app
                .get_webview_window("wallpaper")
                .ok_or_else(|| "Wallpaper window is unavailable".to_string())?;
            if visible {
                window.show().map_err(|error| error.to_string())?;
            } else {
                window.hide().map_err(|error| error.to_string())?;
            }
            app.state::<NativeControlsState>()
                .0
                .lock()
                .map_err(|_| "Native controls state is unavailable".to_string())?
                .wallpaper_visible = visible;
            emit_native_controls_snapshot(&app)
        }
        NativeControlsAction::SetDesktopIconsVisible { visible } => {
            let window = app
                .get_webview_window("wallpaper")
                .ok_or_else(|| "Wallpaper window is unavailable".to_string())?;
            #[cfg(target_os = "macos")]
            macos::set_desktop_icons_hidden(&window, !visible)?;
            #[cfg(not(target_os = "macos"))]
            let _ = window;
            app.state::<NativeControlsState>()
                .0
                .lock()
                .map_err(|_| "Native controls state is unavailable".to_string())?
                .desktop_icons_visible = visible;
            emit_native_controls_snapshot(&app)
        }
        NativeControlsAction::OpenEditor => {
            open_web_editor()?;
            hide_native_controls(&app);
            Ok(())
        }
    }
}

#[tauri::command]
fn enter_wallpaper_mode(window: WebviewWindow) -> Result<(), String> {
    let window = window_for_command(window);
    window
        .set_decorations(false)
        .map_err(|error| error.to_string())?;
    #[cfg(not(target_os = "macos"))]
    window
        .set_always_on_bottom(true)
        .map_err(|error| error.to_string())?;
    window
        .set_focusable(false)
        .map_err(|error| error.to_string())?;
    size_to_current_monitor(&window)?;

    #[cfg(target_os = "macos")]
    macos::set_desktop_level(&window, true)?;

    Ok(())
}

#[tauri::command]
fn leave_wallpaper_mode(window: WebviewWindow) -> Result<(), String> {
    let window = window_for_command(window);

    #[cfg(target_os = "macos")]
    macos::set_desktop_level(&window, false)?;

    window
        .set_simple_fullscreen(false)
        .map_err(|error| error.to_string())?;
    window
        .set_focusable(true)
        .map_err(|error| error.to_string())?;
    #[cfg(not(target_os = "macos"))]
    window
        .set_always_on_bottom(false)
        .map_err(|error| error.to_string())?;
    window
        .set_decorations(true)
        .map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn activate_preset(app: AppHandle, preset_id: String) -> Result<(), String> {
    if preset_id.is_empty()
        || preset_id.len() > 160
        || !preset_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("Invalid preset id".into());
    }

    let window = app
        .get_webview_window("wallpaper")
        .ok_or_else(|| "Wallpaper window is unavailable".to_string())?;
    prepare_wallpaper_activation(&window)?;
    app.emit_to(
        "wallpaper",
        "vibe://activate-preset",
        serde_json::json!({ "presetId": preset_id }),
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn activate_transfer(app: AppHandle, token: String) -> Result<(), String> {
    activate_transfer_for_app(&app, &token)
}

#[tauri::command]
fn enable_wallpaper_controls(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("wallpaper")
        .ok_or_else(|| "Wallpaper window is unavailable".to_string())?;
    window
        .set_focusable(true)
        .map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    macos::set_click_through(&window, false)?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(token) = activation_token_from_args(&args) {
                let _ = activate_transfer_for_app(app, &token);
            } else {
                let _ = open_web_editor();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            activate_preset,
            activate_transfer,
            enable_wallpaper_controls,
            enter_wallpaper_mode,
            leave_wallpaper_mode,
            native_controls_snapshot_command,
            native_controls_close,
            native_controls_dispatch
        ])
        .on_window_event(|window, event| {
            // Behave like a status-item popover: clicking away dismisses the
            // compact controls instead of leaving an extra utility window.
            if window.label() == "native-controls" && matches!(event, WindowEvent::Focused(false)) {
                let _ = window.hide();
            }
        })
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            app.manage(NativeControlsState(Mutex::new(NativeControlsSnapshot {
                wallpaper_visible: true,
                desktop_icons_visible: true,
            })));

            let editor = MenuItem::with_id(app, "editor", "Open website editor", true, None::<&str>)?;
            let controls = MenuItem::with_id(
                app,
                "controls",
                "Show wallpaper controls",
                true,
                None::<&str>,
            )?;
            let mute_sound = MenuItem::with_id(app, "mute-sound", "Mute sound", true, None::<&str>)?;
            let resume_sound = MenuItem::with_id(app, "resume-sound", "Resume sound", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Show wallpaper", true, None::<&str>)?;
            let pause = MenuItem::with_id(app, "pause", "Hide wallpaper", true, None::<&str>)?;
            let clean_desktop = MenuItem::with_id(
                app,
                "clean-desktop",
                "Clean desktop (hide icons)",
                true,
                None::<&str>,
            )?;
            let show_icons = MenuItem::with_id(
                app,
                "show-icons",
                "Show desktop icons",
                true,
                None::<&str>,
            )?;
            let quit = MenuItem::with_id(app, "quit", "Quit Vibe Curator", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[&editor, &controls, &mute_sound, &resume_sound, &show, &pause, &clean_desktop, &show_icons, &quit],
            )?;

            let tray = TrayIconBuilder::with_id("vibe-curator")
                .menu(&menu)
                .tooltip("Vibe Curator")
                .icon(status_item_icon())
                .icon_as_template(true)
                // Keep the standard context menu as a right-click fallback;
                // left click is reserved for the anchored status popover.
                .show_menu_on_left_click(false);
            let tray_handle = tray.on_menu_event(|app, event| match event.id.as_ref() {
                "editor" => {
                    let _ = open_web_editor();
                }
                "controls" => {
                    let _ = enable_wallpaper_controls(app.clone());
                }
                "mute-sound" => {
                    let _ = app.emit_to("wallpaper", "vibe://audio/set-muted", true);
                    let _ = app.emit_to("wallpaper", "vibe://set-sound-muted", true);
                }
                "resume-sound" => {
                    let _ = app.emit_to("wallpaper", "vibe://audio/set-muted", false);
                    let _ = app.emit_to("wallpaper", "vibe://set-sound-muted", false);
                    let _ = enable_wallpaper_controls(app.clone());
                }
                "show" => {
                    if let Some(window) = app.get_webview_window("wallpaper") {
                        let _ = window.show();
                        if let Ok(mut state) = app.state::<NativeControlsState>().0.lock() {
                            state.wallpaper_visible = true;
                        }
                        let _ = emit_native_controls_snapshot(app);
                    }
                }
                "pause" => {
                    if let Some(window) = app.get_webview_window("wallpaper") {
                        let _ = window.hide();
                        if let Ok(mut state) = app.state::<NativeControlsState>().0.lock() {
                            state.wallpaper_visible = false;
                        }
                        let _ = emit_native_controls_snapshot(app);
                    }
                }
                "clean-desktop" => {
                    if let Some(window) = app.get_webview_window("wallpaper") {
                        #[cfg(target_os = "macos")]
                        let _ = macos::set_desktop_icons_hidden(&window, true);
                        if let Ok(mut state) = app.state::<NativeControlsState>().0.lock() {
                            state.desktop_icons_visible = false;
                        }
                        let _ = emit_native_controls_snapshot(app);
                    }
                }
                "show-icons" => {
                    if let Some(window) = app.get_webview_window("wallpaper") {
                        #[cfg(target_os = "macos")]
                        let _ = macos::set_desktop_icons_hidden(&window, false);
                        if let Ok(mut state) = app.state::<NativeControlsState>().0.lock() {
                            state.desktop_icons_visible = true;
                        }
                        let _ = emit_native_controls_snapshot(app);
                    }
                }
                "quit" => app.exit(0),
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    rect,
                    ..
                } = event
                {
                    let _ = show_native_controls(tray.app_handle(), Some(rect));
                }
            })
            .build(app)?;

            // Keep an explicit strong application-managed handle. This avoids
            // an accidental tray teardown when setup's local scope ends.
            app.manage(tray_handle);

            if let Some(token) = activation_token_from_args(&std::env::args().collect::<Vec<_>>()) {
                activate_transfer_for_app(app.handle(), &token).map_err(std::io::Error::other)?;
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the Vibe Curator native player")
        .run(|app, event| {
            // macOS delivers custom-protocol URLs to the already-running app
            // as RunEvent::Opened. Handle them natively so Display on Mac does
            // not depend on whichever webview page is currently loaded.
            if let tauri::RunEvent::Opened { urls } = event {
                for url in urls {
                    if let Some(token) = activation_token_from_args(&[url.to_string()]) {
                        let _ = activate_transfer_for_app(app, &token);
                    }
                }
            }
        });
}
