-- KHỐI NÃO THEO TRANG (chủ dự án chốt 10/10/2026 — docs/khoi-nao.md).
--
-- Nguyên tắc cố định: mỗi trang bán hàng có đúng MỘT khối não gồm 4 AI liền mạch (nội dung, quảng cáo, bán hàng,
-- điều hành). Dữ liệu của khối não nào chỉ thuộc trang đó. Trước bản này 14 bảng nghiệp vụ chỉ mang user_id — một tài
-- khoản có nhiều trang (mỗi Fanpage một trang) thì bài đăng, hội thoại, khách, lịch đăng, luật nhường người… của mọi
-- trang trộn chung một chỗ.
--
-- Bản này: thêm trang_id cho mọi bảng nghiệp vụ còn thiếu, điền từ dữ liệu sẵn có theo thứ tự chắc chắn nhất
-- (kênh → hội thoại → bài → trang mặc định của tài khoản), và đổi các khoá "mỗi tài khoản một" thành "mỗi trang một".
-- user_id GIỮ NGUYÊN (= chủ tài khoản của trang, dùng cho tiền / quyền); đọc dữ liệu khối não thì lọc theo trang_id.
--
-- Không ghi sổ thay đổi cho lần chuyển này: đây là đổi cấu trúc, không phải ai đó đổi cài đặt — ghi vào thì AI điều hành
-- thấy hàng loạt "thay đổi" giả trong sổ bằng chứng.

ALTER TABLE guardrail_configs DISABLE TRIGGER so_thay_doi_guardrail_configs;
ALTER TABLE handoff_rules DISABLE TRIGGER so_thay_doi_handoff_rules;
ALTER TABLE auto_scripts DISABLE TRIGGER so_thay_doi_auto_scripts;

-- Trang mặc định của một tài khoản: trang còn kênh đang nối trước, rồi trang cũ nhất (đúng layTrangMacDinh).
CREATE FUNCTION pg_temp.trang_mac_dinh(p_user bigint) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT t.id FROM trang t
    LEFT JOIN social_accounts s ON s.trang_id = t.id AND s.connected
   WHERE t.user_id = p_user
   GROUP BY t.id
   ORDER BY (count(s.id) = 0), t.id
   LIMIT 1
$$;

-- ---------------------------------------------------------------------------------------------- thêm cột
ALTER TABLE conversations     ADD COLUMN IF NOT EXISTS trang_id BIGINT REFERENCES trang(id) ON DELETE CASCADE;
ALTER TABLE messages          ADD COLUMN IF NOT EXISTS trang_id BIGINT REFERENCES trang(id) ON DELETE CASCADE;
ALTER TABLE hoi_thoai_cham    ADD COLUMN IF NOT EXISTS trang_id BIGINT REFERENCES trang(id) ON DELETE CASCADE;
ALTER TABLE send_attempts     ADD COLUMN IF NOT EXISTS trang_id BIGINT REFERENCES trang(id) ON DELETE CASCADE;
ALTER TABLE comments          ADD COLUMN IF NOT EXISTS trang_id BIGINT REFERENCES trang(id) ON DELETE CASCADE;
ALTER TABLE customers         ADD COLUMN IF NOT EXISTS trang_id BIGINT REFERENCES trang(id) ON DELETE CASCADE;
ALTER TABLE posts             ADD COLUMN IF NOT EXISTS trang_id BIGINT REFERENCES trang(id) ON DELETE CASCADE;
ALTER TABLE auto_pilot_runs   ADD COLUMN IF NOT EXISTS trang_id BIGINT REFERENCES trang(id) ON DELETE CASCADE;
ALTER TABLE auto_scripts      ADD COLUMN IF NOT EXISTS trang_id BIGINT REFERENCES trang(id) ON DELETE CASCADE;
ALTER TABLE guardrail_configs ADD COLUMN IF NOT EXISTS trang_id BIGINT REFERENCES trang(id) ON DELETE CASCADE;
ALTER TABLE handoff_rules     ADD COLUMN IF NOT EXISTS trang_id BIGINT REFERENCES trang(id) ON DELETE CASCADE;
ALTER TABLE telegram_logs     ADD COLUMN IF NOT EXISTS trang_id BIGINT REFERENCES trang(id) ON DELETE SET NULL;
ALTER TABLE ai_reports        ADD COLUMN IF NOT EXISTS trang_id BIGINT REFERENCES trang(id) ON DELETE CASCADE;

