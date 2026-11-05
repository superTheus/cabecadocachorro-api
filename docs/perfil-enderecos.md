# Etapa 5 — perfil e endereços

Implementada em 02/11/2026 na API e no painel Minha conta da loja. Nome e telefone opcional são editáveis; e-mail não é alterado nesta etapa. Não há CPF, geocodificação ou consulta externa de CEP. Nenhum endereço atual substitui snapshots de pedidos fechados. A seleção de endereço e os snapshots do checkout pertencem à etapa 11.

## Contrato

Todas as rotas são relativas a /api/v1/auth. Sessão HttpOnly de comprador confirmado e loja correspondente são obrigatórias. Escritas exigem Origin exatamente igual à STORE_URL. O proprietário vem da sessão, nunca do corpo.

- PUT /profile: corpo completo name e phone (string vazia remove telefone); devolve perfil público. Nome até 150 caracteres; telefone com DDD, de 10 a 15 dígitos após remover formatação, com + opcional.
- GET /addresses: lista apenas endereços do comprador, padrão primeiro.
- POST /addresses: cria endereço e devolve 201.
- PUT /addresses/{id}: substitui dados do endereço; preserva condição de padrão.
- PUT /addresses/{id}/default: corpo {}; define o padrão.
- DELETE /addresses/{id}: exclui endereço; devolve mensagem.

Endereço exige label (até 50, pode ser vazio), recipient (150), postal_code (8 números), street (150), number (20, aceita S/N), complement (100, pode ser vazio), district (100), city (100) e state (UF brasileira de 2 letras). Corpos não aceitam campos adicionais; nenhum identificador de proprietário ou flag de padrão é aceito. Endereços de outro comprador e IDs inexistentes retornam 404. Entrada inválida retorna 400; sessão inválida 401; origem inválida 403; limite de 20 endereços retorna 409.

## Persistência e concorrência

Aplicar npm run db:migrate. Migration CustomerProfileAddresses1793642400000 acrescenta phone e customer_addresses. synchronize continua false. Em MySQL, DDL não tem rollback transacional: verificar backup/schema antes de aplicar em banco com dados. Não repetir cegamente em caso de falha parcial.

O primeiro endereço torna-se padrão. Ao excluir o padrão, o mais antigo restante é promovido (desempate por UUID); excluir o último é permitido. Transações bloqueiam a linha do comprador e revalidam a sessão antes da escrita. Índice único composto com coluna gerada default_slot impede dois padrões no banco, compatível com MariaDB local. Todos os escritores devem manter o bloqueio por comprador.

## Verificação

npm run test:profile usa DATABASE_TEST_ADMIN_URL para criar/remover schema efêmero. São 16 verificações HTTP/MySQL: origem/sessão, perfil persistido, campos extras/e-mail protegido, validação, IDOR, lojas diferentes, concorrência de criação/padrão/exclusão, limite, revogação e reversão/reaplicação da migration. Integrado à CI MySQL 8.4; a execução local foi em MariaDB 10.6.12.

Build, tipos, lint, testes unitários/e2e, contratos e teste de fundação devem passar. Revisão da loja usa fixture local sem conta real ou e-mail externo. Empresa, conexão MuiraSoft e SMTP continuam pendentes, sem impedir esta etapa.

Validação local concluída: build/tipos/lint; 69 testes unitários; 7 e2e; 6 contratos; 10 verificações de fundação e 16 de perfil/endereço. Loja com build e revisão em 390px/1440px, claro/escuro, sem overflow horizontal, com gravação simulada por fixture temporária (removida após uso). Banco local atualizado e API reiniciada. Nenhum commit/push ou deploy.
