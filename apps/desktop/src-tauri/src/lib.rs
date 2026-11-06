use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    Emitter, LogicalSize, Manager, RunEvent, Size, State,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const DEVELOPMENT_BACKEND_URL: &str = "http://127.0.0.1:8000";

#[derive(Deserialize, Serialize)]
struct SavedWindowPosition { x: i32, y: i32 }

fn window_position_path() -> Option<std::path::PathBuf> {
    Some(std::path::PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join("Moonie").join("window-position.json"))
}

fn persist_window_position(position: tauri::PhysicalPosition<i32>) {
    let Some(path) = window_position_path() else { return; };
    if let Some(parent) = path.parent() { let _ = std::fs::create_dir_all(parent); }
    if let Ok(content) = serde_json::to_vec(&SavedWindowPosition { x: position.x, y: position.y }) {
        let _ = std::fs::write(path, content);
    }
}

fn diagnostic_log(message: &str) {
    let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") else {
        eprintln!("[Moonie] {message}");
        return;
    };
    let directory = std::path::PathBuf::from(local_app_data).join("Moonie").join("logs");
    let _ = std::fs::create_dir_all(&directory);
    let path = directory.join("desktop.log");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "[Moonie] {message}");
    }
}

fn diagnostic_log_file() -> Option<std::fs::File> {
    let local_app_data = std::env::var_os("LOCALAPPDATA")?;
    let directory = std::path::PathBuf::from(local_app_data).join("Moonie").join("logs");
    std::fs::create_dir_all(&directory).ok()?;
    OpenOptions::new().create(true).append(true).open(directory.join("backend.log")).ok()
}

fn packaged_backend_resource(resource_directory: &std::path::Path) -> Option<std::path::PathBuf> {
    [
        resource_directory.join("moonie-backend.exe"),
        resource_directory.join("resources").join("moonie-backend.exe"),
    ]
    .into_iter()
    .find(|candidate| candidate.is_file())
}

fn terminate_backend_process(child: &mut Child) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = child.kill();
    }
    let _ = child.wait();
}

struct BackendRuntime {
    child: Mutex<Option<Child>>,
    url: Mutex<String>,
    managed: Mutex<bool>,
    error: Mutex<Option<String>>,
}

#[derive(Serialize)]
struct BackendStatus {
    url: String,
    managed: bool,
    ready: bool,
    error: Option<String>,
}

impl BackendRuntime {
    fn new() -> Self {
        Self {
            child: Mutex::new(None),
            url: Mutex::new(DEVELOPMENT_BACKEND_URL.to_string()),
            managed: Mutex::new(false),
            error: Mutex::new(None),
        }
    }
}

fn free_loopback_port() -> Result<u16, String> {
    TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("Moonie could not reserve a loopback port: {error}"))
        .and_then(|listener| listener.local_addr().map(|address| address.port()).map_err(|error| error.to_string()))
}

fn health_check(url: &str, token: &str) -> Result<(), String> {
    let port = url
        .rsplit(':')
        .next()
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or_else(|| "Moonie backend URL has no valid port".to_string())?;
    let address = format!("127.0.0.1:{port}").parse::<std::net::SocketAddr>().map_err(|error| error.to_string())?;
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(250))
    .map_err(|error| error.to_string())?;
    stream.set_read_timeout(Some(Duration::from_millis(500))).map_err(|error| error.to_string())?;
    let request = format!("GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Moonie-Instance: {token}\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).map_err(|error| error.to_string())?;
    let mut response = String::new();
    stream.read_to_string(&mut response).map_err(|error| error.to_string())?;
    let body = response.split("\r\n\r\n").nth(1).unwrap_or_default();
    if !response.starts_with("HTTP/1.1 200") || !body.contains("\"status\":\"ok\"") {
        return Err("Moonie backend returned an invalid health response".to_string());
    }
    Ok(())
}

fn stop_backend(runtime: &BackendRuntime) {
    if let Ok(mut child) = runtime.child.lock() {
        if let Some(mut process) = child.take() {
            terminate_backend_process(&mut process);
        }
    }
}

