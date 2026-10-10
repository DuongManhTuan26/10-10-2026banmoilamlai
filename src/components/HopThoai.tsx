import { useEffect, type ReactNode } from 'react';
import clsx from 'clsx';

/**
 * Khung cửa sổ DÙNG CHUNG cho mọi hộp thoại của app.
 *
 * Vì sao có: đã bị chê 01/10/2026 — "các phần giao diện không hề đồng nhất về
 * kích thước, sao không cho mở rộng hết màn hình mà thu hẹp bé lại rất khó
 * nhìn". Đo lúc đó: 15 hộp thoại, 9 kiểu chiều rộng khác nhau từ 400 tới 900px,
 * mỗi cái một kiểu đầu, một kiểu nút.
 *
 * Nay chỉ còn HAI cỡ, cùng một kiểu đầu / thân / chân:
 *   - 'lon': việc nhiều bước, nhiều trường (soạn bài, tạo quảng cáo, kịch bản...)
 *            — gần trọn màn hình: rộng tới 1800px (chủ dự án 04/10/2026: màn hình rộng còn trống 35%), cao 92%.
 *   - 'vua': biểu mẫu ngắn, xác nhận — rộng tới 880px.
 */

export type CoHopThoai = 'vua' | 'lon';

/** Nút chính (một nút mỗi hộp thoại) và nút phụ — cùng chiều cao, cùng cỡ chữ. */
export const NUT_CHINH =
  'h-12 px-8 rounded-xl bg-primary text-on-primary text-base font-bold inline-flex items-center justify-center gap-2 hover:brightness-110 transition disabled:opacity-50 disabled:cursor-not-allowed';
/** Việc có rủi ro (bật tự động, xoá...) — vàng cảnh báo, không lẫn với nút thường. */
export const NUT_CANH_BAO =
  'h-12 px-8 rounded-xl bg-amber-400 text-black text-base font-bold inline-flex items-center justify-center gap-2 hover:brightness-110 transition disabled:opacity-50 disabled:cursor-not-allowed';
export const NUT_PHU =
  'h-12 px-6 rounded-xl border border-outline text-on-surface text-base font-bold inline-flex items-center justify-center gap-2 hover:bg-surface-container-highest transition disabled:opacity-50';

/** Nhãn ô nhập và ô nhập — một kiểu cho mọi biểu mẫu trong hộp thoại. */
export const NHAN_O = 'block text-sm font-semibold text-on-surface mb-2';
export const O_NHAP =
  'w-full h-12 px-4 rounded-xl bg-surface-container-high border border-outline-variant text-base text-on-surface focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none transition';

const CO: Record<CoHopThoai, string> = {
  lon: 'w-[min(1800px,96vw)] h-[min(92vh,1100px)]',
  vua: 'w-[min(880px,94vw)] max-h-[90vh]',
};

export default function HopThoai({
  tieuDe,
  phuDe,
  bieuTuong,
  onDong,
  co = 'lon',
  dauPhu,
  chan,
  dongKhiBamNgoai = true,
  children,
}: {
  tieuDe: ReactNode;
  phuDe?: ReactNode;
  /** Tên biểu tượng Material Symbols ở đầu hộp thoại. */
  bieuTuong?: string;
  onDong: () => void;
  co?: CoHopThoai;
  /** Vùng cố định ngay dưới đầu hộp thoại, không trôi theo nội dung (thanh bước 1-2-3...). */
  dauPhu?: ReactNode;
  /** Hàng nút cuối hộp thoại — luôn nằm cố định ở đáy, không trôi theo nội dung. */
  chan?: ReactNode;
  /** Biểu mẫu dài đang nhập dở thì không đóng khi lỡ bấm ra ngoài. */
  dongKhiBamNgoai?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    const phim = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDong();
    };
    window.addEventListener('keydown', phim);
    return () => window.removeEventListener('keydown', phim);
  }, [onDong]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={dongKhiBamNgoai ? onDong : undefined} />
      <div
        role="dialog"
        aria-modal="true"
        className={clsx(
          // Quầng sáng theo màu MIỀN đang mở (index.css .mien-*), không ghi cứng xanh ngọc.
          'relative flex flex-col overflow-hidden rounded-2xl border border-outline-variant nen-app shadow-[0_0_40px_color-mix(in_srgb,var(--color-primary)_12%,transparent)]',
          CO[co]
        )}
      >
        <div className="flex items-center gap-4 px-6 sm:px-8 py-5 border-b border-outline-variant bg-surface-container shrink-0">
          {bieuTuong && (
            <span className="w-11 h-11 rounded-xl bg-primary/15 text-primary flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[24px]">{bieuTuong}</span>
            </span>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl font-bold text-on-surface leading-tight truncate">{tieuDe}</h2>
            {phuDe && <p className="text-sm text-on-surface-variant mt-1">{phuDe}</p>}
          </div>
          <button
            type="button"
            onClick={onDong}
            aria-label="Đóng"
            className="w-11 h-11 rounded-full flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest transition shrink-0"
          >
            <span className="material-symbols-outlined text-[26px]">close</span>
          </button>
        </div>

        {dauPhu && <div className="shrink-0 border-b border-outline-variant bg-surface-container-low px-6 sm:px-8 py-4">{dauPhu}</div>}

        <div className="flex-1 min-h-0 overflow-y-auto px-6 sm:px-8 py-6">{children}</div>

        {chan && (
          <div className="flex items-center justify-end gap-3 px-6 sm:px-8 py-4 border-t border-outline-variant bg-surface-container shrink-0">
            {chan}
          </div>
        )}
      </div>
    </div>
  );
}
