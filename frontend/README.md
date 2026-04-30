# Snakeys — Frontend

Frontend do Snakeys (ecossistema **Prime Assets**).
Stack: **Vite + React 18 + TypeScript + Tailwind CSS**.

## Como rodar

```bash
# 1. Copie o arquivo de ambiente
cp .env.example .env

# 2. Instale dependências
npm install

# 3. Suba o dev server (porta 5173)
npm run dev
```

Garanta que o backend NestJS esteja rodando em `http://localhost:3001/api`
(ou ajuste `VITE_API_URL` em `.env`).

## Estrutura

```
frontend/
├── public/
│   └── snake.svg              # favicon
├── src/
│   ├── lib/
│   │   ├── api.ts             # cliente HTTP (auth, wallet, users)
│   │   └── cpf.ts             # máscara + validação CPF (algoritmo oficial)
│   ├── pages/
│   │   ├── Login.tsx          # Tela 01 — Login / Criar conta
│   │   └── Lobby.tsx          # Tela 02 — Home / Lobby / Jogar
│   ├── index.css              # Tailwind + utilities (clip-paths, animações)
│   ├── main.tsx               # Entry + React Router
│   └── vite-env.d.ts
├── index.html                 # entry Vite
├── dev-client.html            # cliente de teste antigo (Socket.IO + Auth + Wallet)
├── tailwind.config.js
├── postcss.config.js
├── tsconfig.json
├── tsconfig.node.json
└── vite.config.ts
```

## Página Login (`/login`, `/register`)

`src/pages/Login.tsx` — tela `01. Login / Criar conta`.

Layout em 3 colunas no desktop (≥1024px), stacked no mobile:

| Coluna | Conteúdo |
|--------|----------|
| Esquerda | Placeholder de **clipes de gameplay** com grid animado, blobs de cor e mock de thumbs |
| Centro | Branding **SNAKEYS** com glow, posicionado no triângulo deixado pelo corte diagonal |
| Direita | Painel de **autenticação** (Bem-Vindo!) — toggle Criar conta / Login, formulário, selo **+18** no rodapé |

Campos do formulário de registro: **Usuário · E-mail · CPF · Senha**. CPF é
exibido com máscara `000.000.000-00` (ver `src/lib/cpf.ts`) e validado com o
algoritmo oficial antes do envio.

## Página Lobby (`/lobby`)

`src/pages/Lobby.tsx` — tela `02. Home / Lobby (Aba Jogar)`.

- **Topo** — logo SNAKEYS · abas `Jogar · Loja · Social · Inventário` · saldo
  da wallet · avatar com username · botão logout.
- **Sidebar** — seção **Modo** (Online / Offline bots) e seção **Valor do
  Pote** com os tiers `R$ 2,00` até `R$ 100,00`.
- **Centro** — 3 cards interativos: **Hunt-Hunt**, **Big Fish**, **Partida
  Privada**. Cada card mostra descrição, n° de jogadores e o pote selecionado.
  Clicar dispara o placeholder de matchmaking (pronto para ligar ao
  `game-server` via Socket.IO).

Ao montar, busca `GET /api/wallet` com o JWT; se o token for inválido, força
redirect para `/login`.

## Integração com o backend

A página Login dispara para:

- `POST /api/auth/register` — `{ email, password, cpf }`
- `POST /api/auth/login` — `{ email, password }`

A página Lobby consome:

- `GET /api/wallet` — saldo no header
- `POST /api/auth/logout` — ao clicar em sair

> **Nota — campo `username`:** permanece UI-only (armazenado em
> `localStorage['snakeys_username']`). O `RegisterDto` usa
> `forbidNonWhitelisted: true`, então estender o backend + enviar o campo em
> `src/lib/api.ts` é um passo futuro.

Validação client-side de senha replica `IsStrongPassword` do backend
(`min 8`, 1 maiúscula, 1 minúscula, 1 número). CPF replica o algoritmo do
validator `@IsCPF` do backend.

O JWT recebido é guardado em `localStorage['snakeys_token']`.

## Variáveis de ambiente

| Variável | Default | Descrição |
|----------|---------|-----------|
| `VITE_API_URL` | `http://localhost:3001/api` | Base do backend NestJS |
| `VITE_GAME_SERVER_URL` | `http://localhost:3002` | Game-server (Socket.IO) — uso futuro |

## Próximos passos

- [x] Rota `/lobby` (matchmaking screen) com redirect após login bem sucedido
- [ ] Integrar cards de modo com `game-server` via Socket.IO (`join_queue`)
- [ ] Páginas `/shop`, `/social`, `/inventory` (hoje mostram "Em breve")
- [ ] Fluxo de verificação de e-mail (`/auth/verify-email`)
- [ ] Estender `RegisterDto` no backend para aceitar `username`
- [ ] Substituir `GameplayClipsBackground` por player real de clipes
- [ ] Hook `useAuth` para compartilhar estado de sessão entre páginas
