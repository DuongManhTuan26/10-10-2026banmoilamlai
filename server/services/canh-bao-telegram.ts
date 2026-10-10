/**
 * CẢNH BÁO TELEGRAM THEO TRẠNG THÁI — hai việc chủ shop buộc phải biết kịp (chủ dự án chọn làm thật 11/10/2026):
 *
 *  1. SẮP HẾT 24 GIỜ: hội thoại còn ≤ 2 giờ trước khi hết cửa sổ nhắn tin của nền tảng mà chưa có đơn còn mở. Hết cửa
 *     sổ là shop không nhắn được cho khách nữa — mất khách. Công tắc `near_24h` (mặc định bật).
 *  2. KÊNH HỎNG: kênh mất kết nối / cần nối lại → AI ngừng nhận tin, ngừng trả lời. Luôn gửi, không có công tắc.
 *
 * Dò theo TRẠNG THÁI trong database (worker 5 phút/lần), không móc vào từng đường làm kênh hỏng (đồng bộ định kỳ, bấm
 * đồng bộ, webhook account.*): đường nào làm hỏng cũng bị bắt, và không đường nào báo trùng. Đã báo thì ghi
 * `canh_bao_da_gui` (migration 051).
 */
import { query } from "../db.js";
import { NGAY_DON_CON_MO } from "./sales-ai.js";
import { escapeHtml, sendTelegramMessage, suKienBat } from "./telegram.js";

/** Báo trước khi hết cửa sổ 24 giờ bao lâu. */
export const BAO_TRUOC_HET_24H_PHUT = 120;
/** Một tin liệt kê tối đa chừng này khách, còn lại ghi "và N khách khác". */
const TOI_DA_KHACH_MOT_TIN = 8;

const TEN_NEN_TANG: Record<string, string> = {
  facebook: "Messenger", instagram: "Instagram", tiktok: "TikTok", zalo: "Zalo", whatsapp: "WhatsApp",
};

export async function runDueSapHet24h(): Promise<number> {
  const ds = await query<{
    user_id: number; trang_id: number | null; ten: string | null; platform: string; khoa: string; con_phut: number;
  }>(
    /*
     * Khoá "đã báo" tính ở MỘT chỗ (KHOA_SAP_HET) rồi dùng lại khi ghi — đã dính thật: SQL làm tròn số giây, JS cắt
     * phần lẻ → hai khoá lệch 1 giây, lượt sau báo lại đúng khách vừa báo.
     */
    `WITH ds AS (
       SELECT c.*, c.id || '@' || floor(extract(epoch FROM c.window_expires_at))::bigint AS khoa
         FROM conversations c
     )
     SELECT c.khoa, c.user_id::int AS user_id, c.trang_id::int AS trang_id, cu.name AS ten, c.platform,
            GREATEST(0, floor(extract(epoch FROM c.window_expires_at - now()) / 60))::int AS con_phut
       FROM ds c
       LEFT JOIN customers cu ON cu.id = c.customer_id
      WHERE c.status <> 'done'
        AND c.window_expires_at > now()
        AND c.window_expires_at <= now() + ($1 || ' minutes')::interval
        AND NOT EXISTS (SELECT 1 FROM orders o
                         WHERE o.conversation_id = c.id AND o.status <> 'cancelled'
                           AND o.created_at > now() - ($2 || ' days')::interval)
        AND NOT EXISTS (SELECT 1 FROM canh_bao_da_gui g WHERE g.loai = 'sap_het_24h' AND g.khoa = c.khoa)
      ORDER BY c.window_expires_at`,
    [String(BAO_TRUOC_HET_24H_PHUT), String(NGAY_DON_CON_MO)]
  );
  if (ds.rows.length === 0) return 0;

  // Gom theo khối não (trang): mỗi trang một tin, không bắn mỗi khách một tin.
  const nhom = new Map<string, typeof ds.rows>();
  for (const r of ds.rows) {
    const k = `${r.user_id}:${r.trang_id ?? ""}`;
    nhom.set(k, [...(nhom.get(k) ?? []), r]);
  }

  let soTin = 0;
  for (const rows of nhom.values()) {
    const { user_id, trang_id } = rows[0];
    if (await suKienBat(user_id, "near_24h", true)) {
      const dong = rows.slice(0, TOI_DA_KHACH_MOT_TIN).map(
        (r) => `• <b>${escapeHtml(r.ten ?? "Khách chưa có tên")}</b> (${escapeHtml(TEN_NEN_TANG[r.platform] ?? r.platform)}) — còn ${r.con_phut} phút`
      );
      if (rows.length > TOI_DA_KHACH_MOT_TIN) dong.push(`… và ${rows.length - TOI_DA_KHACH_MOT_TIN} khách khác`);
      const gui = await sendTelegramMessage(
        user_id,
        [
          `⏳ <b>SẮP HẾT 24 GIỜ NHẮN TIN — ${rows.length} KHÁCH</b>`,
          "",
          ...dong,
          "",
          "Hết giờ là nền tảng không cho shop nhắn cho khách nữa. Vào hộp thư chốt hoặc nhắn khách ngay.",
        ].join("\n"),
        "sap_het_24h",
        trang_id
      ).catch(() => false);
      if (gui) soTin += 1;
    }
    // Đánh dấu cả khi tắt công tắc / chưa nối Telegram: bật lại sau đó không bắn dồn các cửa sổ đã qua.
    await query(
      `INSERT INTO canh_bao_da_gui (user_id, loai, khoa)
       SELECT $1, 'sap_het_24h', x FROM unnest($2::text[]) AS x ON CONFLICT DO NOTHING`,
      [user_id, rows.map((r) => r.khoa)]
    );
  }

  // Dấu cũ hơn 2 ngày đã vô dụng (cửa sổ chỉ dài 24 giờ).
  await query(`DELETE FROM canh_bao_da_gui WHERE loai = 'sap_het_24h' AND luc < now() - interval '2 days'`);
  return soTin;
}

