# Arquitetura da loja e limites da etapa 1

A loja apresenta os produtos e a compra. O NestJS mantém a identidade dos compradores e integra a experiência com o MuiraSoft. O MuiraSoft concentra a operação comercial, pagamentos, e-mails e documentos fiscais.

**O layout atual da loja é uma regra obrigatória.** Cadastro, login, área do cliente e checkout seguirão as cores, tipografia, espaçamentos, componentes, animações e comportamento responsivo estabelecidos. A etapa 1 não altera o frontend. Revisão visual em desktop e celular integra o aceite das próximas etapas.

## Responsabilidade dos dados

| Informação | Referência |
| --- | --- |
| Conta, senha, sessões e endereços salvos do comprador | Banco próprio da API NestJS |
| Cadastro comercial do comprador | MuiraSoft, vinculado à identidade da loja por referência estável |
| Publicação, produtos, preços, estoque e reservas | MuiraSoft |
| Pedido e snapshots dos dados usados na compra | MuiraSoft |
| Referência do checkout e resultado das tentativas de integração | API NestJS |
| Cobranças, conciliação, estornos e vínculo com Asaas | MuiraSoft |
| Configuração do servidor e processamento de e-mails | MuiraSoft |
| Emissão e envio de PDF/XML de nota autorizada | MuiraSoft |

O navegador acessa a API NestJS. O NestJS chama a integração HTTP do MuiraSoft com uma credencial de servidor. As chaves Asaas e SMTP pertencem à configuração do lojista no MuiraSoft e não são configurações desta API.

## Fronteiras dos módulos

| Fronteira | Responsabilidade |
| --- | --- |
| `config` | Ler e validar ambiente, origens CORS, banco e vínculo da integração; rejeitar configuração inválida sem imprimir segredos |
| `common/http` | Prefixo `/api/v1`, identificador de requisição, tratamento uniforme de erros e proteções HTTP |
| `database` | Banco MySQL próprio, conexão e migrações explícitas; `synchronize: false` e `migrationsRun: false` |
| `integrations/muirasoft` | Contratos tipados e transporte privado para contexto, catálogo e pedidos existentes |
| `health` | Liveness do processo e readiness das dependências, com resultado público resumido |

As etapas futuras acrescentarão autenticação, compradores, endereços, catálogo público e checkout. Métodos do adaptador MuiraSoft não expõem automaticamente endpoints na loja.

## Configuração e inicialização

O desenvolvimento pode iniciar com `DATABASE_ENABLED=false` explícito. Nesse modo a sonda de liveness responde, mas readiness retorna 503; o processo iniciado não representa uma loja pronta para vendas. Produção exige banco habilitado e vínculo completo com a integração.

Migrações são executadas por comando explícito, nunca automaticamente ao subir o servidor. O banco da loja é independente do banco operacional do MuiraSoft. O schema inicial estabelece as referências de integração; não entrega cadastro, checkout ou pagamento completos.

As origens CORS são explícitas. O token da integração fica no servidor. URLs e credenciais não podem ser escolhidas livremente pelo navegador. Logs e observabilidade não devem registrar senha, token de sessão, credencial da integração, chave Asaas, SMTP, número de cartão ou CVV.

`STORE_ID` identifica a loja e `STORE_URL` define sua URL pública; não são credenciais de autorização. `CORS_ORIGINS` lista as origens permitidas. A integração é configurada por `MUIRASOFT_BASE_URL`, `MUIRASOFT_TOKEN`, `MUIRASOFT_COMPANY_ID`, `MUIRASOFT_CHANNEL` e `MUIRASOFT_TIMEOUT_MS`. O banco utiliza `DATABASE_ENABLED` e `DATABASE_URL` de um schema exclusivo da loja. A configuração de exemplo do projeto descreve os valores de desenvolvimento.

O NestJS Observe é opt-in por `OBSERVE_ENABLED`, com chaves válidas quando habilitado. A etapa não depende de telemetria externa para iniciar localmente. A produção deve observar os cuidados de dados sensíveis e contexto previstos no guia do repositório.

## Sondas e erros

O [contrato público](../contracts/storefront.openapi.json) contém somente:

- `GET /api/v1/health/live`: 200 com `{"status":"ok"}`; não consulta dependências.
- `GET /api/v1/health/ready`: 200 com `status=ready` e ambas as dependências `up`, ou 503 com `status=not_ready`.

No readiness, `database` pode ser `up`, `down` ou `disabled`; `muirasoft` pode ser `up`, `down` ou `not_configured`. Empresa, canal, escopos, credenciais e o erro remoto não são devolvidos por essas sondas.

Cada requisição recebe um UUID gerado pelo servidor em `X-Request-Id`. Os erros HTTP globais usam `code`, `message` e `request_id`. O 503 de readiness usa seu próprio resultado de sonda documentado.

Probes concorrentes compartilham a mesma verificação pendente e seu resultado por cinco segundos após a conclusão, para limitar chamadas externas. As consultas de saúde do banco têm deadline de dois segundos por consulta, incluindo aquisição da conexão. Este agrupamento não é utilizado para autorizar operações comerciais.

## Identidade e repetição de operações

O futuro comprador e o checkout usam UUIDs gerados pelo servidor. O UUID do comprador será a referência externa de cliente no MuiraSoft; o checkout terá uma referência de pedido estável. Uma nova tentativa conserva a referência e a chave de idempotência da mesma operação.

Não vincular histórico de compras a uma conta apenas por coincidência de e-mail. A futura API deve obter o comprador da sessão e conferir o vínculo do pedido antes de apresentar qualquer dado.

O adaptador não repete escritas automaticamente. Um timeout após criar pedido não comprova falha da criação: a retomada precisa consultar a referência externa e reutilizar a mesma chave e conteúdo. O contrato existente preserva o resultado original de uma repetição; consultar por GET fornece o estado atualizado.

## Aceite da fundação

- Build, lint, testes de configuração e testes HTTP aprovados.
- Contrato público corresponde às sondas implementadas.
- Snapshot do contrato MuiraSoft tem proveniência e checksum verificáveis.
- Transporte é exercitado contra um servidor HTTP local controlado, incluindo falhas, sem chamar serviços financeiros ou enviar mensagens reais.
- Contexto de empresa/canal divergente é recusado antes das operações comerciais.
- Produção não inicia com banco ou vínculo incompletos.
- Frontend preservado integralmente.

Os resultados concretos de execução são registrados na entrega da etapa; os itens acima são critérios, não um relatório de testes já executados.
