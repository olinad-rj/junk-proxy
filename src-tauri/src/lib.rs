//! ProxyLite — Buscador, Aplicador Mihomo, Testes e Tráfego em um app leve.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};

static IS_EXITING: AtomicBool = AtomicBool::new(false);

const MIXED_PORT: u16 = 7897;
const CONTROLLER: &str = "127.0.0.1:9097";
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub struct AppState {
    scraper: Mutex<Option<Child>>,
    scraper_active: Arc<AtomicBool>,
    scraper_cancel: Arc<AtomicBool>,
    core: Mutex<Option<Child>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScrapedProxy {
    pub protocol: String,
    pub host: String,
    pub port: u16,
    pub timeout: Option<f64>,
    pub country_code: Option<String>,
    pub country_name: Option<String>,
    pub anonymity: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
}

// ---------- helpers ----------

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("pasta de dados: {e}"))
}

fn resource_file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    if let Ok(dir) = app.path().resource_dir() {
        let p = dir.join("resources").join(name);
        if p.exists() {
            return Ok(p);
        }
        let p2 = dir.join(name);
        if p2.exists() {
            return Ok(p2);
        }
    }
    let dev_p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join(name);
    if dev_p.exists() {
        return Ok(dev_p);
    }
    Err(format!("recurso não encontrado: {name}"))
}

fn is_running(slot: &Mutex<Option<Child>>) -> bool {
    let mut guard = slot.lock().unwrap();
    if let Some(child) = guard.as_mut() {
        if matches!(child.try_wait(), Ok(None)) {
            return true;
        }
    }
    *guard = None;
    false
}

fn stop_child(slot: &Mutex<Option<Child>>) {
    let mut guard = slot.lock().unwrap();
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn spawn_logged(
    app: &AppHandle,
    slot: &Mutex<Option<Child>>,
    mut command: Command,
    event: &str,
    done_event: Option<&str>,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("falha ao iniciar processo: {e}"))?;

    if let Some(stdout) = child.stdout.take() {
        let handle = app.clone();
        let ev = event.to_string();
        let done = done_event.map(ToOwned::to_owned);
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let _ = handle.emit(&ev, line);
            }
            if let Some(d) = done {
                let _ = handle.emit(&d, ());
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let handle = app.clone();
        let ev = event.to_string();
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let _ = handle.emit(&ev, line);
            }
        });
    }
    *slot.lock().unwrap() = Some(child);
    Ok(())
}

fn country_tag(iso: Option<&str>) -> String {
    match iso {
        Some(code) if code.len() == 2 && code.chars().all(|c| c.is_ascii_alphabetic()) => {
            code.to_ascii_uppercase()
        }
        _ => "INT".to_string(),
    }
}

