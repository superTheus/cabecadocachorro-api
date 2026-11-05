# Plano de implementação da loja Cabeça do Cachorro

Estado atual em 03/11/2026: etapas 1–14 implementadas localmente; etapa 15 com validação técnica concluída e homologação empresarial/visual pendentes. As atualizações anteriores abaixo são históricas. Consulte [fiscal e homologação](fiscal-homologacao.md) e o guia canônico no backend MuiraSoft antes de iniciar implantação/piloto da etapa 16.

A Cabeça do Cachorro vende roupas e outros produtos pela loja Vue. O NestJS mantém a conta do comprador e conecta a experiência ao MuiraSoft. O MuiraSoft concentra produtos, estoque, pedidos, pagamentos, e-mails, atendimento e documentos fiscais. Os módulos de pagamentos e e-mails atendem outros lojistas com isolamento por conta e contexto de empresa.

**Preservar o layout da loja é obrigatório em todas as etapas.** Reutilizar a identidade, tipografia, cores, espaçamentos, componentes, animações e responsividade existentes. Cadastro, área do cliente e checkout seguirão esse padrão, com revisão visual em desktop e celular. A etapa 1 não modifica o frontend.

## Decisões confirmadas

- Catálogo de roupas e outros produtos, com ou sem variações.
- Pronta entrega e encomenda, com pagamento integral da encomenda no checkout.
- Pix e cartão preenchido dentro da loja.
- Entrega local e retirada.
- Conta do cliente com cadastro, login, perfil, endereços, histórico e acompanhamento.
- Asaas configurado pelo lojista no MuiraSoft; cobranças na conta Asaas desse lojista.
- Cartão em até 3 vezes sem juros. Pagamento tardio sem estoque permanece registrado e segue para revisão, sem estorno automático.
- MuiraSoft envia os e-mails da loja. Sem configuração personalizada ativa, utiliza o servidor padrão do MuiraSoft.
- Nota autorizada enviada ao comprador com PDF e XML e disponibilizada com autorização na área do cliente.

## Etapas e critérios de conclusão

