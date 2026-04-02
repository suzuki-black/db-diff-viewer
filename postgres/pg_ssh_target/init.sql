-- ============================================================
-- SSHポートフォワード経由アクセス用テストPostgreSQL DB
-- このDBはホストから直接アクセスできない（ポート未公開）
-- SSH トンネル経由でのみ接続可能なことを確認するためのDB
-- ============================================================

CREATE TABLE categories (
    id         SERIAL       PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    sort_order INT          NOT NULL DEFAULT 0,
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO categories (id, name, sort_order) VALUES
(1, 'Electronics',  1),
(2, 'Clothing',     2),
(3, 'Food',         3),
(4, 'Books',        4),
(5, 'Sports',       5);
SELECT setval('categories_id_seq', 5);

CREATE TABLE products (
    id          SERIAL        PRIMARY KEY,
    category_id INT           NOT NULL REFERENCES categories(id),
    name        VARCHAR(200)  NOT NULL,
    price       NUMERIC(10,2) NOT NULL,
    stock       INT           NOT NULL DEFAULT 0,
    created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO products (category_id, name, price, stock) VALUES
(1, 'Laptop Pro 15',     129800.00, 50),
(1, 'Wireless Mouse',      2980.00, 200),
(2, 'Cotton T-Shirt',      1980.00, 300),
(3, 'Organic Green Tea',    980.00, 150),
(4, 'Learning Python',     3200.00, 80);

-- SSH接続テスト確認用テーブル
CREATE TABLE ssh_connection_test (
    id         SERIAL       PRIMARY KEY,
    message    VARCHAR(255) NOT NULL,
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO ssh_connection_test (message) VALUES
('このレコードが見えればSSHポートフォワードは正常に動作しています（PostgreSQL）');
