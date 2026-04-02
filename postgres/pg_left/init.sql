-- ============================================================
-- テスト用PostgreSQL DB（左）: testdb_pg_left
-- 本番環境を想定したデータ（MySQLのdb_leftと同じ構造・データ）
-- ============================================================

-- ============================================================
-- categories テーブル（左右で完全一致）
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

-- ============================================================
-- users テーブル（右DBは phone カラムあり → 構造差分）
-- ============================================================
CREATE TABLE users (
    id         SERIAL       PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    email      VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO users (id, name, email, created_at) VALUES
(1, '山田 太郎',   'yamada@example.com',    '2024-01-10 09:00:00'),
(2, '鈴木 花子',   'suzuki@example.com',    '2024-01-12 10:30:00'),
(3, '田中 次郎',   'tanaka@example.com',    '2024-02-01 08:00:00'),
(4, '佐藤 三郎',   'sato@example.com',      '2024-02-15 11:00:00'),
(5, '高橋 四郎',   'takahashi@example.com', '2024-03-01 14:00:00'),
(6, '伊藤 五郎',   'ito@example.com',       '2024-03-10 09:30:00');
SELECT setval('users_id_seq', 6);

-- ============================================================
-- products テーブル
-- ============================================================
CREATE TABLE products (
    id          SERIAL          PRIMARY KEY,
    name        VARCHAR(200)    NOT NULL,
    price       NUMERIC(10,2)   NOT NULL,
    stock       INT             NOT NULL DEFAULT 0,
    category_id INT             NOT NULL,
    is_active   BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO products (id, name, price, stock, category_id, is_active) VALUES
(1,  'スマートフォン X1',  89800.00, 150,  1, TRUE),
(2,  'ワイヤレスイヤホン', 12800.00,  80,  1, TRUE),
(3,  'Tシャツ（白）',       2980.00, 300,  2, TRUE),
(4,  'ジーンズ（青）',      6980.00, 120,  2, TRUE),
(5,  '有機玄米 2kg',        1480.00, 500,  3, TRUE),
(6,  'Python入門書',        2860.00,  60,  4, TRUE),
(7,  'ランニングシューズ', 14800.00,  45,  5, TRUE),
(8,  'テニスラケット',     18000.00,  30,  5, TRUE);
SELECT setval('products_id_seq', 8);

-- ============================================================
-- orders テーブル（右DBは total_price カラムあり）
-- ============================================================
CREATE TABLE orders (
    id         SERIAL      PRIMARY KEY,
    user_id    INT         NOT NULL REFERENCES users(id),
    product_id INT         NOT NULL REFERENCES products(id),
    quantity   INT         NOT NULL DEFAULT 1,
    status     VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO orders (id, user_id, product_id, quantity, status, created_at) VALUES
(1,  1, 1, 1, 'completed', '2024-04-01 10:00:00'),
(2,  2, 3, 2, 'completed', '2024-04-02 11:00:00'),
(3,  3, 6, 1, 'shipped',   '2024-04-03 09:30:00'),
(4,  4, 2, 1, 'completed', '2024-04-05 14:00:00'),
(5,  5, 7, 1, 'pending',   '2024-04-10 16:00:00'),
(6,  1, 4, 3, 'completed', '2024-04-12 10:30:00'),
(7,  2, 8, 1, 'cancelled', '2024-04-15 13:00:00'),
(8,  4, 6, 2, 'shipped',   '2024-04-18 09:00:00');
SELECT setval('orders_id_seq', 8);

-- ============================================================
-- legacy_logs テーブル（左DBにのみ存在）
-- ============================================================
CREATE TABLE legacy_logs (
    id         SERIAL       PRIMARY KEY,
    action     VARCHAR(100) NOT NULL,
    user_id    INT,
    detail     TEXT,
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO legacy_logs (action, user_id, detail, created_at) VALUES
('LOGIN',   1, 'ログイン成功 IP:192.168.1.1',   '2024-01-10 09:00:05'),
('LOGIN',   2, 'ログイン成功 IP:192.168.1.2',   '2024-01-12 10:30:05'),
('LOGOUT',  1, NULL,                             '2024-01-10 18:00:00'),
('LOGIN',   3, 'ログイン成功 IP:10.0.0.5',       '2024-02-01 08:01:00'),
('UPDATE',  2, 'プロフィール更新',               '2024-02-20 15:30:00'),
('LOGIN',   4, 'ログイン成功 IP:192.168.1.10',   '2024-02-15 11:01:00'),
('DELETE',  3, 'アカウント削除リクエスト',       '2024-03-01 10:00:00'),
('LOGOUT',  4, NULL,                             '2024-02-15 18:30:00');

-- ============================================================
-- スキーマ差分テスト用テーブル群
-- ============================================================

-- (1) カラム型変更テスト: 左DB側定義
CREATE TABLE schema_test_column_types (
    id          SERIAL          PRIMARY KEY,
    price       NUMERIC(10,2)   NOT NULL,
    description VARCHAR(255),
    age         SMALLINT,
    code        CHAR(10)        NOT NULL DEFAULT '0000000000',
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO schema_test_column_types (price, description, age, code) VALUES
(1234.56, 'テスト商品A', 25, 'ITEM000001'),
(9999.99, 'テスト商品B', 30, 'ITEM000002'),
(  12.30, NULL,          18, 'ITEM000003');

-- (2) NULL制約変更テスト: 左DB側定義
CREATE TABLE schema_test_nullable (
    id          SERIAL       PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    middle_name VARCHAR(50)  NOT NULL,
    phone       VARCHAR(20)  NOT NULL,
    memo        TEXT,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO schema_test_nullable (name, middle_name, phone, memo) VALUES
('田中 一郎', '一', '090-0000-0001', 'メモA'),
('山田 花子', '花', '080-0000-0002',  NULL),
('鈴木 次郎', '次', '070-0000-0003', 'メモC');

-- (3) インデックス変更テスト: 左DB側定義
CREATE TABLE schema_test_indexes (
    id         SERIAL       PRIMARY KEY,
    email      VARCHAR(255) NOT NULL,
    name       VARCHAR(100),
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_email ON schema_test_indexes (email);
CREATE INDEX idx_name  ON schema_test_indexes (name);
INSERT INTO schema_test_indexes (email, name) VALUES
('alice@test.com', 'Alice'),
('bob@test.com',   'Bob'),
('carol@test.com', 'Carol');

-- (4) カラム追加・削除テスト: 左DB側定義
CREATE TABLE schema_test_columns_added_deleted (
    id         SERIAL       PRIMARY KEY,
    first_name VARCHAR(50)  NOT NULL,
    last_name  VARCHAR(50)  NOT NULL,
    old_column VARCHAR(100),
    email      VARCHAR(255),
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO schema_test_columns_added_deleted (first_name, last_name, old_column, email) VALUES
('太郎', '山田', '旧データA', 'taro@test.com'),
('花子', '鈴木', '旧データB', 'hanako@test.com'),
('次郎', '田中', NULL,        'jiro@test.com');

-- (5) 左DBのみ存在するテーブル
CREATE TABLE schema_test_left_only (
    id          SERIAL       PRIMARY KEY,
    description VARCHAR(200) NOT NULL,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO schema_test_left_only (description) VALUES
('左DBにのみ存在するテーブルのレコード1'),
('左DBにのみ存在するテーブルのレコード2');