-- Gỡ các khoá "mỗi TÀI KHOẢN một" TRƯỚC khi chép bản sao cho từng trang (để nguyên thì bản sao đụng khoá cũ).
-- guardrail_configs có khoá chính là user_id → bỏ; khoá mới theo trang tạo ở cuối.
ALTER TABLE guardrail_configs DROP CONSTRAINT IF EXISTS guardrail_configs_pkey;
DROP INDEX IF EXISTS customers_identity_key;
DROP INDEX IF EXISTS auto_pilot_runs_user_slot_key;
DROP INDEX IF EXISTS handoff_rules_user_key;
DROP INDEX IF EXISTS ai_reports_user_date_key;

-- ---------------------------------------------------------------------------------------------- điền dữ liệu cũ
-- Hội thoại: theo kênh khách nhắn tới (chắc chắn nhất).
UPDATE conversations c SET trang_id = s.trang_id
  FROM social_accounts s WHERE s.id = c.social_account_id AND c.trang_id IS NULL AND s.trang_id IS NOT NULL;
UPDATE conversations SET trang_id = pg_temp.trang_mac_dinh(user_id) WHERE trang_id IS NULL;

UPDATE messages m SET trang_id = c.trang_id FROM conversations c WHERE c.id = m.conversation_id AND m.trang_id IS NULL;
UPDATE hoi_thoai_cham h SET trang_id = c.trang_id FROM conversations c WHERE c.id = h.conversation_id AND h.trang_id IS NULL;

UPDATE send_attempts a SET trang_id = c.trang_id FROM conversations c WHERE c.id = a.conversation_id AND a.trang_id IS NULL;
UPDATE send_attempts a SET trang_id = s.trang_id FROM social_accounts s WHERE s.id = a.social_account_id AND a.trang_id IS NULL;
UPDATE send_attempts SET trang_id = pg_temp.trang_mac_dinh(user_id) WHERE trang_id IS NULL;

UPDATE comments m SET trang_id = s.trang_id FROM social_accounts s WHERE s.id = m.social_account_id AND m.trang_id IS NULL;
UPDATE comments SET trang_id = pg_temp.trang_mac_dinh(user_id) WHERE trang_id IS NULL;

-- Khách: theo kênh của khách; thiếu thì theo hội thoại gần nhất của khách; thiếu nữa thì trang mặc định.
UPDATE customers k SET trang_id = s.trang_id FROM social_accounts s WHERE s.id = k.social_account_id AND k.trang_id IS NULL;
UPDATE customers k SET trang_id = (
    SELECT c.trang_id FROM conversations c WHERE c.customer_id = k.id AND c.trang_id IS NOT NULL
     ORDER BY c.last_message_at DESC NULLS LAST LIMIT 1)
 WHERE k.trang_id IS NULL;
UPDATE customers SET trang_id = pg_temp.trang_mac_dinh(user_id) WHERE trang_id IS NULL;

/*
 * Một người nhắn tới HAI trang của cùng tài khoản: trước đây chung một hồ sơ khách. Khối não độc lập thì mỗi trang một
 * hồ sơ — tách bản sao cho trang kia và trỏ hội thoại của trang kia sang bản sao (tên / SĐT / địa chỉ giữ nguyên; số đơn
 * và tiền đã mua tính lại từ đơn của đúng trang đó ở bước dưới).
 */
