import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { useKhoiNao, PLATFORM_BADGE } from '../lib/ActivePage';
import type { KhoiNaoInfo } from '../lib/api';

/** Số dòng mỗi trang của bảng — đủ nhìn một lượt, không bắt cuộn dài khi chuỗi có hàng trăm trang. */
const MOI_TRANG = 25;

type Loc = 'tat-ca' | 'su-co' | 'chua-noi';

const tinhTrang = (n: KhoiNaoInfo): 'chua-noi' | 'su-co' | 'on' =>
  n.kenh.length === 0 ? 'chua-noi' : n.kenh.some((k) => !k.connected) ? 'su-co' : 'on';

/**
 * BẢNG TRANG BÁN HÀNG — nơi DUY NHẤT chọn khối não (rà soát giao diện lượt 2, T1: bỏ ô chọn trùng ở thanh menu, danh
 * sách thả xuống không chịu nổi hàng trăm trang). Mỗi trang một dòng: tên, chủ (nếu không phải mình), các kênh, tình
 * trạng, nút mở khối não. Có ô tìm, lọc tình trạng, gom theo tài khoản chủ, 25 dòng mỗi trang.
 *
 * Mở khối não = chọn trang (ActivePage.chonNao — X-Trang của mọi yêu cầu sau đó) rồi về Tổng quan khối não.
 */
