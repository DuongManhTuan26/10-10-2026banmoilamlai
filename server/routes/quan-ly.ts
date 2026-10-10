/**
 * Quản lý chuỗi trang: dành cho tài khoản 'admin_con'.
 *
 * Mô hình: MỖI TÀI KHOẢN MỘT TRANG, độc lập hoàn toàn — hộp thư riêng, đơn
 * hàng riêng, bộ não riêng, hồ sơ nền tảng riêng. Không dùng chung gì thì
 * không có đường nào để hai trang lẫn dữ liệu vào nhau.
 *
 * Admin con đứng trên nhóm tài khoản trang của mình: lập thêm trang, xem tổng
 * quan, và mở thẳng vào từng trang khi cần làm việc.
 *
 * Nguyên tắc xuyên suốt tệp này:
 *
 * 1. MỌI truy vấn nhắm vào tài khoản khác đều phải kèm parent_id = mình. Không
 *    có ngoại lệ. Thiếu một chỗ là admin con này với tay sang được trang của
 *    admin con khác — tức là toàn bộ khách hàng và doanh thu của họ.
 *
 * 2. Không tìm thấy thì trả 404, không trả 403. Trả 403 là xác nhận "tài khoản
 *    này có thật, chỉ là không phải của anh" — đủ để dò ra ai đang dùng hệ
 *    thống.
 *
 * 3. Mọi việc đụng tới tài khoản khác đều ghi nhật ký, kể cả việc chỉ mở ra xem.
 */

import { Router } from "express";

import { createSession, requireAuth } from "../auth.js";
import { query, queryOne } from "../db.js";
import { AppError, route } from "../http.js";
import { DAU_NGAY_VN, DAU_THANG_VN, MOC_THEO_TRANG } from "../moc-thoi-gian.js";
import { ghiNhatKyQuanTri } from "../services/nhat-ky-quan-tri.js";
import { layDanhSachQuanLy } from "../services/quan-ly-chung.js";
import { layTongQuan } from "../services/tong-quan.js";
import { baoCaoChuoi } from "../services/bao-cao-chuoi.js";
import { sucKhoeTrang } from "../services/suc-khoe.js";
import { chanLamDungAI } from "../services/chong-lam-dung.js";
import { chayChoTrang } from "../services/ngu-canh-trang.js";
import { soBangChungTrang } from "../services/so-bang-chung.js";
import { hangBangChung } from "../services/kiem-cung.js";
import { dieuHanhMotLan, goiAiThat, khoBangChung } from "../services/dieu-hanh.js";
import { chuShopQuyet, deXuatGanDay, luuDeXuat, soDoDieuHanh, trangCuaDeXuat } from "../services/so-loi.js";
import { NHOM_VIEC, VIEC } from "../services/so-ai.js";
import { nhatKyLuot, saoKeChuoi } from "../services/chi-phi.js";
import {
  rutGonTen,
  docMatKhauTuDat,
  taoTaiKhoanTrang,
  TEN_MIEN_NOI_BO,
} from "../services/tai-khoan.js";
import * as zernio from "../services/zernio.js";
import { hashPassword } from "../auth.js";

import { moKhoiNao } from "../khoi-nao.js";
export const quanLyRouter = Router();

quanLyRouter.use(requireAuth);

/*
 * Chặn theo ĐƯỜNG DẪN, không chặn cả router.
 *
 * Lúc đang xem thay một trang thì vai trò của phiên là 'shop' — đó là điểm
 * chính của cách ly. Nếu chặn cả router theo vai trò thì chính người đang xem
 * thay lại không gọi được /quay-lai và mắc kẹt trong tài khoản trang, phải xoá
 * cookie tay mới ra được. Đã suýt làm đúng như vậy.
 */
quanLyRouter.use("/trang", (req, _res, next) => {
  // Đang ở trong một tài khoản được mở (mo_boi) thì vẫn đi lại được — kể cả tài khoản đứng riêng do quản trị tổng mở.
  if (nguoiQuanLy(req) === null && req.user?.moBoi == null) {
    next(new AppError("Phần này dành cho tài khoản quản lý chuỗi trang", 403));
    return;
  }
  next();
});

/**
 * Ai là người quản lý đứng sau yêu cầu này.
 *
 * Đang XEM THAY một trang thì vai trò của phiên là 'shop', nhưng người thật
 * ngồi trước màn hình vẫn là chủ chuỗi đã mở trang đó — mã của họ nằm ở
 * mo_boi. Không nhìn tới mo_boi thì vào trong một trang là mất hẳn đường sang
 * trang khác: phải quay ra rồi mới mở được trang kế, hai bước qua một màn hình
 * trung gian cho mỗi lần đổi trang.
 *
 * Chỉ phiên do chủ chuỗi MỞ mới mang mo_boi. Tài khoản trang tự đăng nhập bằng
 * mật khẩu của nó có mo_boi rỗng, nên không nhìn thấy trang anh em nào — cách
 * ly giữa các trang vẫn nguyên vẹn.
 */
function nguoiQuanLy(req: { user?: { id: number; role: string; moBoi: number | null; parentId: number | null } }):
  | number
  | null {
  const u = req.user;
  if (!u) return null;
  // Tài khoản quản lý (kể cả khi quản trị tổng đã mở vào một admin con): các trang của CHÍNH tài khoản này.
  if (u.role === "admin_con" || u.role === "admin") return u.id;
  // Một trang được mở từ ngoài vào: "trang anh em" là các trang cùng cha.
  if (u.moBoi != null) return u.parentId;
  return null;
}

