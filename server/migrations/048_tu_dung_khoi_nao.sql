-- TRANG SINH RA LÀ CÓ ĐỦ KHỐI NÃO (docs/khoi-nao.md, luật 1: không trang nào thiếu AI).
--
-- Vì sao ở tầng database: trang được tạo ở HAI chỗ (mở tài khoản mới; nối thêm Fanpage → baoDamTrangChoHoSo) và bản trước
-- chỉ chỗ thứ nhất dựng cài đặt AI — trang của Fanpage nối thêm sinh ra KHÔNG có dòng cài đặt nào cho 4 AI, không luật
-- nhường người, không hàng rào. Trigger bắt mọi chỗ tạo trang, kể cả chỗ viết sau này.
--
-- Khối não mới = 4 dòng ai_configs (content, ads, sales, analytics — lời dặn để trống: chỉ chủ shop biết shop mình bán gì),
-- bộ luật nhường người mặc định, hàng rào mặc định (giá trị mặc định của bảng).

CREATE OR REPLACE FUNCTION dung_khoi_nao(p_trang bigint, p_user bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  nguon_cu text := current_setting('app.nguon_thay_doi', true);
BEGIN
  -- Sổ thay đổi ghi đúng: đây là HỆ THỐNG dựng khối não, không phải ai đó sửa cài đặt.
  PERFORM set_config('app.nguon_thay_doi', 'he_thong', true);

  INSERT INTO ai_configs (user_id, trang_id, kind, system_prompt)
  SELECT p_user, p_trang, k, '' FROM unnest(ARRAY['content', 'ads', 'sales', 'analytics']) AS k
  ON CONFLICT (trang_id, kind) DO NOTHING;

  INSERT INTO handoff_rules (user_id, trang_id, rule_key, enabled, config)
  SELECT p_user, p_trang, r.k, r.bat, r.cau_hinh
    FROM (VALUES ('complaint', TRUE, '{}'::jsonb), ('ask_human', TRUE, '{}'::jsonb), ('discount', TRUE, '{}'::jsonb),
                 ('shipping', TRUE, '{}'::jsonb), ('unsure', TRUE, '{}'::jsonb), ('media', FALSE, '{}'::jsonb),
                 ('too_many_turns', TRUE, '{"maxTurns": 8}'::jsonb)) AS r(k, bat, cau_hinh)
  ON CONFLICT (trang_id, rule_key) DO NOTHING;

  INSERT INTO guardrail_configs (user_id, trang_id) VALUES (p_user, p_trang)
  ON CONFLICT (trang_id) DO NOTHING;

  PERFORM set_config('app.nguon_thay_doi', COALESCE(nguon_cu, ''), true);
END $$;

CREATE OR REPLACE FUNCTION trang_moi_dung_khoi_nao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM dung_khoi_nao(NEW.id, NEW.user_id);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS dung_khoi_nao ON trang;
CREATE TRIGGER dung_khoi_nao AFTER INSERT ON trang FOR EACH ROW EXECUTE FUNCTION trang_moi_dung_khoi_nao();

-- Trang đã có từ trước mà thiếu phần nào (vd. trang của Fanpage nối thêm) → bổ sung đủ. Phần đã có giữ nguyên.
SELECT dung_khoi_nao(id, user_id) FROM trang;