CREATE TEMP TABLE tach_khach ON COMMIT DROP AS
  SELECT DISTINCT c.customer_id AS cu, c.trang_id
    FROM conversations c JOIN customers k ON k.id = c.customer_id
   WHERE c.trang_id IS NOT NULL AND k.trang_id IS DISTINCT FROM c.trang_id;
ALTER TABLE tach_khach ADD COLUMN moi BIGINT;
UPDATE tach_khach t SET moi = n.id FROM (
  SELECT t2.cu, t2.trang_id, nextval(pg_get_serial_sequence('customers', 'id')) AS id FROM tach_khach t2
) n WHERE n.cu = t.cu AND n.trang_id = t.trang_id;
INSERT INTO customers (id, user_id, trang_id, social_account_id, platform, participant_id, name, phone, address,
                       avatar_url, note, tags, total_orders, total_spent, first_seen_at, last_seen_at, created_at, updated_at)
SELECT t.moi, k.user_id, t.trang_id, k.social_account_id, k.platform, k.participant_id, k.name, k.phone, k.address,
       k.avatar_url, k.note, k.tags, 0, 0, k.first_seen_at, k.last_seen_at, k.created_at, now()
  FROM tach_khach t JOIN customers k ON k.id = t.cu;
UPDATE conversations c SET customer_id = t.moi FROM tach_khach t WHERE c.customer_id = t.cu AND c.trang_id = t.trang_id;
UPDATE orders o SET customer_id = t.moi FROM tach_khach t WHERE o.customer_id = t.cu AND o.trang_id = t.trang_id;
-- Số đơn / tiền của mỗi hồ sơ khách tính lại từ đơn thật (không huỷ) — sau khi tách, mỗi hồ sơ chỉ có đơn của trang mình.
UPDATE customers k SET total_orders = x.so, total_spent = x.tien
  FROM (SELECT k2.id, count(o.id) FILTER (WHERE o.status <> 'cancelled') AS so,
               coalesce(sum(o.total) FILTER (WHERE o.status <> 'cancelled'), 0) AS tien
          FROM customers k2 LEFT JOIN orders o ON o.customer_id = k2.id
         WHERE k2.id IN (SELECT cu FROM tach_khach UNION SELECT moi FROM tach_khach)
         GROUP BY k2.id) x
 WHERE x.id = k.id;

-- Bài đăng: theo kênh đầu tiên được nhắm; không có thì trang mặc định.
UPDATE posts p SET trang_id = s.trang_id FROM social_accounts s
 WHERE p.trang_id IS NULL AND s.id = p.target_account_ids[1] AND s.trang_id IS NOT NULL;
UPDATE posts SET trang_id = pg_temp.trang_mac_dinh(user_id) WHERE trang_id IS NULL;

UPDATE auto_pilot_runs r SET trang_id = p.trang_id FROM posts p WHERE p.id = r.post_id AND r.trang_id IS NULL;
UPDATE auto_pilot_runs SET trang_id = pg_temp.trang_mac_dinh(user_id) WHERE trang_id IS NULL;

UPDATE auto_scripts a SET trang_id = s.trang_id FROM social_accounts s WHERE s.id = a.social_account_id AND a.trang_id IS NULL;
UPDATE auto_scripts SET trang_id = pg_temp.trang_mac_dinh(user_id) WHERE trang_id IS NULL;

UPDATE telegram_logs SET trang_id = pg_temp.trang_mac_dinh(user_id) WHERE trang_id IS NULL;
UPDATE ai_reports SET trang_id = pg_temp.trang_mac_dinh(user_id) WHERE trang_id IS NULL;

/*
 * Cài đặt "mỗi tài khoản một bản" → "mỗi trang một bản": trang mặc định nhận bản gốc, các trang khác của cùng tài khoản
 * nhận BẢN SAO y hệt — không trang nào mất cài đặt đang chạy, từ nay chỉnh trang nào chỉ đổi trang đó.
 */
