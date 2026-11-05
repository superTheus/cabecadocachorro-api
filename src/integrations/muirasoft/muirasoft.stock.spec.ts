import { describe, it, expect } from 'vitest';
import { productResponse, orderDetailResponse } from './muirasoft.responses.js';
import { createOrderInput } from './muirasoft.validation.js';
const stock = {
  cadastrado: true,
  fisico: '3.0000',
  politica: 'RESERVA',
  reservado: '2.0000',
  disponivel_para_venda: '1.0000',
  consultado_em: '2026-11-02T12:00:00Z',
};
const product = {
  id: 1,
  descricao: 'Produto',
  controla_estoque: true,
  estoque: stock,
};
describe('Estoque pertence ao ERP', () => {
  it('aceita saldo e reserva calculados pelo MuiraSoft', () =>
    expect(productResponse(product).estoque).toEqual(stock));
  it('aceita produto sem controle sem inventar saldo ou reserva', () => {
    const p = productResponse({
      ...product,
      controla_estoque: false,
      estoque: {
        ...stock,
        fisico: null,
        reservado: null,
        disponivel_para_venda: null,
      },
    });
    expect(p.controla_estoque).toBe(false);
    expect(p.estoque.reservado).toBeNull();
  });
  it('envia apenas a escolha comercial de modalidade', () => {
    const p = {
      referencia_externa: 'ref',
      itens: [
        {
          id_produto: 1,
          quantidade: '2',
          preco: '50.00',
          modalidade: 'ENCOMENDA' as const,
        },
      ],
    };
    expect(createOrderInput(p)).toEqual(p);
  });
  it('não aceita campos de reserva/controle enviados no pedido', () => {
    expect(() =>
      createOrderInput({
        referencia_externa: 'ref',
        itens: [
          {
            id_produto: 1,
            quantidade: '2',
            preco: '50.00',
            controla_estoque: false,
          },
        ],
      } as never),
    ).toThrow();
  });
  it('projeta snapshots e estados das reservas sem campos internos', () => {
    const result = orderDetailResponse({
      id: 1,
      numero: 1,
      referencia_externa: 'ref',
      status: { codigo: 'aberto', nome: 'Aberto', tipo: 'FLUXO', stage: 1 },
      total: '50.00',
      versao: 1,
      estoque_politica: 'RESERVA',
      cliente: null,
      itens: [
        {
          id_produto: 1,
          quantidade: '1',
          preco: '50.00',
          modalidade: 'ENCOMENDA',
          prazo_producao_dias: 7,
          loja_snapshot: {
            titulo: 'Original',
            descricao: 'Texto',
            categoria: 'Camisetas',
            imagens: [],
            grupo_variacao: null,
            cor: '',
            tamanho: '',
            controla_estoque: true,
            interno: 'segredo',
          },
        },
      ],
      fluxo: [],
      historico: [],
      reservas: [
        {
          id_item: 1,
          quantidade: '1.0000',
          estado: 'EXPIRADA',
          expira_em: '2026-11-02T12:00:00Z',
          id_conta: 99,
        },
      ],
      estoque_saida_em: null,
      entrega_tipo: null,
    });
    expect(result.itens[0].loja_snapshot?.titulo).toBe('Original');
    expect(result.itens[0].loja_snapshot).not.toHaveProperty('interno');
    expect(result.reservas?.[0]).not.toHaveProperty('id_conta');
  });
});
