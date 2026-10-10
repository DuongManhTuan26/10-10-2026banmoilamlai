/**
 * Lưu đề xuất của AI điều hành + SỔ LỖI — bước 4 (chủ dự án duyệt 09/10/2026; docs mục 14; migration 045).
 *
 * Ba mức (quy trình kiểm duyệt): nghi_van → co_co_so → da_xac_nhan. Chỉ lỗi do CODE bắt (kiểm cứng) là "đã xác nhận"
 * ngay; chủ shop bác = "nghi vấn" (có thể là ý muốn, không phải lỗi). Sổ KHÔNG tự sửa lời dặn AI.
 */
import { query, queryOne, transaction } from "../db.js";
import { hienDeXuat, type KetQuaDieuHanh } from "./dieu-hanh.js";
import type { SoBangChung } from "./so-bang-chung.js";

/** Các dòng lỗi rút từ một lần chạy: vi phạm kiểm cứng ở MỌI vòng (kể cả đã được sửa) — máy đo → "đã xác nhận". */
export function loiTuLanChay(k: KetQuaDieuHanh): { loai: string; moTa: string }[] {
  const ra: { loai: string; moTa: string }[] = [];
  const thay = new Set<string>();
  for (const v of [...k.viPhamCacVong.flatMap((x) => x.viPham), ...k.viPham]) {
    const khoa = `${v.loai}|${v.chiTiet}`;
    if (!thay.has(khoa)) { thay.add(khoa); ra.push({ loai: v.loai, moTa: v.chiTiet }); }
  }
  return ra;
}

export async function luuDeXuat(p: { userId: number; trangId: number; vanDe: string; k: KetQuaDieuHanh; so: SoBangChung }): Promise<number> {
  return transaction(async (c) => {
    const r = await c.query<{ id: string }>(
      `INSERT INTO de_xuat_dieu_hanh (user_id, trang_id, van_de, ket_qua, ly_do, ket_luan, quyet_dinh, muc_chac, vi_pham, ghi_chu,
         khoang_trong, so_luot_ai, tien_usd, thoi_gian_ms, nhat_ky, trang_thai, noi_dung)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15::jsonb,'cho_duyet',$16) RETURNING id`,
      [p.userId, p.trangId, p.vanDe, p.k.ketQua, p.k.lyDo, p.k.ketLuan, JSON.stringify(p.k.qd), JSON.stringify(p.k.mucChac),
        JSON.stringify(p.k.viPham), JSON.stringify(p.k.ghiChu), JSON.stringify(p.so.khoangTrong), p.k.soLuotAi, p.k.tienUsd,
        Math.round(p.k.thoiGianMs), JSON.stringify(p.k.nhatKy), hienDeXuat(p.k, p.so)]
    );
    const id = Number(r.rows[0].id);
    for (const l of loiTuLanChay(p.k)) {
      await c.query(
        `INSERT INTO so_loi_ai (de_xuat_id, user_id, trang_id, nguon, loai, mo_ta, muc) VALUES ($1,$2,$3,'kiem_cung',$4,$5,'da_xac_nhan')`,
        [id, p.userId, p.trangId, l.loai, l.moTa]
      );
    }
    return id;
  });
}

/** Chủ shop duyệt / bác. Bác → một dòng sổ lỗi mức "nghi vấn" (chưa phải lỗi). Chỉ đổi được đề xuất đang chờ, của chính họ. */
export async function chuShopQuyet(p: { id: number; userId: number; duyet: boolean; lyDo?: string }): Promise<boolean> {
  return transaction(async (c) => {
    const r = await c.query<{ trang_id: string }>(
      `UPDATE de_xuat_dieu_hanh SET trang_thai = $3, ly_do_chu_shop = $4, luc_chu_shop = now()
        WHERE id = $1 AND user_id = $2 AND trang_thai = 'cho_duyet' RETURNING trang_id`,
      [p.id, p.userId, p.duyet ? "da_duyet" : "bac", p.lyDo ?? null]
    );
    if (!r.rowCount) return false;
    if (!p.duyet) {
      await c.query(
        `INSERT INTO so_loi_ai (de_xuat_id, user_id, trang_id, nguon, loai, mo_ta, muc) VALUES ($1,$2,$3,'chu_shop_bac','chu_shop_bac',$4,'nghi_van')`,
        [p.id, p.userId, r.rows[0].trang_id, p.lyDo?.trim() || "(chủ shop không ghi lý do)"]
      );
    }
    return true;
  });
}

