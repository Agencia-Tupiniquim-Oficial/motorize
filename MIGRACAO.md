# Migração Motorize+

Preparado em 27/10/2026, a partir do código local da versão 16 (commit 801f4cb28c17ac8f0a00f9c392af22baeaaad7f4).
O site publicado não foi alterado por esta entrega.

## O que há no pacote

- Na versão de repositório, a raiz contém o site completo e o painel portáteis. Execute os comandos abaixo na raiz do repositório quando o texto mencionar a pasta `motorize-portavel`.
- O arquivo `motorize-codigo-original.zip` pertence ao pacote de migração entregue separadamente e não é necessário para executar este repositório.
- Este arquivo é o manual de migração; `README.md` descreve o fluxo de atualizações pelo GitHub.

Não foram incluídos senhas, tokens, sessões, arquivos locais do banco ou dados de leads. A instalação começa com um banco novo. A senha atual do painel hospedado não será copiada; uma nova será criada no destino.

## Antes de instalar

Você precisa de um servidor Linux/VPS com Docker e Docker Compose, um domínio ou subdomínio e acesso para editar o DNS. O servidor precisa ter as portas 80 e 443 disponíveis. Se já existir outro site usando essas portas, um técnico deve integrar a aplicação ao proxy já existente em vez de iniciar o proxy incluído.

Uma hospedagem que apenas permite enviar HTML/PHP para `public_html` não executa este painel. Se houver suporte a Node.js 24 ou superior e disco persistente, a instalação sem Docker também é possível; veja abaixo.

## Instalação completa com Docker

1. No DNS, crie um registro A para seu domínio/subdomínio apontando ao IP público do servidor. Se existir um registro AAAA, ele também precisa apontar para esse servidor ou ser removido caso você não use IPv6.
2. Envie a pasta `motorize-portavel` ao servidor e abra um terminal dentro dela.
3. Faça uma cópia de `.env.example` com o nome `.env` e edite o domínio. Use somente o nome, sem `https://` e sem barra no final:

```dotenv
DOMAIN=concessionarias.seudominio.com.br
MOTORIZE_ADMIN_USER=admin.motorize
```

No terminal Linux, você pode fazer a cópia com:

```sh
cp .env.example .env
```

4. Prepare a aplicação e crie o administrador:

```sh
docker compose build
docker compose run --rm web node create-admin.cjs
```

O segundo comando mostrará o usuário e uma senha aleatória. Guarde a senha: ela só será mostrada nessa criação. Executar o comando novamente com o mesmo usuário não altera a senha.

5. Inicie o site:

```sh
docker compose up -d
```

6. Acesse `https://concessionarias.seudominio.com.br` e o painel em `https://concessionarias.seudominio.com.br/admin/`. Substitua pelo seu domínio. O proxy Caddy solicita e renova o certificado HTTPS, desde que o DNS e as portas estejam corretos.
7. Faça um teste do formulário, pare após informar o telefone e confira o lead parcial no painel; depois conclua a qualificação. Confira também o chat e seu encaminhamento ao WhatsApp. Os registros de abandono usam uma janela de 30 minutos.

Para acompanhar falhas de inicialização:

```sh
docker compose logs --tail=100 web proxy
```

## Usando Node.js sem Docker

Esta versão não exige instalação de dependências npm. Instale Node.js 24 ou superior e, dentro de `motorize-portavel`, execute:

```sh
node create-admin.cjs
node server.cjs
```

O site abre em `http://127.0.0.1:4179` e o painel em `/admin/` para teste local. Para produção, configure estas variáveis no gerenciador de aplicações da sua hospedagem:

```dotenv
PUBLIC_ORIGIN=https://concessionarias.seudominio.com.br
HOST=127.0.0.1
PORT=4179
DATA_DIR=/caminho/absoluto/persistente/motorize-data
MOTORIZE_ADMIN_USER=admin.motorize
```

Defina `DATA_DIR` antes de criar o administrador e também antes de iniciar o servidor: ambos precisam usar a mesma pasta. `.env` não é carregado automaticamente no modo sem Docker; cadastre as variáveis na hospedagem ou use a opção nativa `node --env-file=seu-arquivo`.

Configure o Nginx/Caddy da hospedagem para encaminhar o domínio HTTPS para o servidor Node, preservando o cabeçalho Host. O processo precisa permanecer ativo por meio do gerenciador da hospedagem ou de um serviço. Se a plataforma exigir escuta em todas as interfaces, use `HOST=0.0.0.0`. O disco do banco precisa ser persistente e gravável pelo processo.

## Dados antigos e cópias de segurança

Os contatos e as métricas recebidos no endereço atual estão no D1 de produção do Sites. Eles NÃO estão neste arquivo. Também não existe um arquivo SQLite local que represente automaticamente esse banco de produção.

Se precisar manter esse histórico, solicite a exportação do banco de produção antes da troca definitiva. A transferência integral requer exportar leads, attempts, visits e clicks do D1 e importá-los no SQLite, preservando identificadores e relacionamentos. Essa exportação/importação não foi realizada nesta entrega. Não importe senhas ou sessões do banco antigo: use o administrador criado no novo ambiente.

Na versão Docker, os novos dados ficam no volume `motorize_data` e sobrevivem à recriação dos contêineres. Não execute `docker compose down -v`, pois isso remove os volumes. Para fazer uma cópia consistente durante uma breve pausa no atendimento:

```sh
docker compose stop web
mkdir -p backup-motorize
docker compose cp web:/app/data/. ./backup-motorize/
docker compose start web
```

Copie toda a pasta, incluindo os arquivos auxiliares SQLite, se presentes, e guarde o backup fora do servidor. No modo sem Docker, interrompa o processo e copie toda a pasta `DATA_DIR`.

## Conteúdo e manutenção

- Textos e estrutura: `motorize-portavel/dist/index.html`.
- Estilos: `motorize-portavel/dist/styles.css`.
- Chat e formulário: `motorize-portavel/dist/script.js` e `capture.js`.
- Fotos e logo: `motorize-portavel/dist/assets/`.
- Painel: `motorize-portavel/dist/admin/`.
- Servidor e API: `motorize-portavel/server.cjs`.
- O telefone/WhatsApp existente foi mantido. Pesquise por `551141687152` e `(11) 4168` nos arquivos caso queira alterar.
- As imagens principais estão incluídas. As fontes ainda são carregadas pelo Google Fonts; há fontes de fallback no CSS.

Após alterar arquivos na versão Docker, reconstrua e reinicie:

```sh
docker compose up -d --build
```

Não coloque a pasta `data` em uma pasta pública do servidor. As senhas criadas na versão portátil são armazenadas como hash com salt no banco; não existe uma senha fixa no código.

## Validação da entrega

Os testes locais verificam captura parcial e completa de lead, qualificação B2B, login, proteção do painel, domínio permitido, cookie seguro atrás de HTTPS, arquivos públicos e logout. Para repetir com Node.js 24 ou superior:

```sh
node --test server.test.cjs
```

O ambiente Docker e o certificado do domínio precisam ser validados no servidor de destino; não foram executados aqui. A versão portátil é uma adaptação para migração, distinta do servidor Workers/D1 do código original.
