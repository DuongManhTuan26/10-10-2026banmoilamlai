/**
 * NHỊP HẰNG NGÀY của AI điều hành — mỗi khối não một lần mỗi ngày (docs/khoi-nao.md; rà soát 10/10/2026).
 *
 * Bản trước AI điều hành chỉ chạy khi có người bấm "chạy thử" trong màn hình quản lý — không ai nhận báo cáo, không có
 * nhịp hằng ngày, nên vòng lặp tự hoàn thiện không bao giờ quay.
 *
 * Mỗi ngày, tới giờ chủ shop đặt (mặc định 07:30 giờ Việt Nam):
 *   1. Đo lại các chỉ đạo đã đủ ngày (chi-dao.ts — xấu đi thì tự hoàn tác).
 *   2. Lập BÁO CÁO NGÀY bằng CODE từ bảng sức khoẻ: chỉ số cuối, sự cố, cái tụt cần xử lý, cái đang mạnh cần giữ, chỉ
 *      đạo đang áp dụng, đề xuất chờ duyệt. Không gọi AI → không tốn tiền → BẬT sẵn.
 *   3. TỰ CHẨN ĐOÁN (gọi AI, tốn tiền) — chỉ khi chủ shop bật VÀ đặt trần tiền tháng, chỉ khi bảng sức khoẻ có vấn đề, và
 *      còn trong trần. Kết quả thành ĐỀ XUẤT chờ duyệt (chế độ đề xuất — không tự thực thi).
 *   4. Gửi Telegram cho chủ tài khoản của trang; lưu báo cáo (ai_reports, kind 'dieu_hanh_ngay').
 * Giành chỗ TRƯỚC (một dòng ai_reports mỗi trang mỗi ngày) → nhiều tiến trình cùng quét không gửi trùng.
 */
import { query, queryOne } from "../db.js";
import { sucKhoeTrang } from "./suc-khoe.js";
import { danhGiaChiDaoDenHan, dsChiDao } from "./chi-dao.js";
import { sendTelegramMessage, escapeHtml } from "./telegram.js";
import { chayChoTrang } from "./ngu-canh-trang.js";
import { soBangChungTrang } from "./so-bang-chung.js";
import { dieuHanhMotLan, goiAiThat } from "./dieu-hanh.js";
import { luuDeXuat } from "./so-loi.js";

const VN_OFFSET_MS = 7 * 3_600_000;

export interface LichDieuHanh {
  /** Báo cáo ngày qua Telegram (code lập, không tốn tiền). */
  baoCaoNgay: boolean;
  /** Giờ gửi, "HH:MM" giờ Việt Nam. */
  gio: string;
  /** Tự chẩn đoán bằng AI mỗi ngày khi có vấn đề (tốn tiền). */
  tuChanDoan: boolean;
  /** Trần tiền AI điều hành mỗi tháng (USD). 0 = chưa đặt → không tự chẩn đoán. */
  tranThangUsd: number;
}
export const LICH_MAC_DINH: LichDieuHanh = { baoCaoNgay: true, gio: "07:30", tuChanDoan: false, tranThangUsd: 0 };

export function docLich(raw: unknown): LichDieuHanh {
  const o = (raw ?? {}) as Record<string, unknown>;
  const tran = Number(o.tranThangUsd);
  return {
    baoCaoNgay: o.baoCaoNgay !== false,
    gio: typeof o.gio === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(o.gio) ? o.gio : LICH_MAC_DINH.gio,
    tuChanDoan: o.tuChanDoan === true,
    tranThangUsd: Number.isFinite(tran) && tran >= 0 && tran <= 1000 ? Math.round(tran * 100) / 100 : 0,
  };
}

