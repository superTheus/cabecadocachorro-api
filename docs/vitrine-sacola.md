# Etapa 10 — vitrine e sacola

Implementação local em 02/11/2026. A loja Vue passa a usar os produtos publicados no MuiraSoft. O Instagram **@cabecadocachorro_** permanece como atendimento, conforme decisão do usuário. O catálogo de demonstração e os descontos/tamanhos fictícios foram retirados do fluxo de compra.

## Responsabilidades

- MuiraSoft é a autoridade para publicação, SKU, descrição, fotos, categoria, preço, modalidade, prazo e disponibilidade. Produtos sem controle de estoque não são bloqueados por saldo. A sacola não reserva ou baixa estoque.
- NestJS confere o vínculo persistido da loja e o escopo `produtos:ler`, projeta somente dados públicos e recalcula a sacola. Credencial da integração, conta, empresa, canal, EAN, descrição interna e saldo físico não são retornados ao navegador.
- Vue apresenta a coleção, opções e avisos. Armazena apenas identificador da loja, SKU, modalidade, quantidade e preço observado; nenhum dado de conta, endereço, cartão ou credencial fica na sacola persistida.

Nenhuma migration ou alteração no banco foi necessária. Não há empresa/conexão real da Cabeça do Cachorro cadastrada: o ambiente local apresenta indisponibilidade do catálogo, sem substituir os produtos por demonstrações ou usar outra empresa.

## Contrato público 0.3.0

| Método e caminho | Comportamento |
| --- | --- |
| `GET /api/v1/catalog/products` | Coleção pública agrupada por modelo, filtros, ordenação, facetas e paginação |
| `GET /api/v1/catalog/products/{id}` | Dados publicados e todas as opções do modelo |
| `POST /api/v1/cart/validate` | Referências da sacola conferidas novamente no ERP, sem pedido/reserva/cobrança |

Contrato em `contracts/storefront.openapi.json`. O contrato proprietário do ERP continua 1.4.0; nenhum endpoint remoto foi inventado. Os métodos de pedidos/pagamentos do adaptador permanecem privados até a autorização por comprador no checkout.

Filtros: `search`, `category`, `color`, `size`, `fulfillment`, `sort`, `page` e `limit`. Cor e tamanho devem corresponder à mesma SKU. Paginação de modelos ocorre **após** reunir as variações, para não esconder uma opção na página seguinte. Limite 48 modelos por página, padrão 24; leitor limita o catálogo a 20 páginas de 100 SKUs e retorna indisponibilidade se exceder, sem entregar grupos parciais. Catálogos maiores precisam de paginação/facetas próprias no ERP antes de ampliar esse limite.

Cache de apresentação de 15 segundos, com vínculo e escopo conferidos inclusive em cache. Falha ao conferir integração não serve o catálogo antigo. Na revalidação da sacola, os SKUs são consultados diretamente no ERP, em lotes de até quatro leituras simultâneas. Não há cache de estoque no banco do NestJS.

## Vitrine e opções

Mantidos identidade verde/amarelo, logotipos, fontes, carrossel, pôster, cards, zoom, sacola lateral e componentes de conta existentes. Fotos são as URLs públicas aprovadas no catálogo; falha de imagem usa placeholder neutro, sem associar a foto de outro produto. Descrição é texto simples escapado. Não são inventadas composição, modelagem, promoção ou opção de tamanho.

Cada variação é uma SKU real com preço e disponibilidade próprios. Produtos simples funcionam sem campos de cor/tamanho. MISTA exige escolher pronta entrega ou encomenda; o prazo de produção é exibido separado da entrega. Sem saldo em uma SKU controlada, pronta entrega é desabilitada; encomenda continua disponível conforme publicação.

Estados de carregamento, coleção vazia, filtro sem resultado, falha de conexão e nova tentativa são explícitos. Requisições antigas de busca/detalhe são abortadas e descartadas por geração, mesmo se a resposta chegar atrasada. A navegação por teclado mantém foco nos diálogos e Escape fecha a camada atual.

## Sacola

`POST /cart/validate` recebe `store_id` e até 30 opções distintas, cada uma com SKU, quantidade inteira 1–99, modalidade e preço observado opcional. Rejeita campos de valor/empresa/canal, SKUs duplicadas na mesma modalidade e outra loja. Totais são calculados em centavos inteiros e retornados como strings decimais.

