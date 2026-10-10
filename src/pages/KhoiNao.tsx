/**
 * MÀN HÌNH KHỐI NÃO (chủ dự án chốt 10/10/2026 — docs/khoi-nao.md).
 *
 * Tổng quan khối não + 4 AI cố định, mỗi AI cùng một khuôn 4 thẻ (KhuonAi): Hướng dẫn AI · Đang làm · Kết quả · Nhật ký.
 * Thẻ "Đang làm" ghép đúng màn hình làm việc sẵn có của AI đó (không viết bản thứ hai):
 *   ① Nội dung — bài đăng, Xưởng AI, lịch tự đăng      ② Quảng cáo — tài khoản, chiến dịch, đẩy bài
 *   ③ Bán hàng — Hộp thư · Đơn hàng                    ④ Điều hành — chẩn đoán, đề xuất chờ duyệt
 */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { clsx } from 'clsx';
import KhuonAi from '../components/KhuonAi';
import { HuongDanAi, KetQuaAi, NhatKyAi } from '../components/TheKhoiNao';
import DieuHanhThu from '../components/DieuHanhThu';
import { LichDieuHanhForm, SoChiDao } from '../components/ChiDaoAi';
import Content from './Content';
import Ads from './Ads';
import Inbox from './Inbox';
import Orders from './Orders';
import AutoScripts from './AutoScripts';
import Analytics from './Analytics';
import AnToanTaiKhoan from '../components/AnToanTaiKhoan';
import { useKhoiNao } from '../lib/ActivePage';
import { BON_AI, aiTheoMa } from '../lib/bon-ai';
import { api, type ChiSoSucKhoe, type SucKhoeTrang } from '../lib/api';

export function NoiDungAi() {
  return (
    <KhuonAi
      ai="content"
      the={{
        'ket-qua': <KetQuaAi ai="content" />,
        'dang-lam': <Content trongKhuon />,
        'huong-dan': <HuongDanAi ai="content" them={<KhungChiDao ai="content" />} />,
        'nhat-ky': <NhatKyAi ai="content" />,
      }}
    />
  );
}

export function QuangCaoAi() {
  return (
    <KhuonAi
      ai="ads"
      the={{
        'ket-qua': <KetQuaAi ai="ads" />,
        'dang-lam': <Ads trongKhuon />,
        'huong-dan': <HuongDanAi ai="ads" them={<KhungChiDao ai="ads" />} />,
        'nhat-ky': <NhatKyAi ai="ads" />,
      }}
    />
  );
}

