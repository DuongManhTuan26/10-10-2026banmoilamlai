/**
 * Màn hình quản lý — phần TỔNG QUAN (biểu đồ) và BÁO CÁO TỪNG TRANG. Dùng chung cho quản trị tổng và admin con.
 *
 * Chủ dự án 04/10/2026 tự thiết kế: "bóc tách ra thành 2 phần riêng biệt, 1 phần quản lý tổng quan và 1 phần quản lý
 * chi tiết … phần tổng quan cốt lõi bằng biểu đồ trực quan hoá: 1: tổng số tài khoản đang hoạt động → mỗi tài khoản
 * có bao nhiêu trang → tổng số trang đang hoạt động. 2: tổng mỗi tài khoản đang tiêu hết bao nhiêu tiền → mỗi trang
 * tiêu hết bao nhiêu tiền cụ thể cho từng loại". Khớp mẫu chuẩn: Google Cloud Billing (biểu đồ cột chồng theo loại,
 * bảng cây Dự án → Dịch vụ), NN/g (3–5 số chính trên cùng, biểu đồ ở giữa, chi tiết chỉ mở khi bấm).
 *
 * Tiền là CHI (âm, đỏ) theo quy ước tien-chi.ts. Màu từng loại chỉ để phân biệt loại — không dùng xanh lá / cam / đỏ
 * (đã dành cho ổn / cảnh báo / chi).
 */
import { useEffect, useState, type Key, type ReactNode } from 'react';
import { clsx } from 'clsx';
import {
  api,
  ApiError,
  type KyTongQuan,
  type LuotChiPhi,
  type TaiKhoanTongQuan,
  type TienAiTongQuan,
  type TongQuanQuanLy,
  type TrangTongQuan,
} from '../lib/api';
import { chi, chiDu, mauChi, vnd } from '../lib/tien-chi';
import { DongLuot } from './NhatKyChiPhi';
import BaoCaoChuoi from './BaoCaoChuoi';
import { useNavigate } from 'react-router-dom';
import { useKhoiNao } from '../lib/ActivePage';
import { aiTheoMa } from '../lib/bon-ai';

/** Các loại tiền, đúng thứ tự hiện. Tiền AI theo nhóm việc của sổ AI; "kenh" = tiền hoá đơn kết nối kênh tính cho từng kênh. */
/*
 * Màu theo MIỀN của AI làm ra khoản tiền (bảng màu A): bán hàng lục · viết bài / ảnh / video thuộc ① Nội dung (các sắc
 * tím) · phân tích thuộc ④ Điều hành (xanh ngọc) · dạy AI lam (thông tin) · kênh + chưa phân loại xám.
 */
export const LOAI_TIEN = [
  { id: 'ban_hang', ten: 'Chatbot bán hàng', mau: '#34d399' },
  { id: 'marketing', ten: 'Viết bài', mau: '#a78bfa' },
  { id: 'phan_tich', ten: 'Phân tích', mau: '#22d3ee' },
  { id: 'anh', ten: 'Tạo ảnh', mau: '#c4b5fd' },
  { id: 'video', ten: 'Tạo video', mau: '#8b5cf6' },
  { id: 'day_ai', ten: 'Dạy AI', mau: '#60a5fa' },
  { id: 'chua_phan_loai', ten: 'Chưa phân loại', mau: '#64748b' },
  { id: 'kenh', ten: 'Kết nối kênh', mau: '#94a3b8' },
] as const;
export type LoaiTien = (typeof LOAI_TIEN)[number]['id'];
export type TienTheoLoai = Partial<Record<LoaiTien, number>>;

const congVao = (a: TienTheoLoai, b: TienTheoLoai) => {
  for (const [k, v] of Object.entries(b)) a[k as LoaiTien] = (a[k as LoaiTien] ?? 0) + (v ?? 0);
  return a;
};
const tuAi = (t: TienAiTongQuan): TienTheoLoai => ({ ...t.theoNhom });
export const tienTrang = (t: TrangTongQuan): TienTheoLoai => congVao(tuAi(t.tienAi), { kenh: t.tienKenhUsd ?? 0 });
export const tienTaiKhoan = (tk: TaiKhoanTongQuan): TienTheoLoai =>
  tk.trang.reduce((a, t) => congVao(a, tienTrang(t)), tuAi(tk.tienAiKhongTrang));
