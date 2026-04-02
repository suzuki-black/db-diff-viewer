-- ============================================================
-- SSHポートフォワード経由アクセス用テストDB
-- このDBはホストから直接アクセスできない（ポート未公開）
-- SSH トンネル経由でのみ接続可能なことを確認するためのDB
-- ============================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE DATABASE IF NOT EXISTS testdb_ssh CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE testdb_ssh;

CREATE TABLE categories (
    id         INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    sort_order INT          NOT NULL DEFAULT 0,
    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO categories (id, name, sort_order) VALUES
(1, 'Electronics',  1),
(2, 'Clothing',     2),
(3, 'Food',         3),
(4, 'Books',        4),
(5, 'Sports',       5);

CREATE TABLE products (
    id          INT            NOT NULL AUTO_INCREMENT PRIMARY KEY,
    category_id INT            NOT NULL,
    name        VARCHAR(200)   NOT NULL,
    price       DECIMAL(10, 2) NOT NULL,
    stock       INT            NOT NULL DEFAULT 0,
    created_at  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO products (category_id, name, price, stock) VALUES
(1, 'Laptop Pro 15',     129800.00, 50),
(1, 'Wireless Mouse',      2980.00, 200),
(2, 'Cotton T-Shirt',      1980.00, 300),
(3, 'Organic Green Tea',    980.00, 150),
(4, 'Learning Python',     3200.00, 80);

-- SSH接続テスト確認用テーブル
CREATE TABLE ssh_connection_test (
    id         INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    message    VARCHAR(255) NOT NULL,
    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO ssh_connection_test (message) VALUES
('このレコードが見えればSSHポートフォワードは正常に動作しています');
