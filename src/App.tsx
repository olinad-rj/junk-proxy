import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Activity,
  Bookmark,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Gauge,
  Globe,
  GripVertical,
  HelpCircle,
  Home,
  Layers,
  List,
  MapPin,
  Play,
  Plus,
  Power,
  RefreshCw,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Square,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import appIcon from "./icon.png";
import { detectSystemLang, Lang, LANG_LABELS, TKey, tr } from "./i18n";

interface ScrapedProxy {
  protocol: string;
  host: string;
  port: number;
  timeout: number | null;
  country_code: string | null;
  country_name: string | null;
  anonymity: string | null;
  username: string | null;
  password: string | null;
}

interface CoreStatus {
  running: boolean;
  sys_proxy: boolean;
  port: number;
  controller: string;
}

interface ExitIpInfo {
  via_proxy: boolean;
  ip: string | null;
  country: string | null;
  country_code: string | null;
  region: string | null;
  city: string | null;
  isp: string | null;
  org: string | null;
  asn: string | null;
  timezone: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface TrafficPoint {
  up: number;
  down: number;
  ts: number;
}

interface MihomoProxyInfo {
  name: string;
  type: string;
  now?: string;
  all?: string[];
  history?: { delay: number }[];
}

interface UnlockResult {
  id: string;
  name: string;
  status: "Pendente" | "Sim" | "Nao" | "Falhou";
  code?: number;
  time?: string;
}

type Tab = "home" | "scraper" | "proxies" | "unlock" | "lists";

interface ProxyList {
  id: string;
  name: string;
  proxies: ScrapedProxy[];
}

const UNLOCK_SERVICES: { id: string; name: string }[] = [
  { id: "apple", name: "Apple" },
  { id: "chatgpt", name: "ChatGPT Web" },
  { id: "claude", name: "Claude" },
  { id: "disney", name: "Disney+" },
  { id: "gemini", name: "Gemini" },
  { id: "github", name: "GitHub" },
  { id: "muse", name: "Muse AI" },
  { id: "netflix", name: "Netflix" },
  { id: "prime", name: "Prime Video" },
  { id: "spotify", name: "Spotify" },
  { id: "tiktok", name: "TikTok" },
  { id: "youtube", name: "YouTube Premium" },
];

const fmtSpeed = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B/s`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB/s`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB/s`;
};

const fmtBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const pKey = (p: ScrapedProxy) => `${p.protocol}-${p.host}-${p.port}`;

function FlagBadge({ code }: { code?: string | null }) {
  const [failed, setFailed] = useState(false);
  const clean = code?.trim().toLowerCase();
  useEffect(() => {
    setFailed(false);
  }, [clean]);
  if (!clean || clean.length !== 2 || failed) {
    return <span className="flag-code">{clean ? clean.toUpperCase() : "--"}</span>;
  }
  return (
    <img
      className="flag-img"
      src={`https://flagcdn.com/${clean}.svg`}
      alt={clean.toUpperCase()}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function TrafficChart({
  data,
  active,
}: {
  data: TrafficPoint[];
  active: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const targetRef = useRef(data);
  const displayRef = useRef(data.map((p) => ({ ...p })));
  const lastSampleAtRef = useRef(performance.now());
  const smoothMaxRef = useRef(1024);

  useEffect(() => {
    targetRef.current = data;
    if (displayRef.current.length !== data.length) {
      displayRef.current = data.map((p) => ({ ...p }));
    } else {
      // Shift display points left to stay aligned with new sample, keep last point's Y for smooth lerp
      const prevLast = displayRef.current[displayRef.current.length - 1];
      displayRef.current = data.map((p, i) =>
        i === data.length - 1
          ? { up: prevLast?.up ?? p.up, down: prevLast?.down ?? p.down, ts: p.ts }
          : { ...p }
      );
    }
    lastSampleAtRef.current = performance.now();
  }, [data]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    let raf = 0;
    let width = wrap.clientWidth || 600;
    let height = wrap.clientHeight || 180;

    const resize = () => {
      width = Math.max(240, wrap.clientWidth);
      height = Math.max(140, wrap.clientHeight);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const draw = (now: number) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const targets = targetRef.current;
      const pts = displayRef.current;
      // Smoothly interpolate all points (especially newest) at 60fps
      for (let i = 0; i < pts.length && i < targets.length; i += 1) {
        pts[i].down += (targets[i].down - pts[i].down) * 0.18;
        pts[i].up += (targets[i].up - pts[i].up) * 0.18;
      }

      const padL = 50;
      const padR = 14;
      const padT = 16;
      const padB = 22;
      const cw = Math.max(60, width - padL - padR);
      const ch = Math.max(40, height - padT - padB);

      const targetMax = Math.max(
        1024,
        ...pts.map((p) => Math.max(p.up, p.down))
      );
      smoothMaxRef.current += (targetMax - smoothMaxRef.current) * 0.1;
      const maxVal = Math.max(1024, smoothMaxRef.current);

      // Horizontal dashed grid + Y labels
      ctx.strokeStyle = "#232838";
      ctx.lineWidth = 1;
      ctx.fillStyle = "#64748b";
      ctx.font = "10px ui-monospace, Consolas, monospace";

      for (let i = 0; i <= 2; i += 1) {
        const y = padT + (ch * i) / 2;
        ctx.save();
        if (i < 2) ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + cw, y);
        ctx.stroke();
        ctx.restore();
        const val = maxVal * (1 - i / 2);
        const label = i === 2 ? "0" : fmtSpeed(Math.round(val)).replace("/s", "");
        ctx.fillText(label, 4, y + 3);
      }

      // Vertical grid
      ctx.strokeStyle = "#1b202e";
      for (let i = 0; i <= 4; i += 1) {
        const x = padL + (cw * i) / 4;
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + ch);
        ctx.stroke();
      }

      const frac = active
        ? Math.min(1, (now - lastSampleAtRef.current) / 1000)
        : 1;
      const count = pts.length;
      const step = count > 2 ? cw / (count - 2) : cw;

      const drawCurve = (
        key: "down" | "up",
        color: string,
        gradTop: string,
        gradBot: string
      ) => {
        if (count < 2) return;
        const coords = pts.map((pt, i) => {
          const x = padL + i * step - frac * step;
          const y = padT + ch - Math.min(1, pt[key] / maxVal) * ch;
          return { x, y };
        });

        ctx.save();
        ctx.beginPath();
        ctx.rect(padL, padT - 6, cw + 4, ch + 12);
        ctx.clip();

        const tracePath = () => {
          ctx.beginPath();
          ctx.moveTo(coords[0].x, coords[0].y);
          for (let i = 0; i < coords.length - 1; i += 1) {
            const p0 = coords[Math.max(0, i - 1)];
            const p1 = coords[i];
            const p2 = coords[i + 1];
            const p3 = coords[Math.min(coords.length - 1, i + 2)];
            const cp1x = p1.x + (p2.x - p0.x) / 6;
            const cp1y = Math.min(padT + ch, Math.max(padT, p1.y + (p2.y - p0.y) / 6));
            const cp2x = p2.x - (p3.x - p1.x) / 6;
            const cp2y = Math.min(padT + ch, Math.max(padT, p2.y - (p3.y - p1.y) / 6));
            ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
          }
        };

        // Gradient fill
        tracePath();
        ctx.lineTo(coords[coords.length - 1].x, padT + ch);
        ctx.lineTo(coords[0].x, padT + ch);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, padT, 0, padT + ch);
        grad.addColorStop(0, gradTop);
        grad.addColorStop(1, gradBot);
        ctx.fillStyle = grad;
        ctx.fill();

        // Stroke line
        tracePath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.3;
        ctx.lineCap = "round";
        ctx.stroke();
        ctx.restore();

        // Glowing leading dot on active tip
        if (active) {
          const tip = coords[coords.length - 1];
          const tipX = Math.min(padL + cw, Math.max(padL, tip.x));
          const pulse = 4 + Math.sin(now / 260) * 1.5;
          ctx.beginPath();
          ctx.arc(tipX, tip.y, pulse + 2, 0, Math.PI * 2);
          ctx.fillStyle = gradTop;
          ctx.fill();

          ctx.beginPath();
          ctx.arc(tipX, tip.y, 3.2, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
        }
      };

      drawCurve("down", "#3b82f6", "rgba(59, 130, 246, 0.28)", "rgba(59, 130, 246, 0.0)");
      drawCurve("up", "#f59e0b", "rgba(245, 158, 11, 0.24)", "rgba(245, 158, 11, 0.0)");

      // X-axis timestamps
      ctx.fillStyle = "#64748b";
      ctx.font = "10px ui-monospace, Consolas, monospace";
      const fmtT = (ts: number) =>
        new Date(ts).toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
      if (pts.length > 0) {
        ctx.fillText(fmtT(pts[0].ts), padL, height - 5);
        const mid = pts[Math.floor(pts.length / 2)];
        ctx.fillText(fmtT(mid.ts), padL + cw / 2 - 22, height - 5);
        ctx.fillText(fmtT(pts[pts.length - 1].ts), padL + cw - 50, height - 5);
      }

      raf = window.requestAnimationFrame(draw);
    };

    raf = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [active]);

  return (
    <div ref={wrapRef} style={{ width: "100%", flex: 1, minHeight: 170 }}>
      <canvas ref={canvasRef} style={{ display: "block" }} />
    </div>
  );
}