/** ③ Bán hàng — "Đang làm" gồm Hộp thư và Đơn hàng (hai việc hằng ngày của AI bán hàng), chuyển bằng ?viec=. */
function BanHangDangLam() {
  const [tim, datTim] = useSearchParams();
  const viec = tim.get('viec') === 'don-hang' ? 'don-hang' : 'hop-thu';
  const chon = (v: string) => datTim((p) => { const m = new URLSearchParams(p); m.set('viec', v); return m; }, { replace: true });
  return (
    <div>
      <div className="inline-flex rounded-xl border border-outline-variant p-1 mb-4 bg-surface-container">
        {[
          { ma: 'hop-thu', ten: 'Hộp thư', icon: 'forum' },
          { ma: 'don-hang', ten: 'Đơn hàng', icon: 'receipt_long' },
        ].map((v) => (
          <button
            key={v.ma}
            onClick={() => chon(v.ma)}
            // Màu chính = màu miền ③ Bán hàng (index.css .mien-ban-hang) — cùng kiểu ô chọn ở thẻ Hướng dẫn AI.
            className={clsx('flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition',
              viec === v.ma ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:text-on-surface')}
          >
            <span className="material-symbols-outlined text-[18px]">{v.icon}</span>
            {v.ten}
          </button>
        ))}
      </div>
      {viec === 'hop-thu' ? (
        // Hộp thư chiếm trọn chiều cao của nó và tự cuộn bên trong.
        <div className="h-[calc(100vh-320px)] min-h-[560px] rounded-2xl border border-outline-variant overflow-hidden bg-surface">
          <Inbox />
        </div>
      ) : (
        <Orders trongKhuon />
      )}
    </div>
  );
}

export function BanHangAi() {
  return (
    <KhuonAi
      ai="sales"
      the={{
        // An toàn tài khoản + quy định gửi tin của Facebook (chuyển từ Gói dịch vụ — rà soát lượt 2, T11).
        'ket-qua': <KetQuaAi ai="sales" them={<AnToanTaiKhoan />} />,
        'dang-lam': <BanHangDangLam />,
        // Vai trò, tài liệu, các bước bán hàng, tự chủ, kịch bản bình luận — màn hình cấu hình sẵn có của AI bán hàng.
        'huong-dan': (
          <div className="space-y-6">
            <KhungChiDao ai="sales" />
            <AutoScripts trongKhuon />
          </div>
        ),
        'nhat-ky': <NhatKyAi ai="sales" />,
      }}
    />
  );
}

/** Chỉ đạo AI điều hành đang gửi cho MỘT AI nhân viên — hiện ở thẻ Hướng dẫn AI của AI đó (gỡ được). */
function KhungChiDao({ ai }: { ai: 'content' | 'ads' | 'sales' }) {
  return (
    <div className="khung-muc mau-tim">
      <h3 className="tieu-de-muc dau-muc">Chỉ đạo từ ④ AI Điều hành</h3>
      <SoChiDao ai={ai} />
    </div>
  );
}

export function DieuHanhAi() {
  const { nao } = useKhoiNao();
  const [lanTai, setLanTai] = useState(0);
  return (
    <KhuonAi
      ai="analytics"
      the={{
        'ket-qua': <KetQuaAi ai="analytics" them={<Analytics trongKhuon />} />,
        'dang-lam': nao ? (
          <div className="space-y-6">
            <div className="khung-muc mau-tim">
              <h3 className="tieu-de-muc dau-muc">Chỉ đạo đang gửi cho 3 AI nhân viên</h3>
              <div key={lanTai}><SoChiDao choThem /></div>
            </div>
            <div className="khung-muc mau-xanh">
              <h3 className="tieu-de-muc dau-muc">Chẩn đoán & đề xuất</h3>
              <DieuHanhThu trangId={nao.trang_id} onDaDoi={() => setLanTai((n) => n + 1)} />
            </div>
          </div>
        ) : null,
        'huong-dan': (
          <HuongDanAi
            ai="analytics"
            them={
              <div className="khung-muc mau-xanh">
                <h3 className="tieu-de-muc dau-muc">Lịch điều hành hằng ngày</h3>
                <LichDieuHanhForm />
              </div>
            }
          />
        ),
        'nhat-ky': <NhatKyAi ai="analytics" />,
      }}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------------

const MUC_TOT = { dang_manh: 2, on: 1, chua_du: 0, tut: -1 } as const;

/** Tình trạng một AI = chỉ số tệ nhất của khâu nó (có sự cố → sự cố). Đúng bảng sức khoẻ, không tự chấm lại. */
function tinhTrang(du: SucKhoeTrang | null, khau: ChiSoSucKhoe['khau'] | null) {
  if (!du) return null;
  const chiSo = khau ? du.chiSo.filter((c) => c.khau === khau) : du.chiSo;
  const suCo = khau ? du.suCo.filter((s) => s.khau === khau) : du.suCo;
  if (suCo.length) return { chu: `${suCo.length} sự cố`, mau: 'text-orange-400 bg-orange-400/10 border-orange-400/40' };
  const tut = chiSo.filter((c) => c.muc === 'tut').length;
  if (tut) return { chu: `${tut} chỉ số tụt`, mau: 'text-red-400 bg-red-500/10 border-red-500/40' };
  const manh = chiSo.filter((c) => c.muc === 'dang_manh').length;
  if (manh) return { chu: `${manh} chỉ số đang mạnh`, mau: 'text-green-400 bg-green-500/10 border-green-500/40' };
  const du2 = chiSo.filter((c) => MUC_TOT[c.muc] > 0).length;
  if (du2) return { chu: 'Ổn', mau: 'text-green-400 bg-green-500/10 border-green-500/40' };
  return { chu: 'Chưa đủ dữ liệu', mau: 'text-on-surface-variant bg-surface-container-highest border-outline-variant' };
}

/** Tổng quan khối não — sơ đồ 4 AI liền mạch của trang đang chọn, mỗi AI một ô: chức năng · tình trạng · vào xem. */
export function TongQuanKhoiNao() {
  const { nao, dsNao, loading } = useKhoiNao();
  const [du, setDu] = useState<SucKhoeTrang | null>(null);
  const [loi, setLoi] = useState('');

  useEffect(() => {
    if (!nao) return;
    let huy = false;
    setDu(null);
    setLoi('');
    api.quanLy.sucKhoe(nao.trang_id).then(({ data }) => !huy && setDu(data)).catch(() => !huy && setLoi('Chưa tải được tình trạng'));
    return () => { huy = true; };
  }, [nao?.trang_id]);

  if (loading) return <div className="p-8 text-on-surface-variant">Đang tải khối não…</div>;
  if (!nao) {
    return (
      <div className="p-8 max-w-3xl">
        <h1 className="text-2xl font-bold text-on-surface mb-2">Chưa có trang bán hàng nào</h1>
        <p className="text-on-surface-variant">
          {dsNao.length === 0 ? 'Mỗi trang bán hàng có một khối não 4 AI. Lập trang (hoặc nối Fanpage) để bắt đầu.' : 'Chọn một trang ở đầu thanh menu.'}
        </p>
      </div>
    );
  }

  const nhanVien = BON_AI.filter((a) => a.so <= 3);
  const dieuHanh = BON_AI[3];
  const o = (a: (typeof BON_AI)[number]) => {
    const tt = tinhTrang(du, a.so <= 3 ? (a.khau as ChiSoSucKhoe['khau']) : null);
    return (
      <Link key={a.ma} to={a.duong} className={clsx('khung-muc block hover:brightness-125 transition', a.mau)}>
        <div className="dau-muc flex items-center gap-3">
          <span className="w-9 h-9 rounded-lg flex items-center justify-center font-mono text-lg font-black shrink-0"
            style={{ color: a.hex, border: `1px solid ${a.hex}99`, background: `${a.hex}1f` }}>{a.so}</span>
          <span className="text-lg font-bold" style={{ color: a.hex }}>{a.ten}</span>
          <span className="material-symbols-outlined ml-auto text-[20px]" style={{ color: a.hex }}>{a.bieuTuong}</span>
        </div>
        <p className="text-sm text-on-surface-variant min-h-[40px]">{a.chucNang}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          {tt ? (
            <span className={clsx('text-[12px] font-bold border rounded-lg px-2 py-0.5', tt.mau)}>{tt.chu}</span>
          ) : (
            <span className="text-[12px] text-on-surface-variant">{loi || 'Đang chấm…'}</span>
          )}
          <span className="text-[12px] font-bold" style={{ color: a.hex }}>Vào xem →</span>
        </div>
      </Link>
    );
  };

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto w-full">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-on-surface tracking-tight">Khối não của trang {nao.ten}</h1>
        <p className="text-on-surface-variant text-sm mt-1">
          4 AI cố định, liền mạch: 3 AI nhân viên làm việc theo dòng khách hàng; AI điều hành chấm hiệu suất mỗi ngày, giữ cái
          tốt, tìm nguyên nhân cái chưa tốt và chỉ đạo sửa — vòng lặp tự hoàn thiện.
        </p>
      </div>

      {/* 3 AI nhân viên theo dòng khách: nội dung kéo khách → quảng cáo khuếch đại → bán hàng chốt đơn. */}
      <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr] items-stretch">
        {nhanVien.map((a, i) => (
          <div key={a.ma} className="contents">
            {o(a)}
            {i < nhanVien.length - 1 && (
              <div className="hidden lg:flex items-center justify-center text-on-surface-variant">
                <span className="material-symbols-outlined">arrow_forward</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Vòng lặp: kết quả 3 AI đi lên AI điều hành, chỉ đạo đi ngược xuống. */}
      <div className="flex items-center justify-center gap-6 my-3 text-[12px] text-on-surface-variant">
        <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[18px]">arrow_downward</span>số liệu năng suất, hiệu suất mỗi ngày</span>
        <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[18px]">arrow_upward</span>chỉ đạo: giữ cái tốt, sửa cái chưa tốt</span>
      </div>

      <div className="max-w-3xl mx-auto">{o(dieuHanh)}</div>

      {du && du.uuTien.length > 0 && (
        <div className="mt-6 khung-muc mau-tim">
          <h3 className="tieu-de-muc dau-muc">Việc AI điều hành cần xử lý trước</h3>
          <ol className="list-decimal pl-5 text-sm space-y-1">
            {du.uuTien.map((m) => {
              const c = du.chiSo.find((x) => x.ma === m);
              return <li key={m} className="text-on-surface">{c?.ten}</li>;
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
