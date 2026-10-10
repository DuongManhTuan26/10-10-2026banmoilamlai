/**
 * Sổ CHỈ ĐẠO và LỊCH ĐIỀU HÀNH của khối não (server/services/chi-dao.ts, dieu-hanh-ngay.ts).
 *
 * Dòng chính ngắn gọn; bấm mới hiện chi tiết. Màu theo nghĩa: đang áp dụng xanh ngọc, tốt lên xanh lá, xấu đi / hoàn tác
 * đỏ, giữ nguyên / đã gỡ xám.
 */
import { useCallback, useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { api, ApiError, type ChiDao, type LichDieuHanh } from '../lib/api';
import { hoiNhap, baoTin } from './HopHoi';
import { NUT_CHINH, NUT_PHU, O_NHAP } from './HopThoai';

const TEN_AI: Record<ChiDao['ai'], string> = { content: '① AI Nội dung', ads: '② AI Quảng cáo', sales: '③ AI Bán hàng' };
const KET_QUA: Record<ChiDao['ket_qua'], { chu: string; mau: string }> = {
  chua_do: { chu: 'Chưa đo', mau: 'bg-surface-container-highest text-on-surface-variant' },
  tot_len: { chu: 'Tốt lên', mau: 'bg-green-500/15 text-green-400' },
  giu_nguyen: { chu: 'Giữ nguyên', mau: 'bg-surface-container-highest text-on-surface-variant' },
  xau_di: { chu: 'Xấu đi', mau: 'bg-red-500/15 text-red-400' },
};
const TRANG_THAI: Record<ChiDao['trang_thai'], { chu: string; mau: string }> = {
  dang_ap_dung: { chu: 'Đang áp dụng', mau: 'bg-primary/15 text-primary' },
  da_go: { chu: 'Đã gỡ', mau: 'bg-surface-container-highest text-on-surface-variant' },
  hoan_tac: { chu: 'Tự hoàn tác', mau: 'bg-red-500/15 text-red-400' },
};
const ngay = (s: string) => new Date(s).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
const loiChu = (e: unknown, macDinh: string) => (e instanceof ApiError ? e.message : macDinh);

/** Sổ chỉ đạo. `ai` = chỉ của một AI nhân viên (thẻ Hướng dẫn AI của AI đó); bỏ trống = cả khối não (AI điều hành). */
export function SoChiDao({ ai, choThem = false }: { ai?: ChiDao['ai']; choThem?: boolean }) {
  const [ds, setDs] = useState<ChiDao[] | null>(null);
  const [loi, setLoi] = useState('');
  const [mo, setMo] = useState<number | null>(null);
  const [moi, setMoi] = useState<{ ai: ChiDao['ai']; noiDung: string }>({ ai: ai ?? 'sales', noiDung: '' });

  const tai = useCallback(async () => {
    try {
      const { data } = await api.khoiNao.chiDao();
      setDs(ai ? data.filter((c) => c.ai === ai) : data);
      setLoi('');
    } catch (e) {
      setLoi(loiChu(e, 'Chưa tải được sổ chỉ đạo'));
    }
  }, [ai]);
  useEffect(() => { void tai(); }, [tai]);

  const go = async (c: ChiDao) => {
    const lyDo = await hoiNhap({ tieuDe: 'Gỡ chỉ đạo này?', nhan: 'Lý do (ghi vào sổ)', goiY: 'vd. không còn đúng / muốn thử cách khác', nutDongY: 'Gỡ', nguyHiem: true });
    if (lyDo === null) return;
    try {
      await api.khoiNao.goChiDao(c.id, lyDo);
      await tai();
    } catch (e) {
      await baoTin({ tieuDe: 'Chưa gỡ được', noiDung: loiChu(e, 'Có lỗi') });
    }
  };
  const them = async () => {
    try {
      await api.khoiNao.themChiDao(moi.ai, moi.noiDung);
      setMoi((m) => ({ ...m, noiDung: '' }));
      await tai();
    } catch (e) {
      await baoTin({ tieuDe: 'Chưa thêm được', noiDung: loiChu(e, 'Có lỗi') });
    }
  };

  if (loi) return <p className="text-sm text-red-400">{loi}</p>;
  if (!ds) return <p className="text-sm text-on-surface-variant">Đang tải sổ chỉ đạo…</p>;
  const dangApDung = ds.filter((c) => c.trang_thai === 'dang_ap_dung').length;

  return (
    <div className="space-y-3 text-sm">
      <p className="text-on-surface">
        Đang áp dụng: <b>{dangApDung}</b> · Đã thử: <b>{ds.length - dangApDung}</b>
        <span className="text-on-surface-variant"> — mỗi chỉ đạo được đo lại sau 7 ngày; xấu đi thì tự hoàn tác.</span>
      </p>
      {ds.length === 0 ? (
        <p className="text-on-surface-variant">Chưa có chỉ đạo nào.</p>
      ) : (
        <div className="divide-y divide-outline-variant/60 rounded-xl border border-outline-variant bg-surface">
          {ds.map((c) => (
            <div key={c.id} className="px-4 py-2">
              <button type="button" onClick={() => setMo(mo === c.id ? null : c.id)} className="w-full text-left flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-xs text-on-surface-variant tabular-nums w-12">{ngay(c.luc_bat_dau)}</span>
                {!ai && <span className="text-xs font-bold text-on-surface">{TEN_AI[c.ai]}</span>}
                <span className={clsx('rounded px-1.5 text-[11px] font-bold', TRANG_THAI[c.trang_thai].mau)}>{TRANG_THAI[c.trang_thai].chu}</span>
                <span className={clsx('rounded px-1.5 text-[11px] font-bold', KET_QUA[c.ket_qua].mau)}>{KET_QUA[c.ket_qua].chu}</span>
                <span className="flex-1 min-w-[12rem] text-on-surface truncate">{c.noi_dung}</span>
              </button>
              {mo === c.id && (
                <div className="mt-2 space-y-1 text-xs">
                  <p className="text-on-surface whitespace-pre-wrap">{c.noi_dung}</p>
                  <p className="text-on-surface-variant">
                    {c.de_xuat_id ? `Từ đề xuất #${c.de_xuat_id} của AI điều hành.` : 'Chủ shop tự thêm.'}{' '}
                    {c.ket_qua === 'chua_do' ? `Đo lại ngày ${ngay(c.luc_se_do)}.` : `Đã đo ngày ${c.luc_do ? ngay(c.luc_do) : '—'}.`}
                  </p>
                  {c.ket_qua_chi_tiet?.xauDi?.length ? <p className="text-red-400">Tụt: {c.ket_qua_chi_tiet.xauDi.join(', ')}</p> : null}
                  {c.ket_qua_chi_tiet?.totLen?.length ? <p className="text-green-400">Mạnh lên: {c.ket_qua_chi_tiet.totLen.join(', ')}</p> : null}
                  {c.ly_do_go && <p className="text-on-surface-variant">Lý do gỡ: {c.ly_do_go}</p>}
                  {c.trang_thai === 'dang_ap_dung' && (
                    <button type="button" onClick={() => go(c)} className="mt-1 rounded-lg bg-red-500/15 text-red-400 px-3 py-1.5 font-bold">Gỡ chỉ đạo</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {choThem && (
        <div className="rounded-xl border border-outline-variant bg-surface p-3 space-y-2">
          <div className="font-bold text-on-surface">Tự thêm chỉ đạo</div>
          <div className="flex flex-col sm:flex-row gap-2">
            {!ai && (
              <select value={moi.ai} onChange={(e) => setMoi((m) => ({ ...m, ai: e.target.value as ChiDao['ai'] }))} className={clsx(O_NHAP, 'sm:w-48')}>
                {(Object.keys(TEN_AI) as ChiDao['ai'][]).map((a) => <option key={a} value={a}>{TEN_AI[a]}</option>)}
              </select>
            )}
            <textarea
              value={moi.noiDung}
              maxLength={2000}
              onChange={(e) => setMoi((m) => ({ ...m, noiDung: e.target.value }))}
              placeholder="Câu chỉ đạo cụ thể, đo được"
              className="flex-1 min-h-[64px] rounded-xl bg-surface-container-high border border-outline-variant px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
            />
          </div>
          <button type="button" onClick={them} disabled={moi.noiDung.trim().length < 5} className={NUT_PHU}>Thêm chỉ đạo</button>
        </div>
      )}
    </div>
  );
}

/** Lịch điều hành: báo cáo ngày (miễn phí) và tự chẩn đoán (tốn tiền, bắt buộc trần tháng). */
export function LichDieuHanhForm() {
  const [lich, setLich] = useState<LichDieuHanh | null>(null);
  const [daDung, setDaDung] = useState(0);
  const [xemTruoc, setXemTruoc] = useState<string | null>(null);
  const [dangLuu, setDangLuu] = useState(false);
  const [bao, setBao] = useState('');

  useEffect(() => {
    api.khoiNao.lich().then(({ data }) => { setLich(data.lich); setDaDung(data.daDungThangUsd); }).catch(() => setBao('Chưa tải được lịch'));
  }, []);
  if (!lich) return <p className="text-sm text-on-surface-variant">{bao || 'Đang tải lịch điều hành…'}</p>;

  const luu = async () => {
    setDangLuu(true);
    setBao('');
    try {
      const { data } = await api.khoiNao.luuLich(lich);
      setLich(data.lich);
      setBao('Đã lưu lịch điều hành.');
    } catch (e) {
      setBao(loiChu(e, 'Chưa lưu được'));
    } finally {
      setDangLuu(false);
    }
  };

  return (
    <div className="space-y-4 text-sm">
      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={lich.baoCaoNgay} onChange={(e) => setLich({ ...lich, baoCaoNgay: e.target.checked })} />
        <span>
          <b className="text-on-surface">Báo cáo hằng ngày qua Telegram</b>
          <span className="block text-on-surface-variant">Chỉ số cuối, sự cố, cái đang tụt, cái đang mạnh, chỉ đạo và đề xuất chờ duyệt. Hệ thống tự lập — không tốn tiền AI.</span>
        </span>
      </label>
      <label className="flex items-center gap-3">
        <span className="text-on-surface w-28 shrink-0">Giờ gửi</span>
        <input type="time" value={lich.gio} onChange={(e) => setLich({ ...lich, gio: e.target.value })} className={clsx(O_NHAP, 'w-36')} />
      </label>
      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={lich.tuChanDoan} onChange={(e) => setLich({ ...lich, tuChanDoan: e.target.checked })} />
        <span>
          <b className="text-on-surface">Tự chẩn đoán mỗi ngày khi có vấn đề</b>
          <span className="block text-on-surface-variant">AI điều hành tự xem sự cố / chỉ số tụt và ra ĐỀ XUẤT chờ bạn duyệt (không tự thực thi). Mỗi lần ~0,1–0,25 USD.</span>
        </span>
      </label>
      <label className="flex items-center gap-3">
        <span className="text-on-surface w-28 shrink-0">Trần tiền/tháng</span>
        <input type="number" min={0} max={1000} step={0.5} value={lich.tranThangUsd}
          onChange={(e) => setLich({ ...lich, tranThangUsd: Number(e.target.value) || 0 })} className={clsx(O_NHAP, 'w-36')} />
        <span className="text-on-surface-variant">USD · đã dùng tháng này {daDung.toLocaleString('vi-VN', { maximumFractionDigits: 3 })} USD</span>
      </label>
      {lich.tuChanDoan && !(lich.tranThangUsd > 0) && <p className="text-orange-400">Cần đặt trần tiền mỗi tháng mới bật được tự chẩn đoán.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={luu} disabled={dangLuu || (lich.tuChanDoan && !(lich.tranThangUsd > 0))} className={NUT_CHINH}>{dangLuu ? 'Đang lưu…' : 'Lưu lịch điều hành'}</button>
        <button type="button" className={NUT_PHU}
          onClick={() => api.khoiNao.xemTruocBaoCao().then(({ data }) => setXemTruoc(data.noiDung)).catch((e) => setBao(loiChu(e, 'Chưa xem trước được')))}>
          Xem trước báo cáo hôm nay
        </button>
      </div>
      {bao && <p className="text-on-surface-variant">{bao}</p>}
      {xemTruoc && (
        <pre className="whitespace-pre-wrap font-sans text-xs text-on-surface bg-surface-container-high rounded-lg px-3 py-2"
          // Báo cáo dùng thẻ <b> của Telegram — bỏ thẻ khi xem trước, chỉ giữ chữ.
        >{xemTruoc.replace(/<\/?b>/g, '')}</pre>
      )}
    </div>
  );
}