export default function BangTrangBanHang() {
  const { dsNao, nao, chonNao } = useKhoiNao();
  const navigate = useNavigate();
  const [tim, setTim] = useState('');
  const [loc, setLoc] = useState<Loc>('tat-ca');
  const [trang, setTrang] = useState(0);

  const loc1 = useMemo(() => {
    const t = tim.trim().toLowerCase();
    return dsNao
      .filter((n) => !t
        || n.ten.toLowerCase().includes(t)
        || (n.chu_ten ?? '').toLowerCase().includes(t)
        || (n.chu_email ?? '').toLowerCase().includes(t)
        || n.kenh.some((k) => (k.ten ?? '').toLowerCase().includes(t)))
      .filter((n) => loc === 'tat-ca' || tinhTrang(n) === loc)
      // Trang của mình trước, rồi theo chủ, rồi theo tên — để dòng cùng tài khoản nằm liền nhau (gom nhóm).
      .sort((a, b) => Number(b.la_cua_toi) - Number(a.la_cua_toi)
        || (a.chu_ten || a.chu_email).localeCompare(b.chu_ten || b.chu_email, 'vi')
        || a.ten.localeCompare(b.ten, 'vi'));
  }, [dsNao, tim, loc]);

  const nhieuChu = new Set(dsNao.map((n) => n.chu_id)).size > 1;
  const soTrang = Math.max(1, Math.ceil(loc1.length / MOI_TRANG));
  const trangHien = Math.min(trang, soTrang - 1);
  const dong = loc1.slice(trangHien * MOI_TRANG, (trangHien + 1) * MOI_TRANG);
  const dem = { 'su-co': dsNao.filter((n) => tinhTrang(n) === 'su-co').length, 'chua-noi': dsNao.filter((n) => tinhTrang(n) === 'chua-noi').length };

  const mo = (n: KhoiNaoInfo) => {
    if (n.trang_id !== nao?.trang_id) chonNao(n.trang_id);
    navigate('/');
  };

  if (dsNao.length === 0) return null;

  return (
    <section className="khung-muc mau-lam mb-6">
      <div className="dau-muc flex flex-wrap items-center justify-between gap-3">
        <h3 className="tieu-de-muc">Trang bán hàng ({dsNao.length})</h3>
        {dsNao.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">search</span>
              <input
                value={tim}
                onChange={(e) => { setTim(e.target.value); setTrang(0); }}
                placeholder="Tìm trang, tài khoản, kênh…"
                className="h-9 w-56 pl-8 pr-3 rounded-lg bg-surface-container-high border border-outline-variant text-sm text-on-surface focus:outline-none focus:border-on-surface"
              />
            </div>
            {([['tat-ca', 'Tất cả'], ['su-co', `Có sự cố (${dem['su-co']})`], ['chua-noi', `Chưa nối kênh (${dem['chua-noi']})`]] as [Loc, string][]).map(([ma, ten]) => (
              <button
                key={ma}
                onClick={() => { setLoc(ma); setTrang(0); }}
                className={clsx('h-9 px-3 rounded-lg text-sm font-semibold border transition-colors',
                  loc === ma ? 'bg-on-surface text-background border-on-surface' : 'border-outline-variant text-on-surface-variant hover:text-on-surface')}
              >
                {ten}
              </button>
            ))}
          </div>
        )}
      </div>

      {dong.length === 0 ? (
        <p className="py-6 text-center text-sm text-on-surface-variant">Không có trang nào khớp.</p>
      ) : (
        <div className="divide-y divide-outline-variant/60">
          {dong.map((n, i) => {
            const tt = tinhTrang(n);
            const dangMo = n.trang_id === nao?.trang_id;
            const doiChu = nhieuChu && (i === 0 || dong[i - 1].chu_id !== n.chu_id);
            return (
              <div key={n.trang_id}>
                {doiChu && (
                  <div className="pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
                    {n.la_cua_toi ? 'Của tôi' : `Tài khoản: ${n.chu_ten || n.chu_email}`}
                  </div>
                )}
                <div className={clsx('flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-2 py-2.5', dangMo && 'bg-surface-container-high -mx-2 px-2 rounded-lg')}>
                  <span className="material-symbols-outlined text-[20px] text-on-surface-variant shrink-0">storefront</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-on-surface truncate">{n.ten}</span>
                  </span>
                  <span className="flex flex-wrap gap-1 shrink-0">
                    {n.kenh.map((k) => (
                      <span
                        key={k.id}
                        title={`${k.ten}${k.connected ? '' : ' — mất kết nối'}`}
                        className={clsx('font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border',
                          k.connected ? 'text-on-surface-variant border-white/15' : 'text-loi border-loi/50')}
                      >
                        {PLATFORM_BADGE[k.platform] ?? k.platform.slice(0, 2).toUpperCase()}
                      </span>
                    ))}
                  </span>
                  <span className={clsx('shrink-0 w-32 text-xs font-bold',
                    tt === 'su-co' ? 'text-loi' : tt === 'chua-noi' ? 'text-canh-bao' : 'text-on-surface-variant')}>
                    {tt === 'su-co' ? 'Có kênh mất kết nối' : tt === 'chua-noi' ? 'Chưa nối kênh' : '✓ Hoạt động'}
                  </span>
                  {dangMo ? (
                    <span className="shrink-0 w-32 text-center text-xs font-bold text-on-surface">● Đang mở</span>
                  ) : (
                    <button
                      onClick={() => mo(n)}
                      className="shrink-0 w-32 h-8 rounded-lg border border-white/25 text-sm font-bold text-on-surface hover:bg-white/10 transition-colors"
                    >
                      Mở khối não
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {soTrang > 1 && (
        <div className="flex items-center justify-between pt-3 text-sm text-on-surface-variant">
          <span>{trangHien * MOI_TRANG + 1}–{Math.min(loc1.length, (trangHien + 1) * MOI_TRANG)} / {loc1.length} trang</span>
          <div className="flex gap-2">
            <button onClick={() => setTrang(trangHien - 1)} disabled={trangHien === 0} className="h-8 px-3 rounded-lg border border-outline-variant disabled:opacity-40">‹ Trước</button>
            <button onClick={() => setTrang(trangHien + 1)} disabled={trangHien >= soTrang - 1} className="h-8 px-3 rounded-lg border border-outline-variant disabled:opacity-40">Sau ›</button>
          </div>
        </div>
      )}
    </section>
  );
}
