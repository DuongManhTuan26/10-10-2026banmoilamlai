/**
 * Thư viện ảnh sản phẩm / nhân vật của từng Trang (migration 038).
 *
 * Lưu nguyên tệp: kho media của nhà cung cấp chỉ giữ tệp tạm 7 ngày. Mỗi lần dùng, đưa tệp lên kho
 * lại để có địa chỉ mới cho mô hình AI đọc (dungAnh).
 */

import { query, queryOne } from "../db.js";
import { AppError } from "../http.js";
import { hoanDiaChiKho, laDiaChiKho } from "./media-proxy.js";
import * as zernio from "./zernio.js";

export type LoaiThuVien = "san_pham" | "nhan_vat";
export const TOI_DA_MOI_TRANG = 60;
export const TOI_DA_BYTE = 5 * 1024 * 1024;
const KIEU_HOP_LE = ["image/jpeg", "image/png", "image/webp"];

export interface MucThuVien {
  id: number;
  loai: LoaiThuVien;
  ten: string;
  created_at: string;
}

export function docLoai(v: unknown): LoaiThuVien {
  if (v === "san_pham" || v === "nhan_vat") return v;
  throw new AppError("Chọn loại: sản phẩm hoặc nhân vật.", 400);
}

export function docTen(v: unknown): string {
  const ten = typeof v === "string" ? v.trim().slice(0, 80) : "";
  if (!ten) throw new AppError("Đặt tên cho ảnh để lần sau dễ tìm.", 400);
  return ten;
}

export async function dsThuVien(trangId: number | null): Promise<MucThuVien[]> {
  if (!trangId) return [];
  const r = await query<MucThuVien>(
    `SELECT id, loai, ten, created_at FROM thu_vien_anh WHERE trang_id = $1 ORDER BY loai, created_at DESC`,
    [trangId]
  );
  return r.rows;
}

/** Lấy tệp từ kho (ảnh vừa tải lên / AI vừa vẽ) rồi lưu nguyên tệp vào thư viện. */
export async function themVaoThuVien(p: { userId: number; trangId: number; loai: LoaiThuVien; ten: string; url: string }): Promise<MucThuVien> {
  const that = hoanDiaChiKho(p.url);
  if (!laDiaChiKho(that)) throw new AppError("Ảnh không hợp lệ.", 400);
  const dem = await queryOne<{ n: string }>("SELECT count(*)::text AS n FROM thu_vien_anh WHERE trang_id = $1", [p.trangId]);
  if (Number(dem?.n ?? 0) >= TOI_DA_MOI_TRANG) {
    throw new AppError(`Thư viện đã đủ ${TOI_DA_MOI_TRANG} ảnh. Xoá bớt ảnh cũ rồi thêm.`, 400);
  }
  const r = await fetch(that, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new AppError(`Không tải được ảnh (HTTP ${r.status}).`, 502);
  const kieu = (r.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!KIEU_HOP_LE.includes(kieu)) throw new AppError("Chỉ nhận ảnh JPG, PNG hoặc WebP.", 400);
  const du = Buffer.from(await r.arrayBuffer());
  if (du.length > TOI_DA_BYTE) throw new AppError("Ảnh quá lớn (tối đa 5 MB).", 400);
  const moi = await queryOne<MucThuVien>(
    `INSERT INTO thu_vien_anh (user_id, trang_id, loai, ten, kieu, du_lieu)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, loai, ten, created_at`,
    [p.userId, p.trangId, p.loai, p.ten, kieu, du]
  );
  return moi!;
}

/** Tệp ảnh để hiện trên giao diện — chỉ khối não (trang) của ảnh đọc được. */
export async function docAnhThuVien(trangId: number, id: number): Promise<{ kieu: string; du_lieu: Buffer }> {
  const r = await queryOne<{ kieu: string; du_lieu: Buffer }>(
    "SELECT kieu, du_lieu FROM thu_vien_anh WHERE id = $1 AND trang_id = $2",
    [id, trangId]
  );
  if (!r) throw new AppError("Không tìm thấy ảnh trong thư viện.", 404);
  return r;
}

/** Đưa ảnh thư viện lên kho để AI đọc được; trả địa chỉ kho mới (tệp tạm của kho sống 7 ngày). */
export async function dungAnh(trangId: number, id: number): Promise<string> {
  const r = await queryOne<{ kieu: string; du_lieu: Buffer; ten: string }>(
    "SELECT kieu, du_lieu, ten FROM thu_vien_anh WHERE id = $1 AND trang_id = $2",
    [id, trangId]
  );
  if (!r) throw new AppError("Không tìm thấy ảnh trong thư viện.", 404);
  const duoi = r.kieu === "image/jpeg" ? "jpg" : r.kieu.split("/")[1];
  const presign = await zernio.presignMedia({ filename: `thu-vien-${id}-${Date.now()}.${duoi}`, contentType: r.kieu, size: r.du_lieu.length });
  const dua = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": r.kieu },
    body: new Uint8Array(r.du_lieu),
    signal: AbortSignal.timeout(120_000),
  });
  if (!dua.ok) throw new AppError(`Không đưa được ảnh lên kho (HTTP ${dua.status}).`, 502);
  return presign.publicUrl;
}

export async function xoaThuVien(trangId: number, id: number): Promise<void> {
  await query("DELETE FROM thu_vien_anh WHERE id = $1 AND trang_id = $2", [id, trangId]);
}
