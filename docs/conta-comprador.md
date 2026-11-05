# Etapa 4 — contrato de conta do comprador

A API NestJS é a autoridade da conta. O MuiraSoft só entrega mensagens por modelos autorizados; credenciais de funcionários não autenticam compradores. Não associar pedidos anteriores por e-mail: uma referência comercial UUID estável será usada em compras novas.

Prefixo `/api/v1/auth`: POST `/register` (nome, email, senha); POST `/login` (email, senha); GET `/me`; POST `/logout`; POST `/forgot-password` (email); POST `/resend-verification` (email); POST `/verify-email` (token); POST `/reset-password` (token, senha). Corpos não aceitam campos adicionais. Cadastro, recuperação e reenvio devolvem 202 com mensagem genérica. Login exige confirmação e devolve perfil seguro com cookie HttpOnly, SameSite=Lax, Secure em produção, sessão absoluta de sete dias. Logout revoga a sessão e limpa o cookie. Reset invalida todas as sessões e tokens de recuperação. Tokens aleatórios de uso único, com hash no banco, expiram em 24h (confirmação) e 30min (recuperação). POST `/change-password` (current_password, password) valida a senha atual, troca a senha e revoga todas as sessões.

Todas as escritas exigem Origin da loja configurada; cookies não são armazenados no localStorage. Produção requer loja/API no mesmo site e HTTPS. Limites persistentes por IP e e-mail, senhas scrypt e erros sanitizados. Tokens em links ficam no fragmento, removido da URL assim que a tela abre. Nenhum GET confirma e-mail automaticamente.

Mensagens saem por outbox local cifrada e worker servidor-a-servidor para o MuiraSoft, com chave idempotente por evento. Falha no ERP não desfaz o cadastro. Não retornar token ou link nas respostas públicas. Expor somente estados gerais da solicitação. A área do cliente nesta etapa oferece identificação, confirmação, alteração de senha e logout; histórico e acompanhamento reais são etapas posteriores.


## Preparação e situação local

A empresa da loja ainda **não existe no MuiraSoft**, conforme informado pelo usuário. Não criar empresa ou vínculo fictício e não usar a conta de outro lojista. O banco próprio da API foi preparado localmente com usuário restrito a esse banco, duas migrações aplicadas e chave privada. `AUTH_ENABLED=true` está somente no `.env` local ignorado pelo Git. Nenhuma conta real foi criada nos testes.

Para outro ambiente, usar Node 24 e MySQL, configurar `DATABASE_URL`, aplicar `npm run db:migrate` e configurar `AUTH_ENABLED=true` e `AUTH_ENCRYPTION_KEY` (base64 de 32 bytes aleatórios). Preservar a chave em backup seguro e nos workers. `OBSERVE_ENABLED` deve ficar false ao habilitar a conta: a instrumentação atual não garante exclusão dos corpos com senhas e tokens. `STORE_URL` é a origem exata da loja; a loja usa `VITE_API_URL` apontando para a base `/api/v1`. Em produção, API e loja precisam estar no mesmo site, com HTTPS, por causa de cookies SameSite=Lax. O servidor ignora X-Forwarded-For não confiável; a política de proxy precisa ser revisada na implantação.

Quando a empresa estiver cadastrada:

1. Criar a conexão da loja nessa empresa e conceder explicitamente `contas:email` a uma conexão de administrador. Credenciais antigas não ganham esse escopo automaticamente. O frontend do MuiraSoft apresenta a opção no gerenciador de integrações.
2. Definir no ambiente do MuiraSoft `INTEGRATION_STORE_ORIGINS_JSON` como um objeto JSON de ID da conexão para origem da loja, por exemplo `{"50":"https://loja.example.com"}` (valores ilustrativos). A origem não vem do navegador ou do payload. HTTP só é permitido para loopback com a opção local já existente.
3. Configurar os quatro campos privados `MUIRASOFT_BASE_URL`, `MUIRASOFT_TOKEN`, `MUIRASOFT_COMPANY_ID` e `MUIRASOFT_CHANNEL` na API. Conferir o contexto com `npm run integration:check` e persistir o vínculo com `npm run store:bind`, pelo fluxo já existente.
4. Configurar o SMTP no MuiraSoft e executar os dois workers: `npm run mail:process` na API envia solicitações ao ERP; `php bin/processar-emails.php 50` no backend do ERP executa SMTP. Agendamento contínuo pertence à infraestrutura; não foi instalado nesta entrega.
5. Para cadastros feitos antes dessa ativação, usar **Reenviar confirmação** na loja. Os links antigos expiram; não liberar contas manualmente nem ignorar a confirmação para testar.