/**
 * Số đo ĐÁNH GIÁ TỔNG THỂ (chủ dự án 09/10/2026) — không chỉ lỗi: tỉ lệ được duyệt / bác (chất lượng quyết định),
 * tỉ lệ bị code chặn, tiền và thời gian mỗi đề xuất (chi phí, tốc độ). Kết quả kinh doanh sau thay đổi và cơ hội bỏ lỡ
 * cần bước thử nghiệm + hoàn tác (chưa xây) — chưa đo ở đây.
 */
export async function soDoDieuHanh(trangId: number, tu: Date) {
  return queryOne<{ so: number; duyet: number; bac: number; cho: number; dung_chu_shop: number; tien_tb: number | null; giay_tb: number | null; loi_xac_nhan: number }>(
    `SELECT count(*)::int AS so,
            count(*) FILTER (WHERE trang_thai = 'da_duyet')::int AS duyet,
            count(*) FILTER (WHERE trang_thai = 'bac')::int AS bac,
            count(*) FILTER (WHERE trang_thai = 'cho_duyet')::int AS cho,
            count(*) FILTER (WHERE ket_qua = 'dung_hoi_chu_shop')::int AS dung_chu_shop,
            avg(tien_usd)::float AS tien_tb,
            avg(thoi_gian_ms)::float / 1000 AS giay_tb,
            (SELECT count(*)::int FROM so_loi_ai l WHERE l.trang_id = $1 AND l.luc >= $2 AND l.muc = 'da_xac_nhan') AS loi_xac_nhan
       FROM de_xuat_dieu_hanh WHERE trang_id = $1 AND luc >= $2`,
    [trangId, tu]
  );
}

/** Lỗi đã xác nhận hay gặp nhất — để NGƯỜI SOÁT biến thành phép kiểm / câu hỏi kiểm (không tự nhét vào lời dặn). */
export async function loiHayGap(gioiHan = 10) {
  const { rows } = await query<{ loai: string; so: number; chua_thanh_quy_tac: number }>(
    `SELECT loai, count(*)::int AS so, count(*) FILTER (WHERE da_thanh_quy_tac IS NULL)::int AS chua_thanh_quy_tac
       FROM so_loi_ai WHERE muc = 'da_xac_nhan' GROUP BY loai ORDER BY so DESC LIMIT $1`,
    [gioiHan]
  );
  return rows;
}

export interface DongDeXuat {
  id: number;
  luc: Date;
  van_de: string;
  ket_qua: string;
  ly_do: string;
  ket_luan: string;
  trang_thai: "cho_duyet" | "da_duyet" | "bac";
  ly_do_chu_shop: string | null;
  so_luot_ai: number;
  tien_usd: number;
  thoi_gian_ms: number;
  noi_dung: string | null;
}

/** Đề xuất gần đây của một trang (mới nhất trước). */
export async function deXuatGanDay(trangId: number, gioiHan = 10): Promise<DongDeXuat[]> {
  const { rows } = await query<DongDeXuat>(
    `SELECT id::int AS id, luc, van_de, ket_qua, ly_do, ket_luan, trang_thai, ly_do_chu_shop, so_luot_ai,
            tien_usd::float AS tien_usd, thoi_gian_ms, noi_dung,
            -- Nhân viên mà các việc đề xuất nhắm tới — để giao diện gợi ý gửi chỉ đạo cho đúng AI khi duyệt.
            COALESCE((SELECT array_agg(DISTINCT h ->> 'nhanVien') FROM jsonb_array_elements(quyet_dinh -> 'hanhDong') h), '{}') AS nhan_vien
       FROM de_xuat_dieu_hanh WHERE trang_id = $1 ORDER BY luc DESC LIMIT $2`,
    [trangId, gioiHan]
  );
  return rows;
}

/** Trang + chủ của một đề xuất — để route kiểm phạm vi TRƯỚC khi cho duyệt / bác. */
export async function trangCuaDeXuat(id: number): Promise<{ trang_id: number; user_id: number } | null> {
  return queryOne<{ trang_id: number; user_id: number }>(
    "SELECT trang_id::int AS trang_id, user_id::int AS user_id FROM de_xuat_dieu_hanh WHERE id = $1", [id]);
}