export async function runDueKenhHong(): Promise<number> {
  // Kênh đã lành lại → bỏ dấu, lần hỏng sau được báo tiếp.
  await query(
    `DELETE FROM canh_bao_da_gui g
      USING social_accounts a
      WHERE g.loai = 'kenh_hong' AND g.khoa = a.id AND a.connected AND NOT a.needs_reconnection`
  );

  const ds = await query<{
    id: string; user_id: number; trang_id: number | null; ten: string | null; platform: string; connected: boolean; trang_ten: string | null;
  }>(
    `SELECT a.id, a.user_id::int AS user_id, a.trang_id::int AS trang_id, a.display_name AS ten, a.platform,
            a.connected, t.ten AS trang_ten
       FROM social_accounts a
       LEFT JOIN trang t ON t.id = a.trang_id
      WHERE (NOT a.connected OR a.needs_reconnection)
        AND a.platform <> 'metaads'
        AND NOT EXISTS (SELECT 1 FROM canh_bao_da_gui g WHERE g.loai = 'kenh_hong' AND g.khoa = a.id)`
  );

  let soTin = 0;
  for (const k of ds.rows) {
    const gui = await sendTelegramMessage(
      k.user_id,
      [
        `⚠️ <b>KÊNH ${k.connected ? "CẦN KẾT NỐI LẠI" : "MẤT KẾT NỐI"}</b>`,
        "",
        `<b>Kênh:</b> ${escapeHtml(k.ten ?? k.id)} (${escapeHtml(TEN_NEN_TANG[k.platform] ?? k.platform)})`,
        ...(k.trang_ten ? [`<b>Trang bán hàng:</b> ${escapeHtml(k.trang_ten)}`] : []),
        "",
        "AI không nhận được tin nhắn và bình luận mới của kênh này cho tới khi nối lại. Vào mục Kết nối kênh để nối lại.",
      ].join("\n"),
      "kenh_hong",
      k.trang_id
    ).catch(() => false);
    if (gui) soTin += 1;
    await query(
      `INSERT INTO canh_bao_da_gui (user_id, loai, khoa) VALUES ($1, 'kenh_hong', $2) ON CONFLICT DO NOTHING`,
      [k.user_id, k.id]
    );
  }
  return soTin;
}
