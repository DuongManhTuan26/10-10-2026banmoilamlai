/**
 * MÀN HÌNH QUẢN LÝ TÀI KHOẢN — DÙNG CHUNG cho quản trị tổng và chủ chuỗi (admin con).
 *
 * Chủ dự án 04/10/2026: "mọi chức năng, tính năng, giao diện tổng thể giữa admin tổng và admin con phải giống 100%
 * tuyệt đối, không được khác dù 1 dấu chấm dấu phẩy … duy nhất khác ở chức năng phân tầng để quản lý. Sau này sửa
 * 1 bên tổng thì phải lập tức đồng nhất luôn với các bên còn lại." Trước đó là hai trang, hai bộ mã (Admin.tsx dạng
 * bảng, QuanLyTrang.tsx dạng thẻ) lệch nhau gần như mọi chỗ.
 *
 * Nay MỘT trang, MỘT bộ mã. Chỉ khác PHẠM VI dữ liệu (máy chủ quyết định, services/quan-ly-chung.ts) và vài việc
 * thuộc tầng:
 *   - quản trị tổng: mọi tài khoản, xếp theo cây (admin con → trang con; tài khoản đứng riêng); tạo được chủ chuỗi
 *     hoặc tài khoản đứng riêng; chuyển tài khoản đứng riêng thành chủ chuỗi; chi phí cả hệ thống + cài đặt cảnh báo;
 *   - admin con: chính mình + các trang mình lập; tạo trang con; chi phí của chuỗi mình.
 * Mọi thứ khác (bố cục, thẻ, số liệu, nút, màu, hộp thoại, nhật ký) là MỘT.
 *
 * Giấu nút trên giao diện không bao giờ là bảo vệ — máy chủ kiểm lại quyền ở mọi lời gọi.
 */
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { clsx } from 'clsx';
import {
  api,
  ApiError,
  type KyTongQuan,
  type NhatKyQuanTri,
  type TaiKhoanQuanLy,
  type TaiKhoanTongQuan,
  type TongQuanQuanLy,
  type TrangTongQuan,
  type User,
} from '../lib/api';
import BangLoi from '../components/BangLoi';
import ChiPhiHeThong from '../components/ChiPhiHeThong';
import DoiMatKhau from '../components/DoiMatKhau';
import HopThoai, { NHAN_O, NUT_CHINH, NUT_PHU, O_NHAP } from '../components/HopThoai';
import { hoiNhap, hoiXacNhan } from '../components/HopHoi';
import { docTinhTrang, mucDoNang, NhanTinhTrang } from '../components/TinhTrangTrang';
import MenuQuanLyTrang, { type MucMenu } from '../components/MenuQuanLyTrang';
import BaoCaoTrangCon from '../components/BaoCaoTrangCon';
import {
  BaoCaoMotTrang,
  gomCay,
  tenTk,
  tienAi,
  tienNhom,
  tienTaiKhoan,
  tienTrang,
  tong,
  TongQuanTaiSan,
  trangCuaNhom,
  type NhomGoc,
  type TienTheoLoai,
} from '../components/QuanLyTongQuan';
import { chi, mauChi } from '../lib/tien-chi';

const TEN_VIEC: Record<string, string> = {
  tao_tai_khoan: 'Tạo tài khoản',
  sua_tai_khoan: 'Sửa tài khoản',
  khoa_tai_khoan: 'Khoá tài khoản',
  mo_khoa_tai_khoan: 'Mở khoá tài khoản',
  cap_lai_mat_khau: 'Cấp lại mật khẩu',
  xoa_tai_khoan: 'Xoá tài khoản',
  lap_trang: 'Lập trang',
  doi_ten_trang: 'Đổi tên',
  doi_ten_dang_nhap: 'Đổi tên đăng nhập',
  khoa_trang: 'Khoá tài khoản',
  mo_khoa_trang: 'Mở khoá tài khoản',
  cap_lai_mat_khau_trang: 'Cấp lại mật khẩu',
  xoa_trang: 'Xoá tài khoản',
  mo_trang: 'Mở tài khoản',
  roi_trang: 'Quay lại quản lý',
  thanh_chu_chuoi: 'Chuyển thành chủ chuỗi',
  doi_nguong_chi_phi: 'Đổi ngưỡng cảnh báo chi phí',
};

const gioVN = (luc: string | null) => (luc ? new Date(luc).toLocaleString('vi-VN') : '—');