fn yq(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

// ---------- Windows System Proxy ----------

#[cfg(windows)]
fn query_system_proxy() -> bool {
    use winreg::enums::*;
    use winreg::RegKey;
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Internet Settings")
        .and_then(|k| k.get_value::<u32, _>("ProxyEnable"))
        .map(|v| v == 1)
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn query_system_proxy() -> bool {
    false
}

#[cfg(windows)]
fn apply_system_proxy(enable: bool) -> Result<(), String> {
    use windows_sys::Win32::Networking::WinInet::InternetSetOptionW;
    use winreg::enums::*;
    use winreg::RegKey;
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(
            r"Software\Microsoft\Windows\CurrentVersion\Internet Settings",
            KEY_QUERY_VALUE | KEY_SET_VALUE,
        )
        .map_err(|e| e.to_string())?;
    key.set_value("ProxyEnable", &(if enable { 1u32 } else { 0u32 }))
        .map_err(|e| e.to_string())?;
    if enable {
        key.set_value("ProxyServer", &format!("127.0.0.1:{MIXED_PORT}"))
            .map_err(|e| e.to_string())?;
        let _ = key.set_value(
            "ProxyOverride",
            &"localhost;127.*;10.*;172.16.*;192.168.*;<local>",
        );
    }
    unsafe {
        InternetSetOptionW(std::ptr::null_mut(), 39, std::ptr::null_mut(), 0);
        InternetSetOptionW(std::ptr::null_mut(), 37, std::ptr::null_mut(), 0);
    }
    Ok(())
}

#[cfg(not(windows))]
fn apply_system_proxy(_enable: bool) -> Result<(), String> {
    Ok(())
}

// ---------- Scraper ----------

fn ensure_scraper_config(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let data = data_dir(app)?;
    std::fs::create_dir_all(data.join("out")).map_err(|e| e.to_string())?;
    let cfg = data.join("config.toml");
    if !cfg.exists() {
        let bundled = resource_file(app, "scraper-config.toml")?;
        std::fs::copy(&bundled, &cfg).map_err(|e| e.to_string())?;
    }
    Ok((data, cfg))
}

#[tauri::command]
fn scraper_status(state: State<AppState>) -> bool {
    state.scraper_active.load(Ordering::SeqCst) || is_running(&state.scraper)
}

fn make_scrape_only_config(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for line in raw.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("check_url") {
            out.push_str("check_url = \"\"\n");
        } else if trimmed.starts_with("include_asn") {
            out.push_str("include_asn = false\n");
        } else if trimmed.starts_with("include_geolocation") {
            out.push_str("include_geolocation = false\n");
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}

fn write_proxies_json_sync(path: &PathBuf, list: &[ScrapedProxy]) {
    let mut sorted = list.to_vec();
    sorted.sort_by(|a, b| {
        a.timeout
            .unwrap_or(f64::MAX)
            .total_cmp(&b.timeout.unwrap_or(f64::MAX))
    });
    if let Ok(json) = serde_json::to_string(&sorted) {
        let _ = std::fs::write(path, json);
    }
}

fn geolocate_batch_sync(ips: &[String]) -> HashMap<String, (String, String)> {
    let mut out = HashMap::new();
    if ips.is_empty() {
        return out;
    }
    let body = match serde_json::to_string(ips) {
        Ok(b) => b,
        Err(_) => return out,
    };
    let mut cmd = Command::new("curl.exe");
    cmd.arg("-s")
        .arg("-X")
        .arg("POST")
        .arg("http://ip-api.com/batch?fields=query,countryCode,country")
        .arg("-H")
        .arg("Content-Type: application/json")
        .arg("--max-time")
        .arg("5")
        .arg("-d")
        .arg(&body);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    if let Ok(res) = cmd.output() {
        if let Ok(arr) = serde_json::from_slice::<Vec<Value>>(&res.stdout) {
            for item in arr {
                let q = item.get("query").and_then(Value::as_str).unwrap_or("");
                let cc = item.get("countryCode").and_then(Value::as_str).unwrap_or("");
                let cn = item.get("country").and_then(Value::as_str).unwrap_or("");
                if !q.is_empty() && !cc.is_empty() {
                    out.insert(q.to_string(), (cc.to_string(), cn.to_string()));
                }
            }
        }
    }
    out
}

fn flush_geo_sync(
    app: &AppHandle,
    out_path: &PathBuf,
    found: &Mutex<Vec<ScrapedProxy>>,
    pending_ips: &mut Vec<String>,
) {
    if !pending_ips.is_empty() {
        let batch: Vec<String> = pending_ips.drain(..).collect();
        let geo = geolocate_batch_sync(&batch);
        if !geo.is_empty() {
            let mut updates = serde_json::Map::new();
            if let Ok(mut list) = found.lock() {
                for p in list.iter_mut() {
                    if let Some((cc, cn)) = geo.get(&p.host) {
                        p.country_code = Some(cc.clone());
                        p.country_name = Some(cn.clone());
                        updates.insert(p.host.clone(), json!({ "code": cc, "name": cn }));
                    }
                }
                write_proxies_json_sync(out_path, &list);
            }
            if !updates.is_empty() {
                let _ = app.emit("scraper-countries", Value::Object(updates));
            }
            return;
        }
    }
    if let Ok(list) = found.lock() {
        write_proxies_json_sync(out_path, &list);
    }
}

#[tauri::command]
fn scraper_start(
    app: AppHandle,
    state: State<AppState>,
    batch_size: Option<usize>,
) -> Result<(), String> {
    if state.scraper_active.swap(true, Ordering::SeqCst) {
        return Err("Coleta já está em execução.".into());
    }
    state.scraper_cancel.store(false, Ordering::SeqCst);

    let (data, cfg) = ensure_scraper_config(&app)?;
    let out_path = data.join("out").join("proxies.json");
    if out_path.exists() {
        let _ = std::fs::remove_file(&out_path);
    }

    let raw_cfg = std::fs::read_to_string(&cfg).map_err(|e| e.to_string())?;
    let scrape_cfg = data.join("scrape_only.toml");
    std::fs::write(&scrape_cfg, make_scrape_only_config(&raw_cfg)).map_err(|e| e.to_string())?;
    let bin = resource_file(&app, "proxy-scraper-checker.exe")?;

    let active = Arc::clone(&state.scraper_active);
    let cancel = Arc::clone(&state.scraper_cancel);
    let workers = batch_size.unwrap_or(10).clamp(5, 50);

    thread::spawn(move || {
        let _ = app.emit("scraper-log", "Etapa 1: baixando listas de proxies...".to_string());
        let mut cmd = Command::new(&bin);
        cmd.current_dir(&data)
            .env("PROXY_SCRAPER_CHECKER_CONFIG", &scrape_cfg)
            .env_remove("HTTP_PROXY")
            .env_remove("HTTPS_PROXY")
            .env_remove("ALL_PROXY")
            .env_remove("http_proxy")
            .env_remove("https_proxy")
            .env_remove("all_proxy")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt as _;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        if let Ok(mut child) = cmd.spawn() {
            let stdout = child.stdout.take();
            let app_log = app.clone();
            let log_h = stdout.map(|out| {
                thread::spawn(move || {
                    for line in BufReader::new(out).lines().map_while(Result::ok) {
                        let _ = app_log.emit("scraper-log", line);
                    }
                })
            });
            {
                let st = app.state::<AppState>();
                if let Ok(mut g) = st.scraper.lock() {
                    *g = Some(child);
                };
            }
            loop {
                let done = {
                    let st = app.state::<AppState>();
                    let mut g = st.scraper.lock().ok();
                    if let Some(Some(ref mut ch)) = g.as_deref_mut() {
                        matches!(ch.try_wait(), Ok(Some(_)) | Err(_))
                    } else {
                        true
                    }
                };
                if done {
                    break;
                }
                thread::sleep(Duration::from_millis(120));
            }
            {
                let st = app.state::<AppState>();
                if let Ok(mut g) = st.scraper.lock() {
                    *g = None;
                };
            }
            if let Some(h) = log_h {
                let _ = h.join();
            }
        }

        if cancel.load(Ordering::SeqCst) {
            let _ = std::fs::remove_file(&out_path);
            let _ = app.emit("scraper-log", "Coleta interrompida pelo usuário.".to_string());
            active.store(false, Ordering::SeqCst);
            let _ = app.emit("scraper-finished", ());
            return;
        }

        let candidates = scraper_read_proxies_sync(&app).unwrap_or_default();
        let _ = std::fs::remove_file(&out_path);
        if candidates.is_empty() {
            let _ = app.emit("scraper-log", "Nenhum proxy encontrado nas listas.".to_string());
            active.store(false, Ordering::SeqCst);
            let _ = app.emit("scraper-finished", ());
            return;
        }

        // Prioriza HTTP e SOCKS5 (usados pelo Mihomo) antes de SOCKS4.
        let mut ordered = Vec::with_capacity(candidates.len());
        let mut s4 = Vec::new();
        for c in candidates {
            if c.protocol == "http" || c.protocol == "socks5" {
                ordered.push(c);
            } else {
                s4.push(c);
            }
        }
        ordered.extend(s4);

        let total = ordered.len();
        let _ = app.emit(
            "scraper-log",
            format!(
                "Etapa 2: {total} proxies coletados. Testando ao vivo (TCP + generate_204, {workers} por vez)..."
            ),
        );

        let tcp_idx = AtomicUsize::new(0);
        let tcp_done = AtomicUsize::new(0);
        let working_count = AtomicUsize::new(0);
        let found = Mutex::new(Vec::<ScrapedProxy>::new());
        let geo_queue = Mutex::new(Vec::<String>::new());
        let (tx, rx) = mpsc::sync_channel::<ScrapedProxy>(64);
        let rx = Mutex::new(rx);

        thread::scope(|s| {
            let ordered_ref = &ordered;
            let cancel_ref = &cancel;
            let app_ref = &app;
            let tcp_idx_ref = &tcp_idx;
            let tcp_done_ref = &tcp_done;
            let working_ref = &working_count;

            for _ in 0..140 {
                let tx_c = tx.clone();
                s.spawn(move || loop {
                    if cancel_ref.load(Ordering::SeqCst) {
                        break;
                    }
                    let i = tcp_idx_ref.fetch_add(1, Ordering::Relaxed);
                    if i >= total {
                        break;
                    }
                    let p = &ordered_ref[i];
                    let addr = format!("{}:{}", p.host, p.port);
                    if let Ok(mut addrs) = addr.to_socket_addrs() {
                        if let Some(sa) = addrs.next() {
                            if TcpStream::connect_timeout(&sa, Duration::from_millis(2000)).is_ok()
                                && !cancel_ref.load(Ordering::SeqCst)
                            {
                                let _ = tx_c.send(p.clone());
                            }
                        }
                    }
                    let done = tcp_done_ref.fetch_add(1, Ordering::Relaxed) + 1;
                    if done % 1000 == 0 || done == total {
                        let w = working_ref.load(Ordering::Relaxed);
                        let _ = app_ref.emit(
                            "scraper-log",
                            format!("Testados {done}/{total} | {w} WORKING (ao vivo)"),
                        );
                    }
                });
            }
            drop(tx);

            let rx_ref = &rx;
            let found_ref = &found;
            let geo_ref = &geo_queue;
            let out_ref = &out_path;
            for _ in 0..workers {
                s.spawn(move || loop {
                    if cancel_ref.load(Ordering::SeqCst) {
                        break;
                    }
                    let next = {
                        let guard = rx_ref.lock().ok();
                        guard.and_then(|g| g.recv().ok())
                    };
                    let Some(mut p) = next else { break };
                    if cancel_ref.load(Ordering::SeqCst) {
                        break;
                    }
                    if let Ok(ms) = ping_proxy_http_sync(&p.protocol, &p.host, p.port) {
                        p.timeout = Some(ms as f64);
                        working_ref.fetch_add(1, Ordering::Relaxed);
                        let _ = app_ref.emit("scraper-proxy", &p);
                        let mut batch_to_geo = Vec::new();
                        if let Ok(mut list) = found_ref.lock() {
                            list.push(p.clone());
                        }
                        if let Ok(mut gq) = geo_ref.lock() {
                            gq.push(p.host.clone());
                            if gq.len() >= 20 {
                                batch_to_geo = gq.drain(..).collect();
                            }
                        }
                        if !batch_to_geo.is_empty() {
                            flush_geo_sync(app_ref, out_ref, found_ref, &mut batch_to_geo);
                        }
                    }
                });
            }
        });

        let mut leftover_geo = geo_queue
            .lock()
            .map(|mut g| g.drain(..).collect::<Vec<_>>())
            .unwrap_or_default();
        flush_geo_sync(&app, &out_path, &found, &mut leftover_geo);

        let total_w = working_count.load(Ordering::Relaxed);
        let msg = if cancel.load(Ordering::SeqCst) {
            format!("Busca parada: {total_w} proxies WORKING mantidos.")
        } else {
            format!("Finalizado: {total_w} proxies WORKING encontrados.")
        };
        let _ = app.emit("scraper-log", msg);
        active.store(false, Ordering::SeqCst);
        let _ = app.emit("scraper-finished", ());
    });

    Ok(())
}

#[tauri::command]
fn scraper_stop(state: State<AppState>) -> Result<(), String> {
    state.scraper_cancel.store(true, Ordering::SeqCst);
    stop_child(&state.scraper);
    Ok(())
}

#[tauri::command]
fn scraper_get_config(app: AppHandle) -> Result<String, String> {
    let (_, cfg) = ensure_scraper_config(&app)?;
    std::fs::read_to_string(cfg).map_err(|e| e.to_string())
}

#[tauri::command]
fn scraper_save_config(app: AppHandle, content: String) -> Result<(), String> {
    let (_, cfg) = ensure_scraper_config(&app)?;
    std::fs::write(cfg, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn scraper_clear_proxies(app: AppHandle) -> Result<(), String> {
    let path = data_dir(&app)?.join("out").join("proxies.json");
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn saved_proxies_read(app: AppHandle) -> Result<Vec<ScrapedProxy>, String> {
    let path = data_dir(&app)?.join("saved_proxies.json");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| format!("saved_proxies.json inválido: {e}"))
}

#[tauri::command]
fn saved_proxies_save(app: AppHandle, list: Vec<ScrapedProxy>) -> Result<(), String> {
    let dir = data_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string(&list).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("saved_proxies.json"), json).map_err(|e| e.to_string())
}

#[tauri::command]
async fn scraper_read_proxies(app: AppHandle) -> Result<Vec<ScrapedProxy>, String> {
    tauri::async_runtime::spawn_blocking(move || scraper_read_proxies_sync(&app))
        .await
        .map_err(|e| format!("erro interno: {e}"))?
}

fn scraper_read_proxies_sync(app: &AppHandle) -> Result<Vec<ScrapedProxy>, String> {
    let path = data_dir(app)?.join("out").join("proxies.json");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let parsed: Value =
        serde_json::from_str(&text).map_err(|e| format!("proxies.json inválido: {e}"))?;
    let arr = parsed
        .as_array()
        .or_else(|| parsed.get("proxies").and_then(Value::as_array))
        .cloned()
        .unwrap_or_default();

    let mut out = Vec::with_capacity(arr.len());
    for item in arr {
        let protocol = item
            .get("protocol")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_ascii_lowercase();
        let host = item
            .get("host")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let port = item
            .get("port")
            .and_then(Value::as_u64)
            .and_then(|p| u16::try_from(p).ok())
            .unwrap_or(0);
        if protocol.is_empty() || host.is_empty() || port == 0 {
            continue;
        }
        let is_maxmind_raw = item.pointer("/geolocation").is_some();
        let timeout = item.get("timeout").and_then(Value::as_f64).map(|s| {
            if is_maxmind_raw {
                (s * 1000.0).round()
            } else {
                s.round()
            }
        });
        out.push(ScrapedProxy {
            protocol,
            host,
            port,
            timeout,
            country_code: item
                .get("country_code")
                .or_else(|| item.pointer("/geolocation/country/iso_code"))
                .or_else(|| item.pointer("/geolocation/registered_country/iso_code"))
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            country_name: item
                .get("country_name")
                .or_else(|| item.pointer("/geolocation/country/names/en"))
                .or_else(|| item.pointer("/geolocation/registered_country/names/en"))
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            anonymity: item.get("anonymity").and_then(Value::as_str).map(ToOwned::to_owned),
            username: item.get("username").and_then(Value::as_str).map(ToOwned::to_owned),
            password: item.get("password").and_then(Value::as_str).map(ToOwned::to_owned),
        });
    }
    out.sort_by(|a, b| {
        a.timeout
            .unwrap_or(f64::MAX)
            .total_cmp(&b.timeout.unwrap_or(f64::MAX))
    });
    Ok(out)
}

// ---------- Mihomo Core & System Proxy ----------

#[tauri::command]
fn core_status(state: State<AppState>) -> Value {
    json!({
        "running": is_running(&state.core),
        "sys_proxy": query_system_proxy(),
        "port": MIXED_PORT,
        "controller": CONTROLLER,
    })
}

#[tauri::command]
async fn core_start(
    app: AppHandle,
    state: State<'_, AppState>,
    proxies: Vec<ScrapedProxy>,
    strategy: String,
    kill_switch: bool,
    bypass_lan: bool,
    tun_mode: bool,
) -> Result<Value, String> {
    stop_child(&state.core);

    let mut entries = Vec::new();
    let mut names = Vec::new();
    for p in proxies {
        if p.protocol != "http" && p.protocol != "socks5" {
            continue;
        }
        let name = format!(
            "[{}] {}:{} - {}{}",
            country_tag(p.country_code.as_deref()),
            p.host,
            p.port,
            p.protocol.to_ascii_uppercase(),
            p.timeout
                .map(|ms| format!(" ({}ms)", ms as u64))
                .unwrap_or_default()
        );
        if names.contains(&name) {
            continue;
        }
        let mut entry = format!(
            "  - name: {}\n    type: {}\n    server: {}\n    port: {}",
            yq(&name),
            p.protocol,
            yq(&p.host),
            p.port
        );
        if let Some(u) = &p.username {
            entry.push_str(&format!("\n    username: {}", yq(u)));
        }
        if let Some(pw) = &p.password {
            entry.push_str(&format!("\n    password: {}", yq(pw)));
        }
        entries.push(entry);
        names.push(name);
        if names.len() >= 300 {
            break;
        }
    }

    if names.is_empty() {
        return Err("Nenhum proxy HTTP ou SOCKS5 válido selecionado.".into());
    }

    let g_fallback = "Fallback";
    let g_fast = "Mais Rapido";
    let g_main = "Conexao";
    let delay_url = "https://www.gstatic.com/generate_204";

    let mut yaml = format!(
        "mixed-port: {MIXED_PORT}\nexternal-controller: {CONTROLLER}\nmode: rule\nlog-level: warning\nallow-lan: false\nunified-delay: true\ntcp-concurrent: true\n"
    );
    if tun_mode {
        yaml.push_str(
            "dns:\n  enable: true\n  enhanced-mode: fake-ip\n  nameserver:\n    - 1.1.1.1\n    - 8.8.8.8\ntun:\n  enable: true\n  stack: mixed\n  auto-route: true\n  auto-detect-interface: true\n  dns-hijack:\n    - any:53\n",
        );
    }
    yaml.push_str("proxies:\n");
    for e in &entries {
        yaml.push_str(e);
        yaml.push('\n');
    }
    yaml.push_str("proxy-groups:\n");
    yaml.push_str(&format!(
        "  - name: {}\n    type: fallback\n    url: {}\n    interval: 180\n    proxies:\n",
        yq(g_fallback),
        yq(delay_url)
    ));
    for n in &names {
        yaml.push_str(&format!("      - {}\n", yq(n)));
    }
    yaml.push_str(&format!(
        "  - name: {}\n    type: url-test\n    url: {}\n    interval: 300\n    tolerance: 100\n    proxies:\n",
        yq(g_fast),
        yq(delay_url)
    ));
    for n in &names {
        yaml.push_str(&format!("      - {}\n", yq(n)));
    }
    let first_auto = if strategy == "url-test" { g_fast } else { g_fallback };
    let second_auto = if strategy == "url-test" { g_fallback } else { g_fast };
    yaml.push_str(&format!(
        "  - name: {}\n    type: select\n    proxies:\n      - {}\n      - {}\n",
        yq(g_main),
        yq(first_auto),
        yq(second_auto)
    ));
    if !kill_switch {
        yaml.push_str("      - DIRECT\n");
    }
    for n in &names {
        yaml.push_str(&format!("      - {}\n", yq(n)));
    }
    yaml.push_str("rules:\n");
    if bypass_lan {
        yaml.push_str("  - IP-CIDR,127.0.0.0/8,DIRECT,no-resolve\n");
        yaml.push_str("  - IP-CIDR,192.168.0.0/16,DIRECT,no-resolve\n");
        yaml.push_str("  - IP-CIDR,10.0.0.0/8,DIRECT,no-resolve\n");
    }
    yaml.push_str(&format!("  - MATCH,{g_main}\n"));

    let core_dir = data_dir(&app)?.join("mihomo");
    std::fs::create_dir_all(&core_dir).map_err(|e| e.to_string())?;
    let cfg_file = core_dir.join("config.yaml");
    std::fs::write(&cfg_file, yaml).map_err(|e| e.to_string())?;

    let bin = resource_file(&app, "mihomo.exe")?;
    let mut cmd = Command::new(bin);
    cmd.arg("-f")
        .arg(&cfg_file)
        .arg("-d")
        .arg(&core_dir)
        .current_dir(&core_dir);
    spawn_logged(&app, &state.core, cmd, "core-log", Some("core-stopped"))?;

    apply_system_proxy(true)?;
    Ok(json!({ "nodes": names.len(), "sys_proxy": true }))
}

#[tauri::command]
fn core_stop(state: State<AppState>) -> Result<(), String> {
    let _ = apply_system_proxy(false);
    stop_child(&state.core);
    Ok(())
}

#[tauri::command]
fn system_proxy_set(enable: bool) -> Result<bool, String> {
    apply_system_proxy(enable)?;
    Ok(query_system_proxy())
}

// ---------- Mihomo REST API & IP Check ----------

#[tauri::command]
async fn mihomo_api(method: String, path: String, body: Option<String>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || mihomo_api_sync(method, path, body))
        .await
        .map_err(|e| format!("erro interno: {e}"))?
}

fn mihomo_api_sync(method: String, path: String, body: Option<String>) -> Result<Value, String> {
    let url = format!("http://{CONTROLLER}{path}");
    let mut cmd = Command::new("curl.exe");
    cmd.arg("-s").arg("--max-time").arg("6").arg("-X").arg(&method);
    if let Some(b) = &body {
        cmd.arg("-H")
            .arg("Content-Type: application/json")
            .arg("-d")
            .arg(b);
    }
    cmd.arg(&url);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.stdout.is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_slice(&out.stdout)
        .or_else(|_| Ok(Value::String(String::from_utf8_lossy(&out.stdout).into_owned())))
}

#[tauri::command]
async fn mihomo_traffic_sample() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(mihomo_traffic_sample_sync)
        .await
        .map_err(|e| format!("erro interno: {e}"))?
}

fn mihomo_traffic_sample_sync() -> Result<Value, String> {
    let mut stream = TcpStream::connect_timeout(
        &CONTROLLER.parse().map_err(|e| format!("{e}"))?,
        Duration::from_millis(800),
    )
    .map_err(|e| format!("mihomo offline: {e}"))?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1600)));
    stream
        .write_all(b"GET /traffic HTTP/1.1\r\nHost: 127.0.0.1:9097\r\nConnection: close\r\n\r\n")
        .map_err(|e| e.to_string())?;

    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    let mut in_body = false;
    for _ in 0..20 {
        line.clear();
        if reader.read_line(&mut line).unwrap_or(0) == 0 {
            break;
        }
        let trimmed = line.trim();
        if !in_body {
            if trimmed.is_empty() {
                in_body = true;
            }
            continue;
        }
        if trimmed.starts_with('{') {
            if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
                return Ok(v);
            }
        }
    }
    // Fallback if chunked/buffered
    let mut rest = String::new();
    let _ = reader.read_to_string(&mut rest);
    for l in rest.lines() {
        let t = l.trim();
        if t.starts_with('{') {
            if let Ok(v) = serde_json::from_str::<Value>(t) {
                return Ok(v);
            }
        }
    }
    Ok(json!({ "up": 0, "down": 0 }))
}

