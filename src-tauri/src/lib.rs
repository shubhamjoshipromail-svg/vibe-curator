use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, Url, WebviewWindow,
};
use std::process::Command;

const DEFAULT_APP_URL: &str = "https://vibe-curator-production.up.railway.app";

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
}

fn window_for_command(window: WebviewWindow) -> WebviewWindow {
    window
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
    #[cfg(target_os = "macos")]
    macos::set_desktop_level(window, false)?;
    window.set_decorations(false).map_err(|error| error.to_string())?;
    window.set_focusable(true).map_err(|error| error.to_string())?;
    window.set_simple_fullscreen(true).map_err(|error| error.to_string())?;
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
    let url = hosted_url("/wallpaper.html", Some(&format!("activation={}", token.to_ascii_lowercase())))?;
    window.navigate(url).map_err(|error| error.to_string())?;
    Ok(())
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
    window
        .set_simple_fullscreen(true)
        .map_err(|error| error.to_string())?;

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
    let url = hosted_url("/wallpaper.html", Some(&format!("preset={preset_id}")))?;
    window.navigate(url).map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    Ok(())
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
            leave_wallpaper_mode
        ])
        .setup(|app| {
            let editor = MenuItem::with_id(app, "editor", "Open website editor", true, None::<&str>)?;
            let controls = MenuItem::with_id(
                app,
                "controls",
                "Start sound / interact",
                true,
                None::<&str>,
            )?;
            let show = MenuItem::with_id(app, "show", "Show wallpaper", true, None::<&str>)?;
            let pause = MenuItem::with_id(app, "pause", "Hide wallpaper", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Vibe Curator", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&editor, &controls, &show, &pause, &quit])?;

            let mut tray = TrayIconBuilder::with_id("vibe-curator").menu(&menu);
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.on_menu_event(|app, event| match event.id.as_ref() {
                "editor" => {
                    let _ = open_web_editor();
                }
                "controls" => {
                    let _ = enable_wallpaper_controls(app.clone());
                }
                "show" => {
                    if let Some(window) = app.get_webview_window("wallpaper") {
                        let _ = window.show();
                    }
                }
                "pause" => {
                    if let Some(window) = app.get_webview_window("wallpaper") {
                        let _ = window.hide();
                    }
                }
                "quit" => app.exit(0),
                _ => {}
            })
            .build(app)?;

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
