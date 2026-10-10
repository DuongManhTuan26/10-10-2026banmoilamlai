/**
 * Tạo đơn hàng.
 *
 * Tách khỏi route POST /orders vì AI bán hàng chạy tự chủ phải tự lên đơn được.
 * Trước đây mọi đơn đều bắt buộc qua tay người: AI thu đủ thông tin rồi chỉ
 * biết nhường quyền với lời nhắn "cần nhân viên xác nhận và lên đơn". Shop
 * không có nhân viên trực thì đơn nằm đó tới sáng hôm sau.
 */

import { queryOne, transaction } from "../db.js";
import { AppError } from "../http.js";
import { sendOrderReport } from "./telegram.js";

/** Một dòng hàng của đơn. */
export interface DongHang {
  ten: string;
  soLuong: number;
  donGia: number;
}

export interface DuLieuDon {
  userId: number;
  conversationId: string | null;
  customerName: string | null;
  phone: string | null;
  address: string | null;
  product: string;
  quantity: number;
  unitPrice: number;
  note: string | null;
  /** 'ai' khi AI tự chốt, 'human' khi người bấm tạo. */
  closedBy: "ai" | "human";
  status?: string;
  /**
   * Đơn NHIỀU sản phẩm (migration 049). Có thì product / quantity / unitPrice bị bỏ qua: product = tên các dòng gộp lại,
   * quantity = tổng số lượng, total = tổng tiền các dòng, unit_price = đơn giá khi chỉ có một dòng (nhiều dòng → 0).
   */
  items?: DongHang[];
  /**
   * Trang của đơn khi KHÔNG có hội thoại (tạo tay). Có hội thoại thì luôn lấy trang của kênh hội thoại — giá trị này
   * bị bỏ qua. Phải thuộc đúng tài khoản (kiểm trong câu ghi).
   */
  trangId?: number | null;
}

const TRANG_THAI = new Set(["pending", "confirmed", "shipping", "completed", "cancelled"]);

export async function soDonTiepTheo(
  userId: number,
  chay: (sql: string, params: unknown[]) => Promise<{ rows: Array<{ n: number }> }> = async (
    sql,
    params
  ) => ({ rows: [(await queryOne<{ n: number }>(sql, params)) ?? { n: 0 }] })
): Promise<string> {
  const today = new Date();
  const prefix =
    "DH" +
    String(today.getFullYear()).slice(2) +
    String(today.getMonth() + 1).padStart(2, "0") +
    String(today.getDate()).padStart(2, "0");

  const kq = await chay(
    `SELECT COUNT(*)::int AS n FROM orders
      WHERE user_id = $1 AND code LIKE $2 || '%'`,
    [userId, prefix]
  );

  return `${prefix}-${String((kq.rows[0]?.n ?? 0) + 1).padStart(4, "0")}`;
}

/*
 * Một đơn góp bao nhiêu vào bộ đếm của khách.
 *
 * Đơn chưa huỷ góp đúng số tiền của nó; đơn đã huỷ góp 0. Mọi chỗ động vào
 * total_orders / total_spent đều phải đi qua đây, để sửa số lượng, sửa giá,
 * huỷ và bỏ huỷ luôn dùng chung một cách tính.
 */
export function gopVaoTongChi(
  trangThai: string,
  tong: number
): { don: number; tien: number } {
  if (trangThai === "cancelled") return { don: 0, tien: 0 };
  return { don: 1, tien: Number.isFinite(tong) ? tong : 0 };
}

