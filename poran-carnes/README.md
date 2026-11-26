# Poran Carnes — Sistema de Roteiro e Pedidos

Sistema interno de pedidos semanais e roteiro dos caminhões.
Node.js + Express + PostgreSQL, publicado no Railway.

## Login

No primeiro acesso a um banco novo, o sistema cria o usuário `beto` com a senha padrão
(definida em `database.js`). **Troque a senha pelo menu Config logo no primeiro acesso.**

---

## Ambientes: produção e teste

O projeto tem dois ambientes no Railway, cada um com o seu próprio banco Postgres:

| | Produção | Teste |
|---|---|---|
| Ramo do GitHub | `main` | `staging` |
| Banco | banco real | banco separado, com dados de exemplo |
| `APP_ENV` | `production` | `staging` |
| Faixa no topo | nenhuma | "AMBIENTE DE TESTE" |

**Fluxo de trabalho:**
1. Toda mudança vai primeiro para o ramo `staging`.
2. O Railway publica sozinho no endereço de teste.
3. Testar lá (lançar pedidos, fechar semana, ver o dashboard).
4. Se estiver bom, abrir um PR de `staging` para `main`. Ao juntar, vai para a produção.

> Atenção: o `database.js` roda uma limpeza de pedidos antigos toda vez que o sistema
> reinicia. É mais um motivo para testar mudanças primeiro no ambiente de teste.

### Variáveis de ambiente

| Variável | Produção | Teste | Para que serve |
|---|---|---|---|
| `DATABASE_URL` | banco de produção | banco de teste | conexão com o Postgres (o Railway preenche) |
| `SESSION_SECRET` | texto longo e aleatório | outro texto, diferente | protege o login |
| `APP_ENV` | `production` | `staging` | liga a faixa de teste e o script de dados de exemplo |
| `PROD_DATABASE_HOST` | não precisa | host do banco de produção | trava: o teste se recusa a subir se o `DATABASE_URL` apontar para esse host |

### Criar o ambiente de teste no Railway (uma vez só)

1. No projeto, clique no nome do ambiente ("production") → **New Environment** → nome `staging`,
   duplicando a produção. O Postgres do novo ambiente é um banco **novo e vazio**.
2. Confira que o Postgres do `staging` é outro banco (host diferente do de produção).
3. No serviço do app, no ambiente `staging`: **Settings → Source** → ramo `staging`.
   **Root Directory** = `poran-carnes`.
4. Em **Variables** (só no `staging`): `DATABASE_URL` do Postgres do staging,
   `SESSION_SECRET` novo, `APP_ENV=staging` e `PROD_DATABASE_HOST` com o host do banco de produção.
5. **Settings → Networking → Generate Domain** para ter o link de teste.

### Dados de exemplo no teste

O banco de teste recebe sozinho a lista de clientes (`clients_seed.js`) na primeira vez que sobe.
Para criar uma semana de pedidos de exemplo, rode no serviço do ambiente `staging`:

```
npm run seed:staging
```

O script só funciona com `APP_ENV=staging`; em produção ele se recusa a rodar.

---

## Rodar localmente

Precisa de um Postgres local.

```
npm install
DATABASE_URL=postgres://usuario:senha@localhost:5432/poran APP_ENV=staging npm start
```

Abre em `http://localhost:3000`.

---

## Estrutura do projeto

```
poran-carnes/
├── server.js          → backend (rotas da API, login)
├── database.js        → banco Postgres (tabelas, migrações, dados iniciais)
├── env.js             → produção x teste, trava de segurança do banco
├── seed-staging.js    → pedidos de exemplo para o ambiente de teste
├── clients_seed.js    → lista inicial de clientes
├── railway.json       → configuração de deploy do Railway
└── public/
    ├── index.html     → aplicação principal
    ├── login.html     → tela de login
    └── env-banner.js  → faixa "AMBIENTE DE TESTE"
```