/**
 * Người THẬT đang ngồi trước màn hình: người đã mở phiên (mo_boi) nếu có, không thì chính tài khoản đang đăng nhập.
 * Vai trò đọc lại từ database — quyền mở / quay lại dựa trên người thật, không dựa trên tài khoản đang được mở.
 */
async function nguoiThat(req: { user?: { id: number; moBoi: number | null } }) {
  const id = req.user!.moBoi ?? req.user!.id;
  const r = await queryOne<{ id: number; role: string; is_active: boolean }>(
    "SELECT id, role, is_active FROM users WHERE id = $1",
    [id]
  );
  if (!r || !r.is_active) throw new AppError("Không quay lại được, vui lòng đăng nhập lại", 403);
  return r;
}

/**
 * Tài khoản trong PHẠM VI quản lý của người đang xem (để xem báo cáo):
 * chính mình; quản trị tổng (tự đăng nhập) — mọi tài khoản; admin con — các trang của mình.
 */
async function taiKhoanTrongPhamVi(
  req: { user?: { id: number; role: string; moBoi: number | null; parentId: number | null } },
  id: unknown
): Promise<TrangCon> {
  const so = Number(id);
  if (Number.isInteger(so) && so > 0 && (so === req.user!.id || (req.user!.role === "admin" && req.user!.moBoi == null))) {
    const r = await queryOne<TrangCon>("SELECT id, email, name, is_active, created_at FROM users WHERE id = $1", [so]);
    if (r) return r;
    throw new AppError("Không tìm thấy trang này", 404);
  }
  return trangCuaToi(nguoiQuanLy(req)!, id);
}

/**
 * Chặn các việc CHỈ chủ chuỗi thật mới được làm.
 *
 * Xem danh sách và nhảy sang trang khác thì phiên xem thay làm được — đó là
 * đi lại trong chính chuỗi của mình. Nhưng lập trang, đổi tên, khoá, cấp lại
 * mật khẩu thì phải đang đứng ở tài khoản quản lý: đó là quyền trên tài khoản
 * khác, không phải quyền đi lại.
 */
function chanNeuDangXemThay(req: { user?: { moBoi: number | null } }): void {
  if (req.user?.moBoi != null) {
    throw new AppError(
      "Vui lòng quay lại tài khoản quản lý để làm việc này",
      409
    );
  }
}

