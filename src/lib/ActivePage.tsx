import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, KHOA_TRANG_DANG_CHON, type KhoiNaoInfo, type SocialAccount } from './api';

/**
 * KHỐI NÃO đang chọn (docs/khoi-nao.md).
 *
 * Mỗi trang bán hàng có đúng một khối não 4 AI liền mạch. Bộ chọn "Trang bán hàng" ở đầu thanh menu là bộ chọn DUY NHẤT:
 * chọn trang nào thì toàn bộ màn hình là khối não của trang đó (lớp gọi API đính X-Trang vào mọi yêu cầu).
 *
 * Bên trong một khối não, `accounts` là các kênh của chính trang đó (Fanpage, Instagram…) và `activeAccountId` là bộ lọc
 * kênh TẠM của từng màn hình (vd. hộp thư chỉ xem Instagram) — đổi trang thì bộ lọc về "tất cả kênh".
 */
interface ActivePageValue {
  /** Mọi khối não người đăng nhập được mở (trang của mình; trang tài khoản con nếu là chủ chuỗi; mọi trang nếu quản trị). */
  dsNao: KhoiNaoInfo[];
  /** Khối não đang chọn; null = chưa có trang nào để mở. */
  nao: KhoiNaoInfo | null;
  chonNao: (trangId: number) => void;
  /** Kênh của khối não đang chọn. */
  accounts: SocialAccount[];
  /** Bộ lọc kênh trong khối não; null = mọi kênh của trang. */
  activeAccount: SocialAccount | null;
  activeAccountId: string | null;
  setActiveAccountId: (id: string | null) => void;
  /** = nao.trangId — giữ tên cũ cho các màn hình đang dùng. */
  activeTrangId: number | null;
  loading: boolean;
  reload: () => Promise<void>;
}

const ActivePageContext = createContext<ActivePageValue | null>(null);

function docTrangDaLuu(): number | null {
  try {
    const v = Number(localStorage.getItem(KHOA_TRANG_DANG_CHON));
    return Number.isSafeInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
function luuTrang(trangId: number | null) {
  try {
    if (trangId) localStorage.setItem(KHOA_TRANG_DANG_CHON, String(trangId));
    else localStorage.removeItem(KHOA_TRANG_DANG_CHON);
  } catch {
    /* Trình duyệt chặn localStorage — lựa chọn chỉ sống trong phiên này. */
  }
}

export function ActivePageProvider({ children }: { children: ReactNode }) {
  const [dsNao, setDsNao] = useState<KhoiNaoInfo[]>([]);
  const [trangId, setTrangId] = useState<number | null>(docTrangDaLuu);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.khoiNao.danhSach();
      setDsNao(data.ds);
      /*
       * Trang đã lưu không còn trong danh sách (bị xoá, chuyển chủ, hết quyền) thì về khối não đầu tiên — không giữ một
       * trang không mở được, màn hình nào cũng báo 404 mà không rõ vì sao.
       */
      const daLuu = docTrangDaLuu();
      const dung = data.ds.find((n) => n.trang_id === daLuu)?.trang_id ?? data.ds[0]?.trang_id ?? null;
      luuTrang(dung);
      setTrangId(dung);
      if (dung) {
        const { data: kenh } = await api.connections.accounts();
        setAccounts(kenh.filter((k) => k.platform !== 'metaads'));
      } else {
        setAccounts([]);
      }
    } catch (error) {
      console.error('Không tải được danh sách khối não:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const chonNao = useCallback(
    (id: number) => {
      luuTrang(id);
      setTrangId(id);
      setActiveAccountId(null);
      // Kênh của khối não mới (máy chủ lọc theo X-Trang vừa lưu).
      void api.connections.accounts().then(({ data }) => setAccounts(data.filter((k) => k.platform !== 'metaads'))).catch(() => setAccounts([]));
    },
    []
  );

  const value = useMemo<ActivePageValue>(() => {
    const nao = dsNao.find((n) => n.trang_id === trangId) ?? null;
    return {
      dsNao,
      nao,
      chonNao,
      accounts,
      activeAccount: accounts.find((a) => a.id === activeAccountId) ?? null,
      activeAccountId,
      setActiveAccountId,
      activeTrangId: nao?.trang_id ?? null,
      loading,
      reload,
    };
  }, [dsNao, trangId, chonNao, accounts, activeAccountId, loading, reload]);

  return <ActivePageContext.Provider value={value}>{children}</ActivePageContext.Provider>;
}

export function useActivePage(): ActivePageValue {
  const context = useContext(ActivePageContext);
  if (!context) {
    throw new Error('useActivePage phải được dùng bên trong ActivePageProvider');
  }
  return context;
}

/** Khối não đang chọn — tên rõ nghĩa cho màn hình mới. */
export const useKhoiNao = useActivePage;

/** Nhãn ngắn hai chữ cái cho huy hiệu nền tảng. */
export const PLATFORM_BADGE: Record<string, string> = {
  facebook: 'FB',
  instagram: 'IG',
  tiktok: 'TT',
  threads: 'TH',
  youtube: 'YT',
  telegram: 'TG',
  metaads: 'MA',
};
