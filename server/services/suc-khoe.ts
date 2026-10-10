/**
 * SỨC KHOẺ từng khâu của MỘT TRANG — bước 4a của AI điều hành (chủ dự án duyệt 05/10/2026).
 *
 * Vì sao do CODE THỐNG KÊ chấm, không phải AI: chủ dự án cảnh báo AI "suy luận không kiểm soát, xác định lỗi không
 * chính xác, bỏ qua cái quan trọng, để ý cái vớ vẩn" → vòng sửa lỗi "biến lợn lành thành lợn què". Nghiên cứu cùng
 * kết luận: LLM không tự sửa được nếu thiếu phản hồi bên ngoài (Huang et al., ICLR 2024); tối ưu theo một con số dễ
 * thành "lách chỉ tiêu" (Goodhart). Nên VIỆC GÌ ĐANG TỐT / ĐANG TỤT do phép thử thống kê quyết định; AI (bước sau) chỉ
 * được xử lý cái tụt / sự cố, và KHÔNG được đụng vào cái đang mạnh (danh sách bảo vệ).
 *
 * Cách chấm: chỉ số 7 ngày gần nhất ("gần") so với 28 ngày trước đó ("nền") của CHÍNH trang đó.
 *   - Tỉ lệ (chốt đơn, nhường người, tương tác, nhấp quảng cáo…): kiểm định hai tỉ lệ.
 *   - Số đếm theo thời gian (hội thoại mới mỗi ngày, bình luận mỗi bài): kiểm định Poisson có điều kiện (nhị thức chính xác).
 *   - Chỉ kết luận "tụt" / "đang mạnh" khi CẢ HAI: p < 0,05 VÀ lệch ≥ 20% (lệch nhỏ không đáng hành động).
 *   - Thiếu mẫu tối thiểu → "chưa đủ dữ liệu" (shop ít khách thì số dao động rất mạnh — không được đoán).
 * Số bài đăng so ở CÙNG TUỔI 2 ngày (sổ so_bai_ngay) — so bằng số cộng dồn thì bài mới luôn kém bài cũ.
 * Dữ liệu cần ghi theo trang (đơn, tiền AI, nguồn) chỉ tính từ mốc MOC_THEO_TRANG.
 */
import { query, queryOne } from "../db.js";
import { MOC_THEO_TRANG } from "../moc-thoi-gian.js";
import { soQuangCaoTrongKy } from "./so-lieu-kenh.js";
import { TY_GIA } from "../../src/lib/tien-chi.js";

const NGAY_MS = 86_400_000;
export const NGUONG_P = 0.05;
export const NGUONG_LECH = 0.2;
const TUOI_BAI_NGAY = 2;
/**
 * Hội thoại phải có chừng này ngày để chốt mới được tính tỉ lệ chốt (giống bài so ở cùng tuổi 2 ngày).
 *
 * Lỗi đã thấy khi rà 10/10/2026: tỉ lệ chốt 7 ngày gần tính cả hội thoại mở HÔM QUA — chưa kịp chốt đã bị coi là "không
 * có đơn", trong khi 28 ngày nền thì đã đủ thời gian. Gần LUÔN thấp hơn nền → hệ thống báo "tụt" giả, AI điều hành đi sửa
 * một thứ không hỏng ("lợn lành thành lợn què").
 */
export const TUOI_CHOT_NGAY = 2;

export type MucSucKhoe = "dang_manh" | "on" | "tut" | "chua_du";

export interface ChiSo {
  khau: "noi_dung" | "quang_cao" | "ban_hang";
  ma: string;
  ten: string;
  /** Cao là tốt hay thấp là tốt. */
  huong: "cao_tot" | "thap_tot";
  donVi: "ti_le" | "moi_ngay" | "moi_bai" | "moi_100k";
  gan: { giaTri: number | null; tuSo: number; mauSo: number };
  nen: { giaTri: number | null; tuSo: number; mauSo: number };
  muc: MucSucKhoe;
  /** Thay đổi tương đối gần so với nền (0,25 = +25%). */
  lech: number | null;
  p: number | null;
  /** Vì sao "chưa đủ dữ liệu". */
  thieu?: string;
  /** Doanh thu ước mất mỗi tuần nếu tụt (₫) — để xếp ưu tiên theo tiền. null = không ước được. */
  anhHuongTuan: number | null;
}