| Etapa | Entrega | Critério de conclusão |
| --- | --- | --- |
| 1. Fundação e contratos | Configuração validada, módulos, banco próprio MySQL e migrações explícitas, erros, health checks, adaptador privado MuiraSoft e contratos versionados | Build e verificações passam; sonda pública não expõe contexto; vínculo empresa/canal é conferido; frontend preservado |
| 2. Configuração de e-mail | Tela no MuiraSoft com SMTP, segurança, credenciais criptografadas, remetente, resposta e teste por lojista | Servidor personalizado validado e servidor padrão utilizado quando não houver configuração própria ativa |
| 3. Notificações e fila | Modelos autorizados, fila, histórico, tentativas e e-mails de conta/pedido/pagamento/status/fiscal | Processamento recuperável e sem repetição indevida; falha de envio não bloqueia o pedido ou o pagamento |
| 4. Conta do comprador | Cadastro, confirmação de e-mail, login, logout, sessões, recuperação/alteração de senha e vínculo comercial estável | Comprador acessa e recupera somente sua conta; vincular histórico exige comprovação de titularidade |
| 5. Perfil e endereços | Dados pessoais, endereço padrão e endereços salvos | Checkout seleciona endereço salvo; alterações futuras preservam snapshots de compras anteriores |
| 6. Catálogo no MuiraSoft | Publicação explícita por loja, fotos, categorias, descrição, preço, variações e modalidade/prazo | Produto simples e produto com variações oferecem os dados necessários para apresentação e compra |
| 7. Pedidos e estoque | Referências, snapshots, modalidade por item, reservas compartilhadas com PDV, expiração e baixa física definida | A última unidade não é reservada duas vezes; encomenda e prazos são preservados; estoque sem efeito duplicado |
| 8. Conexão Asaas | Configuração por lojista, ambiente, chave criptografada, empresa/conta financeira, webhook e diagnóstico | Dois lojistas operam de forma isolada, sem misturar a cobrança de assinatura do próprio MuiraSoft |
| 9. Pagamentos e financeiro | Pix, cartão, tentativas, consulta, webhook autenticado, estornos e conciliação | Pedido, cobrança e recebimentos rastreáveis e idempotentes; pagamento confirmado distinto de valor disponível |
| 10. Vitrine e sacola | Catálogo real, filtros, fotos/opções, prazos, quantidades e restauração da sacola; páginas de atendimento e informações | Produtos reais em desktop/celular, sacola revalidada e padrão visual preservado |
| 11. Checkout | Identificação, endereço, entrega local/retirada, taxa/prazo, revisão de valores e pagamento integral; reserva antes da cobrança | Compra sem adulteração de valores nem duplicação de pedido/cobrança; cartão fora de logs, filas e observabilidade |
| 12. Operação no MuiraSoft | Atendimento de encomenda, separação, retirada, entrega, conclusão, cancelamento e devolução com permissões | Equipe conduz a operação com estados comerciais, financeiros e fiscais independentes e histórico consistente |
| 13. Área do cliente | Histórico paginado, itens/opções, valores, pagamento, prazo, linha do tempo, instruções Pix válidas e solicitações | Somente pedidos do comprador autenticado; sem observações internas; sincronização recuperável |
| 14. Nota fiscal e envio | Ampliar envio para pedidos, após autorização e arquivos oficiais; PDF/XML por servidor selecionado, histórico e reenvio controlado | Documento do pedido correto, destinatário preservado, anexos válidos e acesso autorizado |
| 15. Homologação e visual | Cenários completos e de falha, concorrência, isolamento, regressões e comparação visual | Cenários críticos aprovados em desktop/celular e padrão da loja preservado |
| 16. Implantação e piloto | Migrações, HTTPS, domínios, credenciais, webhook, e-mail, filas, tarefas e monitoramento | Compra piloto conciliada da conta do cliente até pagamento, fiscal e entrega/retirada, com recuperação operacional |

## Responsabilidades de comunicação

O NestJS gera e valida os tokens de autenticação do comprador. O MuiraSoft executa os envios por modelos autorizados, com links para o domínio da loja. E-mails comerciais derivam dos eventos de negócio no MuiraSoft.

O serviço de e-mail usa a configuração personalizada ativa ou o padrão MuiraSoft. Falha no personalizado gera registro e retentativa, em vez de troca automática que possa repetir uma mensagem já aceita pelo servidor. Os e-mails apresentam identidade da loja; no serviço padrão, o remetente usa endereço autorizado do MuiraSoft e resposta para a empresa.

O envio fiscal usa o e-mail do comprador registrado no pedido; a configuração do lojista é o remetente. PDF/XML só entram após autorização e disponibilidade dos arquivos. Mensagem pendente, aceita pelo servidor de e-mail e falha são situações de envio, sem supor que aceitação SMTP comprova leitura ou entrega na caixa de entrada.

## Regras a fechar antes dos respectivos fluxos

| Regra | Decisão necessária |
| --- | --- |
| Parcelamento | Até 3 vezes sem juros; homologar limites do provedor |
| Pix e reservas | Reserva padrão 30 min configurável, Pix com validade do Asaas; pagamento tardio sem saldo fica pago/em revisão sem estorno automático |
| Pedido misto | Atendimento conjunto após a encomenda ficar pronta |
| Encomendas | Prazos e capacidade |
| Entrega local | Faixas de CEP com taxa/prazo por loja; cadastrar valores reais quando a empresa existir |
| Retirada | Endereço/horários/instruções por loja; cadastro real pendente |
| Cancelamento/devolução | Regra inicial: análise manual, reposição explicitamente conferida somente para itens com controle e baixa original no MuiraSoft; estorno/fiscal separados |
| Baixa física | Ao confirmar expedição/retirada, somente itens com controle ativo no ERP |
| Notificações | Todas as mudanças comerciais, inclusive cancelamento |
| Cartão | Crédito dentro da loja; homologação com provedor real pendente |

