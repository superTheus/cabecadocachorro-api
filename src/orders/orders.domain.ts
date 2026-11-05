/* eslint-disable no-control-regex -- Campos públicos rejeitam caracteres de controle. */
import { BadRequestException } from '@nestjs/common';
import { fields, object } from '../catalog/catalog.domain.js';
export type OrderRequestInput = {
  type: 'CANCELLATION' | 'RETURN' | 'SUPPORT';
  message: string;
  items: { id: string; quantity: string }[];
};
export function orderRequestInput(v: unknown): OrderRequestInput {
  const b = object(v);
  fields(b, ['type', 'message', 'items']);
  if (
    !['CANCELLATION', 'RETURN', 'SUPPORT'].includes(b.type as string) ||
    typeof b.message !== 'string' ||
    !b.message.trim() ||
    b.message.trim().length > 1000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(b.message)
  )
    throw new BadRequestException();
  const list = b.items ?? [];
  if (
    !Array.isArray(list) ||
    list.length > 30 ||
    (b.type === 'RETURN' && !list.length) ||
    (b.type !== 'RETURN' && list.length)
  )
    throw new BadRequestException();
  const items = list
    .map((v) => {
      const i = object(v);
      fields(i, ['id', 'quantity']);
      if (
        typeof i.id !== 'string' ||
        !/^item_[1-9]\d{0,18}$/u.test(i.id) ||
        typeof i.quantity !== 'string' ||
        !/^\d{1,14}(\.\d{1,4})?$/u.test(i.quantity)
      )
        throw new BadRequestException();
      const [whole, decimal = ''] = i.quantity.split('.');
      const quantity = BigInt(whole) * 10000n + BigInt(decimal.padEnd(4, '0'));
      if (quantity <= 0n) throw new BadRequestException();
      return {
        id: i.id,
        quantity:
          (quantity / 10000n).toString() +
          '.' +
          (quantity % 10000n).toString().padStart(4, '0'),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(items.map((i) => i.id)).size !== items.length)
    throw new BadRequestException();
  return {
    type: b.type as OrderRequestInput['type'],
    message: b.message.trim(),
    items,
  };
}
