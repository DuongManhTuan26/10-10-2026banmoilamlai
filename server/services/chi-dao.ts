/**
 * CHỈ ĐẠO của AI điều hành xuống 3 AI nhân viên trong CÙNG khối não (docs/khoi-nao.md; migration 050).
 *
 * Đây là mắt xích khép vòng lặp tự hoàn thiện:
 *   đo (bảng sức khoẻ, code thống kê) → chẩn đoán (AI điều hành, có kiểm cứng) → chủ shop duyệt + sửa câu chỉ đạo
 *   → CHỈ ĐẠO gắn vào lời dặn của đúng AI nhân viên ở mọi lượt (chiDaoChoAi)
 *   → sau NGAY_DO ngày đo lại khâu đó so với MỐC lúc bắt đầu (danhGiaChiDaoDenHan)
 *   → xấu đi: TỰ HOÀN TÁC (gỡ chỉ đạo) + báo chủ shop; tốt lên / giữ nguyên: giữ.
 *
 * Vì sao phải đo bằng code chứ không hỏi AI "có tốt hơn không": mô hình không tự sửa được nếu thiếu phản hồi bên ngoài
 * (Huang et al., ICLR 2024 — docs/nghien-cuu-bo-de-ai-dieu-hanh.md) và hay chiều theo điều đã làm. Phép đo do code chấm,
 * cùng một ngưỡng thống kê với bảng sức khoẻ.
 */
import { query, queryOne, transaction } from "../db.js";
import { AppError } from "../http.js";
import { coNguon, type NguonThayDoi } from "./so-thay-doi.js";
import { sucKhoeTrang, type ChiSo } from "./suc-khoe.js";
import { sendTelegramMessage, escapeHtml } from "./telegram.js";

export type AiNhanVien = "content" | "ads" | "sales";
const KHAU: Record<AiNhanVien, ChiSo["khau"]> = { content: "noi_dung", ads: "quang_cao", sales: "ban_hang" };
const TEN_AI: Record<AiNhanVien, string> = { content: "AI Nội dung", ads: "AI Quảng cáo", sales: "AI Bán hàng" };

/** Đo lại sau chừng này ngày — đủ một cửa sổ "7 ngày gần" của bảng sức khoẻ nằm trọn SAU lúc bắt đầu chỉ đạo. */
export const NGAY_DO = 7;
/** Tối đa chỉ đạo đang áp dụng cho một AI — mỗi lần đổi MỘT thứ để đo được (docs mục 14: một việc tối ưu mỗi lần). */
export const TOI_DA_DANG_AP_DUNG = 3;

type MocChiSo = { ma: string; ten: string; muc: ChiSo["muc"]; gan: number | null }[];
const chupMoc = (ds: ChiSo[], khau: ChiSo["khau"]): MocChiSo =>
  ds.filter((c) => c.khau === khau).map((c) => ({ ma: c.ma, ten: c.ten, muc: c.muc, gan: c.gan.giaTri }));

/**
 * Khối chỉ đạo gắn vào lời dặn của AI nhân viên — gọi ở mọi chỗ dựng lời dặn của AI đó (bán hàng: decide; nội dung:
 * generatePostContent; quảng cáo: phân tích). Rỗng khi không có chỉ đạo nào đang áp dụng.
 */
export async function chiDaoChoAi(trangId: number | null, ai: AiNhanVien): Promise<string> {
  if (!trangId) return "";
  const r = await query<{ noi_dung: string }>(
    `SELECT noi_dung FROM chi_dao_ai WHERE trang_id = $1 AND ai = $2 AND trang_thai = 'dang_ap_dung' ORDER BY id`,
    [trangId, ai]
  );
  if (!r.rows.length) return "";
  return [
    "",
    "CHỈ ĐẠO CỦA AI ĐIỀU HÀNH (chủ shop đã duyệt — làm theo, ưu tiên hơn thói quen cũ; không trái lời dặn và tài liệu ở trên):",
    ...r.rows.map((x, i) => `${i + 1}. ${x.noi_dung}`),
    "",
  ].join("\n");
}

export async function taoChiDao(p: {
  trangId: number; userId: number; ai: AiNhanVien; noiDung: string; deXuatId?: number | null; nguon: NguonThayDoi;
}): Promise<number> {
  const noiDung = p.noiDung.trim();
  if (noiDung.length < 5) throw new AppError("Câu chỉ đạo quá ngắn", 400);
  if (noiDung.length > 2000) throw new AppError("Câu chỉ đạo quá dài (tối đa 2.000 ký tự)", 400);
  const dangCo = await queryOne<{ n: number }>(
    "SELECT count(*)::int AS n FROM chi_dao_ai WHERE trang_id = $1 AND ai = $2 AND trang_thai = 'dang_ap_dung'",
    [p.trangId, p.ai]
  );
  if ((dangCo?.n ?? 0) >= TOI_DA_DANG_AP_DUNG) {
    throw new AppError(
      `${TEN_AI[p.ai]} đang có ${TOI_DA_DANG_AP_DUNG} chỉ đạo chưa đo xong. Chờ kết quả (hoặc gỡ bớt) rồi mới thêm — đổi nhiều thứ cùng lúc thì không biết cái nào có tác dụng.`,
      409
    );
  }
  const sk = await sucKhoeTrang(p.trangId);
  return transaction(async (c) => {
    await coNguon(c, p.nguon);
    const r = await c.query<{ id: string }>(
      `INSERT INTO chi_dao_ai (trang_id, user_id, de_xuat_id, ai, noi_dung, moc_chi_so)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id`,
      [p.trangId, p.userId, p.deXuatId ?? null, p.ai, noiDung, JSON.stringify(chupMoc(sk.chiSo, KHAU[p.ai]))]
    );
    return Number(r.rows[0].id);
  });
}

