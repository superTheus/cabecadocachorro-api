import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import SwaggerParser from '@apidevtools/swagger-parser';

const root = new URL('../', import.meta.url);
const json = async (path) =>
  JSON.parse(await readFile(new URL(path, root), 'utf8'));
const publicSpec = await json('contracts/storefront.openapi.json');
const upstream = await json('contracts/muirasoft/integracoes-v1.openapi.json');

await test('OpenAPI público e cópia de interoperabilidade passam no validador completo', async () => {
  for (const path of [
    'contracts/storefront.openapi.json',
    'contracts/muirasoft/integracoes-v1.tooling.openapi.json',
  ]) {
    await SwaggerParser.validate(fileURLToPath(new URL(path, root)));
  }
});

await test('normalização para ferramentas modifica somente required vazio, com checksum próprio', async () => {
  const provenance = await json('contracts/muirasoft/provenance.json');
  const bytes = await readFile(new URL(provenance.tooling_snapshot_path, root));
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    provenance.tooling_sha256,
  );
  const expected = structuredClone(upstream);
  function removeEmptyRequired(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value.required) && !value.required.length)
      delete value.required;
    for (const item of Object.values(value)) removeEmptyRequired(item);
  }
  removeEmptyRequired(expected);
  assert.deepEqual(JSON.parse(bytes.toString('utf8')), expected);
});

function references(value, document) {
  if (!value || typeof value !== 'object') return;
  if ('$ref' in value) {
    assert.ok(value.$ref.startsWith('#/'), 'Referência remota inesperada.');
    const target = value.$ref
      .slice(2)
      .split('/')
      .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
      .reduce((node, part) => node?.[part], document);
    assert.ok(target, `Referência inexistente: ${value.$ref}`);
  }
  for (const item of Object.values(value)) references(item, document);
}

await test('contratos são OpenAPI e todas as referências locais resolvem', () => {
  for (const spec of [publicSpec, upstream]) {
    assert.equal(spec.openapi, '3.0.3');
    references(spec, spec);
  }
});
await test('superfície pública expõe vitrine projetada e revalidação sem pedidos da conexão', () => {
  assert.deepEqual(
    Object.keys(publicSpec.paths).sort(),
    [
      ...[
        'register',
        'login',
        'forgot-password',
        'resend-verification',
        'verify-email',
        'reset-password',
        'change-password',
        'logout',
        'me',
        'session',
      ].map((name) => '/api/v1/auth/' + name),
      '/api/v1/auth/profile',
      '/api/v1/auth/addresses',
      '/api/v1/auth/addresses/{id}',
      '/api/v1/auth/addresses/{id}/default',
      '/api/v1/health/live',
      '/api/v1/health/ready',
      '/api/v1/catalog/products',
      '/api/v1/catalog/images/{product}/{image}',
      '/api/v1/catalog/products/{id}',
      '/api/v1/cart/validate',
      '/api/v1/checkout/options',
      '/api/v1/checkout',
      '/api/v1/checkout/{id}',
      '/api/v1/checkout/{id}/confirm',
      '/api/v1/checkout/{id}/payments',
      '/api/v1/checkout/{id}/payments/{payment}/pix',
      '/api/v1/orders',
      '/api/v1/orders/{id}',
      '/api/v1/orders/{id}/documents/{document}/{format}',
      '/api/v1/orders/{id}/requests',
      '/api/v1/orders/{id}/requests/{request}/retry',
    ].sort(),
  );
  assert.ok(publicSpec.paths['/api/v1/health/ready'].get.responses['503']);
});
await test('snapshot do MuiraSoft preserva checksum e registra origem', async () => {
  const provenance = await json('contracts/muirasoft/provenance.json');
  const bytes = await readFile(new URL(provenance.snapshot_path, root));
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    provenance.sha256,
  );
  assert.equal(provenance.source_repository, 'muirasoft/back');
});
await test('contrato existente exige idempotência em criação e cancelamento', () => {
  for (const path of ['/pedidos', '/pedidos/{id}/cancelar']) {
    assert.ok(
      upstream.paths[path].post.parameters.some(
        (parameter) =>
          parameter.in === 'header' &&
          parameter.name === 'Idempotency-Key' &&
          parameter.required,
      ),
    );
  }
});