UPDATE guardrail_configs SET trang_id = pg_temp.trang_mac_dinh(user_id) WHERE trang_id IS NULL;
INSERT INTO guardrail_configs (user_id, trang_id, disclosure_enabled, disclosure_text, max_sends_per_minute,
       max_ai_sends_per_hour, auto_pause_enabled, failure_rate_threshold, failure_min_samples, auto_pause_minutes,
       author_dm_cooldown_hours, created_at, updated_at)
SELECT g.user_id, t.id, g.disclosure_enabled, g.disclosure_text, g.max_sends_per_minute, g.max_ai_sends_per_hour,
       g.auto_pause_enabled, g.failure_rate_threshold, g.failure_min_samples, g.auto_pause_minutes,
       g.author_dm_cooldown_hours, g.created_at, now()
  FROM guardrail_configs g JOIN trang t ON t.user_id = g.user_id AND t.id IS DISTINCT FROM g.trang_id
 WHERE g.trang_id IS NOT NULL;

UPDATE handoff_rules SET trang_id = pg_temp.trang_mac_dinh(user_id) WHERE trang_id IS NULL;
INSERT INTO handoff_rules (user_id, trang_id, rule_key, enabled, config, created_at, updated_at)
SELECT h.user_id, t.id, h.rule_key, h.enabled, h.config, h.created_at, now()
  FROM handoff_rules h JOIN trang t ON t.user_id = h.user_id AND t.id IS DISTINCT FROM h.trang_id
 WHERE h.trang_id IS NOT NULL;

-- Tài khoản không có trang nào (chủ chuỗi, quản trị chưa nối Fanpage): cài đặt khối não của họ không thuộc khối não
-- nào → bỏ. Khi họ có trang, trang mới nhận cài đặt mặc định như mọi trang mới.
DELETE FROM guardrail_configs WHERE trang_id IS NULL;
DELETE FROM handoff_rules WHERE trang_id IS NULL;

-- ---------------------------------------------------------------------------------------------- khoá mới theo trang
CREATE UNIQUE INDEX customers_identity_key ON customers (trang_id, platform, participant_id);

CREATE UNIQUE INDEX auto_pilot_runs_trang_slot_key ON auto_pilot_runs (trang_id, slot_key);

CREATE UNIQUE INDEX guardrail_configs_trang_key ON guardrail_configs (trang_id);

CREATE UNIQUE INDEX handoff_rules_trang_key ON handoff_rules (trang_id, rule_key);

CREATE UNIQUE INDEX ai_reports_trang_date_key ON ai_reports (trang_id, report_date, kind);

