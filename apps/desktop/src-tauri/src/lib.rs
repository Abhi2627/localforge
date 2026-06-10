use tauri::Manager;
use std::process::{Command, Child};
use std::sync::Mutex;

struct ServerProcess(Mutex<Option<Child>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(ServerProcess(Mutex::new(None)))
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Spawn the agent server as a child process
            // In production: look for bundled server next to the binary
            // In dev: use the npm dev command
            std::thread::spawn(move || {
                let resource_dir = app_handle
                    .path()
                    .resource_dir()
                    .unwrap_or_else(|_| std::path::PathBuf::from("."));

                // Try bundled server first (production)
                let server_path = resource_dir.join("server").join("index.js");

                let child = if server_path.exists() {
                    // Production: run bundled server with node
                    Command::new("node")
                        .arg(&server_path)
                        .env("PORT", "3001")
                        .spawn()
                } else {
                    // Dev fallback: nothing — server started manually
                    return;
                };

                if let Ok(child) = child {
                    if let Ok(mut lock) = app_handle.state::<ServerProcess>().0.lock() {
                        *lock = Some(child);
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Kill server when window closes
                if let Ok(mut lock) = window.app_handle().state::<ServerProcess>().0.lock() {
                    if let Some(mut child) = lock.take() {
                        let _ = child.kill();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
