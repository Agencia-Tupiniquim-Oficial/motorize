# Armazenamento permanente na SiteGround

O diretório de uma aplicação publicada pelo GitHub pode ser substituído na publicação. Por isso, o arquivo SQLite dentro dele não deve ser usado como banco de produção sem uma garantia de persistência da hospedagem. O Motorize agora suporta MySQL, separado dos arquivos publicados.

## Ativação

1. Em Site Tools > Site > MySQL, crie um banco dedicado e um usuário exclusivo. Vincule esse usuário somente ao banco do Motorize, com as permissões necessárias para criar as tabelas e ler/gravar registros. Não habilite acesso remoto público.
2. Em Node.js > Deployment Options, configure as variáveis abaixo somente na hospedagem:

   - `DB_DRIVER=mysql`
   - `MYSQL_HOST=localhost` (host local informado pela SiteGround)
   - `MYSQL_PORT=3306`
   - `MYSQL_DATABASE`: nome gerado pela SiteGround
   - `MYSQL_USER`: usuário gerado pela SiteGround
   - `MYSQL_PASSWORD`: senha desse usuário, diferente da senha do painel
3. Preserve `MOTORIZE_OWNER_USER`, `MOTORIZE_OWNER_EMAIL` e o segredo inicial `MOTORIZE_OWNER_PASSWORD`. A inicialização cria o dono somente quando ainda não existe um. Não redefine sua senha em cada publicação.
4. Publique a versão que inclui `mysql-db.cjs` e a dependência `mysql2`, instalando com `npm ci --ignore-scripts`. Reinicie/publice pela SiteGround para aplicar as variáveis. Não altere a configuração atual antes de a versão com MySQL estar disponível.
5. Valide o login, o registro de uma visita e a leitura dos dados após uma nova publicação. A prova de persistência é o mesmo registro continuar disponível após o reinício.

As tabelas são criadas automaticamente sem remover tabelas ou registros. Usuários do painel, leads, sessões, tentativas, visitas e cliques têm tabelas separadas. A aplicação usa consultas parametrizadas, conexões limitadas e transações. Se a configuração MySQL estiver incompleta ou a conexão falhar na inicialização, o processo não começa com um SQLite vazio como alternativa.

Conexões remotas ao MySQL exigem TLS com certificado válido. A conexão local documentada pela SiteGround não exige abertura de acesso remoto.

## Dados antigos e backups

A ativação do MySQL não recupera registros perdidos em publicações anteriores. Antes de trocar, procure o arquivo `motorize.sqlite` e seus arquivos `-wal`/`-shm` no diretório usado pelo processo, nas versões anteriores ou em backups da hospedagem. Não apague ou sobrescreva os originais. Uma eventual importação precisa de uma cópia consistente e de validação de contas e contagens antes da ativação.

Nenhuma senha ou cópia de banco deve ser enviada ao GitHub. `.env.example` contém apenas exemplos vazios. As credenciais do MySQL são diferentes das credenciais do painel. Os utilitários antigos de criação/redefinição em SQLite recusam execução quando `DB_DRIVER=mysql`, evitando alterar o banco errado.

No GitHub Actions, a integração usa um MySQL 8.4 descartável e verifica usuários, perfis, recuperação concorrente, leads parciais e completos, origens, cliques, rolagem e persistência após reiniciar a aplicação. A credencial de teste no workflow pertence apenas a esse serviço temporário.