fn ping_proxy_http_sync(protocol: &str, host: &str, port: u16) -> Result<u64, String> {
    let scheme = match protocol.to_ascii_lowercase().as_str() {
        "socks5" => "socks5h",
        "socks4" => "socks4a",
        _ => "http",
    };
    let proxy_url = format!("{scheme}://{host}:{port}");
    let mut cmd = Command::new("curl.exe");
    cmd.arg("-s")
        .arg("-o")
        .arg("NUL")
        .arg("-w")
        .arg("%{http_code} %{time_pretransfer} %{time_starttransfer} %{time_total}")
        .arg("--max-time")
        .arg("5")
        .arg("-x")
        .arg(&proxy_url)
        .arg("https://www.gstatic.com/generate_204");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd.output().map_err(|e| format!("falha curl: {e}"))?;
    let raw = String::from_utf8_lossy(&out.stdout).replace(',', ".");
    let mut parts = raw.split_whitespace();
    let code: u16 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    let pre: f64 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let start_t: f64 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let total: f64 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0.0);
    if (200..400).contains(&code) {
        // Exclui overhead de spawn do curl e handshake inicial, alinhado ao unified-delay do Mihomo.
        let rtt_s = if start_t > pre { start_t - pre } else { total };
        Ok((rtt_s * 1000.0).round().max(1.0) as u64)
    } else {
        Err(format!("falhou (HTTP {code})"))
    }
}

