import { BON_AI } from '../lib/bon-ai';
import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError, type User } from '../lib/api';
import DoiMatKhau from './DoiMatKhau';

export default function TopNavBar({ user, avatarUrl, onMoMenu, gocPhai }: {
  user?: User | null;
  /** Ảnh đại diện của Fanpage đang hoạt động, lấy từ kênh đã kết nối. */
  avatarUrl?: string | null;
  /** Mở ngăn kéo menu. Chỉ dùng dưới lg, nơi menu không đứng cố định. */
  onMoMenu?: () => void;
  /** Thứ đặt ở góc phải trước chuông (vd. nút "đang xem thay" — luôn thấy, không đè nội dung). */
  gocPhai?: ReactNode;
}) {
  const location = useLocation();
  const [menuMo, setMenuMo] = useState(false);
  const [doiMatKhauMo, setDoiMatKhauMo] = useState(false);
  const navigate = useNavigate();
  const [waitingCount, setWaitingCount] = useState(0);

  // Số hội thoại AI đã nhường quyền, hiện trên chuông thông báo.
  // Nạp lại mỗi khi đổi trang và định kỳ, để nhân viên không bỏ sót khách.
  useEffect(() => {
    let cancelled = false;

    const load = () => {
      api.inbox
        .counts()
        .then(({ data }) => {
          if (!cancelled) setWaitingCount(Number(data.waiting_human) || 0);
        })
        .catch(() => {
          /* Không lấy được số thì để nguyên, không cần báo lỗi ở thanh trên. */
        });
    };

    load();
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [location.pathname]);

  // Tiêu đề theo đường khối não (docs/khoi-nao.md). 4 AI lấy tên từ nguồn duy nhất src/lib/bon-ai.ts.
  const getPageTitle = () => {
    const ai = BON_AI.find((a) => a.duong === location.pathname);
    if (ai) return ai.ten;
    switch (location.pathname) {
      case '/': return 'Tổng quan khối não';
      case '/ket-noi': return 'Kết nối kênh';
      case '/telegram': return 'Báo cáo Telegram';
      case '/pricing': return 'Gói dịch vụ';
      // Cùng một màn hình quản lý cho cả hai tầng — cùng tiêu đề.
      case '/quan-ly-trang': return 'Quản lý tài khoản';
      case '/admin': return 'Quản lý tài khoản';
      default: return 'Tổng quan khối não';
    }
  };

  /*
   * Trên điện thoại thanh này trước đây bị ẩn hẳn (hidden md:flex), nên không
   * còn chỗ nào để mở menu — mà menu thì đã trượt ra ngoài màn hình. Giờ luôn
   * hiện, và dưới lg có thêm nút mở ngăn kéo.
   */
  // Màu tiêu đề theo miền (src/lib/bon-ai.ts): 4 AI theo màu của nó, Tổng quan = ④ Điều hành, trang hệ thống = trắng.
  const aiDangXem = BON_AI.find((a) => a.duong === location.pathname);
  const mauTieuDe = aiDangXem?.hex ?? (location.pathname === '/' ? BON_AI[3].hex : '#f1f5f9');

  return (
    <nav className="fixed top-0 right-0 w-full lg:w-[calc(100%-288px)] z-40 bg-surface border-b border-outline-variant transition-all duration-200 flex justify-between items-center gap-2 px-4 sm:px-margin py-base h-16">
      <div className="flex items-center gap-2 sm:gap-md min-w-0">
        <button
          onClick={onMoMenu}
          title="Mở menu"
          aria-label="Mở menu"
          className="lg:hidden text-on-surface hover:bg-surface-container-highest/80 rounded-lg p-2 -ml-1 transition-colors flex items-center justify-center shrink-0"
        >
          <span className="material-symbols-outlined">menu</span>
        </button>
        <h1 className="text-xl sm:text-2xl font-bold truncate" style={{ color: mauTieuDe }}>{getPageTitle()}</h1>
      </div>
      <div className="flex items-center gap-base">
        {gocPhai}
        <button
          onClick={() => navigate('/ban-hang?the=dang-lam&viec=hop-thu')}
          title={waitingCount > 0 ? `${waitingCount} hội thoại đang chờ bạn xử lý` : 'Không có việc nào đang chờ'}
          className="text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest/80 rounded-full p-2 transition-all duration-200 flex items-center justify-center relative"
        >
          <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 0" }}>notifications</span>
          {/* Khách chờ người = việc cần làm ngay → hồng (bảng B). */}
          {waitingCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-gap text-black text-[10px] font-bold flex items-center justify-center border-2 border-surface">
              {waitingCount > 99 ? '99+' : waitingCount}
            </span>
          )}
        </button>
        <button
          onClick={() => navigate('/auto-scripts')}
          title="Cấu hình AI bán hàng"
          className="text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest/80 rounded-full p-2 transition-all duration-200 flex items-center justify-center"
        >
          <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 0" }}>bolt</span>
        </button>
        <div className="relative ml-sm">
        <div
          onClick={() => setMenuMo((v) => !v)}
          className="h-8 w-8 rounded-full border-2 border-white/30 overflow-hidden relative group cursor-pointer"
          title={user?.email ?? ''}
        >
          {avatarUrl ? (
            <img alt="Active Fanpage Avatar" className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300" src={avatarUrl}/>
          ) : (
            /* Chỉ dùng khi Fanpage chưa có ảnh đại diện — giữ nguyên khung tròn và viền */
            <div className="w-full h-full bg-surface-container-high flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
              <span className="font-label-sm font-bold text-on-surface text-sm">
                {(user?.name || user?.email || '?').trim().charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          {/* Bỏ chấm xanh "đang trực tuyến" — không đo gì (rà soát lượt 2, T10). */}
        </div>

        {/*
          Menu tài khoản.

          Trước đây ảnh đại diện có con trỏ bàn tay nhưng bấm KHÔNG làm gì, và
          hệ thống không có chỗ nào đổi mật khẩu — khách đổi máy hay nghi lộ mật
          khẩu là bó tay hoàn toàn.
        */}
        {menuMo && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuMo(false)} />
            <div className="absolute right-0 mt-2 w-64 bg-noi border border-outline-variant rounded-xl shadow-xl z-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-outline-variant/50">
                <p className="text-sm font-bold text-on-surface truncate">{user?.name || 'Gian hàng'}</p>
                <p className="text-xs text-on-surface-variant truncate">{user?.email}</p>
              </div>
              <button
                onClick={() => { setMenuMo(false); setDoiMatKhauMo(true); }}
                className="w-full text-left px-4 py-3 text-sm text-on-surface hover:bg-surface-variant transition-colors flex items-center gap-3"
              >
                <span className="material-symbols-outlined text-[18px]">key</span>
                Đổi mật khẩu
              </button>
            </div>
          </>
        )}
        </div>
      </div>

      {doiMatKhauMo && <DoiMatKhau onClose={() => setDoiMatKhauMo(false)} />}
    </nav>
  );
}
