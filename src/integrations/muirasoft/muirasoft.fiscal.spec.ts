import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { fiscalDocuments, fiscalFile } from './muirasoft.fiscal.js';
const id = 'a'.repeat(32),
  content = Buffer.from('%PDF-1.4\nDocumento sintético\n%%EOF');
const file = () => ({
  filename: `nota-fiscal-${id}.pdf`,
  mime: 'application/pdf',
  content_base64: content.toString('base64'),
  sha256: createHash('sha256').update(content).digest('hex'),
});
describe('documentos fiscais do comprador', () => {
  it('valida bytes e hash antes de entregar PDF', () => {
    expect(fiscalFile(file(), id, 'pdf').content).toEqual(content);
  });
  it('não aceita caminho livre, MIME trocado ou hash diferente', () => {
    expect(() =>
      fiscalFile({ ...file(), filename: '../../segredo.pdf' }, id, 'pdf'),
    ).toThrow();
    expect(() =>
      fiscalFile({ ...file(), mime: 'text/html' }, id, 'pdf'),
    ).toThrow();
    expect(() =>
      fiscalFile({ ...file(), sha256: 'b'.repeat(64) }, id, 'pdf'),
    ).toThrow();
  });
  it('recusa HTML disfarçado de PDF mesmo com hash coerente', () => {
    const data = Buffer.from('<html/>');
    expect(() =>
      fiscalFile(
        {
          ...file(),
          content_base64: data.toString('base64'),
          sha256: createHash('sha256').update(data).digest('hex'),
        },
        id,
        'pdf',
      ),
    ).toThrow();
  });
  it('XML com entidade externa não passa para o navegador', () => {
    const data = Buffer.from(
      '<!DOCTYPE nfe [<!ENTITY xx SYSTEM "file:///private">]><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"/>',
    );
    expect(() =>
      fiscalFile(
        {
          filename: `nota-fiscal-${id}.xml`,
          mime: 'application/xml',
          content_base64: data.toString('base64'),
          sha256: createHash('sha256').update(data).digest('hex'),
        },
        id,
        'xml',
      ),
    ).toThrow();
  });
  it('metadados removem campos privados e bloqueiam cancelados baixáveis', () => {
    const d = {
      id,
      model: 55,
      number: '1',
      series: '1',
      status: 'AUTORIZADO',
      environment: 'HOMOLOGACAO',
      authorized_at: '2026-11-02T12:00:00.000Z',
      downloadable: true,
    };
    expect(
      fiscalDocuments([{ ...d, xml: 'privado', token_publico: 'segredo' }]),
    ).toEqual([d]);
    expect(() => fiscalDocuments([{ ...d, status: 'CANCELADO' }])).toThrow();
  });
});
