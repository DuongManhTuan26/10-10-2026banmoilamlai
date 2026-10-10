/**
 * KHỐI NÃO — danh sách khối não được mở và nhật ký của từng AI trong khối não (docs/khoi-nao.md).
 *
 * Danh sách theo ĐÚNG luật mở khối não (server/khoi-nao.ts): trang của chính mình · trang thuộc tài khoản con của chủ
 * chuỗi · quản trị tổng thấy mọi trang. Giao diện dùng nó cho bộ chọn "Trang bán hàng" duy nhất ở đầu thanh menu.
 */
import { Router } from "express";
import { query } from "../db.js";
import { requireAuth } from "../auth.js";
import { AppError, route } from "../http.js";
import { naoCua } from "../khoi-nao.js";

export const khoiNaoRouter = Router();
khoiNaoRouter.use(requireAuth);

/** 4 AI cố định của mọi khối não — thứ tự, mã cài đặt, tên hiển thị. Nguồn duy nhất cho máy chủ. */
export const BON_AI = [
  { so: 1, ma: "content", khau: "noi_dung", ten: "AI Nội dung" },
  { so: 2, ma: "ads", khau: "quang_cao", ten: "AI Quảng cáo" },
  { so: 3, ma: "sales", khau: "ban_hang", ten: "AI Bán hàng" },
  { so: 4, ma: "analytics", khau: "dieu_hanh", ten: "AI Điều hành" },
] as const;

khoiNaoRouter.get(
  "/",
  route(async (req, res) => {
    const u = req.user!;
    const ds = await query<{
      trang_id: number; ten: string; chu_id: number; chu_ten: string; chu_email: string; la_cua_toi: boolean;
      kenh: { id: string; platform: string; ten: string; connected: boolean; anh: string | null }[];
    }>(
      `SELECT t.id::int AS trang_id, t.ten, u.id::int AS chu_id, u.name AS chu_ten, u.email AS chu_email,
              (u.id = $1) AS la_cua_toi,
              COALESCE((SELECT json_agg(json_build_object('id', s.id, 'platform', s.platform, 'ten', s.display_name,
                                                          'connected', s.connected, 'anh', s.profile_picture)
                                        ORDER BY s.platform)
                          FROM social_accounts s WHERE s.trang_id = t.id AND s.platform <> 'metaads'), '[]') AS kenh
         FROM trang t JOIN users u ON u.id = t.user_id
        WHERE u.is_active
          AND (u.id = $1 OR $2 = 'admin' OR ($2 = 'admin_con' AND u.parent_id = $1))
        ORDER BY (u.id = $1) DESC, u.name, t.id`,
      [u.id, u.role]
    );
    res.json({ success: true, data: { bonAi: BON_AI, ds: ds.rows } });
  })
);

/**
 * Nhật ký của MỘT AI trong khối não đang chọn — thẻ "Nhật ký" dùng chung cho cả 4 AI.
 * Gồm: thay đổi cài đặt / tài liệu / luật của AI đó (sổ thay đổi) và việc nó đã tự làm (lịch đăng, đề xuất điều hành).
 */
khoiNaoRouter.get(
  "/nhat-ky/:ai",
  route(async (req, res) => {
    const ai = BON_AI.find((x) => x.ma === req.params.ai);
    if (!ai) throw new AppError("AI không hợp lệ", 400);
    const { trangId } = naoCua(req);

    /*
     * Thay đổi thuộc AI nào: cài đặt / tài liệu theo `kind` của chính dòng đó; quảng cáo theo tên bảng ghi ngoài
     * (quang_cao_*); luật nhường người, hàng rào, kịch bản bình luận thuộc AI bán hàng; kênh là việc chung của trang
     * → hiện ở AI điều hành (người giám sát cả khối).
     */
    const thayDoi = await query<{ luc: Date; bang: string; hanh_dong: string; truoc: unknown; sau: unknown; nguon: string | null }>(
      `SELECT d.luc, d.bang, d.hanh_dong, d.truoc, d.sau, d.nguon
         FROM so_thay_doi d
         LEFT JOIN ai_configs c ON d.bang = 'ai_configs' AND c.id::text = d.ban_ghi
         LEFT JOIN ai_documents t ON d.bang = 'ai_documents' AND t.id::text = d.ban_ghi
        WHERE d.trang_id = $1
          AND CASE
                WHEN d.bang = 'ai_configs' THEN COALESCE(c.kind, d.sau ->> 'kind', d.truoc ->> 'kind') = $2
                WHEN d.bang = 'ai_documents' THEN COALESCE(t.kind, d.sau ->> 'kind', d.truoc ->> 'kind') = $2
                WHEN d.bang LIKE 'quang_cao%' THEN $2 = 'ads'
                WHEN d.bang IN ('handoff_rules', 'guardrail_configs', 'auto_scripts') THEN $2 = 'sales'
                WHEN d.bang = 'social_accounts' THEN $2 = 'analytics'
                ELSE FALSE
              END
        ORDER BY d.luc DESC LIMIT 100`,
      [trangId, ai.ma]
    );

    // Việc AI đã tự làm.
    const viec =
      ai.ma === "content"
        ? (await query<{ luc: Date; noi_dung: string; trang_thai: string }>(
            `SELECT created_at AS luc, COALESCE(topic, '') || CASE WHEN note IS NOT NULL THEN ' — ' || note ELSE '' END AS noi_dung,
                    status AS trang_thai
               FROM auto_pilot_runs WHERE trang_id = $1 ORDER BY id DESC LIMIT 50`,
            [trangId]
          )).rows
        : ai.ma === "analytics"
          ? (await query<{ luc: Date; noi_dung: string; trang_thai: string }>(
              `SELECT luc, van_de AS noi_dung, trang_thai FROM de_xuat_dieu_hanh
                WHERE trang_id = $1 ORDER BY id DESC LIMIT 50`,
              [trangId]
            )).rows
          : [];

    res.json({ success: true, data: { thayDoi: thayDoi.rows, viec } });
  })
);