| Estado do item | Tratamento |
| --- | --- |
| OK | Mantém preço/opção conferidos |
| PRICE_CHANGED | Mostra preço atual e exige botão de aceitação para atualizar o preço observado |
| QUANTITY_UNAVAILABLE | Mantém quantidade solicitada e pede ajuste; não reduz silenciosamente |
| FULFILLMENT_UNAVAILABLE | Pede remover e selecionar a opção atual no produto |
| UNPUBLISHED | Mantém referência e avisa para remover |

Falha de integração retorna 503, sem declarar o produto removido, aprovar a sacola ou apagar itens. O subtotal só aparece quando todos os itens estão conferidos. Entrega/taxas não são tratadas como gratuitas: pertencem ao checkout.

A chave `cabeca-cart-v1` usa envelope versionado com identificador da loja. JSON corrompido, quantidade inválida, dados extras e excesso de linhas são tratados sem quebrar a página. Recarregar offline preserva as referências; catálogo e preço ficam pendentes. Outra loja invalida a sacola antiga. Armazenamento bloqueado permite uso na sessão. Edição da quantidade invalida o resultado anterior, com nova consulta após breve debounce; resposta antiga não aprova uma sacola já alterada.

Sacola conferida é uma consulta, **não é reserva ou autorização de cobrança**. A etapa 11 deverá revalidar e reservar novamente no ERP. O checkout demonstrativo anterior, que aceitava dados de cartão e imprimia o payload no console sem criar compra real, foi removido do fluxo. Não há cobrança falsa nem confirmação de compra nesta etapa.

## Atendimento e informações

Links `#atendimento`, `#envios` e `#privacidade` abrem páginas na identidade da loja, inclusive por URL direta e navegação voltar. Atendimento usa apenas o Instagram existente e confirmado. As informações descrevem pronta entrega/encomenda, diferença entre produção/entrega e dados efetivamente usados pela conta/sacola. Não foram inventados telefone, endereço, taxa, horário ou prazo comercial.

Antes da publicação comercial, completar identificação da empresa, condições de entrega/retirada e texto de privacidade aprovado pelo responsável. As páginas atuais não substituem essa definição empresarial. O cadastro de newsletter sem integração foi substituído por acesso ao Instagram, sem simular assinatura.

## Proteções e implantação

Limites em memória por IP: 60 consultas de catálogo/minuto e 10 revalidações/minuto, com mapa limitado a 4096 entradas. Os limites do ERP continuam ativos. Na implantação, configurar limitação distribuída/proxy conforme tráfego e conferir IPs confiáveis; o Express atual não confia automaticamente em `X-Forwarded-For`. Não habilitar Observe com a autenticação ativa.

Frontend utiliza `VITE_API_URL` pública, sem segredos. Durante desenvolvimento, padrão `http://localhost:3000/api/v1`; produção usa `/api/v1`. Origem precisa estar no CORS da API. Preparar empresa/conexão, publicar produtos, conferir `integration:check` e `store:bind` seguindo o guia existente; não contornar ausência desse vínculo para preencher a vitrine.

## Validação em 02/11/2026

- API: **117 unitários**, incluindo 22 novos de catálogo/sacola; **14 e2e HTTP**, incluindo sete novos; seis verificações de contrato; build, tipos e lint aprovados.
- Loja: **13 testes** de persistência, isolamento entre lojas, resposta atrasada, falha de rede e aceitação de preço; build aprovado. Workflow frontend adicionado, sem deploy.
- Inicialização local: frontend respondeu HTTP 200 e API retornou 503 estruturado no catálogo, esperado enquanto a conexão real não existe. Isso não comprova apresentação visual ou produtos reais publicados.
- Revisão visual desktop/celular/claro/escuro **pendente**: a verificação automática do Computer Use bloqueou a inspeção por não conseguir identificar com segurança a URL atual do Chrome. Nenhum caminho alternativo de controle do navegador foi utilizado.

Testes não acessaram Asaas, SMTP externo, contas reais de compradores ou pedidos de negócio. Sem commit, push, deploy ou alterações de credenciais. A implementação local da etapa 10 está entregue; homologação com o catálogo da empresa e revisão visual permanecem pendentes. Próxima implementação: **11 — checkout**.