fn start_packaged_backend(app: &tauri::AppHandle, runtime: &BackendRuntime) {
    let resource = match app.path().resource_dir() {
        Ok(directory) => {
            let candidates = [directory.join("moonie-backend.exe"), directory.join("resources").join("moonie-backend.exe")];
            diagnostic_log(&format!("backend resource candidates: {:?}", candidates));
            match packaged_backend_resource(&directory) {
                Some(resource) => resource,
                None => {
                    diagnostic_log("no packaged backend resource found; using externally managed development backend");
                    return;
                }
            }
        }
        Err(error) => {
            let message = format!("Moonie could not locate its backend resource directory: {error}");
            diagnostic_log(&message);
            *runtime.error.lock().unwrap() = Some(message);
            return;
        }
    };
    diagnostic_log(&format!("starting packaged backend from {}", resource.display()));
    let port = match free_loopback_port() {
        Ok(port) => port,
        Err(error) => {
            diagnostic_log(&format!("could not reserve a backend port: {error}"));
            *runtime.error.lock().unwrap() = Some(error);
            return;
        }
    };
    let url = format!("http://127.0.0.1:{port}");
    let token = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| format!("{}-{port}", duration.as_nanos()))
        .unwrap_or_else(|_| format!("moonie-{port}"));
    let mut command = Command::new(&resource);
    command
        .env("ENVIRONMENT", "production")
        .env("MOONIE_PORT", port.to_string())
        .env("MOONIE_HEALTH_TOKEN", &token);
    if let Some(log_file) = diagnostic_log_file() {
        if let Ok(error_log) = log_file.try_clone() {
            command.stdout(Stdio::from(log_file)).stderr(Stdio::from(error_log));
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            diagnostic_log(&format!("could not spawn packaged backend: {error}"));
            *runtime.error.lock().unwrap() = Some(format!("Moonie could not start its backend: {error}"));
            return;
        }
    };
    let mut ready = false;
    let mut last_health_error = String::from("no response");
    for _ in 0..40 {
        if let Ok(Some(status)) = child.try_wait() {
            let message = format!("Moonie backend exited during startup ({status})");
            diagnostic_log(&message);
            *runtime.error.lock().unwrap() = Some(message);
            return;
        }
        match health_check(&url, &token) {
            Ok(()) => {
                ready = true;
                break;
            }
            Err(error) => last_health_error = error,
        }
        thread::sleep(Duration::from_millis(250));
    }
    if !ready {
        terminate_backend_process(&mut child);
        let message = format!("Moonie backend did not become ready within 10 seconds: {last_health_error}");
        diagnostic_log(&message);
        *runtime.error.lock().unwrap() = Some(message);
        return;
    }
    diagnostic_log(&format!("packaged backend ready at {url}"));
    *runtime.url.lock().unwrap() = url;
    *runtime.managed.lock().unwrap() = true;
    *runtime.child.lock().unwrap() = Some(child);
}

