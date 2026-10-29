import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const metadataPath = new URL('contracts/muirasoft/provenance.json', root);
const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
const bytes = await readFile(new URL(metadata.snapshot_path, root));
if (createHash('sha256').update(bytes).digest('hex') !== metadata.sha256) {
  throw new Error(
    'Snapshot mudou: revise o contrato proprietário e a proveniência antes de gerar a cópia para ferramentas.',
  );
}
const spec = JSON.parse(bytes.toString('utf8'));
const changes = [];
function normalize(value, path = '#') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value.required) && value.required.length === 0) {
    delete value.required;
    changes.push(path + '/required');
  }
  for (const [key, item] of Object.entries(value))
    normalize(item, path + '/' + key.replace(/~/g, '~0').replace(/\//g, '~1'));
}
normalize(spec);
const target = 'contracts/muirasoft/integracoes-v1.tooling.openapi.json';
const output = JSON.stringify(spec, null, 2) + '\n';
await writeFile(new URL(target, root), output);
metadata.tooling_snapshot_path = target;
metadata.tooling_sha256 = createHash('sha256').update(output).digest('hex');
metadata.tooling_transform = {
  description:
    'Remover somente required: []: lista vazia e ausência da propriedade têm o mesmo significado, mas OpenAPI 3.0 exige ao menos um item quando required é declarado. Nenhuma operação ou obrigação nova.',
  removed_empty_required: changes,
};
await writeFile(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
console.log(
  `Contrato para ferramentas gerado: ${changes.length} listas required vazias removidas; original preservado.`,
);
