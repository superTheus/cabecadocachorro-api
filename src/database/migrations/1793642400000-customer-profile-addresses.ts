import type { MigrationInterface, QueryRunner } from 'typeorm';
export class CustomerProfileAddresses1793642400000 implements MigrationInterface {
  name = 'CustomerProfileAddresses1793642400000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      "ALTER TABLE customers ADD phone VARCHAR(20) NOT NULL DEFAULT ''",
    );
    await q.query(`CREATE TABLE customer_addresses (
      id CHAR(36) NOT NULL PRIMARY KEY, customer_id CHAR(36) NOT NULL,
      label VARCHAR(50) NOT NULL, recipient VARCHAR(150) NOT NULL,
      postal_code CHAR(8) NOT NULL, street VARCHAR(150) NOT NULL, number VARCHAR(20) NOT NULL,
      complement VARCHAR(100) NOT NULL, district VARCHAR(100) NOT NULL,
      city VARCHAR(100) NOT NULL, state CHAR(2) NOT NULL,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      default_slot TINYINT GENERATED ALWAYS AS (CASE WHEN is_default = 1 THEN 1 ELSE NULL END) STORED,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      UNIQUE KEY uq_address_default (customer_id,default_slot),
      KEY idx_address_customer (customer_id),
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE customer_addresses');
    await q.query('ALTER TABLE customers DROP COLUMN phone');
  }
}
