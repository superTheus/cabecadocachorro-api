# Área do cliente e acompanhamento — etapa 13

Implementada localmente em 02/11/2026 na loja Vue, API NestJS e MuiraSoft. O usuário pediu autonomia para decisões rotineiras; foram adotadas as regras de análise manual já confirmadas na etapa 12, sem novas perguntas.

## Experiência do comprador

Minha conta → Meus pedidos apresenta histórico paginado, detalhe dos itens e opções comprados, valores/frete, modalidade, prazo de produção, prazo/instruções de entrega ou retirada, situação de pagamento, linha do tempo e solicitações. Reutiliza diálogo, cores, fontes e componentes da loja. Não cria previsão de calendário, transportadora, rastreio externo ou política comercial fictícios. Pedido misto continua atendido junto após a produção.

Consulta é explícita, sem polling contínuo. O horário de última consulta é apresentado. Falha de rede mantém o conteúdo já visível e informa que é preciso atualizar; não substitui histórico por lista vazia fictícia. Sessão inválida remove o conteúdo da conta e pede novo login. Paginação usa cursor estável, padrão 20 e máximo 50 registros. Consultas têm limite de 60 por minuto/IP e mapa de cardinalidade limitada. Escritas exigem Origin exato e limite persistido do serviço de autenticação.

O botão de pagamento retoma exclusivamente o checkout daquele pedido pertencente ao mesmo comprador. Permite consultar a situação, obter instruções Pix atuais ou seguir as tentativas já permitidas pelo checkout. Retomar pelo histórico não remove produtos de uma sacola nova. Nenhum dado de histórico, mensagem, pagamento ou endereço é salvo em localStorage/sessionStorage. A retomada anterior do checkout continua guardando somente IDs.

Atualização da etapa 14: o histórico agora apresenta metadados fiscais e download autorizado de PDF/XML originais. A rota `GET /api/v1/orders/{id}/documents/{document}/{format}` exige a sessão verificada, revalida propriedade e autorização no ERP e retorna arquivo como anexo sem cache; nenhuma URL pública é exposta. Limites: PDF 4 MiB, XML 2 MiB. Ambiente de homologação é identificado. Publicação/envio dependem de autorização e arquivos válidos; nota/pedido cancelado bloqueia download. Consulte `muirasoft/back/docs/fiscal-pedidos-loja.md` e o relatório de homologação das etapas 14/15 no checkout irmão.

## Identidade e privacidade

Todas as rotas exigem sessão de comprador com e-mail verificado. A API deriva `buyer:{store_id}:{customer_uuid}` da sessão/configuração, nunca da query ou do corpo público. Antes da comunicação remota confere o vínculo persistido de loja/base/empresa/canal. O adaptador consulta contexto e escopo atual. Não há associação de histórico por e-mail, CPF/CNPJ ou nome.

No ERP, cada consulta exige conta, empresa, conexão, cliente vinculado e referência imutável no snapshot do pedido. ID público e cursor não concedem acesso. A migration atribui identificadores a pedidos integrados existentes; novos IDs são aleatórios. Pedidos manuais/antigos sem vínculo comprovado não aparecem automaticamente. Duas identidades com o mesmo e-mail não compartilham histórico.

O ERP constrói projeção explícita e a API reconstrói novamente a whitelist, validando tipos, limites, identidade, itens únicos e soma em centavos. Não são expostos notas internas, exceção administrativa, custo, taxas, credenciais, IDs de conta/empresa, identidade da equipe ou URLs fiscais privadas. O campo servidor a servidor `checkout_reference` serve somente ao vínculo local e é retirado da resposta pública. Status comercial configurável, operação física e pagamento continuam independentes. A linha do tempo inclui fatos públicos de cada dimensão, sem observações administrativas.

Respostas usam Cache-Control: no-store e fetch com credenciais, sem cache compartilhado. A API revalida a sessão ao terminar a leitura e ao aceitar uma intenção escrita, inclusive após consultas remotas; logout durante preflight bloqueia nova solicitação.

## Solicitações e atendimento no ERP

O comprador pode solicitar cancelamento antes da saída, devolução após expedição/retirada ou atendimento sobre um pedido. Retorno exige itens/quantidades do próprio pedido, limitados ao vendido menos devoluções físicas abertas/recebidas. Mensagem de 1–1000 caracteres; até 30 itens. Limites iniciais: uma solicitação OPEN/IN_REVIEW por tipo/pedido e 20 solicitações por pedido. Casos fora dos limites seguem para o Instagram de atendimento já confirmado.

Solicitar não cancela, estorna, recebe mercadoria, repõe estoque ou bloqueia automaticamente a expedição. É um pedido de análise; a interface declara isso. O comprador deve aguardar a resposta da equipe. Não foram presumidos prazos legais, concessão automática de devolução ou política de frete estornado.

No MuiraSoft, a lista de pedidos sinaliza e filtra solicitações pendentes. O detalhe apresenta mensagem/itens e permite analisar, responder e encerrar. Exige permissão `operar` por empresa e ator ativo, com perfil revalidado no banco. Resposta pública é campo separado de observação interna. ANSWERED/CLOSED exigem resposta pública; uma solicitação encerrada não é reaberta nem reescrita. Versão e chave idempotente protegem concorrência. A resposta não executa a ação comercial/física/financeira aprovada: a equipe usa os fluxos da etapa 12 e do financeiro/fiscal.

