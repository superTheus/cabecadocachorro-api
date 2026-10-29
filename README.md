# API da loja Cabeça do Cachorro

Fundação NestJS para conectar a loja Vue ao MuiraSoft. A etapa 1 prepara configuração, banco próprio, vínculo com a integração, transporte HTTP seguro e contratos. O frontend e o MuiraSoft não são alterados nesta etapa.

**Preservar o layout atual da loja é obrigatório em todas as entregas.** As futuras telas de cadastro, conta, pedidos e pagamento devem seguir o padrão visual estabelecido, com verificação em desktop e celular.

## Iniciar localmente

Requisitos: Node.js 24 e npm. MySQL/MariaDB em schema exclusivo da loja para habilitar persistência; Postman CLI para o teste de integração HTTP.

```bash
npm ci
# Somente se ainda não existir um .env:
cp -n .env.example .env
npm run start:dev
```

O exemplo inicia com banco e integração desabilitados e não exige credenciais de produção. O .env existente é preservado. Observe fica desabilitado por padrão; ative explicitamente somente com chaves válidas.

| Endpoint | Resultado |
| --- | --- |
| `GET /api/v1/health/live` | 200: processo HTTP está respondendo |
| `GET /api/v1/health/ready` | 200 apenas com schema, vínculo persistido e contexto remoto válidos; 503 em caso contrário |

Readiness reúne verificações em uma janela de cinco segundos por processo para limitar consumo da cota MuiraSoft. Isso não é cache de autorização comercial. As sondas não expõem empresa, canal, credencial nem resposta do provedor.

Não há endpoints públicos de compradores, produtos, checkout ou pedidos nesta etapa. Os métodos comerciais do adaptador são internos; uma credencial da conexão possui acesso a pedidos de vários compradores e nunca deve ser entregue ao navegador.

## Configurar banco e integração

1. Crie um banco exclusivo e um usuário com acesso somente ao banco da loja. Não use o banco operacional do MuiraSoft.
2. Configure `DATABASE_ENABLED=true` e `DATABASE_URL` no .env. Use URL `mysql://usuario:senha-codificada@host:3306/banco`; caracteres especiais da senha devem ser codificados para URL.
3. No MuiraSoft, cadastre uma conexão para a empresa e o canal da loja, com os escopos necessários.
4. Preencha juntos `MUIRASOFT_BASE_URL`, `MUIRASOFT_TOKEN`, `MUIRASOFT_COMPANY_ID` e `MUIRASOFT_CHANNEL`.
5. Execute os comandos explícitos abaixo e consulte readiness.

`MUIRASOFT_BASE_URL` é a base da instalação, por exemplo `https://erp.example/back`, **sem** `/integracao/v1`. HTTPS é obrigatório; HTTP somente em loopback para desenvolvimento e quando permitido explicitamente pelo próprio MuiraSoft. O token não pode entrar em variáveis `VITE_`.

```bash
npm run db:migrate
npm run db:status
npm run integration:check
npm run store:bind
```

As migrations criam `store_bindings` e `integration_operations`. Inicialização não executa migrations, sincronização ou seed. `store:bind` confirma a credencial remotamente antes de registrar a loja e recusa substituir um vínculo divergente. A credencial permanece no ambiente, não na tabela de vínculos. `db:revert` existe para reversão explícita; faça backup antes de qualquer migração em ambiente com dados, pois DDL MySQL não é desfeito por rollback de transação.

Produção exige `NODE_ENV=production`, `STORE_URL` HTTPS, `CORS_ORIGINS` explícitas, banco habilitado e os quatro campos da integração. Para MySQL remoto, exige também `DATABASE_SSL=true`, com verificação de certificado; autoridades privadas devem ser configuradas no runtime (por exemplo, `NODE_EXTRA_CA_CERTS`). Configuração ausente/inválida impede a inicialização; o processo somente anuncia prontidão quando as dependências e o vínculo também passam nas sondas.

## Estrutura

| Módulo | Responsabilidade |
| --- | --- |
| `src/config` | Validação de ambiente e configuração central |
| `src/common/http` | Identificador de requisição e erros sanitizados |
| `src/database` | Persistência TypeORM/MySQL com migrações manuais |
| `src/integrations/muirasoft` | Cliente privado, DTOs, validação e projeções do contrato existente |
| `src/health` | Liveness e readiness |
| `src/commands` | Verificação da integração e registro explícito do vínculo |