export default function App() {
  const [lang, setLang] = useState<Lang>(detectSystemLang);
  const t = useCallback(
    (key: TKey, vars?: Record<string, string | number>) => tr(lang, key, vars),
    [lang]
  );
  const [tab, setTab] = useState<Tab>("home");
  const [toast, setToast] = useState<string | null>(null);
  const [core, setCore] = useState<CoreStatus>({
    running: false,
    sys_proxy: false,
    port: 7897,
    controller: "127.0.0.1:9097",
  });

  // Home: traffic, IP, TUN
  const [traffic, setTraffic] = useState<TrafficPoint[]>(() => {
    const now = Date.now();
    return Array.from({ length: 40 }, (_, i) => ({
      up: 0,
      down: 0,
      ts: now - (39 - i) * 1000,
    }));
  });
  const [totalBytes, setTotalBytes] = useState<{ up: number; down: number }>({
    up: 0,
    down: 0,
  });
  const [ipInfo, setIpInfo] = useState<ExitIpInfo | null>(null);
  const [checkingIp, setCheckingIp] = useState(false);
  const [showIp, setShowIp] = useState(false);
  const [autoIp, setAutoIp] = useState(true);
  const [ipCountdown, setIpCountdown] = useState(300);
  const [tunMode, setTunMode] = useState(false);

  // Scraper
  const [scraping, setScraping] = useState(false);
  const [proxies, setProxies] = useState<ScrapedProxy[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [proto, setProto] = useState("compat");
  const [country, setCountry] = useState("all");
  const [maxMs, setMaxMs] = useState("");
  const [sortCol, setSortCol] = useState<"ping" | "country">("ping");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [hideTransparent, setHideTransparent] = useState(true);
  const [strategy, setStrategy] = useState<"fallback" | "url-test">("fallback");
  const [killSwitch, setKillSwitch] = useState(false);
  const [bypassLan, setBypassLan] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [lastSelectedIdx, setLastSelectedIdx] = useState<number | null>(null);
  const [tcpPings, setTcpPings] = useState<Record<string, number | "timeout">>({});
  const [pingingTcp, setPingingTcp] = useState<string[]>([]);
  const [batchPingProgress, setBatchPingProgress] = useState<{ done: number; total: number } | null>(null);
  const [pingBatchSize, setPingBatchSize] = useState(10);
  const pingBatchSizeRef = useRef(10);
  const batchPingAbortRef = useRef(false);
  const [savedProxies, setSavedProxies] = useState<ScrapedProxy[]>([]);
  const [proxyLists, setProxyLists] = useState<ProxyList[]>(() => {
    try {
      const raw = localStorage.getItem("junk_proxy_lists");
      return raw ? (JSON.parse(raw) as ProxyList[]) : [];
    } catch {
      return [];
    }
  });
  const [activeListId, setActiveListId] = useState<string>("");
  const [listMaxMs, setListMaxMs] = useState("500");
  const [createListOpen, setCreateListOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [customProxyInput, setCustomProxyInput] = useState("");
  const [customProxyProto, setCustomProxyProto] = useState<"http" | "socks5">("http");
  const [fallbackQueue, setFallbackQueue] = useState<ScrapedProxy[]>(() => {
    try {
      const raw = localStorage.getItem("junk_fallback_queue");
      return raw ? (JSON.parse(raw) as ScrapedProxy[]) : [];
    } catch {
      return [];
    }
  });
  const [fallbackWidth, setFallbackWidth] = useState(260);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const fbListRef = useRef<HTMLDivElement | null>(null);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [cfgText, setCfgText] = useState("");
  const logRef = useRef<HTMLDivElement | null>(null);

  // Mihomo active proxies & tests
  const [mihomoGroups, setMihomoGroups] = useState<Record<string, MihomoProxyInfo>>({});
  const [testingNodes, setTestingNodes] = useState<string[]>([]);
  const [nodeDelays, setNodeDelays] = useState<Record<string, number | "timeout">>({});
  const [testingAll, setTestingAll] = useState(false);

  // Unlock tests
  const [unlockList, setUnlockList] = useState<UnlockResult[]>(() =>
    UNLOCK_SERVICES.map((s) => ({ ...s, status: "Pendente" }))
  );
  const [testingUnlockAll, setTestingUnlockAll] = useState(false);
  const [testingUnlockId, setTestingUnlockId] = useState<string | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 3200);
  }, []);

  const refreshCore = useCallback(async () => {
    try {
      const s = await invoke<CoreStatus>("core_status");
      setCore(s);
    } catch {
      // ignore
    }
  }, []);

  const refreshProxies = useCallback(async () => {
    try {
      const list = await invoke<ScrapedProxy[]>("scraper_read_proxies");
      setProxies(list);
    } catch (e) {
      notify(String(e));
    }
  }, [notify]);

  const refreshMihomoProxies = useCallback(async () => {
    try {
      const data = await invoke<{ proxies?: Record<string, MihomoProxyInfo> }>(
        "mihomo_api",
        { method: "GET", path: "/proxies", body: null }
      );
      if (data?.proxies) setMihomoGroups(data.proxies);
    } catch {
      setMihomoGroups({});
    }
  }, []);

  const checkExitIp = useCallback(async () => {
    setCheckingIp(true);
    try {
      const info = await invoke<ExitIpInfo>("check_exit_ip");
      setIpInfo(info);
      setIpCountdown(300);
    } catch (e) {
      notify(String(e));
    } finally {
      setCheckingIp(false);
    }
  }, [notify]);

  useEffect(() => {
    void refreshCore();
    void refreshProxies();
    void invoke<ScrapedProxy[]>("saved_proxies_read")
      .then(setSavedProxies)
      .catch(() => {});
    void checkExitIp();
    void invoke<boolean>("scraper_status").then(setScraping).catch(() => {});

    const u1 = listen<string>("scraper-log", (e) => {
      setLogs((prev) => [...prev.slice(-199), e.payload]);
    });
    const u2 = listen("scraper-finished", () => {
      setScraping(false);
      void refreshProxies();
      notify("Coleta finalizada!");
    });
    const uProxy = listen<ScrapedProxy>("scraper-proxy", (e) => {
      const item = e.payload;
      setProxies((prev) => {
        const k = `${item.protocol}://${item.host}:${item.port}`;
        if (prev.some((x) => `${x.protocol}://${x.host}:${x.port}` === k)) {
          return prev;
        }
        return [...prev, item];
      });
    });
    const uGeo = listen<Record<string, { code: string; name: string }>>(
      "scraper-countries",
      (e) => {
        const map = e.payload;
        if (!map) return;
        setProxies((prev) =>
          prev.map((p) => {
            const g = map[p.host];
            return g ? { ...p, country_code: g.code, country_name: g.name } : p;
          })
        );
      }
    );
    const u3 = listen("core-stopped", () => {
      void refreshCore();
    });
    return () => {
      void u1.then((f) => f());
      void u2.then((f) => f());
      void uProxy.then((f) => f());
      void uGeo.then((f) => f());
      void u3.then((f) => f());
    };
  }, [checkExitIp, notify, refreshCore, refreshProxies]);

  // Auto-refresh IP countdown
  useEffect(() => {
    if (!autoIp) return;
    const id = window.setInterval(() => {
      setIpCountdown((prev) => {
        if (prev <= 1) {
          void checkExitIp();
          return 300;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [autoIp, checkExitIp]);

  // Poll traffic when core is running
  useEffect(() => {
    if (!core.running) return;
    void refreshMihomoProxies();
    let inFlight = false;
    const id = window.setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const pt = await invoke<TrafficPoint>("mihomo_traffic_sample");
        const up = pt.up || 0;
        const down = pt.down || 0;
        setTraffic((prev) => [...prev.slice(1), { up, down, ts: Date.now() }]);
        setTotalBytes((prev) => ({ up: prev.up + up, down: prev.down + down }));
      } catch {
        // ignore
      } finally {
        inFlight = false;
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [core.running, refreshMihomoProxies]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const countries = useMemo(() => {
    const map = new Map<string, { name: string; count: number }>();
    for (const p of proxies) {
      if (proto === "compat" && p.protocol !== "http" && p.protocol !== "socks5")
        continue;
      if (proto !== "all" && proto !== "compat" && p.protocol !== proto) continue;
      if (hideTransparent && p.anonymity?.toLowerCase() === "transparent") continue;
      if (p.country_code) {
        const cur = map.get(p.country_code);
        map.set(p.country_code, {
          name: cur?.name || p.country_name || p.country_code,
          count: (cur?.count ?? 0) + 1,
        });
      }
    }
    return Array.from(map.entries()).sort((a, b) =>
      a[1].name.localeCompare(b[1].name)
    );
  }, [proxies, proto, hideTransparent]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const parsedMax = Number(maxMs.trim());
    const hasMax = maxMs.trim() !== "" && Number.isFinite(parsedMax) && parsedMax > 0;
    const list = proxies.filter((p) => {
      if (proto === "compat" && p.protocol !== "http" && p.protocol !== "socks5")
        return false;
      if (proto !== "all" && proto !== "compat" && p.protocol !== proto)
        return false;
      if (hideTransparent && p.anonymity?.toLowerCase() === "transparent")
        return false;
      if (
        country !== "all" &&
        (p.country_code?.toUpperCase() ?? "") !== country.toUpperCase()
      )
        return false;
      if (hasMax) {
        const real = tcpPings[pKey(p)];
        if (real === "timeout") return false;
        const msVal = typeof real === "number" ? real : p.timeout;
        if (msVal == null || msVal > parsedMax) return false;
      }
      if (!q) return true;
      return (
        p.host.toLowerCase().includes(q) ||
        String(p.port).includes(q) ||
        p.protocol.toLowerCase().includes(q) ||
        (p.country_name?.toLowerCase().includes(q) ?? false) ||
        (p.country_code?.toLowerCase().includes(q) ?? false)
      );
    });
    const pingRank = (p: ScrapedProxy): [number, number] => {
      const real = tcpPings[pKey(p)];
      if (typeof real === "number") return [0, real];
      if (real === "timeout") return [2, Number.MAX_SAFE_INTEGER];
      return [1, p.timeout ?? Number.MAX_SAFE_INTEGER];
    };
    return [...list].sort((a, b) => {
      if (sortCol === "country") {
        const ca = a.country_name || a.country_code || "ZZZ";
        const cb = b.country_name || b.country_code || "ZZZ";
        const cmp = ca.localeCompare(cb);
        return sortDir === "asc" ? cmp : -cmp;
      }
      const [ta, va] = pingRank(a);
      const [tb, vb] = pingRank(b);
      if (ta !== tb) return ta - tb;
      const cmp = va - vb;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [proxies, search, proto, country, maxMs, hideTransparent, tcpPings, sortCol, sortDir]);

  const compatVisible = useMemo(
    () => filtered.filter((p) => p.protocol === "http" || p.protocol === "socks5"),
    [filtered]
  );

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const startWithProxies = async (
    list: ScrapedProxy[],
    label: string,
    overrideStrategy?: "fallback" | "url-test"
  ) => {
    try {
      const res = await invoke<{ nodes: number }>("core_start", {
        proxies: list,
        strategy: overrideStrategy ?? strategy,
        killSwitch,
        bypassLan,
        tunMode,
      });
      setNodeDelays({});
      await refreshCore();
      await refreshMihomoProxies();
      window.setTimeout(() => void checkExitIp(), 1200);
      notify(`Conectado (${label}: ${res.nodes} nós)`);
    } catch (e) {
      notify(String(e));
    }
  };

  const handleDisconnect = async () => {
    try {
      await invoke("core_stop");
      setNodeDelays({});
      await refreshCore();
      setMihomoGroups({});
      notify("Desconectado e Proxy do Sistema desligado");
    } catch (e) {
      notify(String(e));
    }
  };

  const handleQuickConnect = async () => {
    if (core.running) {
      await handleDisconnect();
      return;
    }
    const list =
      fallbackQueue.length > 0
        ? fallbackQueue
        : selected.length > 0
          ? proxies.filter((p) => selectedSet.has(pKey(p)))
          : compatVisible;
    if (list.length === 0) {
      notify("Busque proxies antes de conectar");
      setTab("scraper");
      return;
    }
    await startWithProxies(
      list,
      fallbackQueue.length > 0 ? "Fila Fallback" : strategy === "fallback" ? "Fallback" : "Mais Rápido"
    );
  };

  const handleToggleSysProxy = async () => {
    try {
      await invoke<boolean>("system_proxy_set", { enable: !core.sys_proxy });
      await refreshCore();
    } catch (e) {
      notify(String(e));
    }
  };

  const toggleRowSelection = (
    p: ScrapedProxy,
    idx: number,
    shiftKey: boolean
  ) => {
    if (p.protocol !== "http" && p.protocol !== "socks5") return;
    const k = pKey(p);
    if (shiftKey && lastSelectedIdx !== null) {
      const start = Math.min(lastSelectedIdx, idx);
      const end = Math.max(lastSelectedIdx, idx);
      const rangeKeys = filtered
        .slice(start, end + 1)
        .filter((item) => item.protocol === "http" || item.protocol === "socks5")
        .map(pKey);
      setSelected((prev) => Array.from(new Set([...prev, ...rangeKeys])));
    } else {
      setSelected((prev) =>
        prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]
      );
    }
    setLastSelectedIdx(idx);
  };

  const pingScraperHttp = useCallback(async (p: ScrapedProxy) => {
    const k = pKey(p);
    setPingingTcp((prev) => (prev.includes(k) ? prev : [...prev, k]));
    try {
      const ms = await invoke<number>("ping_proxy_http", {
        protocol: p.protocol,
        host: p.host,
        port: p.port,
      });
      setTcpPings((prev) => ({ ...prev, [k]: ms }));
      setSavedProxies((prev) => {
        if (!prev.some((x) => pKey(x) === k)) return prev;
        const next = prev.map((x) => (pKey(x) === k ? { ...x, timeout: ms } : x));
        void invoke("saved_proxies_save", { list: next }).catch(() => {});
        return next;
      });
      setProxyLists((prev) => {
        if (!prev.some((l) => l.proxies.some((x) => pKey(x) === k))) return prev;
        return prev.map((l) => ({
          ...l,
          proxies: l.proxies.map((x) => (pKey(x) === k ? { ...x, timeout: ms } : x)),
        }));
      });
    } catch {
      setTcpPings((prev) => ({ ...prev, [k]: "timeout" }));
    } finally {
      setPingingTcp((prev) => prev.filter((x) => x !== k));
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("junk_fallback_queue", JSON.stringify(fallbackQueue));
    } catch {
      // ignore
    }
  }, [fallbackQueue]);

  useEffect(() => {
    try {
      localStorage.setItem("junk_proxy_lists", JSON.stringify(proxyLists));
    } catch {
      // ignore
    }
    if (proxyLists.length > 0 && !proxyLists.some((l) => l.id === activeListId)) {
      setActiveListId(proxyLists[0].id);
    }
  }, [proxyLists, activeListId]);

  const activeProxyList = useMemo(
    () => proxyLists.find((l) => l.id === activeListId) ?? proxyLists[0] ?? null,
    [proxyLists, activeListId]
  );

  const updateActiveListProxies = useCallback(
    (updater: (prev: ScrapedProxy[]) => ScrapedProxy[]) => {
      if (!activeProxyList) return;
      setProxyLists((prev) =>
        prev.map((l) => (l.id === activeProxyList.id ? { ...l, proxies: updater(l.proxies) } : l))
      );
    },
    [activeProxyList]
  );

  const savedSet = useMemo(() => new Set(savedProxies.map(pKey)), [savedProxies]);

  const saveProxies = useCallback(
    (items: ScrapedProxy[]) => {
      const valid = items.filter((p) => p.protocol === "http" || p.protocol === "socks5");
      if (valid.length === 0) {
        notify("Nenhum proxy HTTP ou SOCKS5 para salvar");
        return;
      }
      setSavedProxies((prev) => {
        const map = new Map(prev.map((x) => [pKey(x), x]));
        let added = 0;
        for (const p of valid) {
          const k = pKey(p);
          if (!map.has(k)) added++;
          map.set(k, p);
        }
        const next = Array.from(map.values());
        void invoke("saved_proxies_save", { list: next }).catch(() => {});
        notify(
          added > 0
            ? `${added} proxy(s) salvo(s) na lista permanente`
            : "Lista permanente atualizada"
        );
        return next;
      });
    },
    [notify]
  );

  const removeSavedProxy = useCallback((k: string) => {
    setSavedProxies((prev) => {
      const next = prev.filter((x) => pKey(x) !== k);
      void invoke("saved_proxies_save", { list: next }).catch(() => {});
      return next;
    });
  }, []);

  const parseCustomProxy = (
    raw: string,
    defaultProto: "http" | "socks5"
  ): ScrapedProxy | null => {
    let s = raw.trim();
    if (!s) return null;
    let protocol = defaultProto;
    const schemeMatch = s.match(/^(https?|socks5h?):\/\//i);
    if (schemeMatch) {
      const sc = schemeMatch[1].toLowerCase();
      protocol = sc.startsWith("socks5") ? "socks5" : "http";
      s = s.slice(schemeMatch[0].length);
    }
    s = s.split("/")[0];
    let username: string | null = null;
    let password: string | null = null;
    const atIdx = s.lastIndexOf("@");
    if (atIdx !== -1) {
      const auth = s.slice(0, atIdx);
      s = s.slice(atIdx + 1);
      const colon = auth.indexOf(":");
      if (colon !== -1) {
        username = auth.slice(0, colon);
        password = auth.slice(colon + 1);
      } else {
        username = auth;
      }
    }
    const lastColon = s.lastIndexOf(":");
    if (lastColon === -1) return null;
    const host = s.slice(0, lastColon).trim();
    const port = Number(s.slice(lastColon + 1).trim());
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    return {
      protocol,
      host,
      port,
      timeout: null,
      country_code: null,
      country_name: null,
      anonymity: null,
      username,
      password,
    };
  };

  const handleAddCustomProxy = (alsoFallback: boolean) => {
    const parsed = parseCustomProxy(customProxyInput, customProxyProto);
    if (!parsed) {
      notify("Formato inválido. Use ip:porta ou socks5://user:pass@ip:porta");
      return;
    }
    saveProxies([parsed]);
    if (alsoFallback) {
      setFallbackQueue((prev) => {
        const k = pKey(parsed);
        if (prev.some((x) => pKey(x) === k)) return prev;
        return [...prev, parsed];
      });
    }
    setCustomProxyInput("");
    void pingScraperHttp(parsed);
  };

  const pingBatchReal = useCallback(
    async (list: ScrapedProxy[]) => {
      if (list.length === 0) return;
      batchPingAbortRef.current = false;
      setBatchPingProgress({ done: 0, total: list.length });
      const batchSize = Math.max(1, pingBatchSizeRef.current);
      for (let i = 0; i < list.length; i += batchSize) {
        if (batchPingAbortRef.current) break;
        const chunk = list.slice(i, i + batchSize);
        await Promise.all(chunk.map((p) => pingScraperHttp(p)));
        setBatchPingProgress({
          done: Math.min(i + chunk.length, list.length),
          total: list.length,
        });
      }
      setBatchPingProgress(null);
    },
    [pingScraperHttp]
  );

  const handleUseInFallback = async () => {
    const list =
      selected.length > 0
        ? proxies.filter(
            (p) =>
              selectedSet.has(pKey(p)) &&
              (p.protocol === "http" || p.protocol === "socks5")
          )
        : compatVisible;
    if (list.length === 0) {
      notify("Nenhum proxy HTTP ou SOCKS5 disponível");
      return;
    }
    setFallbackQueue(list.slice(0, 300));
    setStrategy("fallback");
    await startWithProxies(list.slice(0, 300), "Fallback", "fallback");
  };

  const startPointerDrag = (startIndex: number, e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    let currentIndex = startIndex;
    let baseTop = (e.currentTarget as HTMLElement).getBoundingClientRect().top;
    const grabOffset = e.clientY - baseTop;
    setDragIdx(startIndex);
    setDragOffsetY(0);

    const onMove = (ev: PointerEvent) => {
      const container = fbListRef.current;
      if (!container) return;
      const items = Array.from(container.querySelectorAll<HTMLElement>("[data-fb-idx]"));
      const curEl = items[currentIndex];
      if (curEl) {
        setDragOffsetY(ev.clientY - grabOffset - baseTop);
      }

      let targetIdx = currentIndex;
      for (let i = 0; i < items.length; i += 1) {
        if (i === currentIndex) continue;
        const rect = items[i].getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (
          (i < currentIndex && ev.clientY < midY) ||
          (i > currentIndex && ev.clientY > midY)
        ) {
          targetIdx = i;
          break;
        }
      }
      if (targetIdx !== currentIndex) {
        const from = currentIndex;
        const to = targetIdx;
        const targetRect = items[to].getBoundingClientRect();
        baseTop += targetRect.top - items[from].getBoundingClientRect().top;
        currentIndex = to;
        setFallbackQueue((prev) => {
          const next = [...prev];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          return next;
        });
        setDragIdx(to);
        setDragOffsetY(ev.clientY - grabOffset - baseTop);
      }
    };

    const onUp = () => {
      setDragIdx(null);
      setDragOffsetY(0);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const startResizeFallback = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = fallbackWidth;
    const onMove = (ev: MouseEvent) => {
      const next = Math.min(540, Math.max(240, startW - (ev.clientX - startX)));
      setFallbackWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const testNodeDelay = async (name: string) => {
    setTestingNodes((prev) => (prev.includes(name) ? prev : [...prev, name]));
    try {
      const isGroup = name === "Fallback" || name === "Mais Rapido";
      const endpoint = isGroup
        ? `/group/${encodeURIComponent(name)}/delay?timeout=5000&url=${encodeURIComponent("https://www.gstatic.com/generate_204")}`
        : `/proxies/${encodeURIComponent(name)}/delay?timeout=5000&url=${encodeURIComponent("https://www.gstatic.com/generate_204")}`;
      const res = await invoke<{ delay?: number; message?: string } | Record<string, number>>(
        "mihomo_api",
        { method: "GET", path: endpoint, body: null }
      );
      if (isGroup) {
        const map = res as Record<string, number>;
        if (map && typeof map === "object") {
          setNodeDelays((prev) => {
            const next = { ...prev };
            for (const [k, v] of Object.entries(map)) {
              if (typeof v === "number") {
                next[k] = v > 0 ? v : "timeout";
              }
            }
            return next;
          });
        }
      } else {
        const d = (res as { delay?: number })?.delay;
        setNodeDelays((prev) => ({
          ...prev,
          [name]: typeof d === "number" && d > 0 ? d : "timeout",
        }));
      }
      await refreshMihomoProxies();
    } catch {
      setNodeDelays((prev) => ({ ...prev, [name]: "timeout" }));
    } finally {
      setTestingNodes((prev) => prev.filter((n) => n !== name));
    }
  };

  const testAllNodes = async () => {
    const main = mihomoGroups["Conexao"];
    if (!main?.all) return;
    setTestingAll(true);
    const nodes = main.all
      .filter((n) => n !== "DIRECT" && n !== "Fallback" && n !== "Mais Rapido")
      .slice(0, 60);
    for (let i = 0; i < nodes.length; i += 8) {
      await Promise.all(nodes.slice(i, i + 8).map((n) => testNodeDelay(n)));
    }
    setTestingAll(false);
    notify("Teste de latência concluído");
  };

  const selectNode = async (name: string) => {
    try {
      await invoke("mihomo_api", {
        method: "PUT",
        path: `/proxies/${encodeURIComponent("Conexao")}`,
        body: JSON.stringify({ name }),
      });
      await refreshMihomoProxies();
      notify(`Nó ativo: ${name}`);
    } catch (e) {
      notify(String(e));
    }
  };

  const testOneUnlock = async (id: string) => {
    setTestingUnlockId(id);
    try {
      const res = await invoke<{ id: string; status: "Sim" | "Nao" | "Falhou"; code?: number }>(
        "check_unlock_service",
        { serviceId: id }
      );
      const now = new Date().toLocaleTimeString("pt-BR");
      setUnlockList((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, status: res.status, code: res.code, time: now } : item
        )
      );
    } catch {
      const now = new Date().toLocaleTimeString("pt-BR");
      setUnlockList((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, status: "Falhou", time: now } : item
        )
      );
    } finally {
      setTestingUnlockId(null);
    }
  };

  const testAllUnlock = async () => {
    setTestingUnlockAll(true);
    await Promise.all(UNLOCK_SERVICES.map((s) => testOneUnlock(s.id)));
    setTestingUnlockAll(false);
    notify("Teste de desbloqueio concluído");
  };

  const currentTraffic = traffic[traffic.length - 1] ?? { up: 0, down: 0, ts: Date.now() };
  const activeGroup = mihomoGroups["Conexao"];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img
            src={appIcon}
            alt="Junk Proxy"
            style={{ width: 32, height: 32, borderRadius: "50%", flexShrink: 0 }}
          />
          <div>
            <b>Junk Proxy</b>
            <div className="row" style={{ gap: 5, marginTop: 2 }}>
              <span className={`brand-dot ${core.running ? "on" : ""}`} style={{ width: 7, height: 7 }} />
              <span style={{ fontSize: 10.5, color: "var(--muted)" }}>
                {core.running ? t("connected") : t("disconnected")}
              </span>
            </div>
          </div>
        </div>

        <button
          className={`nav-btn ${tab === "home" ? "active" : ""}`}
          onClick={() => setTab("home")}
        >
          <Home size={16} /> {t("nav_home")}
        </button>
        <button
          className={`nav-btn ${tab === "scraper" ? "active" : ""}`}
          onClick={() => setTab("scraper")}
        >
          <Search size={16} /> {t("nav_scraper")} ({proxies.length})
        </button>
        <button
          className={`nav-btn ${tab === "proxies" ? "active" : ""}`}
          onClick={() => {
            setTab("proxies");
            void refreshMihomoProxies();
          }}
        >
          <Zap size={16} /> {t("nav_proxies")}
        </button>
        <button
          className={`nav-btn ${tab === "unlock" ? "active" : ""}`}
          onClick={() => setTab("unlock")}
        >
          <ShieldCheck size={16} /> {t("nav_unlock")}
        </button>
        <button
          className={`nav-btn ${tab === "lists" ? "active" : ""}`}
          onClick={() => setTab("lists")}
        >
          <List size={16} /> {t("nav_lists")}{proxyLists.length > 0 ? ` (${proxyLists.length})` : ""}
        </button>

        <div className="side-foot">
          {t("local_port")}: <span className="mono">127.0.0.1:{core.port}</span>
          <br />
          {t("win_proxy")}:{" "}
          <b style={{ color: core.sys_proxy ? "#4ade80" : "var(--muted)" }}>
            {core.sys_proxy ? t("active") : t("off")}
          </b>
          <br />
          {t("tun_mode")}:{" "}
          <b style={{ color: tunMode ? "#60a5fa" : "var(--muted)" }}>
            {tunMode ? t("enabled") : t("off")}
          </b>
          <div style={{ marginTop: 8 }}>
            <select
              className="select"
              style={{ width: "100%", padding: "4px 6px", fontSize: 11.5 }}
              value={lang}
              onChange={(e) => {
                const next = e.target.value as Lang;
                setLang(next);
                try {
                  localStorage.setItem("junk_lang", next);
                } catch {
                  // ignore
                }
              }}
              aria-label={t("lang_label")}
            >
              {(Object.keys(LANG_LABELS) as Lang[]).map((code) => (
                <option key={code} value={code}>
                  {LANG_LABELS[code]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <h1>
            {tab === "home"
              ? t("panel_title")
              : tab === "scraper"
                ? t("scraper_title")
                : tab === "proxies"
                  ? t("proxies_title")
                  : tab === "lists"
                    ? t("lists_title")
                    : t("unlock_title")}
          </h1>
          <div className="row">
            {core.running ? (
              <button className="btn danger" onClick={handleDisconnect}>
                <Power size={15} /> {t("disconnect")}
              </button>
            ) : (
              <button className="btn success" onClick={handleQuickConnect}>
                <Power size={15} /> {t("connect")}
              </button>
            )}
            <button className="btn" onClick={handleToggleSysProxy}>
              {t("sys_proxy")}: {core.sys_proxy ? "ON" : "OFF"}
            </button>
            <button
              className={`btn ${tunMode ? "primary" : ""}`}
              title="Captura todos os apps/jogos do Windows (requer executar o Junk Proxy como Administrador)"
              onClick={() => {
                setTunMode((v) => !v);
                notify(
                  !tunMode
                    ? "Modo TUN marcado (será aplicado na próxima conexão; requer Administrador)"
                    : "Modo TUN desmarcado"
                );
              }}
            >
              <Layers size={14} /> TUN: {tunMode ? "ON" : "OFF"}
            </button>
          </div>
        </header>

        {tab === "home" && (
          <div className="content">
            <div className="split-scraper" style={{ flex: 1, minHeight: 0 }}>
              <div className="split-left" style={{ gap: 12, overflowY: "auto", paddingRight: 4 }}>
                <div className="grid2">
                  {/* Card completo de Informações de IP */}
                  <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div className="card-title" style={{ marginBottom: 0 }}>
                      <span className="row" style={{ gap: 6 }}>
                        <MapPin size={14} color="#60a5fa" />
                        <span>{t("ip_info")}</span>
                      </span>
                      <button className="btn sm" disabled={checkingIp} onClick={checkExitIp}>
                        <RefreshCw size={12} /> {checkingIp ? "..." : t("refresh")}
                      </button>
                    </div>

                    {ipInfo ? (
                      <>
                        <div className="ip-grid">
                          <div>
                            <div className="ip-row">
                              <FlagBadge code={ipInfo.country_code} />
                              <b>{ipInfo.country_code || "--"}</b>
                            </div>
                            <div className="ip-row">
                              <span className="ip-label">IP:</span>
                              <span className="mono">
                                {showIp ? ipInfo.ip || "--" : "••••••••••"}
                              </span>
                              <button
                                className="btn sm"
                                style={{ padding: "2px 5px" }}
                                onClick={() => setShowIp((v) => !v)}
                                title={showIp ? "Ocultar IP" : "Mostrar IP"}
                              >
                                {showIp ? <EyeOff size={12} /> : <Eye size={12} />}
                              </button>
                            </div>
                            <div className="ip-row">
                              <span className="ip-label">ASN:</span>
                              <span className="mono">{ipInfo.asn || "--"}</span>
                            </div>
                          </div>

                          <div>
                            <div className="ip-row">
                              <span className="ip-label">ISP:</span>
                              <span>{ipInfo.isp || "--"}</span>
                            </div>
                            <div className="ip-row">
                              <span className="ip-label">ORG:</span>
                              <span>{ipInfo.org || ipInfo.isp || "--"}</span>
                            </div>
                            <div className="ip-row">
                              <span className="ip-label">{t("ip_location")}:</span>
                              <span>
                                {[ipInfo.city, ipInfo.region].filter(Boolean).join(", ") || "--"}
                              </span>
                            </div>
                            <div className="ip-row">
                              <span className="ip-label">{t("ip_tz")}:</span>
                              <span>{ipInfo.timezone || "--"}</span>
                            </div>
                          </div>
                        </div>

                        <div
                          className="row"
                          style={{
                            justifyContent: "space-between",
                            paddingTop: 8,
                            borderTop: "1px solid var(--border)",
                            fontSize: 11.5,
                            color: "var(--muted)",
                          }}
                        >
                          <label className="row" style={{ gap: 6, cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={autoIp}
                              onChange={(e) => setAutoIp(e.target.checked)}
                            />
                            {t("auto_refresh")}: {autoIp ? `${ipCountdown}s` : "OFF"}
                          </label>
                          <span className="mono">
                            {ipInfo.country_code || "--"}
                            {ipInfo.longitude != null && ipInfo.latitude != null
                              ? `, ${ipInfo.longitude.toFixed(2)}, ${ipInfo.latitude.toFixed(2)}`
                              : ""}
                            {" · "}
                            <b style={{ color: ipInfo.via_proxy ? "#4ade80" : "var(--text)" }}>
                              {ipInfo.via_proxy ? t("via_proxy") : t("direct")}
                            </b>
                          </span>
                        </div>
                      </>
                    ) : (
                      <div style={{ color: "var(--muted)", fontSize: 12.5 }}>
                        {t("consulting_ip")}
                      </div>
                    )}
                  </div>

                  {/* Card Status & Resumo */}
                  <div
                    className="card"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      borderColor: core.running ? "rgba(34,197,94,0.4)" : undefined,
                      background: core.running
                        ? "linear-gradient(135deg, rgba(34,197,94,0.08), var(--surface))"
                        : undefined,
                    }}
                  >
                    <div>
                      <div className="card-title">
                        <span>{t("conn_status")}</span>
                        <span className={`pill ${core.running ? "green" : ""}`}>
                          127.0.0.1:{core.port}
                        </span>
                      </div>
                      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
                        <div>
                          <div
                            className="big-val"
                            style={{ color: core.running ? "#4ade80" : "var(--muted)" }}
                          >
                            {core.running ? t("connected") : t("disconnected")}
                          </div>
                          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                            {t("active_node")}: <b style={{ color: "var(--text)" }}>{activeGroup?.now || t("none")}</b>
                          </div>
                        </div>
                        <div className="row" style={{ gap: 6 }}>
                          <span className="pill blue">{t("saved_count", { n: savedProxies.length })}</span>
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        fontSize: 11.5,
                        color: "var(--muted)",
                        lineHeight: 1.5,
                        paddingTop: 10,
                        borderTop: "1px solid var(--border)",
                      }}
                    >
                      <b style={{ color: "var(--text)" }}>{t("win_routing")}</b>{" "}
                      {t("win_routing_desc")}
                    </div>
                  </div>
                </div>

                {/* Card Proxy Personalizado */}
                <div className="card" style={{ padding: "10px 14px" }}>
                  <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                    <span className="row" style={{ gap: 6, fontSize: 12, fontWeight: 700 }}>
                      <Plus size={14} color="#60a5fa" />
                      <span>{t("custom_proxy_title")}</span>
                    </span>
                    <button className="btn sm" onClick={() => setTab("proxies")}>
                      {t("view_saved", { n: savedProxies.length })}
                    </button>
                  </div>
                  <div className="row">
                    <select
                      className="select"
                      value={customProxyProto}
                      onChange={(e) => setCustomProxyProto(e.target.value as "http" | "socks5")}
                    >
                      <option value="http">HTTP</option>
                      <option value="socks5">SOCKS5</option>
                    </select>
                    <input
                      className="input"
                      style={{ flex: 1, minWidth: 200 }}
                      placeholder={t("custom_proxy_ph")}
                      value={customProxyInput}
                      onChange={(e) => setCustomProxyInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddCustomProxy(true);
                      }}
                    />
                    <button className="btn" onClick={() => handleAddCustomProxy(false)}>
                      <Bookmark size={13} /> {t("save")}
                    </button>
                    <button className="btn primary" onClick={() => handleAddCustomProxy(true)}>
                      <Plus size={13} /> {t("save_fallback")}
                    </button>
                  </div>
                </div>

                {/* Gráfico de Estatísticas de Tráfego (60fps Canvas responsivo) */}
                <div className="card" style={{ flex: 1, minHeight: 200, display: "flex", flexDirection: "column" }}>
                  <div className="card-title" style={{ marginBottom: 10 }}>
                    <span className="row" style={{ gap: 8, textTransform: "none", fontSize: 13.5, color: "var(--text)" }}>
                      <span
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 6,
                          background: "rgba(245, 158, 11, 0.14)",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Gauge size={14} color="#f59e0b" />
                      </span>
                      <b>{t("traffic_stats")}</b>
                    </span>
                    <div className="row" style={{ gap: 14, textTransform: "none", fontSize: 11.5 }}>
                      <span style={{ color: "#f59e0b", fontWeight: 600 }}>
                        {t("upload")}: <span className="mono">{fmtSpeed(currentTraffic.up)}</span> ({fmtBytes(totalBytes.up)})
                      </span>
                      <span style={{ color: "#3b82f6", fontWeight: 600 }}>
                        {t("download")}: <span className="mono">{fmtSpeed(currentTraffic.down)}</span> ({fmtBytes(totalBytes.down)})
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      background: "var(--surface2)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      padding: "8px 10px 6px",
                    }}
                  >
                    <div className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
                      <span className="pill" style={{ fontSize: 10.5, padding: "2px 8px" }}>
                        {t("realtime")}
                      </span>
                      <div className="row" style={{ gap: 10, fontSize: 11, fontWeight: 600 }}>
                        <span style={{ color: "#f59e0b" }}>{t("upload")}</span>
                        <span style={{ color: "#3b82f6" }}>{t("download")}</span>
                      </div>
                    </div>

                    <TrafficChart data={traffic} active={core.running} />

                    <div
                      className="row"
                      style={{
                        justifyContent: "space-between",
                        fontSize: 10.5,
                        color: "#64748b",
                        marginTop: 2,
                      }}
                    >
                      <span>{t("points_interval", { n: traffic.length })}</span>
                      <span>{t("smooth_fps")}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div
                className="split-resizer"
                title="Arraste para redimensionar o painel Fallback"
                onMouseDown={startResizeFallback}
              />

              {/* Fila do Fallback visível no Início */}
              <aside className="split-right" style={{ width: fallbackWidth }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div className="row" style={{ gap: 6 }}>
                    <Shield size={15} color="#60a5fa" />
                    <b>{t("fallback_queue", { n: fallbackQueue.length })}</b>
                  </div>
                  {fallbackQueue.length > 0 && (
                    <button className="btn sm" onClick={() => setFallbackQueue([])}>
                      {t("clear")}
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                  {t("fallback_hint")}
                </div>

                <div className="fb-list" ref={fbListRef}>
                  {fallbackQueue.length === 0 ? (
                    <div style={{ color: "var(--muted)", fontSize: 12, padding: "18px 6px", textAlign: "center" }}>
                      {t("fallback_empty_home")}
                    </div>
                  ) : (
                    fallbackQueue.map((p, idx) => (
                      <div
                        key={pKey(p)}
                        data-fb-idx={idx}
                        onPointerDown={(e) => startPointerDrag(idx, e)}
                        className={`fb-item ${dragIdx === idx ? "dragging" : ""}`}
                        style={
                          dragIdx === idx
                            ? { transform: `translateY(${dragOffsetY}px) scale(1.02)` }
                            : undefined
                        }
                      >
                        <div className="row" style={{ gap: 6, minWidth: 0, flexWrap: "nowrap" }}>
                          <GripVertical size={14} color="#64748b" style={{ flexShrink: 0 }} />
                          <span className="fb-rank">#{idx + 1}</span>
                          <FlagBadge code={p.country_code} />
                          <div style={{ minWidth: 0 }}>
                            <div className="mono" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis" }}>
                              {p.host}:{p.port}
                            </div>
                            <div style={{ fontSize: 10.5, color: "var(--muted)" }}>
                              {p.protocol.toUpperCase()}
                              {p.timeout != null ? ` · ${Math.round(p.timeout)}ms` : ""}
                            </div>
                          </div>
                        </div>
                        <button
                          className="btn sm"
                          style={{ padding: "3px 5px" }}
                          onClick={() => setFallbackQueue((prev) => prev.filter((_, i) => i !== idx))}
                          title="Remover"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <button
                  className="btn primary"
                  style={{ width: "100%", justifyContent: "center" }}
                  disabled={fallbackQueue.length === 0}
                  onClick={() => startWithProxies(fallbackQueue, "Fallback", "fallback")}
                >
                  <Power size={14} /> {t("apply_connect", { n: fallbackQueue.length })}
                </button>
              </aside>
            </div>
          </div>
        )}

        {tab === "scraper" && (
          <div className="content">
            <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div className="row">
                  {scraping ? (
                    <button
                      className="btn danger"
                      onClick={() => invoke("scraper_stop").then(() => setScraping(false))}
                    >
                      <Square size={14} /> {t("stop_scrape")}
                    </button>
                  ) : (
                    <button
                      className="btn primary"
                      onClick={() => {
                        batchPingAbortRef.current = true;
                        setProxies([]);
                        setSelected([]);
                        setTcpPings({});
                        setLogs([]);
                        setLogsOpen(true);
                        setScraping(true);
                        void invoke("scraper_start", { batchSize: pingBatchSize }).catch((e) => {
                          setScraping(false);
                          notify(String(e));
                        });
                      }}
                    >
                      <Play size={14} /> {t("start_scrape")}
                    </button>
                  )}
                  <button
                    className="btn success"
                    disabled={compatVisible.length === 0 && selected.length === 0}
                    onClick={handleUseInFallback}
                  >
                    <Shield size={14} />{" "}
                    {selected.length > 0
                      ? t("use_selected_fb", { n: selected.length })
                      : t("use_all_fb")}
                  </button>
                  <select
                    className="select"
                    value={pingBatchSize}
                    disabled={!!batchPingProgress}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setPingBatchSize(v);
                      pingBatchSizeRef.current = v;
                    }}
                  >
                    <option value={10}>{t("per_batch", { n: 10 })}</option>
                    <option value={20}>{t("per_batch", { n: 20 })}</option>
                    <option value={30}>{t("per_batch", { n: 30 })}</option>
                    <option value={50}>{t("per_batch", { n: 50 })}</option>
                  </select>
                  <button
                    className={`btn ${batchPingProgress ? "danger" : ""}`}
                    disabled={!batchPingProgress && filtered.length === 0}
                    onClick={() => {
                      if (batchPingProgress) {
                        batchPingAbortRef.current = true;
                      } else {
                        void pingBatchReal(filtered);
                      }
                    }}
                  >
                    <Zap size={14} />{" "}
                    {batchPingProgress
                      ? t("stop_ping", { done: batchPingProgress.done, total: batchPingProgress.total })
                      : t("real_ping", { n: pingBatchSize })}
                  </button>
                  <button
                    className="btn"
                    disabled={compatVisible.length === 0 && selected.length === 0}
                    onClick={() => {
                      const items =
                        selected.length > 0
                          ? proxies.filter((p) => selectedSet.has(pKey(p)))
                          : compatVisible;
                      saveProxies(items);
                    }}
                  >
                    <Bookmark size={14} />{" "}
                    {selected.length > 0 ? t("save_n", { n: selected.length }) : t("save_working")}
                  </button>
                  <button
                    className="btn"
                    disabled={selected.length === 0}
                    onClick={() => {
                      setNewListName(`Lista ${proxyLists.length + 1}`);
                      setCreateListOpen(true);
                    }}
                  >
                    <Plus size={14} /> {t("create_list_sel", { n: selected.length })}
                  </button>
                  <button
                    className="btn"
                    onClick={async () => {
                      setCfgText(await invoke<string>("scraper_get_config"));
                      setCfgOpen(true);
                    }}
                  >
                    <Settings size={14} /> config.toml
                  </button>
                  <button
                    className="btn"
                    disabled={proxies.length === 0}
                    onClick={async () => {
                      await invoke("scraper_clear_proxies").catch(() => {});
                      setProxies([]);
                      setSelected([]);
                      setTcpPings({});
                    }}
                  >
                    <Trash2 size={14} /> {t("clear_list")}
                  </button>
                </div>
                <span className="pill blue">
                  {t("showing_of", { a: filtered.length, b: proxies.length })}
                </span>
              </div>

              <div className="row">
                <input
                  className="input"
                  style={{ flex: 1, minWidth: 160 }}
                  placeholder={t("search_ph")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <select className="select" value={proto} onChange={(e) => setProto(e.target.value)}>
                  <option value="compat">HTTP + SOCKS5</option>
                  <option value="all">{t("all")}</option>
                  <option value="http">HTTP</option>
                  <option value="socks5">SOCKS5</option>
                  <option value="socks4">SOCKS4</option>
                </select>
                <select className="select" value={country} onChange={(e) => setCountry(e.target.value)}>
                  <option value="all">{t("all_countries", { n: countries.length })}</option>
                  {countries.map(([c, info]) => (
                    <option key={c} value={c}>
                      [{c}] {info.name} ({info.count})
                    </option>
                  ))}
                </select>
                <input
                  className="input"
                  style={{ width: 115 }}
                  type="number"
                  list="ping-presets"
                  placeholder={t("max_ms")}
                  value={maxMs}
                  onChange={(e) => setMaxMs(e.target.value)}
                />
                <datalist id="ping-presets">
                  <option value="150" />
                  <option value="300" />
                  <option value="600" />
                  <option value="1000" />
                </datalist>
                <button className="btn sm" onClick={refreshProxies}>
                  <RefreshCw size={13} />
                </button>
              </div>

              <div className="row" style={{ fontSize: 12, color: "var(--muted)", gap: 14 }}>
                <select
                  className="select"
                  value={strategy}
                  onChange={(e) => setStrategy(e.target.value as "fallback" | "url-test")}
                >
                  <option value="fallback">{t("mode_fallback")}</option>
                  <option value="url-test">{t("mode_fastest")}</option>
                </select>
                <label className="row" style={{ gap: 5, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={hideTransparent}
                    onChange={(e) => setHideTransparent(e.target.checked)}
                  />
                  {t("anti_transparent")}
                </label>
                <label className="row" style={{ gap: 5, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={bypassLan}
                    onChange={(e) => setBypassLan(e.target.checked)}
                  />
                  Bypass LAN
                </label>
                <label className="row" style={{ gap: 5, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={killSwitch}
                    onChange={(e) => setKillSwitch(e.target.checked)}
                  />
                  Kill-Switch
                </label>
                {selected.length > 0 && (
                  <button className="btn sm" onClick={() => setSelected([])}>
                    {t("clear_selection", { n: selected.length })}
                  </button>
                )}
              </div>
            </div>

            <div className="split-scraper">
              <div className="split-left">
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 32 }}>
                          <input
                            type="checkbox"
                            checked={
                              compatVisible.length > 0 &&
                              compatVisible.every((p) => selectedSet.has(pKey(p)))
                            }
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelected(compatVisible.map(pKey));
                              } else {
                                setSelected([]);
                              }
                            }}
                          />
                        </th>
                        <th
                          style={{ cursor: "pointer", userSelect: "none" }}
                          onClick={() => {
                            if (sortCol === "country") {
                              setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                            } else {
                              setSortCol("country");
                              setSortDir("asc");
                            }
                          }}
                          title="Ordenar por país"
                        >
                          {t("col_country")} {sortCol === "country" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                        </th>
                        <th>{t("col_address")}</th>
                        <th>{t("col_protocol")}</th>
                        <th
                          style={{ cursor: "pointer", userSelect: "none" }}
                          onClick={() => {
                            if (sortCol === "ping") {
                              setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                            } else {
                              setSortCol("ping");
                              setSortDir("asc");
                            }
                          }}
                        >
                          {t("col_latency")} {sortCol === "ping" ? (sortDir === "asc" ? "▲" : "▼") : ""}
                        </th>
                        <th style={{ textAlign: "right" }}>{t("col_actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((p, idx) => {
                        const k = pKey(p);
                        const ok = p.protocol === "http" || p.protocol === "socks5";
                        const isSel = selectedSet.has(k);
                        const tcpVal = tcpPings[k];
                        const ms = p.timeout != null ? Math.round(p.timeout) : null;
                        return (
                          <tr
                            key={k}
                            className={`${ok ? "row-clickable" : ""} ${isSel ? "row-selected" : ""}`}
                            onClick={(e) => {
                              if ((e.target as HTMLElement).closest("button, input")) return;
                              if (window.getSelection()?.toString()) return;
                              toggleRowSelection(p, idx, e.shiftKey);
                            }}
                          >
                            <td>
                              <input
                                type="checkbox"
                                disabled={!ok}
                                checked={isSel}
                                onChange={(e) =>
                                  toggleRowSelection(
                                    p,
                                    idx,
                                    (e.nativeEvent as MouseEvent).shiftKey
                                  )
                                }
                              />
                            </td>
                            <td>
                              <div className="row" style={{ gap: 7, flexWrap: "nowrap" }}>
                                <FlagBadge code={p.country_code} />
                                <span>{p.country_name || p.country_code || t("unknown")}</span>
                              </div>
                            </td>
                            <td className="mono">
                              {p.host}:{p.port}
                            </td>
                            <td>
                              <span className={`pill ${p.protocol === "socks5" ? "blue" : ""}`}>
                                {p.protocol.toUpperCase()}
                              </span>
                            </td>
                            <td>
                              {tcpVal === "timeout" ? (
                                <span className="pill red mono">{t("failed")}</span>
                              ) : typeof tcpVal === "number" ? (
                                <span
                                  className={`pill mono ${
                                    tcpVal < 300 ? "green" : tcpVal <= 1000 ? "amber" : "red"
                                  }`}
                                  title="Ping real generate_204 pelo túnel do proxy"
                                >
                                  {tcpVal} ms
                                </span>
                              ) : (
                                <span
                                  className={`pill mono ${
                                    ms == null
                                      ? ""
                                      : ms < 300
                                        ? "green"
                                        : ms <= 1000
                                          ? "amber"
                                          : "red"
                                  }`}
                                  title="Tempo total da requisição HTTPS na coleta"
                                >
                                  {ms != null ? `${ms} ms` : "--"}
                                </span>
                              )}
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                                <button
                                  className="btn sm"
                                  disabled={pingingTcp.includes(k)}
                                  onClick={() => pingScraperHttp(p)}
                                  title="Medir ping real (generate_204) através do proxy"
                                >
                                  {pingingTcp.includes(k) ? "..." : "Ping"}
                                </button>
                                <button
                                  className="btn sm success"
                                  disabled={!ok}
                                  onClick={() => startWithProxies([p], `${p.host}:${p.port}`)}
                                >
                                  {t("use")}
                                </button>
                                <button
                                  className="btn sm"
                                  disabled={!ok}
                                  onClick={() => saveProxies([p])}
                                  title={savedSet.has(k) ? "Já salvo na lista permanente" : "Salvar na lista permanente"}
                                  style={savedSet.has(k) ? { borderColor: "rgba(59,130,246,0.5)", color: "#60a5fa" } : undefined}
                                >
                                  <Bookmark size={12} />
                                </button>
                                <button
                                  className="btn sm"
                                  onClick={() => {
                                    void navigator.clipboard.writeText(
                                      `${p.protocol}://${p.host}:${p.port}`
                                    );
                                    notify(`Copiado ${p.host}:${p.port}`);
                                  }}
                                >
                                  <Copy size={12} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="card" style={{ padding: "8px 12px" }}>
                  <div
                    className="row"
                    style={{ justifyContent: "space-between", cursor: "pointer" }}
                    onClick={() => setLogsOpen((v) => !v)}
                  >
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>
                      {t("logs_title", {
                        n: logs.length,
                        state: logsOpen ? t("collapse") : t("expand"),
                      })}
                    </span>
                    {logs.length > 0 && (
                      <div className="row" style={{ gap: 6 }}>
                        <button
                          className="btn sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            void navigator.clipboard.writeText(logs.join("\n"));
                            notify("Logs copiados!");
                          }}
                        >
                          <Copy size={12} /> {t("copy")}
                        </button>
                        <button
                          className="btn sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLogs([]);
                          }}
                        >
                          {t("clear")}
                        </button>
                      </div>
                    )}
                  </div>
                  {logsOpen && (
                    <div ref={logRef} className="log-box" style={{ marginTop: 8 }}>
                      {logs.length === 0 ? t("waiting_scrape") : logs.join("\n")}
                    </div>
                  )}
                </div>
              </div>

              <div
                className="split-resizer"
                title="Arraste para redimensionar o painel Fallback"
                onMouseDown={startResizeFallback}
              />

              {/* Painel direito redimensionável com Drag-and-Drop */}
              <aside className="split-right" style={{ width: fallbackWidth }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div className="row" style={{ gap: 6 }}>
                    <Shield size={15} color="#60a5fa" />
                    <b>{t("fallback_queue", { n: fallbackQueue.length })}</b>
                  </div>
                  {fallbackQueue.length > 0 && (
                    <button className="btn sm" onClick={() => setFallbackQueue([])}>
                      {t("clear")}
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                  {t("fallback_hint")}
                </div>

                <div className="fb-list" ref={fbListRef}>
                  {fallbackQueue.length === 0 ? (
                    <div style={{ color: "var(--muted)", fontSize: 12, padding: "18px 6px", textAlign: "center" }}>
                      {t("fallback_empty_scraper")}
                    </div>
                  ) : (
                    fallbackQueue.map((p, idx) => (
                      <div
                        key={pKey(p)}
                        data-fb-idx={idx}
                        onPointerDown={(e) => startPointerDrag(idx, e)}
                        className={`fb-item ${dragIdx === idx ? "dragging" : ""}`}
                        style={
                          dragIdx === idx
                            ? { transform: `translateY(${dragOffsetY}px) scale(1.02)` }
                            : undefined
                        }
                      >
                        <div className="row" style={{ gap: 6, minWidth: 0, flexWrap: "nowrap" }}>
                          <GripVertical size={14} color="#64748b" style={{ flexShrink: 0 }} />
                          <span className="fb-rank">#{idx + 1}</span>
                          <FlagBadge code={p.country_code} />
                          <div style={{ minWidth: 0 }}>
                            <div className="mono" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis" }}>
                              {p.host}:{p.port}
                            </div>
                            <div style={{ fontSize: 10.5, color: "var(--muted)" }}>
                              {p.protocol.toUpperCase()}
                              {p.timeout != null ? ` · ${Math.round(p.timeout)}ms` : ""}
                            </div>
                          </div>
                        </div>
                        <button
                          className="btn sm"
                          style={{ padding: "3px 5px" }}
                          onClick={() => setFallbackQueue((prev) => prev.filter((_, i) => i !== idx))}
                          title="Remover"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <button
                  className="btn primary"
                  style={{ width: "100%", justifyContent: "center" }}
                  disabled={fallbackQueue.length === 0}
                  onClick={() => startWithProxies(fallbackQueue, "Fallback Reordenado", "fallback")}
                >
                  <Power size={14} /> {t("apply_order", { n: fallbackQueue.length })}
                </button>
              </aside>
            </div>
          </div>
        )}

        {tab === "proxies" && (
          <div className="content">
            {/* Seção 1: Meus Proxies Salvos & Personalizados (sempre visível, mesmo desconectado) */}
            <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div className="row" style={{ gap: 8 }}>
                  <Bookmark size={15} color="#60a5fa" />
                  <b>{t("saved_proxies_title", { n: savedProxies.length })}</b>
                  <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                    {t("saved_proxies_sub")}
                  </span>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <select
                    className="select"
                    value={pingBatchSize}
                    disabled={!!batchPingProgress}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setPingBatchSize(v);
                      pingBatchSizeRef.current = v;
                    }}
                  >
                    <option value={10}>{t("per_batch", { n: 10 })}</option>
                    <option value={20}>{t("per_batch", { n: 20 })}</option>
                    <option value={30}>{t("per_batch", { n: 30 })}</option>
                    <option value={50}>{t("per_batch", { n: 50 })}</option>
                  </select>
                  <button
                    className={`btn ${batchPingProgress ? "danger" : "primary"}`}
                    disabled={!batchPingProgress && savedProxies.length === 0}
                    onClick={() => {
                      if (batchPingProgress) {
                        batchPingAbortRef.current = true;
                      } else {
                        void pingBatchReal(savedProxies);
                      }
                    }}
                  >
                    <Zap size={14} />{" "}
                    {batchPingProgress
                      ? t("stop_n", { done: batchPingProgress.done, total: batchPingProgress.total })
                      : t("retest_real_ping")}
                  </button>
                  <button
                    className="btn danger"
                    disabled={savedProxies.length === 0}
                    onClick={() => {
                      let removed = 0;
                      setSavedProxies((prev) => {
                        const next = prev.filter((p) => {
                          const fail = tcpPings[pKey(p)] === "timeout";
                          if (fail) removed++;
                          return !fail;
                        });
                        void invoke("saved_proxies_save", { list: next }).catch(() => {});
                        return next;
                      });
                      notify(`${removed} proxy(s) que falharam removido(s)`);
                    }}
                  >
                    <Trash2 size={14} /> {t("delete_failed")}
                  </button>
                  <button
                    className="btn success"
                    disabled={savedProxies.length === 0}
                    onClick={() => startWithProxies(savedProxies, "Salvos", strategy)}
                  >
                    <Power size={14} /> {t("connect_saved")}
                  </button>
                </div>
              </div>

              <div className="row">
                <select
                  className="select"
                  value={customProxyProto}
                  onChange={(e) => setCustomProxyProto(e.target.value as "http" | "socks5")}
                >
                  <option value="http">HTTP</option>
                  <option value="socks5">SOCKS5</option>
                </select>
                <input
                  className="input"
                  style={{ flex: 1, minWidth: 200 }}
                  placeholder={t("custom_proxy_ph")}
                  value={customProxyInput}
                  onChange={(e) => setCustomProxyInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddCustomProxy(false);
                  }}
                />
                <button className="btn" onClick={() => handleAddCustomProxy(false)}>
                  <Plus size={13} /> {t("add")}
                </button>
                <button className="btn primary" onClick={() => handleAddCustomProxy(true)}>
                  <Plus size={13} /> {t("add_fallback")}
                </button>
              </div>

              <div className="table-wrap" style={{ maxHeight: core.running ? 240 : 420 }}>
                <table>
                  <thead>
                    <tr>
                      <th>{t("col_country")}</th>
                      <th>{t("col_address")}</th>
                      <th>{t("col_protocol")}</th>
                      <th>{t("col_latency")}</th>
                      <th style={{ textAlign: "right" }}>{t("col_actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {savedProxies.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>
                          {t("empty_saved")}
                        </td>
                      </tr>
                    ) : (
                      savedProxies.map((p) => {
                        const k = pKey(p);
                        const val = tcpPings[k] ?? (p.timeout != null ? Math.round(p.timeout) : null);
                        return (
                          <tr key={k}>
                            <td>
                              <div className="row" style={{ gap: 7, flexWrap: "nowrap" }}>
                                <FlagBadge code={p.country_code} />
                                <span>{p.country_name || p.country_code || t("custom_label")}</span>
                              </div>
                            </td>
                            <td className="mono">
                              {p.host}:{p.port}
                              {p.username ? " (auth)" : ""}
                            </td>
                            <td>
                              <span className={`pill ${p.protocol === "socks5" ? "blue" : ""}`}>
                                {p.protocol.toUpperCase()}
                              </span>
                            </td>
                            <td className="mono">
                              {val === "timeout" ? (
                                <span className="pill red">{t("failed")}</span>
                              ) : typeof val === "number" ? (
                                <span className={`pill ${val < 300 ? "green" : val <= 1000 ? "amber" : "red"}`}>
                                  {val} ms
                                </span>
                              ) : (
                                "--"
                              )}
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                                <button
                                  className="btn sm"
                                  disabled={pingingTcp.includes(k)}
                                  onClick={() => pingScraperHttp(p)}
                                >
                                  {pingingTcp.includes(k) ? "..." : "Ping"}
                                </button>
                                <button
                                  className="btn sm"
                                  onClick={() => {
                                    setFallbackQueue((prev) =>
                                      prev.some((x) => pKey(x) === k) ? prev : [...prev, p]
                                    );
                                    notify(`+ Fallback: ${p.host}:${p.port}`);
                                  }}
                                >
                                  + Fallback
                                </button>
                                <button
                                  className="btn sm success"
                                  onClick={() => startWithProxies([p], `${p.host}:${p.port}`)}
                                >
                                  {t("use")}
                                </button>
                                <button
                                  className="btn sm"
                                  onClick={() => removeSavedProxy(k)}
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Seção 2: Nós Ativos no Mihomo (quando conectado) */}
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="row">
                <Globe size={16} />
                <span>
                  {t("mihomo_active")} <b>{activeGroup?.now || t("disconnected")}</b>
                </span>
              </div>
              <div className="row">
                <button
                  className="btn primary"
                  disabled={!core.running || testingAll}
                  onClick={testAllNodes}
                >
                  <Zap size={14} /> {testingAll ? t("testing") : t("test_mihomo")}
                </button>
                <button
                  className="btn"
                  disabled={!core.running && Object.keys(mihomoGroups).length === 0}
                  onClick={async () => {
                    await handleDisconnect();
                    setNodeDelays({});
                  }}
                >
                  <Trash2 size={14} /> {t("clear_list")}
                </button>
                <button className="btn" onClick={refreshMihomoProxies}>
                  <RefreshCw size={14} />
                </button>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("col_node")}</th>
                    <th>{t("col_type")}</th>
                    <th>{t("col_mihomo_ping")}</th>
                    <th style={{ textAlign: "right" }}>{t("col_actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(activeGroup?.all || []).map((name) => {
                    const info = mihomoGroups[name];
                    const histDelay = info?.history?.[info.history.length - 1]?.delay;
                    const localDelay = nodeDelays[name];
                    const displayDelay =
                      typeof localDelay === "number"
                        ? localDelay
                        : localDelay === "timeout"
                          ? "timeout"
                          : histDelay && histDelay > 0
                            ? histDelay
                            : null;
                    const isCurrent = activeGroup?.now === name;
                    const isTesting = testingNodes.includes(name);
                    return (
                      <tr key={name}>
                        <td>
                          <b>{name}</b>{" "}
                          {isCurrent && <span className="pill green">Em uso</span>}
                        </td>
                        <td>{info?.type || "--"}</td>
                        <td className="mono">
                          {displayDelay === "timeout" ? (
                            <span className="pill red">Timeout</span>
                          ) : typeof displayDelay === "number" ? (
                            <span
                              className={`pill ${
                                displayDelay < 300
                                  ? "green"
                                  : displayDelay <= 1000
                                    ? "amber"
                                    : "red"
                              }`}
                            >
                              {displayDelay} ms
                            </span>
                          ) : (
                            "--"
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                            {name !== "DIRECT" && (
                              <button
                                className="btn sm"
                                disabled={isTesting}
                                onClick={() => testNodeDelay(name)}
                              >
                                {isTesting ? "..." : "Ping"}
                              </button>
                            )}
                            <button
                              className={`btn sm ${isCurrent ? "" : "primary"}`}
                              disabled={isCurrent}
                              onClick={() => selectNode(name)}
                            >
                              {isCurrent ? "Ativo" : "Selecionar"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "unlock" && (
          <div className="content">
            <div className="row" style={{ justifyContent: "space-between" }}>
                <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                  {core.running ? t("unlock_desc_proxy") : t("unlock_desc_direct")}
                </span>
                <button
                  className="btn primary"
                  disabled={testingUnlockAll}
                  onClick={testAllUnlock}
                >
                  <RefreshCw size={14} /> {testingUnlockAll ? t("testing") : t("test_all")}
                </button>
            </div>

            <div className="grid3">
              {unlockList.map((item) => (
                <div className="unlock-card" key={item.id}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <b style={{ fontSize: 13.5 }}>{item.name}</b>
                    <button
                      className="btn sm"
                      style={{ padding: "4px 6px" }}
                      disabled={testingUnlockId === item.id || testingUnlockAll}
                      onClick={() => testOneUnlock(item.id)}
                      title="Testar serviço"
                    >
                      <RefreshCw size={13} />
                    </button>
                  </div>

                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span
                      className={`pill ${
                        item.status === "Sim"
                          ? "green"
                          : item.status === "Nao"
                            ? "red"
                            : item.status === "Falhou"
                              ? "amber"
                              : ""
                      }`}
                    >
                      {item.status === "Sim" && <CheckCircle2 size={12} />}
                      {item.status === "Nao" && <XCircle size={12} />}
                      {item.status === "Falhou" && <HelpCircle size={12} />}
                      {item.status === "Nao" ? "Não" : item.status}
                      {item.code ? ` (${item.code})` : ""}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      {item.time || "--"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "lists" && (
          <div className="content">
            <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div className="row" style={{ gap: 8 }}>
                  <List size={16} color="#60a5fa" />
                  <b>{t("lists_header")}</b>
                  <select
                    className="select"
                    value={activeProxyList?.id || ""}
                    onChange={(e) => setActiveListId(e.target.value)}
                    disabled={proxyLists.length === 0}
                  >
                    {proxyLists.length === 0 ? (
                      <option value="">{t("no_list_created")}</option>
                    ) : (
                      proxyLists.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name} ({l.proxies.length})
                        </option>
                      ))
                    )}
                  </select>
                  {activeProxyList && (
                    <button
                      className="btn sm danger"
                      onClick={() => {
                        setProxyLists((prev) => prev.filter((l) => l.id !== activeProxyList.id));
                      }}
                    >
                      <Trash2 size={12} /> {t("delete_list")}
                    </button>
                  )}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <select
                    className="select"
                    value={pingBatchSize}
                    disabled={!!batchPingProgress}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setPingBatchSize(v);
                      pingBatchSizeRef.current = v;
                    }}
                  >
                    <option value={10}>{t("per_batch", { n: 10 })}</option>
                    <option value={20}>{t("per_batch", { n: 20 })}</option>
                    <option value={30}>{t("per_batch", { n: 30 })}</option>
                    <option value={50}>{t("per_batch", { n: 50 })}</option>
                  </select>
                  <button
                    className={`btn ${batchPingProgress ? "danger" : "primary"}`}
                    disabled={!batchPingProgress && (!activeProxyList || activeProxyList.proxies.length === 0)}
                    onClick={() => {
                      if (batchPingProgress) {
                        batchPingAbortRef.current = true;
                      } else if (activeProxyList) {
                        void pingBatchReal(activeProxyList.proxies);
                      }
                    }}
                  >
                    <Zap size={14} />{" "}
                    {batchPingProgress
                      ? t("stop_ping", { done: batchPingProgress.done, total: batchPingProgress.total })
                      : t("real_ping_btn")}
                  </button>
                </div>
              </div>

              <div className="row" style={{ justifyContent: "space-between" }}>
                <div className="row" style={{ gap: 6 }}>
                  <button
                    className="btn sm danger"
                    disabled={!activeProxyList || activeProxyList.proxies.length === 0}
                    onClick={() => {
                      if (!activeProxyList) return;
                      updateActiveListProxies((prev) =>
                        prev.filter((p) => tcpPings[pKey(p)] !== "timeout")
                      );
                    }}
                  >
                    <Trash2 size={12} /> {t("delete_failed")}
                  </button>
                  <input
                    className="input"
                    style={{ width: 95 }}
                    type="number"
                    value={listMaxMs}
                    onChange={(e) => setListMaxMs(e.target.value)}
                    placeholder={t("max_ms")}
                  />
                  <button
                    className="btn sm"
                    disabled={!activeProxyList || activeProxyList.proxies.length === 0}
                    onClick={() => {
                      if (!activeProxyList) return;
                      const limit = Number(listMaxMs);
                      if (!Number.isFinite(limit) || limit <= 0) return;
                      updateActiveListProxies((prev) =>
                        prev.filter((p) => {
                          const real = tcpPings[pKey(p)];
                          const ms = typeof real === "number" ? real : p.timeout;
                          return !(typeof ms === "number" && ms > limit);
                        })
                      );
                    }}
                  >
                    <Trash2 size={12} /> {t("delete_over_ms", { ms: listMaxMs || "500" })}
                  </button>
                </div>

                <div className="row" style={{ gap: 6 }}>
                  <button
                    className="btn sm"
                    disabled={!activeProxyList || activeProxyList.proxies.length === 0}
                    onClick={() => {
                      if (!activeProxyList) return;
                      setFallbackQueue(activeProxyList.proxies.slice(0, 300));
                    }}
                  >
                    <Shield size={12} /> {t("send_to_fb")}
                  </button>
                  <button
                    className="btn sm success"
                    disabled={!activeProxyList || activeProxyList.proxies.length === 0}
                    onClick={() => {
                      if (!activeProxyList) return;
                      void startWithProxies(activeProxyList.proxies, activeProxyList.name, strategy);
                    }}
                  >
                    <Power size={12} /> {t("connect_list")}
                  </button>
                </div>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("col_country")}</th>
                    <th>{t("col_address")}</th>
                    <th>{t("col_protocol")}</th>
                    <th>{t("col_latency")}</th>
                    <th style={{ textAlign: "right" }}>{t("col_actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {!activeProxyList || activeProxyList.proxies.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>
                        {proxyLists.length === 0 ? t("empty_lists_hint") : t("empty_this_list")}
                      </td>
                    </tr>
                  ) : (
                    activeProxyList.proxies.map((p) => {
                      const k = pKey(p);
                      const val = tcpPings[k] ?? (p.timeout != null ? Math.round(p.timeout) : null);
                      return (
                        <tr key={k}>
                          <td>
                            <div className="row" style={{ gap: 7, flexWrap: "nowrap" }}>
                              <FlagBadge code={p.country_code} />
                              <span>{p.country_name || p.country_code || t("unknown")}</span>
                            </div>
                          </td>
                          <td className="mono">
                            {p.host}:{p.port}
                          </td>
                          <td>
                            <span className={`pill ${p.protocol === "socks5" ? "blue" : ""}`}>
                              {p.protocol.toUpperCase()}
                            </span>
                          </td>
                          <td className="mono">
                            {val === "timeout" ? (
                              <span className="pill red">{t("failed")}</span>
                            ) : typeof val === "number" ? (
                              <span className={`pill ${val < 300 ? "green" : val <= 1000 ? "amber" : "red"}`}>
                                {val} ms
                              </span>
                            ) : (
                              "--"
                            )}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                              <button
                                className="btn sm"
                                disabled={pingingTcp.includes(k)}
                                onClick={() => pingScraperHttp(p)}
                              >
                                {pingingTcp.includes(k) ? "..." : "Ping"}
                              </button>
                              <button
                                className="btn sm success"
                                onClick={() => startWithProxies([p], `${p.host}:${p.port}`)}
                              >
                                {t("use")}
                              </button>
                              <button
                                className="btn sm"
                                onClick={() => updateActiveListProxies((prev) => prev.filter((x) => pKey(x) !== k))}
                                title="Remover da lista"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {createListOpen && (
        <div className="modal-bg" onClick={() => setCreateListOpen(false)}>
          <div className="modal" style={{ width: "min(420px, 92vw)" }} onClick={(e) => e.stopPropagation()}>
            <b>{t("create_list_title", { n: selected.length })}</b>
            <input
              className="input"
              autoFocus
              placeholder={t("list_name_ph")}
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const name = newListName.trim() || `Lista ${proxyLists.length + 1}`;
                  const items = proxies.filter((p) => selectedSet.has(pKey(p)));
                  const id = `${Date.now()}`;
                  setProxyLists((prev) => [...prev, { id, name, proxies: items }]);
                  setActiveListId(id);
                  setCreateListOpen(false);
                  setTab("lists");
                }
              }}
            />
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setCreateListOpen(false)}>
                {t("cancel")}
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  const name = newListName.trim() || `Lista ${proxyLists.length + 1}`;
                  const items = proxies.filter((p) => selectedSet.has(pKey(p)));
                  const id = `${Date.now()}`;
                  setProxyLists((prev) => [...prev, { id, name, proxies: items }]);
                  setActiveListId(id);
                  setCreateListOpen(false);
                  setTab("lists");
                }}
              >
                {t("create_list_btn")}
              </button>
            </div>
          </div>
        </div>
      )}

      {cfgOpen && (
        <div className="modal-bg" onClick={() => setCfgOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <b>config.toml — proxy-scraper-checker</b>
            <textarea value={cfgText} onChange={(e) => setCfgText(e.target.value)} />
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setCfgOpen(false)}>
                Cancelar
              </button>
              <button
                className="btn primary"
                onClick={async () => {
                  await invoke("scraper_save_config", { content: cfgText });
                  setCfgOpen(false);
                  notify("config.toml salvo!");
                }}
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