/**
 * CHỈ SỐ CUỐI của khối não (chủ dự án 05/10/2026): tiền bỏ ra cho mỗi đơn và doanh thu trên chi phí. Chi phí = tiền AI +
 * tiền quảng cáo (định nghĩa "tiền tiêu" đã chốt). Tỉ số tiền / tiền không có phép thử thống kê đơn giản như tỉ lệ hay số
 * đếm → KHÔNG chấm tốt / tụt, chỉ hiện để theo dõi và để AI điều hành biết đích cuối là gì (không tối ưu nhầm chỉ số trung
 * gian như lượt nhấp).
 */
export interface ChiSoCuoi {
  ma: "tien_moi_don" | "doanh_thu_tren_chi_phi";
  ten: string;
  donVi: "vnd" | "lan";
  huong: "cao_tot" | "thap_tot";
  gan: number | null;
  nen: number | null;
  /** Thành phần để soát lại: đơn, doanh thu, tiền AI (đã quy VND), tiền quảng cáo (VND). */
  chiTiet: { gan: ThanhPhanTien; nen: ThanhPhanTien };
  ghiChu: string[];
}
interface ThanhPhanTien { don: number; doanhThu: number; tienAiVnd: number; tienQcVnd: number | null }

export interface SuCo {
  khau: "noi_dung" | "quang_cao" | "ban_hang" | "kenh";
  ten: string;
  chiTiet: string;
}

// ---------------------------------------------------------------------------
// Thống kê
// ---------------------------------------------------------------------------

