import { describe, it, expect } from 'vitest';
import { orderRequestInput } from './orders.domain.js';
import {
  trackingOrder,
  trackingPage,
} from '../integrations/muirasoft/muirasoft.tracking.js';
const now = '2026-11-02T12:00:00.000Z',
  id = 'a'.repeat(32);
const order = () => ({
  id,
  number: 1,
  created_at: now,
  updated_at: now,
  canceled_at: null,
  status: 'PRONTO',
  status_label: 'Pronto',
  commercial_status: 'Atendimento',
  total: '112.50',
  item_count: 1,
  production_days: 7,
  checkout_reference: null,
  subtotal: '100.00',
  freight: '12.50',
  items: [
    {
      id: 'item_1',
      name: 'Produto comprado',
      color: 'Verde',
      size: 'M',
      image: 'https://example.test/item.png',
      quantity: '1.0000',
      unit_price: '100.00',
      total: '100.00',
      fulfillment: 'ENCOMENDA',
      production_days: 7,
    },
  ],
  delivery: null,
  documents: [],
  payments: [],
  timeline: [],
  requests: [],
  can_request_cancellation: true,
  can_request_return: false,
  synced_at: now,
});
describe('acompanhamento do comprador', () => {
  it('normaliza quantidades e ordem antes da idempotência', () => {
    expect(
      orderRequestInput({
        type: 'RETURN',
        message: ' Pedido ',
        items: [
          { id: 'item_2', quantity: '1.5' },
          { id: 'item_1', quantity: '2' },
        ],
      }),
    ).toEqual({
      type: 'RETURN',
      message: 'Pedido',
      items: [
        { id: 'item_1', quantity: '2.0000' },
        { id: 'item_2', quantity: '1.5000' },
      ],
    });
  });
  it('não aceita controle de conta, campos desconhecidos ou quantidade nula', () => {
    expect(() =>
      orderRequestInput({
        type: 'SUPPORT',
        message: 'Teste',
        customer_id: 'outro',
      }),
    ).toThrow();
    expect(() =>
      orderRequestInput({
        type: 'RETURN',
        message: 'Teste',
        items: [{ id: 'item_1', quantity: '0' }],
      }),
    ).toThrow();
  });
  it('quantidades repetidas ou excesso de casas não passam', () => {
    expect(() =>
      orderRequestInput({
        type: 'RETURN',
        message: 'Teste',
        items: [
          { id: 'item_1', quantity: '1' },
          { id: 'item_1', quantity: '1' },
        ],
      }),
    ).toThrow();
    expect(() =>
      orderRequestInput({
        type: 'RETURN',
        message: 'Teste',
        items: [{ id: 'item_1', quantity: '0.00001' }],
      }),
    ).toThrow();
  });
  it('reconstrói a projeção sem campos administrativos', () => {
    const source = order();
    const parsed = trackingOrder(
      { ...source, id_conta: 1, api_key: 'segredo', observacao: 'interna' },
      id,
    );
    expect(parsed).toEqual(source);
  });
  it('valores e frete divergentes falham sem apresentar total fictício', () => {
    expect(() => trackingOrder({ ...order(), total: '112.49' }, id)).toThrow();
    expect(() =>
      trackingOrder({ ...order(), subtotal: '99.00' }, id),
    ).toThrow();
  });
  it('recusa outro pedido e imagens com credenciais', () => {
    expect(() => trackingOrder(order(), 'b'.repeat(32))).toThrow();
    const p = order();
    p.items[0].image = 'https://user:password@example.test/photo.png';
    expect(() => trackingOrder(p, id)).toThrow();
  });
  it('página não contém identificadores duplicados', () => {
    expect(() =>
      trackingPage({
        items: [order(), order()],
        next_cursor: null,
        synced_at: now,
      }),
    ).toThrow();
  });
  it('resposta pública remove observações e autores internos', () => {
    const p = {
      ...order(),
      requests: [
        {
          id: 'c'.repeat(32),
          type: 'SUPPORT',
          message: 'Mensagem',
          items: [],
          status: 'ANSWERED',
          created_at: now,
          updated_at: now,
          responses: [
            {
              status: 'ANSWERED',
              message: 'Resposta pública',
              created_at: now,
              observacao_interna: 'oculta',
              usuario: 'operador',
            },
          ],
        },
      ],
    };
    expect(trackingOrder(p, id).requests[0].responses[0]).toEqual({
      status: 'ANSWERED',
      message: 'Resposta pública',
      created_at: now,
    });
  });
});