#[tauri::command]
async fn ping_proxy_http(protocol: String, host: String, port: u16) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || ping_proxy_http_sync(&protocol, &host, port))
        .await
        .map_err(|e| format!("erro interno: {e}"))?
}

#[tauri::command]
async fn check_exit_ip(state: State<'_, AppState>) -> Result<Value, String> {
    let via_proxy = is_running(&state.core) && query_system_proxy();
    tauri::async_runtime::spawn_blocking(move || check_exit_ip_sync(via_proxy))
        .await
        .map_err(|e| format!("erro interno: {e}"))?
}

fn check_exit_ip_sync(via_proxy: bool) -> Result<Value, String> {
    let run_curl = |url: &str| -> Option<Value> {
        let mut cmd = Command::new("curl.exe");
        cmd.arg("-s").arg("--max-time").arg("10");
        if via_proxy {
            cmd.arg("-x").arg(format!("http://127.0.0.1:{MIXED_PORT}"));
        }
        cmd.arg(url);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt as _;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let out = cmd.output().ok()?;
        serde_json::from_slice::<Value>(&out.stdout).ok()
    };

    if let Some(parsed) = run_curl("https://ipwho.is/") {
        let ok = parsed.get("success").and_then(Value::as_bool).unwrap_or(true);
        if ok && parsed.get("ip").and_then(Value::as_str).is_some() {
            let asn_num = parsed.pointer("/connection/asn").and_then(Value::as_u64);
            return Ok(json!({
                "via_proxy": via_proxy,
                "ip": parsed.get("ip").cloned().unwrap_or(Value::Null),
                "country": parsed.get("country").cloned().unwrap_or(Value::Null),
                "country_code": parsed.get("country_code").cloned().unwrap_or(Value::Null),
                "region": parsed.get("region").cloned().unwrap_or(Value::Null),
                "city": parsed.get("city").cloned().unwrap_or(Value::Null),
                "isp": parsed.pointer("/connection/isp").cloned().unwrap_or(Value::Null),
                "org": parsed.pointer("/connection/org").cloned().unwrap_or(Value::Null),
                "asn": asn_num.map(|n| Value::String(format!("AS{n}"))).unwrap_or(Value::Null),
                "timezone": parsed.pointer("/timezone/id").cloned().unwrap_or(Value::Null),
                "latitude": parsed.get("latitude").cloned().unwrap_or(Value::Null),
                "longitude": parsed.get("longitude").cloned().unwrap_or(Value::Null),
            }));
        }
    }

    // Fallback caso ipwho.is bloqueie ou atinja limite no IP do proxy.
    if let Some(p2) = run_curl("http://ip-api.com/json/?fields=status,country,countryCode,regionName,city,lat,lon,timezone,isp,org,as,query") {
        if p2.get("status").and_then(Value::as_str) == Some("success") {
            let asn = p2
                .get("as")
                .and_then(Value::as_str)
                .and_then(|s| s.split_whitespace().next())
                .map(|s| Value::String(s.to_string()))
                .unwrap_or(Value::Null);
            return Ok(json!({
                "via_proxy": via_proxy,
                "ip": p2.get("query").cloned().unwrap_or(Value::Null),
                "country": p2.get("country").cloned().unwrap_or(Value::Null),
                "country_code": p2.get("countryCode").cloned().unwrap_or(Value::Null),
                "region": p2.get("regionName").cloned().unwrap_or(Value::Null),
                "city": p2.get("city").cloned().unwrap_or(Value::Null),
                "isp": p2.get("isp").cloned().unwrap_or(Value::Null),
                "org": p2.get("org").cloned().unwrap_or(Value::Null),
                "asn": asn,
                "timezone": p2.get("timezone").cloned().unwrap_or(Value::Null),
                "latitude": p2.get("lat").cloned().unwrap_or(Value::Null),
                "longitude": p2.get("lon").cloned().unwrap_or(Value::Null),
            }));
        }
    }

    Err("Não foi possível consultar o IP de saída".to_string())
}