export const tong = (t: TienTheoLoai) => Object.values(t).reduce((s, v) => s + (v ?? 0), 0);
const tienAi = (t: TienTheoLoai) => tong(t) - (t.kenh ?? 0);
export { tienAi };

/** Nhóm gốc của cây: một chuỗi (admin con + các tài khoản của nó) hoặc một tài khoản đứng riêng. */
export interface NhomGoc {
  so: number;
  goc: TaiKhoanTongQuan;
  con: TaiKhoanTongQuan[];
}

/** Dựng cây Chuỗi → Tài khoản → Trang, đánh số 1, 1.1, 1.1.1. Mình đứng đầu, rồi các chuỗi, rồi tài khoản đứng riêng. */
export function gomCay(du: TongQuanQuanLy): NhomGoc[] {
  const ids = new Set(du.taiKhoan.map((t) => t.id));
  const thuTu = (t: TaiKhoanTongQuan) => (t.laToi ? 0 : t.role === 'admin_con' ? 1 : 2);
  return du.taiKhoan
    .filter((t) => t.parentId === null || !ids.has(t.parentId))
    .sort((a, b) => thuTu(a) - thuTu(b))
    .map((goc, i) => ({ so: i + 1, goc, con: du.taiKhoan.filter((c) => c.parentId === goc.id) }));
}
export const tienNhom = (g: NhomGoc) => [g.goc, ...g.con].reduce((a, tk) => congVao(a, tienTaiKhoan(tk)), {} as TienTheoLoai);
export const trangCuaNhom = (g: NhomGoc) => [g.goc, ...g.con].flatMap((tk) => tk.trang);
export const tenTk = (tk: TaiKhoanTongQuan) => tk.ten || tk.email || '(chưa đặt tên)';

/** "01/10" — kỳ hoá đơn kết nối kênh tính theo ngày UTC. */
const ngayVN = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/**
 * Nhãn ĐÃ CHỐT / TẠM TÍNH (duyệt 05/10/2026): mỗi nguồn chốt sổ một kiểu — AI chốt khi mọi lượt đã đối chiếu, kênh chốt
 * khi hết kỳ hoá đơn, quảng cáo chốt sau 28 ngày (Meta: số liệu "do not change after 28 days").
 */
export function NhanChot({ chot, giai }: { chot: boolean; giai: string }) {
  return (
    <span
      title={giai}
      className={clsx(
        'inline-flex items-center gap-0.5 rounded px-1.5 py-px font-mono text-[10px] font-bold uppercase tracking-wide normal-case',
        chot ? 'bg-green-500/15 text-green-400' : 'bg-surface-container-highest text-on-surface-variant'
      )}
    >
      <span className="material-symbols-outlined text-[12px]">{chot ? 'verified' : 'schedule'}</span>
      {chot ? 'Đã chốt' : 'Tạm tính'}
    </span>
  );
}
export const GIAI_CHOT = {
  ai: 'Tiền AI chốt khi mọi lượt đã đối chiếu xong với số nhà cung cấp AI chốt (thường vài phút sau mỗi lượt).',
  kenh: 'Tiền kết nối kênh chốt khi hết kỳ hoá đơn (hết tháng); trong tháng là số tạm tính tới hôm nay.',
  quangCao: 'Tiền quảng cáo chốt sau 28 ngày kể từ cuối kỳ — Meta có thể điều chỉnh số liệu trong 28 ngày.',
};

/** Tiền theo đơn vị gốc (quảng cáo): VND hiện "₫"; đã chi là âm, đỏ. */
export const tienGoc = (n: number, tienTe: string) =>
  `${n > 0 ? '−' : ''}${n.toLocaleString('vi-VN')} ${tienTe === 'VND' ? '₫' : tienTe}`;

