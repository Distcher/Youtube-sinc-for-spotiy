# YT → Spotify Sync (Desktop · Electron)

App de desktop que sincroniza, em tempo real, as músicas "tocadas" no YouTube
com uma playlist do Spotify. Esta versão empacota o app original em HTML/CSS/JS
como um aplicativo Electron, com o login do Spotify acontecendo numa janela
dentro do próprio app (em vez de abrir o navegador do sistema).

## 1. Pré-requisitos

- Node.js 18 ou mais recente (necessário para o `fetch` nativo usado no
  processo principal).
- Uma conta de desenvolvedor no Spotify: https://developer.spotify.com/dashboard

## 2. Criar o app no painel do Spotify

1. Acesse o [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
   e crie um app.
2. Em **Settings → Redirect URIs**, adicione exatamente:
   ```
   http://127.0.0.1:8888/callback
   ```
3. Copie o **Client ID** gerado — você vai colar dentro do app.

> Não é necessário Client Secret: o fluxo usa OAuth 2.0 + PKCE, seguro para
> apps client-side/desktop.

## 3. Instalar e rodar em modo desenvolvimento

```bash
cd yt-spotify-sync-desktop
npm install
npm start
```

A janela do app vai abrir. Cole o Client ID, clique em "Conectar com Spotify",
faça login na janela que abrir e autorize o app.

## 4. Gerar o executável (instalador)

```bash
npm run dist
```

Isso usa o `electron-builder` para gerar o instalador na pasta `dist/`
(`.exe` no Windows, `.dmg` no macOS, `.AppImage` no Linux — conforme o sistema
em que você rodar o comando).

## 5. Como o app funciona

- **Login Spotify**: o processo principal do Electron (`main.js`) gera o
  par PKCE (verifier/challenge), abre uma `BrowserWindow` de login e
  intercepta a navegação para `http://127.0.0.1:8888/callback` para capturar
  o `code` de autorização — sem precisar subir um servidor local. A troca do
  code pelos tokens também acontece no processo principal, evitando
  problemas de CORS que aconteceriam fazendo isso direto na página.
- **Renovação de token**: feita também via IPC para o processo principal.
- **Busca/adição de faixas**: continuam acontecendo na renderer via `fetch`
  direto para `api.spotify.com`, que libera CORS normalmente.
- **Simulador do YouTube**: o app inclui um simulador manual de "música
  tocando" para testar o fluxo completo sem precisar de uma extensão de
  navegador.
- **Extensão de navegador real**: a pasta `extension/` contém uma extensão
  Chrome/Edge (Manifest V3) funcional. O app abre um pequeno servidor HTTP
  local, acessível apenas em `127.0.0.1:8891`, protegido por um token de
  pareamento gerado automaticamente (visível no card "4 · Extensão de
  navegador" do app). O content script da extensão injeta um botão
  flutuante em `youtube.com`/`music.youtube.com`; ao clicar nele, a
  extensão lê o título e o canal/artista do vídeo/faixa tocando e envia
  via `POST http://127.0.0.1:8891/event`. O processo principal do
  Electron valida o token e repassa o evento para a UI via IPC — a
  mesma função (`YouTubeMonitor.reportTrack`) que o botão
  "Simular reprodução" usa no modo demo.

### Instalando a extensão

1. Com o app desktop rodando (`npm start`), abra o card **"4 · Extensão de
   navegador (produção)"** e copie a **porta** e o **token de pareamento**.
2. No Chrome/Edge, acesse `chrome://extensions` (ou `edge://extensions`),
   ative o **Modo do desenvolvedor** e clique em **Carregar sem
   compactação**, apontando para a pasta `extension/`.
3. Clique no ícone da extensão na barra do navegador, cole a porta e o
   token copiados no passo 1 e clique em **Salvar**. Use **Testar conexão**
   para confirmar que o app está acessível.
4. Abra um vídeo/faixa em `youtube.com` ou `music.youtube.com`. Um botão
   flutuante (ícone de "play") aparece no canto da tela — clique nele para
   enviar a música atual ao app (com a sincronização ligada no botão
   flutuante do app).

> O token de pareamento pode ser regenerado a qualquer momento pelo botão
> "Gerar novo token" no app; nesse caso, atualize também o valor salvo na
> extensão.

## Estrutura do projeto

```
yt-spotify-sync-desktop/
├── main.js         # processo principal: janela do app, fluxo OAuth do Spotify
│                    #   e servidor local (bridge) para a extensão de navegador
├── preload.js       # ponte segura (contextBridge) entre main e renderer
├── package.json
├── app/
│   └── index.html  # UI completa do app (adaptada do arquivo original)
└── extension/       # extensão de navegador (Chrome/Edge, Manifest V3)
    ├── manifest.json
    ├── content.js   # botão flutuante + leitura da faixa tocando + envio ao app
    ├── content.css
    ├── popup.html   # tela de configuração (porta + token de pareamento)
    └── popup.js
```
