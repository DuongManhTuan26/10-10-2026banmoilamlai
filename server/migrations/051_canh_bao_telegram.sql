-- CẢNH BÁO TELEGRAM ĐÃ GỬI (rà soát giao diện lượt 2, L4 — chủ dự án chọn làm thật 11/10/2026):
--   'sap_het_24h': hội thoại sắp hết cửa sổ 24 giờ nhắn tin mà chưa chốt — khoá = mã hội thoại @ hạn cửa sổ (khách nhắn
--                  lại → cửa sổ mới → hạn mới → được báo lại).
--   'kenh_hong'  : kênh mất kết nối / cần nối lại — khoá = mã kênh; kênh lành lại thì xoá dòng để lần hỏng sau báo tiếp.
-- Bảng riêng, không thêm cột vào social_accounts: bảng đó có trigger sổ thay đổi (044), ghi dấu "đã báo" vào đó sẽ ngập sổ.
CREATE TABLE IF NOT EXISTS canh_bao_da_gui (
  user_id BIGINT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  loai  TEXT        NOT NULL CHECK (loai IN ('sap_het_24h', 'kenh_hong')),
  khoa  TEXT        NOT NULL,
  luc   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (loai, khoa)
);

-- Kênh ĐANG hỏng lúc nâng cấp là chuyện cũ chủ shop đã thấy trên màn Kết nối — không báo dồn một loạt khi triển khai.
INSERT INTO canh_bao_da_gui (user_id, loai, khoa)
SELECT user_id, 'kenh_hong', id FROM social_accounts WHERE NOT connected OR needs_reconnection
ON CONFLICT DO NOTHING;