export async function goChiDao(p: { id: number; trangId: number; lyDo: string; nguon: NguonThayDoi; hoanTac?: boolean }): Promise<boolean> {
  return transaction(async (c) => {
    await coNguon(c, p.nguon);
    const r = await c.query(
      `UPDATE chi_dao_ai SET trang_thai = $3, luc_ket_thuc = now(), ly_do_go = $4, updated_at = now()
        WHERE id = $1 AND trang_id = $2 AND trang_thai = 'dang_ap_dung'`,
      [p.id, p.trangId, p.hoanTac ? "hoan_tac" : "da_go", p.lyDo]
    );
    return (r.rowCount ?? 0) > 0;
  });
}

export async function dsChiDao(trangId: number) {
  return (
    await query(
      `SELECT id, de_xuat_id, ai, noi_dung, trang_thai, luc_bat_dau, luc_ket_thuc, ket_qua, ket_qua_chi_tiet, luc_do, ly_do_go,
              moc_chi_so, (luc_bat_dau + ($2 || ' days')::interval) AS luc_se_do
         FROM chi_dao_ai WHERE trang_id = $1 ORDER BY (trang_thai = 'dang_ap_dung') DESC, id DESC LIMIT 100`,
      [trangId, String(NGAY_DO)]
    )
  ).rows;
}

/**
 * So khâu của AI hiện tại với MỐC. Xấu đi = có chỉ số mới rơi vào "tụt" (lúc bắt đầu chưa tụt). Tốt lên = có chỉ số mới
 * "đang mạnh" và không có chỉ số nào xấu đi. Còn lại = giữ nguyên. Cùng ngưỡng thống kê với bảng sức khoẻ.
 */
export function soVoiMoc(moc: MocChiSo, nay: MocChiSo): { ketQua: "tot_len" | "giu_nguyen" | "xau_di"; xauDi: string[]; totLen: string[] } {
  const truoc = new Map(moc.map((m) => [m.ma, m.muc]));
  const xauDi = nay.filter((c) => c.muc === "tut" && truoc.get(c.ma) !== "tut").map((c) => c.ten);
  const totLen = nay.filter((c) => c.muc === "dang_manh" && truoc.get(c.ma) !== "dang_manh").map((c) => c.ten);
  return { ketQua: xauDi.length ? "xau_di" : totLen.length ? "tot_len" : "giu_nguyen", xauDi, totLen };
}

/** Việc nền mỗi ngày: đo lại các chỉ đạo đã đủ NGAY_DO ngày; xấu đi thì tự hoàn tác và báo chủ shop. */
export async function danhGiaChiDaoDenHan(): Promise<number> {
  const den = await query<{ id: number; trang_id: number; user_id: number; ai: AiNhanVien; noi_dung: string; moc_chi_so: MocChiSo }>(
    `SELECT id::int, trang_id::int, user_id::int, ai, noi_dung, moc_chi_so FROM chi_dao_ai
      WHERE trang_thai = 'dang_ap_dung' AND ket_qua = 'chua_do' AND luc_bat_dau <= now() - ($1 || ' days')::interval
      ORDER BY id LIMIT 20`,
    [String(NGAY_DO)]
  );
  let dem = 0;
  for (const cd of den.rows) {
    const sk = await sucKhoeTrang(cd.trang_id);
    const nay = chupMoc(sk.chiSo, KHAU[cd.ai]);
    const kq = soVoiMoc(cd.moc_chi_so, nay);
    await transaction(async (c) => {
      await coNguon(c, "he_thong");
      await c.query(
        `UPDATE chi_dao_ai SET ket_qua = $2, ket_qua_chi_tiet = $3::jsonb, luc_do = now(), updated_at = now(),
                trang_thai = CASE WHEN $2 = 'xau_di' THEN 'hoan_tac' ELSE trang_thai END,
                luc_ket_thuc = CASE WHEN $2 = 'xau_di' THEN now() ELSE luc_ket_thuc END,
                ly_do_go = CASE WHEN $2 = 'xau_di' THEN $4 ELSE ly_do_go END
          WHERE id = $1`,
        [cd.id, kq.ketQua, JSON.stringify({ nay, ...kq }), `Tự hoàn tác: ${kq.xauDi.join(", ")} tụt sau ${NGAY_DO} ngày`]
      );
    });
    const tieuDe = kq.ketQua === "xau_di" ? "↩️ <b>ĐÃ TỰ HOÀN TÁC MỘT CHỈ ĐẠO</b>" : kq.ketQua === "tot_len" ? "✅ <b>CHỈ ĐẠO CÓ HIỆU QUẢ — GIỮ</b>" : "ℹ️ <b>CHỈ ĐẠO ĐÃ ĐO — GIỮ</b>";
    const chiTiet = kq.ketQua === "xau_di" ? `Tụt: ${kq.xauDi.join(", ")}` : kq.ketQua === "tot_len" ? `Đang mạnh lên: ${kq.totLen.join(", ")}` : "Chưa thấy khác biệt có ý nghĩa thống kê.";
    await sendTelegramMessage(cd.user_id,
      `${tieuDe}\n${escapeHtml(TEN_AI[cd.ai])}: «${escapeHtml(cd.noi_dung.slice(0, 300))}»\n${escapeHtml(chiTiet)}`,
      "chi_dao", cd.trang_id).catch(() => {});
    dem++;
  }
  return dem;
}