interface TrangCon {
  id: number;
  email: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

/**
 * Lấy một tài khoản trang CỦA MÌNH.
 *
 * Điều kiện parent_id nằm ngay trong câu lệnh chứ không kiểm sau khi lấy về:
 * kiểm sau thì sớm muộn có đường nào đó quên kiểm, còn điều kiện trong câu
 * lệnh thì không có đường nào đi vòng qua được.
 */
async function trangCuaToi(chaId: number, id: unknown): Promise<TrangCon> {
  const so = Number(id);
  if (!Number.isInteger(so) || so <= 0) {
    throw new AppError("Không tìm thấy trang này", 404);
  }
  const row = await queryOne<TrangCon>(
    `SELECT id, email, name, is_active, created_at
       FROM users WHERE id = $1 AND parent_id = $2`,
    [so, chaId]
  );
  if (!row) throw new AppError("Không tìm thấy trang này", 404);
  return row;
}

/**
 * Bảng tổng quan: mỗi trang một dòng, số liệu thật.
 *
 * Gộp trong một câu lệnh thay vì hỏi vòng từng trang: chuỗi mười trang mà hỏi
 * vòng là mười lượt đi về database cho mỗi lần mở màn hình.
 */
quanLyRouter.get(
  "/trang",
  route(async (req, res) => {
    const rows = await query(
      `SELECT u.id, u.email, u.name, u.is_active, u.plan, u.created_at,
              (SELECT count(*)::int FROM social_accounts s
                WHERE s.user_id = u.id AND s.connected) AS kenh_noi,
              (SELECT count(*)::int FROM social_accounts s
                WHERE s.user_id = u.id AND s.needs_reconnection) AS kenh_can_noi_lai,
              (SELECT count(*)::int FROM orders o
                WHERE o.user_id = u.id AND o.created_at >= ${DAU_NGAY_VN}) AS don_hom_nay,
              (SELECT COALESCE(SUM(o.total), 0)::bigint FROM orders o
                WHERE o.user_id = u.id AND o.created_at >= ${DAU_THANG_VN}
                  AND o.status <> 'cancelled') AS doanh_thu_thang,
              (SELECT count(*)::int FROM conversations c
                WHERE c.user_id = u.id AND c.status = 'waiting_human') AS cho_nguoi,
              /*
               * CHỈ lấy Fanpage đang còn nối.
               *
               * Không lọc theo connected thì thẻ trang hiện "Fanpage: X" ngay
               * cạnh cảnh báo "Chưa nối Fanpage nào" — hai câu chọi nhau trên
               * cùng một thẻ, đã nhìn thấy đúng như vậy trên màn hình thật.
               */
              (SELECT s.display_name FROM social_accounts s
                WHERE s.user_id = u.id AND s.platform = 'facebook' AND s.connected
                ORDER BY s.created_at LIMIT 1) AS ten_fanpage
         FROM users u
        WHERE u.parent_id = $1
        ORDER BY u.created_at`,
      [nguoiQuanLy(req)]
    );
    res.json({ success: true, data: nguoiQuanLy(req) === null ? [] : rows.rows });
  })
);

/**
 * Danh sách cho màn hình QUẢN LÝ dùng chung (src/pages/QuanLy.tsx): chính mình + các trang của mình, cùng MỘT bộ cột
 * với quản trị tổng (services/quan-ly-chung.ts) — hai màn hình không được lệch nhau.
 */
quanLyRouter.get(
  "/danh-sach",
  route(async (req, res) => {
    if (req.user!.role !== "admin_con") throw new AppError("Phần này dành cho tài khoản quản lý chuỗi trang", 403);
    res.json({ success: true, data: await layDanhSachQuanLy({ loai: "chuoi", chaId: req.user!.id }, req.user!.id) });
  })
);

/**
 * TỔNG QUAN tài sản (services/tong-quan.ts): MỘT đường cho cả hai tầng — quản trị tổng thấy cả hệ thống, admin con
 * thấy chuỗi của mình. Cùng một bộ số, cùng một màn hình.
 */
quanLyRouter.get(
  "/tong-quan",
  route(async (req, res) => {
    const vaiTro = req.user!.role;
    if (vaiTro !== "admin" && vaiTro !== "admin_con") throw new AppError("Phần này dành cho tài khoản quản lý", 403);
    const ky = req.query.ky === "thang_truoc" ? "thang_truoc" : "thang_nay";
    res.json({
      success: true,
      data: await layTongQuan(
        vaiTro === "admin" ? { loai: "tong" } : { loai: "chuoi", chaId: req.user!.id },
        req.user!.id,
        ky
      ),
    });
  })
);

/**
 * Trang mà người đang đăng nhập được mở báo cáo / AI điều hành — ĐÚNG luật mở khối não (server/khoi-nao.ts): trang của
 * chính mình · trang thuộc tài khoản con của chủ chuỗi · quản trị tổng. Chủ shop xem được khối não của chính mình (AI điều
 * hành là một phần của khối não, không phải đặc quyền quản lý). Không thuộc → 404 (không xác nhận trang có tồn tại).
 */
async function trangTrongPhamVi(user: { id: number; role: string }, giaTri: unknown): Promise<number> {
  const nao = await moKhoiNao(user, Number(giaTri));
  if (!nao) throw new AppError("Không tìm thấy trang này", 404);
  return nao.trangId;
}

/**
 * Sao kê từng lượt AI của MỘT TRANG — cùng một đường cho cả hai tầng. Quản trị tổng xem mọi trang; admin con chỉ trang
 * thuộc chuỗi mình (không thuộc thì 404, không xác nhận trang có tồn tại).
 */
quanLyRouter.get(
  "/sao-ke-trang",
  route(async (req, res) => {
    const trangId = await trangTrongPhamVi(req.user!, req.query.trangId);
    res.json({
      success: true,
      data: await nhatKyLuot({
        soNgay: 0,
        trangId,
        kyThang: req.query.ky === "thang_truoc" ? "thang_truoc" : "thang_nay",
        // Số theo trang chỉ tính từ mốc (duyệt 05/10/2026) — sao kê cùng kỳ với Tổng quan.
        tuLuc: MOC_THEO_TRANG,
        trang: Number(req.query.trang) || 1,
      }),
    });
  })
);

/**
 * Báo cáo chuỗi 4 khâu của MỘT TRANG (services/bao-cao-chuoi.ts) — cùng một đường, cùng chốt phạm vi với sao kê trang.
 */
quanLyRouter.get(
  "/bao-cao-chuoi",
  route(async (req, res) => {
    const trangId = await trangTrongPhamVi(req.user!, req.query.trangId);
    res.json({ success: true, data: await baoCaoChuoi(trangId, req.query.ky === "thang_truoc" ? "thang_truoc" : "thang_nay") });
  })
);

/** Sức khoẻ từng khâu của MỘT TRANG — code thống kê chấm (services/suc-khoe.ts), cùng chốt phạm vi. */
quanLyRouter.get(
  "/suc-khoe",
  route(async (req, res) => {
    const trangId = await trangTrongPhamVi(req.user!, req.query.trangId);
    res.json({ success: true, data: await sucKhoeTrang(trangId) });
  })
);

// ------------------------------------------------------------------------------------------- AI điều hành (chạy thử)
/*
 * Màn hình chạy thử AI điều hành (chủ dự án 10/10/2026: "bật màn hình chạy thử cho tao kiểm tra"). Chế độ ĐỀ XUẤT:
 * không thực thi gì — chỉ ra đề xuất để chủ shop duyệt / bác. Cùng chốt phạm vi chuỗi như các route khác.
 */
async function chuCuaTrang(trangId: number): Promise<number> {
  const r = await queryOne<{ user_id: number }>("SELECT user_id::int AS user_id FROM trang WHERE id = $1", [trangId]);
  if (!r) throw new AppError("Không tìm thấy trang này", 404);
  return r.user_id;
}

/** Vấn đề do CODE chọn từ bảng sức khoẻ: sự cố trước, rồi chỉ số tụt ảnh hưởng tiền nhiều nhất. Không có → null. */
function vanDeTuDong(sk: Awaited<ReturnType<typeof sucKhoeTrang>>): string | null {
  if (sk.suCo.length) return `Sự cố: ${sk.suCo.map((s) => `${s.ten} (${s.chiTiet})`).join("; ")}`;
  const tut = sk.uuTien.map((ma) => sk.chiSo.find((c) => c.ma === ma)).find((c) => c?.muc === "tut");
  return tut ? `Chỉ số TỤT: ${tut.ten}` : null;
}

/** Sổ bằng chứng của trang — chỉ đọc, KHÔNG gọi AI, không tốn tiền. */
quanLyRouter.get(
  "/dieu-hanh/so",
  route(async (req, res) => {
    const trangId = await trangTrongPhamVi(req.user!, req.query.trangId);
    const chu = await chuCuaTrang(trangId);
    const [so, sk, soDo] = await Promise.all([soBangChungTrang(chu, trangId), sucKhoeTrang(trangId),
      soDoDieuHanh(trangId, new Date(Date.now() - 30 * 86_400_000))]);
    const kho = khoBangChung(so);
    res.json({ success: true, data: {
      bangChung: kho.map((b) => ({ ma: b.ma, nguon: b.nguon, noiDung: b.noiDung, hang: hangBangChung(b, so.luc).hang, lyDoHang: hangBangChung(b, so.luc).lyDo, gioiHan: b.gioiHan ?? [] })),
      khoangTrong: so.khoangTrong,
      vanDeTuDong: vanDeTuDong(sk),
      soDo,
    } });
  })
);

/** Đang chạy theo trang — bấm hai lần không trả tiền hai lần. */
const dangChayDieuHanh = new Set<number>();

/** Chạy thử MỘT lần quy trình AI điều hành (tốn tiền AI — có chốt chống đốt tiền). Kết quả lưu, chờ chủ shop duyệt. */
quanLyRouter.post(
  "/dieu-hanh/chay",
  chanLamDungAI,
  route(async (req, res) => {
    const trangId = await trangTrongPhamVi(req.user!, req.body?.trangId);
    const chu = await chuCuaTrang(trangId);
    const goTay = typeof req.body?.vanDe === "string" ? req.body.vanDe.trim().slice(0, 500) : "";
    if (dangChayDieuHanh.has(trangId)) throw new AppError("Trang này đang chạy thử, chờ lượt trước xong", 409);
    dangChayDieuHanh.add(trangId);
    try {
      const [so, sk] = await Promise.all([soBangChungTrang(chu, trangId), sucKhoeTrang(trangId)]);
      const vanDe = goTay ? `Chủ shop hỏi: ${goTay}` : vanDeTuDong(sk);
      if (!vanDe) throw new AppError("Bảng sức khoẻ không có vấn đề nào cần xử lý — gõ câu hỏi nếu muốn AI điều hành xem", 400);
      // Tiền AI tính vào đúng trang này (sổ AI đọc trang từ ngữ cảnh).
      const k = await chayChoTrang(trangId, () => dieuHanhMotLan({ vanDe, so, cheDo: "de_xuat", goi: goiAiThat(chu) }));
      const id = await luuDeXuat({ userId: chu, trangId, vanDe, k, so });
      res.json({ success: true, data: { id, ketQua: k.ketQua, soLuotAi: k.soLuotAi, tienUsd: k.tienUsd, giay: k.thoiGianMs / 1000 } });
    } finally {
      dangChayDieuHanh.delete(trangId);
    }
  })
);

/** Đề xuất gần đây của trang. */
quanLyRouter.get(
  "/dieu-hanh/de-xuat",
  route(async (req, res) => {
    const trangId = await trangTrongPhamVi(req.user!, req.query.trangId);
    res.json({ success: true, data: await deXuatGanDay(trangId) });
  })
);

/** Duyệt / bác một đề xuất (chế độ đề xuất: duyệt = ghi nhận, CHƯA thực thi gì). */
quanLyRouter.post(
  "/dieu-hanh/de-xuat/:id/quyet",
  route(async (req, res) => {
    const dx = await trangCuaDeXuat(Number(req.params.id));
    if (!dx) throw new AppError("Không tìm thấy đề xuất", 404);
    await trangTrongPhamVi(req.user!, dx.trang_id);
    const ok = await chuShopQuyet({ id: Number(req.params.id), userId: dx.user_id, duyet: req.body?.duyet === true,
      lyDo: typeof req.body?.lyDo === "string" ? req.body.lyDo.trim().slice(0, 1000) : undefined });
    if (!ok) throw new AppError("Đề xuất này đã được quyết rồi", 409);
    res.json({ success: true });
  })
);

/** Chi phí tháng này của CHUỖI — cùng khung với chi phí hệ thống của quản trị tổng, chỉ tiền của chuỗi mình. */
quanLyRouter.get(
  "/chi-phi",
  route(async (req, res) => {
    if (req.user!.role !== "admin_con") throw new AppError("Phần này dành cho tài khoản quản lý chuỗi trang", 403);
    const ngay = Number(req.query.ngay);
    res.json({ success: true, data: await saoKeChuoi(req.user!.id, Number.isFinite(ngay) && ngay >= 0 ? ngay : 0) });
  })
);

/** Từng lượt AI của chuỗi — cùng bộ lọc với quản trị tổng, luôn kẹp trong chuỗi của mình. */
quanLyRouter.get(
  "/chi-phi/luot",
  route(async (req, res) => {
    if (req.user!.role !== "admin_con") throw new AppError("Phần này dành cho tài khoản quản lý chuỗi trang", 403);
    const ngay = Number(req.query.ngay);
    const q = (k: string) => (typeof req.query[k] === "string" ? (req.query[k] as string) : "");
    const tk = q("tk");
    const nhom = q("nhom");
    const viec = q("viec");
    res.json({
      success: true,
      data: await nhatKyLuot({
        soNgay: Number.isFinite(ngay) && ngay >= 0 ? ngay : 0,
        taiKhoan: tk === "" || tk === "chung" ? undefined : Number(tk) || undefined,
        kemCon: q("kemCon") === "1",
        nhom: nhom in NHOM_VIEC || nhom === "chua_phan_loai" ? nhom : undefined,
        viec: viec in VIEC || viec === "chua_phan_loai" ? viec : undefined,
        trang: Number(q("trang")) || 1,
        phamViChuoi: req.user!.id,
      }),
    });
  })
);

/** Nhật ký quản lý của chuỗi: việc chính mình làm và việc làm trên các trang của mình. Cùng dạng với quản trị tổng. */
quanLyRouter.get(
  "/nhat-ky",
  route(async (req, res) => {
    if (req.user!.role !== "admin_con") throw new AppError("Phần này dành cho tài khoản quản lý chuỗi trang", 403);
    const rows = await query(
      `SELECT a.id, a.action, a.target_id, a.target_email, a.detail, a.created_at, u.email AS admin_email
         FROM admin_audit a
         LEFT JOIN users u ON u.id = a.admin_id
        WHERE a.admin_id = $1 OR a.target_id = $1
           OR a.target_id IN (SELECT id FROM users WHERE parent_id = $1)
        ORDER BY a.created_at DESC LIMIT 100`,
      [req.user!.id]
    );
    res.json({ success: true, data: rows.rows });
  })
);


/** Lập thêm một trang. Mật khẩu tạm trả về ĐÚNG MỘT LẦN, sau đó không đọc lại được. */
quanLyRouter.post(
  "/trang",
  route(async (req, res) => {
    chanNeuDangXemThay(req);
    const ten = typeof req.body?.ten === "string" ? req.body.ten : "";
    const taiKhoan = await taoTaiKhoanTrang({ parentId: req.user!.id, tenTrang: ten, matKhau: docMatKhauTuDat(req.body).matKhau });

    await ghiNhatKyQuanTri({
      adminId: req.user!.id,
      targetId: taiKhoan.id,
      targetEmail: taiKhoan.email,
      action: "lap_trang",
      detail: { ten: taiKhoan.name },
    });

    res.status(201).json({
      success: true,
      data: {
        id: taiKhoan.id,
        tenDangNhap: taiKhoan.email,
        name: taiKhoan.name,
        matKhauTam: taiKhoan.matKhauTam,
      },
    });
  })
);

/** Đổi tên hiển thị của một trang. */
quanLyRouter.patch(
  "/trang/:id",
  route(async (req, res) => {
    chanNeuDangXemThay(req);
    // Đổi tên CHÍNH MÌNH cũng qua đây — quản trị tổng sửa được tên của mình, admin con cũng phải được (đồng nhất).
    const trang =
      Number(req.params.id) === req.user!.id
        ? (await queryOne<TrangCon>("SELECT id, email, name, is_active, created_at FROM users WHERE id = $1", [req.user!.id]))!
        : await trangCuaToi(req.user!.id, req.params.id);
    const ten = typeof req.body?.ten === "string" ? req.body.ten.trim() : "";
    if (ten.length < 2) throw new AppError("Tên trang phải có ít nhất 2 ký tự");

    await query("UPDATE users SET name = $1, updated_at = now() WHERE id = $2", [ten, trang.id]);
    await ghiNhatKyQuanTri({
      adminId: req.user!.id,
      targetId: trang.id,
      targetEmail: trang.email,
      action: "doi_ten_trang",
      detail: { truoc: trang.name, sau: ten },
    });
    res.json({ success: true, data: { id: trang.id, name: ten } });
  })
);

/** Khoá hoặc mở khoá một trang. Khoá thì phiên đang mở cũng phải chết ngay. */
quanLyRouter.post(
  "/trang/:id/khoa",
  route(async (req, res) => {
    chanNeuDangXemThay(req);
    const trang = await trangCuaToi(req.user!.id, req.params.id);
    const khoa = req.body?.khoa === true;

    await query("UPDATE users SET is_active = $1, updated_at = now() WHERE id = $2", [
      !khoa,
      trang.id,
    ]);
    /*
     * Khoá mà không xoá phiên thì người đang đăng nhập vẫn dùng tiếp như
     * thường cho tới khi phiên hết hạn — khoá như không khoá.
     */
    if (khoa) await query("DELETE FROM sessions WHERE user_id = $1", [trang.id]);

    await ghiNhatKyQuanTri({
      adminId: req.user!.id,
      targetId: trang.id,
      targetEmail: trang.email,
      action: khoa ? "khoa_trang" : "mo_khoa_trang",
    });
    res.json({ success: true, data: { id: trang.id, is_active: !khoa } });
  })
);

/**
 * Đổi TÊN ĐĂNG NHẬP của một trang.
 *
 * Tên đăng nhập sinh ra từ tên trang lúc lập. Đổi tên trang về sau thì tên
 * đăng nhập vẫn giữ nguyên chữ cũ — trang tên "abc" mà đăng nhập bằng
 * "botsanday-a805@noi-bo.local", chủ chuỗi nhìn vào không khớp được cái nào
 * với cái nào. Vì vậy phải sửa được.
 *
 * Chỉ đổi phần trước dấu @, đuôi giữ nguyên .noi-bo.local: đuôi đó là vùng
 * dành riêng cho tài khoản trang, cho đổi tự do là mở đường tạo một tài khoản
 * trông như email thật của người khác.
 */
quanLyRouter.patch(
  "/trang/:id/ten-dang-nhap",
  route(async (req, res) => {
    chanNeuDangXemThay(req);
    const trang = await trangCuaToi(req.user!.id, req.params.id);

    const goc = rutGonTen(typeof req.body?.ten === "string" ? req.body.ten : "");
    if (goc.length < 3) {
      throw new AppError(
        "Tên đăng nhập phải có ít nhất 3 ký tự, chỉ gồm chữ không dấu, số và dấu gạch ngang"
      );
    }
    const moi = `${goc}@${TEN_MIEN_NOI_BO}`;

    if (moi === trang.email.toLowerCase()) {
      res.json({ success: true, data: { id: trang.id, tenDangNhap: moi } });
      return;
    }

    const trung = await queryOne("SELECT id FROM users WHERE lower(email) = $1", [moi]);
    if (trung) throw new AppError("Tên đăng nhập này đã có trang khác dùng rồi", 409);

    await query("UPDATE users SET email = $1, updated_at = now() WHERE id = $2", [moi, trang.id]);
    /*
     * Đổi tên đăng nhập thì mọi phiên cũ phải chết: người đang đăng nhập bằng
     * tên cũ vẫn dùng tiếp được cho tới khi phiên hết hạn, còn chủ chuỗi thì
     * tưởng đã đổi xong.
     */
    await query("DELETE FROM sessions WHERE user_id = $1", [trang.id]);

    await ghiNhatKyQuanTri({
      adminId: req.user!.id,
      targetId: trang.id,
      targetEmail: moi,
      action: "doi_ten_dang_nhap_trang",
      detail: { truoc: trang.email, sau: moi },
    });
    res.json({ success: true, data: { id: trang.id, tenDangNhap: moi } });
  })
);

/** Cấp lại mật khẩu cho một trang. */
quanLyRouter.post(
  "/trang/:id/mat-khau",
  route(async (req, res) => {
    chanNeuDangXemThay(req);
    const trang = await trangCuaToi(req.user!.id, req.params.id);

    /*
     * Chủ chuỗi tự đặt mật khẩu được, không bắt phải dùng chuỗi ngẫu nhiên.
     *
     * Chuỗi sinh ra kiểu "UCVhzaLEnybEZ9Pn" thì người trông trang phải chép
     * tay từng ký tự, và mất là phải xin lại. Không gửi gì lên thì vẫn sinh
     * ngẫu nhiên như cũ.
     */
    const { matKhau: matKhauTam } = docMatKhauTuDat(req.body);

    await query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2", [
      await hashPassword(matKhauTam),
      trang.id,
    ]);
    // Đổi mật khẩu thì mọi phiên cũ phải chết, kể cả phiên của người vừa mất quyền.
    await query("DELETE FROM sessions WHERE user_id = $1", [trang.id]);

    await ghiNhatKyQuanTri({
      adminId: req.user!.id,
      targetId: trang.id,
      targetEmail: trang.email,
      action: "cap_lai_mat_khau_trang",
    });
    res.json({ success: true, data: { id: trang.id, matKhauTam } });
  })
);

