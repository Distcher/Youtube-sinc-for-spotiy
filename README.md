# YT → Spotify Sync

Aplicativo de desktop (Electron) que sincroniza automaticamente as músicas que você ouve no YouTube com uma playlist do Spotify. Um botão flutuante injetado na página do YouTube (via extensão de navegador) avisa o app sempre que uma nova faixa começa a tocar, e o app adiciona essa faixa à playlist escolhida.

## ✨ Funcionalidades

- **Login com Spotify via OAuth (PKCE)** — sem precisar expor client secret.
- **Sincronização automática** de faixas detectadas no YouTube para uma playlist do Spotify.
- **Ponte local (bridge) com a extensão de navegador**: um servidor HTTP em `127.0.0.1` recebe eventos da extensão instalada no navegador, protegido por um token de pareamento.
- **Simulador de reprodução** embutido na interface, útil para testar o fluxo sem precisar da extensão.
- **Opções de configuração**: pular duplicadas, considerar apenas vídeos da categoria música, etc.
- **Resumo de sessão** com exportação (JSON/CSV) das faixas não encontradas no Spotify.
- Tema claro/escuro automático.

## 🧱 Estrutura do projeto

```
.
├── main.js         # Processo principal do Electron (OAuth, chamadas à API do Spotify, servidor bridge)
├── preload.js      # Ponte segura (contextBridge) entre o processo principal e a interface
├── package.json    # Metadados e scripts do projeto
└── app/
    └── index.html  # Interface do usuário (single-file: HTML + CSS + JS)
```

> **Atenção:** o `main.js` carrega a interface a partir de `app/index.html`. Ao organizar os arquivos no repositório, garanta que o `index.html` fique dentro de uma pasta `app/` na raiz do projeto (irmã do `main.js`).

## ✅ Pré-requisitos

- [Node.js](https://nodejs.org/) 18 ou superior (recomendado LTS)
- [npm](https://www.npmjs.com/) (instalado junto com o Node.js)
- Uma conta no [Spotify for Developers](https://developer.spotify.com/dashboard) para criar um app e obter o **Client ID**

## 🚀 Passo a passo para instalar e rodar

### 1. Clone o repositório

```bash
git clone https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git
cd SEU-REPOSITORIO
```

### 2. Organize os arquivos (se necessário)

Certifique-se de que a estrutura fique assim:

```
main.js
preload.js
package.json
app/
  └── index.html
```

Se o `index.html` estiver na raiz, mova-o para dentro de uma pasta `app/`.

### 3. Instale as dependências

```bash
npm install
```

### 4. Crie um app no Spotify Developer Dashboard

1. Acesse [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) e faça login.
2. Clique em **Create app**.
3. Preencha nome e descrição à vontade.
4. Em **Redirect URIs**, adicione exatamente:
   ```
   http://127.0.0.1:8888/callback
   ```
5. Salve e copie o **Client ID** gerado (você vai colar esse valor dentro do app).

### 5. Rode o aplicativo

```bash
npm start
```

Isso abre a janela do Electron com a interface do YT → Spotify Sync.

### 6. Conecte sua conta do Spotify

1. Cole o **Client ID** obtido no passo 4 no campo indicado na interface.
2. Clique em **Conectar** — uma janela de login do Spotify vai abrir.
3. Após autorizar, a janela fecha automaticamente e o app mostra "Conectado".
4. Escolha a playlist de destino no seletor.

### 7. (Opcional) Pareie com a extensão de navegador

O app expõe um pequeno servidor local (`http://127.0.0.1:8891`) para receber eventos de uma extensão de navegador instalada em `youtube.com`. Na interface:

1. Copie a **porta** e o **token de pareamento** exibidos.
2. Configure esses dois valores na extensão do navegador (repositório/instalação separada).
3. Sempre que quiser invalidar o pareamento atual, use o botão de regenerar token.

> Sem a extensão, você ainda pode testar todo o fluxo usando o **simulador de reprodução** dentro do próprio app.

### 8. Ative a sincronização

Clique no botão flutuante (círculo) no canto da tela para ligar a sincronização. Com ela ativa, toda faixa detectada (pela extensão ou pelo simulador) será adicionada à playlist escolhida.

## 📦 Gerando um instalador (build)

Para empacotar o app como executável (Windows/Mac/Linux) usando `electron-builder`:

```bash
npm run dist
```

Os instaladores gerados ficam na pasta `dist/`.

## 🔒 Notas de segurança

- O `client secret` do Spotify **nunca** é usado — a autenticação usa o fluxo **Authorization Code com PKCE**, seguro para apps desktop.
- O servidor bridge só escuta em `127.0.0.1` (não acessível fora da máquina) e exige um token de pareamento em cada requisição.
- Tokens do Spotify e o token de pareamento ficam armazenados localmente (na pasta de dados do usuário do Electron).

## 🛠️ Tecnologias usadas

- [Electron](https://www.electronjs.org/)
- HTML/CSS/JS puro na interface (sem framework)
- [Spotify Web API](https://developer.spotify.com/documentation/web-api)

## 📄 Licença

Este projeto está licenciado sob a licença MIT — veja o campo `license` no `package.json`.
