# Poran Carnes — Sistema de Roteiro

## Login padrão
- **Usuário:** beto
- **Senha:** poran2024

> Altere a senha pelo menu Config após o primeiro acesso.

---

## Como subir no Railway (passo a passo)

### 1. Criar repositório no GitHub

1. Acesse [github.com](https://github.com) e faça login
2. Clique em **"New repository"**
3. Nome: `poran-carnes`
4. Deixe como **Private**
5. Clique em **"Create repository"**

### 2. Subir os arquivos

Na página do repositório recém-criado, clique em **"uploading an existing file"** e arraste todos os arquivos desta pasta (exceto `node_modules` e `poran.db` se existirem).

Arquivos a enviar:
```
server.js
database.js
package.json
.gitignore
public/
  index.html
  login.html
```

Clique em **"Commit changes"**.

### 3. Criar conta no Railway

1. Acesse [railway.app](https://railway.app)
2. Clique em **"Login"** → **"Login with GitHub"**
3. Autorize o acesso

### 4. Criar projeto no Railway

1. Clique em **"New Project"**
2. Selecione **"Deploy from GitHub repo"**
3. Selecione o repositório `poran-carnes`
4. Railway vai detectar automaticamente que é Node.js

### 5. Configurar variáveis de ambiente

No painel do projeto, clique em **"Variables"** e adicione:

```
SESSION_SECRET = uma-frase-secreta-qualquer-longa
NODE_ENV = production
```

### 6. Acessar

Após o deploy (leva ~2 minutos), Railway gera um link tipo:
`https://poran-carnes-production.up.railway.app`

Esse é o link que o Beto vai acessar.

---

## Como atualizar depois

Quando precisar de alguma alteração:
1. Substitua os arquivos no GitHub (arraste os novos por cima dos antigos)
2. Railway faz o redeploy automaticamente em ~1 minuto

---

## Estrutura do projeto

```
poran-carnes/
├── server.js        → backend (rotas da API, autenticação)
├── database.js      → banco de dados SQLite (tabelas, dados iniciais)
├── package.json     → dependências Node.js
├── .gitignore       → arquivos ignorados pelo Git
└── public/
    ├── index.html   → aplicação principal
    └── login.html   → tela de login
```

## Dados salvos

Todos os dados ficam num arquivo `poran.db` (SQLite) no servidor Railway.
O Railway mantém esse arquivo persistente enquanto o plano estiver ativo.
