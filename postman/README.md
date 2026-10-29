# Validação local da fundação

## HTTP público

Com a API iniciada em desenvolvimento, banco desabilitado e integração MuiraSoft sem configuração:

```bash
postman collection run postman/collections/foundation.postman_collection.json \
  --env-var base_url=http://localhost:3000
```

A coleção verifica liveness 200, readiness 503 deliberado, rota desconhecida 404, JSON, request ID e ausência de campos de lojista/credenciais. Ela não cria recursos. Se as dependências estiverem configuradas, o cenário de readiness precisa de outro contrato de teste.

## Cliente MuiraSoft por HTTP real contra mock local

Após compilar a API:

```bash
npm run build
node test/integration/muirasoft-http.mjs
```

O harness inicia `postman mock run --no-history --port auto --output ndjson`, importa o cliente compilado e usa transporte HTTP real em loopback. Não carrega `.env`, não usa banco e não chama o MuiraSoft real. Credencial, empresa, canal, comprador e pedidos são fixtures sintéticas.

O mock foi gerado do snapshot OpenAPI proprietário e ajustado para o prefixo real `/integracao/v1` e exemplos válidos de `SEM_MOVIMENTO`. Os endpoints `/__control` e `/__stats` são exclusivos do teste local. Métodos não modelados retornam 501. O cenário de timeout após escrita guarda um pedido fictício antes de atrasar a resposta, permitindo observar que o cliente não repete a escrita automaticamente.

O teste confere o NDJSON em memória e o estado do mock para provar que contexto, catálogo e criação foram alcançados. Não versiona logs e encerra os processos em `finally`.

Esta execução foi validada com Postman CLI **1.69.0**, que oferece `postman mock run` e o comando legado `postman simulate run`. O comando novo `postman simulation` descrito nas skills exige uma versão posterior e não foi usado. A validação aqui é um mock HTTP local controlado; não é uma execução do comando novo de simulação.

Não houve busca de mock publicado do proprietário porque a sessão Postman estava desconectada. A fonte reutilizada foi o contrato proprietário disponível no checkout. Não houve publicação, implantação, criação de workspace ou gravação de histórico remoto.

Os resultados e limites da evidência ficam em [muirasoft.context.yaml](mocks/muirasoft/muirasoft.context.yaml). O mock demonstra o comportamento do cliente nos cenários exercitados; não certifica disponibilidade, credenciais ou dados de uma instalação real.
