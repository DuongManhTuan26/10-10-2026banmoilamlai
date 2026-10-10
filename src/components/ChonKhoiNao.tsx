import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { useKhoiNao, PLATFORM_BADGE } from '../lib/ActivePage';

/**
 * BỘ CHỌN DUY NHẤT: "Trang bán hàng" (docs/khoi-nao.md). Chọn trang nào → toàn bộ màn hình là khối não của trang đó.
 *
 * Danh sách gom theo tài khoản chủ trang (chủ chuỗi thấy trang của từng tài khoản con; quản trị thấy mọi tài khoản).
 * Mỗi dòng hiện các kênh của trang (Fanpage, Instagram…) — chung một khối não.
 */
export default function ChonKhoiNao() {
  const { dsNao, nao, chonNao, loading } = useKhoiNao();
  const [mo, setMo] = useState(false);
  const navigate = useNavigate();

  const nhom = new Map<number, typeof dsNao>();
  for (const n of dsNao) nhom.set(n.chu_id, [...(nhom.get(n.chu_id) ?? []), n]);
  const nhieuChu = nhom.size > 1;

  return (
    <div className="shrink-0 relative">
      <div className="px-1 pb-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[#E8EDF2]/50">Trang bán hàng</div>
      <button
        onClick={() => setMo((v) => !v)}
        className="w-full flex items-center justify-between py-2.5 px-3 rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-md hover:border-[#00e5ff]/40 hover:bg-[#00e5ff]/5 hover:shadow-[0_0_20px_rgba(0,229,255,0.1)] transition-all duration-300 group"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="material-symbols-outlined text-[#00e5ff] text-[20px] shrink-0">storefront</span>
          <div className="min-w-0 text-left">
            <div className="text-[14px] text-white font-semibold truncate">
              {loading ? 'Đang tải…' : nao ? nao.ten : 'Chưa có trang nào'}
            </div>
            {nao && !nao.la_cua_toi && (
              <div className="text-[11px] text-[#E8EDF2]/60 truncate">Tài khoản: {nao.chu_ten || nao.chu_email}</div>
            )}
          </div>
        </div>
        <span className="material-symbols-outlined text-[#E8EDF2] group-hover:text-[#00e5ff] transition-colors text-[20px] shrink-0">unfold_more</span>
      </button>

      {mo && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMo(false)} aria-hidden />
          <div className="absolute left-0 right-0 top-full mt-2 z-40 rounded-xl border border-outline-variant bg-noi backdrop-blur-xl shadow-[0_0_24px_rgba(0,229,255,0.15)] overflow-hidden max-h-[60vh] overflow-y-auto custom-scrollbar">
            {[...nhom.values()].map((ds) => (
              <div key={ds[0].chu_id}>
                {nhieuChu && (
                  <div className="px-3 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-[#E8EDF2]/50 truncate">
                    {ds[0].la_cua_toi ? 'Của tôi' : ds[0].chu_ten || ds[0].chu_email}
                  </div>
                )}
                {ds.map((n) => (
                  <button
                    key={n.trang_id}
                    onClick={() => { chonNao(n.trang_id); setMo(false); }}
                    className={clsx(
                      'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[#00e5ff]/10',
                      n.trang_id === nao?.trang_id && 'bg-[#00e5ff]/10'
                    )}
                  >
                    <span className={clsx('material-symbols-outlined text-[18px] shrink-0', n.trang_id === nao?.trang_id ? 'text-[#00e5ff]' : 'text-[#E8EDF2]/60')}>
                      {n.trang_id === nao?.trang_id ? 'radio_button_checked' : 'radio_button_unchecked'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className={clsx('text-[13px] font-semibold truncate', n.trang_id === nao?.trang_id ? 'text-[#00e5ff]' : 'text-[#E8EDF2]')}>{n.ten}</div>
                      <div className="flex gap-1 mt-0.5">
                        {n.kenh.length === 0 && <span className="text-[10px] text-amber-400">Chưa nối kênh</span>}
                        {n.kenh.map((k) => (
                          <span key={k.id} title={k.ten} className={clsx('font-mono text-[9px] font-bold px-1 rounded border', k.connected ? 'text-[#E8EDF2]/70 border-white/15' : 'text-[#ef4444] border-[#ef4444]/40')}>
                            {PLATFORM_BADGE[k.platform] ?? '?'}
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ))}
            <button
              onClick={() => { setMo(false); navigate('/ket-noi'); }}
              className="w-full px-3 py-3 text-left text-[13px] text-[#00e5ff] font-semibold hover:bg-[#00e5ff]/10 transition-colors border-t border-white/5"
            >
              + Nối thêm Fanpage (thêm một trang bán hàng)
            </button>
          </div>
        </>
      )}
    </div>
  );
}