O cliente valida empresa, canal e escopo antes de cada operação. Criação e cancelamento exigem chave de idempotência; não há retry automático de escrita. Após timeout, o futuro checkout deverá reconciliar pela referência externa e conservar a chave e o conteúdo originais. O adaptador rejeita redirecionamentos, limita respostas a 1 MiB, controla timeout e não propaga mensagens remotas contendo dados sensíveis.

## Verificações

```bash
npm run build
npm run type-check
npm run lint
npm test
npm run test:e2e
npm run test:contracts
npm run test:integration
npm run test:collection
```

O teste HTTP utiliza um mock local Postman derivado do contrato MuiraSoft e executa o cliente real contra ele; não chama o ERP nem publica resultados. O CLI 1.69 instalado oferece `mock run` e o comando legado `simulate`, mas não o comando novo `simulation`; o harness local usa `mock run --no-history`.

Teste opcional de MySQL com schema efêmero (requer permissão para criar/remover schemas):

```bash
# Defina DATABASE_TEST_ADMIN_URL no ambiente de teste, sem gravar credenciais no Git.
npm run test:database
```

O harness usa exclusivamente essa variável, cria um schema aleatório, testa migrations/constraints e remove o schema ao terminar. Sem a variável, informa SKIP. Nunca lê dados da aplicação.

A integração contínua em [.github/workflows/ci.yml](.github/workflows/ci.yml) executa build, tipos, lint, testes, contratos, mock HTTP, coleção e MySQL isolado; ela não realiza deploy. A configuração do workflow foi criada nesta etapa; a execução remota depende do envio do repositório.

Validação local em 29/10/2026: build, TypeScript e lint aprovados; 64 testes unitários, 7 testes HTTP da aplicação, 6 testes de contratos, 13 cenários HTTP do cliente MuiraSoft, 10 verificações em MySQL efêmero e 15 assertions da coleção Postman aprovados. Banco, credencial e disponibilidade de uma instalação real do MuiraSoft não foram homologados por esses cenários. O frontend e o backend MuiraSoft permaneceram sem alterações desta entrega.

Coleção HTTP da API: [foundation.postman_collection.json](postman/collections/foundation.postman_collection.json). Com a API local iniciada e as dependências desabilitadas, execute `postman collection run postman/collections/foundation.postman_collection.json`.

## Contratos e próximas etapas

- [Contrato público da etapa 1](contracts/storefront.openapi.json)
- [Snapshot do contrato existente MuiraSoft](contracts/muirasoft/integracoes-v1.openapi.json) e [proveniência](contracts/muirasoft/provenance.json)
- [Arquitetura e responsabilidades](docs/arquitetura.md)
- [Integração existente e extensões futuras](docs/integracao-muirasoft.md)
- [Plano completo de implementação](docs/plano-implementacao.md)

O OpenAPI público descreve a superfície implementada; a coleção carrega verificações executáveis alinhadas a ele. O contrato MuiraSoft é uma cópia identificada por checksum, não uma especificação de operações futuras. Fotos, publicação por loja, variações, reservas, pagamentos, e-mails e acesso a documentos fiscais serão acrescentados nas etapas correspondentes.

O snapshot original contém três declarações `required: []`, inválidas em OpenAPI 3.0. A [cópia para ferramentas](contracts/muirasoft/integracoes-v1.tooling.openapi.json) remove somente essas listas vazias, sem mudar campos obrigatórios ou operações. `npm run contracts:prepare` gera essa cópia com transformação e checksum registrados na proveniência. Os testes validam o contrato público e a cópia para ferramentas com Swagger Parser e verificam a integridade do original. O lint do Postman CLI instalado solicitou autenticação; a validação OpenAPI local não depende dela.

Autenticação dos compradores e endereços pertencem ao NestJS. Produtos, operação comercial, pagamentos Asaas de cada lojista, financeiro, e-mails com servidor próprio/padrão e envio fiscal pertencem ao MuiraSoft. A política atual dos pedidos continua `SEM_MOVIMENTO`; esta fundação não habilita vendas com reserva, cobrança ou envio de mensagens.
