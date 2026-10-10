import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import Sidebar from './components/Sidebar';
import TopNavBar from './components/TopNavBar';
import ErrorBoundary from './components/ErrorBoundary';
import { TongQuanKhoiNao, NoiDungAi, QuangCaoAi, BanHangAi, DieuHanhAi } from './pages/KhoiNao';
import TelegramAlerts from './pages/TelegramAlerts';
import Connections from './pages/Connections';
import Pricing from './pages/Pricing';
// Một màn hình quản lý dùng chung cho quản trị tổng và chủ chuỗi (chủ dự án 04/10/2026: giống 100%, chỉ khác phạm vi).
import QuanLy from './pages/QuanLy';
import DangXemThay from './components/DangXemThay';
import Auth from './pages/Auth';
import Onboarding from './pages/Onboarding';
import SetupComplete from './pages/SetupComplete';
import { api, ApiError, KHOA_TRANG_DANG_CHON, type User } from './lib/api';
import { ActivePageProvider, useKhoiNao } from './lib/ActivePage';
import { mienTheoDuong } from './lib/bon-ai';

type AppState = 'loading' | 'auth' | 'onboarding' | 'setup_complete' | 'main';

export default function App() {
  // Màu miền của vùng nội dung theo đường dẫn (index.css .mien-*): mọi màu chính bên trong theo đúng AI đang xem.
  const mien = mienTheoDuong(useLocation().pathname);
  const [appState, setAppState] = useState<AppState>('loading');
  /*
   * Ngăn kéo menu trên điện thoại. Từ lg trở lên biến này không có tác dụng gì
   * vì thanh menu luôn đứng cố định.
   */
  const [menuMo, setMenuMo] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // Kiểm tra phiên hiện có khi mở trang. Người dùng đã đăng nhập rồi thì
  // không bắt đăng nhập lại mỗi lần tải lại trang.
  useEffect(() => {
    let cancelled = false;

    api.auth
      .me()
      .then(({ user }) => {
        if (cancelled) return;
        setUser(user);
        setAppState('main');
      })
      .catch((error) => {
        if (cancelled) return;
        if (!(error instanceof ApiError) || !error.isUnauthorized) {
          console.error('Không kiểm tra được phiên đăng nhập:', error);
        }
        setAppState('auth');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * Phiên chết giữa chừng — đưa thẳng về màn hình đăng nhập.
   *
   * Lớp gọi API bắn sự kiện này khi máy chủ trả 401. Thiếu chỗ lắng nghe thì
   * giao diện cứ đứng nguyên còn mọi thao tác lặng lẽ hỏng, trông y như treo.
   */
  useEffect(() => {
    const onUnauthorized = () => {
      setUser(null);
      setAppState('auth');
    };
    window.addEventListener('phien-het-han', onUnauthorized);
    return () => window.removeEventListener('phien-het-han', onUnauthorized);
  }, []);

  // Ảnh đại diện trên thanh trên lấy từ kênh đã kết nối, không dùng ảnh dựng sẵn.
  useEffect(() => {
    if (appState !== 'main') return;
    let cancelled = false;

    api.connections
      .accounts()
      .then(({ data }) => {
        if (cancelled) return;
        const active = data.find((account) => account.connected && account.profile_picture);
        setAvatarUrl(active?.profile_picture ?? null);
      })
      .catch(() => {
        /* Không lấy được ảnh thì hiển thị chữ cái đầu, không cần báo lỗi. */
      });

    return () => {
      cancelled = true;
    };
  }, [appState]);

  const handleLogout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch (error) {
      console.error('Đăng xuất thất bại:', error);
    }
    // Quên trang đang chọn — người đăng nhập sau (máy dùng chung) không mang theo trang của người trước.
    try { localStorage.removeItem(KHOA_TRANG_DANG_CHON); } catch { /* trình duyệt chặn localStorage */ }
    setUser(null);
    setAppState('auth');
  }, []);

  if (appState === 'loading') {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-background gap-4">
        <div className="w-10 h-10 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        <p className="font-body-md text-on-surface-variant">Đang tải hệ thống…</p>
      </div>
    );
  }

  if (appState === 'auth') {
    return (
      <Auth
        onLogin={(loggedIn) => {
          setUser(loggedIn);
          setAppState('main');
        }}
        onRegister={(registered) => {
          setUser(registered);
          /*
           * Người mới đăng ký là CHỦ CHUỖI, chưa có trang nào.
           *
           * Màn hình hướng dẫn ban đầu là dành cho một trang bán hàng: nối
           * Fanpage, huấn luyện AI, chạy thử kịch bản. Chủ chuỗi chưa có trang
           * thì không làm được bước nào trong đó. Việc đầu tiên của họ là lập
           * trang, nên đưa thẳng tới đó.
           */
          setAppState('main');
        }}
      />
    );
  }

  if (appState === 'onboarding') {
    return (
      <Onboarding
        onComplete={() => setAppState('setup_complete')}
        onSkip={() => setAppState('main')}
      />
    );
  }

  if (appState === 'setup_complete') {
    return <SetupComplete onFinish={() => setAppState('main')} />;
  }

  return (
    <ActivePageProvider>
    <div className="flex h-screen w-full bg-background nen-app">
      <Sidebar
        onLogout={handleLogout}
        laQuanTri={user?.role === 'admin'}
        laChuChuoi={user?.role === 'admin_con'}
        moKhung={menuMo}
        onDong={() => setMenuMo(false)}
      />
      <div className="flex-1 lg:ml-72 min-w-0 flex flex-col h-screen relative">
        {/*
          Đang xem thay một trang thì mọi màn hình trông y hệt tài khoản của
          chính mình. Nút vàng cam ở góc phải thanh tiêu đề là thứ phân biệt —
          thanh cố định nên không bao giờ cuộn mất, và không đè lên nội dung.
        */}
        <TopNavBar
          user={user}
          avatarUrl={avatarUrl}
          onMoMenu={() => setMenuMo(true)}
          // Quay lại thì về đúng màn hình quản lý của tầng mình (/quan-ly tự rẽ: quản trị tổng → /admin, chủ chuỗi → /quan-ly-trang).
          gocPhai={<DangXemThay user={user} onQuayLai={() => { window.location.href = '/quan-ly'; }} />}
        />
        <main className={`flex-1 overflow-y-auto custom-scrollbar pt-16 ${mien}`}>
          {/*
            Lỗi ở MỘT màn hình không được kéo đổ cả ứng dụng thành màn hình
            trắng. Hai nút trong lưới hứng lỗi đều điều hướng lại cả trang, nên
            chủ shop luôn thoát ra được.
          */}
          <ErrorBoundary>
          {/*
            Hai bộ tuyến đường tách hẳn nhau theo vai trò.

            Chủ chuỗi không có Fanpage, hộp thư hay đơn hàng của riêng mình —
            những thứ đó thuộc về từng tài khoản trang bên dưới. Trộn chung rồi
            chặn từng đường thì phải có HAI tuyến bắt-tất-cả cùng lúc, mà hai
            tuyến "*" trong một <Routes> là mơ hồ, không có gì bảo đảm tuyến nào
            thắng.

            Không màn hình nào bị xoá: chủ chuỗi thấy lại đầy đủ ngay khi bấm
            "Mở trang" bước vào một trang.
          */}
          <TuyenKhoiNao user={user} />
          </ErrorBoundary>
        </main>
      </div>
    </div>
    </ActivePageProvider>
  );
}

/** Chuyển đường cũ sang đường mới, GIỮ tham số (luồng nối Fanpage quay về /connections?connect=… vẫn chạy). */
function ChuyenHuong({ den, them }: { den: string; them?: Record<string, string> }) {
  const viTri = useLocation();
  const p = new URLSearchParams(viTri.search);
  for (const [k, v] of Object.entries(them ?? {})) if (!p.has(k)) p.set(k, v);
  const q = p.toString();
  return <Navigate to={`${den}${q ? `?${q}` : ''}`} replace />;
}

/**
 * Đường dẫn theo KHỐI NÃO (docs/khoi-nao.md) — một bộ cho mọi vai trò; chỉ khác phần quản lý (chủ chuỗi / quản trị).
 * `key` = trang đang chọn: đổi trang bán hàng là mọi màn hình nạp lại từ đầu cho khối não mới, không màn hình nào giữ
 * dữ liệu của trang cũ.
 */
function TuyenKhoiNao({ user }: { user: User | null }) {
  const { nao } = useKhoiNao();
  return (
    <div key={nao?.trang_id ?? 'chua-co'} className="contents">
    <Routes>
      <Route path="/" element={<TongQuanKhoiNao />} />
      <Route path="/noi-dung" element={<NoiDungAi />} />
      <Route path="/quang-cao" element={<QuangCaoAi />} />
      <Route path="/ban-hang" element={<BanHangAi />} />
      <Route path="/dieu-hanh" element={<DieuHanhAi />} />
      <Route path="/ket-noi" element={<Connections />} />
      <Route path="/telegram" element={<TelegramAlerts />} />
      <Route path="/pricing" element={<Pricing />} />
      {/* Quản lý: một màn hình dùng chung hai tầng, chỉ khác phạm vi. Máy chủ vẫn kiểm vai trò ở mọi lời gọi. */}
      {user?.role === 'admin_con' && <Route path="/quan-ly-trang" element={<QuanLy user={user} />} />}
      {user?.role === 'admin' && <Route path="/admin" element={<QuanLy user={user} />} />}
      <Route path="/quan-ly" element={<Navigate to={user?.role === 'admin' ? '/admin' : '/quan-ly-trang'} replace />} />
      {/* Đường cũ → đường mới của khối não. */}
      <Route path="/content" element={<ChuyenHuong den="/noi-dung" them={{ the: 'dang-lam' }} />} />
      <Route path="/ads" element={<ChuyenHuong den="/quang-cao" them={{ the: 'dang-lam' }} />} />
      <Route path="/inbox" element={<ChuyenHuong den="/ban-hang" them={{ the: 'dang-lam', viec: 'hop-thu' }} />} />
      <Route path="/orders" element={<ChuyenHuong den="/ban-hang" them={{ the: 'dang-lam', viec: 'don-hang' }} />} />
      <Route path="/auto-scripts" element={<ChuyenHuong den="/ban-hang" them={{ the: 'huong-dan' }} />} />
      <Route path="/analytics" element={<ChuyenHuong den="/dieu-hanh" />} />
      <Route path="/connections" element={<ChuyenHuong den="/ket-noi" />} />
      <Route path="*" element={<Navigate to={!nao && user?.role === 'admin_con' ? '/quan-ly-trang' : '/'} replace />} />
    </Routes>
    </div>
  );
}