O comprador vê somente as respostas públicas. Mudanças da análise enfileiram notificação com rótulo fixo, sem mensagem interna ou identificação da equipe. Nenhum worker SMTP é disparado pela requisição. Histórico interno permite até 100 atualizações por solicitação; notificações repetidas pela mesma chave não se duplicam.

## Recuperação após resposta incerta

A API grava a intenção e cifra o payload antes do POST remoto, com AAD `order-request:{uuid}` e chave de autenticação da loja. Não persiste mensagem em texto aberto nem em armazenamento do navegador. Loja/cliente/chave formam unicidade; fingerprint HMAC inclui pedido e payload normalizado. A sessão é revalidada sob lock antes de aceitar a intenção.

POST remoto usa chave determinística `customer-request-{uuid}`. O ERP grava a solicitação na própria transação, deduplica pela chave e verifica conteúdo e titularidade. Perda da resposta deixa o envio PENDING, visível em Meus pedidos com opção Retomar envio. A retomada usa a intenção já aceita, sem nova solicitação. Não há retry financeiro nem cancelamento automático. SENT confirma somente o recebimento para análise; REJECTED informa conflito/entrada recusada. Erros de rede/integração permanecem recuperáveis. Leituras não disparam novos pedidos de atendimento.

## Pix

A consulta do QR usa a [operação oficial do Asaas](https://docs.asaas.com/reference/obter-qr-code-para-pagamentos-via-pix), que retorna imagem, copia e cola e expiração. A validade vem da cobrança; não é igual ao prazo da reserva. Não há criação de outro pagamento por abrir o histórico.

MuiraSoft só oferece QR a pedido não cancelado e tentativa Pix ainda pendente, sem pagamento/estorno registrado. Recusa QR vencido ou a até 30 segundos de vencer, valida PNG/tamanho/payload e devolve timestamp UTC explícito. Data sem offset é interpretada conservadoramente em UTC, evitando prolongar validade por um fuso presumido; isso pode ocultar o QR antes do vencimento real se o provedor estiver usando horário brasileiro. Homologar o formato/fuso real no Sandbox antes do piloto. O NestJS rejeita validade ambígua/vencida e a loja remove o QR ao vencer. Não prorroga reserva nem garante saldo por exibir Pix.

## Contratos e banco

Contrato ERP 1.6.0, snapshot exato/proveniência/SHA e cópia normalizada para ferramentas atualizados. Sem escopo novo: acompanhamento usa pedidos:ler; solicitação exige pedidos:ler + pedidos:criar. As rotas gerais de pedidos da conexão continuam somente servidor a servidor.

- ERP: GET `/integracao/v1/compradores/pedidos`, GET `/{id}`, POST `/{id}/solicitacoes`, com referência do comprador derivada no NestJS.
- Público 0.5.0: GET `/api/v1/orders`, GET `/api/v1/orders/{id}`, POST `/api/v1/orders/{id}/requests`, POST `/api/v1/orders/{id}/requests/{request}/retry`. HTTP 202 de solicitação não significa aprovação comercial.
- Privado ERP: POST `/private/pedidos/{id}/solicitacoes/{solicitacao}/responder`; contrato de operação privado 1.1.

Migration ERP 047 aplicada/registrada: ID público, índice por comprador, solicitações e histórico da análise. Quinta migration NestJS CustomerOrderRequests1793649600000 aplicada; readiness verifica a tabela nova. Nenhum pedido, solicitação, pagamento ou devolução real foi criado. Migrations registradas anteriores preservadas.

## Verificação e retomada

- ERP: `php tests/run-integracoes.php`, 273 verificações em schema efêmero, incluindo isolamento por identidade/conexão/conta, cursor, limites de quantidades, envio sem efeitos automáticos, resposta pública sem nota interna, fila idempotente e QR vencido/pago/cancelado.
- API: 132 unitários, 14 e2e e seis contratos; `test/orders/mysql.mjs` com 23 verificações HTTP/MySQL reais e ERP simulado, incluindo resposta perdida/retomada, mensagens cifradas, titularidade, vínculo alterado e logout durante preflight. Regressão checkout: 28 HTTP/MySQL; migrations/rollback: dez.
- Loja: 20 testes e build; MuiraSoft frontend: 43 regressões, build/tipos e lint dos arquivos alterados. Contratos validados com SwaggerParser.

Suítes MySQL usam DATABASE_TEST_ADMIN_URL em processo privado e schemas efêmeros. Não imprimir URLs/segredos. Testes PHP locais usam Windows PHP 8.5/MariaDB; Docker CLI estava sem resposta na etapa 11, não foi usado para declarar nova homologação PHP 8.2. Nenhuma chamada Asaas/SMTP real, commit, push ou deploy.

Empresa Cabeça do Cachorro, conexão, publicações, entrega/retirada real, Asaas Sandbox, webhook HTTPS e workers continuam pendentes para homologação completa. Revisão visual desktop/celular também permanece pendente do bloqueio de Computer Use já registrado; compilação não comprova revisão visual. Próxima implementação: etapa 14, nota fiscal e envio autorizado.