## Estado da implementação em 29/10/2026

Etapas 1 e 2 concluídas localmente. A etapa 4 foi implementada em 30/10/2026 (cadastro, confirmação, sessões, recuperação, troca de senha e Minha conta), com entrega real de e-mails pendente do cadastro da empresa e configuração da conexão/SMTP no MuiraSoft. Consulte [conta do comprador](conta-comprador.md). A etapa 3 foi iniciada em 30/10/2026: fila cifrada, worker, histórico e notificações de criação e todas as mudanças de status dos pedidos da loja. Conta do comprador, pagamento real e envio fiscal serão ligados nas respectivas etapas. Consulte `docs/email-fila.md` no backend MuiraSoft. A configuração por lojista e o envio manual fiscal estão documentados no backend MuiraSoft em `docs/email-configuracao.md`. Consultar também [continuação na nuvem](continuacao-nuvem.md) para branches, repositórios, verificações e preparação do ambiente.

## Recorte da etapa 1

Esta entrega prepara a estrutura; os módulos comerciais acima têm etapas próprias. A API pública da fundação contém somente [liveness e readiness](../contracts/storefront.openapi.json). O [contrato remoto existente](../contracts/muirasoft/integracoes-v1.openapi.json) e suas [lacunas documentadas](integracao-muirasoft.md) distinguem o que já pode ser integrado do que ainda precisa ser implementado no MuiraSoft.

## Atualização em 02/11/2026

Etapa 5 implementada: nome/telefone, CRUD de endereços e padrão único, com sessão, isolamento e concorrência. Veja [perfil e endereços](perfil-enderecos.md). Seleção no checkout aguarda etapa 11. Próxima entrega: etapa 6, catálogo no MuiraSoft. Empresa/conexão e homologação de e-mail continuam pendentes.

## Catálogo no MuiraSoft — 02/11/2026

Etapa 6 implementada localmente: publicação por conexão, metadados, fotos por URLs HTTPS, variações por SKUs existentes, modalidade/prazo. Contrato ERP 1.2 e adaptador atualizados. Ver docs/catalogo-lojas.md no MuiraSoft backend. Próxima entrega: etapa 7, pedidos e estoque. Vitrine real na etapa 10. Empresa/conexão e homologação integrada pendentes.

## Pedidos e estoque — 02/11/2026

Etapa 7 implementada no MuiraSoft: reserva inicial de 30 minutos configurável, apenas para produtos com controle no ERP; baixa em expedição/retirada. Sem controle não há reserva/bloqueio/baixa. Contrato 1.3 e adaptador validados. Não há estoque/reserva próprios no NestJS. Detalhes em docs/pedidos-estoque-loja.md no MuiraSoft backend. Próxima entrega: etapa 8, conexão Asaas.

## Conexão Asaas por lojista — 02/11/2026

Etapa 8 implementada no ERP em módulo próprio, por conta/empresa/ambiente, com cifra dedicada, token de webhook independente, inbox durável e diagnóstico somente leitura. Nenhuma chave de assinatura é reutilizada. A API da loja não recebe segredos Asaas. Ver docs/asaas-lojas.md no backend MuiraSoft. Próxima etapa: 9, pagamentos e financeiro; integração real ainda não homologada.

## Pagamentos e financeiro — 02/11/2026

Etapa 9 implementada localmente: Pix, cartão em até 3 vezes sem juros, tentativas duráveis, consulta por referência, webhook com consulta atual, recebíveis/baixas/taxas no financeiro existente, estorno integral e revisão de exceções. Contrato ERP 1.4.0 e adaptador privado NestJS. Nenhuma rota de pagamento do comprador foi exposta antes do checkout da etapa 11. Ver docs/pagamentos-lojas.md no backend MuiraSoft.

Migrations 042/043 locais aplicadas e registradas. Estoque somente no ERP e para produtos com controle ativo; pagamento não baixa estoque. Falta de estoque após pagamento tardio exige revisão sem estorno automático. Homologação Asaas e revisão visual permanecem pendentes. Próxima etapa: **10 — vitrine e sacola**.