export default function QuanLy({ user }: { user: User | null }) {
  /** Tầng: quản trị tổng hay chủ chuỗi. Mọi khác biệt về giao diện chỉ được rẽ theo biến này. */
  const laTong = user?.role === 'admin';

  const [ds, setDs] = useState<TaiKhoanQuanLy[]>([]);
  const [nhatKy, setNhatKy] = useState<NhatKyQuanTri[]>([]);
  const [dangTai, setDangTai] = useState(true);
  const [loi, setLoi] = useState('');
  const [dangLam, setDangLam] = useState<number | null>(null);
  /** Hai phần tách riêng (chủ dự án 04/10/2026): Tổng quan (biểu đồ) / Chi tiết (cây). Nhớ phần đang xem. */
  const [phan, setPhan] = useState<'tong_quan' | 'chi_tiet'>(() => {
    try {
      return localStorage.getItem('quanLyPhan') === 'chi_tiet' ? 'chi_tiet' : 'tong_quan';
    } catch {
      return 'tong_quan';
    }
  });
  const doiPhan = (p: 'tong_quan' | 'chi_tiet') => {
    setPhan(p);
    try {
      localStorage.setItem('quanLyPhan', p);
    } catch {
      // Trình duyệt chặn lưu — vẫn đổi được, chỉ không nhớ.
    }
  };
  const [ky, setKy] = useState<KyTongQuan>('thang_nay');
  const [tq, setTq] = useState<TongQuanQuanLy | null>(null);
  const [loiTq, setLoiTq] = useState('');
  /** Dòng đang mở trong cây: tk-<id> (tài khoản/chuỗi), tr-<id> (trang), vh-<id> (số liệu vận hành). Mặc định đóng hết. */
  const [mo, setMo] = useState<Set<string>>(new Set());

  // Tạo tài khoản
  const [moTao, setMoTao] = useState(false);
  const [vaiTroMoi, setVaiTroMoi] = useState<'admin_con' | 'shop'>('admin_con');
  const [emailMoi, setEmailMoi] = useState('');
  const [tenMoi, setTenMoi] = useState('');
  const [matKhauMoi, setMatKhauMoi] = useState('');
  const [dangTao, setDangTao] = useState(false);
  /** Mật khẩu chỉ hiện ĐÚNG MỘT LẦN. tuDat: người quản lý tự gõ. */
  const [matKhauVua, setMatKhauVua] = useState<{ ten: string; tenDangNhap: string; mk: string; tuDat: boolean } | null>(null);
  // Sửa thông tin
  const [dangSua, setDangSua] = useState<TaiKhoanQuanLy | null>(null);
  const [suaTen, setSuaTen] = useState('');
  const [suaDangNhap, setSuaDangNhap] = useState('');
  // Đặt mật khẩu mới (tài khoản khác) / đổi mật khẩu của chính mình
  const [datMatKhau, setDatMatKhau] = useState<{ tk: TaiKhoanQuanLy; mk: string } | null>(null);
  const [doiMatKhauMo, setDoiMatKhauMo] = useState(false);

  const nap = useCallback(async () => {
    try {
      const [a, b] = laTong
        ? await Promise.all([api.admin.accounts(), api.admin.audit()])
        : await Promise.all([api.quanLy.danhSach(), api.quanLy.nhatKy()]);
      setDs(a.data);
      setNhatKy(b.data);
    } catch (error) {
      setLoi(error instanceof ApiError ? error.message : 'Không tải được danh sách tài khoản');
    } finally {
      setDangTai(false);
    }
  }, [laTong]);
  useEffect(() => {
    void nap();
  }, [nap]);

  const napTongQuan = useCallback(async () => {
    try {
      setLoiTq('');
      setTq((await api.quanLy.tongQuan(ky)).data);
    } catch (error) {
      setLoiTq(error instanceof ApiError ? error.message : 'Không tải được tổng quan');
    }
  }, [ky]);
  useEffect(() => {
    void napTongQuan();
  }, [napTongQuan]);

  const lam = async (tk: TaiKhoanQuanLy, viec: () => Promise<unknown>, loiMacDinh: string) => {
    setDangLam(tk.id);
    setLoi('');
    try {
      await viec();
      await Promise.all([nap(), napTongQuan()]);
    } catch (error) {
      setLoi(error instanceof ApiError ? error.message : loiMacDinh);
    } finally {
      setDangLam(null);
    }
  };

  // --- Việc trên từng tài khoản: CÙNG nút ở cả hai tầng; máy chủ của từng tầng làm việc tương ứng. ---

  const moTrang = async (tk: TaiKhoanQuanLy) => {
    setDangLam(tk.id);
    try {
      await api.quanLy.moTrang(tk.id);
      // Nạp lại cả ứng dụng: mọi màn hình phải lấy dữ liệu của tài khoản vừa mở.
      window.location.href = '/';
    } catch (error) {
      setLoi(error instanceof ApiError ? error.message : 'Không mở được tài khoản');
      setDangLam(null);
    }
  };

  const doiKhoa = async (tk: TaiKhoanQuanLy) => {
    if (
      tk.is_active &&
      !(await hoiXacNhan({
        tieuDe: `Khoá tài khoản ${tk.email}?`,
        noiDung:
          'Họ sẽ bị đẩy ra khỏi ứng dụng ngay lập tức và không đăng nhập lại được. ' +
          'Dữ liệu vẫn giữ nguyên, mở khoá lúc nào cũng được.',
        nutDongY: 'Khoá tài khoản',
        nguyHiem: true,
      }))
    ) return;
    await lam(tk, () => (laTong ? api.admin.setLocked(tk.id, tk.is_active) : api.quanLy.khoa(tk.id, tk.is_active)), 'Không đổi được trạng thái khoá');
  };

  const xoa = async (tk: TaiKhoanQuanLy) => {
    const go = await hoiNhap({
      tieuDe: `Xoá hẳn tài khoản ${tk.email}?`,
      noiDung: 'Mất sạch khách hàng, hội thoại, đơn hàng, bài đăng và phần AI đã huấn luyện của tài khoản này. Không lấy lại được.',
      nhan: 'Gõ đúng tên đăng nhập của họ để xác nhận',
      goiY: tk.email,
      nutDongY: 'Xoá hẳn',
      nguyHiem: true,
      kiemTra: (v) => (v.trim().toLowerCase() === tk.email.toLowerCase() ? null : 'Chưa đúng tên đăng nhập.'),
    });
    if (go === null) return;
    await lam(tk, () => (laTong ? api.admin.remove(tk.id, go.trim()) : api.quanLy.xoaTrang(tk.id, go.trim())), 'Không xoá được tài khoản');
  };

  const thanhChuChuoi = async (tk: TaiKhoanQuanLy) => {
    if (
      !(await hoiXacNhan({
        tieuDe: `Chuyển ${tk.email} thành tài khoản quản lý chuỗi?`,
        noiDung:
          'Sau khi chuyển, tài khoản này không gắn Fanpage trực tiếp nữa mà lập các tài khoản trang bên dưới, mỗi trang một Fanpage.\n\n' +
          'Người dùng sẽ bị đăng xuất và cần đăng nhập lại.',
        nutDongY: 'Chuyển thành chủ chuỗi',
        bieuTuong: 'account_tree',
      }))
    ) return;
    await lam(
      tk,
      async () => {
        const { data } = await api.admin.thanhChuChuoi(tk.id);
        // Dọn hồ sơ hỏng thì việc chuyển vẫn xong — phải nói rõ để còn dọn tay.
        if (data.loiDonHoSo) throw new ApiError(`Đã chuyển ${data.email}, nhưng chưa dọn được hồ sơ nền tảng. Vui lòng dọn tay.`, 500);
      },
      'Không chuyển được tài khoản'
    );
  };

  /** Phần trước @ của tên đăng nhập nội bộ (trang do chủ chuỗi lập) — chủ chuỗi chỉ đổi được phần này. */
  const laNoiBo = (tk: TaiKhoanQuanLy) => !laTong && !tk.la_toi;
  const moSua = (tk: TaiKhoanQuanLy) => {
    setDangSua(tk);
    setSuaTen(tk.name);
    setSuaDangNhap(laNoiBo(tk) ? tk.email.split('@')[0] : tk.email);
  };
  const luuSua = async () => {
    if (!dangSua) return;
    const tk = dangSua;
    await lam(
      tk,
      async () => {
        if (laTong) {
          await api.admin.update(tk.id, { name: suaTen.trim(), email: suaDangNhap.trim() });
        } else {
          if (suaTen.trim() !== tk.name) await api.quanLy.doiTen(tk.id, suaTen.trim());
          if (laNoiBo(tk) && suaDangNhap.trim() !== tk.email.split('@')[0]) await api.quanLy.doiTenDangNhap(tk.id, suaDangNhap.trim());
        }
        setDangSua(null);
      },
      'Không lưu được thay đổi'
    );
  };

  const luuMatKhauMoi = async () => {
    if (!datMatKhau) return;
    const { tk } = datMatKhau;
    const mk = datMatKhau.mk.trim();
    await lam(
      tk,
      async () => {
        const { data } = laTong
          ? await api.admin.resetPassword(tk.id, mk || undefined)
          : await api.quanLy.capLaiMatKhau(tk.id, mk || undefined);
        setDatMatKhau(null);
        setMatKhauVua({ ten: tk.name, tenDangNhap: tk.email, mk: data.matKhauTam, tuDat: Boolean(mk) });
      },
      'Không đặt được mật khẩu'
    );
  };

  const taoTaiKhoan = async () => {
    if (dangTao) return;
    setLoi('');
    setDangTao(true);
    try {
      const mk = matKhauMoi.trim();
      if (laTong) {
        const { data } = await api.admin.create({ email: emailMoi.trim(), name: tenMoi.trim(), role: vaiTroMoi, matKhau: mk || undefined });
        setMatKhauVua({ ten: data.name, tenDangNhap: data.email, mk: data.matKhauTam, tuDat: Boolean(mk) });
      } else {
        const { data } = await api.quanLy.lapTrang(tenMoi.trim(), mk || undefined);
        setMatKhauVua({ ten: data.name, tenDangNhap: data.tenDangNhap, mk: data.matKhauTam, tuDat: Boolean(mk) });
      }
      setMoTao(false);
      setEmailMoi('');
      setTenMoi('');
      setMatKhauMoi('');
      await Promise.all([nap(), napTongQuan()]);
    } catch (error) {
      setLoi(error instanceof ApiError ? error.message : 'Không tạo được tài khoản');
    } finally {
      setDangTao(false);
    }
  };

  const soKhoa = ds.filter((t) => !t.is_active).length;

  /** Tình trạng vận hành — chỉ tài khoản bán hàng; chủ chuỗi không gắn Fanpage nên không có. */
  const tinhTrang = (t: TaiKhoanQuanLy) => (t.role === 'admin_con' ? [] : docTinhTrang(t));
  const canXuLy = ds
    .map((t) => ({ tk: t, viec: tinhTrang(t).filter((v) => v.mucDo !== 'on') }))
    .filter((x) => x.viec.length > 0)
    .sort((a, b) => (mucDoNang(b.viec) === 'hong' ? 1 : 0) - (mucDoNang(a.viec) === 'hong' ? 1 : 0));

  const menu = (t: TaiKhoanQuanLy): MucMenu[] => [
    { ten: 'Sửa thông tin', onChon: () => moSua(t) },
    t.la_toi
      ? { ten: 'Đổi mật khẩu', onChon: () => setDoiMatKhauMo(true) }
      : { ten: 'Đặt lại mật khẩu', onChon: () => setDatMatKhau({ tk: t, mk: '' }) },
    // Tầng: chỉ quản trị tổng chuyển được tài khoản đứng riêng thành chủ chuỗi.
    ...(laTong && t.role === 'shop' && t.parent_id === null ? [{ ten: 'Thành chủ chuỗi', onChon: () => thanhChuChuoi(t) }] : []),
    ...(!t.la_toi && t.role !== 'admin'
      ? [
          { ten: t.is_active ? 'Khoá tài khoản' : 'Mở khoá tài khoản', onChon: () => doiKhoa(t) },
          { ten: 'Xoá tài khoản', onChon: () => xoa(t), nguyHiem: true },
        ]
      : []),
  ];

  /**
   * PHẦN CHI TIẾT — CÂY ĐÁNH SỐ (chủ dự án 04/10/2026): Chuỗi → Tài khoản → Trang, đánh số 1 · 1.1 · 1.1.1. "1 tài khoản
   * là một ý chính, mỗi trang là một ý con, khi kích vào ý chính … danh sách các trang kết nối mới hiện ra, khi kích
   * tiếp vào từng trang cụ thể mới hiển thị ra bảng báo cáo". Mỗi tầng có biểu tượng + nhãn riêng (CHUỖI / TÀI KHOẢN /
   * TRANG), cỡ chữ riêng, kẻ dòng; cột tiền thẳng hàng ở mọi tầng. Điện thoại: chỉ tên + tổng tiền + nút.
   */
  const LUOI = 'grid items-center gap-x-3 grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_72px_104px_104px_112px_148px]';
  const THU_TU_NANG = { hong: 0, canXem: 1, on: 2 } as const;
  const tkQl = (id: number) => ds.find((t) => t.id === id);
  const canhBaoCua = (id: number) => {
    const t = tkQl(id);
    return t ? tinhTrang(t).filter((v) => v.mucDo !== 'on').sort((a, b) => THU_TU_NANG[a.mucDo] - THU_TU_NANG[b.mucDo]) : [];
  };
  const batTat = (khoa: string) =>
    setMo((s) => {
      const m = new Set(s);
      if (m.has(khoa)) m.delete(khoa);
      else m.add(khoa);
      return m;
    });

  const NHAN_TANG = {
    chuoi: { icon: 'account_tree', chu: 'Chuỗi' },
    tai_khoan: { icon: 'person', chu: 'Tài khoản' },
    trang: { icon: 'storefront', chu: 'Trang' },
  } as const;

  /** Thụt cho dòng phụ ở tầng `sau` (thẳng với chữ của dòng tầng đó): điện thoại 12px/tầng, màn rộng 22px/tầng. */
  const THUT = 'pl-[calc(var(--le,0px)+var(--sau)*12px+26px)] lg:pl-[calc(var(--le,0px)+var(--sau)*22px+26px)]';
  const thut = (sau: number, le = 16) => ({ '--sau': sau, '--le': `${le}px` }) as CSSProperties;

  /** Một dòng của cây — CÙNG khung cột cho mọi tầng. */
  const hang = (o: {
    khoa: string;
    so: string;
    tang: keyof typeof NHAN_TANG;
    ten: string;
    phu?: string;
    soCon: string;
    tien: TienTheoLoai;
    moRa: boolean;
    hoatDong: boolean;
    canhBao?: ReturnType<typeof canhBaoCua>;
    hanhDong?: ReactNode;
  }) => {
    const sau = o.so.split('.').length - 1;
    const nhan = NHAN_TANG[o.tang];
    const t = tong(o.tien);
    return (
      <div
        key={o.khoa}
        role="button"
        tabIndex={0}
        aria-expanded={o.moRa}
        onClick={() => batTat(o.khoa)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') batTat(o.khoa);
        }}
        className={clsx(
          LUOI,
          'px-4 py-3 border-t border-outline-variant/60 cursor-pointer transition-colors hover:bg-surface-container-high',
          sau === 0 ? 'bg-surface-container' : sau === 1 ? 'bg-surface-container-low' : 'bg-surface-container-lowest',
          o.moRa && 'bg-surface-container-high'
        )}
      >
        {/* Thụt theo tầng: điện thoại 12px mỗi tầng, màn rộng 22px. */}
        <div
          className="min-w-0 flex items-center gap-2 pl-[calc(var(--sau)*12px)] lg:pl-[calc(var(--sau)*22px)]"
          style={{ '--sau': sau } as CSSProperties}
        >
          <span
            className="material-symbols-outlined text-[18px] text-primary shrink-0 transition-transform"
            style={{ transform: o.moRa ? 'rotate(90deg)' : undefined }}
          >
            chevron_right
          </span>
          <span className={clsx('font-mono tabular-nums shrink-0 text-on-surface-variant', sau === 0 ? 'text-sm font-bold' : 'text-xs')}>{o.so}</span>
          <span
            title={o.hoatDong ? (o.tang === 'trang' ? 'Có kênh đang nối' : 'Đang mở') : o.tang === 'trang' ? 'Chưa nối kênh' : 'Đã khoá'}
            className={clsx('w-2 h-2 rounded-full shrink-0', o.hoatDong ? 'bg-green-400' : o.tang === 'trang' ? 'bg-slate-500' : 'bg-red-500')}
          />
          <div className="min-w-0">
            <div
              className={clsx(
                // Điện thoại tối đa 2 dòng; màn rộng một dòng (rê chuột xem đủ).
                'text-on-surface line-clamp-2 break-words lg:line-clamp-1 lg:break-all',
                sau === 0 ? 'text-base font-bold' : sau === 1 ? 'text-[15px] font-semibold' : 'text-sm font-medium'
              )}
              title={o.ten}
            >
              {o.ten}
              {o.canhBao && o.canhBao.length > 0 && (
                <span
                  title={o.canhBao.map((v) => v.chu).join('\n')}
                  className={clsx('material-symbols-outlined text-[16px] align-[-3px] ml-1.5', o.canhBao[0].mucDo === 'hong' ? 'text-error' : 'text-orange-400')}
                >
                  {o.canhBao[0].mucDo === 'hong' ? 'error' : 'warning'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 min-w-0 text-xs text-on-surface-variant">
              <span className="material-symbols-outlined text-[13px] text-primary shrink-0">{nhan.icon}</span>
              <span className="font-mono text-[10px] uppercase text-primary shrink-0">{nhan.chu}</span>
              {o.phu && <span className="hidden sm:inline truncate">· {o.phu}</span>}
              {/* Điện thoại: không có cột tiền — tổng nằm ngay dưới tên. */}
              <span className={clsx('lg:hidden shrink-0 tabular-nums', mauChi(t))}>· {chi(t)}</span>
            </div>
          </div>
        </div>
        <div className="hidden lg:block text-right text-sm text-on-surface-variant tabular-nums">{o.soCon}</div>
        <div className={clsx('hidden lg:block text-right text-sm tabular-nums', mauChi(tienAi(o.tien)))}>{chi(tienAi(o.tien))}</div>
        <div className={clsx('hidden lg:block text-right text-sm tabular-nums', mauChi(o.tien.kenh))}>{chi(o.tien.kenh ?? 0)}</div>
        <div className={clsx('hidden lg:block text-right text-sm font-bold tabular-nums', mauChi(t))}>{chi(t)}</div>
        <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          {o.hanhDong}
        </div>
      </div>
    );
  };

  /** Nút việc của một tài khoản — CÙNG nút ở cả hai tầng. */
  const nutTaiKhoan = (id: number) => {
    const t = tkQl(id);
    if (!t) return null;
    return (
      <>
        {!t.la_toi && t.role !== 'admin' && (
          <button
            type="button"
            onClick={() => moTrang(t)}
            disabled={dangLam === t.id || !t.is_active}
            title="Mở trang"
            aria-label="Mở trang"
            className="flex items-center gap-1 px-2 sm:px-3 py-1.5 rounded-lg bg-primary text-on-primary font-bold text-xs disabled:opacity-40 whitespace-nowrap"
          >
            {/* Điện thoại: chỉ biểu tượng cho tên đủ chỗ. */}
            {/* Bọc ngoài: `sm:hidden` gắn thẳng lên biểu tượng không có tác dụng (CSS phông biểu tượng nằm ngoài @layer). */}
            <span className="sm:hidden inline-flex"><span className="material-symbols-outlined text-[18px]">login</span></span>
            <span className="hidden sm:inline">Mở trang</span>
          </button>
        )}
        <MenuQuanLyTrang tat={dangLam === t.id} muc={menu(t)} />
      </>
    );
  };

  /** Một trang + báo cáo của nó (mở khi bấm). */
  const veTrang = (tr: TrangTongQuan, so: string) => {
    const khoa = `tr-${tr.id}`;
    const moRa = mo.has(khoa);
    const noi = tr.kenh.filter((k) => k.dangNoi).length;
    return (
      <div key={khoa}>
        {hang({
          khoa,
          so,
          tang: 'trang',
          ten: tr.ten,
          phu: tr.kenh.length ? tr.kenh.map((k) => k.ten).join(', ') : 'chưa nối kênh',
          soCon: `${noi}/${tr.kenh.length} kênh`,
          tien: tienTrang(tr),
          moRa,
          hoatDong: tr.hoatDong,
        })}
        {moRa && tq && (
          <div className="px-4 sm:px-6 py-4 border-t border-outline-variant/60 bg-surface-container-lowest">
            <BaoCaoMotTrang t={tr} ky={ky} chot={tq.chot} />
          </div>
        )}
      </div>
    );
  };

  /** Một tài khoản: bấm mới hiện các trang của nó (và phần không thuộc trang nào, số liệu vận hành). */
  const veTaiKhoan = (tk: TaiKhoanTongQuan, so: string) => {
    const khoa = `tk-${tk.id}`;
    const moRa = mo.has(khoa);
    const khongTrang = tk.tienAiKhongTrang.tongUsd;
    const vh = `vh-${tk.id}`;
    return (
      <div key={khoa}>
        {hang({
          khoa,
          so,
          tang: 'tai_khoan',
          ten: tenTk(tk) + (tk.laToi ? ' (bạn)' : ''),
          phu: tk.email,
          soCon: `${tk.trang.filter((t) => t.hoatDong).length}/${tk.trang.length} trang`,
          tien: tienTaiKhoan(tk),
          moRa,
          hoatDong: tk.hoatDong,
          canhBao: canhBaoCua(tk.id),
          hanhDong: nutTaiKhoan(tk.id),
        })}
        {moRa && (
          <>
            {tk.trang.length === 0 && (
              <p className={clsx(THUT, 'pr-4 py-2.5 border-t border-outline-variant/60 text-sm text-on-surface-variant bg-surface-container-lowest')} style={thut(so.split('.').length)}>
                Chưa có trang nào.
              </p>
            )}
            {tk.trang.map((tr, k) => veTrang(tr, `${so}.${k + 1}`))}
            {khongTrang > 1e-9 && (
              <div className={clsx(LUOI, 'px-4 py-2.5 border-t border-outline-variant/60 bg-surface-container-lowest text-sm')}>
                <span className={clsx(THUT, 'text-on-surface-variant')} style={thut(so.split('.').length, 0)}>
                  Tiền AI không thuộc trang nào (lượt cũ hoặc tài khoản không có trang)
                </span>
                <span className="hidden lg:block" />
                <span className={clsx('text-right tabular-nums', mauChi(khongTrang))}>{chi(khongTrang)}</span>
                <span className="hidden lg:block" />
                <span className="hidden lg:block" />
                <span className="hidden lg:block" />
              </div>
            )}
            {tk.role !== 'admin_con' && (
              <div className="border-t border-outline-variant/60 bg-surface-container-lowest">
                <button
                  type="button"
                  onClick={() => batTat(vh)}
                  className={clsx(THUT, 'w-full text-left pr-4 py-2.5 text-sm text-primary hover:bg-surface-container-high flex items-center gap-1.5')}
                  style={thut(so.split('.').length)}
                >
                  <span className="material-symbols-outlined text-[16px]">{mo.has(vh) ? 'expand_less' : 'insights'}</span>
                  Số liệu vận hành của tài khoản
                </button>
                {mo.has(vh) && (
                  <div className="px-4 sm:px-6 pb-4">
                    <BaoCaoTrangCon trangId={tk.id} onDong={() => batTat(vh)} />
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  /** Một nhóm gốc: chuỗi (admin con → tài khoản → trang) hoặc tài khoản đứng riêng (→ trang). */
  const veNhom = (g: NhomGoc) => {
    if (g.goc.role !== 'admin_con') return veTaiKhoan(g.goc, String(g.so));
    const khoa = `tk-${g.goc.id}`;
    const moRa = mo.has(khoa);
    const trang = trangCuaNhom(g);
    const conLoi = g.con.filter((c) => canhBaoCua(c.id).length > 0).length;
    return (
      <div key={khoa}>
        {hang({
          khoa,
          so: String(g.so),
          tang: 'chuoi',
          ten: tenTk(g.goc) + (g.goc.laToi ? ' (bạn)' : ''),
          phu: `${g.con.length} tài khoản · ${g.goc.email}`,
          soCon: `${trang.filter((t) => t.hoatDong).length}/${trang.length} trang`,
          tien: tienNhom(g),
          moRa,
          hoatDong: g.goc.hoatDong,
          canhBao: conLoi > 0 ? [{ mucDo: 'canXem', chu: `${conLoi} tài khoản cần xử lý` } as ReturnType<typeof canhBaoCua>[number]] : [],
          hanhDong: nutTaiKhoan(g.goc.id),
        })}
        {moRa && (
          <>
            {g.con.length === 0 && (
              <p className={clsx(THUT, 'pr-4 py-2.5 border-t border-outline-variant/60 text-sm text-on-surface-variant bg-surface-container-low')} style={thut(1)}>
                Chuỗi chưa có tài khoản nào.
              </p>
            )}
            {g.con.map((c, j) => veTaiKhoan(c, `${g.so}.${j + 1}`))}
          </>
        )}
      </div>
    );
  };

  const mkTaoChuaDu = Boolean(matKhauMoi.trim()) && matKhauMoi.trim().length < 8;

  return (
    <main className="p-4 md:p-8 max-w-[1600px] mx-auto w-full">
      <BangLoi noiDung={loi} onDong={() => setLoi('')} className="mb-6" />

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-8">
        <div>
          {/* Tên trang ở thanh trên cùng — không lặp tiêu đề thứ hai. */}
          <p className="text-sm text-on-surface-variant">
            {ds.length} tài khoản{soKhoa > 0 ? `, ${soKhoa} đang bị khoá` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setMoTao(true)}
          className="shrink-0 px-4 py-2 bg-primary text-on-primary font-bold rounded-lg hover:brightness-110 transition-all flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-[18px]">person_add</span>
          Tạo tài khoản
        </button>
      </div>

      {/* Hai phần tách riêng: Tổng quan (tài sản, biểu đồ) và Chi tiết (cây tài khoản → trang). */}
      <div role="tablist" className="flex gap-1 border-b border-outline-variant mb-6">
        {(
          [
            ['tong_quan', 'Tổng quan', 'monitoring'],
            ['chi_tiet', 'Chi tiết', 'account_tree'],
          ] as const
        ).map(([id, ten, icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={phan === id}
            onClick={() => doiPhan(id)}
            className={clsx(
              'flex items-center gap-2 px-4 py-2.5 -mb-px border-b-2 font-bold text-sm transition-colors',
              phan === id ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'
            )}
          >
            <span className="material-symbols-outlined text-[18px]">{icon}</span>
            {ten}
          </button>
        ))}
      </div>

      <BangLoi noiDung={loiTq} onDong={() => setLoiTq('')} className="mb-6" />

      {phan === 'tong_quan' && (
        <div className="mb-8 space-y-8">
          {tq ? (
            <TongQuanTaiSan du={tq} ky={ky} onDoiKy={setKy} phamViChu={laTong ? 'Cả hệ thống' : 'Chuỗi của bạn'} />
          ) : (
            !loiTq && <p className="text-sm text-on-surface-variant">Đang tải…</p>
          )}
          <ChiPhiHeThong phamVi={laTong ? 'he_thong' : 'chuoi'} />
        </div>
      )}

      {phan === 'chi_tiet' && (
        <>
          {/* Việc phải xử lý */}
          {canXuLy.length > 0 && (
            <section className="mb-8">
              <h2 className="tieu-de-muc mb-3">Cần xử lý ({canXuLy.length})</h2>
              <div className="rounded-2xl border border-outline-variant bg-surface-container px-4 py-4 grid gap-2">
                {canXuLy.map(({ tk, viec }) => (
                  <div key={tk.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-bold text-on-surface">{tk.name || tk.email}</span>
                    {viec.map((v, i) => (
                      <NhanTinhTrang key={i} viec={v} />
                    ))}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="mb-8">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h2 className="tieu-de-muc">Tài khoản &amp; trang</h2>
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
                    onClick={() => setKy(id)}
                    className={clsx('px-3 py-1.5', ky === id ? 'bg-primary text-on-primary font-bold' : 'text-on-surface-variant hover:bg-surface-container-high')}
                  >
                    {ten}
                  </button>
                ))}
              </div>
            </div>
            {dangTai || !tq ? (
              <p className="text-sm text-on-surface-variant">Đang tải…</p>
            ) : (
              <div className="rounded-2xl border border-outline-variant overflow-hidden">
                {/* Hàng tiêu đề cột — chỉ màn hình rộng */}
                <div className={clsx(LUOI, 'hidden lg:grid px-4 py-2.5 bg-surface-container font-mono text-[10px] font-bold uppercase tracking-wider text-on-surface-variant')}>
                  <span className="pl-[26px]">Tên</span>
                  <span className="text-right">Trang · kênh</span>
                  <span className="text-right">Tiền AI</span>
                  <span className="text-right">Tiền kênh</span>
                  <span className="text-right">Tổng đã chi</span>
                  <span />
                </div>
                {gomCay(tq).map((g) => veNhom(g))}
              </div>
            )}
          </section>
        </>
      )}

      {/* Nhật ký thao tác — thuộc phần Chi tiết. */}
      {phan === 'chi_tiet' && (
      <section>
        <h2 className="tieu-de-muc mb-3">Nhật ký quản lý</h2>
        <div className="bg-surface-container border border-outline-variant rounded-2xl p-4 space-y-2">
          {nhatKy.length === 0 ? (
            <p className="text-sm text-on-surface-variant">Chưa có thao tác nào.</p>
          ) : (
            nhatKy.map((n) => (
              <div key={n.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm min-w-0">
                <span className="text-xs text-on-surface-variant whitespace-nowrap shrink-0">{gioVN(n.created_at)}</span>
                <span className="font-bold text-on-surface shrink-0">{TEN_VIEC[n.action] ?? n.action}</span>
                <span className="text-on-surface-variant break-all min-w-0">
                  {n.target_email} {n.admin_email ? `· bởi ${n.admin_email}` : ''}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
      )}

      {doiMatKhauMo && <DoiMatKhau onClose={() => setDoiMatKhauMo(false)} />}

      {moTao && (
        <HopThoai
          co="vua"
          bieuTuong="person_add"
          tieuDe="Tạo tài khoản mới"
          phuDe={
            laTong
              ? 'Tài khoản độc lập, ở trạng thái mặc định để chủ shop tự cài. Bạn tự đặt mật khẩu, hoặc để trống cho hệ thống sinh.'
              : 'Một trang mới trong chuỗi của bạn: tài khoản riêng, độc lập hoàn toàn. Tên đăng nhập do hệ thống sinh theo tên trang.'
          }
          onDong={() => setMoTao(false)}
          dongKhiBamNgoai={false}
          chan={
            <>
              <button type="button" onClick={() => setMoTao(false)} className={NUT_PHU}>
                Huỷ
              </button>
              <button
                type="button"
                onClick={taoTaiKhoan}
                disabled={dangTao || (laTong ? !emailMoi.trim() : tenMoi.trim().length < 2) || mkTaoChuaDu}
                className={NUT_CHINH}
              >
                {dangTao ? 'Đang tạo…' : 'Tạo tài khoản'}
              </button>
            </>
          }
        >
          <div className="space-y-6">
            <BangLoi noiDung={loi} onDong={() => setLoi('')} />
            {/* Tầng: chỉ quản trị tổng chọn loại tài khoản (chủ chuỗi / trang đứng riêng). */}
            {laTong && (
              <div>
                <span className={NHAN_O}>Loại tài khoản</span>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      { id: 'admin_con', ten: 'Chủ chuỗi', mo: 'Tự lập các tài khoản trang của mình, mỗi trang một Fanpage. Đây là loại thường dùng.' },
                      { id: 'shop', ten: 'Một trang đứng riêng', mo: 'Gắn được đúng một Fanpage và không lập thêm trang nào. Chỉ dùng cho trường hợp đặc biệt.' },
                    ] as const
                  ).map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => setVaiTroMoi(o.id)}
                      className={clsx(
                        'text-left p-4 rounded-xl border-2 transition-colors',
                        vaiTroMoi === o.id ? 'border-primary bg-primary/10' : 'border-outline-variant bg-surface-container-low hover:border-outline'
                      )}
                    >
                      <div className="flex items-center gap-2 text-base font-bold text-on-surface">
                        <span className={clsx('material-symbols-outlined text-[20px]', vaiTroMoi === o.id ? 'text-primary' : 'text-on-surface-variant')}>
                          {vaiTroMoi === o.id ? 'radio_button_checked' : 'radio_button_unchecked'}
                        </span>
                        {o.ten}
                      </div>
                      <div className="text-sm text-on-surface-variant mt-1.5 pl-7">{o.mo}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="grid gap-5 sm:grid-cols-2">
              {laTong && (
                <label className="block">
                  <span className={NHAN_O}>Email đăng nhập</span>
                  <input type="email" value={emailMoi} onChange={(e) => setEmailMoi(e.target.value)} placeholder="chushop@email.com" className={O_NHAP} />
                </label>
              )}
              <label className={clsx('block', !laTong && 'sm:col-span-2')}>
                <span className={NHAN_O}>{laTong ? 'Tên shop' : 'Tên trang'}</span>
                <input type="text" value={tenMoi} onChange={(e) => setTenMoi(e.target.value)} placeholder="Ví dụ: Chạm Tay Vạn Điều Hay" className={O_NHAP} />
              </label>
              <label className="block sm:col-span-2">
                <span className={NHAN_O}>Mật khẩu</span>
                {/* Người quản lý tự đặt, chữ hiện rõ. Để trống thì hệ thống sinh. */}
                <input
                  type="text"
                  autoComplete="new-password"
                  value={matKhauMoi}
                  onChange={(e) => setMatKhauMoi(e.target.value)}
                  placeholder="Ít nhất 8 ký tự — để trống thì hệ thống tự sinh"
                  className={O_NHAP}
                />
                {mkTaoChuaDu && <span className="block text-sm text-error mt-1.5">Còn thiếu {8 - matKhauMoi.trim().length} ký tự (ít nhất 8).</span>}
              </label>
            </div>
          </div>
        </HopThoai>
      )}

      {dangSua && (
        <HopThoai
          co="vua"
          bieuTuong="edit"
          tieuDe="Sửa thông tin"
          phuDe={dangSua.email}
          onDong={() => setDangSua(null)}
          dongKhiBamNgoai={false}
          chan={
            <>
              <button type="button" onClick={() => setDangSua(null)} className={NUT_PHU}>
                Huỷ
              </button>
              <button type="button" onClick={luuSua} disabled={dangLam === dangSua.id} className={NUT_CHINH}>
                Lưu
              </button>
            </>
          }
        >
          <div className="space-y-5">
            <BangLoi noiDung={loi} onDong={() => setLoi('')} />
            <label className="block">
              <span className={NHAN_O}>Tên</span>
              <input type="text" value={suaTen} onChange={(e) => setSuaTen(e.target.value)} className={O_NHAP} />
            </label>
            {/* Chủ chuỗi không đổi tên đăng nhập của chính mình ở đây (việc của quản trị tổng). */}
            {(laTong || laNoiBo(dangSua)) && (
              <label className="block">
                <span className={NHAN_O}>Tên đăng nhập</span>
                <div className="flex items-center gap-2">
                  <input type="text" value={suaDangNhap} onChange={(e) => setSuaDangNhap(e.target.value)} className={O_NHAP} />
                  {laNoiBo(dangSua) && <span className="text-sm text-on-surface-variant shrink-0">@{dangSua.email.split('@')[1]}</span>}
                </div>
              </label>
            )}
          </div>
        </HopThoai>
      )}

      {datMatKhau && (
        <HopThoai
          co="vua"
          bieuTuong="key"
          tieuDe="Đặt mật khẩu mới"
          phuDe={`Cho ${datMatKhau.tk.email}. Mật khẩu cũ mất hiệu lực ngay, mọi phiên đang mở của họ bị đăng xuất.`}
          onDong={() => setDatMatKhau(null)}
          dongKhiBamNgoai={false}
          chan={
            <>
              <button type="button" onClick={() => setDatMatKhau(null)} className={NUT_PHU}>
                Huỷ
              </button>
              <button
                type="button"
                onClick={luuMatKhauMoi}
                disabled={dangLam === datMatKhau.tk.id || (Boolean(datMatKhau.mk.trim()) && datMatKhau.mk.trim().length < 8)}
                className={NUT_CHINH}
              >
                {dangLam === datMatKhau.tk.id ? 'Đang đặt…' : datMatKhau.mk.trim() ? 'Đặt mật khẩu này' : 'Để hệ thống tự sinh'}
              </button>
            </>
          }
        >
          <BangLoi noiDung={loi} onDong={() => setLoi('')} className="mb-4" />
          <label className="block">
            <span className={NHAN_O}>Mật khẩu mới</span>
            {/* Chữ hiện rõ (không che) — người quản lý cần thấy chính xác mình đặt gì. */}
            <input
              type="text"
              autoComplete="new-password"
              autoFocus
              value={datMatKhau.mk}
              onChange={(e) => setDatMatKhau({ ...datMatKhau, mk: e.target.value })}
              placeholder="Ít nhất 8 ký tự"
              className={O_NHAP}
            />
          </label>
          <p className={clsx('text-sm mt-2', datMatKhau.mk.trim() && datMatKhau.mk.trim().length < 8 ? 'text-error' : 'text-on-surface-variant')}>
            {datMatKhau.mk.trim() && datMatKhau.mk.trim().length < 8
              ? `Còn thiếu ${8 - datMatKhau.mk.trim().length} ký tự (ít nhất 8).`
              : 'Để trống thì hệ thống tự sinh một mật khẩu ngẫu nhiên.'}
          </p>
        </HopThoai>
      )}

      {matKhauVua && (
        <HopThoai
          co="vua"
          bieuTuong="key"
          tieuDe={matKhauVua.tuDat ? 'Đã đặt mật khẩu' : 'Mật khẩu tạm'}
          phuDe={`Cho ${matKhauVua.ten || matKhauVua.tenDangNhap} — chỉ hiện đúng một lần, hệ thống không lưu lại.`}
          onDong={() => setMatKhauVua(null)}
          dongKhiBamNgoai={false}
          chan={
            <button type="button" onClick={() => setMatKhauVua(null)} className={NUT_CHINH}>
              Đã chép, đóng
            </button>
          }
        >
          <div className="grid gap-3">
            <div>
              <span className={NHAN_O}>Tên đăng nhập</span>
              <code className="block text-lg font-mono bg-surface-container-lowest px-4 py-3 rounded-xl border border-outline text-on-surface select-all">
                {matKhauVua.tenDangNhap}
              </code>
            </div>
            <div>
              <span className={NHAN_O}>Mật khẩu</span>
              <code className="block text-2xl font-mono font-bold tracking-wide bg-surface-container-lowest px-5 py-4 rounded-xl border border-outline text-on-surface select-all">
                {matKhauVua.mk}
              </code>
            </div>
          </div>
        </HopThoai>
      )}
    </main>
  );
}
