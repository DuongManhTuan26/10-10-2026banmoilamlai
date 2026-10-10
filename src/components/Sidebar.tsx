import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { clsx } from 'clsx';
import { useKhoiNao } from '../lib/ActivePage';
import { BON_AI } from '../lib/bon-ai';

/**
 * Địa chỉ trợ giúp của CHÍNH mình.
 *
 * Trước đây nút này mở docs.zernio.com. Đó là tài liệu của nhà cung cấp hạ
 * tầng: khách trả tiền cho mình lại nhìn thấy tên và trang bán hàng của Zernio,
 * và chỉ cần một cú bấm là họ tự mua thẳng bên đó, bỏ qua mình. Zernio là
 * đường ống chạy phía sau, không phải thứ khách hàng cần biết tới.
 *
 * Đặt VITE_SUPPORT_URL trong .env để trỏ tới kênh hỗ trợ thật (trang trợ giúp,
 * Zalo, hoặc mailto:). Chưa đặt thì đưa về trang Gói dịch vụ trong app, nơi đã
 * có thông tin liên hệ — vẫn nằm trong app, không lộ nhà cung cấp.
 */
const SUPPORT_URL = import.meta.env.VITE_SUPPORT_URL || '/pricing';
const IS_EXTERNAL_SUPPORT = /^https?:|^mailto:/.test(SUPPORT_URL);