/**
 * Báo cáo chi tiết của MỘT trang, xem từ tài khoản quản lý.
 *
 * Chủ sản phẩm hỏi thẳng: không truy cập vào trang con vẫn xem được số liệu,
 * thống kê, báo cáo chứ? Trước đó là CHƯA — bảng điều hành mới có số đếm tổng,
 * muốn xem kỹ phải bấm Mở trang, tức là rời khỏi tài khoản quản lý.
 *
 * Nay xem ngay tại chỗ. Trả về đúng những con số mà chính trang đó nhìn thấy
 * ở bảng điều khiển và trang thống kê của nó — CÙNG cách tính, chỉ khác là
 * đọc từ ngoài vào và chỉ đọc, không sửa được gì.
 *
 * Kỳ trước tính để biết tăng hay giảm, không gắn cứng phần trăm nào.
 */
quanLyRouter.get(
  "/trang/:id/bao-cao",
  route(async (req, res) => {
    const trang = await taiKhoanTrongPhamVi(req, req.params.id);
    const ngay = [7, 30, 90].includes(Number(req.query.ngay)) ? Number(req.query.ngay) : 7;

    const so = await queryOne<Record<string, string>>(
      `SELECT
         (SELECT COALESCE(SUM(total), 0) FROM orders
           WHERE user_id = $1 AND status <> 'cancelled'
             AND created_at >= now() - ($2 || ' days')::interval)        AS doanh_thu,
         (SELECT count(*) FROM orders
           WHERE user_id = $1
             AND created_at >= now() - ($2 || ' days')::interval)        AS don,
         (SELECT count(*) FROM orders
           WHERE user_id = $1 AND closed_by = 'ai'
             AND created_at >= now() - ($2 || ' days')::interval)        AS don_ai_chot,
         (SELECT count(*) FROM conversations
           WHERE user_id = $1
             AND created_at >= now() - ($2 || ' days')::interval)        AS hoi_thoai,
         (SELECT count(*) FROM conversations
           WHERE user_id = $1 AND handoff_at IS NOT NULL
             AND handoff_at >= now() - ($2 || ' days')::interval)        AS nhuong_nguoi,
         (SELECT count(*) FROM messages
           WHERE user_id = $1 AND sender_type = 'ai'
             AND created_at >= now() - ($2 || ' days')::interval)        AS tin_ai,
         (SELECT count(*) FROM customers
           WHERE user_id = $1
             AND first_seen_at >= now() - ($2 || ' days')::interval)     AS khach_moi,
         (SELECT count(*) FROM customers
           WHERE user_id = $1 AND phone IS NOT NULL
             AND first_seen_at >= now() - ($2 || ' days')::interval)     AS khach_co_sdt`,
      [trang.id, String(ngay)]
    );

    const truoc = await queryOne<Record<string, string>>(
      `SELECT
         (SELECT COALESCE(SUM(total), 0) FROM orders
           WHERE user_id = $1 AND status <> 'cancelled'
             AND created_at >= now() - ($2 || ' days')::interval * 2
             AND created_at <  now() - ($2 || ' days')::interval)        AS doanh_thu,
         (SELECT count(*) FROM orders
           WHERE user_id = $1
             AND created_at >= now() - ($2 || ' days')::interval * 2
             AND created_at <  now() - ($2 || ' days')::interval)        AS don,
         (SELECT count(*) FROM conversations
           WHERE user_id = $1
             AND created_at >= now() - ($2 || ' days')::interval * 2
             AND created_at <  now() - ($2 || ' days')::interval)        AS hoi_thoai`,
      [trang.id, String(ngay)]
    );

    const donGanDay = await query(
      `SELECT o.code, o.customer_name, o.product, o.quantity, o.total,
              o.status, o.closed_by, o.created_at
         FROM orders o WHERE o.user_id = $1
        ORDER BY o.created_at DESC LIMIT 5`,
      [trang.id]
    );

    // Khách đã nhường cho người thật, cũ nhất lên trước vì để lâu là mất khách.
    const canGap = await query(
      `SELECT c.id, c.handoff_reason, c.last_message_at, c.platform,
              cu.name AS customer_name
         FROM conversations c
         LEFT JOIN customers cu ON cu.id = c.customer_id
        WHERE c.user_id = $1 AND c.status = 'waiting_human'
        ORDER BY c.last_message_at ASC LIMIT 5`,
      [trang.id]
    );

    res.json({
      success: true,
      data: {
        trang: { id: trang.id, name: trang.name },
        ngay,
        so: so ?? {},
        truoc: truoc ?? {},
        donGanDay: donGanDay.rows,
        canGap: canGap.rows,
      },
    });
  })
);

