# Contrato de integração com o MuiraSoft

## Catálogo automático

Produtos ativos cadastrados na empresa ficam disponíveis automaticamente para a loja com consulta geral habilitada. A loja usa nome, categoria, preço e imagens do cadastro; não é necessário criar uma publicação por produto. Sem foto, usa a imagem padrão. Sem controle de estoque, não limita a disponibilidade pelo saldo. A configuração de apresentação continua opcional para personalizar textos, agrupar variações ou oferecer encomendas.

As imagens do cadastro passam pela API da loja; o token do MuiraSoft permanece no servidor. O checkout usa a mesma apresentação automática na revalidação. O catálogo pode levar até 15 segundos para refletir alterações devido ao cache de consultas.

O [snapshot OpenAPI](../contracts/muirasoft/integracoes-v1.openapi.json) é uma cópia exata do contrato de integração existente no backend MuiraSoft. A [proveniência](../contracts/muirasoft/provenance.json) registra origem, versão, data e SHA-256. O backend proprietário continua sendo a fonte de verdade.

Uma alteração do contrato proprietário exige revisar o impacto no cliente, atualizar snapshot e checksum juntos e verificar novamente as operações afetadas. O snapshot não recebe endpoints futuros inventados nesta API.

## Operações existentes

O prefixo remoto é `/integracao/v1`, relativo à instalação do backend.

`MUIRASOFT_BASE_URL` recebe a base da instalação **sem** `/integracao/v1`; o adaptador acrescenta esse prefixo. `MUIRASOFT_TOKEN`, `MUIRASOFT_COMPANY_ID` e `MUIRASOFT_CHANNEL` definem o vínculo privado. `MUIRASOFT_TIMEOUT_MS` limita consultas comuns; criação de pagamento usa 180 segundos para aguardar o processamento do gateway. O diagnóstico local `integration:check` valida contexto sem publicar os dados comerciais em uma rota HTTP.

| Método e caminho | Escopo da credencial | Uso |
| --- | --- | --- |
| `GET /conexao` | Credencial válida | Conferir empresa, canal e escopos atuais |
| `GET /produtos` | `produtos:ler` | Catálogo paginado por cursor |
| `GET /produtos/{id}` | `produtos:ler` | Produto e saldo físico |
| `POST /pedidos` | `pedidos:criar` | Criar pedido com referência externa |
| `GET /pedidos` | `pedidos:ler` | Listar pedidos da conexão, inclusive por referência externa |
| `GET /pedidos/{id}` | `pedidos:ler` | Consultar pedido e projeção de histórico |
| `GET /compradores/pedidos` | `pedidos:ler` | Histórico paginado por vínculo e referência estável do comprador |
| `GET /compradores/pedidos/{id}` | `pedidos:ler` | Projeção pública de acompanhamento, sem notas internas |
| `POST /compradores/pedidos/{id}/solicitacoes` | `pedidos:ler` + `pedidos:criar` | Solicitação manual e idempotente, sem cancelar/estornar/receber automaticamente |
| `POST /pedidos/{id}/cancelar` | `pedidos:cancelar` | Cancelar com motivo, versão e regras internas |
| `POST /pedidos/{id}/pagamentos` | `pagamentos:criar` | Intenção/cobrança Pix ou cartão em até 3 vezes; não confirma pagamento pelo HTTP 202 |
| `GET /pedidos/{id}/pagamentos` | `pagamentos:ler` | Tentativas e parcelas do pedido desta conexão |
| `GET /pedidos/{id}/pagamentos/{pagamento}/pix` | `pagamentos:ler` | PNG e copia e cola com prazo do Asaas |
| `POST /contas/emails` | `contas:email` | Solicitação idempotente de mensagem de conta |

Essas operações pertencem ao MuiraSoft. A etapa 1 não publica catálogo ou pedidos no NestJS e não permite consultar pedidos de consumidores pelo identificador informado sem futura autorização de comprador.

## Autenticação e vínculo

Usar `Authorization: Bearer <credencial opaca da integração>` somente no transporte servidor a servidor. JWT de funcionário ou administrador do MuiraSoft não substitui essa credencial.

O cliente valida se `empresa` e `canal` retornados por `/conexao` correspondem ao vínculo configurado. Divergência torna a dependência indisponível e impede operações comerciais. Os dados da conta e empresa não são aceitos como autoridade em payload enviado pelo navegador.

HTTPS é obrigatório no ambiente real. HTTP local depende de autorização explícita de desenvolvimento e das regras de loopback do próprio MuiraSoft. Rotação, revogação, pausa da conexão e remoção de permissões precisam ser respeitadas nas chamadas seguintes.

## Valores, limites e dados pessoais

- Valores monetários são strings decimais com ponto, até duas casas; quantidades aceitam até quatro casas. O frontend formata valores para exibição e não define o preço autorizado.
- Instantes da integração são ISO 8601 UTC. Datas diárias dos filtros externos são dias UTC.
- Catálogo: `limit` máximo de 100 e paginação por `cursor`.
- Pedidos: `limit` máximo de 100 e `offset` máximo de 100.000.
- Criação: corpo de até 1 MiB, de 1 a 500 itens e até 50 pagamentos planejados.
- Cotas por minuto documentadas no backend: 120 leituras/30 escritas por conexão, 1.200 leituras/300 escritas por conta e 300 chamadas por IP.
- Credenciais e payload pessoal completo não pertencem aos logs. O contrato remoto usa `Cache-Control: no-store`.

