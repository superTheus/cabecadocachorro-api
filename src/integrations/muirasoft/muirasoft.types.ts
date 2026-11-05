/** Server-side DTOs matching the MuiraSoft integration v1 contract. */
export type MuiraSoftScope =
  | 'produtos:ler'
  | 'pedidos:criar'
  | 'pedidos:ler'
  | 'pedidos:cancelar'
  | 'contas:email'
  | 'pagamentos:criar'
  | 'pagamentos:ler'
  | 'checkout:criar'
  | 'checkout:ler';

export interface MuiraSoftConnection {
  nome: string;
  empresa: number;
  canal: string;
  origem: 'LOJA_VIRTUAL' | 'MARKETPLACE' | 'API' | 'INTEGRACAO';
  escopos: MuiraSoftScope[];
  estoque_politica: 'SEM_MOVIMENTO' | 'RESERVA';
}

export interface MuiraSoftProductPublication {
  titulo: string;
  descricao: string;
  categoria: string;
  imagens: string[];
  grupo_variacao: string | null;
  cor: string;
  tamanho: string;
  modalidade: 'PRONTA_ENTREGA' | 'ENCOMENDA' | 'MISTA';
  prazo_dias: number | null;
}
export interface MuiraSoftProduct {
  /** Optional presentation overrides; ordinary products are available automatically. */
  loja?: MuiraSoftProductPublication | null;
  categoria?: string | null;
  imagens?: { id: number }[];
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
    politica: 'SEM_MOVIMENTO' | 'RESERVA';
    reservado: string | null;
    disponivel_para_venda: string | null;
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
  modalidade?: 'PRONTA_ENTREGA' | 'ENCOMENDA';
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
  estoque_politica?: 'SEM_MOVIMENTO' | 'RESERVA';
}

export interface MuiraSoftOrderDetail extends MuiraSoftOrder {
  reservas?: Array<{
    id_item: number;
    quantidade: string;
    estado: string;
    expira_em: string | null;
  }>;
  estoque_saida_em?: string | null;
  entrega_tipo?: 'EXPEDICAO' | 'RETIRADA' | null;
  cliente: MuiraSoftCustomer | null;
  itens: Array<
    Omit<MuiraSoftOrderItemInput, 'desconto_percentual'> & {
      loja_snapshot?: {
        titulo: string;
        descricao: string;
        categoria: string;
        imagens: string[];
        grupo_variacao: string | null;
        cor: string;
        tamanho: string;
        controla_estoque: boolean;
      } | null;
      prazo_producao_dias?: number | null;
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