/**
 * Xoá hẳn một trang.
 *
 * Chủ chuỗi lập nhầm một trang thì phải tự dọn được, không thì phải đi nhờ
 * quản trị tổng — mà trang bỏ đó vẫn giữ một hồ sơ bên nhà cung cấp.
 *
 * Bắt gõ đúng TÊN TRANG để xác nhận. Nút xoá nằm cạnh nút khoá trong cùng một
 * menu, bấm nhầm là mất sạch hộp thư, đơn hàng, khách hàng và bộ não của trang
 * đó — không lấy lại được.
 */
quanLyRouter.delete(
  "/trang/:id",
  route(async (req, res) => {
    chanNeuDangXemThay(req);
    const trang = await trangCuaToi(req.user!.id, req.params.id);

    // Gõ đúng TÊN ĐĂNG NHẬP (email) để xác nhận — cùng cách với quản trị tổng. Tên trang vẫn nhận (bản cũ).
    const xacNhan = (typeof req.body?.xacNhanTen === "string" ? req.body.xacNhanTen : "").trim();
    if (xacNhan.toLowerCase() !== trang.email.toLowerCase() && xacNhan !== trang.name.trim()) {
      throw new AppError(
        "Gõ đúng tên đăng nhập của trang để xác nhận xoá. Thao tác này không lấy lại được.",
        400
      );
    }

    /*
     * Lấy mã hồ sơ TRƯỚC khi xoá dòng tài khoản, vì xoá xong là mất đường tìm
     * lại. Xoá hồ sơ SAU: xoá hồ sơ trước mà lệnh xoá tài khoản hỏng thì còn
     * lại một tài khoản sống với hồ sơ đã chết.
     */
    const hoSo = await queryOne<{ profile_ref: string | null }>(
      "SELECT profile_ref FROM users WHERE id = $1",
      [trang.id]
    );

    await query("DELETE FROM users WHERE id = $1", [trang.id]);

    let loiXoaHoSo: string | null = null;
    if (hoSo?.profile_ref) {
      try {
        await zernio.xoaHoSo(hoSo.profile_ref);
      } catch (error) {
        // Trang đã xoá xong rồi, ném lỗi ra đây chỉ làm người dùng tưởng thất
        // bại. Nhưng phải GHI LẠI mã hồ sơ, không thì nó nằm lại mà không ai
        // biết để dọn — đúng cách đống hồ sơ rác cũ đã hình thành.
        loiXoaHoSo = error instanceof Error ? error.message : String(error);
        console.error(`[chuỗi] Chưa xoá được hồ sơ ${hoSo.profile_ref}:`, loiXoaHoSo);
      }
    }

    await ghiNhatKyQuanTri({
      adminId: req.user!.id,
      targetId: null,
      targetEmail: trang.email,
      action: "xoa_trang",
      detail: { ten: trang.name, hoSo: hoSo?.profile_ref ?? null, loiXoaHoSo },
    });

    res.json({ success: true, data: { loiXoaHoSo } });
  })
);