export async function taoDon(dVao: DuLieuDon): Promise<Record<string, unknown>> {
  let d = dVao;
  if (d.items?.length) {
    for (const x of d.items) {
      if (!x.ten.trim()) throw new AppError("Mỗi dòng hàng phải có tên sản phẩm");
      if (!Number.isFinite(x.soLuong) || x.soLuong < 1) throw new AppError("Số lượng phải là số nguyên từ 1 trở lên");
      if (!Number.isFinite(x.donGia) || x.donGia < 0) throw new AppError("Đơn giá không hợp lệ");
    }
    d = {
      ...d,
      product: d.items.map((x) => (x.soLuong > 1 ? `${x.ten.trim()} x${x.soLuong}` : x.ten.trim())).join("; "),
      quantity: d.items.reduce((s, x) => s + x.soLuong, 0),
      unitPrice: d.items.length === 1 ? d.items[0].donGia : 0,
    };
  }
  if (!d.product.trim()) throw new AppError("Đơn phải có tên sản phẩm");
  if (!Number.isFinite(d.quantity) || d.quantity < 1) {
    throw new AppError("Số lượng phải là số nguyên từ 1 trở lên");
  }
  if (!Number.isFinite(d.unitPrice) || d.unitPrice < 0) {
    throw new AppError("Đơn giá không hợp lệ");
  }

  let customerId: number | null = null;
  if (d.conversationId) {
    const conversation = await queryOne<{ customer_id: number | null }>(
      "SELECT customer_id FROM conversations WHERE id = $1 AND user_id = $2",
      [d.conversationId, d.userId]
    );
    if (!conversation) throw new AppError("Không tìm thấy hội thoại", 404);
    customerId = conversation.customer_id;
  }

  const total = d.items?.length
    ? d.items.reduce((s, x) => s + x.soLuong * x.donGia, 0)
    : d.quantity * d.unitPrice;

  /*
   * Thử lại khi đụng mã đơn.
   *
   * Mã sinh bằng COUNT(*) rồi cộng một, mà có chỉ mục duy nhất trên
   * (user_id, code). Hai đơn tạo cùng lúc thì cả hai đếm ra cùng một số, và
   * đơn thứ hai CHẾT HẲN với lỗi duplicate key.
   *
   * Đã dựng lại: tạo 4 đơn song song → "duplicate key value violates unique
   * constraint orders_code_key". Không phải chuyện lý thuyết nữa, vì worker
   * giờ chạy 4 hội thoại song song và AI tự lên đơn — hai khách chốt cùng lúc
   * là một đơn mất trắng.
   *
   * Đếm lại rồi thử lại: lượt sau COUNT đã tăng nên mã khác. Năm lượt là quá
   * đủ; hơn thế nghĩa là có chuyện khác, phải ném lỗi ra chứ không quay vòng.
   */
  return await taoVoiMaMoi(d, total, customerId);
}

async function taoVoiMaMoi(
  d: DuLieuDon,
  total: number,
  customerId: number | null
): Promise<Record<string, unknown>> {
  return await ghiDon(d, total, customerId);
}

