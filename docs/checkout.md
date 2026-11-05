# Etapa 11 — checkout

Implementação local em 02/11/2026. Entrega por **faixas de CEP, cada uma com taxa e prazo**, e pedidos mistos atendidos **juntos, depois da produção da encomenda**, conforme decisões do usuário. Pix à vista ou cartão de crédito em até três vezes sem juros; encomendas são pagas integralmente.

## Fluxo entregue

1. Comprador entra com e-mail confirmado. Seleciona endereço próprio salvo, informa CPF/CNPJ e confere nome/telefone da conta.
2. MuiraSoft informa modalidades para o CEP: retirada com endereço/instruções configurados e/ou entrega da faixa correspondente. Faixas sobrepostas são recusadas.
3. API solicita uma cotação ao ERP usando a identidade estável do comprador. Preços, taxa e prazos vêm do MuiraSoft; nenhuma empresa, canal ou valor escolhido pelo navegador é usado como autoridade.
4. Cotação dura cinco minutos. Comprador vê itens/opções, endereço, modalidade, produção, entrega e total, e aceita a revisão explicitamente.
5. Confirmar cria um único pedido no ERP e reserva pronta entrega controlada. Preço/publicação/estoque e versão da condição de entrega são revalidados. Frete e endereço completos são preservados no pedido.
6. Somente depois é solicitada a cobrança. Pix mostra PNG/copia e cola próprios; cartão recebe os dados dentro da loja, sem gravá-los. Confirmação é consultada separadamente da criação da cobrança.

**Estoque continua exclusivamente no MuiraSoft e somente para itens marcados com controle ativo.** Produtos sem controle não exigem saldo nem geram reserva/baixa. Encomenda não exige estoque físico antes da produção. Baixa permanece na expedição/retirada, separada do pagamento.

## Configuração e bancos

No MuiraSoft: Configurações → Integrações → botão **Checkout** da conexão, exclusivo de administradores ativos. Configuração começa desativada. Retirada exige endereço e instruções; entrega exige CEP inicial/final com oito dígitos, taxa decimal e prazo de 1–365 dias. Não foram cadastrados endereço, horário ou taxa reais por dedução. Prazos são apresentados como informados pela loja, separados da produção; calendário/feriados e condições comerciais finais precisam da validação do lojista antes da ativação.

Ambiente/carteira Asaas ativos precisam estar vinculados à conexão antes de cotar/confirmar. A configuração de gateway permanece separada das assinaturas do MuiraSoft. Conexões antigas não ganham os novos escopos automaticamente: conceder explicitamente `checkout:criar` e `checkout:ler`. O fluxo completo também usa `produtos:ler`, `pedidos:criar`, `pagamentos:criar` e `pagamentos:ler`.

Migration ERP **044**, aplicada e registrada: configuração por conexão, cotações, vínculo do pedido, snapshot de entrega, frete e instante de confirmação. Migration TypeORM **CheckoutSessions1793646000000**, aplicada na API; agora são quatro migrations. Contém apenas sessões de checkout e intenções de pagamento, sem estoque no NestJS. Nenhuma empresa/conexão/configuração real ou pedido de negócio foi criado.

## Contratos

Contrato ERP **1.5.0**, snapshot/proveniência/tooling atualizados. Contrato público da loja **0.4.0**. Contrato administrativo em `muirasoft/back/docs/checkout-lojas.openapi.json`.

| Operação pública | Uso |
| --- | --- |
| `GET /api/v1/checkout/options?address_id=UUID` | Modalidades para endereço próprio |
| `POST /api/v1/checkout` | Preparar revisão com chave idempotente |
| `GET /api/v1/checkout/{id}` | Retomar revisão/pedido e consultar tentativas próprias |
| `POST /api/v1/checkout/{id}/confirm` | Aceite `accepted: true`; cria/reserva uma vez |
| `POST /api/v1/checkout/{id}/payments` | Solicitar Pix/cartão com chave idempotente |
| `GET /api/v1/checkout/{id}/payments/{payment}/pix` | Instruções da própria tentativa Pix pendente |

Todos exigem sessão verificada. Escritas exigem a origem exata da loja. UUID informado não autoriza acesso: sessão, loja, comprador, endereço, checkout e tentativa são conferidos no servidor. Não há listagem pública dos pedidos/pagamentos da conexão inteira.

Preparar recebe endereço por ID, documento, tipo de entrega e referências da sacola. Nome/e-mail/telefone vêm da conta; o backend valida CPF/CNPJ. Dados legados do ERP limitam nome/e-mail do comprador a 100 caracteres neste fluxo. Endereço completo de até 150 caracteres é preservado no snapshot, inclusive para retirada como endereço do titular; nunca se usa o endereço da loja como se fosse do pagador.

## Recuperação e idempotência