/**
 * Mở thẳng vào một trang để làm việc.
 *
 * Vì sao cần: mô hình mỗi trang một tài khoản cho cách ly tuyệt đối, nhưng
 * chủ chuỗi mười trang mà phải nhớ mười tên đăng nhập và đăng xuất đăng nhập
 * mười lần mỗi sáng thì không ai dùng nổi. Mở từ đây là MỘT lần đăng nhập mà
 * dữ liệu vẫn tách hẳn — không có gì dùng chung, chỉ có quyền bước vào.
 *
 * Phiên cũ của chính người mở bị xoá chứ không giữ song song: giữ hai phiên
 * sống cùng lúc là để lại một mã phiên còn hiệu lực mà không ai cầm.
 *
 * ĐANG Ở TRONG MỘT TRANG cũng mở thẳng sang trang khác được.
 *
 * Trước đây chặn: đang xem thay thì phải quay ra tài khoản quản lý rồi mới mở
 * được trang kế. Chủ chuỗi mười trang đi một vòng kiểm hàng phải qua màn hình
 * trung gian chín lần — hai phần rời hẳn nhau. Nay nhảy thẳng, và mo_boi giữ
 * nguyên là chủ chuỗi nên không có chuyện lồng nhau: đường quay ra vẫn chỉ
 * đúng một bậc.
 */
