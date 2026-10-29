import { Table, TableForeignKey, TableUnique } from 'typeorm';
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** MySQL DDL requires a backup: a transaction does not undo CREATE TABLE. */
export class StoreIntegrationFoundation1793296800000 implements MigrationInterface {
  name = 'StoreIntegrationFoundation1793296800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'store_bindings',
        columns: [
          { name: 'id', type: 'varchar', length: '36', isPrimary: true },
          { name: 'store_id', type: 'varchar', length: '100' },
          { name: 'muirasoft_base_url', type: 'varchar', length: '2048' },
          { name: 'muirasoft_company_id', type: 'bigint', unsigned: true },
          { name: 'muirasoft_channel', type: 'varchar', length: '80' },
          {
            name: 'created_at',
            type: 'datetime',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
          },
          {
            name: 'updated_at',
            type: 'datetime',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
            onUpdate: 'CURRENT_TIMESTAMP(6)',
          },
        ],
        uniques: [
          new TableUnique({
            name: 'uq_store_binding_store',
            columnNames: ['store_id'],
          }),
        ],
        engine: 'InnoDB',
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'integration_operations',
        columns: [
          { name: 'id', type: 'varchar', length: '36', isPrimary: true },
          { name: 'store_binding_id', type: 'varchar', length: '36' },
          {
            name: 'operation',
            type: 'varchar',
            length: '64',
            charset: 'ascii',
            collation: 'ascii_bin',
          },
          {
            name: 'idempotency_key',
            type: 'varchar',
            length: '128',
            charset: 'ascii',
            collation: 'ascii_bin',
          },
          {
            name: 'payload_hash',
            type: 'char',
            length: '64',
            charset: 'ascii',
            collation: 'ascii_bin',
          },
          {
            name: 'status',
            type: 'varchar',
            length: '24',
            default: "'PENDING'",
          },
          {
            name: 'upstream_order_id',
            type: 'bigint',
            unsigned: true,
            isNullable: true,
          },
          {
            name: 'upstream_reference',
            type: 'varchar',
            length: '191',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'datetime',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
          },
          {
            name: 'updated_at',
            type: 'datetime',
            precision: 6,
            default: 'CURRENT_TIMESTAMP(6)',
            onUpdate: 'CURRENT_TIMESTAMP(6)',
          },
        ],
        uniques: [
          new TableUnique({
            name: 'uq_integration_operation_key',
            columnNames: ['store_binding_id', 'operation', 'idempotency_key'],
          }),
        ],
        foreignKeys: [
          new TableForeignKey({
            name: 'fk_integration_operation_binding',
            columnNames: ['store_binding_id'],
            referencedTableName: 'store_bindings',
            referencedColumnNames: ['id'],
            onDelete: 'RESTRICT',
            onUpdate: 'RESTRICT',
          }),
        ],
        engine: 'InnoDB',
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('integration_operations');
    await queryRunner.dropTable('store_bindings');
  }
}