- Revisão: intenção local é salva antes do RPC. Mesma chave/payload recupera a mesma cotação. Outra pessoa não reaproveita a chave.
- Confirmação: o ID da cotação é a identidade permanente da criação. O ERP bloqueia a conexão/cotação, cria pedido e reserva na mesma transação; repetição não renova reserva, cria outro pedido ou cobra.
- Pagamento: intenção local registra somente método, parcelas, chave e vínculo, antes da chamada. Uma tentativa ativa/incerta bloqueia outra chave. Nova tentativa é permitida somente após recusa explícita, até cinco por checkout.
- Resposta perdida é consultada no ERP pela chave exata. Repetir o POST público da mesma intenção não reenvia o cartão ao gateway. Resultado incerto fica em análise; não há repetição automática de cobrança/estorno.
- Sessão é revalidada dentro da transação que aceita a intenção financeira. Logout antes desse aceite impede a chamada de cobrança; logout posterior não cancela uma intenção já autorizada.

Cotação expirada ou preço/frete/publicação alterados exigem nova revisão. Depois de pedido confirmado, snapshots não são alterados; cancelamento/renovação de pedido antigo e exceções operacionais seguem para a equipe/etapa 12. Não cancelar, estornar ou recriar pedidos pagos automaticamente.

Prazo da cotação, reserva de estoque e validade do Pix são distintos. Reserva padrão de 30 minutos continua configurável por conexão no ERP. Pagamento após expiração com falta de estoque fica registrado como pago e em revisão, sem estorno automático. Atendimento conjunto usa o maior prazo de produção; prazo de entrega vem depois.

## Cartão, privacidade e transporte

PAN/CVV não entram em SQL, cifra persistida, fila, e-mail, logs, erros, armazenamento do navegador ou observabilidade. Só transitam na memória da chamada e no HTTPS com o ERP/Asaas. Inputs são limpos ao enviar, trocar método, fechar ou desmontar. A API persiste dados pessoais da requisição/revisão com AES-GCM e AUTH_ENCRYPTION_KEY, usando AAD distinta por loja, checkout e finalidade; não reutiliza o contexto de e-mails. No ERP, snapshots seguem a proteção de acesso do módulo de pedidos. Definir retenção e rotinas de limpeza de cotações abandonadas antes do piloto; nenhuma exclusão de histórico foi automatizada nesta etapa.

Observe permanece desabilitado. HTTPS é obrigatório para pagamento em produção. `TRUSTED_PROXY_IPS` aceita apenas IPs exatos de proxies controlados, sem curingas/CIDR: vazio não confia em `X-Forwarded-*`. O IP do comprador é derivado da requisição; não é aceito no corpo. Na implantação conferir proxy, TLS, limites distribuídos, ausência de captura de corpos sensíveis e timeouts (API → ERP até 180s, navegador até 185s, ERP → Asaas 65s).

Cliente vê confirmação, análise, recusa e estornos sem taxas/códigos operacionais privados. Disputa/estado divergente exige análise, sem apresentar o pagamento histórico como nova confirmação disponível. Histórico completo e documentos fiscais permanecem nas etapas 13/14; a emissão fiscal com os novos dados de entrega/frete ainda precisa de homologação própria.

## Interface e retomada

Checkout reutiliza identidade, campos, resumo e temas da loja, dentro de diálogo nativo. Pix é apresentado apenas para tentativa própria pendente. Não existe débito neste fluxo. A referência de retomada fica somente em sessionStorage, vinculada ao comprador, sem credenciais ou dados do cartão. Abrir checkout novamente consulta o servidor. Compra paga remove da sacola somente quantidades efetivamente compradas, uma vez, preservando itens adicionados depois.

MuiraSoft mostra snapshot de entrega/retirada, produção, frete e total com frete no detalhe do pedido. Nenhum funcionário pode alterar esses dados de checkout como se fossem um cadastro mutável.

## Validações em 02/11/2026

- ERP: **168 verificações integradas**, incluindo 24 novas de cotação/condições/pedido; escritas em schema temporário. Runner legado reutiliza catálogos de fixture locais. Nesta execução, o Docker CLI deixou de responder e somente os clientes iniciados para estes testes foram encerrados; os containers não foram reiniciados. Suíte executada com PHP **8.5.12 do Windows** e MariaDB local, não apresentada como nova homologação do PHP 8.2 do container.
- API: **124 unitários**, **14 e2e**, seis contratos; **28 cenários HTTP/MySQL** de checkout com ERP simulado, mais dez de migrations/rollback. Build/tipos/lint aprovados.
- Loja: **16 testes** e build aprovados. ERP frontend: build/tipos e regressões existentes validados.
- Nenhum POST real ao Asaas, envio externo, comprador real, deploy, commit ou push. Os testes de pagamento usam dados sintéticos e servidor HTTP de fixture; SMTP não é acionado.

Revisão visual ao vivo continua pendente do bloqueio do Computer Use registrado na etapa 10. Empresa Cabeça do Cachorro, publicação real, configuração de entrega/retirada, vínculo/chave Sandbox, webhook HTTPS e workers ainda são necessários para homologar uma compra real. Não utilizar outra empresa para simular essa ativação.

Próxima implementação: **etapa 12 — operação do pedido no MuiraSoft**, mantendo estados comerciais, financeiros, físicos e fiscais independentes.