quanLyRouter.post(
  "/trang/:id/mo",
  route(async (req, res) => {
    /*
     * Quản trị tổng mở được MỌI tài khoản không phải quản trị; admin con chỉ mở được trang của mình
     * (chủ dự án 04/10/2026: hai tầng cùng tính năng, chỉ khác phạm vi). Quyền xét theo NGƯỜI THẬT (mo_boi).
     */
    const that = await nguoiThat(req);
    const chaId = that.id;
    let trang: TrangCon;
    if (that.role === "admin") {
      const so = Number(req.params.id);
      const r = Number.isInteger(so) && so > 0
        ? await queryOne<TrangCon>("SELECT id, email, name, is_active, created_at FROM users WHERE id = $1 AND role <> 'admin'", [so])
        : null;
      if (!r) throw new AppError("Không tìm thấy trang này", 404);
      trang = r;
    } else if (that.role === "admin_con") {
      trang = await trangCuaToi(chaId, req.params.id);
    } else {
      throw new AppError("Không tìm thấy trang này", 404);
    }
    if (!trang.is_active) {
      throw new AppError("Trang này đang bị khoá, vui lòng mở khoá trước", 409);
    }
    if (trang.id === req.user!.id) {
      throw new AppError("Bạn đang ở trong trang này rồi", 409);
    }

    const phienCu = req.sessionId;
    await createSession(res, trang.id, chaId);
    if (phienCu) await query("DELETE FROM sessions WHERE id = $1", [phienCu]);

    await ghiNhatKyQuanTri({
      adminId: chaId,
      targetId: trang.id,
      targetEmail: trang.email,
      action: "mo_trang",
    });

    res.json({ success: true, data: { id: trang.id, name: trang.name } });
  })
);

