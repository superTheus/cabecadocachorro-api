# Plano de implementação da loja Cabeça do Cachorro

A Cabeça do Cachorro vende roupas e outros produtos pela loja Vue. O NestJS mantém a conta do comprador e conecta a experiência ao MuiraSoft. O MuiraSoft concentra produtos, estoque, pedidos, pagamentos, e-mails, atendimento e documentos fiscais. Os módulos de pagamentos e e-mails atendem outros lojistas com isolamento por conta e contexto de empresa.

**Preservar o layout da loja é obrigatório em todas as etapas.** Reutilizar a identidade, tipografia, cores, espaçamentos, componentes, animações e responsividade existentes. Cadastro, área do cliente e checkout seguirão esse padrão, com revisão visual em desktop e celular. A etapa 1 não modifica o frontend.

## Decisões confirmadas

- Catálogo de roupas e outros produtos, com ou sem variações.
- Pronta entrega e encomenda, com pagamento integral da encomenda no checkout.
- Pix e cartão preenchido dentro da loja.
- Entrega local e retirada.
- Conta do cliente com cadastro, login, perfil, endereços, histórico e acompanhamento.
- Asaas configurado pelo lojista no MuiraSoft; cobranças na conta Asaas desse lojista.
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
| Parcelamento | Limite, valor mínimo e juros |
| Pix e reservas | Validade, liberação e tratamento de pagamento tardio |
| Pedido misto | Atendimento conjunto ou separado |
| Encomendas | Prazos e capacidade |
| Entrega local | Área, taxas, horários e prazos |
| Retirada | Endereço, horários e instruções |
| Cancelamento/devolução | Ações automáticas e análise da equipe |
| Baixa física | Evento que transforma reserva em saída |
| Notificações | Etapas comerciais que notificam o comprador |
| Cartão | Checkout próprio com crédito; débito do protótipo precisa de fluxo distinto conforme contrato do Asaas |

## Estado da implementação em 29/10/2026

Etapas 1 e 2 concluídas localmente. A etapa 4 foi implementada em 30/10/2026 (cadastro, confirmação, sessões, recuperação, troca de senha e Minha conta), com entrega real de e-mails pendente do cadastro da empresa e configuração da conexão/SMTP no MuiraSoft. Consulte [conta do comprador](conta-comprador.md). A etapa 3 foi iniciada em 30/10/2026: fila cifrada, worker, histórico e notificações de criação e todas as mudanças de status dos pedidos da loja. Conta do comprador, pagamento real e envio fiscal serão ligados nas respectivas etapas. Consulte `docs/email-fila.md` no backend MuiraSoft. A configuração por lojista e o envio manual fiscal estão documentados no backend MuiraSoft em `docs/email-configuracao.md`. Consultar também [continuação na nuvem](continuacao-nuvem.md) para branches, repositórios, verificações e preparação do ambiente.

## Recorte da etapa 1

Esta entrega prepara a estrutura; os módulos comerciais acima têm etapas próprias. A API pública da fundação contém somente [liveness e readiness](../contracts/storefront.openapi.json). O [contrato remoto existente](../contracts/muirasoft/integracoes-v1.openapi.json) e suas [lacunas documentadas](integracao-muirasoft.md) distinguem o que já pode ser integrado do que ainda precisa ser implementado no MuiraSoft.