CREATE INDEX IF NOT EXISTS conversations_trang_idx ON conversations (trang_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS messages_trang_idx ON messages (trang_id, created_at);
CREATE INDEX IF NOT EXISTS comments_trang_idx ON comments (trang_id, created_at DESC);
CREATE INDEX IF NOT EXISTS customers_trang_idx ON customers (trang_id);
CREATE INDEX IF NOT EXISTS posts_trang_idx ON posts (trang_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auto_scripts_trang_idx ON auto_scripts (trang_id);
CREATE INDEX IF NOT EXISTS send_attempts_trang_idx ON send_attempts (trang_id, created_at);

-- ---------------------------------------------------------------------------------------------- tự điền trang khi ghi
/*
 * MỌI lần ghi dữ liệu khối não tự nhận đúng trang — kể cả chỗ ghi viết sau này (cùng lý do sổ thay đổi dùng trigger:
 * hội thoại / khách / tin nhắn / bình luận được tạo ở webhook, quét bù, đồng bộ hộp thư… sửa tay từng chỗ là sót).
 * Chạy TRƯỚC khi ghi nên khoá theo trang (vd. khách: trang + nền tảng + mã người) xét đúng trang ngay ở ON CONFLICT.
 * Thứ tự suy: kênh → hội thoại / bài → trang mặc định của tài khoản. Đường ghi tự đặt trang_id thì giữ nguyên.
 */
CREATE OR REPLACE FUNCTION trang_mac_dinh_cua(p_user bigint) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT t.id FROM trang t
    LEFT JOIN social_accounts s ON s.trang_id = t.id AND s.connected
   WHERE t.user_id = p_user
   GROUP BY t.id
   ORDER BY (count(s.id) = 0), t.id
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION dien_trang_tu_kenh() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.trang_id IS NULL AND NEW.social_account_id IS NOT NULL THEN
    SELECT trang_id INTO NEW.trang_id FROM social_accounts WHERE id = NEW.social_account_id;
  END IF;
  IF NEW.trang_id IS NULL AND NEW.user_id IS NOT NULL THEN NEW.trang_id := trang_mac_dinh_cua(NEW.user_id); END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION dien_trang_tu_hoi_thoai() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.trang_id IS NULL AND NEW.conversation_id IS NOT NULL THEN
    SELECT trang_id INTO NEW.trang_id FROM conversations WHERE id = NEW.conversation_id;
  END IF;
  IF NEW.trang_id IS NULL AND NEW.user_id IS NOT NULL THEN NEW.trang_id := trang_mac_dinh_cua(NEW.user_id); END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION dien_trang_tu_bai() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.trang_id IS NULL AND cardinality(NEW.target_account_ids) > 0 THEN
    SELECT trang_id INTO NEW.trang_id FROM social_accounts WHERE id = NEW.target_account_ids[1];
  END IF;
  IF NEW.trang_id IS NULL AND NEW.user_id IS NOT NULL THEN NEW.trang_id := trang_mac_dinh_cua(NEW.user_id); END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION dien_trang_mac_dinh() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.trang_id IS NULL AND NEW.user_id IS NOT NULL THEN NEW.trang_id := trang_mac_dinh_cua(NEW.user_id); END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER dien_trang BEFORE INSERT ON conversations FOR EACH ROW EXECUTE FUNCTION dien_trang_tu_kenh();
CREATE TRIGGER dien_trang BEFORE INSERT ON customers     FOR EACH ROW EXECUTE FUNCTION dien_trang_tu_kenh();
CREATE TRIGGER dien_trang BEFORE INSERT ON comments      FOR EACH ROW EXECUTE FUNCTION dien_trang_tu_kenh();
CREATE TRIGGER dien_trang BEFORE INSERT ON auto_scripts  FOR EACH ROW EXECUTE FUNCTION dien_trang_tu_kenh();
CREATE TRIGGER dien_trang BEFORE INSERT ON send_attempts FOR EACH ROW EXECUTE FUNCTION dien_trang_tu_hoi_thoai();
CREATE TRIGGER dien_trang BEFORE INSERT ON messages      FOR EACH ROW EXECUTE FUNCTION dien_trang_tu_hoi_thoai();
CREATE TRIGGER dien_trang BEFORE INSERT ON hoi_thoai_cham FOR EACH ROW EXECUTE FUNCTION dien_trang_tu_hoi_thoai();
CREATE TRIGGER dien_trang BEFORE INSERT ON posts         FOR EACH ROW EXECUTE FUNCTION dien_trang_tu_bai();
CREATE TRIGGER dien_trang BEFORE INSERT ON auto_pilot_runs FOR EACH ROW EXECUTE FUNCTION dien_trang_mac_dinh();
CREATE TRIGGER dien_trang BEFORE INSERT ON telegram_logs FOR EACH ROW EXECUTE FUNCTION dien_trang_mac_dinh();
CREATE TRIGGER dien_trang BEFORE INSERT ON ai_reports    FOR EACH ROW EXECUTE FUNCTION dien_trang_mac_dinh();

ALTER TABLE guardrail_configs ENABLE TRIGGER so_thay_doi_guardrail_configs;
ALTER TABLE handoff_rules ENABLE TRIGGER so_thay_doi_handoff_rules;
ALTER TABLE auto_scripts ENABLE TRIGGER so_thay_doi_auto_scripts;
