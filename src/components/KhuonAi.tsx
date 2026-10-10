import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { clsx } from 'clsx';
import { BON_THE, aiTheoMa, type MaThe } from '../lib/bon-ai';
import type { MaAi } from '../lib/api';

/**
 * KHUÔN CHUNG của 4 AI trong khối não (docs/khoi-nao.md) — cùng một đầu trang, cùng 4 thẻ theo cùng thứ tự:
 *   Hướng dẫn AI · Đang làm · Kết quả · Nhật ký (đúng trình tự làm việc — src/lib/bon-ai.ts)
 * Học xong một AI là biết ba AI còn lại. Thẻ đang mở ghi trên địa chỉ (?the=) để tải lại / gửi đường dẫn vẫn đúng chỗ.
 *
 * Tên AI đã ở thanh trên cùng (màu miền); khối liền mạch 4 AI thể hiện ở thanh menu (một khung bao trọn 4 AI).
 */
export default function KhuonAi({
  ai,
  the,
  phuDe,
}: {
  ai: MaAi;
  /** Nội dung từng thẻ. */
  the: Record<MaThe, ReactNode>;
  /** Một dòng trạng thái nhỏ cạnh tên (vd. "3 chiến dịch đang chạy"). */
  phuDe?: ReactNode;
}) {
  const motAi = aiTheoMa(ai);
  const [tim, datTim] = useSearchParams();
  const theMo = (BON_THE.find((t) => t.ma === tim.get('the'))?.ma ?? BON_THE[0].ma) as MaThe;

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto w-full">
      {/*
        Đầu trang MỘT hàng (rà soát lượt 2, T2): số + tên + chức năng cố định. Bỏ dải 1→2→3→4 (trùng thanh menu) và tên
        trang (đã ở thanh trên cùng). Màu = màu miền của AI này.
      */}
      <div className="flex items-center gap-3 mb-4 min-w-0">
        <span
          className="w-10 h-10 rounded-xl flex items-center justify-center font-mono text-lg font-black shrink-0"
          style={{ color: motAi.hex, border: `1px solid ${motAi.hex}99`, background: `${motAi.hex}1f` }}
        >
          {motAi.so}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
            <h2 className="text-base md:text-xl font-bold text-on-surface">{motAi.chucNang}</h2>
            {phuDe}
          </div>
        </div>
      </div>

      {/*
        4 BƯỚC — cùng tên, cùng thứ tự, cùng màu ở mọi AI (Hướng dẫn lam · Đang làm hồng · Kết quả cam · Nhật ký xám).
        Bước đang mở tô đặc; bước khác viền màu của nó. Số thứ tự nhắc trình tự làm việc.
      */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3 mb-6" role="tablist">
        {BON_THE.map((t, i) => {
          const mo = theMo === t.ma;
          return (
            <button
              key={t.ma}
              role="tab"
              aria-selected={mo}
              onClick={() => datTim((p) => { const m = new URLSearchParams(p); m.set('the', t.ma); return m; }, { replace: true })}
              className={clsx('flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition', !mo && 'hover:brightness-125')}
              style={mo
                ? { background: t.hex, borderColor: t.hex, color: '#0b1417' }
                : { background: `${t.hex}12`, borderColor: `${t.hex}59`, color: t.hex }}
            >
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center font-mono text-sm font-black shrink-0"
                style={mo ? { background: '#0b141726', color: '#0b1417' } : { border: `1px solid ${t.hex}80` }}
              >
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-bold whitespace-nowrap">
                  {/* Biểu tượng ẩn trên điện thoại để chữ bước không bị cắt (375px). */}
                  {/* Bọc ngoài: lớp `hidden` (trong @layer) không thắng được CSS phông biểu tượng (ngoài layer) nếu gắn thẳng. */}
                  <span className="hidden sm:inline-flex"><span className="material-symbols-outlined text-[18px]">{t.bieuTuong}</span></span>
                  {t.ten}
                </span>
                <span className={clsx('hidden md:block text-xs truncate', mo ? 'opacity-80' : 'text-on-surface-variant')}>{t.moTa}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div>{the[theMo]}</div>
    </div>
  );
}