/** Một ô số chính. */
function OSo({ nhan, so, phu, mau, className, chot }: { nhan: string; so: string; phu?: string; mau?: string; className?: string; chot?: ReactNode }) {
  return (
    <div className={clsx('rounded-2xl border border-outline-variant bg-surface-container px-4 py-3 min-w-0', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">{nhan}</span>
        {chot}
      </div>
      {/* Không cắt số tiền: điện thoại chữ nhỏ hơn và được xuống dòng. */}
      <div className={clsx('text-xl sm:text-2xl font-bold mt-1 tabular-nums break-words', mau ?? 'text-on-surface')}>{so}</div>
      {phu && <div className="text-xs text-on-surface-variant mt-0.5">{phu}</div>}
    </div>
  );
}

/** Thanh chồng: mỗi đoạn một loại, dài theo tỉ lệ với giá trị lớn nhất của cả biểu đồ. */
function ThanhChong({ doan, toiDa }: { doan: { mau: string; giaTri: number; ten: string }[]; toiDa: number }) {
  return (
    <div className="h-3 rounded-full bg-surface-container-highest overflow-hidden flex" style={{ width: '100%' }}>
      {toiDa > 0 &&
        doan
          .filter((d) => d.giaTri > 0)
          .map((d) => (
            <div
              key={d.ten}
              title={`${d.ten}: ${d.giaTri}`}
              style={{ width: `${(d.giaTri / toiDa) * 100}%`, background: d.mau, minWidth: d.giaTri > 0 ? 2 : 0 }}
            />
          ))}
    </div>
  );
}

/** Một khối biểu đồ: tiêu đề + các dòng (nhãn trái, thanh giữa, số phải). */
function BieuDo({ tieuDe, phu, children }: { tieuDe: string; phu?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-outline-variant bg-surface-container p-4 sm:p-5 min-w-0">
      <h3 className="font-bold text-on-surface">{tieuDe}</h3>
      {phu && <p className="text-xs text-on-surface-variant mt-0.5">{phu}</p>}
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

function DongBieuDo({ nhan, so, children }: { nhan: string; so: ReactNode; children: ReactNode; key?: Key }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
      <span className="text-sm text-on-surface truncate" title={nhan}>{nhan}</span>
      <span className="text-sm tabular-nums text-right sm:order-3">{so}</span>
      <div className="col-span-2 sm:col-span-1 sm:order-2">{children}</div>
    </div>
  );
}

function ChuGiai({ loai }: { loai: LoaiTien[] }) {
  if (loai.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
      {LOAI_TIEN.filter((l) => loai.includes(l.id)).map((l) => (
        <span key={l.id} className="flex items-center gap-1.5 text-xs text-on-surface-variant">
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: l.mau }} />
          {l.ten}
        </span>
      ))}
    </div>
  );
}

const doanCua = (t: TienTheoLoai) => LOAI_TIEN.map((l) => ({ mau: l.mau, ten: l.ten, giaTri: t[l.id] ?? 0 }));
const loaiCo = (ds: TienTheoLoai[]) => LOAI_TIEN.map((l) => l.id).filter((id) => ds.some((t) => (t[id] ?? 0) > 1e-9));

/** PHẦN 1 — Tổng quan tài sản. */
export function TongQuanTaiSan({
  du,
  ky,
  onDoiKy,
  phamViChu,
}: {
  du: TongQuanQuanLy;
  ky: KyTongQuan;
  onDoiKy: (k: KyTongQuan) => void;
  /** "Cả hệ thống" / "Chuỗi của bạn". */
  phamViChu: string;
}) {
  const cay = gomCay(du);
  const kenhOk = 'loi' in du.nguonKenh ? null : du.nguonKenh;
  const tienKenhTong = kenhOk ? kenhOk.tongUsd : null;

  const nhomTien = cay.map((g) => ({ g, tien: tienNhom(g), trang: trangCuaNhom(g) }));
  const toiDaTrang = Math.max(1, ...nhomTien.map((n) => n.trang.length));
  const toiDaTienNhom = Math.max(0, ...nhomTien.map((n) => tong(n.tien)));
  const dsTrang = cay
    .flatMap((g) =>
      [g.goc, ...g.con].flatMap((tk, j) =>
        tk.trang.map((t, k) => ({
          so: tk === g.goc ? `${g.so}.${k + 1}` : `${g.so}.${j}.${k + 1}`,
          t,
          tien: tienTrang(t),
        }))
      )
    )
    .sort((a, b) => tong(b.tien) - tong(a.tien));
  const toiDaTienTrang = Math.max(0, ...dsTrang.map((x) => tong(x.tien)));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-on-surface-variant">
          {phamViChu}
          {du.kyTinh.keoTuMoc && !du.kyTinh.truocMoc && <> · tính từ {new Date(du.kyTinh.moc).toLocaleDateString('vi-VN')} (mốc bắt đầu tính theo trang)</>}
        </p>
        <div className="inline-flex rounded-lg border border-outline-variant overflow-hidden text-sm">
          {(
            [
              ['thang_nay', 'Tháng này'],
              ['thang_truoc', 'Tháng trước'],
            ] as const
          ).map(([id, ten]) => (
            <button
              key={id}
              type="button"
              onClick={() => onDoiKy(id)}
              className={clsx('px-3 py-1.5', ky === id ? 'bg-primary text-on-primary font-bold' : 'text-on-surface-variant hover:bg-surface-container-high')}
            >
              {ten}
            </button>
          ))}
        </div>
      </div>

      {/* Số chính */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <OSo nhan="Tài khoản hoạt động" so={`${du.tong.taiKhoanHoatDong}/${du.tong.taiKhoan}`} phu="đang mở / tổng số" />
        <OSo nhan="Trang hoạt động" so={`${du.tong.trangHoatDong}/${du.tong.trang}`} phu="có kênh đang nối / tổng số" />
        <OSo
          nhan="Tiền AI"
          chot={<NhanChot chot={du.chot.ai} giai={GIAI_CHOT.ai} />}
          so={chi(du.tong.tienAiUsd + du.tong.tienAiTaiKhoanDaXoaUsd)}
          mau={mauChi(du.tong.tienAiUsd + du.tong.tienAiTaiKhoanDaXoaUsd)}
          phu={vnd(du.tong.tienAiUsd + du.tong.tienAiTaiKhoanDaXoaUsd)}
        />
        <OSo
          nhan="Tiền kết nối kênh"
          chot={<NhanChot chot={du.chot.kenh} giai={GIAI_CHOT.kenh} />}
          so={chi(tienKenhTong)}
          mau={mauChi(tienKenhTong)}
          phu={kenhOk ? `khớp hoá đơn kết nối kênh ${ngayVN(kenhOk.tu)}–${ngayVN(kenhOk.den)}` : 'chưa đọc được hoá đơn kết nối kênh'}
        />
        <OSo
          className="col-span-2 lg:col-span-1"
          nhan="Tiền quảng cáo"
          chot={du.tong.coFanpage ? <NhanChot chot={du.chot.quangCao} giai={GIAI_CHOT.quangCao} /> : undefined}
          so={
            !du.tong.coFanpage
              ? '—'
              : du.tong.tienQuangCao.length === 0
                ? '0 ₫'
                : du.tong.tienQuangCao.map((q) => tienGoc(q.soTien, q.tienTe)).join(' · ')
          }
          mau={du.tong.tienQuangCao.some((q) => q.soTien > 0) ? 'text-red-400' : undefined}
          phu={du.tong.coFanpage ? 'số Meta báo đã chi cho các Fanpage' : 'chưa có Fanpage nào đang nối'}
        />
      </div>
      {'loi' in du.nguonKenh && (
        <p className="text-sm text-orange-400">{du.nguonKenh.loi}</p>
      )}

      {du.kyTinh.truocMoc && (
        <p className="rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant">
          Kỳ này nằm trước {new Date(du.kyTinh.moc).toLocaleDateString('vi-VN')} — mốc bắt đầu tính số theo trang, nên không có
          số theo trang. Tiền thật của cả kỳ xem ở khối Chi phí bên dưới.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <BieuDo tieuDe="Số trang theo tài khoản" phu="Xanh: trang có kênh đang nối · Xám: chưa nối kênh">
          {nhomTien.map(({ g, trang }) => {
            const hd = trang.filter((t) => t.hoatDong).length;
            return (
              <DongBieuDo key={g.goc.id} nhan={`${g.so}. ${tenTk(g.goc)}`} so={<span className="text-on-surface">{hd}/{trang.length}</span>}>
                <ThanhChong
                  toiDa={toiDaTrang}
                  doan={[
                    { ten: 'Đang hoạt động', mau: '#4ade80', giaTri: hd },
                    { ten: 'Chưa nối kênh', mau: '#64748b', giaTri: trang.length - hd },
                  ]}
                />
              </DongBieuDo>
            );
          })}
        </BieuDo>

        <BieuDo tieuDe="Tiền theo tài khoản" phu="Mỗi màu một loại chi phí (USD)">
          {nhomTien.map(({ g, tien }) => (
            <DongBieuDo key={g.goc.id} nhan={`${g.so}. ${tenTk(g.goc)}`} so={<span className={mauChi(tong(tien))}>{chi(tong(tien))}</span>}>
              <ThanhChong toiDa={toiDaTienNhom} doan={doanCua(tien)} />
            </DongBieuDo>
          ))}
          <ChuGiai loai={loaiCo(nhomTien.map((n) => n.tien))} />
        </BieuDo>
      </div>

      <BieuDo tieuDe="Tiền theo trang" phu="Từng trang, nhiều tiền nhất ở trên — số đánh theo cây ở phần Chi tiết">
        {dsTrang.length === 0 ? (
          <p className="text-sm text-on-surface-variant">Chưa có trang nào.</p>
        ) : (
          dsTrang.map(({ so, t, tien }) => (
            <DongBieuDo key={t.id} nhan={`${so} ${t.ten}`} so={<span className={mauChi(tong(tien))}>{chi(tong(tien))}</span>}>
              <ThanhChong toiDa={toiDaTienTrang} doan={doanCua(tien)} />
            </DongBieuDo>
          ))
        )}
        <ChuGiai loai={loaiCo(dsTrang.map((x) => x.tien))} />
      </BieuDo>

      {/* Tiền không gắn được vào trang nào — ghi rõ, không chia bừa, để tổng vẫn khớp. */}
      {(() => {
        const khongTrang = du.taiKhoan.reduce((s, t) => s + t.tienAiKhongTrang.tongUsd, 0);
        const dong = [
          khongTrang > 1e-9 && `Tiền AI không thuộc trang nào (tài khoản quản lý chuỗi tự dùng — không có trang): ${chi(khongTrang)}`,
          du.tong.tienAiTaiKhoanDaXoaUsd > 1e-9 && `Tiền AI của tài khoản đã xoá: ${chi(du.tong.tienAiTaiKhoanDaXoaUsd)}`,
          kenhOk && kenhOk.khongGanUsd > 1e-9 && `Tiền kết nối kênh không gắn được trang (kênh đã gỡ, phí chung): ${chi(kenhOk.khongGanUsd)}`,
        ].filter(Boolean) as string[];
        return dong.length > 0 ? (
          <div className="rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant space-y-1">
            {dong.map((d) => (
              <p key={d}>{d}</p>
            ))}
          </div>
        ) : null;
      })()}
    </div>
  );
}

const TEN_NEN_TANG: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  metaads: 'Meta Ads',
  youtube: 'YouTube',
  threads: 'Threads',
  twitter: 'X',
  linkedin: 'LinkedIn',
  googlebusiness: 'Google Business',
};

/** Báo cáo MỘT TRANG — mở khi bấm vào trang trong cây. Đầu tiên là tiền đã chi và sao kê từng lượt. */
export function BaoCaoMotTrang({ t, ky, chot }: { t: TrangTongQuan; ky: KyTongQuan; chot: TongQuanQuanLy['chot'] }) {
  const { chonNao } = useKhoiNao();
  const navigate = useNavigate();
  const dieuHanh = aiTheoMa('analytics');
  const [so, setSo] = useState(1);
  const [du, setDu] = useState<{ luot: LuotChiPhi[]; tongLan: number; tongUsd: number; soTrang: number } | null>(null);
  const [loi, setLoi] = useState('');
  useEffect(() => {
    let huy = false;
    setDu(null);
    setLoi('');
    api.quanLy
      .saoKeTrang(t.id, ky, so)
      .then(({ data }) => !huy && setDu(data))
      .catch((e) => !huy && setLoi(e instanceof ApiError ? e.message : 'Chưa tải được sao kê'));
    return () => {
      huy = true;
    };
  }, [t.id, ky, so]);

  const tien = tienTrang(t);
  const TieuDe = ({ chu, nhan }: { chu: string; nhan?: ReactNode }) => (
    <div className="flex items-center gap-2 mb-2">
      <h4 className="font-mono text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">{chu}</h4>
      {nhan}
    </div>
  );
  return (
    <div className="space-y-5">
      {/* Tiền đã chi theo từng loại, mỗi loại một khối có nhãn đã chốt / tạm tính */}
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <TieuDe chu="Tiền AI" nhan={<NhanChot chot={chot.ai} giai={GIAI_CHOT.ai} />} />
          <div className="divide-y divide-outline-variant/60 text-sm">
            {LOAI_TIEN.filter((l) => l.id !== 'kenh' && (tien[l.id] ?? 0) > 1e-9).map((l) => (
              <div key={l.id} className="flex items-center gap-2 py-1.5">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: l.mau }} />
                <span className="flex-1 text-on-surface">{l.ten}</span>
                <span className={clsx('tabular-nums', mauChi(tien[l.id]))}>{chiDu(tien[l.id])}</span>
              </div>
            ))}
            {tienAi(tien) <= 1e-9 && <p className="py-1.5 text-on-surface-variant">Chưa tiêu tiền AI trong kỳ.</p>}
          </div>
        </div>
        <div>
          <TieuDe chu="Kết nối kênh" nhan={<NhanChot chot={chot.kenh} giai={GIAI_CHOT.kenh} />} />
          <div className="divide-y divide-outline-variant/60 text-sm">
            {t.kenh.length === 0 && <p className="py-1.5 text-on-surface-variant">Chưa nối kênh nào.</p>}
            {t.kenh.map((k) => (
              <div key={k.id} className="flex items-center gap-2 py-1.5">
                <span className={clsx('w-2 h-2 rounded-full shrink-0', k.dangNoi ? (k.canNoiLai ? 'bg-orange-400' : 'bg-green-400') : 'bg-slate-500')} />
                <span className="flex-1 min-w-0 truncate text-on-surface">
                  {TEN_NEN_TANG[k.nenTang] ?? k.nenTang} · {k.ten}
                </span>
                <span className={clsx('tabular-nums', mauChi(k.tienUsd))}>{chiDu(k.tienUsd)}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-on-surface-variant mt-1.5">
            Đúng số hoá đơn kết nối kênh tính cho từng kênh, theo số ngày kênh được nối trong kỳ. Kênh đổi Fanpage giữa
            kỳ thì chia theo số ngày ở từng trang.
          </p>
        </div>
        <div>
          <TieuDe chu="Quảng cáo" nhan={t.coFanpage ? <NhanChot chot={chot.quangCao} giai={GIAI_CHOT.quangCao} /> : undefined} />
          <div className="divide-y divide-outline-variant/60 text-sm">
            {!t.coFanpage && <p className="py-1.5 text-on-surface-variant">Trang chưa nối Fanpage — không có quảng cáo để tính.</p>}
            {t.coFanpage && t.quangCao.length === 0 && <p className="py-1.5 text-on-surface-variant">Fanpage chưa có tài khoản quảng cáo nào.</p>}
            {t.quangCao.map((q) => (
              <div key={q.ten} className="py-1.5">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px] text-on-surface-variant shrink-0">campaign</span>
                  <span className="flex-1 min-w-0 truncate text-on-surface">{q.ten}</span>
                  <span className={clsx('tabular-nums', q.soTien ? 'text-red-400' : 'text-on-surface-variant')}>
                    {q.loi || q.soTien === null ? 'chưa đọc được' : tienGoc(q.soTien, q.tienTe)}
                  </span>
                </div>
                {(q.ngoaiTrang ?? 0) > 0 && (
                  <p className="text-[11px] text-on-surface-variant pl-6">
                    Cùng tài khoản này đã chi {tienGoc(q.ngoaiTrang!, q.tienTe).replace('−', '')} cho Fanpage khác / chỉ Instagram — không tính vào trang.
                  </p>
                )}
                {q.lechMuiGio && <p className="text-[11px] text-on-surface-variant pl-6">Ngày đầu/cuối kỳ tính theo múi giờ tài khoản quảng cáo: {q.lechMuiGio}.</p>}
              </div>
            ))}
          </div>
        </div>
        <div>
          <TieuDe chu="Đơn hàng" />
          <div className="text-sm flex items-baseline justify-between gap-2 py-1.5">
            <span className="text-on-surface">{t.donHang.so.toLocaleString('vi-VN')} đơn trong kỳ</span>
            <span className="tabular-nums text-on-surface font-bold">{t.donHang.doanhThu.toLocaleString('vi-VN')} ₫</span>
          </div>
          <p className="text-[11px] text-on-surface-variant">Doanh thu không tính đơn đã huỷ. Mỗi đơn gắn trang ngay lúc tạo (kênh khách nhắn tới).</p>
        </div>
      </div>

      {/*
        Sức khoẻ và AI điều hành của trang nằm ở ④ AI Điều hành trong khối não của trang — bản cũ bày lại cả hai ở đây
        (rà soát lượt 2, T9). Một nút mở thẳng đúng chỗ đó.
      */}
      <button
        type="button"
        onClick={() => { chonNao(t.id); navigate(`${dieuHanh.duong}?the=ket-qua`); }}
        className="w-full sm:w-auto inline-flex items-center gap-2 px-4 h-10 rounded-xl border text-sm font-bold hover:brightness-125 transition"
        style={{ color: dieuHanh.hex, borderColor: `${dieuHanh.hex}80`, background: `${dieuHanh.hex}14` }}
      >
        <span className="material-symbols-outlined text-[18px]">{dieuHanh.bieuTuong}</span>
        Xem sức khoẻ & đề xuất ở ④ AI Điều hành của trang này
      </button>

      {/* Chuỗi 4 khâu: Nội dung → Quảng cáo → Bán hàng → Tổng (phần 2) */}
      <div>
        <h4 className="font-mono text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-2">Chuỗi 4 khâu</h4>
        <BaoCaoChuoi t={t} ky={ky} />
      </div>

      {/* Sao kê từng lượt AI của trang */}
      <div>
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <h4 className="font-mono text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Sao kê từng lượt AI</h4>
          {du && (
            <span className="text-xs text-on-surface-variant tabular-nums">
              {du.tongLan.toLocaleString('vi-VN')} lượt · <span className={mauChi(du.tongUsd)}>{chiDu(du.tongUsd)}</span>
            </span>
          )}
        </div>
        {loi && <p className="text-sm text-red-400">{loi}</p>}
        {!du && !loi && <p className="text-sm text-on-surface-variant">Đang tải…</p>}
        {du && du.luot.length === 0 && <p className="text-sm text-on-surface-variant">Chưa có lượt nào trong kỳ.</p>}
        <div className="divide-y divide-outline-variant/60">
          {du?.luot.map((l) => (
            <DongLuot key={l.id} l={l} />
          ))}
        </div>
        {du && du.soTrang > 1 && (
          <div className="flex items-center justify-between text-sm pt-2">
            <button type="button" disabled={so <= 1} onClick={() => setSo(so - 1)} className="text-primary disabled:text-on-surface-variant/40">
              ‹ Mới hơn
            </button>
            <span className="text-on-surface-variant tabular-nums">
              Trang {so}/{du.soTrang}
            </span>
            <button type="button" disabled={du.soTrang <= so} onClick={() => setSo(so + 1)} className="text-primary disabled:text-on-surface-variant/40">
              Cũ hơn ›
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
