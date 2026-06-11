use std::process::{Command, Child};
use std::sync::Mutex;
use tauri::Manager;

struct ServerProcess(Mutex<Option<Child>>);

fn find_node() -> Option<String> {
    // PRIORITY: prefer nvm node (matches the Node version used to build native modules)
    // Check nvm FIRST before system/Homebrew node
    if let Ok(home) = std::env::var("HOME") {
        let nvm_dir = std::path::PathBuf::from(&home)
            .join(".nvm").join("versions").join("node");
        if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
            let mut versions: Vec<String> = entries
                .filter_map(|e| e.ok())
                .map(|e| e.path().join("bin").join("node"))
                .filter(|p| p.exists())
                .filter_map(|p| p.to_str().map(|s| s.to_string()))
                .collect();
            versions.sort();
            // Use the LATEST nvm version (same one used to build modules)
            if let Some(latest) = versions.last() {
                println!("[LocalForge] Found node via nvm: {}", latest);
                return Some(latest.clone());
            }
        }
    }

    // Fallback to static paths only if nvm not found
    let static_paths = [
        "/usr/local/bin/node",   // Intel Homebrew (usually older)
        "/opt/homebrew/bin/node", // Apple Silicon Homebrew
        "/usr/bin/node",
        "/opt/local/bin/node",
    ];
    for path in &static_paths {
        if std::path::Path::new(path).exists() {
            println!("[LocalForge] Found node at: {}", path);
            return Some(path.to_string());
        }
    }

    // Use login shell as last resort
    for shell in &["/bin/zsh", "/bin/bash"] {
        if let Ok(out) = Command::new(shell)
            .args(["-l", "-c", "which node"])
            .output()
        {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !s.is_empty() && std::path::Path::new(&s).exists() {
                println!("[LocalForge] Found node via {}: {}", shell, s);
                return Some(s);
            }
        }
    }

    println!("[LocalForge] Node.js not found");
    None
}

fn start_server(resource_dir: &std::path::Path) -> Option<Child> {
    let node = find_node()?;

    let server_path = resource_dir.join("server.cjs");
    if !server_path.exists() {
        println!("[LocalForge] server.cjs not found — expecting external server on :3001");
        return None;
    }

    let resource_str = resource_dir.to_str().unwrap_or("").to_string();
    let node_modules = resource_dir.join("node_modules");
    let node_modules_str = node_modules.to_str().unwrap_or("").to_string();

    let path_env = format!(
        "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:{}",
        std::env::var("PATH").unwrap_or_default()
    );

    println!("[LocalForge] Starting server...");
    println!("[LocalForge]   node:       {}", node);
    println!("[LocalForge]   server:     {:?}", server_path);
    println!("[LocalForge]   resources:  {}", resource_str);

    match Command::new(&node)
        .arg(&server_path)
        .env("PORT", "3001")
        .env("NODE_ENV", "production")
        // LOCALFORGE_ROOT tells MCPClient where to find node_modules
        .env("LOCALFORGE_ROOT", &resource_str)
        .env("NODE_PATH", &node_modules_str)
        .env("PATH", &path_env)
        .spawn()
    {
        Ok(c)  => { println!("[LocalForge] Server PID {}", c.id()); Some(c) }
        Err(e) => { println!("[LocalForge] Spawn failed: {}", e); None }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(ServerProcess(Mutex::new(None)))
        .setup(|app| {
            let resource_dir = app.path().resource_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            println!("[LocalForge] Resources: {:?}", resource_dir);
            if let Some(child) = start_server(&resource_dir) {
                if let Ok(mut lock) = app.state::<ServerProcess>().0.lock() {
                    *lock = Some(child);
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Ok(mut lock) = window.app_handle().state::<ServerProcess>().0.lock() {
                    if let Some(mut child) = lock.take() {
                        println!("[LocalForge] Killing server PID {}", child.id());
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