/** Tiền AI điều hành đã dùng tháng này (giờ VN) của một trang. */
export async function tienDieuHanhThang(trangId: number): Promise<number> {
  const r = await queryOne<{ usd: string }>(
    `SELECT coalesce(sum(tien_usd), 0)::text AS usd FROM de_xuat_dieu_hanh
      WHERE trang_id = $1 AND luc >= date_trunc('month', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh'`,
    [trangId]
  );
  return Number(r?.usd ?? 0);
}

/** Ước tiền một lần chẩn đoán (docs mục 14: ~0,1–0,2 USD/ca) — để không chạy khi phần trần còn lại không đủ. */
const UOC_MOT_LAN_USD = 0.25;

const vnd = (n: number | null) => (n === null ? "—" : `${Math.round(n).toLocaleString("vi-VN")} ₫`);

/** Lập báo cáo ngày (chữ Telegram) của một khối não — CODE viết, không gọi AI. */
export async function lapBaoCaoNgay(trangId: number, ten: string, ghiThem: string[] = []): Promise<string> {
  const sk = await sucKhoeTrang(trangId);
  const theoMa = new Map(sk.chiSo.map((c) => [c.ma, c]));
  const chiDao = (await dsChiDao(trangId)).filter((c) => c.trang_thai === "dang_ap_dung");
  const choDuyet = await queryOne<{ n: number }>(
    "SELECT count(*)::int AS n FROM de_xuat_dieu_hanh WHERE trang_id = $1 AND trang_thai = 'cho_duyet'",
    [trangId]
  );
  const cuoi = sk.chiSoCuoi;
  const dong = [
    `🧠 <b>BÁO CÁO NGÀY — ${escapeHtml(ten)}</b>`,
    "",
    "<b>Chỉ số cuối (7 ngày gần · 28 ngày trước):</b>",
    `• Tiền mỗi đơn: ${vnd(cuoi[0].gan)} · ${vnd(cuoi[0].nen)}`,
    `• Doanh thu / chi phí: ${cuoi[1].gan === null ? "—" : `${cuoi[1].gan.toFixed(2)} lần`} · ${cuoi[1].nen === null ? "—" : `${cuoi[1].nen.toFixed(2)} lần`}`,
  ];
  if (sk.suCo.length) dong.push("", "⚠️ <b>Sự cố — xử lý trước:</b>", ...sk.suCo.map((s) => `• ${escapeHtml(s.ten)} (${escapeHtml(s.chiTiet)})`));
  if (sk.uuTien.length) dong.push("", "🔻 <b>Đang tụt:</b>", ...sk.uuTien.map((m) => `• ${escapeHtml(theoMa.get(m)?.ten ?? m)}`));
  if (sk.baoVe.length) dong.push("", "🟢 <b>Đang mạnh — giữ nguyên:</b>", ...sk.baoVe.map((m) => `• ${escapeHtml(theoMa.get(m)?.ten ?? m)}`));
  if (!sk.suCo.length && !sk.uuTien.length && !sk.baoVe.length) dong.push("", "Chưa có chỉ số nào khác biệt có ý nghĩa thống kê.");
  if (chiDao.length) dong.push("", `📌 <b>Chỉ đạo đang áp dụng:</b> ${chiDao.length}`);
  if (choDuyet?.n) dong.push("", `📝 <b>${choDuyet.n} đề xuất chờ bạn duyệt</b> — vào AI Điều hành › Đang làm.`);
  if (ghiThem.length) dong.push("", ...ghiThem);
  return dong.join("\n");
}