export default function Sidebar({
  onLogout,
  laQuanTri = false,
  laChuChuoi = false,
  moKhung = false,
  onDong,
}: {
  onLogout?: () => void;
  /*
   * Trên điện thoại thanh menu là NGĂN KÉO, mặc định trượt ra ngoài màn hình.
   *
   * Đã dựng lại trên màn 375px: thanh menu rộng cố định 288px chiếm 77% bề
   * ngang, đẩy toàn bộ nội dung ra khỏi mép phải — tiêu đề trang bị cắt, các ô
   * số bị cắt, không thao tác được gì. Mà chủ shop thì xem hàng trên điện
   * thoại là chính.
   *
   * Từ lg trở lên nó vẫn đứng cố định như cũ, không đổi gì.
   */
  moKhung?: boolean;
  onDong?: () => void;
  /*
   * Chỉ quản trị mới thấy mục Quản Trị Hệ Thống.
   * Giấu trên giao diện không phải là bảo vệ — máy chủ vẫn kiểm lại vai trò từ
   * database ở mọi lời gọi. Đây chỉ để người thường không nhìn thấy cái nút
   * họ không bấm được.
   */
  laQuanTri?: boolean;
  /*
   * Chủ chuỗi thấy thêm mục Quản Lý Trang. Cũng chỉ là lớp che mắt như trên —
   * máy chủ kiểm lại vai trò từ database ở mọi lời gọi.
   */
  laChuChuoi?: boolean;
}) {
  const viTri = useLocation();
  const { nao } = useKhoiNao();

  /*
   * Chọn một mục là đóng ngăn kéo.
   *
   * Không đóng thì trên điện thoại chủ shop bấm sang trang mới xong vẫn chỉ
   * nhìn thấy cái menu phủ kín màn hình, tưởng là bấm không ăn.
   */
  useEffect(() => { onDong?.(); }, [viTri.pathname]);

  /*
   * MENU THEO KHỐI NÃO (chủ dự án chốt 10/10/2026 — docs/khoi-nao.md).
   *
   *   Trang & kênh                ← nơi DUY NHẤT chọn khối não (bỏ ô chọn trùng — rà soát lượt 2, T1)
   *   KHỐI NÃO AI                 ← 4 AI cố định, liền mạch, luôn đi cùng nhau
   *     Tổng quan khối não
   *     ① AI Nội dung · ② AI Quảng cáo · ③ AI Bán hàng · ④ AI Điều hành
   *   DỮ LIỆU CỦA TRANG           ← thứ thay đổi được để điều hướng AI
   *   QUẢN LÝ                     ← chủ chuỗi / quản trị
   *
   * Chưa có trang nào (vd. chủ chuỗi chưa lập trang) thì không bày khối não rỗng — chỉ phần quản lý.
   */
  const coNao = !!nao;
  const nhomNao = coNao
    ? [
        // Tổng quan khối não thuộc miền ④ Điều hành (xanh ngọc) — src/lib/bon-ai.ts mienTheoDuong.
        { name: 'Tổng quan khối não', icon: 'hub', path: '/', mau: BON_AI[3].hex },
        ...BON_AI.map((a) => ({ name: a.ten, icon: a.bieuTuong, path: a.duong, so: a.so, mau: a.hex })),
      ]
    : [];
  const mucTrangKenh = { name: 'Trang & kênh', icon: 'storefront', path: '/ket-noi' };
  const nhomDuLieu = coNao
    ? [
        { name: 'Báo cáo Telegram', icon: 'notifications_active', path: '/telegram' },
      ]
    : [];
  const nhomQuanLy = [
    // Cùng tên, cùng biểu tượng ở cả hai tầng — một màn hình quản lý dùng chung (chỉ khác phạm vi).
    ...(laChuChuoi ? [{ name: 'Quản Lý Tài Khoản', icon: 'manage_accounts', path: '/quan-ly-trang' }] : []),
    ...(laQuanTri ? [{ name: 'Quản Lý Tài Khoản', icon: 'manage_accounts', path: '/admin' }] : []),
    { name: 'Gói Dịch Vụ', icon: 'workspace_premium', path: '/pricing' },
  ];
  const nhan = (chu: string) => (
    <div className="px-3 pb-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[#E8EDF2]/50">{chu}</div>
  );

  /** Màu sáng của mục khi đang chọn: 4 AI + Tổng quan theo màu miền, mục hệ thống trắng (không tranh màu với 4 AI). */
  const MAU_HE_THONG = '#e2e8f0';
  const renderNavGroup = (items: any[]) => (
    <div className="flex flex-col relative" style={{ gap: '8px' }}>
      {items.map((item) => { const mau: string = item.mau ?? MAU_HE_THONG; return (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.path === '/'}
          className={({ isActive }) => clsx(
            "relative flex items-center gap-3 px-3 rounded-lg transition-all duration-300 group overflow-hidden shrink-0 cursor-pointer"
          )}
          style={({ isActive }) => ({
            height: '40px',
            fontFamily: "'Be Vietnam Pro', sans-serif",
            fontSize: '15px',
            fontWeight: isActive ? 700 : 600,
            letterSpacing: '0.2px',
            color: isActive ? '#FFFFFF' : '#E8EDF2',
            background: isActive ? `linear-gradient(90deg, ${mau}26 0%, ${mau}03 100%)` : 'transparent',
            borderTop: isActive ? `1px solid ${mau}26` : '1px solid transparent',
            borderRight: isActive ? `1px solid ${mau}26` : '1px solid transparent',
            borderBottom: isActive ? `1px solid ${mau}26` : '1px solid transparent',
            borderLeft: 'none',
          })}
        >
          {({ isActive }) => (
            <>
              {/* Hover background for inactive items */}
              {!isActive && (
                <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
              )}

              {/* Laser left border for active item */}
              {isActive && (
                <div className="absolute left-0 top-[15%] bottom-[15%] w-[3px] rounded-r-md z-20" style={{ background: mau }}></div>
              )}

              {/* Số thứ tự + màu riêng của từng AI trong khối não (src/lib/bon-ai.ts). */}
              {item.so && (
                <span
                  className="relative z-10 w-5 h-5 shrink-0 rounded-md flex items-center justify-center font-mono text-[11px] font-black"
                  style={{ color: item.mau, border: `1px solid ${item.mau}80`, background: `${item.mau}1a` }}
                >
                  {item.so}
                </span>
              )}
              {/* Icon */}
              <span 
                className="material-symbols-outlined relative z-10 transition-all duration-300 flex items-center justify-center w-6" 
                style={{
                  color: isActive ? mau : 'inherit',
                  strokeWidth: isActive ? 2.5 : 2,
                  fontSize: '24px',
                  ...(isActive ? { fontVariationSettings: "'FILL' 1" } : {}),
                }}
              >
                {item.icon}
              </span> 
              
              {/* Text */}
              <span className={clsx("relative z-10 whitespace-nowrap transition-colors duration-300", !isActive && "group-hover:text-white")}>
                {item.name}
              </span>

            </>
          )}
        </NavLink>
      ); })}
    </div>
  );

  return (
    <>
    {/* Nền mờ sau ngăn kéo: bấm ra ngoài là đóng. Chỉ có trên điện thoại. */}
    {moKhung && (
      <div
        onClick={onDong}
        aria-hidden
        className="fixed inset-0 z-40 bg-black/60 lg:hidden"
      />
    )}
    <aside
      className={`w-72 h-screen fixed left-0 top-0 flex flex-col z-50 overflow-hidden bg-[#030509] transition-transform duration-300 lg:translate-x-0 ${moKhung ? 'translate-x-0' : '-translate-x-full'}`}
    >
      {/* Deep Space / Cyberpunk Ambient Background Effects */}
      <div className="absolute -top-32 -left-32 w-96 h-96 bg-[#00e5ff]/10 rounded-full blur-[100px] pointer-events-none"></div>
      <div className="absolute top-[40%] -left-32 w-80 h-80 bg-[#d946ef]/10 rounded-full blur-[100px] pointer-events-none"></div>
      <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-[#00e5ff]/10 rounded-full blur-[100px] pointer-events-none"></div>
      
      {/* Subtle Grid Pattern for Tech Vibe */}
      <div 
        className="absolute inset-0 opacity-[0.02] pointer-events-none" 
        style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)', backgroundSize: '24px 24px' }}
      ></div>

      {/* The Strongest Line: Neon Right Border */}
      <div className="absolute right-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-transparent via-[#00e5ff] to-transparent shadow-[0_0_20px_#00e5ff,0_0_40px_#00e5ff,0_0_10px_#ffffff] z-20"></div>

      {/* Main Content Wrapper */}
      <div className="relative z-10 px-5 h-full flex flex-col pt-6 pb-6">
        
        {/* Brand Header */}
        <div className="flex items-center gap-3 px-3 shrink-0" style={{ marginBottom: '24px' }}>
          <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 relative overflow-hidden group border border-[#00e5ff]/30 bg-[#00e5ff]/10 shadow-[0_0_15px_rgba(0,229,255,0.2)]">
            <div className="absolute inset-0 bg-gradient-to-tr from-[#00e5ff]/20 to-transparent"></div>
            <span className="material-symbols-outlined text-[#00e5ff] text-[20px] relative z-10 filter drop-shadow-[0_0_5px_rgba(0,229,255,0.8)]">token</span>
          </div>
          <div>
            <h2 className="text-[18px] font-black tracking-widest bg-clip-text text-transparent bg-gradient-to-r from-white via-white to-white/50 uppercase">LOGO</h2>
          </div>
        </div>

        <nav className="flex flex-col min-h-0 overflow-y-auto no-scrollbar">
          {/* Trang & kênh ngay dưới logo: nơi chọn khối não (trang bán hàng) và nối kênh. */}
          {(coNao || laChuChuoi || laQuanTri) && renderNavGroup([mucTrangKenh])}
          {coNao && (
            <>
              <div style={{ height: '20px', flexShrink: 0 }}></div>
              {nhan('Khối não AI')}
              {/* Viền bao trọn 4 AI: một khối liền mạch, không tách rời. */}
              <div className="rounded-2xl border border-white/10 p-1.5 shrink-0" style={{ background: 'rgba(255,255,255,0.02)' }}>
                {renderNavGroup(nhomNao)}
              </div>
              <div style={{ height: '20px', flexShrink: 0 }}></div>
              {nhan('Dữ liệu của trang')}
              {renderNavGroup(nhomDuLieu)}
            </>
          )}
          <div style={{ height: '20px', flexShrink: 0 }}></div>
          {nhan('Quản lý')}
          {renderNavGroup(nhomQuanLy)}
        </nav>

        {/* Spacer */}
        <div className="flex-1"></div>

        {/* CTA & Footer */}
        <div className="flex flex-col shrink-0 mt-4">
          <div style={{ height: '1px', background: 'linear-gradient(90deg, transparent, rgba(0,229,255,0.2), transparent)' }}></div>
          <div style={{ height: '16px' }}></div>
          <div className="flex flex-col" style={{ gap: '4px' }}>
            <a
              className="flex items-center gap-3 px-3 rounded-lg hover:bg-white/5 transition-colors group shrink-0"
              href={SUPPORT_URL}
              {...(IS_EXTERNAL_SUPPORT ? { target: '_blank', rel: 'noreferrer' } : {})}
              style={{
                color: 'rgba(232,237,242,0.4)',
                fontSize: '13px',
                fontWeight: 400,
                height: '40px',
                fontFamily: "'Be Vietnam Pro', sans-serif"
              }}
            >
              <span 
                className="material-symbols-outlined transition-colors group-hover:text-white flex items-center justify-center w-6" 
                style={{ strokeWidth: 1.5, color: 'inherit', fontSize: '20px' }}
              >
                help
              </span> 
              <span className="whitespace-nowrap group-hover:text-white transition-colors">Trợ giúp</span>
            </a>
            <button 
              className="flex items-center gap-3 px-3 rounded-lg hover:bg-[#ef4444]/10 hover:text-[#ef4444] transition-colors group shrink-0 w-full text-left" 
              onClick={onLogout}
              style={{ 
                color: 'rgba(232,237,242,0.4)', 
                fontSize: '13px', 
                fontWeight: 400, 
                height: '40px',
                fontFamily: "'Be Vietnam Pro', sans-serif"
              }}
            >
              <span 
                className="material-symbols-outlined transition-colors flex items-center justify-center w-6" 
                style={{ strokeWidth: 1.5, color: 'inherit', fontSize: '20px' }}
              >
                logout
              </span> 
              <span className="whitespace-nowrap transition-colors">Đăng xuất</span>
            </button>
          </div>
        </div>
      </div>
    </aside>
    </>
  );
}
