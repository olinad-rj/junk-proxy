<div align="center">

# Junk Proxy

**Lightweight Windows desktop app to scrape, test, organize, and route proxies in one place.**

[Português](#português) • [English](#english) • [Download Release](https://github.com/olinad-rj/junk-proxy/releases/latest)

</div>

---

<a id="português"></a>
## 🇧🇷 Português

> **Uso Pessoal:** Este projeto foi desenvolvido com foco em **uso pessoal, estudo e conveniência no dia a dia**, reunindo coleta e gerenciamento de proxies públicos em um único aplicativo desktop.

**Junk Proxy** é um aplicativo desktop leve para Windows que reúne coleta, verificação, organização de fallback e aplicação de proxies com interface limpa em **Tauri v2 + React + TypeScript** e núcleo **Mihomo**.

### Funcionalidades
- **Início (Painel)**:
  - Conexão rápida via **Proxy do Sistema** (Windows) ou **Modo TUN** *(captura todos os apps/jogos ao executar como Administrador)*.
  - **Gráfico de Estatísticas de Tráfego** em tempo real (`60 FPS`, curvas suaves para Envio e Recebimento, totais da sessão).
  - **Informações de IP** completas (`IP` ocultável, País com bandeira, `ASN`, `ISP`, `ORG`, `Localização`, `Fuso horário`, coordenadas e atualização automática).
- **Buscador de Proxies**:
  - Coleta e validação integrada com `proxy-scraper-checker` e múltiplas listas públicas.
  - Filtros por protocolo (`HTTP + SOCKS5`, `HTTP`, `SOCKS5`, `SOCKS4`), país, latência máxima, busca por IP/porta e **Anti-Transparente**.
  - **Fila do Fallback** lateral redimensionável com reordenação por **arrastar e soltar (Drag & Drop)** (`#1`, `#2`, `#3`...).
  - Opções de **Bypass LAN**, **Kill-Switch**, editor de `config.toml` embutido e atualização ao vivo durante a coleta.
- **Proxies & Testes**:
  - Visualização dos nós ativos no Mihomo, **Ping paralelo** em múltiplos nós e troca com 1 clique.
- **Teste de Desbloqueio**:
  - Verificação de acesso em **Apple**, **ChatGPT Web**, **Claude**, **Disney+**, **Gemini**, **GitHub**, **Muse AI**, **Netflix**, **Prime Video**, **Spotify**, **TikTok** e **YouTube Premium**.

### Projetos que deram origem ao Junk Proxy
- **[clash-verge-rev/clash-verge-rev](https://github.com/clash-verge-rev/clash-verge-rev)** — base de interface, conceito de painel/tráfego/IP e testes de desbloqueio.
- **[monosans/proxy-scraper-checker](https://github.com/monosans/proxy-scraper-checker)** — motor em Rust embutido para coleta e checagem assíncrona de proxies.
- **[bluet/proxybroker2](https://github.com/bluet/proxybroker2)** — referência de fontes públicas adicionais usadas na busca de proxies.
- **[MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo)** — núcleo responsável pelo roteamento, grupos `Fallback`/`url-test`, Proxy do Sistema e Modo TUN.

### Como compilar
```bash
npm install
npm run tauri dev    # desenvolvimento
npm run tauri build  # instalador Windows (NSIS)
```

---

<a id="english"></a>
## 🇺🇸 English

> **Personal Use:** This project was built with a focus on **personal use, learning, and everyday convenience**, bringing public proxy scraping and management together in a single desktop app.

**Junk Proxy** is a lightweight Windows desktop application that combines proxy scraping, checking, fallback management, and routing in one clean **Tauri v2 + React + TypeScript** interface powered by **Mihomo**.

### Features
- **Home (Dashboard)**:
  - One-click connection via **Windows System Proxy** or **TUN Mode** *(captures all apps/games when run as Administrator)*.
  - **Real-time Traffic Statistics** (`60 FPS` smooth Bezier canvas chart for Upload & Download + session totals).
  - **Detailed IP Info** (toggleable hidden IP, country flag, `ASN`, `ISP`, `ORG`, `Location`, `Timezone`, coordinates, and auto-refresh).
- **Proxy Scraper**:
  - Built-in scraping & checking powered by `proxy-scraper-checker` across multiple public sources.
  - Filters by protocol (`HTTP + SOCKS5`, `HTTP`, `SOCKS5`, `SOCKS4`), country, max latency, IP/port search, and **Anti-Transparent**.
  - Resizable **Fallback Queue** side panel with smooth **Drag & Drop** priority reordering (`#1`, `#2`, `#3`...).
  - **Bypass LAN**, **Kill-Switch**, built-in `config.toml` editor, and live list refresh while scraping.
- **Proxies & Tests**:
  - View active Mihomo nodes, run **parallel Ping** tests across multiple nodes, and switch nodes in one click.
- **Unlock Test**:
  - Check service accessibility for **Apple**, **ChatGPT Web**, **Claude**, **Disney+**, **Gemini**, **GitHub**, **Muse AI**, **Netflix**, **Prime Video**, **Spotify**, **TikTok**, and **YouTube Premium**.

### Built From / Credits
- **[clash-verge-rev/clash-verge-rev](https://github.com/clash-verge-rev/clash-verge-rev)** — UI inspiration, dashboard/traffic/IP layout, and unlock check concepts.
- **[monosans/proxy-scraper-checker](https://github.com/monosans/proxy-scraper-checker)** — embedded Rust engine for asynchronous proxy scraping and checking.
- **[bluet/proxybroker2](https://github.com/bluet/proxybroker2)** — reference for additional public proxy sources.
- **[MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo)** — core routing engine (`Fallback`/`url-test` groups, System Proxy, and TUN mode).

### Build from Source
```bash
npm install
npm run tauri dev    # development
npm run tauri build  # Windows NSIS installer
```