Sem empresa/conexão, o worker da API recusa processar mensagens antes de reservar jobs ou consumir tentativas. Depois de configurado, conserva o UUID do evento em falhas para idempotência no ERP, com até dez tentativas e backoff. Tokens consumidos ou expirados são descartados; o envelope é apagado ao expirar ou após o ERP confirmar o enfileiramento. Falha de rede não cancela a conta. O MuiraSoft não retorna tokens e a loja não publica os links ou segredos em respostas HTTP.

## Testes e limites da entrega

`npm test` verifica criptografia, configuração e as regressões da fundação. `npm run test:e2e` cobre a fundação HTTP. `npm run test:auth` usa `DATABASE_TEST_ADMIN_URL` para criar/remover um schema efêmero e testar cadastro, confirmação concorrente, login, cookies, reset, troca de senha, logout, expiração, rate limiting, isolamento por loja e outbox. Também executa a coleção Postman local com seis asserções de rejeições seguras. Sem a variável, o teste de banco informa SKIP; não usa o banco real da loja. A CI executa esse cenário com MySQL isolado.

`npm run test:integration` verifica o cliente real contra o mock HTTP Postman local, incluindo envio de conta com contexto e Idempotency-Key. O backend MuiraSoft cobre validação do escopo, origem aprovada, prazo, modelos e deduplicação na suíte de e-mails. Não houve envio de e-mail externo nem chamada ao MuiraSoft real com credenciais de produção.

A loja foi validada com APIs interceptadas no navegador: cadastro, login, perfil, logout e confirmação por fragmento, em celular e desktop, com temas claro/escuro. O diálogo nativo mantém o foco e o fundo inerte. O padrão visual e a vitrine permanecem; um botão Minha conta ocupa o espaço do antigo botão de busca ainda sem funcionalidade.

Histórico de pedidos reais, endereços, checkout e conciliação com clientes antigos continuam nas respectivas etapas do plano. O UUID do comprador é a referência estável para futuras compras, sem vincular histórico automaticamente por e-mail.

Validação em 30/10/2026: API com 69 testes unitários, 7 cenários e2e da fundação, 24 verificações HTTP/MySQL de conta/outbox (incluindo seis asserções Postman), 10 verificações de migração e 14 cenários HTTP contra mock Postman, além de build, tipos, lint e seis testes de contratos. MuiraSoft: 121 verificações do módulo de e-mails, 15 HTTP e oito asserções Postman; frontend MuiraSoft com build e 43 testes. Loja com build e revisão visual/funcional em navegador.

## Atualização em 02/11/2026 — etapa 5

Perfil editável e CRUD de endereços foram implementados. São agora três migrations; ver [perfil e endereços](perfil-enderecos.md) para contrato, regras e testes. As contagens e pendências das seções anteriores registram a entrega histórica da etapa 4.

## Atualização em 02/11/2026 — etapa 13

Histórico, acompanhamento e solicitações por comprador foram implementados, preservando a referência estável e sem associação automática por e-mail/documento. São cinco migrations da API. Meus pedidos usa sessão verificada, snapshots da compra e projeção sem observações internas; ver [área do cliente e pedidos](area-cliente-pedidos.md). Download fiscal pertence à etapa 14. Revisão visual desta ampliação e homologação com empresa real continuam pendentes.
