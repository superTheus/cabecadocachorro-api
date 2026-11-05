import { createHash } from 'node:crypto';
import { MuiraSoftError } from './muirasoft.error.js';
export type FiscalDocument = {
  id: string;
  model: 55 | 65;
  number: string;
  series: string;
  status: string;
  environment: 'HOMOLOGACAO' | 'PRODUCAO';
  authorized_at: string | null;
  downloadable: boolean;
};
function invalid(): never {
  throw new MuiraSoftError(
    'MUIRASOFT_INVALID_RESPONSE',
    502,
    'Documento fiscal indisponível.',
  );
}
export function fiscalDocuments(v: unknown): FiscalDocument[] {
  if (!Array.isArray(v) || v.length > 20) invalid();
  const out: FiscalDocument[] = [];
  for (const value of v) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
    const p = value as Record<string, unknown>;
    if (
      typeof p.id !== 'string' ||
      !/^[a-f0-9]{32}$/u.test(p.id) ||
      !([55, 65] as unknown[]).includes(p.model) ||
      typeof p.number !== 'string' ||
      !/^\d{0,20}$/u.test(p.number) ||
      typeof p.series !== 'string' ||
      !/^\d{0,10}$/u.test(p.series) ||
      ![
        'AUTORIZADO',
        'CANCELADO',
        'REJEITADO',
        'DENEGADO',
        'PROCESSANDO',
        'AGUARDANDO_CONSULTA',
        'PENDENTE',
      ].includes(p.status as string) ||
      !['HOMOLOGACAO', 'PRODUCAO'].includes(p.environment as string) ||
      typeof p.downloadable !== 'boolean' ||
      (p.downloadable && p.status !== 'AUTORIZADO') ||
      (p.authorized_at !== null &&
        (typeof p.authorized_at !== 'string' ||
          !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/u.test(
            p.authorized_at,
          ) ||
          !Number.isFinite(Date.parse(p.authorized_at))))
    )
      invalid();
    out.push({
      id: p.id,
      model: p.model as 55 | 65,
      number: p.number,
      series: p.series,
      status: p.status as string,
      environment: p.environment as FiscalDocument['environment'],
      authorized_at: p.authorized_at as string | null,
      downloadable: p.downloadable,
    });
  }
  if (new Set(out.map((i) => i.id)).size !== out.length) invalid();
  return out;
}
export function fiscalFile(v: unknown, id: string, format: 'pdf' | 'xml') {
  if (!v || typeof v !== 'object' || Array.isArray(v)) invalid();
  const p = v as Record<string, unknown>,
    mime = format === 'pdf' ? 'application/pdf' : 'application/xml',
    filename = `nota-fiscal-${id}.${format}`,
    max = format === 'pdf' ? 4194304 : 2097152;
  if (
    p.mime !== mime ||
    p.filename !== filename ||
    typeof p.content_base64 !== 'string' ||
    p.content_base64.length > 4 * Math.ceil(max / 3) ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(p.content_base64) ||
    typeof p.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(p.sha256)
  )
    invalid();
  const content = Buffer.from(p.content_base64, 'base64');
  if (
    content.length > max ||
    createHash('sha256').update(content).digest('hex') !== p.sha256
  )
    invalid();
  if (
    format === 'pdf' &&
    (!content.subarray(0, 5).equals(Buffer.from('%PDF-')) ||
      !content.subarray(-2048).includes(Buffer.from('%%EOF')))
  )
    invalid();
  if (format === 'xml') {
    const text = content.toString('utf8');
    if (
      /<!DOCTYPE|<!ENTITY/iu.test(text) ||
      !text.includes('http://www.portalfiscal.inf.br/nfe')
    )
      invalid();
  }
  return { filename, mime, content };
}