/** Việc nền: chạy nhịp ngày cho mọi khối não đã tới giờ. Trả số khối não đã chạy. */
export async function runDueDieuHanhNgay(bayGio = new Date()): Promise<number> {
  await danhGiaChiDaoDenHan().catch((e) => console.error("[điều hành] Đo chỉ đạo hỏng:", e instanceof Error ? e.message : e));

  const vn = new Date(bayGio.getTime() + VN_OFFSET_MS);
  const ngay = vn.toISOString().slice(0, 10);
  const gioNay = vn.toISOString().slice(11, 16);
  const ds = await query<{ trang_id: number; user_id: number; ten: string; settings: Record<string, unknown> | null }>(
    `SELECT t.id::int AS trang_id, t.user_id::int AS user_id, t.ten, a.settings
       FROM trang t JOIN users u ON u.id = t.user_id AND u.is_active
       LEFT JOIN ai_configs a ON a.trang_id = t.id AND a.kind = 'analytics'
      WHERE EXISTS (SELECT 1 FROM social_accounts s WHERE s.trang_id = t.id AND s.connected)`
  );
  let dem = 0;
  for (const t of ds.rows) {
    const lich = docLich(t.settings?.dieuHanh);
    if (!lich.baoCaoNgay && !lich.tuChanDoan) continue;
    if (gioNay < lich.gio) continue;
    // Giành chỗ: mỗi trang một báo cáo mỗi ngày.
    const cho = await queryOne<{ id: number }>(
      `INSERT INTO ai_reports (user_id, trang_id, report_date, kind, metrics, findings, recommendation)
       VALUES ($1, $2, $3::date, 'dieu_hanh_ngay', '{}'::jsonb, '', '')
       ON CONFLICT (trang_id, report_date, kind) DO NOTHING RETURNING id`,
      [t.user_id, t.trang_id, ngay]
    );
    if (!cho) continue;
    try {
      const ghiThem: string[] = [];
      if (lich.tuChanDoan) ghiThem.push(...(await tuChanDoan(t.trang_id, t.user_id, lich)));
      const noiDung = await lapBaoCaoNgay(t.trang_id, t.ten, ghiThem);
      await query("UPDATE ai_reports SET findings = $2 WHERE id = $1", [cho.id, noiDung]);
      if (lich.baoCaoNgay) await sendTelegramMessage(t.user_id, noiDung, "bao_cao_ngay", t.trang_id).catch(() => {});
      dem++;
    } catch (e) {
      console.error(`[điều hành] Trang ${t.trang_id}:`, e instanceof Error ? e.message : e);
      await query("UPDATE ai_reports SET findings = $2 WHERE id = $1", [cho.id, `Lỗi: ${e instanceof Error ? e.message : e}`]).catch(() => {});
    }
  }
  return dem;
}

/** Tự chẩn đoán (tốn tiền) — đủ điều kiện mới chạy; trả các dòng ghi thêm vào báo cáo. */
async function tuChanDoan(trangId: number, userId: number, lich: LichDieuHanh): Promise<string[]> {
  if (!(lich.tranThangUsd > 0)) return ["(Tự chẩn đoán đang bật nhưng chưa đặt trần tiền tháng — không chạy.)"];
  const daDung = await tienDieuHanhThang(trangId);
  if (daDung + UOC_MOT_LAN_USD > lich.tranThangUsd) {
    return [`(Tự chẩn đoán dừng: đã dùng ${daDung.toFixed(2)}/${lich.tranThangUsd} USD trần tháng.)`];
  }
  const sk = await sucKhoeTrang(trangId);
  const vanDe = sk.suCo.length
    ? `Sự cố: ${sk.suCo.map((s) => `${s.ten} (${s.chiTiet})`).join("; ")}`
    : sk.uuTien.length
      ? `Chỉ số TỤT: ${sk.chiSo.find((c) => c.ma === sk.uuTien[0])?.ten}`
      : null;
  if (!vanDe) return [];
  const so = await soBangChungTrang(userId, trangId);
  const k = await chayChoTrang(trangId, () => dieuHanhMotLan({ vanDe, so, cheDo: "de_xuat", goi: goiAiThat(userId) }));
  await luuDeXuat({ userId, trangId, vanDe, k, so });
  return [`🤖 AI điều hành đã chẩn đoán: «${escapeHtml(vanDe)}» → có đề xuất mới chờ duyệt (${k.tienUsd.toFixed(3)} USD).`];
}
