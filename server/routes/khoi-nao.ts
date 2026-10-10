/**
 * KHỐI NÃO — danh sách khối não được mở và nhật ký của từng AI trong khối não (docs/khoi-nao.md).
 *
 * Danh sách theo ĐÚNG luật mở khối não (server/khoi-nao.ts): trang của chính mình · trang thuộc tài khoản con của chủ
 * chuỗi · quản trị tổng thấy mọi trang. Giao diện dùng nó cho bộ chọn "Trang bán hàng" duy nhất ở đầu thanh menu.
 */
import { Router } from "express";
import { query, queryOne } from "../db.js";
import { dsChiDao, goChiDao, taoChiDao, type AiNhanVien } from "../services/chi-dao.js";
import { docLich, lapBaoCaoNgay, tienDieuHanhThang } from "../services/dieu-hanh-ngay.js";
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
         LEFT JOIN chi_dao_ai x ON d.bang = 'chi_dao_ai' AND x.id::text = d.ban_ghi
        WHERE d.trang_id = $1
          AND CASE
                WHEN d.bang = 'ai_configs' THEN COALESCE(c.kind, d.sau ->> 'kind', d.truoc ->> 'kind') = $2
                WHEN d.bang = 'ai_documents' THEN COALESCE(t.kind, d.sau ->> 'kind', d.truoc ->> 'kind') = $2
                WHEN d.bang LIKE 'quang_cao%' THEN $2 = 'ads'
                WHEN d.bang IN ('handoff_rules', 'guardrail_configs', 'auto_scripts') THEN $2 = 'sales'
                WHEN d.bang = 'chi_dao_ai' THEN $2 = 'analytics' OR COALESCE(x.ai, d.sau ->> 'ai', d.truoc ->> 'ai') = $2
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

// ---------------------------------------------------------------------------------------------- vòng lặp điều hành

/** Lịch điều hành của khối não: báo cáo ngày (miễn phí), tự chẩn đoán (tốn tiền, có trần). */
khoiNaoRouter.get(
  "/lich-dieu-hanh",
  route(async (req, res) => {
    const { trangId } = naoCua(req);
    const r = await queryOne<{ settings: Record<string, unknown> | null }>(
      "SELECT settings FROM ai_configs WHERE trang_id = $1 AND kind = 'analytics'",
      [trangId]
    );
    res.json({ success: true, data: { lich: docLich(r?.settings?.dieuHanh), daDungThangUsd: await tienDieuHanhThang(trangId) } });
  })
);

khoiNaoRouter.put(
  "/lich-dieu-hanh",
  route(async (req, res) => {
    const nao = naoCua(req);
    const lich = docLich(req.body?.lich);
    if (lich.tuChanDoan && !(lich.tranThangUsd > 0)) {
      throw new AppError("Đặt trần tiền mỗi tháng trước khi bật tự chẩn đoán — mỗi lần chẩn đoán gọi AI và tốn tiền.", 400);
    }
    await query(
      `INSERT INTO ai_configs (user_id, trang_id, kind, settings) VALUES ($1, $2, 'analytics', $3::jsonb)
       ON CONFLICT (trang_id, kind) DO UPDATE SET settings = ai_configs.settings || EXCLUDED.settings, updated_at = now()`,
      [nao.chuId, nao.trangId, JSON.stringify({ dieuHanh: lich })]
    );
    res.json({ success: true, data: { lich } });
  })
);

/** Xem trước báo cáo ngày (code lập, không tốn tiền) — đúng nội dung sẽ gửi Telegram. */
khoiNaoRouter.get(
  "/bao-cao-ngay/xem-truoc",
  route(async (req, res) => {
    const nao = naoCua(req);
    res.json({ success: true, data: { noiDung: await lapBaoCaoNgay(nao.trangId, nao.ten) } });
  })
);

/** Các báo cáo ngày đã gửi. */
khoiNaoRouter.get(
  "/bao-cao-ngay",
  route(async (req, res) => {
    const { trangId } = naoCua(req);
    const r = await query(
      `SELECT report_date, findings, created_at FROM ai_reports
        WHERE trang_id = $1 AND kind = 'dieu_hanh_ngay' ORDER BY report_date DESC LIMIT 30`,
      [trangId]
    );
    res.json({ success: true, data: r.rows });
  })
);

/** Sổ chỉ đạo của khối não. */
khoiNaoRouter.get(
  "/chi-dao",
  route(async (req, res) => {
    res.json({ success: true, data: await dsChiDao(naoCua(req).trangId) });
  })
);

const AI_NHAN_VIEN = new Set(["content", "ads", "sales"]);

/** Thêm chỉ đạo (chủ shop tự viết, hoặc từ một đề xuất đã duyệt). */
khoiNaoRouter.post(
  "/chi-dao",
  route(async (req, res) => {
    const nao = naoCua(req);
    const ai = String(req.body?.ai ?? "");
    if (!AI_NHAN_VIEN.has(ai)) throw new AppError("Chỉ đạo chỉ gửi cho 3 AI nhân viên: nội dung, quảng cáo, bán hàng", 400);
    const deXuatId = Number(req.body?.deXuatId) || null;
    if (deXuatId) {
      const dx = await queryOne("SELECT 1 FROM de_xuat_dieu_hanh WHERE id = $1 AND trang_id = $2 AND trang_thai = 'da_duyet'", [deXuatId, nao.trangId]);
      if (!dx) throw new AppError("Đề xuất này chưa được duyệt hoặc không thuộc trang này", 409);
    }
    const id = await taoChiDao({
      trangId: nao.trangId, userId: nao.chuId, ai: ai as AiNhanVien,
      noiDung: String(req.body?.noiDung ?? ""), deXuatId, nguon: deXuatId ? "ai_dieu_hanh" : "nguoi_dung",
    });
    res.status(201).json({ success: true, data: { id } });
  })
);

khoiNaoRouter.post(
  "/chi-dao/:id/go",
  route(async (req, res) => {
    const ok = await goChiDao({
      id: Number(req.params.id), trangId: naoCua(req).trangId, nguon: "nguoi_dung",
      lyDo: typeof req.body?.lyDo === "string" && req.body.lyDo.trim() ? req.body.lyDo.trim().slice(0, 500) : "Chủ shop gỡ",
    });
    if (!ok) throw new AppError("Không tìm thấy chỉ đạo đang áp dụng", 404);
    res.json({ success: true });
  })
);
