# Contas do painel Motorize+

## Perfis

| Perfil | Consultar leads, relatórios e mapa de calor | Gerenciar contas |
| --- | --- | --- |
| Dono Administrador | Sim | Administradores, Clientes e Editores |
| Administrador | Sim | Somente Clientes e Editores |
| Cliente | Sim | Não |
| Editor | Sim | Não |

Todos podem alterar a própria senha, informando a senha atual. Existe somente um dono, que não pode ser desativado nem rebaixado pela interface. As permissões são verificadas na API, não apenas nos botões da página. Desativação e alteração de acesso encerram sessões do usuário afetado.

As contas ficam em `admins`; os registros de recuperação e auditoria ficam em `account_password_resets` e `account_audit`. Os dados comerciais continuam em `leads`, `attempts`, `visits` e `clicks`. A migração adiciona os campos de conta e preserva os administradores legados como Administrador, sem trocar suas senhas. Nenhum usuário é criado a partir dos formulários públicos.

## Configurar o dono no servidor

Usuário previsto: `Tupiniquim_Motorize`. E-mail: `ferramentas@agenciatupiniquim.com.br`.

Após atualizar a aplicação, execute na pasta da aplicação, com o mesmo `DATA_DIR` do servidor:

```sh
node configure-owner.cjs
```

Com Docker:

```sh
docker compose exec web node configure-owner.cjs
```

Digite e confirme a senha desejada no terminal. A entrada é oculta. A senha não é armazenada no código, no GitHub nem no histórico de argumentos de comandos.

Alternativamente, cadastre `MOTORIZE_OWNER_PASSWORD` como segredo no ambiente de produção e reinicie a aplicação. O usuário e o e-mail são definidos por `MOTORIZE_OWNER_USER` e `MOTORIZE_OWNER_EMAIL`, com os valores acima como padrão. O bootstrap ocorre somente quando ainda não existe dono. Não redefine a senha a cada reinicialização. Após configurar o dono, remova a senha inicial das variáveis do ambiente; a conta fica persistida como hash no banco.

**Publicar no GitHub não ativa a conta por si só.** A senha precisa ser fornecida no servidor, por um dos dois caminhos acima. Não configure a senha em GitHub Variables nem a escreva em `.env.example`.

## E-mail da SiteGround

No ambiente onde o Node está rodando, cadastre as informações SMTP exibidas pela SiteGround para a caixa remetente:

```dotenv
SMTP_HOST=hostname-smtp-informado-pela-siteground
SMTP_PORT=465
SMTP_USER=ferramentas@agenciatupiniquim.com.br
SMTP_PASSWORD=segredo-da-caixa-de-email
MAIL_FROM=ferramentas@agenciatupiniquim.com.br
```

Use os dados reais da caixa postal. A senha SMTP é a senha do e-mail ou uma senha de aplicação, não a senha do painel Motorize. Ela não foi fornecida nesta implementação e não está no repositório. O código também aceita a porta 587 com STARTTLS obrigatório. A validação do certificado TLS permanece habilitada.

Com Docker, `.env` é lido pelo Compose e os valores são encaminhados ao contêiner. Sem Docker, cadastre as variáveis no gerenciador da hospedagem; o Node não lê `.env` sozinho, a menos que seja iniciado com `--env-file`.

Depois de configurar o SMTP, recrie/reinicie a aplicação. O dono verá um aviso na tela de usuários enquanto o envio não estiver configurado. Faça um teste por **Esqueci minha senha** e confirme o recebimento na caixa postal, inclusive spam. O fato de as variáveis existirem não comprova que o provedor aceitou ou entregou a mensagem.

Se não existir SMTP configurado, a interface informa que o envio está indisponível. Para e-mails não cadastrados ou contas desativadas, a resposta é genérica para não revelar a lista de usuários. Falhas de envio são registradas no servidor sem expor a senha SMTP ou o link de recuperação.

## Recuperação

O link abre `https://motorize.agenciatupiniquim.com.br/admin/#reset=...`. O token fica no fragmento da URL, não no caminho enviado ao servidor e nem em logs de requisição. O navegador remove o fragmento da barra antes do uso. No banco é salvo somente o hash do token, com validade de 30 minutos. O link só funciona uma vez e a troca de senha encerra as sessões anteriores. Novo pedido de recuperação ou alteração de e-mail/perfil invalida links anteriores.

As credenciais e o SMTP precisam ser aplicados pelo responsável com acesso ao ambiente de produção. A integração com GitHub atualiza os arquivos, mas não fornece à aplicação os segredos de produção automaticamente.
# Banco permanente na SiteGround

Se a aplicação usa publicação automática, siga também [MYSQL-SITEGROUND.md](MYSQL-SITEGROUND.md) para manter contas, leads e métricas em MySQL. Os comandos de manutenção do SQLite deste documento não devem ser usados para alterar contas MySQL. O dono continua sendo configurado pelas variáveis da hospedagem, apenas na primeira inicialização do banco.

