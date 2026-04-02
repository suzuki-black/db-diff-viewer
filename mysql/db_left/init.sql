-- ============================================================
-- テスト用DB（左）: testdb_left
-- 本番環境を想定したデータ
-- ============================================================

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE DATABASE IF NOT EXISTS testdb_left CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE testdb_left;

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
-- users テーブル（右DBは phone カラムあり → 構造差分）
-- レコードも一部異なる
-- ============================================================
CREATE TABLE users (
    id         INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    email      VARCHAR(255) NOT NULL UNIQUE,
    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO users (id, name, email, created_at) VALUES
(1, '山田 太郎',   'yamada@example.com',   '2024-01-10 09:00:00'),  -- 右DBと一致
(2, '鈴木 花子',   'suzuki@example.com',   '2024-01-12 10:30:00'),  -- 右DBでemailが変更される
(3, '田中 次郎',   'tanaka@example.com',   '2024-02-01 08:00:00'),  -- 右DBには存在しない（削除）
(4, '佐藤 三郎',   'sato@example.com',     '2024-02-15 11:00:00'),  -- 右DBと一致
(5, '高橋 四郎',   'takahashi@example.com','2024-03-01 14:00:00'),  -- 右DBと一致
(6, '伊藤 五郎',   'ito@example.com',      '2024-03-10 09:30:00');  -- 右DBには存在しない（削除）

-- ============================================================
-- products テーブル（レコード差分あり）
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
(1,  'スマートフォン X1',  89800.00, 150,  1, 1),  -- 右DBで price が変更される
(2,  'ワイヤレスイヤホン', 12800.00,  80,  1, 1),  -- 右DBと一致
(3,  'Tシャツ（白）',       2980.00, 300,  2, 1),  -- 右DBと一致
(4,  'ジーンズ（青）',      6980.00, 120,  2, 1),  -- 右DBで stock が変更される
(5,  '有機玄米 2kg',        1480.00, 500,  3, 1),  -- 右DBには存在しない（廃番）
(6,  'Python入門書',        2860.00,  60,  4, 1),  -- 右DBと一致
(7,  'ランニングシューズ', 14800.00,  45,  5, 1),  -- 右DBで is_active が変更される
(8,  'テニスラケット',     18000.00,  30,  5, 1);  -- 右DBと一致

-- ============================================================
-- orders テーブル（右DBは total_price カラムあり → 構造差分 + レコード差分）
-- ============================================================
CREATE TABLE orders (
    id         INT         NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id    INT         NOT NULL,
    product_id INT         NOT NULL,
    quantity   INT         NOT NULL DEFAULT 1,
    status     VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)    REFERENCES users(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO orders (id, user_id, product_id, quantity, status, created_at) VALUES
(1,  1, 1, 1, 'completed', '2024-04-01 10:00:00'),  -- 右DBと一致
(2,  2, 3, 2, 'completed', '2024-04-02 11:00:00'),  -- 右DBで status が変更される
(3,  3, 6, 1, 'shipped',   '2024-04-03 09:30:00'),  -- 右DBには存在しない（user_id=3が削除）
(4,  4, 2, 1, 'completed', '2024-04-05 14:00:00'),  -- 右DBと一致
(5,  5, 7, 1, 'pending',   '2024-04-10 16:00:00'),  -- 右DBで status が変更される
(6,  1, 4, 3, 'completed', '2024-04-12 10:30:00'),  -- 右DBと一致
(7,  2, 8, 1, 'cancelled', '2024-04-15 13:00:00'),  -- 右DBと一致
(8,  4, 6, 2, 'shipped',   '2024-04-18 09:00:00');  -- 右DBには存在しない

-- ============================================================
-- legacy_logs テーブル（左DBにのみ存在 → ツールで「削除」として表示）
-- ============================================================
CREATE TABLE legacy_logs (
    id         INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    action     VARCHAR(100) NOT NULL,
    user_id    INT,
    detail     TEXT,
    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO legacy_logs (action, user_id, detail, created_at) VALUES
('LOGIN',   1, 'ログイン成功 IP:192.168.1.1',   '2024-01-10 09:00:05'),
('LOGIN',   2, 'ログイン成功 IP:192.168.1.2',   '2024-01-12 10:30:05'),
('LOGOUT',  1, NULL,                            '2024-01-10 18:00:00'),
('LOGIN',   3, 'ログイン成功 IP:10.0.0.5',      '2024-02-01 08:01:00'),
('UPDATE',  2, 'プロフィール更新',              '2024-02-20 15:30:00'),
('LOGIN',   4, 'ログイン成功 IP:192.168.1.10',  '2024-02-15 11:01:00'),
('DELETE',  3, 'アカウント削除リクエスト',      '2024-03-01 10:00:00'),
('LOGOUT',  4, NULL,                            '2024-02-15 18:30:00');

-- ============================================================
-- large_records テーブル（大容量テスト用 / 1000万件）
-- 左DB データ分布:
--   IDs        1 -  8,500,000 : 右DBと一致  (note_N)
--   IDs 8,500,001 -  9,000,000 : 変更あり   (left_v_N / 右は right_v_N)
--   IDs 9,000,001 - 10,000,000 : 左DBのみ   (left_only_N)
-- ※ 初期化に数分かかります
-- ============================================================
CREATE TABLE large_records (
    id    INT         NOT NULL PRIMARY KEY,
    note  VARCHAR(50) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP PROCEDURE IF EXISTS populate_large_records_left;

DELIMITER //
CREATE PROCEDURE populate_large_records_left()
BEGIN
    DECLARE v_i INT DEFAULT 1;

    SET autocommit = 0;
    SET unique_checks = 0;

    WHILE v_i <= 100 DO
        -- セグメント判定: base と prefix を決定
        IF v_i <= 85 THEN
            SET @base   = (v_i - 1) * 100000;
            SET @prefix = 'note_';
        ELSEIF v_i <= 90 THEN
            SET @base   = (v_i - 1) * 100000;
            SET @prefix = 'left_v_';
        ELSE
            SET @base   = (v_i - 1) * 100000;
            SET @prefix = 'left_only_';
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

CALL populate_large_records_left();
DROP PROCEDURE IF EXISTS populate_large_records_left;

-- ============================================================
-- スキーマ差分テスト用テーブル群
-- ============================================================

-- ── (1) カラム型変更テスト ────────────────────────────────
-- 左DB: DECIMAL(10,2) / VARCHAR(255) / TINYINT
-- 右DB: DECIMAL(12,4) / TEXT         / SMALLINT
CREATE TABLE schema_test_column_types (
    id          INT            NOT NULL AUTO_INCREMENT PRIMARY KEY,
    price       DECIMAL(10,2)  NOT NULL,
    description VARCHAR(255),
    age         TINYINT,
    code        CHAR(10)       NOT NULL DEFAULT '0000000000',
    created_at  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_test_column_types (price, description, age, code) VALUES
(1234.56, 'テスト商品A', 25, 'ITEM000001'),
(9999.99, 'テスト商品B', 30, 'ITEM000002'),
(  12.30, NULL,          18, 'ITEM000003');

-- ── (2) NULL制約変更テスト ────────────────────────────────
-- 左DB: middle_name/phone が NOT NULL、memo が NULL許可
-- 右DB: middle_name/phone が NULL許可、memo が NOT NULL
CREATE TABLE schema_test_nullable (
    id          INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    middle_name VARCHAR(50)  NOT NULL,
    phone       VARCHAR(20)  NOT NULL,
    memo        TEXT,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_test_nullable (name, middle_name, phone, memo) VALUES
('田中 一郎', '一',        '090-0000-0001', 'メモA'),
('山田 花子', '花',        '080-0000-0002',  NULL),
('鈴木 次郎', '次',        '070-0000-0003', 'メモC');

-- ── (3) インデックス変更テスト ────────────────────────────
-- 左DB: idx_email(通常), idx_name(通常)
-- 右DB: idx_email(UNIQUE に変更), idx_created_at(追加), idx_name(削除)
CREATE TABLE schema_test_indexes (
    id         INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    email      VARCHAR(255) NOT NULL,
    name       VARCHAR(100),
    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_name  (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_test_indexes (email, name) VALUES
('alice@test.com', 'Alice'),
('bob@test.com',   'Bob'),
('carol@test.com', 'Carol');

-- ── (4) カラム追加・削除テスト ────────────────────────────
-- 左DB: old_column あり / middle_name・address なし
-- 右DB: old_column なし / middle_name・address あり
CREATE TABLE schema_test_columns_added_deleted (
    id         INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    first_name VARCHAR(50)  NOT NULL,
    last_name  VARCHAR(50)  NOT NULL,
    old_column VARCHAR(100),
    email      VARCHAR(255),
    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_test_columns_added_deleted (first_name, last_name, old_column, email) VALUES
('太郎', '山田', '旧データA', 'taro@test.com'),
('花子', '鈴木', '旧データB', 'hanako@test.com'),
('次郎', '田中', NULL,        'jiro@test.com');

-- ── (5) 左DBのみ存在するテーブル ──────────────────────────
CREATE TABLE schema_test_left_only (
    id          INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    description VARCHAR(200) NOT NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_test_left_only (description) VALUES
('左DBにのみ存在するテーブルのレコード1'),
('左DBにのみ存在するテーブルのレコード2');
