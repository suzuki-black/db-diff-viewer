-- ============================================================
-- テスト用DB（右）: testdb_right
-- 開発環境を想定したデータ（左DBとの差分あり）
-- ============================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE DATABASE IF NOT EXISTS testdb_right CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE testdb_right;

-- ============================================================
-- categories テーブル（左右で完全一致 → ツールで「一致」として表示される）
-- ============================================================
CREATE TABLE categories (
    id       INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name     VARCHAR(100) NOT NULL,
    sort_order INT        NOT NULL DEFAULT 0,
    created_at DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO categories (id, name, sort_order) VALUES
(1, 'Electronics',  1),
(2, 'Clothing',     2),
(3, 'Food',         3),
(4, 'Books',        4),
(5, 'Sports',       5);

-- ============================================================
-- users テーブル
-- 差分①: phone カラムが追加されている（カラム構造差分）
-- 差分②: id=2のemailが変更 / id=3,6が削除 / id=7が追加
-- ============================================================
CREATE TABLE users (
    id         INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    email      VARCHAR(255) NOT NULL UNIQUE,
    phone      VARCHAR(20),                                          -- 左DBには存在しない追加カラム
    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO users (id, name, email, phone, created_at) VALUES
(1, '山田 太郎',   'yamada@example.com',        '090-1234-5678', '2024-01-10 09:00:00'),  -- 左DBと一致（phoneは新規）
(2, '鈴木 花子',   'suzuki.hanako@example.com', '080-9876-5432', '2024-01-12 10:30:00'),  -- emailが変更された
-- id=3（田中）は右DBに存在しない
(4, '佐藤 三郎',   'sato@example.com',          '070-1111-2222', '2024-02-15 11:00:00'),  -- 左DBと一致
(5, '高橋 四郎',   'takahashi@example.com',     '090-3333-4444', '2024-03-01 14:00:00'),  -- 左DBと一致
-- id=6（伊藤）は右DBに存在しない
(7, '渡辺 六郎',   'watanabe@example.com',      '080-5555-6666', '2024-05-01 10:00:00');  -- 右DBに新規追加

-- ============================================================
-- products テーブル
-- 差分①: id=1の price 変更 / id=4の stock 変更 / id=5が削除
-- 差分②: id=7の is_active 変更 / id=9が追加
-- ============================================================
CREATE TABLE products (
    id          INT            NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(200)   NOT NULL,
    price       DECIMAL(10,2)  NOT NULL,
    stock       INT            NOT NULL DEFAULT 0,
    category_id INT            NOT NULL,
    is_active   TINYINT(1)     NOT NULL DEFAULT 1,
    created_at  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO products (id, name, price, stock, category_id, is_active) VALUES
(1,  'スマートフォン X1',  79800.00, 150,  1, 1),  -- price が変更（89800→79800）
(2,  'ワイヤレスイヤホン', 12800.00,  80,  1, 1),  -- 左DBと一致
(3,  'Tシャツ（白）',       2980.00, 300,  2, 1),  -- 左DBと一致
(4,  'ジーンズ（青）',      6980.00,  50,  2, 1),  -- stock が変更（120→50）
-- id=5（有機玄米）は右DBに存在しない（廃番）
(6,  'Python入門書',        2860.00,  60,  4, 1),  -- 左DBと一致
(7,  'ランニングシューズ', 14800.00,  45,  5, 0),  -- is_active が変更（1→0）
(8,  'テニスラケット',     18000.00,  30,  5, 1),  -- 左DBと一致
(9,  'スマートウォッチ',   32800.00, 200,  1, 1);  -- 右DBに新規追加

-- ============================================================
-- orders テーブル
-- 差分①: total_price カラムが追加されている（カラム構造差分）
-- 差分②: id=3,8が削除 / id=2,5のstatusが変更 / id=9が追加
-- ============================================================
CREATE TABLE orders (
    id          INT         NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id     INT         NOT NULL,
    product_id  INT         NOT NULL,
    quantity    INT         NOT NULL DEFAULT 1,
    status      VARCHAR(20) NOT NULL DEFAULT 'pending',
    total_price DECIMAL(12,2),                                      -- 左DBには存在しない追加カラム
    created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)    REFERENCES users(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO orders (id, user_id, product_id, quantity, status, total_price, created_at) VALUES
(1,  1, 1, 1, 'completed',  79800.00, '2024-04-01 10:00:00'),  -- 左DBと一致
(2,  2, 3, 2, 'refunded',    5960.00, '2024-04-02 11:00:00'),  -- status が変更（completed→refunded）
-- id=3 は存在しない（user_id=3が削除されたため）
(4,  4, 2, 1, 'completed',  12800.00, '2024-04-05 14:00:00'),  -- 左DBと一致
(5,  5, 7, 1, 'shipped',    14800.00, '2024-04-10 16:00:00'),  -- status が変更（pending→shipped）
(6,  1, 4, 3, 'completed',  20940.00, '2024-04-12 10:30:00'),  -- 左DBと一致
(7,  2, 8, 1, 'cancelled',  18000.00, '2024-04-15 13:00:00'),  -- 左DBと一致
-- id=8 は存在しない
(9,  7, 9, 2, 'pending',    65600.00, '2024-05-10 10:00:00');  -- 右DBに新規追加

-- ============================================================
-- notifications テーブル（右DBにのみ存在 → ツールで「追加」として表示）
-- ============================================================
CREATE TABLE notifications (
    id         INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id    INT          NOT NULL,
    message    TEXT         NOT NULL,
    is_read    TINYINT(1)   NOT NULL DEFAULT 0,
    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO notifications (user_id, message, is_read, created_at) VALUES
(1, 'ご注文が完了しました（注文ID: 1）',          1, '2024-04-01 10:05:00'),
(2, 'ご注文が完了しました（注文ID: 2）',          1, '2024-04-02 11:05:00'),
(4, 'ご注文が完了しました（注文ID: 4）',          1, '2024-04-05 14:05:00'),
(5, '商品が発送されました（注文ID: 5）',          0, '2024-04-11 09:00:00'),
(1, '新着商品のお知らせ: スマートウォッチ入荷',  0, '2024-05-01 10:00:00'),
(7, 'アカウント登録が完了しました',               1, '2024-05-01 10:01:00'),
(7, 'ご注文ありがとうございます（注文ID: 9）',    0, '2024-05-10 10:05:00');

-- ============================================================
-- large_records テーブル（大容量テスト用 / 1000万件）
-- 右DB データ分布:
--   IDs        1 -  8,500,000 : 左DBと一致   (note_N)
--   IDs 8,500,001 -  9,000,000 : 変更あり    (right_v_N / 左は left_v_N)
--   IDs 10,000,001 - 11,000,000 : 右DBのみ   (right_only_N)
--   ※ IDs 9,000,001-10,000,000 は右DBに存在しない（左のみ）
-- ※ 初期化に数分かかります
-- ============================================================
CREATE TABLE large_records (
    id    INT         NOT NULL PRIMARY KEY,
    note  VARCHAR(50) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP PROCEDURE IF EXISTS populate_large_records_right;

DELIMITER //
CREATE PROCEDURE populate_large_records_right()
BEGIN
    DECLARE v_i INT DEFAULT 1;

    SET autocommit = 0;
    SET unique_checks = 0;

    WHILE v_i <= 100 DO
        -- セグメント判定: base と prefix を決定
        IF v_i <= 85 THEN
            -- IDs 1 - 8,500,000: 左DBと一致 (note_N)
            SET @base   = (v_i - 1) * 100000;
            SET @prefix = 'note_';
        ELSEIF v_i <= 90 THEN
            -- IDs 8,500,001 - 9,000,000: 変更あり (right_v_N)
            SET @base   = (v_i - 1) * 100000;
            SET @prefix = 'right_v_';
        ELSE
            -- IDs 10,000,001 - 11,000,000: 右DBのみ (right_only_N)
            -- v_i=91→base=10000000, v_i=100→base=10900000
            SET @base   = 10000000 + (v_i - 91) * 100000;
            SET @prefix = 'right_only_';
        END IF;

        -- 5段階クロス結合で 100,000 行を一括 INSERT
        INSERT INTO large_records (id, note)
        SELECT @base + (d0.n + d1.n*10 + d2.n*100 + d3.n*1000 + d4.n*10000) + 1,
               CONCAT(@prefix, @base + (d0.n + d1.n*10 + d2.n*100 + d3.n*1000 + d4.n*10000) + 1)
        FROM
            (SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
             UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) d0
            CROSS JOIN
            (SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
             UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) d1
            CROSS JOIN
            (SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
             UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) d2
            CROSS JOIN
            (SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
             UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) d3
            CROSS JOIN
            (SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
             UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9) d4;

        COMMIT;
        SET v_i = v_i + 1;
    END WHILE;

    SET unique_checks = 1;
    SET autocommit = 1;
END //
DELIMITER ;

CALL populate_large_records_right();
DROP PROCEDURE IF EXISTS populate_large_records_right;

-- ============================================================
-- スキーマ差分テスト用テーブル群（左DBと構造が異なる）
-- ============================================================

-- ── (1) カラム型変更テスト ────────────────────────────────
-- 右DB: DECIMAL(12,4) / TEXT / SMALLINT に変更
CREATE TABLE schema_test_column_types (
    id          INT            NOT NULL AUTO_INCREMENT PRIMARY KEY,
    price       DECIMAL(12,4)  NOT NULL,          -- DECIMAL(10,2) → DECIMAL(12,4)
    description TEXT,                              -- VARCHAR(255) → TEXT
    age         SMALLINT,                          -- TINYINT → SMALLINT
    code        CHAR(10)       NOT NULL DEFAULT '0000000000',  -- 変更なし
    created_at  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_test_column_types (price, description, age, code) VALUES
(1234.5600, 'テスト商品A', 25, 'ITEM000001'),
(9999.9900, 'テスト商品B', 30, 'ITEM000002'),
(  12.3000, NULL,          18, 'ITEM000003');

-- ── (2) NULL制約変更テスト ────────────────────────────────
-- 右DB: middle_name/phone が NULL許可、memo が NOT NULL に変更
CREATE TABLE schema_test_nullable (
    id          INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    middle_name VARCHAR(50),                        -- NOT NULL → NULL許可
    phone       VARCHAR(20),                        -- NOT NULL → NULL許可
    memo        TEXT         NOT NULL,              -- NULL許可 → NOT NULL
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_test_nullable (name, middle_name, phone, memo) VALUES
('田中 一郎', '一',  '090-0000-0001', 'メモA'),
('山田 花子', NULL,  '080-0000-0002', 'メモB（右DBではNULL→テキストに）'),
('鈴木 次郎', '次',  NULL,            'メモC');

-- ── (3) インデックス変更テスト ────────────────────────────
-- 右DB: idx_email が UNIQUE に変更、idx_name 削除、idx_created_at 追加
CREATE TABLE schema_test_indexes (
    id         INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    email      VARCHAR(255) NOT NULL,
    name       VARCHAR(100),
    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY idx_email      (email),              -- INDEX → UNIQUE KEY
    INDEX      idx_created_at (created_at)          -- 新規追加（idx_name は削除）
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_test_indexes (email, name) VALUES
('alice@test.com', 'Alice'),
('bob@test.com',   'Bob'),
('carol@test.com', 'Carol');

-- ── (4) カラム追加・削除テスト ────────────────────────────
-- 右DB: old_column 削除 / middle_name・address 追加
CREATE TABLE schema_test_columns_added_deleted (
    id          INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    first_name  VARCHAR(50)  NOT NULL,
    last_name   VARCHAR(50)  NOT NULL,
    -- old_column は削除済み
    email       VARCHAR(255),
    middle_name VARCHAR(50),                        -- 新規追加
    address     VARCHAR(200),                       -- 新規追加
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_test_columns_added_deleted (first_name, last_name, email, middle_name, address) VALUES
('太郎', '山田', 'taro@test.com',   NULL,   '東京都渋谷区1-1-1'),
('花子', '鈴木', 'hanako@test.com', '花',   '大阪府大阪市2-2-2'),
('次郎', '田中', 'jiro@test.com',   NULL,   NULL);

-- ── (5) 右DBのみ存在するテーブル ──────────────────────────
CREATE TABLE schema_test_right_only (
    id          INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    description VARCHAR(200) NOT NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_test_right_only (description) VALUES
('右DBにのみ存在するテーブルのレコード1'),
('右DBにのみ存在するテーブルのレコード2');
