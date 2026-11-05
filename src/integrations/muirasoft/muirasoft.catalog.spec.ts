import { describe, it, expect } from 'vitest';
import { productResponse } from './muirasoft.responses.js';
import { groupProducts } from '../../catalog/catalog.domain.js';
const stock = {
  cadastrado: true,
  fisico: '1.0000',
  politica: 'SEM_MOVIMENTO',
  reservado: null,
  disponivel_para_venda: null,
  consultado_em: '2026-11-02T12:00:00Z',
};
const publication = {
  titulo: 'Camiseta',
  descricao: 'Algodão',
  categoria: 'Camisetas',
  imagens: ['https://images.example.test/a.jpg'],
  grupo_variacao: 'camiseta',
  cor: 'Preta',
  tamanho: 'M',
  modalidade: 'ENCOMENDA',
  prazo_dias: 7,
};
const product = {
  id: 1,
  descricao: 'Camiseta M',
  estoque: stock,
  loja: publication,
};
describe('Catálogo publicado do ERP', () => {
  it('aceita produto não publicado sem derrubar o catálogo público', () => {
    const unpublished = productResponse({ ...product, loja: null });
    expect(unpublished.loja).toBeNull();
    expect(groupProducts([unpublished])).toEqual([]);
  });
  it('mantém os publicados quando a API também retorna produtos não publicados', () => {
    const unpublished = productResponse({ ...product, loja: null });
    const published = productResponse({ ...product, id: 2, controla_estoque: false, preco_venda: '80.00' });
    const catalog = groupProducts([unpublished, published]);
    expect(catalog).toHaveLength(1);
    expect(catalog[0].variants.map((variant) => variant.sku_id)).toEqual([2]);
  });
  it('preserva publicação e projeta apenas campos declarados', () => {
    const result = productResponse({
      ...product,
      loja: { ...publication, id_conta: 99 },
      preco_custo: '1.00',
    });
    expect(result.loja).toEqual(publication);
    expect(result).not.toHaveProperty('preco_custo');
  });
  it.each([
    { imagens: [] },
    { imagens: ['http://example.test/a.jpg'] },
    { imagens: ['https://u:p@example.test/a.jpg'] },
    { modalidade: 'INVALIDA' },
    { prazo_dias: 366 },
    { prazo_dias: null },
    { modalidade: 'PRONTA_ENTREGA', prazo_dias: 7 },
  ])('recusa publicação inconsistente: %j', (change) => {
    expect(() =>
      productResponse({ ...product, loja: { ...publication, ...change } }),
    ).toThrow();
  });
  it('aceita pronta entrega sem prazo de produção', () =>
    expect(
      productResponse({
        ...product,
        loja: {
          ...publication,
          modalidade: 'PRONTA_ENTREGA',
          prazo_dias: null,
        },
      }).loja?.prazo_dias,
    ).toBeNull());
});
