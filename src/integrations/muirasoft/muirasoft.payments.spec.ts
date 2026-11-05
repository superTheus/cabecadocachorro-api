import { describe, it, expect } from 'vitest';
import {
  paymentInput,
  paymentKey,
  paymentResponse,
  pixResponse,
} from './muirasoft.payments.js';
import { connectionResponse } from './muirasoft.responses.js';
const installment = {
  numero: 1,
  valor: '100.00',
  liquido: '98.00',
  estornado: '0.00',
  status_asaas: 'CONFIRMED',
  confirmado: 'S',
  disponivel: 'N',
  vencimento: '2026-11-02',
  credito_em: null,
};
const payment = {
  id: 1,
  id_pedido: 42,
  metodo: 'CREDIT_CARD',
  parcelas: 1,
  total: '100.00',
  estado: 'CRIADO',
  pago_em: '2026-11-02T12:00:00Z',
  revisao_estoque: false,
  erro_codigo: null,
  financeiro_codigo: null,
  estorno_estado: null,
  total_estornado: '0.00',
  liquido_recebido_acumulado: '0.00',
  cobrancas: [installment],
};
describe('Pagamentos controlados pelo ERP', () => {
  it('aceita os novos escopos somente se declarados pela conexão', () => {
    expect(
      connectionResponse({
        nome: 'Loja',
        empresa: 1,
        canal: 'loja',
        origem: 'LOJA_VIRTUAL',
        estoque_politica: 'RESERVA',
        escopos: [
          'produtos:ler',
          'pedidos:criar',
          'pedidos:ler',
          'pedidos:cancelar',
          'contas:email',
          'pagamentos:criar',
          'pagamentos:ler',
        ],
      }).escopos,
    ).toHaveLength(7);
  });
  it('Pix tem somente uma parcela', () => {
    expect(paymentInput({ metodo: 'PIX' })).toEqual({
      metodo: 'PIX',
      parcelas: 1,
    });
    expect(() => paymentInput({ metodo: 'PIX', parcelas: 2 })).toThrow();
  });
  it('comprador não informa valor nem ambiente', () => {
    expect(() => paymentInput({ metodo: 'PIX', total: '0.01' })).toThrow();
    expect(() =>
      paymentInput({ metodo: 'PIX', ambiente: 'PRODUCAO' }),
    ).toThrow();
  });
  it('cartão admite no máximo três parcelas', () => {
    expect(() =>
      paymentInput({ metodo: 'CREDIT_CARD', parcelas: 4 }),
    ).toThrow();
  });
  it('rejeita cartão inesperado sem incluir dados no erro', () => {
    try {
      paymentInput({ metodo: 'CREDIT_CARD', cartao: { number: 'sensitive' } });
      throw new Error('Não rejeitou');
    } catch (e) {
      expect(String(e)).not.toContain('sensitive');
      expect(String(e)).not.toContain('Não rejeitou');
    }
  });
  it('confirmação não inventa disponibilidade', () => {
    const p = paymentResponse(payment, 42);
    expect(p.pago_em).not.toBeNull();
    expect(p.liquido_recebido_acumulado).toBe('0.00');
  });
  it('resposta de outro pedido é recusada', () =>
    expect(() => paymentResponse(payment, 43)).toThrow());
  it('não repassa segredos nem identificadores do provedor', () => {
    expect(
      paymentResponse(
        { ...payment, api_key: 'hidden', cartao: { ccv: 'hidden' } },
        42,
      ),
    ).toEqual(payment);
  });
  it('parcelas incompletas não são aceitas', () =>
    expect(() => paymentResponse({ ...payment, parcelas: 3 }, 42)).toThrow());
  it('não aceita total ou líquido divergente', () => {
    expect(() => paymentResponse({ ...payment, total: '0.01' }, 42)).toThrow();
    expect(() =>
      paymentResponse({ ...payment, liquido_recebido_acumulado: '98.00' }, 42),
    ).toThrow();
  });
  it('Pix só permite imagem PNG e dados limitados', () => {
    expect(() =>
      pixResponse({
        imagem_base64: Buffer.from('<svg/>').toString('base64'),
        copia_cola: 'pix',
        expira_em: '2026-11-02',
      }),
    ).toThrow();
  });
  it('chave de pagamento admite UUID e rejeita caracteres de URL', () => {
    expect(paymentKey('01234567-89ab-cdef-0123-456789abcdef')).toBeTruthy();
    expect(() => paymentKey('../segredo?')).toThrow();
  });
});
