import type { MigrationInterface, QueryRunner } from 'typeorm';
export class CustomerAccounts1793383200000 implements MigrationInterface {
  name = 'CustomerAccounts1793383200000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE customers (
      id CHAR(36) NOT NULL PRIMARY KEY, store_id VARCHAR(100) NOT NULL,
      email VARCHAR(254) NOT NULL, name VARCHAR(150) NOT NULL, password_hash VARCHAR(255) NOT NULL,
      verified_at DATETIME(6) NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      UNIQUE KEY uq_customer_email(store_id,email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`);
    await q.query(`CREATE TABLE customer_sessions (
      token_hash CHAR(64) NOT NULL PRIMARY KEY, customer_id CHAR(36) NOT NULL,
      expires_at DATETIME(6) NOT NULL, FOREIGN KEY(customer_id) REFERENCES customers(id),
      KEY idx_session_customer(customer_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`);
    await q.query(`CREATE TABLE customer_tokens (
      token_hash CHAR(64) NOT NULL PRIMARY KEY, customer_id CHAR(36) NOT NULL,
      purpose VARCHAR(20) NOT NULL, expires_at DATETIME(6) NOT NULL, used_at DATETIME(6) NULL,
      FOREIGN KEY(customer_id) REFERENCES customers(id), KEY idx_token_customer(customer_id,purpose)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`);
    await q.query(`CREATE TABLE customer_mail_outbox (
      id CHAR(36) NOT NULL PRIMARY KEY, store_id VARCHAR(100) NOT NULL, payload_cipher TEXT NOT NULL, expires_at DATETIME(6) NOT NULL,
      state VARCHAR(20) NOT NULL DEFAULT 'PENDING', attempts INT NOT NULL DEFAULT 0,
      next_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), lease_until DATETIME(6) NULL,
      lease CHAR(64) NULL, last_error VARCHAR(150) NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      KEY idx_customer_mail(state,next_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`);
    await q.query(`CREATE TABLE customer_rate_limits (
      bucket CHAR(64) NOT NULL, window_id BIGINT NOT NULL, attempts INT NOT NULL, expires_at BIGINT NOT NULL,
      PRIMARY KEY(bucket,window_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`);
  }
  async down(q: QueryRunner): Promise<void> {
    for (const table of [
      'customer_rate_limits',
      'customer_mail_outbox',
      'customer_tokens',
      'customer_sessions',
      'customers',
    ])
      await q.query('DROP TABLE ' + table);
  }
}