#[tauri::command]
async fn check_unlock_service(state: State<'_, AppState>, service_id: String) -> Result<Value, String> {
    let via_proxy = is_running(&state.core);
    tauri::async_runtime::spawn_blocking(move || check_unlock_sync(&service_id, via_proxy))
        .await
        .map_err(|e| format!("erro interno: {e}"))?
}

fn check_unlock_sync(service_id: &str, via_proxy: bool) -> Result<Value, String> {
    let url = match service_id {
        "chatgpt" => "https://chatgpt.com/cdn-cgi/trace",
        "claude" => "https://claude.ai/cdn-cgi/trace",
        "gemini" => "https://gemini.google.com",
        "netflix" => "https://www.netflix.com/title/80018499",
        "disney" => "https://www.disneyplus.com",
        "prime" => "https://www.primevideo.com",
        "spotify" => "https://open.spotify.com",
        "tiktok" => "https://www.tiktok.com",
        "youtube" => "https://www.youtube.com/premium",
        "muse" => "https://muse.ai",
        "apple" => "https://www.apple.com",
        "github" => "https://github.com",
        _ => return Err("serviço desconhecido".into()),
    };

    let mut cmd = Command::new("curl.exe");
    cmd.arg("-s")
        .arg("-o")
        .arg("NUL")
        .arg("-L")
        .arg("--max-time")
        .arg("8")
        .arg("-A")
        .arg("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .arg("-w")
        .arg("%{http_code}");
    if via_proxy {
        cmd.arg("-x").arg(format!("http://127.0.0.1:{MIXED_PORT}"));
    }
    cmd.arg(url);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let out = cmd.output().map_err(|e| e.to_string())?;
    let code_str = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let code: u16 = code_str.parse().unwrap_or(0);
    let status = if code >= 200 && code < 400 {
        "Sim"
    } else if code == 403 || code == 451 {
        "Nao"
    } else {
        "Falhou"
    };
    Ok(json!({
        "id": service_id,
        "status": status,
        "code": code,
    }))
}

fn show_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn run() {
    let app = tauri::Builder::default()
        .manage(AppState {
            scraper: Mutex::new(None),
            scraper_active: Arc::new(AtomicBool::new(false)),
            scraper_cancel: Arc::new(AtomicBool::new(false)),
            core: Mutex::new(None),
        })
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "Abrir Junk Proxy", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Junk Proxy")
                .show_menu_on_left_click(false)
                .on_menu_event(|app_handle, event| match event.id.as_ref() {
                    "show" => show_main_window(app_handle),
                    "quit" => {
                        IS_EXITING.store(true, Ordering::SeqCst);
                        let state = app_handle.state::<AppState>();
                        state.scraper_cancel.store(true, Ordering::SeqCst);
                        let _ = apply_system_proxy(false);
                        stop_child(&state.core);
                        stop_child(&state.scraper);
                        app_handle.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            tray_builder.build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scraper_status,
            scraper_start,
            scraper_stop,
            scraper_get_config,
            scraper_save_config,
            scraper_read_proxies,
            scraper_clear_proxies,
            saved_proxies_read,
            saved_proxies_save,
            core_status,
            core_start,
            core_stop,
            system_proxy_set,
            mihomo_api,
            mihomo_traffic_sample,
            ping_proxy_http,
            check_exit_ip,
            check_unlock_service,
        ])
        .build(tauri::generate_context!())
        .expect("erro ao construir Junk Proxy");

    app.run(|app_handle, event| match event {
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::CloseRequested { api, .. },
            ..
        } if label == "main" && !IS_EXITING.load(Ordering::SeqCst) => {
            api.prevent_close();
            if let Some(w) = app_handle.get_webview_window("main") {
                let _ = w.hide();
            }
        }
        RunEvent::ExitRequested { api, .. } if !IS_EXITING.load(Ordering::SeqCst) => {
            api.prevent_exit();
        }
        RunEvent::Exit => {
            let state = app_handle.state::<AppState>();
            let _ = apply_system_proxy(false);
            stop_child(&state.core);
            stop_child(&state.scraper);
        }
        _ => {}
    });
}