async function ghiDon(
  d: DuLieuDon,
  total: number,
  customerId: number | null
): Promise<Record<string, unknown>> {
  const order = await transaction(async (client) => {
    /*
     * Khoá theo shop TRƯỚC khi đếm mã.
     *
     * Mã đơn sinh bằng COUNT(*) rồi cộng một. Hai đơn tạo cùng lúc thì cả hai
     * đếm ra cùng một số, đụng chỉ mục duy nhất (user_id, code), và đơn thứ
     * hai CHẾT HẲN — mất trắng một đơn hàng thật.
     *
     * Đã dựng lại: 4 đơn song song thì chỉ 1 sống. Thêm vòng thử lại cũng
     * không đủ vì các lượt đua vẫn đọc cùng một số đếm cũ — 6 đơn song song
     * vẫn mất 1.
     *
     * pg_advisory_xact_lock xếp hàng việc sinh mã theo TỪNG SHOP: shop khác
     * không phải chờ, và khoá tự nhả khi giao dịch kết thúc. Đây là cách duy
     * nhất giữ được cách đánh số theo ngày mà không đua.
     */
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `ma-don-${d.userId}`,
    ]);

    const code = await soDonTiepTheo(d.userId, (sql, params) =>
      client.query(sql, params as unknown[]) as Promise<{ rows: Array<{ n: number }> }>
    );
    /*
     * Trang + kênh của đơn, CHỐT ngay lúc tạo (chủ dự án 05/10/2026: doanh thu từng trang phải chính xác tuyệt đối).
     * Có hội thoại → kênh khách nhắn tới và trang của kênh đó tại thời điểm này. Không có → trang chỉ định (tạo tay).
     */
    let kenhId: string | null = null;
    let nguon: { loai: string | null; ad: string | null; bai: string | null } = { loai: null, ad: null, bai: null };
    let trangId: number | null = d.trangId ?? null;
    if (d.conversationId) {
      const k = await client.query<{ social_account_id: string | null; trang_id: number | null }>(
        `SELECT c.social_account_id, s.trang_id
           FROM conversations c
           LEFT JOIN social_accounts s ON s.id = c.social_account_id AND s.user_id = c.user_id
          WHERE c.id = $1 AND c.user_id = $2`,
        [d.conversationId, d.userId]
      );
      kenhId = k.rows[0]?.social_account_id ?? null;
      trangId = k.rows[0]?.trang_id ?? null;
      /*
       * Nguồn của đơn = lần chạm GẦN NHẤT trước khi chốt (quảng cáo / link / bình luận), chốt cứng lúc tạo đơn.
       * Không có lần chạm nào → nguồn ghi trên hội thoại (bỏ qua 'message' = hội thoại cũ chưa ghi nguồn).
       */
      const n = await client.query<{ loai: string | null; ad_id: string | null; post_id: string | null }>(
        `SELECT loai, ad_id, post_id FROM hoi_thoai_cham WHERE conversation_id = $1 AND luc <= now()
         ORDER BY luc DESC LIMIT 1`,
        [d.conversationId]
      );
      const h = n.rows[0]
        ? null
        : (
            await client.query<{ origin: string | null; origin_ad_id: string | null; origin_post_id: string | null }>(
              "SELECT origin, origin_ad_id, origin_post_id FROM conversations WHERE id = $1 AND user_id = $2",
              [d.conversationId, d.userId]
            )
          ).rows[0];
      nguon = n.rows[0]
        ? { loai: n.rows[0].loai, ad: n.rows[0].ad_id, bai: n.rows[0].post_id }
        : h && h.origin && h.origin !== "message"
          ? { loai: h.origin, ad: h.origin_ad_id, bai: h.origin_post_id }
          : nguon;
    }
    const inserted = await client.query(
      `INSERT INTO orders
         (user_id, customer_id, conversation_id, code, customer_name, phone,
          address, product, quantity, unit_price, total, status, closed_by, note,
          social_account_id, trang_id, origin, origin_ad_id, origin_post_id, items)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
               (SELECT id FROM trang WHERE id = $16 AND user_id = $1), $17, $18, $19, $20::jsonb)
       RETURNING *`,
      [
        d.userId, customerId, d.conversationId, code,
        d.customerName, d.phone, d.address,
        d.product, d.quantity, d.unitPrice, total,
        d.status && TRANG_THAI.has(d.status) ? d.status : "pending",
        d.closedBy, d.note, kenhId, trangId, nguon.loai, nguon.ad, nguon.bai,
        d.items?.length ? JSON.stringify(d.items.map((x) => ({ ten: x.ten.trim(), so_luong: x.soLuong, don_gia: x.donGia }))) : null,
      ]
    );

    // Ghi ngược thông tin đã xác nhận về hồ sơ khách, để lần sau AI biết sẵn.
    if (customerId) {
      await client.query(
        `UPDATE customers
            SET phone        = COALESCE($2, phone),
                address      = COALESCE($3, address),
                name         = COALESCE(NULLIF($4, ''), name),
                total_orders = total_orders + 1,
                total_spent  = total_spent + $5,
                updated_at   = now()
          WHERE id = $1`,
        [customerId, d.phone, d.address, d.customerName, total]
      );
    }

    if (d.conversationId) {
      await client.query(
        "UPDATE conversations SET status = 'done', updated_at = now() WHERE id = $1",
        [d.conversationId]
      );
    }

    return inserted.rows[0] as Record<string, unknown>;
  });

  // Báo Telegram là việc phụ: lỗi kênh thông báo không được làm hỏng việc chốt đơn.
  sendOrderReport(d.userId, order).catch((error: unknown) =>
    console.error(
      "[đơn hàng] Không gửi được báo cáo Telegram:",
      error instanceof Error ? error.message : error
    )
  );

  return order;
}

/**
 * Đơn gần nhất (chưa huỷ) của một hội thoại — để AI bán hàng biết khách đang đặt THÊM hay chỉ hỏi về đơn đã chốt.
 *
 * Bản trước chỉ hỏi "hội thoại đã có đơn chưa" rồi chặn MÃI MÃI: Messenger giữ một hội thoại cho mỗi khách, nên khách
 * quay lại mua lần hai thì AI nói đã chốt nhưng không lên đơn, không báo ai — khách chờ hàng, shop không biết có đơn.
 */
export async function donGanNhat(conversationId: string): Promise<{
  id: number; code: string; product: string; status: string; soNgay: number; items: unknown;
} | null> {
  return queryOne(
    `SELECT id::int AS id, code, product, status, items,
            floor(extract(epoch FROM now() - created_at) / 86400)::int AS "soNgay"
       FROM orders
      WHERE conversation_id = $1 AND status <> 'cancelled'
      ORDER BY created_at DESC LIMIT 1`,
    [conversationId]
  );
}
