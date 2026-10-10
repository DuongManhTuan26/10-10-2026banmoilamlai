/**
 * SỨC KHOẺ từng khâu của một trang — bước 4a của AI điều hành (chủ dự án duyệt 05/10/2026).
 *
 * Do CODE THỐNG KÊ chấm (server/services/suc-khoe.ts), không phải AI: 7 ngày gần so với 28 ngày trước của chính trang,
 * chỉ kết luận khi có ý nghĩa thống kê VÀ lệch đủ lớn; thiếu mẫu thì nói thẳng "chưa đủ dữ liệu". Màu theo nghĩa: đang
 * mạnh xanh lá, tụt đỏ, sự cố cam, ổn / chưa đủ xám. Cái đang mạnh nằm trong danh sách BẢO VỆ — AI điều hành không đụng.
 */
import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { api, ApiError, type ChiSoSucKhoe, type MucSucKhoe, type SucKhoeTrang as DuLieu } from '../lib/api';

const NHAN_MUC: Record<MucSucKhoe, { chu: string; mau: string; icon: string }> = {
  dang_manh: { chu: 'Đang mạnh', mau: 'bg-green-500/15 text-green-400', icon: 'trending_up' },
  on: { chu: 'Ổn', mau: 'bg-surface-container-highest text-on-surface-variant', icon: 'check' },
  tut: { chu: 'Tụt', mau: 'bg-red-500/15 text-red-400', icon: 'trending_down' },
  chua_du: { chu: 'Chưa đủ dữ liệu', mau: 'bg-surface-container-highest text-on-surface-variant', icon: 'hourglass_empty' },
};
const TEN_KHAU: Record<ChiSoSucKhoe['khau'], string> = { noi_dung: 'Nội dung', quang_cao: 'Quảng cáo', ban_hang: 'Bán hàng' };

function giaTri(c: ChiSoSucKhoe, v: number | null) {
  if (v === null) return '—';
  if (c.donVi === 'ti_le') return `${(v * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;
  return v.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
}

/**
 * `khau`: chỉ hiện chỉ số / sự cố của MỘT khâu — thẻ "Kết quả" của AI nội dung, quảng cáo, bán hàng dùng chung bảng này
 * (một nguồn, một cách chấm). Không truyền = cả khối não (AI điều hành).
 */
export default function SucKhoeTrang({ trangId, khau }: { trangId: number; khau?: ChiSoSucKhoe['khau'] }) {
  const [du, setDu] = useState<DuLieu | null>(null);
  const [loi, setLoi] = useState('');
  useEffect(() => {
    let huy = false;
    setDu(null);
    setLoi('');
    api.quanLy
      .sucKhoe(trangId)
      .then(({ data }) => !huy && setDu(data))
      .catch((e) => !huy && setLoi(e instanceof ApiError ? e.message : 'Chưa tải được sức khoẻ'));
    return () => {
      huy = true;
    };
  }, [trangId]);

  if (loi) return <p className="text-sm text-red-400">{loi}</p>;
  if (!du) return <p className="text-sm text-on-surface-variant">Đang chấm sức khoẻ…</p>;
  const theoMa = new Map<string, ChiSoSucKhoe>(du.chiSo.map((c) => [c.ma, c]));
  const chiSo = khau ? du.chiSo.filter((c) => c.khau === khau) : du.chiSo;
  const suCo = khau ? du.suCo.filter((x) => x.khau === khau) : du.suCo;
  const uuTien = du.uuTien.filter((m) => !khau || theoMa.get(m)?.khau === khau);
  const baoVe = du.baoVe.filter((m) => !khau || theoMa.get(m)?.khau === khau);

  return (
    <div className="space-y-3">
      {suCo.length > 0 && (
        <div className="rounded-xl border border-orange-400/40 bg-orange-400/10 px-4 py-2.5 text-sm">
          <div className="font-bold text-orange-400 mb-1">Sự cố — xử lý trước</div>
          {suCo.map((s, i) => (
            <div key={i} className="text-on-surface">
              {s.ten} <span className="text-on-surface-variant">· {s.chiTiet}</span>
            </div>
          ))}
        </div>
      )}
      {(uuTien.length > 0 || baoVe.length > 0) && (
        <div className="grid gap-2 md:grid-cols-2 text-sm">
          {uuTien.length > 0 && (
            <div className="rounded-xl border border-outline-variant bg-surface px-4 py-2.5">
              <div className="font-bold text-red-400 mb-1">Cần xử lý (theo thứ tự)</div>
              {uuTien.map((m, i) => (
                <div key={m} className="text-on-surface">
                  {i + 1}. {theoMa.get(m)?.ten}
                  {theoMa.get(m)?.anhHuongTuan ? (
                    <span className="text-on-surface-variant"> · ước mất {Math.round(theoMa.get(m)!.anhHuongTuan!).toLocaleString('vi-VN')} ₫/tuần</span>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {baoVe.length > 0 && (
            <div className="rounded-xl border border-outline-variant bg-surface px-4 py-2.5">
              <div className="font-bold text-green-400 mb-1">Đang mạnh — giữ nguyên, không đụng vào</div>
              {baoVe.map((m) => (
                <div key={m} className="text-on-surface">{theoMa.get(m)?.ten}</div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="divide-y divide-outline-variant/60 rounded-xl border border-outline-variant bg-surface text-sm">
        {chiSo.length === 0 && <div className="px-4 py-3 text-on-surface-variant">Khâu này chưa có chỉ số nào đo được.</div>}
        {chiSo.map((c) => {
          const n = NHAN_MUC[c.muc];
          return (
            <div key={c.ma} className="px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="w-20 shrink-0 text-[11px] font-mono uppercase text-on-surface-variant">{TEN_KHAU[c.khau]}</span>
              <span className="flex-1 min-w-[10rem] text-on-surface">{c.ten}</span>
              <span className="tabular-nums text-on-surface-variant">
                {giaTri(c, c.nen.giaTri)} → <b className="text-on-surface">{giaTri(c, c.gan.giaTri)}</b>
                {c.lech !== null && c.muc !== 'chua_du' && (
                  <span className={clsx('ml-1', c.muc === 'tut' ? 'text-red-400' : c.muc === 'dang_manh' ? 'text-green-400' : '')}>
                    ({c.lech > 0 ? '+' : ''}{(c.lech * 100).toLocaleString('vi-VN', { maximumFractionDigits: 0 })}%)
                  </span>
                )}
              </span>
              <span title={c.thieu ?? (c.p !== null ? `p = ${c.p.toLocaleString('vi-VN', { maximumFractionDigits: 4 })}` : '')} className={clsx('inline-flex items-center gap-1 rounded px-1.5 py-px text-[11px] font-bold', n.mau)}>
                <span className="material-symbols-outlined text-[13px]">{n.icon}</span>
                {n.chu}
              </span>
              {c.thieu && <span className="basis-full pl-[5.75rem] text-[11px] text-on-surface-variant">{c.thieu}</span>}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-on-surface-variant">
        Mũi tên: 28 ngày trước → 7 ngày gần. Chỉ kết luận "Tụt" / "Đang mạnh" khi khác biệt có ý nghĩa thống kê (p &lt; 0,05)
        và lệch từ 20% trở lên; số bài so ở cùng tuổi 2 ngày.
      </p>
    </div>
  );
}
