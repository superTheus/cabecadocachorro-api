/** Server-side DTOs matching the MuiraSoft integration v1 contract. */
export type MuiraSoftScope =
  'produtos:ler' | 'pedidos:criar' | 'pedidos:ler' | 'pedidos:cancelar';

export interface MuiraSoftConnection {
  nome: string;
  empresa: number;
  canal: string;
  origem: 'LOJA_VIRTUAL' | 'MARKETPLACE' | 'API' | 'INTEGRACAO';
  escopos: MuiraSoftScope[];
  estoque_politica: 'SEM_MOVIMENTO';
}

export interface MuiraSoftProduct {
  id: number;
  descricao: string;
  unidade?: string | null;
  ean?: string | null;
  controla_estoque?: boolean;
  kit?: boolean;
  preco_venda?: string | null;
  estoque: {
    cadastrado: boolean;
    fisico: string | null;
    politica: 'SEM_MOVIMENTO';
    reservado: null;
    disponivel_para_venda: null;
    consultado_em: string;
    versao?: number | null;
  };
}

export interface MuiraSoftProductFilter {
  busca?: string;
  ean?: string;
  cursor?: number;
  limit?: number;
}

export interface MuiraSoftProductPage {
  data: MuiraSoftProduct[];
  next_cursor: string | null;
}

export interface MuiraSoftCustomer {
  referencia_externa: string;
  nome: string;
  email?: string;
  documento?: string;
  telefone?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  complemento?: string;
  cidade?: string;
  estado?: string;
  codigo_municipio?: string;
  inscricao_estadual?: string;
}

export interface MuiraSoftOrderItemInput {
  id_produto: number;
  quantidade: string;
  preco: string;
  desconto_real?: string;
  desconto_percentual?: string;
  acrescimo?: string;
}

/** These are planned payment conditions, never proof of a received payment. */
export interface MuiraSoftPlannedPayment {
  id_forma: number;
  id_condicao_pagamento?: number | null;
  valor: string;
  parcelas?: number;
  primeiro_vencimento?: string | null;
}

/** Build prices and buyer reference on the server before invoking this adapter. */
export interface MuiraSoftCreateOrder {
  referencia_externa: string;
  cliente?: MuiraSoftCustomer | null;
  itens: MuiraSoftOrderItemInput[];
  pagamentos?: MuiraSoftPlannedPayment[];
  observacao?: string;
}

export interface MuiraSoftStatus {
  codigo: string;
  nome: string;
  tipo: 'FLUXO' | 'ESPECIAL' | 'CANCELAMENTO';
  stage: number | null;
}

export interface MuiraSoftOrder {
  id: number;
  numero: number;
  referencia_externa: string;
  status: MuiraSoftStatus;
  total: string;
  versao: number;
  origem?: MuiraSoftConnection['origem'];
  canal?: string;
  total_desconto?: string;
  total_acrescimo?: string;
  criado_em?: string;
  atualizado_em?: string;
  cancelado_em?: string | null;
  estoque_politica?: 'SEM_MOVIMENTO';
}

export interface MuiraSoftOrderDetail extends MuiraSoftOrder {
  cliente: MuiraSoftCustomer | null;
  itens: Array<
    Omit<MuiraSoftOrderItemInput, 'desconto_percentual'> & {
      descricao?: string;
      total?: string;
    }
  >;
  fluxo: MuiraSoftStatus[];
  historico: Array<{
    anterior: MuiraSoftStatus | null;
    novo: MuiraSoftStatus;
    data: string;
    observacao: string | null;
  }>;
}

export interface MuiraSoftOrderFilter {
  referencia_externa?: string;
  numero?: number;
  status?: string;
  stage?: number;
  data_inicio?: string;
  data_fim?: string;
  limit?: number;
  offset?: number;
}

export interface MuiraSoftOrderPage {
  data: MuiraSoftOrder[];
  total: number;
  limit: number;
  offset: number;
}

export interface MuiraSoftCancelOrder {
  motivo: string;
  versao: number;
}
