# Continuação em nuvem — MuiraSoft e Cabeça do Cachorro

Preparado em 29/10/2026. Usar a branch `codex/continuacao-nuvem` nos quatro repositórios.

| Projeto | Repositório |
| --- | --- |
| MuiraSoft backend PHP | https://github.com/MuiraSoft/muira-soft-back |
| MuiraSoft frontend Vue | https://github.com/MuiraSoft/muira-soft-front |
| API NestJS da loja | https://github.com/superTheus/cabecadocachorro-api |
| Loja Vue existente | https://github.com/juliMarquesSouza/cabecadocachorro |

## Objetivo e decisões

Continuar a implementação da loja online Cabeça do Cachorro integrada ao MuiraSoft. O plano completo de 16 etapas está em `docs/plano-implementacao.md` no repositório da API NestJS. Preservar obrigatoriamente o layout da loja: identidade, tipografia, cores, espaçamentos, componentes, animações e responsividade. As telas novas devem seguir o padrão existente; no MuiraSoft reutilizar Container, PrimeVue e temas por conta.

Produtos de pronta entrega e encomenda, encomendas pagas integralmente no checkout, entrega local e retirada. Conta do comprador com cadastro, autenticação, endereços, histórico e acompanhamento. Pix e cartão dentro da loja; módulo Asaas por lojista no MuiraSoft, separado da cobrança de assinatura do próprio sistema. MuiraSoft gerencia operação, pagamentos, comunicação e fiscal. Cada lojista tem seu SMTP ou usa o padrão da plataforma. Notas autorizadas devem chegar ao comprador com PDF/XML e acesso protegido na área do cliente.

## Entregas concluídas

1. Fundação NestJS: módulos, configuração validada, MySQL próprio, migrações explícitas, adaptador privado MuiraSoft e contratos versionados. Não implementa ainda catálogo público, login do comprador ou checkout. Ler README, docs/arquitetura.md e docs/integracao-muirasoft.md na API. Banco da loja separado do banco do MuiraSoft; synchronize desabilitado.
2. E-mails por lojista no MuiraSoft: Configurações → E-mails, acesso de administrador, SMTP personalizado/padrão, senha cifrada AES-256-GCM com chave dedicada, controle de versão e teste para o próprio administrador, com limite de tentativas. Falha no personalizado é explícita, sem reenviar pelo padrão. Transporte personalizado valida destino público e TLS. Envio manual fiscal de Venda usa conta e mantém PDF/XML. Ler docs/email-configuracao.md no backend.

Atualização em 30/10/2026: a etapa 3 já possui fila cifrada, worker com reservas, histórico, consulta administrativa e notificações de criação e todas as mudanças de status de pedidos da loja. Consulte `docs/email-fila.md` no backend MuiraSoft. A migração 038 e a ativação foram realizadas somente no ambiente local, sem agendamento do worker e sem SMTP padrão real. Permanecem para os fluxos posteriores mensagens de conta, pagamento real e PDF/XML fiscal. Escopo geral da etapa 3: modelos autorizados, processamento recuperável, histórico, retentativas e deduplicação para mensagens de conta/pedido/pagamento/status/fiscal. Não presumir endpoints de comunicação já existentes; definir contratos de forma compatível com a integração atual. Falha no e-mail não pode bloquear pedido ou pagamento. Nesta transferência, preparar e validar os repositórios antes de iniciar novas funcionalidades.

## Estado e validações locais

A etapa 2 passou por 82 verificações de configuração/SMTP/chave, 12 HTTP com autenticação real, 6 asserções Postman, 55 regressões de autenticação/perfil/convites/fiscal; frontend passou build/TypeScript e 42 testes, mais revisão visual 1440/360 claro/escuro. SMTP de testes usa somente fixture STARTTLS local; nenhum e-mail externo foi enviado. A API NestJS passou 64 testes unitários e 6 de contratos novamente na preparação da transferência. Outros testes da API estão descritos na CI e no README.

As atualizações de origin/master existentes no MuiraSoft (proteção de arquivos privados, baseline SQL e remoção do Electron) foram incorporadas nas branches de continuação sem conflito. Verificar novamente os checks após essa integração.

## Preparação da nuvem

O ambiente Codex deve ter acesso aos quatro repositórios acima, todos na branch indicada. Usar diretórios separados, mantendo os remotes. Não copiar código para um repositório diferente nem usar submódulos para contornar permissões.

API NestJS: Node 24, npm ci, npm run build, npm run type-check, npm run lint, npm test, npm run test:contracts, npm run test:e2e. A CI fornece exemplo com MySQL 8.4, teste de banco e Postman CLI. Usar .env.example como referência; observabilidade e banco desabilitados até configurar ambiente próprio. Os scripts de integração verificam ambiente e não devem receber credenciais de produção para testar.

MuiraSoft backend: PHP com PDO MySQL, cURL, OpenSSL e mbstring; composer install. O baseline SQL e as instruções de bootstrap estão em docs/migrations-financeiro.md; a migration 037 de e-mails é posterior ao baseline e precisa ser aplicada uma vez e registrada. O comando de registro não executa SQL. Consultar status antes de aplicar. Para credenciais SMTP próprias, preparar MAIL_CONFIG_ENCRYPTION_KEY com bin/configurar-chave-email.php no ambiente autorizado. Testes: php tests/run-email.php --http (MySQL isolado, Python3/OpenSSL e Postman CLI).

MuiraSoft frontend: npm ci, npm run build e node --test tests/*.test.mjs. Loja: consultar package.json, npm ci e npm run build, preservando seu visual. O único ajuste preexistente da loja nesta transferência é o nome no package-lock.json.

## Dados locais e limites da transferência

.env, chaves, tokens, certificados, uploads e bancos locais não são transferidos ao GitHub. A migration 037 já foi aplicada e registrada no banco LOCAL e a chave local existe; isso não significa que a nuvem esteja migrada ou configurada. Nenhum SMTP padrão real está configurado localmente. Criar dados de teste isolados na nuvem; não conectar produção nem enviar mensagens reais para validar a transferência.

Não efetuar merge em master/main, deploy de produção, cobranças ou envio externo automaticamente. A autorização atual cobre publicar branches e preparar a continuação no ambiente Codex existente do Muira.

## Atualização da etapa 4 — 30/10/2026

A conta do comprador foi implementada; consultar [preparação e testes](conta-comprador.md). A empresa da loja ainda não existe no MuiraSoft: os envios reais aguardam esse cadastro e a configuração da conexão/SMTP. O banco e a chave da API foram preparados somente localmente, sem criar empresa fictícia. As alterações desta etapa ainda precisam ser publicadas para outra máquina/nuvem.