Cada comprador da loja terá uma referência externa estável na sua conexão. O MuiraSoft mantém o vínculo e o snapshot recebido no pedido; uma alteração de perfil não reescreve uma compra anterior.

## Escritas e falhas

`Idempotency-Key` é obrigatório para criação e cancelamento: de 1 a 128 caracteres entre letras, números, ponto, hífen, sublinhado e dois-pontos. A chave pertence à conexão e operação, independentemente de rotação do token.

- Mesma chave e mesmo conteúdo: resultado original, sem nova alteração.
- Mesma chave e conteúdo diferente: 409.
- Outra chave com referência de pedido já utilizada: 409; consultar o pedido existente.
- Timeout ou perda da resposta: resultado incerto; conservar referência/chave, reconciliar e não iniciar outra criação indiscriminadamente.
- Cancelamento exige `motivo` e `versao` atual. Não estorna pagamento nem cancela nota fiscal.

O adaptador não realiza retries automáticos de escrita. `Retry-After` em 429 informa quando uma nova tentativa poderá ser considerada; não autoriza trocar a chave de uma operação existente.

| HTTP remoto | Significado documentado |
| --- | --- |
| 401 | Credencial inválida, expirada, revogada ou contexto inativo |
| 402 | Acesso da assinatura bloqueado |
| 403 | Escopo insuficiente ou HTTPS obrigatório |
| 404 | Recurso ausente ou fora do contexto |
| 409 | Versão, referência, idempotência ou cancelamento em conflito |
| 413 / 422 | Corpo excessivo ou conteúdo inválido |
| 429 | Limite de chamadas |
| 503 | Indisponibilidade |

Erros remotos têm `code`, `message`, `request_id` e, quando aplicável, `fields`. O cliente mantém o status operacional necessário para tratamento interno, mas o HTTP público não deve repassar cegamente detalhes remotos.

## Limite entre disponível e planejado

| Capacidade | Contrato existente | Evolução necessária |
| --- | --- | --- |
| Catálogo e disponibilidade do ERP | Publicação por conexão, fotos públicas, descrição, categorias, SKUs/variações | Conectar à vitrine na etapa 10 |
| Pedido e histórico | Disponível, restrito à conexão | Autorização por comprador na loja e dados próprios de entrega/retirada |
| Reserva de pronta entrega | Compartilhada com PDV, somente para produtos com controle ativo | Conectar ao checkout e homologar com empresa da loja |
| Pronta entrega e encomenda | Modalidade por item, snapshot e prazo | Apresentar sacola/checkout nas etapas 10/11 |
| Cobrança de pedido | Asaas por lojista, Pix/cartão, tentativas, inbox, conciliação e estorno integral | Checkout do comprador, homologação real e operação de exceções |
| E-mails de conta | `POST /contas/emails`, escopo `contas:email` | Origem autorizada no ERP, conexão de administrador e SMTP configurados |
| Nota fiscal para comprador | Sem endpoint na integração externa | Acesso autorizado aos documentos e envio automático de PDF/XML pelo MuiraSoft |
| Eventos MuiraSoft para a loja | Ausentes nesta integração | Sincronização e notificações com recuperação e controle de duplicidade |

A política para novos pedidos é `RESERVA`, com prazo por conexão (30 minutos por padrão). Somente produtos com controle ativo no MuiraSoft reservam saldo e geram baixa; sem controle, campos de saldo/reserva são `null`. Pedidos antigos `SEM_MOVIMENTO` não são convertidos automaticamente. Pagamentos planejados no POST de pedido continuam previsões: somente o módulo de pagamentos verificado gera recebíveis/baixas. Baixa física depende de expedição/retirada autorizada no ERP.

O contrato atual é 1.5.0. Pagamentos usam chave própria de 16–100 caracteres `[A-Za-z0-9_-]`, sem total/ambiente enviados pelo comprador. Os escopos novos precisam de concessão explícita. Dados de cartão são transitórios, sem persistência ou logs; o adaptador recusa cartão com Observe habilitado. Timeout exige consulta/conciliação pela chave, sem repetir cobrança. Ver `docs/pagamentos-lojas.md` no backend MuiraSoft.

O checkout da etapa 11 expõe apenas operações vinculadas ao comprador autenticado. Não repassa os métodos comerciais gerais da conexão. Novos RPCs `/checkout/opcoes`, `/checkout/cotacoes`, `/checkout/cotacoes/{id}` e `/checkout/cotacoes/{id}/confirmar` usam os escopos explícitos checkout:ler/criar, cotação de cinco minutos e criação idempotente com reserva condicional. Ver [checkout](checkout.md) para contratos e limites. Documentos fiscais seguem nas etapas próprias; nenhuma URL hipotética é considerada disponível.
