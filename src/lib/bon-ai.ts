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
  mau: 'mau-xanh' | 'mau-cam' | 'mau-luc' | 'mau-tim';
  /** Mã màu cho chỗ không dùng được lớp (viền, chữ nhỏ). Khớp đúng .mau-* trong index.css. */
  hex: string;
}

export const BON_AI: readonly MotAi[] = [
  { so: 1, ma: 'content', khau: 'noi_dung', ten: 'AI Nội dung', chucNang: 'Viết bài, tạo ảnh / video, lên lịch và đăng bài',
    duong: '/noi-dung', bieuTuong: 'post_add', mau: 'mau-xanh', hex: '#22d3ee' },
  { so: 2, ma: 'ads', khau: 'quang_cao', ten: 'AI Quảng cáo', chucNang: 'Lên chiến lược, chạy quảng cáo, tối ưu ngân sách trong trần',
    duong: '/quang-cao', bieuTuong: 'campaign', mau: 'mau-cam', hex: '#fbbf24' },
  { so: 3, ma: 'sales', khau: 'ban_hang', ten: 'AI Bán hàng', chucNang: 'Tư vấn, thuyết phục, chốt đơn, báo đơn qua Telegram',
    duong: '/ban-hang', bieuTuong: 'smart_toy', mau: 'mau-luc', hex: '#34d399' },
  { so: 4, ma: 'analytics', khau: 'dieu_hanh', ten: 'AI Điều hành', chucNang: 'Chấm hiệu suất 3 AI mỗi ngày, giữ cái tốt, sửa cái chưa tốt',
    duong: '/dieu-hanh', bieuTuong: 'monitoring', mau: 'mau-tim', hex: '#a78bfa' },
] as const;

export const aiTheoMa = (ma: MaAi): MotAi => BON_AI.find((a) => a.ma === ma)!;

/** Khuôn 4 thẻ dùng chung cho cả 4 AI — cùng tên, cùng thứ tự. */
export const BON_THE = [
  { ma: 'ket-qua', ten: 'Kết quả', bieuTuong: 'insights' },
  { ma: 'dang-lam', ten: 'Đang làm', bieuTuong: 'play_circle' },
  { ma: 'huong-dan', ten: 'Hướng dẫn AI', bieuTuong: 'school' },
  { ma: 'nhat-ky', ten: 'Nhật ký', bieuTuong: 'history' },
] as const;
export type MaThe = (typeof BON_THE)[number]['ma'];