/** Quay lại tài khoản quản lý sau khi xem thay một trang. */
quanLyRouter.post(
  "/quay-lai",
  route(async (req, res) => {
    const moBoi = req.user!.moBoi;
    if (moBoi === null) {
      throw new AppError("Bạn đang ở tài khoản của chính mình", 400);
    }

    /*
     * Kiểm lại quan hệ cha con ngay lúc quay ra, không chỉ tin vào mo_boi đã
     * ghi lúc mở. Giữa hai thời điểm đó tài khoản quản lý có thể đã bị khoá,
     * bị hạ vai trò, hoặc trang này đã được chuyển sang người khác.
     */
    // Cùng luật với phiên (auth.ts): quản trị tổng — mọi tài khoản không phải quản trị; admin con — trang của mình.
    const cha = await queryOne<{ id: number; email: string; name: string }>(
      `SELECT c.id, c.email, c.name
         FROM users c, users t
        WHERE c.id = $1 AND t.id = $2 AND c.is_active = TRUE
          AND ((c.role = 'admin' AND t.role <> 'admin')
               OR (c.role = 'admin_con' AND t.parent_id = c.id))`,
      [moBoi, req.user!.id]
    );
    if (!cha) {
      throw new AppError("Không quay lại được, vui lòng đăng nhập lại", 403);
    }

    const phienCu = req.sessionId;
    await createSession(res, cha.id, null);
    if (phienCu) await query("DELETE FROM sessions WHERE id = $1", [phienCu]);

    await ghiNhatKyQuanTri({
      adminId: cha.id,
      targetId: req.user!.id,
      targetEmail: req.user!.email,
      action: "roi_trang",
    });

    res.json({ success: true, data: { id: cha.id, name: cha.name } });
  })
);