## Vitrine e sacola — 02/11/2026

Etapa 10 implementada localmente: catálogo público projetado, modelos/SKUs, filtros, fotos, modalidades/prazos e sacola persistida com revalidação no ERP. Instagram atual confirmado para atendimento; páginas de informações ligadas ao menu/rodapé. Produtos e descontos de demonstração retirados. Nenhuma reserva ou cobrança no navegador/NestJS. Contrato público 0.3.0; ver [vitrine e sacola](vitrine-sacola.md).

Passaram 117 testes unitários da API, 14 e2e HTTP, seis contratos, 13 testes da loja, builds/tipos/lint. Sem migration nova. Empresa/conexão/publicações reais e revisão visual permanecem pendentes; não afirmar homologação com produtos reais. Próxima implementação: **11 — checkout**, fechando entrega local/retirada e atendimento de pedido misto antes de cobrar.

## Checkout — 02/11/2026

Etapa 11 implementada localmente: conta verificada, endereço próprio, CPF/CNPJ, revisão no ERP, entrega por faixas de CEP ou retirada, atendimento conjunto, confirmação idempotente/reserva e pagamento Pix/cartão. Snapshot preserva frete/endereço; cartão não é persistido ou registrado. Retomada e consulta por comprador, com recuperação por chave sem repetir cobrança. Ver [checkout](checkout.md).

Migration ERP 044 e quarta migration da API aplicadas/registradas. Contratos ERP 1.5.0 e público 0.4.0. Passaram 168 verificações ERP, 124 unitários/14 e2e/seis contratos da API, 28 HTTP/MySQL de checkout, dez de migrations e 16 testes da loja; builds/tipos/lint. Homologação real e revisão visual pendentes. Próxima implementação: **12 — operação no MuiraSoft**.

## Operação no MuiraSoft — 02/11/2026

Etapa 12 implementada localmente no ERP: produção de encomendas, separação, preparo conjunto, expedição/retirada, entrega, conclusão, cancelamento e devoluções com permissões e histórico idempotente. Usuário confirmou exceção administrativa com motivo para operar sem liberação financeira e devolução com análise manual, reposição após conferência e estorno separado. A exceção não altera pagamento nem contorna saldo físico. Somente o MuiraSoft movimenta estoque, apenas para produtos com controle ativo.

Migrations ERP 045/046 aplicadas/registradas. Contratos externos permanecem ERP 1.5.0/público 0.4.0, sem exposição do histórico interno. Passaram 232 verificações integradas ERP, 69 de pedidos e 43 do frontend ERP; build/tipos/lint dos arquivos alterados. Ver docs/operacao-pedidos-loja.md no backend MuiraSoft. Empresa/conexão/Asaas e revisão visual continuam pendentes. Próxima implementação: **13 — área do cliente e acompanhamento**.

## Área do cliente e acompanhamento — 02/11/2026

Etapa 13 implementada localmente: Meus pedidos, paginação por cursor, itens/opções e snapshots, valores/frete, pagamento, prazos, linha do tempo, retomada do checkout/Pix e solicitações manuais de cancelamento/devolução/atendimento. O usuário pediu decisões rotineiras autônomas; as regras conservam análise manual, estorno separado e estoque somente no MuiraSoft para produtos controlados. Atendentes respondem no ERP, separando resposta pública de nota interna. Sem associação de compras por e-mail/documento ou efeitos financeiros/físicos automáticos.

Migration ERP 047 e quinta migration da API aplicadas/registradas. Contratos ERP 1.6.0/público 0.5.0. Passaram 273 verificações ERP, 132 unitários/14 e2e/seis contratos da API, 23 HTTP/MySQL de acompanhamento, 28 de checkout, dez de migrations e 20 testes da loja; frontend ERP com 43 regressões/build/tipos/lint. Ver [área do cliente e pedidos](area-cliente-pedidos.md). Homologação real e revisão visual continuam pendentes. Próxima implementação: **14 — nota fiscal e envio**.