#[cfg(test)]
mod tests {
    use super::packaged_backend_resource;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn finds_backend_in_tauri_preserved_resource_directory() {
        let directory = std::env::temp_dir().join(format!(
            "moonie-resource-test-{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        let nested = directory.join("resources");
        fs::create_dir_all(&nested).expect("nested resources directory");
        let executable = nested.join("moonie-backend.exe");
        fs::write(&executable, b"test executable").expect("test executable");

        assert_eq!(packaged_backend_resource(&directory), Some(executable));
        fs::remove_dir_all(directory).expect("remove temporary resource directory");
    }

    #[test]
    fn clamps_saved_position_to_visible_monitor_bounds() {
        let monitor_position = tauri::PhysicalPosition { x: 100, y: 50 };
        let monitor_size = tauri::PhysicalSize { width: 1000, height: 800 };
        let window_size = tauri::PhysicalSize { width: 128, height: 128 };
        assert_eq!(
            super::clamp_window_position(tauri::PhysicalPosition { x: -500, y: 9999 }, window_size, monitor_position, monitor_size),
            tauri::PhysicalPosition { x: 100, y: 722 }
        );
    }
}

#[tauri::command]
fn get_backend_url(runtime: State<'_, BackendRuntime>) -> String {
    runtime.url.lock().unwrap().clone()
}

#[tauri::command]
fn get_backend_status(runtime: State<'_, BackendRuntime>) -> BackendStatus {
    let mut ready = false;
    if let Ok(mut child) = runtime.child.lock() {
        if let Some(process) = child.as_mut() {
            match process.try_wait() {
                Ok(None) => ready = true,
                Ok(Some(status)) => {
                    let message = format!("Moonie backend exited unexpectedly ({status})");
                    diagnostic_log(&message);
                    *runtime.error.lock().unwrap() = Some(message);
                    child.take();
                }
                Err(error) => *runtime.error.lock().unwrap() = Some(format!("Could not monitor Moonie backend: {error}")),
            }
        }
    }
    BackendStatus {
        url: runtime.url.lock().unwrap().clone(),
        managed: *runtime.managed.lock().unwrap(),
        ready,
        error: runtime.error.lock().unwrap().clone(),
    }
}

#[tauri::command]
fn keep_window_on_screen(window: &tauri::WebviewWindow) -> Result<(), String> {
    let Some(monitor) = window.current_monitor().map_err(|error| error.to_string())? else { return Ok(()); };
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let clamped = clamp_window_position(position, size, *monitor_position, *monitor_size);
    window.set_position(tauri::Position::Physical(clamped)).map_err(|error| error.to_string())?;
    Ok(())
}

fn clamp_window_position(
    position: tauri::PhysicalPosition<i32>,
    window_size: tauri::PhysicalSize<u32>,
    monitor_position: tauri::PhysicalPosition<i32>,
    monitor_size: tauri::PhysicalSize<u32>,
) -> tauri::PhysicalPosition<i32> {
    let min_x = monitor_position.x;
    let min_y = monitor_position.y;
    let max_x = (monitor_position.x + monitor_size.width as i32 - window_size.width as i32).max(min_x);
    let max_y = (monitor_position.y + monitor_size.height as i32 - window_size.height as i32).max(min_y);
    tauri::PhysicalPosition { x: position.x.clamp(min_x, max_x), y: position.y.clamp(min_y, max_y) }
}

fn restore_window_position(window: &tauri::WebviewWindow) -> Result<(), String> {
    let saved = window_position_path()
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|content| serde_json::from_slice::<SavedWindowPosition>(&content).ok());
    if let Some(position) = saved {
        let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x: position.x, y: position.y }));
    } else if let Some(monitor) = window.current_monitor().map_err(|error| error.to_string())? {
        let size = window.outer_size().map_err(|error| error.to_string())?;
        let monitor_position = monitor.position();
        let monitor_size = monitor.size();
        let margin = 32;
        let position = tauri::PhysicalPosition {
            x: monitor_position.x + monitor_size.width as i32 - size.width as i32 - margin,
            y: monitor_position.y + monitor_size.height as i32 - size.height as i32 - margin,
        };
        let _ = window.set_position(tauri::Position::Physical(position));
    }
    keep_window_on_screen(window)
}

#[tauri::command]
fn set_window_expanded(window: tauri::WebviewWindow, expanded: bool, mascot_size: Option<f64>) -> Result<(), String> {
    let mascot_size = mascot_size.unwrap_or(128.0).clamp(96.0, 192.0);
    if expanded {
        window
            .set_size(Size::Logical(LogicalSize {
                width: 360.0,
                height: 520.0,
            }))
            .map_err(|e| e.to_string())?;
    } else {
        window
            .set_size(Size::Logical(LogicalSize {
                width: mascot_size + 16.0,
                height: mascot_size + 16.0,
            }))
            .map_err(|e| e.to_string())?;
    }
    keep_window_on_screen(&window)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(BackendRuntime::new())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![set_window_expanded, get_backend_url, get_backend_status])
        .setup(|app| {
            start_packaged_backend(app.handle(), app.state::<BackendRuntime>().inner());
            if let Some(window) = app.get_webview_window("main") {
                let _ = restore_window_position(&window);
            }
            // Setup System Tray
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let talk_item = MenuItem::with_id(app, "talk", "Talk to Moonie", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&talk_item, &quit_item])?;

            let tray_icon = app
                .default_window_icon()
                .cloned()
                .expect("Failed to get default window icon");

            let _tray = TrayIconBuilder::new()
                .icon(tray_icon)
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "talk" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.emit("expand-moonie", ());
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { .. } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.emit("expand-moonie", ());
                        }
                    }
                })
                .build(app)?;

            // Register global shortcut: Ctrl+Shift+Space
            let shortcut_result = "ctrl+shift+space".parse::<Shortcut>();
            if let Ok(shortcut) = shortcut_result {
                let _ = app.global_shortcut().on_shortcut(shortcut, |app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.emit("toggle-moonie", ());
                        }
                    }
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Moved(position) = event {
                persist_window_position(*position);
            }
            let _ = window;
        })
        .build(tauri::generate_context!())
        .expect("error while building Moonie desktop application");
    app.run(|app, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            stop_backend(app.state::<BackendRuntime>().inner());
        }
    });
}
