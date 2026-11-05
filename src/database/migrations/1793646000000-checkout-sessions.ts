import type { MigrationInterface, QueryRunner } from 'typeorm';
export class CheckoutSessions1793646000000 implements MigrationInterface {
  name = 'CheckoutSessions1793646000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE checkout_sessions (
   id CHAR(36) NOT NULL PRIMARY KEY,store_id VARCHAR(100) NOT NULL,customer_id CHAR(36) NOT NULL,
   idempotency_key VARCHAR(100) NOT NULL,fingerprint CHAR(64) NOT NULL,payload_cipher MEDIUMTEXT NOT NULL,
   quote_id CHAR(32) NULL,review_cipher MEDIUMTEXT NULL,upstream_order_id BIGINT UNSIGNED NULL,
   created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
   UNIQUE KEY uq_checkout_key(store_id,idempotency_key),KEY idx_checkout_customer(customer_id,created_at),
   FOREIGN KEY(customer_id) REFERENCES customers(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`);
    await q.query(`CREATE TABLE checkout_payment_intents (
   id CHAR(36) NOT NULL PRIMARY KEY,checkout_id CHAR(36) NOT NULL,idempotency_key VARCHAR(100) NOT NULL,
   method VARCHAR(12) NOT NULL,installments TINYINT NOT NULL,upstream_payment_id BIGINT UNSIGNED NULL,
   state VARCHAR(24) NOT NULL DEFAULT 'SENDING',created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
   UNIQUE KEY uq_checkout_payment_key(checkout_id,idempotency_key),FOREIGN KEY(checkout_id) REFERENCES checkout_sessions(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE checkout_payment_intents');
    await q.query('DROP TABLE checkout_sessions');
  }
}
