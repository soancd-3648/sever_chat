-- Schema for AIImageChat IAP / Points wallet
-- Compatible with MySQL 5.5+ (only one TIMESTAMP-with-default per table).

CREATE TABLE IF NOT EXISTS users (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    device_id       VARCHAR(128) NOT NULL UNIQUE,
    balance         INT NOT NULL DEFAULT 100,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS iap_service (
    id               BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id          INT NOT NULL,
    amount           INT NOT NULL,
    transaction_type ENUM('PURCHASE','USAGE','REFUND') NOT NULL,
    balance_before   INT NOT NULL,
    balance_after    INT NOT NULL,
    product_id       VARCHAR(64)  NULL,
    transaction_id   VARCHAR(128) NULL UNIQUE,
    platform         ENUM('IOS','ANDROID') NULL,
    note             VARCHAR(255) NULL,
    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_type (transaction_type)
);
