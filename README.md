# 🗑️ Junk Proxy

Aplicativo desktop leve para **coletar, testar, organizar e aplicar proxies** em um só lugar no Windows, construído com **Tauri v2 + React + TypeScript** e núcleo **Mihomo**.

---

## ✨ Funcionalidades

- **Início (Painel)**:
  - Conexão rápida com **Proxy do Sistema** (Windows) ou **Modo TUN** *(captura todos os apps/jogos ao executar como Administrador)*.
  - **Gráfico de Estatísticas de Tráfego** em tempo real (`60 FPS`, curvas suaves para Envio e Recebimento, totais da sessão).
  - **Informações de IP** completas (`IP` ocultável, País com bandeira, `ASN`, `ISP`, `ORG`, `Localização`, `Fuso horário`, coordenadas e atualização automática).
- **Buscador de Proxies**:
  - Coleta e validação integrada usando `proxy-scraper-checker` com múltiplas listas públicas.
  - Filtros por protocolo (`HTTP + SOCKS5`, `HTTP`, `SOCKS5`, `SOCKS4`), país, latência máxima, busca por IP/porta e filtro **Anti-Transparente**.
  - **Fila do Fallback** lateral redimensionável com reordenação por **arrastar e soltar (Drag & Drop)** para definir a ordem de prioridade (`#1`, `#2`, `#3`...).
  - Opções de **Bypass LAN**, **Kill-Switch**, editor de `config.toml` embutido e atualização automática da lista durante a coleta.
- **Proxies & Testes**:
  - Visualização dos nós ativos no Mihomo, **Ping paralelo** em múltiplos nós e troca rápida com 1 clique.
- **Teste de Desbloqueio**:
  - Verificação de acesso em serviços como **Apple**, **ChatGPT Web**, **Claude**, **Disney+**, **Gemini**, **GitHub**, **Muse AI**, **Netflix**, **Prime Video**, **Spotify**, **TikTok** e **YouTube Premium**.

---

## 🙏 Projetos que deram origem ao Junk Proxy

Este projeto foi criado a partir da combinação e inspiração dos seguintes projetos open-source:

- **[clash-verge-rev/clash-verge-rev](https://github.com/clash-verge-rev/clash-verge-rev)** — base de interface, conceito de painel/tráfego/IP e testes de desbloqueio.
- **[monosans/proxy-scraper-checker](https://github.com/monosans/proxy-scraper-checker)** — motor em Rust embutido para coleta e checagem assíncrona de proxies.
- **[bluet/proxybroker2](https://github.com/bluet/proxybroker2)** — referência de fontes públicas adicionais usadas na busca de proxies.
- **[MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo)** — núcleo responsável pelo roteamento, grupos `Fallback`/`url-test`, Proxy do Sistema e Modo TUN.

---

## 🛠️ Como rodar e compilar

**Pré-requisitos:** Node.js, Rust (`cargo`) e WebView2 (nativo no Windows 10/11).

```bash
# Instalar dependências
npm install

# Rodar em modo desenvolvimento
npm run tauri dev

# Gerar instalador Windows (NSIS)
npm run tauri build
```
