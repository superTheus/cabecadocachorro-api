import type { MigrationInterface, QueryRunner } from 'typeorm';
export class CustomerOrderRequests1793649600000 implements MigrationInterface {
  name = 'CustomerOrderRequests1793649600000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE customer_order_requests (
      id CHAR(36) NOT NULL PRIMARY KEY,store_id VARCHAR(100) NOT NULL,customer_id CHAR(36) NOT NULL,
      order_id CHAR(32) NOT NULL,idempotency_key VARCHAR(100) NOT NULL,fingerprint CHAR(64) NOT NULL,
      payload_cipher MEDIUMTEXT NOT NULL,state VARCHAR(12) NOT NULL DEFAULT 'PENDING',upstream_id CHAR(32) NULL,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      UNIQUE KEY uq_customer_order_request(store_id,customer_id,idempotency_key),
      KEY idx_customer_order_requests(store_id,customer_id,order_id,created_at),
      FOREIGN KEY(customer_id) REFERENCES customers(id),CHECK(state IN ('PENDING','SENT','REJECTED'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE customer_order_requests');
  }
}
