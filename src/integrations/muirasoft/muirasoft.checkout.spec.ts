import { describe, it, expect } from 'vitest';
import { quoteResponse } from './muirasoft.checkout.js';
const quote = {
  id: 'a'.repeat(32),
  expira_em: '2026-11-02T23:00:00Z',
  id_pedido: 1,
  numero_pedido: '1001',
  revisao: {
    cliente: {
      nome: 'Fixture',
      email: 'fixture@example.test',
      documento_final: '7735',
      documento: 'não-projetar',
    },
    endereco: {
      recipient: 'Fixture',
      postal_code: '69000000',
      street: 'Rua fixture',
      number: '1',
      complement: '',
      district: 'Centro',
      city: 'Manaus',
      state: 'AM',
    },
    entrega: {
      tipo: 'ENTREGA',
      nome: 'Área fixture',
      taxa: '12.50',
      prazo_dias: 2,
      endereco: null,
      instrucoes: null,
    },
    itens: [
      {
        sku_id: 1,
        titulo: 'Produto',
        cor: 'Verde',
        tamanho: 'M',
        imagem: 'https://images.example.test/sku.png',
        quantidade: 1,
        preco: '100.00',
        total: '100.00',
        modalidade: 'PRONTA_ENTREGA',
        prazo_producao_dias: null,
      },
    ],
    subtotal: '100.00',
    frete: '12.50',
    total: '112.50',
    prazo_producao_dias: 0,
    atendimento_conjunto: true,
  },
};
describe('Contrato de checkout remoto', () => {
  it('projeta revisão sem documento completo ou campos extras', () => {
    const p = quoteResponse({ ...quote, api_key: 'segredo' });
    expect(p.revisao.total).toBe('112.50');
    expect(JSON.stringify(p)).not.toContain('segredo');
    expect(JSON.stringify(p)).not.toContain('não-projetar');
  });
  it('recusa total ou frete divergentes', () => {
    expect(() =>
      quoteResponse({ ...quote, revisao: { ...quote.revisao, total: '0.01' } }),
    ).toThrow();
    expect(() =>
      quoteResponse({
        ...quote,
        revisao: { ...quote.revisao, frete: '0.00', total: '100.00' },
      }),
    ).toThrow();
  });
  it('recusa linha cujo preço não corresponde à quantidade', () => {
    expect(() =>
      quoteResponse({
        ...quote,
        revisao: {
          ...quote.revisao,
          itens: [{ ...quote.revisao.itens[0], quantidade: 2 }],
        },
      }),
    ).toThrow();
  });
  it('não aceita imagem executável nem revisão sem itens', () => {
    expect(() =>
      quoteResponse({
        ...quote,
        revisao: {
          ...quote.revisao,
          itens: [{ ...quote.revisao.itens[0], imagem: 'javascript:alert(1)' }],
        },
      }),
    ).toThrow();
    expect(() =>
      quoteResponse({ ...quote, revisao: { ...quote.revisao, itens: [] } }),
    ).toThrow();
  });
});
