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
│   │   └── api.ts             # cliente HTTP (auth/register, auth/login, ...)
│   ├── pages/
│   │   └── Login.tsx          # Tela 01 — Login / Criar conta
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

## Página Login

`src/pages/Login.tsx` implementa a tela `01. Login / Criar conta` conforme o
rascunho `desenhoteladelogin.jpeg`.

Layout em 3 colunas no desktop (≥1024px), stacked no mobile:

| Coluna | Conteúdo |
|--------|----------|
| Esquerda | Placeholder de **clipes de gameplay** com grid animado, blobs de cor e mock de thumbs (fundo enquanto não há vídeos reais) |
| Centro | Branding **SNAKEYS** com glow + `by Prime Assets`, posicionado no triângulo deixado pelo corte diagonal |
| Direita | Painel de **autenticação** (Bem-Vindo!) — toggle Criar conta / Login, formulário, banner de erro/info, link de troca de modo, e selo **+18 Proibido para menores** no rodapé |

Linhas diagonais via `clip-path` (`.clip-diagonal-r` para o corte da coluna
esquerda, `.clip-diagonal-strip` para a linha de gradiente sobre o corte —
veja `src/index.css`).

## Integração com o backend

A página dispara para os endpoints já existentes em `backend/src/auth`:

- `POST /api/auth/register` — `{ email, password }`
- `POST /api/auth/login` — `{ email, password }`

> **Nota — campo `username`:** o `RegisterDto` atual aceita apenas `email` e
> `password` e usa `forbidNonWhitelisted: true`. O campo `Usuário` exibido na
> UI é coletado e armazenado em `localStorage` (`snakeys_username`) — quando o
> backend for estendido, basta repassá-lo no payload em `src/lib/api.ts`.

A validação client-side de senha replica a regra `IsStrongPassword` do backend
(`min 8`, ao menos 1 maiúscula, 1 minúscula e 1 número), evitando 400 de
validação antes do envio.

O JWT recebido é guardado em `localStorage` na chave `snakeys_token`.

## Variáveis de ambiente

| Variável | Default | Descrição |
|----------|---------|-----------|
| `VITE_API_URL` | `http://localhost:3001/api` | Base do backend NestJS |
| `VITE_GAME_SERVER_URL` | `http://localhost:3002` | Game-server (Socket.IO) — uso futuro |

## Próximos passos

- [ ] Rota `/play` (lobby + matchmaking) e redirecionar após login bem sucedido
- [ ] Fluxo de verificação de e-mail (`/auth/verify-email`)
- [ ] Estender `RegisterDto` no backend para aceitar `username`
- [ ] Substituir `GameplayClipsBackground` por player real de clipes
- [ ] Hook `useAuth` para compartilhar estado de sessão entre páginas
