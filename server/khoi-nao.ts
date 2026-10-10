/**
 * KHỐI NÃO CỦA YÊU CẦU — chỗ DUY NHẤT trả lời "yêu cầu này làm việc cho khối não (trang) nào" (docs/khoi-nao.md).
 *
 * Giao diện gửi trang đang chọn qua đầu `X-Trang`. Máy chủ KHÔNG tin con số đó: kiểm người đăng nhập có quyền mở trang
 * ấy không (trang của mình · trang thuộc tài khoản con của chủ chuỗi · quản trị tổng). Không gửi → trang mặc định của
 * chính tài khoản (tài khoản một trang không phải chọn gì). Bản cũ gửi kênh (`X-Kenh` / accountId) vẫn được hiểu.
 *
 * Route khối não lấy trang bằng `naoCua(req)` — không tự đoán, không lọc dữ liệu khối não bằng req.user.id.
 */
import type { NextFunction, Request, Response } from "express";
import { queryOne } from "./db.js";
import { AppError } from "./http.js";
import { layTrangDangChon } from "./services/trang.js";

export interface KhoiNao {
  trangId: number;
  /** Chủ tài khoản của trang — user_id ghi kèm dữ liệu của khối não (tiền, quyền). */
  chuId: number;
  ten: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Khối não của yêu cầu; undefined = người này chưa có / chưa chọn trang nào. */
      nao?: KhoiNao;
    }
  }
}

/** Trang này có nằm trong phạm vi người đăng nhập được mở không. null = không (hoặc không tồn tại). */
export async function moKhoiNao(
  user: { id: number; role: string },
  trangId: number
): Promise<KhoiNao | null> {
  if (!Number.isSafeInteger(trangId) || trangId <= 0) return null;
  const r = await queryOne<{ id: number; user_id: number; ten: string; parent_id: number | null }>(
    `SELECT t.id::int AS id, t.user_id::int AS user_id, t.ten, u.parent_id::int AS parent_id
       FROM trang t JOIN users u ON u.id = t.user_id
      WHERE t.id = $1 AND u.is_active`,
    [trangId]
  );
  if (!r) return null;
  const duoc =
    r.user_id === user.id ||
    user.role === "admin" ||
    (user.role === "admin_con" && r.parent_id === user.id);
  return duoc ? { trangId: r.id, chuId: r.user_id, ten: r.ten } : null;
}

/** Gắn req.nao cho mọi yêu cầu /api đã đăng nhập. Trang gửi lên mà không được mở → 404 ngay, không rơi về trang khác. */
export async function ganKhoiNao(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next();
    const xTrang = req.get("x-trang");
    if (xTrang) {
      const nao = await moKhoiNao(req.user, Number(xTrang));
      if (!nao) return next(new AppError("Không tìm thấy trang bán hàng này", 404));
      req.nao = nao;
      return next();
    }
    const kenh =
      req.get("x-kenh") ||
      (typeof req.query.accountId === "string" ? req.query.accountId : undefined) ||
      (typeof req.body?.accountId === "string" ? (req.body.accountId as string) : undefined);
    const trangId = await layTrangDangChon(req.user.id, kenh ?? null);
    if (trangId) req.nao = (await moKhoiNao(req.user, trangId)) ?? undefined;
    next();
  } catch (error) {
    next(error);
  }
}

/** Khối não của yêu cầu — route khối não gọi hàm này; chưa có trang thì báo rõ, không đoán. */
export function naoCua(req: Request): KhoiNao {
  if (!req.nao) throw new AppError("Chưa chọn trang bán hàng nào — chọn trang ở đầu thanh menu", 409);
  return req.nao;
}
