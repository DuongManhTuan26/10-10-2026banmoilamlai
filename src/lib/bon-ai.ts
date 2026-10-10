/**
 * 4 AI CỐ ĐỊNH của mọi khối não (docs/khoi-nao.md) — nguồn DUY NHẤT cho giao diện: thứ tự, tên, chức năng, đường dẫn,
 * biểu tượng và MÀU. Mỗi AI một màu riêng, đi theo nó ở mọi nơi (thanh menu, tổng quan, đầu trang, khung) để nhìn màu là
 * biết đang ở AI nào. Màu lấy từ bộ khung có sẵn (index.css: .khung-muc + .mau-*), không đặt màu mới.
 */
import type { MaAi } from './api';

export interface MotAi {
  so: 1 | 2 | 3 | 4;
  ma: MaAi;
  /** Mã khâu ở bảng sức khoẻ (server/services/suc-khoe.ts). */
  khau: 'noi_dung' | 'quang_cao' | 'ban_hang' | 'dieu_hanh';
  ten: string;
  /** Chức năng cố định — một dòng. */
  chucNang: string;
  duong: string;
  bieuTuong: string;
  /** Lớp màu của khung (.mau-*). */
  mau: 'mau-xanh' | 'mau-vang' | 'mau-luc' | 'mau-tim';
  /** Lớp MIỀN (index.css .mien-*): đặt ở vùng nội dung là mọi màu chính bên trong theo màu AI này. */
  mien: 'mien-noi-dung' | 'mien-quang-cao' | 'mien-ban-hang' | 'mien-dieu-hanh';
  /** Mã màu cho chỗ không dùng được lớp (viền, chữ nhỏ). Khớp đúng .mien-* / .mau-* trong index.css. */
  hex: string;
}

/*
 * MÀU THEO MIỀN — kế hoạch giao diện lượt 2, bảng A (chủ dự án đồng ý): ④ Điều hành xanh ngọc (màu thương hiệu, cũng là
 * Tổng quan khối não) · ② Quảng cáo vàng · ③ Bán hàng xanh lục · ① Nội dung tím. Đã thống nhất thì không tự đổi.
 */
export const BON_AI: readonly MotAi[] = [
  { so: 1, ma: 'content', khau: 'noi_dung', ten: 'AI Nội dung', chucNang: 'Viết bài, tạo ảnh / video, lên lịch và đăng bài',
    duong: '/noi-dung', bieuTuong: 'post_add', mau: 'mau-tim', mien: 'mien-noi-dung', hex: '#a78bfa' },
  { so: 2, ma: 'ads', khau: 'quang_cao', ten: 'AI Quảng cáo', chucNang: 'Lên chiến lược, chạy quảng cáo, tối ưu ngân sách trong trần',
    duong: '/quang-cao', bieuTuong: 'campaign', mau: 'mau-vang', mien: 'mien-quang-cao', hex: '#facc15' },
  { so: 3, ma: 'sales', khau: 'ban_hang', ten: 'AI Bán hàng', chucNang: 'Tư vấn, thuyết phục, chốt đơn, báo đơn qua Telegram',
    duong: '/ban-hang', bieuTuong: 'smart_toy', mau: 'mau-luc', mien: 'mien-ban-hang', hex: '#34d399' },
  { so: 4, ma: 'analytics', khau: 'dieu_hanh', ten: 'AI Điều hành', chucNang: 'Chấm hiệu suất 3 AI mỗi ngày, giữ cái tốt, sửa cái chưa tốt',
    duong: '/dieu-hanh', bieuTuong: 'monitoring', mau: 'mau-xanh', mien: 'mien-dieu-hanh', hex: '#22d3ee' },
] as const;

/** Miền của một đường dẫn: 4 AI theo màu của nó, Tổng quan khối não = ④ Điều hành, còn lại là trang hệ thống. */
export function mienTheoDuong(duong: string): string {
  const ai = BON_AI.find((a) => duong === a.duong || duong.startsWith(`${a.duong}/`));
  if (ai) return ai.mien;
  if (duong === '/') return 'mien-dieu-hanh';
  return 'mien-he-thong';
}

export const aiTheoMa = (ma: MaAi): MotAi => BON_AI.find((a) => a.ma === ma)!;

/**
 * Khuôn 4 thẻ dùng chung cho cả 4 AI — cùng tên, cùng thứ tự, THEO ĐÚNG TRÌNH TỰ LÀM VIỆC (chủ dự án 10/10/2026):
 *   1. Hướng dẫn AI — AI phải biết vai trò, nhiệm vụ, cách làm TRƯỚC
 *   2. Đang làm     — rồi mới làm việc
 *   3. Kết quả      — rồi xem kết quả tạo ra
 *   4. Nhật ký      — cuối cùng xem lại sự thay đổi
 * Thẻ đầu tiên là thẻ mở mặc định.
 */
export const BON_THE = [
  { ma: 'huong-dan', ten: 'Hướng dẫn AI', moTa: 'Vai trò, lời dặn, cách làm', bieuTuong: 'school', hex: '#60a5fa' },
  { ma: 'dang-lam', ten: 'Đang làm', moTa: 'Việc AI đang xử lý', bieuTuong: 'play_circle', hex: '#f472b6' },
  { ma: 'ket-qua', ten: 'Kết quả', moTa: 'Số liệu AI tạo ra', bieuTuong: 'insights', hex: '#fb923c' },
  { ma: 'nhat-ky', ten: 'Nhật ký', moTa: 'Thay đổi theo thời gian', bieuTuong: 'history', hex: '#94a3b8' },
] as const;
/*
 * Màu 4 bước (kế hoạch lượt 2, mục C): lấy từ bảng màu theo mức quan trọng — lam · hồng · cam · xám; bước đang mở tô
 * đặc. Không dùng lục / vàng / tím / xanh ngọc để không lẫn với màu miền của 4 AI.
 */
export type MaThe = (typeof BON_THE)[number]['ma'];