/** Hàm phân phối chuẩn tích luỹ (xấp xỉ Abramowitz–Stegun 7.1.26, sai số < 1,5e-7). */
function phiChuan(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t *
    Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Kiểm định hai tỉ lệ (gộp phương sai), p hai phía. */
export function kiemHaiTiLe(x1: number, n1: number, x2: number, n2: number): number {
  const p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (!(se > 0)) return 1;
  const z = (x1 / n1 - x2 / n2) / se;
  return 2 * (1 - phiChuan(Math.abs(z)));
}

function logGiaiThua(n: number): number {
  let s = 0;
  for (let i = 2; i <= n; i++) s += Math.log(i);
  return s;
}

/**
 * So hai tốc độ Poisson c1/t1 và c2/t2: với tổng cố định, c1 ~ Nhị thức(c1+c2, t1/(t1+t2)). p hai phía chính xác =
 * tổng xác suất các kết quả không khả dĩ hơn kết quả quan sát.
 */
export function kiemPoisson(c1: number, t1: number, c2: number, t2: number): number {
  const n = c1 + c2;
  if (n === 0) return 1;
  const q = t1 / (t1 + t2);
  const lgN = logGiaiThua(n);
  const pmf = (k: number) => Math.exp(lgN - logGiaiThua(k) - logGiaiThua(n - k) + k * Math.log(q) + (n - k) * Math.log(1 - q));
  const quanSat = pmf(c1);
  let p = 0;
  for (let k = 0; k <= n; k++) {
    const x = pmf(k);
    if (x <= quanSat * (1 + 1e-9)) p += x;
  }
  return Math.min(1, p);
}

/** Chấm mức từ p và độ lệch theo hướng tốt của chỉ số. */
export function chamMuc(p: number, lech: number, huong: "cao_tot" | "thap_tot"): MucSucKhoe {
  if (!(p < NGUONG_P) || Math.abs(lech) < NGUONG_LECH) return "on";
  const tot = huong === "cao_tot" ? lech > 0 : lech < 0;
  return tot ? "dang_manh" : "tut";
}

function chiSoTiLe(
  khau: ChiSo["khau"], ma: string, ten: string, huong: ChiSo["huong"],
  gan: [number, number], nen: [number, number], toiThieu = { mau: 20, suKien: 5 }
): ChiSo {
  const [x1, n1] = gan;
  const [x2, n2] = nen;
  const c: ChiSo = {
    khau, ma, ten, huong, donVi: "ti_le",
    gan: { giaTri: n1 > 0 ? x1 / n1 : null, tuSo: x1, mauSo: n1 },
    nen: { giaTri: n2 > 0 ? x2 / n2 : null, tuSo: x2, mauSo: n2 },
    muc: "chua_du", lech: null, p: null, anhHuongTuan: null,
  };
  if (n1 < toiThieu.mau || n2 < toiThieu.mau || x1 + x2 < toiThieu.suKien) {
    c.thieu = `cần ít nhất ${toiThieu.mau} mẫu mỗi bên và ${toiThieu.suKien} lần xảy ra (đang có ${n1} / ${n2} mẫu, ${x1 + x2} lần)`;
    return c;
  }
  const r1 = x1 / n1;
  const r2 = x2 / n2;
  c.p = kiemHaiTiLe(x1, n1, x2, n2);
  c.lech = r2 > 0 ? (r1 - r2) / r2 : r1 > 0 ? 1 : 0;
  c.muc = chamMuc(c.p, c.lech, huong);
  return c;
}

function chiSoTocDo(
  khau: ChiSo["khau"], ma: string, ten: string, huong: ChiSo["huong"], donVi: ChiSo["donVi"],
  gan: [number, number], nen: [number, number], toiThieuSuKien = 10
): ChiSo {
  const [c1, t1] = gan;
  const [c2, t2] = nen;
  const c: ChiSo = {
    khau, ma, ten, huong, donVi,
    gan: { giaTri: t1 > 0 ? c1 / t1 : null, tuSo: c1, mauSo: t1 },
    nen: { giaTri: t2 > 0 ? c2 / t2 : null, tuSo: c2, mauSo: t2 },
    muc: "chua_du", lech: null, p: null, anhHuongTuan: null,
  };
  if (!(t1 > 0) || !(t2 > 0)) {
    c.thieu = !(t1 > 0) ? "7 ngày gần chưa có dữ liệu để so" : "chưa có dữ liệu nền (28 ngày trước) để so";
    return c;
  }
  if (c1 + c2 < toiThieuSuKien) {
    c.thieu = `cần ít nhất ${toiThieuSuKien} lần xảy ra cộng cả hai bên (đang có ${c1 + c2})`;
    return c;
  }
  const r1 = c1 / t1;
  const r2 = c2 / t2;
  c.p = kiemPoisson(c1, t1, c2, t2);
  c.lech = r2 > 0 ? (r1 - r2) / r2 : r1 > 0 ? 1 : 0;
  c.muc = chamMuc(c.p, c.lech, huong);
  return c;
}

// ---------------------------------------------------------------------------
// Số liệu
// ---------------------------------------------------------------------------

/** Cửa sổ "gần" (7 ngày) và "nền" (28 ngày trước đó); có `tuMoc` thì kẹp đầu cửa sổ từ mốc tính theo trang. */
function cuaSo(bayGio: Date, tuMoc: boolean) {
  const den = bayGio;
  const giua = new Date(den.getTime() - 7 * NGAY_MS);
  let dau = new Date(giua.getTime() - 28 * NGAY_MS);
  if (tuMoc && dau < MOC_THEO_TRANG) dau = MOC_THEO_TRANG;
  return { gan: [giua, den] as const, nen: [dau, giua] as const, soNgayNen: Math.max(0, (giua.getTime() - dau.getTime()) / NGAY_MS) };
}

export async function sucKhoeTrang(trangId: number, bayGio = new Date()) {
  const kenh = await query<{ id: string; platform: string; page_id: string | null; connected: boolean; needs_reconnection: boolean; display_name: string }>(
    "SELECT id, platform, page_id, connected, needs_reconnection, display_name FROM social_accounts WHERE trang_id = $1",
    [trangId]
  );
  const ids = kenh.rows.map((k) => k.id);
  const w = cuaSo(bayGio, false);
  const wm = cuaSo(bayGio, true);
  const chiSo: ChiSo[] = [];

  // --- BÁN HÀNG ---
  // Hội thoại MỚI mỗi ngày — khách mới tìm đến (thu hút).
  const hoiThoai = async (tu: Date, den: Date) =>
    queryOne<{ so: number }>(
      `SELECT count(*)::int AS so FROM conversations c
        WHERE c.social_account_id = ANY($1::text[]) AND c.created_at >= $2 AND c.created_at < $3`,
      [ids, tu, den]
    );
  /*
   * Tỉ lệ CHỐT / NHƯỜNG NGƯỜI tính trên LƯỢT KHÁCH NHẮN, không trên hội thoại mới tạo:
   *   - mẫu số: hội thoại có ít nhất một tin của khách trong cửa sổ — gồm cả khách CŨ quay lại (Messenger giữ một hội
   *     thoại mãi mãi; tính theo ngày tạo hội thoại thì lần mua thứ hai không bao giờ được đếm);
   *   - tử số: hội thoại đó có đơn (chưa huỷ) tạo trong cửa sổ cộng thêm TUOI_CHOT_NGAY ngày để kịp chốt;
   *   - cả hai cửa sổ (gần / nền) dời lùi TUOI_CHOT_NGAY ngày → hội thoại nào cũng đủ tuổi như nhau khi so.
   */
  const luotNhan = async (tu: Date, den: Date) =>
    queryOne<{ so: number; co_don: number; nhuong: number }>(
      `WITH ht AS (
         SELECT DISTINCT m.conversation_id AS id FROM messages m
          WHERE m.trang_id = $3 AND m.sender_type = 'customer' AND m.created_at >= $1 AND m.created_at < $2)
       SELECT count(*)::int AS so,
              count(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM orders o WHERE o.conversation_id = ht.id AND o.status <> 'cancelled'
                   AND o.created_at >= $1 AND o.created_at < $2 + ($4 || ' days')::interval))::int AS co_don,
              count(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM conversations c WHERE c.id = ht.id AND c.handoff_at >= $1 AND c.handoff_at < $2 + ($4 || ' days')::interval))::int AS nhuong
         FROM ht`,
      [tu, den, trangId, String(TUOI_CHOT_NGAY)]
    );
  const luiChot = (a: readonly [Date, Date]) =>
    [new Date(a[0].getTime() - TUOI_CHOT_NGAY * NGAY_MS), new Date(a[1].getTime() - TUOI_CHOT_NGAY * NGAY_MS)] as const;
  const [htGan, htNen, lnGanM, lnNenM, lnGan, lnNen] = await Promise.all([
    hoiThoai(...w.gan), hoiThoai(...w.nen),
    luotNhan(...luiChot(wm.gan)), luotNhan(...luiChot(wm.nen)),
    luotNhan(...luiChot(w.gan)), luotNhan(...luiChot(w.nen)),
  ]);
  chiSo.push(chiSoTocDo("ban_hang", "hoi_thoai_moi", "Hội thoại mới mỗi ngày", "cao_tot", "moi_ngay",
    [htGan?.so ?? 0, 7], [htNen?.so ?? 0, w.soNgayNen]));
  // Tỉ lệ chốt dùng đơn ghi theo trang → chỉ từ mốc.
  chiSo.push(chiSoTiLe("ban_hang", "ti_le_chot", `Tỉ lệ chốt đơn (lượt khách nhắn có đơn trong ${TUOI_CHOT_NGAY} ngày)`, "cao_tot",
    [lnGanM?.co_don ?? 0, lnGanM?.so ?? 0], [lnNenM?.co_don ?? 0, lnNenM?.so ?? 0]));
  chiSo.push(chiSoTiLe("ban_hang", "ti_le_nhuong", "Tỉ lệ AI phải nhường người (trên lượt khách nhắn)", "thap_tot",
    [lnGan?.nhuong ?? 0, lnGan?.so ?? 0], [lnNen?.nhuong ?? 0, lnNen?.so ?? 0]));

  const traLoi = async (tu: Date, den: Date) =>
    queryOne<{ so: number; nhanh: number }>(
      `SELECT count(*)::int AS so, count(*) FILTER (WHERE giay <= 60)::int AS nhanh FROM (
         SELECT extract(epoch FROM (tl.created_at - m.created_at)) AS giay
           FROM messages m JOIN conversations c ON c.id = m.conversation_id
           JOIN LATERAL (SELECT created_at FROM messages n WHERE n.conversation_id = m.conversation_id
                          AND n.sender_type IN ('ai', 'human') AND n.created_at > m.created_at
                          ORDER BY n.created_at LIMIT 1) tl ON TRUE
          WHERE c.social_account_id = ANY($1::text[]) AND m.sender_type = 'customer'
            AND m.created_at >= $2 AND m.created_at < $3) x`,
      [ids, tu, den]
    );
  const [tlGan, tlNen] = await Promise.all([traLoi(...w.gan), traLoi(...w.nen)]);
  chiSo.push(chiSoTiLe("ban_hang", "tra_loi_1_phut", "Tin khách được trả lời trong 1 phút", "cao_tot",
    [tlGan?.nhanh ?? 0, tlGan?.so ?? 0], [tlNen?.nhanh ?? 0, tlNen?.so ?? 0]));

  const don = async (tu: Date, den: Date) =>
    queryOne<{ so: number; huy: number; doanh_thu: string }>(
      `SELECT count(*)::int AS so, count(*) FILTER (WHERE status = 'cancelled')::int AS huy,
              coalesce(sum(total) FILTER (WHERE status <> 'cancelled'), 0)::text AS doanh_thu
         FROM orders WHERE trang_id = $1 AND created_at >= $2 AND created_at < $3`,
      [trangId, tu, den]
    );
  const [dGan, dNen] = await Promise.all([don(...wm.gan), don(...wm.nen)]);
  chiSo.push(chiSoTiLe("ban_hang", "ti_le_huy", "Tỉ lệ đơn bị huỷ", "thap_tot",
    [dGan?.huy ?? 0, dGan?.so ?? 0], [dNen?.huy ?? 0, dNen?.so ?? 0], { mau: 10, suKien: 3 }));

  // --- NỘI DUNG: số bài ở cùng tuổi 2 ngày ---
  const baiTuoi = async (tu: Date, den: Date) =>
    queryOne<{ bai: number; hien_thi: number; tuong_tac: number; binh_luan: number }>(
      `SELECT count(*)::int AS bai, coalesce(sum(hien_thi), 0)::int AS hien_thi,
              coalesce(sum(thich + binh_luan + chia_se), 0)::int AS tuong_tac, coalesce(sum(binh_luan), 0)::int AS binh_luan
         FROM (SELECT DISTINCT ON (account_id, post_ref) *
                 FROM so_bai_ngay
                WHERE account_id = ANY($1::text[]) AND post_ref <> '-' AND dang_luc >= $2 AND dang_luc < $3
                  AND ngay >= ((dang_luc AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + $4::int)
                ORDER BY account_id, post_ref, ngay ASC) b`,
      [ids, tu, den, TUOI_BAI_NGAY]
    );
  // Bài phải đủ tuổi mới có số ở tuổi 2 ngày → dời cửa sổ bài lùi 2 ngày.
  const lui = (a: readonly [Date, Date]) => [new Date(a[0].getTime() - TUOI_BAI_NGAY * NGAY_MS), new Date(a[1].getTime() - TUOI_BAI_NGAY * NGAY_MS)] as const;
  const [bGan, bNen] = await Promise.all([baiTuoi(...lui(w.gan)), baiTuoi(...lui(w.nen))]);
  chiSo.push(chiSoTiLe("noi_dung", "ti_le_tuong_tac", "Tỉ lệ tương tác của bài (sau 2 ngày)", "cao_tot",
    [bGan?.tuong_tac ?? 0, bGan?.hien_thi ?? 0], [bNen?.tuong_tac ?? 0, bNen?.hien_thi ?? 0], { mau: 100, suKien: 10 }));
  chiSo.push(chiSoTocDo("noi_dung", "binh_luan_moi_bai", "Bình luận mỗi bài (sau 2 ngày)", "cao_tot", "moi_bai",
    [bGan?.binh_luan ?? 0, bGan?.bai ?? 0], [bNen?.binh_luan ?? 0, bNen?.bai ?? 0]));

  // --- QUẢNG CÁO: số Meta theo đúng Fanpage ---
  const suCo: SuCo[] = [];
  /** Tiền quảng cáo VND của trang ở hai cửa sổ tính theo mốc (cho chỉ số cuối). null = không đọc được / không có Fanpage. */
  let qcCuoi: { gan: number; nen: number } | null = null;
  const fb = kenh.rows.find((k) => k.platform === "facebook" && k.connected && k.page_id);
  if (fb) {
    try {
      const [qGan, qNen] = await Promise.all([
        soQuangCaoTrongKy(fb.id, fb.page_id!, ...w.gan),
        soQuangCaoTrongKy(fb.id, fb.page_id!, ...w.nen),
      ]);
      const cong = (ds: typeof qGan) => ({
        hienThi: ds.reduce((s, q) => s + q.hienThi, 0),
        nhap: ds.reduce((s, q) => s + q.nhap, 0),
        tien: ds.filter((q) => q.tienTe === "VND").reduce((s, q) => s + q.chiTieu, 0),
        troChuyen: ds.reduce((s, q) => s + (q.troChuyen ?? 0), 0),
      });
      const g = cong(qGan);
      const n = cong(qNen);
      // Chỉ số cuối tính theo cửa sổ kẹp từ mốc (wm) — cùng cửa sổ với đơn & doanh thu.
      const [qGanM, qNenM] = await Promise.all([
        soQuangCaoTrongKy(fb.id, fb.page_id!, ...wm.gan),
        soQuangCaoTrongKy(fb.id, fb.page_id!, ...wm.nen),
      ]);
      qcCuoi = { gan: cong(qGanM).tien, nen: cong(qNenM).tien };
      chiSo.push(chiSoTiLe("quang_cao", "ti_le_nhap", "Tỉ lệ nhấp quảng cáo", "cao_tot",
        [g.nhap, g.hienThi], [n.nhap, n.hienThi], { mau: 1000, suKien: 20 }));
      // Trò chuyện trên mỗi 100.000 ₫ chi quảng cáo (tốc độ theo tiền).
      chiSo.push(chiSoTocDo("quang_cao", "tro_chuyen_moi_100k", "Cuộc trò chuyện trên mỗi 100.000 ₫ quảng cáo", "cao_tot", "moi_100k",
        [g.troChuyen, g.tien / 100_000], [n.troChuyen, n.tien / 100_000]));
      for (const q of qGan.filter((x) => /reject|error|disapprov|with_issues/i.test(x.trangThai))) {
        suCo.push({ khau: "quang_cao", ten: "Quảng cáo bị từ chối / lỗi", chiTiet: q.ten });
      }
    } catch (e) {
      console.error("[sức khoẻ] Không đọc được quảng cáo:", e instanceof Error ? e.message : e);
      suCo.push({ khau: "quang_cao", ten: "Không đọc được số quảng cáo", chiTiet: "Thử lại sau ít phút" });
    }
  }

  // --- SỰ CỐ: hỏng thật, không cần thống kê ---
  for (const k of kenh.rows) {
    if (!k.connected) suCo.push({ khau: "kenh", ten: "Kênh mất kết nối", chiTiet: k.display_name });
    else if (k.needs_reconnection) suCo.push({ khau: "kenh", ten: "Kênh cần nối lại", chiTiet: k.display_name });
  }
  const baiLoi = await queryOne<{ so: number }>(
    `SELECT count(*)::int AS so FROM posts WHERE target_account_ids && $1::text[] AND status = 'failed' AND updated_at >= $2`,
    [ids, w.gan[0]]
  );
  if (baiLoi?.so) suCo.push({ khau: "noi_dung", ten: "Bài đăng lỗi", chiTiet: `${baiLoi.so} bài trong 7 ngày` });
  const aiLoi = await queryOne<{ so: number }>(
    "SELECT count(*)::int AS so FROM ai_usage WHERE trang_id = $1 AND loi IS NOT NULL AND created_at >= $2",
    [trangId, w.gan[0]]
  );
  if (aiLoi?.so) suCo.push({ khau: "ban_hang", ten: "AI bị tính tiền nhưng hỏng", chiTiet: `${aiLoi.so} lượt trong 7 ngày` });

  // --- Ước doanh thu mất mỗi tuần khi tụt — để xếp ưu tiên theo TIỀN (gần doanh thu xử lý trước) ---
  const dtNen = Number(dNen?.doanh_thu) || 0;
  const donNenKhongHuy = (dNen?.so ?? 0) - (dNen?.huy ?? 0);
  const aov = donNenKhongHuy > 0 ? dtNen / donNenKhongHuy : null;
  for (const c of chiSo) {
    if (c.muc !== "tut" || aov === null) continue;
    // Lượt khách nhắn mỗi tuần × mức chốt mất đi × giá trị đơn trung bình.
    const htTuan = (lnGanM?.so ?? 0);
    const chotNen = lnNenM?.so ? (lnNenM.co_don / lnNenM.so) : null;
    if (c.ma === "ti_le_chot" && c.gan.giaTri !== null && c.nen.giaTri !== null) {
      c.anhHuongTuan = Math.max(0, (c.nen.giaTri - c.gan.giaTri) * htTuan * aov);
    } else if (c.ma === "hoi_thoai_moi" && c.gan.giaTri !== null && c.nen.giaTri !== null && chotNen !== null) {
      c.anhHuongTuan = Math.max(0, (c.nen.giaTri - c.gan.giaTri) * 7 * chotNen * aov);
    }
  }
  // --- CHỈ SỐ CUỐI: tiền mỗi đơn, doanh thu / chi phí (cửa sổ kẹp từ mốc tính theo trang) ---
  const tienAi = async (tu: Date, den: Date) =>
    Number((await queryOne<{ usd: string }>(
      `SELECT coalesce(sum(coalesce(cost_ncc, cost_usd)), 0)::text AS usd FROM ai_usage
        WHERE trang_id = $1 AND created_at >= $2 AND created_at < $3`,
      [trangId, tu, den]
    ))?.usd ?? 0);
  const [aiGan, aiNen] = await Promise.all([tienAi(...wm.gan), tienAi(...wm.nen)]);
  const thanhPhan = (d: typeof dGan, aiUsd: number, qc: number | null): ThanhPhanTien => ({
    don: (d?.so ?? 0) - (d?.huy ?? 0),
    doanhThu: Number(d?.doanh_thu) || 0,
    tienAiVnd: Math.round(aiUsd * TY_GIA),
    tienQcVnd: qc,
  });
  const tpGan = thanhPhan(dGan, aiGan, qcCuoi?.gan ?? null);
  const tpNen = thanhPhan(dNen, aiNen, qcCuoi?.nen ?? null);
  const chiPhi = (t: ThanhPhanTien) => t.tienAiVnd + (t.tienQcVnd ?? 0);
  const ghiChuCuoi = [
    "Chi phí = tiền AI + tiền quảng cáo. Chưa có phép thử thống kê cho tỉ số tiền — số để theo dõi, không chấm tốt / tụt.",
    `Tiền AI quy ra VND theo tỉ giá ước tính ${TY_GIA.toLocaleString("vi-VN")} ₫/USD.`,
    ...(qcCuoi ? ["Tiền quảng cáo: chỉ phần chi bằng VND cho đúng Fanpage của trang."] : ["Chưa đọc được tiền quảng cáo — chi phí mới gồm tiền AI."]),
  ];
  const chiSoCuoi: ChiSoCuoi[] = [
    {
      ma: "tien_moi_don", ten: "Tiền bỏ ra cho mỗi đơn", donVi: "vnd", huong: "thap_tot",
      gan: tpGan.don > 0 ? Math.round(chiPhi(tpGan) / tpGan.don) : null,
      nen: tpNen.don > 0 ? Math.round(chiPhi(tpNen) / tpNen.don) : null,
      chiTiet: { gan: tpGan, nen: tpNen }, ghiChu: ghiChuCuoi,
    },
    {
      ma: "doanh_thu_tren_chi_phi", ten: "Doanh thu trên chi phí", donVi: "lan", huong: "cao_tot",
      gan: chiPhi(tpGan) > 0 ? tpGan.doanhThu / chiPhi(tpGan) : null,
      nen: chiPhi(tpNen) > 0 ? tpNen.doanhThu / chiPhi(tpNen) : null,
      chiTiet: { gan: tpGan, nen: tpNen }, ghiChu: ghiChuCuoi,
    },
  ];

  const THU_TU_KHAU = { ban_hang: 0, quang_cao: 1, noi_dung: 2 } as const;
  const uuTien = chiSo
    .filter((c) => c.muc === "tut")
    .sort((a, b) => (b.anhHuongTuan ?? -1) - (a.anhHuongTuan ?? -1) || THU_TU_KHAU[a.khau] - THU_TU_KHAU[b.khau]);

  return {
    luc: bayGio.toISOString(),
    cuaSo: { gan: w.gan.map((d) => d.toISOString()), nen: w.nen.map((d) => d.toISOString()) },
    chiSo,
    /** Chỉ số cuối của cả khối não — để theo dõi, không chấm (xem ChiSoCuoi). */
    chiSoCuoi,
    suCo,
    /** Cần xử lý, theo thứ tự: sự cố trước, rồi chỉ số tụt theo tiền bị ảnh hưởng. */
    uuTien: uuTien.map((c) => c.ma),
    /** Đang mạnh — AI điều hành KHÔNG được đụng vào. */
    baoVe: chiSo.filter((c) => c.muc === "dang_manh").map((c) => c.ma),
  };
}
