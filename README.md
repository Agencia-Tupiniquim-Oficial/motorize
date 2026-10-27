# Motorize+ — Marketing para concessionárias

Landing page e painel administrativo da Tupiniquim. Esta é a versão portátil para hospedagem própria, baseada em Node.js 24 e SQLite, com interface HTML/CSS/JavaScript.

## Conteúdo

- Site, fotos e identidade visual: `dist/`.
- Formulário, chat e captura parcial de leads: `dist/script.js` e `dist/capture.js`.
- Interface administrativa: `dist/admin/`.
- Servidor, autenticação, leads, funil e métricas: `server.cjs`.
- Hospedagem com HTTPS: `Dockerfile`, `compose.yaml` e `Caddyfile`.

## Desenvolvimento local

Instale Node.js 24 ou superior. Não existem dependências npm a instalar.

```sh
node create-admin.cjs
node server.cjs
```

O primeiro comando gera uma senha aleatória e a mostra uma vez. Guarde-a. Se o usuário já existir, a senha não será alterada.

Site: `http://127.0.0.1:4179/`. Painel: `http://127.0.0.1:4179/admin/`.

## Hospedagem

Em um servidor com Docker Compose e domínio apontado para o IP do servidor:

1. Copie `.env.example` para `.env` e preencha `DOMAIN` e `MOTORIZE_ADMIN_USER`.
2. Execute `docker compose build`.
3. Crie o administrador com `docker compose run --rm web node create-admin.cjs`.
4. Inicie com `docker compose up -d`.

O Caddy usa as portas 80/443 para emitir o certificado HTTPS. Essas portas precisam estar disponíveis. O banco fica no volume persistente `motorize_data`.

## Atualizações pela equipe

1. Crie uma branch, altere os arquivos e execute `node --test server.test.cjs`.
2. Envie as alterações e abra um pull request. O GitHub Actions repete os testes automaticamente.
3. Após aprovação e integração na branch principal, no servidor execute:

```sh
git pull --ff-only
docker compose up -d --build
```

O envio ao GitHub verifica o código. A atualização do site exige os comandos acima até que uma integração de publicação seja configurada para a hospedagem escolhida.

## Dados e acesso

O domínio oficial é `https://motorize.agenciatupiniquim.com.br`. O servidor aceita esse host explicitamente, mesmo que `PUBLIC_ORIGIN` ainda contenha um endereço provisório `.sg-host.com`. Hosts provisórios não são autorizados pela API. A proteção de origem continua ativa e as sessões HTTPS usam cookies Secure, HttpOnly e restritos ao host atual.

Ao mudar de domínio, atualize também as variáveis da hospedagem: `DOMAIN=motorize.agenciatupiniquim.com.br` (Docker) e/ou `PUBLIC_ORIGIN=https://motorize.agenciatupiniquim.com.br` (Node direto), sem modificar `DATA_DIR`. Reinicie a aplicação após atualizar o código. A simples cópia do HTML não reinicia o servidor Node.

O painel e a captura usam `/api/...` no mesmo domínio da página. Não configure a API com o endereço provisório. Após a publicação, uma consulta sem sessão a `/api/admin/dashboard?days=30` deve retornar 401 com pedido de login, nunca 403 de host. A resposta da versão corrigida inclui `X-Motorize-API-Version: 2026-10-27-domain-fix`.

Senhas, sessões, banco e leads não devem ser enviados ao GitHub. O `.gitignore` exclui esses arquivos. Somente `.env.example`, sem credenciais, é versionado.

Não use `docker compose down -v`, pois remove os volumes. Faça backup regular do banco conforme o manual.

O histórico de leads/métricas do site original no Sites/D1 não está neste repositório; a instalação inicia com banco novo. O endereço publicado anteriormente continua independente até a migração da hospedagem.

Veja `MIGRACAO.md` para o guia completo.
