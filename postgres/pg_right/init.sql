-- ============================================================
-- テスト用PostgreSQL DB（右）: testdb_pg_right
-- 開発環境を想定したデータ（左DBとの差分あり）
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
-- users テーブル
-- 差分①: phone カラムが追加されている（カラム構造差分）
-- 差分②: id=2のemailが変更 / id=3,6が削除 / id=7が追加
-- ============================================================
CREATE TABLE users (
    id         SERIAL       PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    email      VARCHAR(255) NOT NULL UNIQUE,
    phone      VARCHAR(20),                    -- 左DBには存在しない追加カラム
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO users (id, name, email, phone, created_at) VALUES
(1, '山田 太郎',   'yamada@example.com',        '090-1234-5678', '2024-01-10 09:00:00'),
(2, '鈴木 花子',   'suzuki.hanako@example.com', '080-9876-5432', '2024-01-12 10:30:00'),
-- id=3（田中）は右DBに存在しない
(4, '佐藤 三郎',   'sato@example.com',          '070-1111-2222', '2024-02-15 11:00:00'),
(5, '高橋 四郎',   'takahashi@example.com',     '090-3333-4444', '2024-03-01 14:00:00'),
-- id=6（伊藤）は右DBに存在しない
(7, '渡辺 六郎',   'watanabe@example.com',      '080-5555-6666', '2024-05-01 10:00:00');
SELECT setval('users_id_seq', 7);

-- ============================================================
-- products テーブル
-- 差分: id=1のprice変更 / id=4のstock変更 / id=5が削除 / id=9が追加
-- ============================================================
CREATE TABLE products (
    id          SERIAL        PRIMARY KEY,
    name        VARCHAR(200)  NOT NULL,
    price       NUMERIC(10,2) NOT NULL,
    stock       INT           NOT NULL DEFAULT 0,
    category_id INT           NOT NULL,
    is_active   BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO products (id, name, price, stock, category_id, is_active) VALUES
(1,  'スマートフォン X1',  79800.00, 150,  1, TRUE),   -- price が変更
(2,  'ワイヤレスイヤホン', 12800.00,  80,  1, TRUE),
(3,  'Tシャツ（白）',       2980.00, 300,  2, TRUE),
(4,  'ジーンズ（青）',      6980.00,  50,  2, TRUE),   -- stock が変更
-- id=5（有機玄米）は右DBに存在しない
(6,  'Python入門書',        2860.00,  60,  4, TRUE),
(7,  'ランニングシューズ', 14800.00,  45,  5, FALSE),  -- is_active が変更
(8,  'テニスラケット',     18000.00,  30,  5, TRUE),
(9,  'スマートウォッチ',   32800.00, 200,  1, TRUE);   -- 右DBに新規追加
SELECT setval('products_id_seq', 9);

-- ============================================================
-- orders テーブル
-- 差分①: total_price カラムが追加されている（カラム構造差分）
-- 差分②: id=3,8が削除 / id=2,5のstatusが変更 / id=9が追加
-- ============================================================
CREATE TABLE orders (
    id          SERIAL        PRIMARY KEY,
    user_id     INT           NOT NULL REFERENCES users(id),
    product_id  INT           NOT NULL REFERENCES products(id),
    quantity    INT           NOT NULL DEFAULT 1,
    status      VARCHAR(20)   NOT NULL DEFAULT 'pending',
    total_price NUMERIC(12,2),                            -- 左DBには存在しない追加カラム
    created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO orders (id, user_id, product_id, quantity, status, total_price, created_at) VALUES
(1,  1, 1, 1, 'completed',  79800.00, '2024-04-01 10:00:00'),
(2,  2, 3, 2, 'refunded',    5960.00, '2024-04-02 11:00:00'),  -- status が変更
-- id=3 は存在しない
(4,  4, 2, 1, 'completed',  12800.00, '2024-04-05 14:00:00'),
(5,  5, 7, 1, 'shipped',    14800.00, '2024-04-10 16:00:00'),  -- status が変更
(6,  1, 4, 3, 'completed',  20940.00, '2024-04-12 10:30:00'),
(7,  2, 8, 1, 'cancelled',  18000.00, '2024-04-15 13:00:00'),
-- id=8 は存在しない
(9,  7, 9, 2, 'pending',    65600.00, '2024-05-10 10:00:00');  -- 右DBに新規追加
SELECT setval('orders_id_seq', 9);

-- ============================================================
-- notifications テーブル（右DBにのみ存在）
-- ============================================================
CREATE TABLE notifications (
    id         SERIAL     PRIMARY KEY,
    user_id    INT        NOT NULL REFERENCES users(id),
    message    TEXT       NOT NULL,
    is_read    BOOLEAN    NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO notifications (user_id, message, is_read, created_at) VALUES
(1, 'ご注文が完了しました（注文ID: 1）',         TRUE,  '2024-04-01 10:05:00'),
(2, 'ご注文が完了しました（注文ID: 2）',         TRUE,  '2024-04-02 11:05:00'),
(4, 'ご注文が完了しました（注文ID: 4）',         TRUE,  '2024-04-05 14:05:00'),
(5, '商品が発送されました（注文ID: 5）',         FALSE, '2024-04-11 09:00:00'),
(1, '新着商品のお知らせ: スマートウォッチ入荷', FALSE, '2024-05-01 10:00:00'),
(7, 'アカウント登録が完了しました',              TRUE,  '2024-05-01 10:01:00'),
(7, 'ご注文ありがとうございます（注文ID: 9）',   FALSE, '2024-05-10 10:05:00');

-- ============================================================
-- スキーマ差分テスト用テーブル群（左DBと構造が異なる）
-- ============================================================

-- (1) カラム型変更テスト: 右DB側定義
CREATE TABLE schema_test_column_types (
    id          SERIAL         PRIMARY KEY,
    price       NUMERIC(12,4)  NOT NULL,   -- NUMERIC(10,2) → NUMERIC(12,4)
    description TEXT,                       -- VARCHAR(255) → TEXT
    age         INTEGER,                    -- SMALLINT → INTEGER
    code        CHAR(10)       NOT NULL DEFAULT '0000000000',
    created_at  TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO schema_test_column_types (price, description, age, code) VALUES
(1234.5600, 'テスト商品A', 25, 'ITEM000001'),
(9999.9900, 'テスト商品B', 30, 'ITEM000002'),
(  12.3000, NULL,          18, 'ITEM000003');

-- (2) NULL制約変更テスト: 右DB側定義
CREATE TABLE schema_test_nullable (
    id          SERIAL       PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    middle_name VARCHAR(50),               -- NOT NULL → NULL許可
    phone       VARCHAR(20),               -- NOT NULL → NULL許可
    memo        TEXT         NOT NULL,     -- NULL許可 → NOT NULL
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO schema_test_nullable (name, middle_name, phone, memo) VALUES
('田中 一郎', '一',  '090-0000-0001', 'メモA'),
('山田 花子', NULL,  '080-0000-0002', 'メモB（右DBではNULL→テキストに）'),
('鈴木 次郎', '次',  NULL,            'メモC');

-- (3) インデックス変更テスト: 右DB側定義
CREATE TABLE schema_test_indexes (
    id         SERIAL       PRIMARY KEY,
    email      VARCHAR(255) NOT NULL,
    name       VARCHAR(100),
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_email      ON schema_test_indexes (email);       -- INDEX → UNIQUE
CREATE        INDEX idx_created_at ON schema_test_indexes (created_at);  -- 新規追加（idx_nameは削除）
INSERT INTO schema_test_indexes (email, name) VALUES
('alice@test.com', 'Alice'),
('bob@test.com',   'Bob'),
('carol@test.com', 'Carol');

-- (4) カラム追加・削除テスト: 右DB側定義
CREATE TABLE schema_test_columns_added_deleted (
    id          SERIAL       PRIMARY KEY,
    first_name  VARCHAR(50)  NOT NULL,
    last_name   VARCHAR(50)  NOT NULL,
    -- old_column は削除済み
    email       VARCHAR(255),
    middle_name VARCHAR(50),               -- 新規追加
    address     VARCHAR(200),              -- 新規追加
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO schema_test_columns_added_deleted (first_name, last_name, email, middle_name, address) VALUES
('太郎', '山田', 'taro@test.com',   NULL, '東京都渋谷区1-1-1'),
('花子', '鈴木', 'hanako@test.com', '花', '大阪府大阪市2-2-2'),
('次郎', '田中', 'jiro@test.com',   NULL,  NULL);

-- (5) 右DBのみ存在するテーブル
CREATE TABLE schema_test_right_only (
    id          SERIAL       PRIMARY KEY,
    description VARCHAR(200) NOT NULL,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO schema_test_right_only (description) VALUES
('右DBにのみ存在するテーブルのレコード1'),
('右DBにのみ存在するテーブルのレコード2');
