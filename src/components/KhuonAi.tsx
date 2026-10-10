import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { clsx } from 'clsx';
import { useKhoiNao } from '../lib/ActivePage';
import { BON_AI, BON_THE, aiTheoMa, type MaThe } from '../lib/bon-ai';
import type { MaAi } from '../lib/api';

/**
 * KHUÔN CHUNG của 4 AI trong khối não (docs/khoi-nao.md) — cùng một đầu trang, cùng 4 thẻ theo cùng thứ tự:
 *   Kết quả · Đang làm · Hướng dẫn AI · Nhật ký
 * Học xong một AI là biết ba AI còn lại. Thẻ đang mở ghi trên địa chỉ (?the=) để tải lại / gửi đường dẫn vẫn đúng chỗ.
 *
 * Dải 4 AI ở đầu trang nhắc rằng đây là MỘT khối liền mạch: AI đang xem sáng màu của nó, ba AI kia mờ, bấm để sang.
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
  const { nao } = useKhoiNao();
  const [tim, datTim] = useSearchParams();
  const theMo = (BON_THE.find((t) => t.ma === tim.get('the'))?.ma ?? 'ket-qua') as MaThe;

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto w-full">
      {/* Dải khối não: 4 AI liền mạch, AI đang xem sáng màu. */}
      <div className="flex items-center gap-1.5 md:gap-2 mb-5 overflow-x-auto no-scrollbar">
        {BON_AI.map((a, i) => (
          <div key={a.ma} className="flex items-center gap-1.5 md:gap-2 shrink-0">
            <Link
              to={a.duong}
              className={clsx(
                'flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[12px] font-bold transition',
                a.ma === ai ? '' : 'opacity-45 hover:opacity-90'
              )}
              style={{ color: a.hex, borderColor: `${a.hex}${a.ma === ai ? 'aa' : '40'}`, background: a.ma === ai ? `${a.hex}1f` : 'transparent' }}
            >
              <span className="font-mono">{a.so}</span>
              <span className="hidden sm:inline">{a.ten.replace('AI ', '')}</span>
            </Link>
            {i < BON_AI.length - 1 && <span className="material-symbols-outlined text-[16px] text-on-surface-variant">arrow_forward</span>}
          </div>
        ))}
        <span className="material-symbols-outlined text-[16px] text-on-surface-variant shrink-0" title="AI điều hành quay lại chỉ đạo 3 AI">replay</span>
      </div>

      {/* Đầu trang: số + tên + chức năng cố định + trang đang làm việc. */}
      <div className={clsx('khung-muc mb-5', motAi.mau)} style={{ paddingBottom: 0 }}>
        <div className="dau-muc flex flex-col md:flex-row md:items-center justify-between gap-3" style={{ marginBottom: 0, borderBottom: 'none', borderRadius: 17 }}>
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="w-11 h-11 rounded-xl flex items-center justify-center font-mono text-xl font-black shrink-0"
              style={{ color: motAi.hex, border: `1px solid ${motAi.hex}99`, background: `${motAi.hex}1f` }}
            >
              {motAi.so}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl md:text-3xl font-bold text-on-surface tracking-tight">{motAi.ten}</h1>
                {phuDe}
              </div>
              <p className="text-on-surface-variant text-sm">{motAi.chucNang}</p>
            </div>
          </div>
          {nao && (
            <div className="text-sm text-on-surface-variant md:text-right shrink-0">
              Khối não của trang <b className="text-on-surface">{nao.ten}</b>
            </div>
          )}
        </div>
      </div>

      {/* 4 thẻ — cùng tên, cùng thứ tự ở mọi AI. */}
      <div className="flex border-b border-outline-variant mb-6 overflow-x-auto no-scrollbar">
        {BON_THE.map((t) => (
          <button
            key={t.ma}
            onClick={() => datTim((p) => { const m = new URLSearchParams(p); m.set('the', t.ma); return m; }, { replace: true })}
            className={clsx(
              'flex items-center gap-2 px-4 md:px-5 py-3 text-sm font-bold border-b-2 -mb-px whitespace-nowrap transition-colors',
              theMo === t.ma ? 'text-on-surface' : 'border-transparent text-on-surface-variant hover:text-on-surface'
            )}
            style={theMo === t.ma ? { borderColor: motAi.hex } : undefined}
          >
            <span className="material-symbols-outlined text-[18px]" style={theMo === t.ma ? { color: motAi.hex } : undefined}>{t.bieuTuong}</span>
            {t.ten}
          </button>
        ))}
      </div>

      <div>{the[theMo]}</div>
    </div>
  );
}
