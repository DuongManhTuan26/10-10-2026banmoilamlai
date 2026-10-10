-- SỔ CHỈ ĐẠO — AI điều hành chỉ đạo 3 AI nhân viên trong cùng khối não (docs/khoi-nao.md; rà soát 10/10/2026).
--
-- Vòng lặp tự hoàn thiện: đo (bảng sức khoẻ) → chẩn đoán (AI điều hành) → chủ shop duyệt → CHỈ ĐẠO xuống đúng AI nhân viên
-- (câu chỉ đạo được gắn vào lời dặn của AI đó mỗi lượt) → sau NGAY_DO ngày đo lại khâu của AI đó so với MỐC lúc bắt đầu →
-- xấu đi thì tự hoàn tác (gỡ chỉ đạo), tốt lên / giữ nguyên thì giữ. Mỗi dòng là một lần thử — sổ cải tiến của khối não.
CREATE TABLE IF NOT EXISTS chi_dao_ai (
  id             BIGSERIAL   PRIMARY KEY,
  trang_id       BIGINT      NOT NULL REFERENCES trang(id) ON DELETE CASCADE,
  user_id        BIGINT      NOT NULL,
  de_xuat_id     BIGINT      REFERENCES de_xuat_dieu_hanh(id) ON DELETE SET NULL,
  -- AI nhân viên nhận chỉ đạo (AI điều hành không tự chỉ đạo chính mình).
  ai             TEXT        NOT NULL CHECK (ai IN ('content', 'ads', 'sales')),
  noi_dung       TEXT        NOT NULL CHECK (length(noi_dung) BETWEEN 5 AND 2000),
  trang_thai     TEXT        NOT NULL DEFAULT 'dang_ap_dung' CHECK (trang_thai IN ('dang_ap_dung', 'da_go', 'hoan_tac')),
  luc_bat_dau    TIMESTAMPTZ NOT NULL DEFAULT now(),
  luc_ket_thuc   TIMESTAMPTZ,
  -- Chỉ số của khâu lúc bắt đầu (bảng sức khoẻ) — mốc để đo lại.
  moc_chi_so     JSONB       NOT NULL,
  ket_qua        TEXT        NOT NULL DEFAULT 'chua_do' CHECK (ket_qua IN ('chua_do', 'tot_len', 'giu_nguyen', 'xau_di')),
  ket_qua_chi_tiet JSONB,
  luc_do         TIMESTAMPTZ,
  ly_do_go       TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chi_dao_ai_trang ON chi_dao_ai (trang_id, ai, trang_thai);

-- Mọi lần thêm / gỡ / đo chỉ đạo vào sổ thay đổi (AI điều hành đọc lại được "cái gì vừa đổi"; thẻ Nhật ký hiện ra).
DROP TRIGGER IF EXISTS so_thay_doi_chi_dao_ai ON chi_dao_ai;
CREATE TRIGGER so_thay_doi_chi_dao_ai AFTER INSERT OR UPDATE OR DELETE ON chi_dao_ai
  FOR EACH ROW EXECUTE FUNCTION ghi_so_thay_doi('created_at', 'updated_at', 'moc_chi_so', 'ket_qua_chi_tiet');
