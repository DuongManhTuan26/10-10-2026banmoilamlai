import React, { useState, useEffect, useCallback } from 'react';
import HopThoai, { NHAN_O, NUT_CHINH, NUT_PHU, O_NHAP } from '../components/HopThoai';
import { clsx } from 'clsx';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import AITrainingModal from '../components/AITrainingModal';
import { api, ApiError, formatCurrency, type Post } from '../lib/api';
import BangLoi from '../components/BangLoi';
import { hoiNhap, hoiXacNhan } from '../components/HopHoi';
import { Link } from 'react-router-dom';
import { aiTheoMa } from '../lib/bon-ai';

/** Trạng thái Meta -> nhãn tiếng Việt mà giao diện đang dùng. */
function statusLabel(metaStatus: string): string {
  switch ((metaStatus ?? '').toUpperCase()) {
    case 'ACTIVE': return 'Đang chạy';
    case 'PAUSED': return 'Tạm dừng';
    default: return 'Đã kết thúc';
  }
}

/** Rút gọn số lớn: 124000 -> 124K. */
export interface SoLieuQuangCao {
  daChi: number | null;
  tiepCan: number | null;
  binhLuan: number | null;
  nhanTin: number | null;
}

/**
 * Bóc số liệu quảng cáo từ thứ nhà cung cấp trả về.
 *
 * Dạng trả về: { objectId, data: [...], paging }. Mỗi dòng trong data là một
 * bản ghi số liệu của Meta; các loại tương tác gom trong actions dưới dạng
 * [{ action_type, value }, ...].
 *
 * Đọc phòng thủ: thiếu trường thì trả null để giao diện hiện gạch ngang, KHÔNG
 * trả 0 — vì 0 đọc thành "không tiêu đồng nào", sai theo một kiểu khác.
 */
export function docSoLieuQuangCao(
  insights: Record<string, unknown> | null | undefined
): SoLieuQuangCao | null {
  const dong = (insights?.data as Array<Record<string, unknown>> | undefined)?.[0];
  if (!dong) return null;

  const so = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const hanhDong = (loai: string): number | null => {
    const ds = dong.actions as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(ds)) return null;
    const khop = ds.find((a) => String(a.action_type ?? '') === loai);
    return khop ? so(khop.value) : null;
  };

  return {
    daChi: so(dong.spend),
    tiepCan: so(dong.reach),
    binhLuan: hanhDong('comment'),
    nhanTin: hanhDong('onsite_conversion.messaging_conversation_started_7d'),
  };
}

function compact(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(1).replace('.0', '') + 'M';
  if (value >= 1_000) return (value / 1_000).toFixed(1).replace('.0', '') + 'K';
  return String(Math.round(value));
}

/**
 * `trongKhuon`: trang đang nằm trong khuôn khối não (KhuonAi) — đầu khuôn đã có tên AI, trang khối não và thẻ
 * "Hướng dẫn AI", nên ẩn tiêu đề và nút vai trò riêng của trang để không lặp hai lần.
 */
export default function Ads({ trongKhuon = false }: { trongKhuon?: boolean } = {}) {
  const [filter, setFilter] = useState('Tất cả');
  const [isFlowOpen, setIsFlowOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isAudienceFlowOpen, setIsAudienceFlowOpen] = useState(false);
  const [isTrainingOpen, setIsTrainingOpen] = useState(false);

  // Trạng thái biểu mẫu tạo tệp đối tượng
  const [audName, setAudName] = useState('');
  const [audType, setAudType] = useState('custom');
  const [audCustomSources, setAudCustomSources] = useState<string[]>([]);
  const [audLookalikeSource, setAudLookalikeSource] = useState('Khách đã mua');
  const [audLookalikePercent, setAudLookalikePercent] = useState(3);
  const [audInterests, setAudInterests] = useState<string[]>([]);
  const [audNewInterest, setAudNewInterest] = useState('');

  // Dữ liệu thật từ Meta qua Zernio
  const [connected, setConnected] = useState(false);
  /*
   * Một kênh Meta Ads vào được NHIỀU tài khoản quảng cáo — đo thật thấy hai
   * cái. Mã cũ tự chọn cái đầu đang hoạt động và không hiện ra, nên chiến dịch
   * nằm ở tài khoản kia là trang này trống trơn mà chủ shop không hiểu vì sao.
   */
  const [tatCaTaiKhoan, setTatCaTaiKhoan] = useState<
    Array<{ id: string; name: string; currency: string; accountStatus: number }>
  >([]);
  const [doChuShopChon, setDoChuShopChon] = useState(false);
  const [adAccount, setAdAccount] = useState<{
    name: string; currency: string; status: number; minDailyBudget?: number;
  } | null>(null);
  const [campaigns, setCampaigns] = useState<Array<Record<string, unknown>>>([]);
  const [audiences, setAudiences] = useState<Array<Record<string, unknown>>>([]);
  const [insights, setInsights] = useState<Record<string, unknown> | null>(null);
  /** Đơn chốt có mã quảng cáo trong cùng kỳ — đếm từ đơn thật của trang (máy chủ: donTuQuangCao). */
  const [donQuangCao, setDonQuangCao] = useState<{ so: number; doanhThu: number; theoNgay: { ngay: string; so: number }[] } | null>(null);
  const [boostablePosts, setBoostablePosts] = useState<Post[]>([]);
  const [notice, setNotice] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  /** Chiến dịch đang mở menu thao tác — cần vì điện thoại không có hover. */
  const [menuChienDich, setMenuChienDich] = useState<string | null>(null);
  const [aiInsight, setAiInsight] = useState<{
    hasData: boolean; findings: string; recommendation: string; actions: string[];
  } | null>(null);

  /*
   * Ô chọn kỳ trước đây là hình vẽ: không có value, không có onChange, và
   * api.ads.overview() gọi không kèm kỳ nên máy chủ luôn trả 7 ngày. Chọn
   * "30 ngày qua" không đổi một con số nào.
   */
  const KY_SO_LIEU = [
    { nhan: '7 ngày qua', ma: 'last_7d' },
    { nhan: '30 ngày qua', ma: 'last_30d' },
    { nhan: 'Tháng này', ma: 'this_month' },
  ] as const;
  const [ky, setKy] = useState<string>('last_7d');
  const ghiChuKy = KY_SO_LIEU.find((k) => k.ma === ky)?.nhan ?? '';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [overview, posts] = await Promise.all([
        api.ads.overview(ky),
        api.ads.boostablePosts().catch(() => ({ data: [] as Post[] })),
      ]);
      setConnected(overview.data.connected);
      setAdAccount(overview.data.account);
      setTatCaTaiKhoan(overview.data.tatCaTaiKhoan ?? []);
      setDoChuShopChon(overview.data.doChuShopChon ?? false);
      setCampaigns(overview.data.campaigns);
      setAudiences(overview.data.audiences);
      setInsights(overview.data.insights);
      setDonQuangCao(overview.data.donQuangCao ?? null);
      setBoostablePosts(posts.data);
      setNotice(overview.message ?? '');
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'Không tải được dữ liệu quảng cáo');
    } finally {
      setLoading(false);
    }
  }, [ky]);

  useEffect(() => { load(); }, [load]);

  /** Đổi tài khoản quảng cáo đang xem, rồi nạp lại toàn bộ số liệu. */
  const doiTaiKhoanQuangCao = async (id: string) => {
    if (!id) return;
    setBusy(true);
    setErrorMessage('');
    try {
      await api.ads.chonTaiKhoanQuangCao(id);
      await load();
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'Không đổi được tài khoản quảng cáo');
    } finally {
      setBusy(false);
    }
  };


  // Trạng thái biểu mẫu quảng cáo bài viết
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [dailyBudget, setDailyBudget] = useState<number>(300000);
  const [duration, setDuration] = useState<number>(5);
  const [audienceType, setAudienceType] = useState('custom');
  const [location, setLocation] = useState('Toàn quốc');
  const [ageRange, setAgeRange] = useState([25, 45]);
  const [gender, setGender] = useState('Tất cả');

  const handleToggleCustomSource = (source: string) => {
    setAudCustomSources((prev) =>
      prev.includes(source) ? prev.filter((s) => s !== source) : [...prev, source]
    );
  };

  const handleAddInterest = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && audNewInterest.trim()) {
      e.preventDefault();
      setAudInterests([...audInterests, audNewInterest.trim()]);
      setAudNewInterest('');
    }
  };

  const handleRemoveInterest = (idx: number) => {
    setAudInterests(audInterests.filter((_, i) => i !== idx));
  };

  const openFlow = () => {
    setIsFlowOpen(true);
    setCurrentStep(1);
    setIsSuccess(false);
    setErrorMessage('');
  };

  const closeFlow = () => {
    setIsFlowOpen(false);
    setCurrentStep(1);
    setIsSuccess(false);
  };

  /** Đẩy ngân sách cho bài đã chọn — gọi Meta thật qua Zernio. */
  const handleLaunchBoost = async () => {
    if (!selectedPostId) {
      setErrorMessage('Vui lòng chọn một bài đã đăng để quảng cáo.');
      return;
    }
    setBusy(true);
    setErrorMessage('');
    try {
      await api.ads.boost({
        postId: Number(selectedPostId),
        dailyBudget,
        durationDays: duration,
        objective: 'engagement',
        targeting: {
          geoLocations: { countries: ['VN'] },
          ageMin: ageRange[0],
          ageMax: ageRange[1],
          genders: gender === 'Nam' ? [1] : gender === 'Nữ' ? [2] : undefined,
        },
      });
      setIsSuccess(true);
      await load();
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'Không tạo được quảng cáo');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateAudience = async () => {
    if (!audName.trim()) {
      setErrorMessage('Vui lòng đặt tên cho tệp đối tượng.');
      return;
    }
    setBusy(true);
    setErrorMessage('');
    try {
      await api.ads.createAudience({
        name: audName.trim(),
        subtype:
          audType === 'lookalike' ? 'LOOKALIKE'
          : audType === 'interest' ? 'SAVED_TARGETING'
          : 'CUSTOM',
        extra:
          audType === 'lookalike'
            ? { ratio: audLookalikePercent / 100, sourceName: audLookalikeSource }
            : audType === 'interest'
              ? { interests: audInterests }
              : { sources: audCustomSources },
      });
      setIsAudienceFlowOpen(false);
      setAudName('');
      setAudInterests([]);
      setAudCustomSources([]);
      await load();
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'Không tạo được tệp đối tượng');
    } finally {
      setBusy(false);
    }
  };

  const runCampaignAction = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setErrorMessage('');
    try {
      await action();
      await load();
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'Thao tác thất bại');
    } finally {
      setBusy(false);
    }
  };

  const handlePauseCampaign = (id: string) =>
    runCampaignAction(() => api.ads.setCampaignStatus([id], 'PAUSED'));
  const handleResumeCampaign = (id: string) =>
    runCampaignAction(() => api.ads.setCampaignStatus([id], 'ACTIVE'));
  const handleEndCampaign = async (id: string) => {
    if (!(await hoiXacNhan({ tieuDe: 'Kết thúc chiến dịch này?', noiDung: 'Thao tác này không thể hoàn tác.', nutDongY: 'Kết thúc', nguyHiem: true }))) return;
    return runCampaignAction(() => api.ads.setCampaignStatus([id], 'ARCHIVED'));
  };
  const handleDuplicateCampaign = (id: string) =>
    runCampaignAction(() => api.ads.duplicateCampaign(id));

  const [campaignDetail, setCampaignDetail] = useState<Record<string, unknown> | null>(null);
  const [reachEstimate, setReachEstimate] = useState('Đang tính…');

  /**
   * Dự báo tiếp cận lấy từ Meta theo đúng cấu hình nhắm chọn đang đặt.
   * Bản cũ ghi cứng "12.000 - 18.000 người" cho mọi ngân sách và mọi độ tuổi.
   */
  useEffect(() => {
    if (!isFlowOpen || currentStep < 3 || !connected) return;
    let cancelled = false;
    setReachEstimate('Đang tính…');

    api.ads
      .reachEstimate({
        geoLocations: { countries: ['VN'] },
        ageMin: ageRange[0],
        ageMax: ageRange[1],
        genders: gender === 'Nam' ? [1] : gender === 'Nữ' ? [2] : undefined,
      })
      .then(({ data }) => {
        if (cancelled) return;
        const raw = data as Record<string, any>;
        const lower = Number(raw.usersLowerBound ?? raw.users_lower_bound ?? raw.estimateMau);
        const upper = Number(raw.usersUpperBound ?? raw.users_upper_bound ?? lower);
        if (Number.isFinite(lower) && lower > 0) {
          setReachEstimate(
            Number.isFinite(upper) && upper > lower
              ? `${lower.toLocaleString('vi-VN')} - ${upper.toLocaleString('vi-VN')} người`
              : `${lower.toLocaleString('vi-VN')} người`
          );
        } else {
          setReachEstimate('Meta chưa trả về dự báo');
        }
      })
      .catch(() => {
        if (!cancelled) setReachEstimate('Chưa lấy được dự báo từ Meta');
      });

    return () => { cancelled = true; };
  }, [isFlowOpen, currentStep, connected, ageRange, gender]);


  const handleViewCampaign = async (id: string) => {
    setBusy(true);
    setErrorMessage('');
    try {
      const { data } = await api.ads.campaignAnalytics(id);
      setCampaignDetail(data);
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'Không lấy được số liệu chiến dịch');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Sửa ngân sách ngay tại đây, đi qua Zernio.
   *
   * Bản trước mở thẳng Trình quản lý quảng cáo của Facebook. Sai: chủ shop phải
   * học thêm một công cụ nữa, mà đó đúng là thứ mình trả tiền cho Zernio để
   * khỏi phải đụng vào.
   */
  const handleEditBudget = async (campaignId: string, currentDaily: number) => {
    const input = await hoiNhap({
      tieuDe: 'Sửa ngân sách mỗi ngày',
      nhan: 'Ngân sách mỗi ngày (đồng)',
      macDinh: currentDaily > 0 ? String(currentDaily) : '',
      nutDongY: 'Lưu ngân sách',
      bieuTuong: 'payments',
    });
    if (input === null) return;

    const amount = Number(input.replace(/[^\d]/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) {
      setErrorMessage('Ngân sách phải là một số lớn hơn 0.');
      return;
    }

    setBusy(true);
    setErrorMessage('');
    try {
      await api.ads.updateCampaignBudget(campaignId, { amount, budgetType: 'daily' });
      await load();
    } catch (error) {
      /*
       * 409 nghĩa là chiến dịch đặt ngân sách ở tầng NHÓM quảng cáo, không đặt
       * chung ở cấp chiến dịch. Máy chủ bảo "mở chiến dịch và sửa ngân sách
       * của nhóm bên trong" — trước đây giao diện không có chỗ nào để mở nhóm
       * ra cả, nên lời chỉ dẫn đúng lại dẫn chủ shop vào ngõ cụt.
       *
       * Nay tự mở luôn danh sách nhóm ngay tại đây, không bắt đi tìm.
       */
      if (error instanceof ApiError && error.status === 409) {
        await moNhomQuangCao(campaignId, amount);
        return;
      }
      setErrorMessage(error instanceof ApiError ? error.message : 'Không sửa được ngân sách');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Chiến dịch đặt ngân sách theo nhóm: mở danh sách nhóm ra để sửa từng cái.
   *
   * Một nhóm thì sửa thẳng, khỏi bắt chọn. Nhiều nhóm thì hỏi sửa nhóm nào,
   * kèm tên và ngân sách hiện tại để chọn đúng.
   */
  const moNhomQuangCao = async (campaignId: string, soTien: number) => {
    try {
      const { data } = await api.ads.adSets(campaignId);
      if (data.length === 0) {
        setErrorMessage(
          'Chiến dịch này đặt ngân sách theo nhóm quảng cáo, nhưng chưa có nhóm nào. ' +
            'Vui lòng tạo nhóm quảng cáo trước.'
        );
        return;
      }

      const ten = (n: Record<string, unknown>) => String(n.name ?? n.id ?? '?');
      let nhom = data[0];
      if (data.length > 1) {
        const chon = await hoiNhap({
          tieuDe: 'Chọn nhóm quảng cáo',
          noiDung: 'Chiến dịch này đặt ngân sách theo từng nhóm quảng cáo.\n\n' + data.map((n, i) => `${i + 1}. ${ten(n)}`).join('\n'),
          nhan: 'Số thứ tự của nhóm muốn sửa',
          nutDongY: 'Chọn nhóm',
          kiemTra: (v) => {
            const so = Number(v.trim());
            return Number.isInteger(so) && so >= 1 && so <= data.length ? null : `Gõ một số từ 1 đến ${data.length}.`;
          },
        });
        if (chon === null) return;
        const i = Number(chon) - 1;
        if (!Number.isInteger(i) || i < 0 || i >= data.length) {
          setErrorMessage('Số thứ tự không hợp lệ.');
          return;
        }
        nhom = data[i];
      }

      const ma = String(nhom.id ?? '');
      if (!ma) { setErrorMessage('Không đọc được mã nhóm quảng cáo.'); return; }
      await api.ads.updateAdSetBudget(ma, { amount: soTien, budgetType: 'daily' });
      await load();
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(
        error instanceof ApiError ? error.message : 'Không sửa được ngân sách nhóm quảng cáo'
      );
    }
  };

  /*
   * Sửa tệp đối tượng NGAY TRONG APP.
   *
   * Bản cũ chỉ có một nút mở sang Trình quản lý quảng cáo của Facebook, trong
   * khi trang Kết nối hứa thẳng "không cần mở trình quản lý quảng cáo riêng".
   * Zernio có sẵn PUT /v1/ads/audiences/{id} nên chẳng có lý do gì phải đẩy
   * chủ shop ra ngoài.
   *
   * Giới hạn nói thật trong hộp thoại: tệp tải lên / theo website / tương đồng
   * thì quy tắc là bất biến, chỉ đổi được tên và mô tả.
   */
  const [suaTepId, setSuaTepId] = useState<string | null>(null);
  const [suaTepTen, setSuaTepTen] = useState('');
  const [dangLuuTep, setDangLuuTep] = useState(false);

  const moSuaTep = (id: string, ten: string) => {
    setSuaTepId(id);
    setSuaTepTen(ten);
    setErrorMessage('');
  };

  const luuTepDoiTuong = async () => {
    if (!suaTepId || dangLuuTep) return;
    const ten = suaTepTen.trim();
    if (!ten) { setErrorMessage('Tên tệp đối tượng không được để trống.'); return; }

    setDangLuuTep(true);
    setErrorMessage('');
    try {
      await api.ads.updateAudience(suaTepId, { name: ten });
      setSuaTepId(null);
      await load();
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'Không sửa được tệp đối tượng');
    } finally {
      setDangLuuTep(false);
    }
  };

  const handleAnalyze = async () => {
    setBusy(true);
    setErrorMessage('');
    try {
      const { data } = await api.ads.analyze();
      setAiInsight(data);
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'AI chưa phân tích được');
    } finally {
      setBusy(false);
    }
  };

  /** Số liệu tổng, đọc từ insights thật của Meta. */
  const totals = (() => {
    const raw = (insights ?? {}) as Record<string, any>;
    const first = Array.isArray(raw.data) ? (raw.data[0] ?? {}) : raw;
    const num = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    return {
      reach: num(first.reach ?? first.impressions),
      spend: num(first.spend),
      clicks: num(first.clicks ?? first.inline_link_clicks),
      cpc: num(first.cpc),
    };
  })();

  /** Biểu đồ: dựng từ dãy số liệu theo ngày mà Meta trả về. */
  const chartData = (() => {
    const raw = (insights ?? {}) as Record<string, any>;
    const series = Array.isArray(raw.data) ? raw.data : [];
    if (series.length === 0) return [] as Array<{ name: string; reach: number; orders: number }>;
    /*
     * "Đơn chốt" = đơn THẬT có mã quảng cáo rơi vào khoảng ngày của dòng số liệu (date_start → date_stop, YYYY-MM-DD).
     * Bản cũ vẽ `actions.length` — số LOẠI hành động Meta trả về (bình luận, nhấp, xem…), không phải số đơn.
     */
    const theoNgay = donQuangCao?.theoNgay ?? [];
    return series.map((row: Record<string, any>) => {
      const tu = String(row.date_start ?? '');
      const den = String(row.date_stop ?? row.date_start ?? '');
      return {
        name: row.date_start
          ? new Date(row.date_start).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
          : '',
        reach: Number(row.reach ?? row.impressions ?? 0),
        orders: theoNgay.filter((d) => d.ngay >= tu && d.ngay <= den).reduce((t, d) => t + d.so, 0),
      };
    });
  })();

  /** Chiến dịch Meta -> hình dạng mà thẻ chiến dịch trên giao diện đang vẽ. */
  /*
   * Bốn ô số đầu trang lấy từ số liệu THẬT của tài khoản quảng cáo.
   *
   * Trước đây cả bốn là chữ chết trong mã: "TỔNG CHI TIÊU 12.450.000 đ",
   * "LƯỢT TIẾP CẬN 1.2 triệu", "BÌNH LUẬN THU ĐƯỢC 842", "ĐƠN CHỐT TỪ QUẢNG
   * CÁO 47", kèm "+5,2% so với tháng trước" và "+12,4%". Đã dựng lại: tài
   * khoản CHƯA nối kênh quảng cáo nào, không có một chiến dịch nào, mà trang
   * vẫn hiện nguyên cả bốn con số đó cộng huy hiệu "4 CHIẾN DỊCH ĐANG CHẠY" —
   * trong khi bảng ngay bên dưới ghi đúng "Không có chiến dịch nào".
   *
   * Nhà cung cấp trả về dạng { objectId, data: [...], paging }. Mỗi dòng
   * trong data là một bản ghi số liệu của Meta. Đọc phòng thủ: thiếu trường
   * thì hiện gạch ngang chứ KHÔNG hiện số 0, vì 0 đọc thành "không tiêu đồng
   * nào" — sai theo kiểu khác.
   */
  const soLieu = docSoLieuQuangCao(insights);

  const soChienDichDangChay = campaigns.filter((c) => {
    const tt = String((c as Record<string, unknown>).status ?? '').toUpperCase();
    return tt === 'ACTIVE';
  }).length;

  /* Gạch ngang khi chưa đo được, không phải số 0. */
  const hienSo = (v: number | null | undefined, doi: (n: number) => string) =>
    v === null || v === undefined ? '—' : doi(v);

  const displayCampaigns = campaigns.map((raw) => {
    const c = raw as Record<string, any>;
    const daily = Number(c.dailyBudget ?? c.daily_budget ?? 0);
    const spent = Number(c.spend ?? 0);
    const lifetime = Number(c.lifetimeBudget ?? c.lifetime_budget ?? 0);
    return {
      id: String(c.id),
      name: String(c.name ?? 'Chiến dịch không tên'),
      startDate: c.startTime
        ? `Bắt đầu từ ${new Date(c.startTime).toLocaleDateString('vi-VN')}`
        : 'Chưa có ngày bắt đầu',
      type: String(c.objective ?? 'Chiến dịch'),
      budget: daily > 0 ? `${formatCurrency(daily)}/ngày` : 'Chưa đặt ngân sách',
      // Số thô, để ô sửa ngân sách hiện sẵn giá trị đang chạy.
      dailyRaw: daily,
      spent: {
        current: spent > 0 ? spent.toLocaleString('vi-VN') : '0',
        total: lifetime > 0 ? formatCurrency(lifetime) : formatCurrency(daily),
        percent: lifetime > 0 ? Math.min(100, Math.round((spent / lifetime) * 100)) : 0,
      },
      reach: compact(Number(c.reach ?? 0)),
      comments: Number(c.comments ?? 0),
      orders: Number(c.conversions ?? 0),
      status: statusLabel(String(c.status ?? '')),
    };
  });

  const filteredCampaigns = displayCampaigns.filter((camp) =>
    filter === 'Tất cả' ? true : camp.status === filter
  );

  /** Tệp đối tượng Meta -> hình dạng thẻ trên giao diện. */
  const displayAudiences = audiences.map((raw) => {
    const a = raw as Record<string, any>;
    return {
      id: String(a.id),
      name: String(a.name ?? 'Tệp không tên'),
      size: a.approximateCount != null
        ? `${Number(a.approximateCount).toLocaleString('vi-VN')} người`
        : 'Đang tính',
      type: a.subtype === 'LOOKALIKE' ? 'Tệp tương tự'
        : a.subtype === 'CUSTOM' ? 'Tệp tùy chỉnh'
        : 'Theo sở thích',
    };
  });

  /** Bài đã đăng -> hình dạng thẻ chọn bài để quảng cáo. */
  const displayPosts = boostablePosts.map((post) => ({
    id: String(post.id),
    hasImage: Array.isArray(post.media) && post.media.length > 0,
    content: post.content,
    date: post.published_at ? new Date(post.published_at).toLocaleDateString('vi-VN') : '',
    stats: {
      likes: post.stats?.likes ?? 0,
      comments: post.stats?.comments ?? 0,
      shares: post.stats?.shares ?? 0,
    },
  }));

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Đang chạy': return 'bg-green-500/20 text-green-400';
      case 'Tạm dừng': return 'bg-yellow-500/20 text-yellow-400';
      case 'Đã kết thúc': return 'bg-surface-variant text-on-surface-variant';
      default: return 'bg-surface-variant text-on-surface';
    }
  };

  const getStatusDot = (status: string) => {
    switch (status) {
      case 'Đang chạy': return 'bg-green-400';
      case 'Tạm dừng': return 'bg-yellow-400';
      case 'Đã kết thúc': return 'bg-on-surface-variant';
      default: return 'bg-on-surface-variant';
    }
  };

  return (
    <main className={trongKhuon ? "w-full relative" : "flex-1  p-6 md:p-8 max-w-7xl mx-auto w-full relative"}>

      <BangLoi noiDung={errorMessage} onDong={() => setErrorMessage('')} className="mb-6" />

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            {!trongKhuon && <h1 className="font-headline-sm text-3xl font-bold text-on-surface tracking-tight">AI Quảng Cáo</h1>}
            <span className="font-mono text-xs font-bold tracking-wider text-primary bg-primary/10 border border-primary/20 px-2.5 py-1 rounded-full uppercase">
              {connected ? `${soChienDichDangChay} CHIẾN DỊCH ĐANG CHẠY` : 'CHƯA NỐI TÀI KHOẢN QUẢNG CÁO'}
            </span>
          </div>
          <p className="text-on-surface-variant text-sm">Chạy quảng cáo để kéo thêm khách vào bình luận và nhắn tin</p>

          {/*
            Nói rõ đang xem tài khoản quảng cáo NÀO, và cho đổi.

            Không nói thì chủ shop nhìn trang trống mà tưởng chưa chạy quảng
            cáo bao giờ, trong khi chiến dịch nằm ở tài khoản còn lại.
          */}
          {connected && tatCaTaiKhoan.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <span className="text-xs text-on-surface-variant">Tài khoản quảng cáo:</span>
              <select
                value={adAccount?.adAccountId ?? ''}
                onChange={(e) => doiTaiKhoanQuangCao(e.target.value)}
                disabled={busy}
                className="bg-surface-container-high px-3 py-1.5 rounded-lg border border-outline-variant text-sm text-on-surface focus:outline-none focus:border-primary disabled:opacity-50"
              >
                {tatCaTaiKhoan.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.currency}){t.accountStatus === 1 ? '' : ' — đang tạm dừng'}
                  </option>
                ))}
              </select>
              {!doChuShopChon && tatCaTaiKhoan.length > 1 && (
                <span className="text-xs text-amber-500">
                  Hệ thống đang tự chọn. Có {tatCaTaiKhoan.length} tài khoản — chọn đúng cái
                  đang chạy quảng cáo.
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button 
            hidden={trongKhuon}
            onClick={() => setIsTrainingOpen(true)}
            className="px-4 py-2 bg-surface-container text-primary border border-primary/30 font-bold rounded-lg hover:bg-primary/10 transition-colors flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">badge</span>
            Vai trò AI
          </button>
          <select
            value={ky}
            onChange={(e) => setKy(e.target.value)}
            className="bg-surface-container-high border border-outline-variant rounded-lg px-4 py-2 text-sm text-on-surface font-medium focus:outline-none focus:border-primary"
          >
            {KY_SO_LIEU.map((k) => (
              <option key={k.ma} value={k.ma}>{k.nhan}</option>
            ))}
          </select>
          <button onClick={openFlow} className="shrink-0 px-4 py-2 bg-primary text-on-primary font-bold rounded-lg shadow-[0_4px_15px_rgba(0,229,255,0.4)] hover:scale-105 transition-transform flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">add</span>
            Tạo quảng cáo
          </button>
        </div>
      </div>

      {/* Row 1: Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-surface-container border border-outline-variant rounded-2xl p-5 relative overflow-hidden flex flex-col justify-between group hover:border-primary/50 transition-colors h-[140px]">
          <div className="absolute -top-12 -right-12 w-32 h-32 bg-blue-500/10 blur-2xl rounded-full group-hover:bg-blue-500/20 transition-colors"></div>
          <div>
            <h3 className="tieu-de-muc mb-1">TỔNG CHI TIÊU</h3>
            <div className="flex items-baseline gap-2">
              <span className="font-headline-sm text-3xl font-bold text-on-surface">
                {hienSo(soLieu?.daChi, (n) => formatCurrency(n))}
              </span>
            </div>
          </div>
          <p className="text-xs text-on-surface-variant mt-auto font-medium">{ghiChuKy}</p>
        </div>

        <div className="bg-surface-container border border-outline-variant rounded-2xl p-5 relative overflow-hidden flex flex-col justify-between group hover:border-primary/50 transition-colors h-[140px]">
          <div className="absolute -top-12 -right-12 w-32 h-32 bg-purple-500/10 blur-2xl rounded-full group-hover:bg-purple-500/20 transition-colors"></div>
          <div>
            <h3 className="tieu-de-muc mb-1">LƯỢT TIẾP CẬN</h3>
            <div className="flex items-baseline gap-2">
              <span className="font-headline-sm text-3xl font-bold text-on-surface">
                {hienSo(soLieu?.tiepCan, (n) => compact(n))}
              </span>
            </div>
          </div>
          <p className="text-xs text-on-surface-variant mt-auto font-medium">Số người khác nhau đã thấy quảng cáo</p>
        </div>

        <div className="bg-surface-container border border-outline-variant rounded-2xl p-5 relative overflow-hidden flex flex-col justify-between group hover:border-primary/50 transition-colors h-[140px]">
          <div className="absolute -top-12 -right-12 w-32 h-32 bg-orange-500/10 blur-2xl rounded-full group-hover:bg-orange-500/20 transition-colors"></div>
          <div>
            <h3 className="tieu-de-muc mb-1">BÌNH LUẬN THU ĐƯỢC</h3>
            <div className="flex items-baseline gap-2">
              <span className="font-headline-sm text-3xl font-bold text-on-surface">
                {hienSo(soLieu?.binhLuan, (n) => n.toLocaleString('vi-VN'))}
              </span>
            </div>
            <p className="text-xs text-on-surface-variant mt-1 font-medium">
              {soLieu?.nhanTin === null || soLieu?.nhanTin === undefined
                ? 'Từ các quảng cáo đang chạy'
                : `${soLieu.nhanTin.toLocaleString('vi-VN')} người nhắn tin từ quảng cáo`}
            </p>
          </div>
        </div>

        {/* Highlighted Card */}
        <div className="bg-primary/10 border border-primary/30 rounded-2xl p-5 relative overflow-hidden flex flex-col justify-between group hover:border-primary/60 transition-colors h-[140px] shadow-[0_0_20px_rgba(0,229,255,0.1)]">
          <div className="absolute -top-12 -right-12 w-32 h-32 bg-primary/20 blur-2xl rounded-full group-hover:bg-primary/30 transition-colors"></div>
          <div>
            <h3 className="tieu-de-muc mb-1">ĐƠN CHỐT TỪ QUẢNG CÁO</h3>
            <div className="flex items-baseline gap-2">
              {/*
                * Đơn mang mã quảng cáo (orders.origin_ad_id — khách bấm quảng cáo rồi nhắn tin, Meta gửi kèm mã quảng
                * cáo), cùng kỳ với các ô bên cạnh. Bản trước ghi "Chưa đo được" từ khi chưa có mối nối này.
                */}
              <span className="font-headline-sm text-3xl font-bold text-on-surface">
                {donQuangCao ? donQuangCao.so.toLocaleString('vi-VN') : '—'}
              </span>
            </div>
            <p className="text-xs text-on-surface-variant mt-1 font-medium">
              {!donQuangCao || donQuangCao.so === 0
                ? `Đơn của khách đến từ quảng cáo · ${ghiChuKy.toLowerCase()}`
                : `${formatCurrency(donQuangCao.doanhThu)}`
                  + (soLieu?.daChi ? ` · ${formatCurrency(Math.round(soLieu.daChi / donQuangCao.so))} tiền quảng cáo mỗi đơn` : '')}
            </p>
          </div>
        </div>
      </div>

      {/*
        Row 2. Thẻ "Tạo chiến dịch mới" (tự làm quảng cáo không cần đăng bài) đã gỡ — luồng đó không tồn tại, bấm vào
        chỉ mở lại đúng luồng đẩy bài (rà soát lượt 2, L8). AI quảng cáo không tạo chiến dịch mới (docs/ton-dong.md TD-12).
      */}
      <div className="grid grid-cols-1 gap-4 mb-8">
        <button onClick={openFlow} className="bg-surface-container border border-outline-variant rounded-2xl p-6 text-left flex gap-5 items-start group hover:border-primary/50 transition-colors hover:bg-surface-container/50">
          <div className="w-14 h-14 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
            <span className="material-symbols-outlined text-3xl text-blue-400">rocket_launch</span>
          </div>
          <div>
            <h3 className="text-lg font-bold text-on-surface mb-2">Đẩy bài đã đăng</h3>
            <p className="text-sm text-on-surface-variant leading-relaxed">
              Chọn một bài đang có tương tác tốt và trả tiền để nhiều người thấy hơn. Cách nhanh và đơn giản nhất.
            </p>
          </div>
        </button>

      </div>

      {/* Row 3: Performance Chart */}
      <div className="bg-surface-container border border-outline-variant rounded-2xl p-6 mb-8 flex flex-col">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-on-surface">Hiệu quả chiến dịch</h2>
          <button onClick={handleAnalyze} disabled={busy || !connected} className="font-mono text-xs font-bold text-primary hover:brightness-110 uppercase tracking-wider disabled:opacity-50">
            {busy ? 'ĐANG PHÂN TÍCH…' : 'AI PHÂN TÍCH →'}
          </button>
        </div>
        <div className="w-full h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorReach" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00E5FF" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#00E5FF" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorOrders" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#A1A1AA', fontSize: 12 }} dy={10} />
              <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fill: '#A1A1AA', fontSize: 12 }} />
              <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fill: '#A1A1AA', fontSize: 12 }} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#18181B', borderColor: '#27272A', borderRadius: '12px', color: '#fff' }}
                itemStyle={{ color: '#fff' }}
              />
              <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '12px', color: '#A1A1AA' }} />
              <Area yAxisId="left" type="monotone" dataKey="reach" name="Lượt tiếp cận" stroke="#00E5FF" strokeWidth={2} fillOpacity={1} fill="url(#colorReach)" />
              <Area yAxisId="right" type="monotone" dataKey="orders" name="Đơn chốt" stroke="#8B5CF6" strokeWidth={2} fillOpacity={1} fill="url(#colorOrders)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Row 4: Campaigns List */}
      <div id="ds-chien-dich" className="bg-surface-container border border-outline-variant rounded-2xl overflow-hidden mb-8 scroll-mt-6">
        <div className="p-6 border-b border-outline-variant/50">
          <div className="flex flex-wrap gap-2">
            {['Tất cả', 'Đang chạy', 'Tạm dừng', 'Đã kết thúc'].map(opt => (
              <button 
                key={opt}
                onClick={() => setFilter(opt)}
                className={clsx(
                  "px-4 py-1.5 rounded-full text-sm font-bold transition-colors",
                  filter === opt 
                    ? "bg-on-surface text-surface" 
                    : "bg-surface-container border border-outline-variant text-on-surface hover:bg-surface-variant"
                )}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto ">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead>
              <tr className="bg-surface-container border-b border-outline-variant/50">
                <th className="p-4 font-mono text-[11px] font-bold text-on-surface-variant tracking-wider whitespace-nowrap uppercase">Tên chiến dịch</th>
                <th className="p-4 font-mono text-[11px] font-bold text-on-surface-variant tracking-wider whitespace-nowrap uppercase">Loại</th>
                <th className="p-4 font-mono text-[11px] font-bold text-on-surface-variant tracking-wider whitespace-nowrap uppercase">Ngân sách</th>
                <th className="p-4 font-mono text-[11px] font-bold text-on-surface-variant tracking-wider whitespace-nowrap uppercase">Đã chi</th>
                <th className="p-4 font-mono text-[11px] font-bold text-on-surface-variant tracking-wider whitespace-nowrap uppercase">Tiếp cận</th>
                <th className="p-4 font-mono text-[11px] font-bold text-on-surface-variant tracking-wider whitespace-nowrap uppercase">Bình luận</th>
                <th className="p-4 font-mono text-[11px] font-bold text-on-surface-variant tracking-wider whitespace-nowrap uppercase">Đơn chốt</th>
                <th className="p-4 font-mono text-[11px] font-bold text-on-surface-variant tracking-wider whitespace-nowrap uppercase">Trạng thái</th>
                <th className="p-4 w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/50">
              {filteredCampaigns.map(camp => (
                <tr key={camp.id} className="hover:bg-surface-variant/30 transition-colors group">
                  <td className="p-4">
                    <p className="font-bold text-sm text-on-surface mb-0.5">{camp.name}</p>
                    <p className="text-xs text-on-surface-variant">{camp.startDate}</p>
                  </td>
                  <td className="p-4">
                    <span className="px-2.5 py-1 bg-surface-container border border-outline-variant text-on-surface font-medium text-xs rounded-full whitespace-nowrap">
                      {camp.type}
                    </span>
                  </td>
                  <td className="p-4 text-sm text-on-surface font-medium whitespace-nowrap">{camp.budget}</td>
                  <td className="p-4 min-w-[150px]">
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="font-bold text-on-surface">{camp.spent.current}</span>
                      <span className="text-on-surface-variant">/ {camp.spent.total}</span>
                    </div>
                    <div className="w-full h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-primary rounded-full" 
                        style={{ width: `${camp.spent.percent}%` }}
                      ></div>
                    </div>
                  </td>
                  <td className="p-4 text-sm text-on-surface font-medium">{camp.reach}</td>
                  <td className="p-4 text-sm text-on-surface font-medium">{camp.comments}</td>
                  <td className="p-4 text-sm font-bold text-primary">{camp.orders}</td>
                  <td className="p-4">
                    <span className={clsx("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap", getStatusColor(camp.status))}>
                      <span className={clsx("w-1.5 h-1.5 rounded-full", getStatusDot(camp.status))}></span>
                      {camp.status}
                    </span>
                  </td>
                  <td className="p-4 relative">
                    {/*
                      Mở bằng BẤM, không chỉ bằng rê chuột.

                      Bản cũ mở menu hoàn toàn bằng CSS hover (peer-hover), và
                      nút không có onClick. Trên điện thoại không có hover nên
                      menu KHÔNG BAO GIỜ mở: xem chi tiết, sửa ngân sách, tạm
                      dừng, nhân bản, kết thúc — cả năm việc không bấm được.
                      Mà chủ shop xem hàng trên điện thoại là chính.

                      Giữ nguyên hover trên máy tính, chỉ thêm đường bấm.
                    */}
                    <button
                      onClick={() => setMenuChienDich((m) => (m === camp.id ? null : camp.id))}
                      aria-label="Thao tác với chiến dịch"
                      className={clsx(
                        'p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-variant rounded-md transition-colors peer',
                        menuChienDich === camp.id ? 'opacity-100' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100'
                      )}
                    >
                      <span className="material-symbols-outlined text-[20px]">more_vert</span>
                    </button>
                    <div
                      onClick={() => setMenuChienDich(null)}
                      className={clsx(
                        'absolute right-8 top-1/2 -translate-y-1/2 w-48 bg-noi border border-outline-variant rounded-xl shadow-xl py-1 transition-all z-10',
                        menuChienDich === camp.id
                          ? 'opacity-100 visible'
                          : 'opacity-0 invisible peer-hover:opacity-100 peer-hover:visible hover:opacity-100 hover:visible'
                      )}
                    >
                      <button onClick={() => handleViewCampaign(camp.id)} className="w-full text-left px-4 py-2 text-sm text-on-surface hover:bg-surface-variant transition-colors">Xem chi tiết</button>
                      <button onClick={() => handleEditBudget(camp.id, camp.dailyRaw)} disabled={busy} className="w-full text-left px-4 py-2 text-sm text-on-surface hover:bg-surface-variant transition-colors disabled:opacity-50">Sửa ngân sách</button>
                      {camp.status === 'Đang chạy' ? (
                        <button onClick={() => handlePauseCampaign(camp.id)} disabled={busy} className="w-full text-left px-4 py-2 text-sm text-on-surface hover:bg-surface-variant transition-colors disabled:opacity-50">Tạm dừng</button>
                      ) : (
                        <button onClick={() => handleResumeCampaign(camp.id)} disabled={busy} className="w-full text-left px-4 py-2 text-sm text-on-surface hover:bg-surface-variant transition-colors disabled:opacity-50">Chạy lại</button>
                      )}
                      <button onClick={() => handleDuplicateCampaign(camp.id)} disabled={busy} className="w-full text-left px-4 py-2 text-sm text-on-surface hover:bg-surface-variant transition-colors disabled:opacity-50">Nhân bản</button>
                      <div className="h-px bg-outline-variant/50 my-1"></div>
                      <button onClick={() => handleEndCampaign(camp.id)} disabled={busy} className="w-full text-left px-4 py-2 text-sm text-error hover:bg-error/10 transition-colors disabled:opacity-50">Kết thúc</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredCampaigns.length === 0 && (
            <div className="p-8 text-center text-on-surface-variant text-sm">
              Không có chiến dịch nào phù hợp với bộ lọc.
            </div>
          )}
        </div>
      </div>

      {/* Row 5: Audiences */}
      <div className="bg-surface-container border border-outline-variant rounded-2xl p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-on-surface">Tệp đối tượng đã lưu</h2>
          <button onClick={() => setIsAudienceFlowOpen(true)} className="px-3 py-1.5 border border-outline-variant text-on-surface font-bold text-sm rounded-lg hover:bg-surface-variant transition-colors flex items-center gap-1">
            <span className="material-symbols-outlined text-[16px]">add</span>
            Tạo tệp mới
          </button>
        </div>
        
        <div className="flex overflow-x-auto gap-4 pb-2 ">
          {displayAudiences.map(aud => (
            <div key={aud.id} className="bg-surface-container border border-outline-variant/50 rounded-xl p-4 flex flex-col justify-between group hover:border-primary/30 transition-colors min-w-[250px] flex-shrink-0 h-[100px]">
              <div className="flex items-start justify-between mb-2">
                <span className="px-2 py-0.5 bg-surface-variant text-on-surface-variant font-medium text-[11px] uppercase tracking-wider rounded">
                  {aud.type}
                </span>
                <button onClick={() => moSuaTep(aud.id, String(aud.name ?? ''))} title="Đổi tên tệp đối tượng" className="text-on-surface-variant opacity-0 group-hover:opacity-100 hover:text-primary transition-all">
                  <span className="material-symbols-outlined text-[18px]">edit</span>
                </button>
              </div>
              <div>
                <h3 className="font-bold text-on-surface text-sm mb-1">{aud.name}</h3>
                <p className="text-xs text-on-surface-variant flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[14px]">group</span>
                  {aud.size}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Ad Creation Flow Modal */}
      {isFlowOpen && (
        <HopThoai
          bieuTuong="campaign"
          tieuDe="Tạo quảng cáo"
          onDong={closeFlow}
          dongKhiBamNgoai={false}
          dauPhu={!isSuccess ? (
            <>
            {/* Progress Bar */}
            {!isSuccess && (
              <div className="relative z-10">
                <div className="flex justify-between items-center relative max-w-[600px] mx-auto">
                  <div className="absolute top-4 left-0 w-full h-0.5 bg-surface-variant -z-10"></div>
                  <div 
                    className="absolute top-4 left-0 h-0.5 bg-primary -z-10 transition-all duration-300"
                    style={{ width: `${((currentStep - 1) / 3) * 100}%` }}
                  ></div>
                  
                  {[
                    { step: 1, label: 'Chọn bài' },
                    { step: 2, label: 'Ngân sách' },
                    { step: 3, label: 'Đối tượng' },
                    { step: 4, label: 'Xác nhận' }
                  ].map((s) => (
                    <div key={s.step} className="flex flex-col items-center gap-2">
                      <div className={clsx(
                        "w-9 h-9 rounded-full flex items-center justify-center text-base font-bold transition-colors shadow-sm",
                        currentStep === s.step ? "bg-primary text-on-primary ring-4 ring-primary/20" :
                        currentStep > s.step ? "bg-green-500 text-white" :
                        "bg-surface-container-highest text-on-surface"
                      )}>
                        {currentStep > s.step ? <span className="material-symbols-outlined text-[16px]">check</span> : s.step}
                      </div>
                      <span className={clsx(
                        "text-xs font-bold uppercase tracking-wider",
                        currentStep === s.step ? "text-primary" : currentStep > s.step ? "text-green-400" : "text-on-surface-variant"
                      )}>{s.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            </>
          ) : undefined}
        >
            <div className="relative">
              {isSuccess ? (
                <div className="flex flex-col items-center justify-center h-full text-center w-full max-w-[480px] mx-auto py-12 animate-in zoom-in-95 duration-500">
                  <div className="w-24 h-24 rounded-full bg-green-500/10 border-2 border-green-500/30 flex items-center justify-center mb-6 shadow-[0_0_50px_rgba(34,197,94,0.2)]">
                    <span className="material-symbols-outlined text-[48px] text-green-400">check_circle</span>
                  </div>
                  <h2 className="text-2xl font-bold text-on-surface mb-3">Đã tạo quảng cáo</h2>
                  <p className="text-on-surface-variant mb-8 leading-relaxed">
                    Meta xét duyệt quảng cáo trước khi chạy. Khách bình luận hoặc nhắn tin từ quảng cáo sẽ được AI bán hàng
                    trả lời; đơn chốt được báo qua Telegram.
                  </p>
                  <div className="flex gap-4 w-full">
                    <button onClick={closeFlow} className="flex-1 py-3 px-4 bg-surface-container border border-outline-variant text-on-surface font-bold rounded-xl hover:bg-surface-variant transition-colors">
                      Đóng
                    </button>
                    <button
                      onClick={() => {
                        closeFlow();
                        // Danh sách chiến dịch nằm ngay trên trang này (đã nạp lại sau khi tạo) — cuộn tới đó.
                        setTimeout(() => document.getElementById('ds-chien-dich')?.scrollIntoView({ behavior: 'smooth' }), 50);
                      }}
                      className="flex-1 py-3 px-4 bg-primary text-on-primary font-bold rounded-xl hover:scale-105 transition-transform shadow-[0_4px_15px_rgba(0,229,255,0.3)]"
                    >
                      Xem chiến dịch
                    </button>
                  </div>
                </div>
              ) : currentStep === 1 ? (
                <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                  <h2 className="text-2xl font-bold text-on-surface mb-2">Chọn bài đăng muốn quảng cáo</h2>
                  <p className="text-on-surface-variant mb-8">
                    Nên chọn bài đang có nhiều bình luận, vì đó là dấu hiệu nội dung được đón nhận tốt
                  </p>

                  {displayPosts.length === 0 && (
                    <div className="mb-8 rounded-xl border border-dashed border-outline-variant p-8 text-center">
                      <span className="material-symbols-outlined text-[40px] text-on-surface-variant">post_add</span>
                      <p className="mt-3 font-bold text-on-surface">Chưa có bài đã đăng nào để quảng cáo</p>
                      <p className="mt-1 text-sm text-on-surface-variant">
                        Chỉ bài đã đăng lên Fanpage mới đẩy thành quảng cáo được. Đăng bài ở {aiTheoMa('content').ten} rồi quay lại đây.
                      </p>
                      <Link
                        to={`${aiTheoMa('content').duong}?the=dang-lam`}
                        onClick={closeFlow}
                        className={clsx(NUT_PHU, 'mt-5 inline-flex')}
                      >
                        <span className="material-symbols-outlined text-[20px]">{aiTheoMa('content').bieuTuong}</span>
                        Sang {aiTheoMa('content').ten}
                      </Link>
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                    {displayPosts.map((post) => (
                      <button 
                        key={post.id}
                        onClick={() => setSelectedPostId(post.id)}
                        className={clsx(
                          "text-left p-4 rounded-xl border transition-all duration-200 bg-surface-container hover:bg-surface-container group flex gap-4",
                          selectedPostId === post.id 
                            ? "border-primary bg-primary/5 shadow-[0_0_15px_rgba(0,229,255,0.1)]" 
                            : "border-outline-variant hover:border-primary/50"
                        )}
                      >
                        <div className="w-20 h-20 bg-surface-variant rounded-lg shrink-0 flex items-center justify-center overflow-hidden">
                          {post.hasImage ? (
                            <span className="material-symbols-outlined text-on-surface-variant text-[32px]">image</span>
                          ) : (
                            <span className="material-symbols-outlined text-on-surface-variant text-[32px]">article</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col">
                          <p className="text-sm text-on-surface font-medium line-clamp-2 leading-snug mb-2 group-hover:text-primary transition-colors">
                            {post.content}
                          </p>
                          <div className="mt-auto flex items-center justify-between text-xs text-on-surface-variant font-medium">
                            <span>{post.date}</span>
                            <div className="flex gap-3">
                              <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">thumb_up</span>{post.stats.likes}</span>
                              <span className="flex items-center gap-1 text-primary"><span className="material-symbols-outlined text-[14px]">chat_bubble</span>{post.stats.comments}</span>
                            </div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="flex justify-end pt-6 border-t border-outline-variant/50">
                    <button 
                      onClick={() => setCurrentStep(2)}
                      disabled={!selectedPostId}
                      className={NUT_CHINH}
                    >
                      Tiếp tục <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                    </button>
                  </div>
                </div>
              ) : currentStep === 2 ? (
                <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                  <h2 className="text-2xl font-bold text-on-surface mb-8">Bạn muốn chi bao nhiêu?</h2>
                  
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-8 mb-8">
                    <div className="md:col-span-3 space-y-6">
                      <div className="bg-surface-container border border-outline-variant p-6 rounded-2xl">
                        <label className="block text-sm font-bold text-on-surface mb-3">Ngân sách mỗi ngày</label>
                        <div className="relative mb-4">
                          <input 
                            type="text" 
                            value={dailyBudget === 0 ? '' : dailyBudget.toLocaleString('vi-VN')}
                            onChange={(e) => {
                              const rawValue = e.target.value.replace(/\./g, '');
                              const numValue = parseInt(rawValue, 10);
                              if (!isNaN(numValue)) {
                                setDailyBudget(numValue);
                              } else if (rawValue === '') {
                                setDailyBudget(0);
                              }
                            }}
                            className="bg-surface-container-high w-full border border-outline-variant rounded-xl px-4 py-3 text-lg font-bold text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all pr-12"
                          />
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant font-bold">đ</span>
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          {[100000, 300000, 500000, 1000000].map(val => (
                            <button 
                              key={val}
                              onClick={() => setDailyBudget(val)}
                              className="py-2 bg-surface-variant hover:bg-surface-variant-high text-on-surface font-medium text-xs rounded-lg transition-colors border border-transparent hover:border-outline-variant"
                            >
                              {val.toLocaleString('vi-VN')}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="bg-surface-container border border-outline-variant p-6 rounded-2xl">
                        <label className="block text-sm font-bold text-on-surface mb-3">Chạy trong bao nhiêu ngày</label>
                        <div className="flex items-center gap-4 mb-4">
                          <button onClick={() => setDuration(Math.max(1, duration - 1))} className="w-10 h-10 rounded-full bg-surface-variant hover:bg-surface-variant-high text-on-surface flex items-center justify-center transition-colors">
                            <span className="material-symbols-outlined">remove</span>
                          </button>
                          <div className="flex-1 relative">
                            <input 
                              type="number" 
                              value={duration}
                              onChange={(e) => setDuration(Number(e.target.value) || 1)}
                              className="bg-surface-container-high w-full border border-outline-variant rounded-xl px-4 py-3 text-lg font-bold text-on-surface text-center focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all pr-16"
                            />
                            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant font-bold">ngày</span>
                          </div>
                          <button onClick={() => setDuration(duration + 1)} className="w-10 h-10 rounded-full bg-surface-variant hover:bg-surface-variant-high text-on-surface flex items-center justify-center transition-colors">
                            <span className="material-symbols-outlined">add</span>
                          </button>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-primary font-medium bg-primary/10 px-3 py-2 rounded-lg w-fit">
                          <span className="material-symbols-outlined text-[16px]">calendar_month</span>
                          Từ 15/08 đến {15 + duration > 31 ? (15+duration-31).toString().padStart(2, '0') + '/09' : (15+duration).toString().padStart(2, '0') + '/08'}
                        </div>
                      </div>
                    </div>

                    <div className="md:col-span-2">
                      <div className="sticky top-0 bg-primary/10 border-2 border-primary/40 rounded-2xl p-6 shadow-[0_0_30px_rgba(0,229,255,0.15)] h-full flex flex-col justify-center overflow-hidden">
                        <h3 className="tieu-de-muc mb-4">
                          TỔNG CHI TIÊU TỐI ĐA
                        </h3>
                        <div className={clsx(
                          "font-black text-on-surface mb-2 tracking-tight whitespace-nowrap",
                          (dailyBudget * duration).toLocaleString('vi-VN').length >= 12 ? "text-2xl lg:text-3xl" : 
                          (dailyBudget * duration).toLocaleString('vi-VN').length >= 9 ? "text-3xl lg:text-4xl" : "text-4xl lg:text-5xl"
                        )}>
                          {(dailyBudget * duration).toLocaleString('vi-VN')} đ
                        </div>
                        <p className="text-on-surface-variant font-medium mt-auto">
                          {dailyBudget.toLocaleString('vi-VN')} đ × {duration} ngày
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between pt-6 border-t border-outline-variant/50">
                    <button 
                      onClick={() => setCurrentStep(1)}
                      className={NUT_PHU}
                    >
                      <span className="material-symbols-outlined text-[18px]">arrow_back</span> Quay lại
                    </button>
                    <button 
                      onClick={() => setCurrentStep(3)}
                      className={NUT_CHINH}
                    >
                      Tiếp tục <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                    </button>
                  </div>
                </div>
              ) : currentStep === 3 ? (
                <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                  <h2 className="text-2xl font-bold text-on-surface mb-8">Ai sẽ thấy quảng cáo này?</h2>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
                    <div className="md:col-span-2 space-y-4">
                      
                      <div 
                        onClick={() => setAudienceType('saved')}
                        className={clsx(
                          "w-full text-left p-5 rounded-2xl border transition-all duration-200 bg-surface-container cursor-pointer",
                          audienceType === 'saved' ? "border-primary bg-primary/5" : "border-outline-variant hover:border-primary/50"
                        )}
                      >
                        <div className="flex items-center gap-3 mb-2">
                          <div className={clsx("w-5 h-5 rounded-full border-2 flex items-center justify-center", audienceType === 'saved' ? "border-primary" : "border-outline-variant")}>
                            {audienceType === 'saved' && <div className="w-2.5 h-2.5 rounded-full bg-primary"></div>}
                          </div>
                          <span className="font-bold text-on-surface text-lg">Dùng tệp đã lưu</span>
                        </div>
                        {audienceType === 'saved' && (
                          <div className="pl-8 mt-4 animate-in slide-in-from-top-2 duration-200">
                            <select className="bg-surface-container-high w-full border border-outline-variant rounded-xl px-4 py-3 text-sm font-medium text-on-surface focus:outline-none focus:border-primary">
                              <option>Khách đã mua</option>
                              <option>Giống khách đã mua</option>
                              <option>Quan tâm sản phẩm</option>
                            </select>
                          </div>
                        )}
                      </div>

                      <div 
                        onClick={() => setAudienceType('custom')}
                        className={clsx(
                          "w-full text-left p-5 rounded-2xl border transition-all duration-200 bg-surface-container cursor-pointer",
                          audienceType === 'custom' ? "border-primary bg-primary/5" : "border-outline-variant hover:border-primary/50"
                        )}
                      >
                        <div className="flex items-center gap-3 mb-2">
                          <div className={clsx("w-5 h-5 rounded-full border-2 flex items-center justify-center", audienceType === 'custom' ? "border-primary" : "border-outline-variant")}>
                            {audienceType === 'custom' && <div className="w-2.5 h-2.5 rounded-full bg-primary"></div>}
                          </div>
                          <span className="font-bold text-on-surface text-lg">Tự chọn đối tượng</span>
                        </div>
                        {audienceType === 'custom' && (
                          <div className="pl-8 mt-6 space-y-5 animate-in slide-in-from-top-2 duration-200 cursor-default" onClick={e => e.stopPropagation()}>
                            <div>
                              <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Khu vực</label>
                              <input type="text" value={location} onChange={e => setLocation(e.target.value)} className="bg-surface-container-high w-full border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary" />
                            </div>
                            <div>
                              <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Độ tuổi: {ageRange[0]} - {ageRange[1]}</label>
                              <div className="h-10 border border-outline-variant rounded-lg bg-surface-container-high flex items-center px-4 relative">
                                <div className="absolute left-1/4 right-1/4 h-1.5 bg-primary rounded-full"></div>
                                <div className="absolute left-1/4 w-4 h-4 rounded-full bg-white shadow-md border-2 border-primary -translate-x-1/2"></div>
                                <div className="absolute right-1/4 w-4 h-4 rounded-full bg-white shadow-md border-2 border-primary translate-x-1/2"></div>
                              </div>
                            </div>
                            <div>
                              <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Giới tính</label>
                              <div className="flex bg-surface-container-high rounded-lg p-1 border border-outline-variant">
                                {['Tất cả', 'Nam', 'Nữ'].map(g => (
                                  <button 
                                    key={g} 
                                    onClick={() => setGender(g)}
                                    className={clsx("flex-1 py-1.5 text-sm font-bold rounded-md transition-colors", gender === g ? "bg-primary/20 text-primary" : "text-on-surface-variant hover:text-on-surface")}
                                  >
                                    {g}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div>
                              <label className="block text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Sở thích</label>
                              <input type="text" placeholder="Thêm sở thích..." className="bg-surface-container-high w-full border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary placeholder:text-on-surface-variant/70" />
                            </div>
                          </div>
                        )}
                      </div>

                      <div 
                        onClick={() => setAudienceType('auto')}
                        className={clsx(
                          "w-full text-left p-5 rounded-2xl border transition-all duration-200 bg-surface-container cursor-pointer",
                          audienceType === 'auto' ? "border-primary bg-primary/5" : "border-outline-variant hover:border-primary/50"
                        )}
                      >
                        <div className="flex items-center gap-3 mb-2">
                          <div className={clsx("w-5 h-5 rounded-full border-2 flex items-center justify-center", audienceType === 'auto' ? "border-primary" : "border-outline-variant")}>
                            {audienceType === 'auto' && <div className="w-2.5 h-2.5 rounded-full bg-primary"></div>}
                          </div>
                          <span className="font-bold text-on-surface text-lg">Để Facebook tự tìm</span>
                        </div>
                        <p className="pl-8 text-sm text-on-surface-variant">
                          Facebook tự tìm người có khả năng quan tâm nhất dựa trên nội dung bài đăng
                        </p>
                      </div>
                    </div>

                    <div className="md:col-span-1">
                      <div className="sticky top-0 bg-surface-container border border-outline-variant rounded-2xl p-6 h-full flex flex-col justify-center text-center">
                        <h3 className="tieu-de-muc mb-4">
                          ƯỚC TÍNH TIẾP CẬN
                        </h3>
                        <div className="text-2xl font-black text-primary mb-6">
                          {reachEstimate.replace(' người', '')}<br/><span className="text-base font-bold text-on-surface-variant">người</span>
                        </div>
                        
                        <div className="relative w-32 h-16 mx-auto mb-2 overflow-hidden">
                          <div className="w-32 h-32 rounded-full border-8 border-outline-variant border-t-green-400 border-r-yellow-400 border-l-primary rotate-45 box-border"></div>
                          <div className="absolute bottom-0 left-1/2 w-1 h-14 bg-on-surface origin-bottom -translate-x-1/2 rotate-[15deg] transition-transform duration-500">
                            <div className="absolute -top-1 -left-1 w-3 h-3 bg-on-surface rounded-full"></div>
                          </div>
                        </div>
                        <p className="text-sm font-bold text-green-400">Tệp vừa phải</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between pt-6 border-t border-outline-variant/50">
                    <button 
                      onClick={() => setCurrentStep(2)}
                      className={NUT_PHU}
                    >
                      <span className="material-symbols-outlined text-[18px]">arrow_back</span> Quay lại
                    </button>
                    <button 
                      onClick={() => setCurrentStep(4)}
                      className={NUT_CHINH}
                    >
                      Tiếp tục <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                  <h2 className="text-2xl font-bold text-on-surface mb-2">Xác nhận trước khi chạy</h2>
                  <p className="text-on-surface-variant mb-8">
                    Kiểm tra lại một lần nữa trước khi tiền bắt đầu được trừ
                  </p>

                  <div className="bg-surface-container border border-outline-variant rounded-2xl overflow-hidden mb-6">
                    <div className="flex items-center justify-between p-4 border-b border-outline-variant/50">
                      <span className="text-sm font-bold text-on-surface-variant">Bài đăng</span>
                      <div className="flex items-center gap-3 max-w-[60%] text-right">
                        <span className="text-sm font-medium text-on-surface truncate">
                          {displayPosts.find(p => p.id === selectedPostId)?.content || "Bài viết chưa chọn"}
                        </span>
                        <div className="w-10 h-10 bg-surface-variant rounded shrink-0 flex items-center justify-center">
                          {displayPosts.find(p => p.id === selectedPostId)?.hasImage ? (
                            <span className="material-symbols-outlined text-on-surface-variant text-[20px]">image</span>
                          ) : (
                            <span className="material-symbols-outlined text-on-surface-variant text-[20px]">article</span>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between p-4 border-b border-outline-variant/50">
                      <span className="text-sm font-bold text-on-surface-variant">Ngân sách mỗi ngày</span>
                      <span className="text-base font-bold text-on-surface">{dailyBudget.toLocaleString('vi-VN')} đ</span>
                    </div>

                    <div className="flex items-center justify-between p-4 border-b border-outline-variant/50">
                      <span className="text-sm font-bold text-on-surface-variant">Thời gian chạy</span>
                      <div className="text-right">
                        <span className="text-base font-bold text-on-surface block">{duration} ngày</span>
                        <span className="text-xs text-on-surface-variant font-medium">từ 15/08 đến {15+duration > 31 ? (15+duration-31).toString().padStart(2,'0')+'/09' : (15+duration).toString().padStart(2,'0')+'/08'}</span>
                      </div>
                    </div>

                    <div className="flex flex-col md:flex-row md:items-center justify-between p-4 border-b border-outline-variant/50 gap-2">
                      <span className="text-sm font-bold text-on-surface-variant shrink-0">Đối tượng</span>
                      <span className="text-sm font-medium text-on-surface text-right">
                        {audienceType === 'custom' ? `${location}, ${ageRange[0]}-${ageRange[1]} tuổi, ${gender}` : 
                         audienceType === 'auto' ? "Tự động phân phối (Khuyên dùng)" : "Tệp: Khách đã mua"}
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-4">
                      <span className="text-sm font-bold text-on-surface-variant">Ước tính tiếp cận</span>
                      <span className="text-sm font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-md">{reachEstimate}</span>
                    </div>
                  </div>

                  <div className="bg-surface-container-highest border-2 border-primary/30 rounded-2xl p-6 text-center shadow-[0_0_40px_rgba(0,229,255,0.08)] mb-8 overflow-hidden">
                    <h3 className="tieu-de-muc mb-2">TỔNG CHI TIÊU TỐI ĐA</h3>
                    <div className={clsx(
                      "font-black text-on-surface mb-3 tracking-tight whitespace-nowrap",
                      (dailyBudget * duration).toLocaleString('vi-VN').length >= 12 ? "text-3xl lg:text-4xl" : "text-5xl"
                    )}>
                      {(dailyBudget * duration).toLocaleString('vi-VN')} đ
                    </div>
                    <p className="text-sm text-on-surface-variant font-medium">Số tiền này sẽ được trừ vào tài khoản quảng cáo Facebook của bạn</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <button 
                      onClick={() => setCurrentStep(3)}
                      className="w-full py-3.5 px-4 bg-surface-container border border-outline-variant text-on-surface font-bold text-lg rounded-xl hover:bg-surface-variant transition-colors"
                    >
                      Quay lại chỉnh sửa
                    </button>
                    <button 
                      onClick={handleLaunchBoost}
                      disabled={busy}
                      className="w-full py-3.5 px-4 bg-primary text-on-primary font-bold text-lg rounded-xl shadow-[0_4px_25px_rgba(0,229,255,0.4)] hover:scale-[1.02] transition-transform"
                    >
                      Xác nhận và chạy
                    </button>
                  </div>
                </div>
              )}
            </div>
        </HopThoai>
      )}

      {/* Centered Create Audience Modal */}
      {isAudienceFlowOpen && (
        <HopThoai
          co="vua"
          bieuTuong="group_add"
          tieuDe="Tạo tệp đối tượng"
          onDong={() => setIsAudienceFlowOpen(false)}
          dongKhiBamNgoai={false}
          chan={
            <>
              <button type="button" onClick={() => setIsAudienceFlowOpen(false)} className={NUT_PHU}>
                Huỷ
              </button>
              <button type="button" onClick={handleCreateAudience} disabled={busy} className={NUT_CHINH}>
                {busy ? 'Đang tạo…' : 'Tạo tệp'}
              </button>
            </>
          }
        >
            <div className="space-y-8">
              
              {/* Block 1 */}
              <div>
                <label className="block font-mono text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">TÊN TỆP</label>
                <input 
                  type="text" 
                  value={audName}
                  onChange={e => setAudName(e.target.value)}
                  placeholder="Ví dụ: Khách đã mua"
                  className="bg-surface-container-high w-full border border-outline-variant rounded-xl px-4 py-3 text-sm text-on-surface focus:outline-none focus:border-primary placeholder:text-on-surface-variant/70"
                />
              </div>

              {/* Block 2 */}
              <div>
                <label className="block font-mono text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-3">LOẠI TỆP</label>
                <div className="space-y-3">
                  {[
                    { id: 'custom', title: 'Tệp tùy chỉnh', desc: 'Danh sách khách hàng của bạn, ví dụ người đã nhắn tin hoặc đã mua hàng' },
                    { id: 'lookalike', title: 'Tệp tương tự', desc: 'Facebook tìm những người có hành vi giống với một tệp bạn đã có' },
                    { id: 'interest', title: 'Theo sở thích', desc: 'Nhắm vào người quan tâm những chủ đề bạn chọn' }
                  ].map(type => (
                    <button 
                      key={type.id}
                      onClick={() => setAudType(type.id)}
                      className={clsx(
                        "w-full text-left p-4 rounded-xl border transition-all duration-200 flex gap-4 items-start",
                        audType === type.id ? "bg-primary/10 border-primary" : "bg-surface-container border-outline-variant hover:border-primary/50"
                      )}
                    >
                      <div className={clsx("w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center mt-0.5", audType === type.id ? "border-primary" : "border-outline-variant")}>
                        {audType === type.id && <div className="w-2.5 h-2.5 rounded-full bg-primary"></div>}
                      </div>
                      <div>
                        <h4 className="font-bold text-on-surface mb-1">{type.title}</h4>
                        <p className="text-sm text-on-surface-variant leading-relaxed">{type.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Block 3 - Dynamic */}
              <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                {audType === 'custom' && (
                  <div className="space-y-3">
                    {[
                      'Người đã nhắn tin cho trang',
                      'Người đã bình luận bài đăng',
                      'Khách đã chốt đơn',
                      'Người đã xem bài đăng'
                    ].map(source => (
                      <label key={source} onClick={() => handleToggleCustomSource(source)} className="flex items-center gap-3 p-3 rounded-xl hover:bg-surface-container transition-colors cursor-pointer border border-transparent hover:border-outline-variant">
                        <div className={clsx(
                          "w-5 h-5 rounded border flex items-center justify-center transition-colors",
                          audCustomSources.includes(source) ? "bg-primary border-primary" : "border-outline-variant bg-surface-container-high"
                        )}>
                          {audCustomSources.includes(source) && <span className="material-symbols-outlined text-[14px] text-on-primary font-bold">check</span>}
                        </div>
                        <span className="text-sm font-medium text-on-surface">{source}</span>
                      </label>
                    ))}
                  </div>
                )}

                {audType === 'lookalike' && (
                  <div className="space-y-6">
                    <div>
                      <label className="block text-sm font-bold text-on-surface mb-2">Tệp gốc</label>
                      <select 
                        value={audLookalikeSource}
                        onChange={e => setAudLookalikeSource(e.target.value)}
                        className="bg-surface-container-high w-full border border-outline-variant rounded-xl px-4 py-3 text-sm font-medium text-on-surface focus:outline-none focus:border-primary"
                      >
                        <option>Khách đã mua</option>
                        <option>Người đã nhắn tin</option>
                        <option>Người đã bình luận</option>
                      </select>
                    </div>
                    <div>
                      <div className="flex justify-between mb-2">
                        <label className="text-sm font-bold text-on-surface">Độ tương đồng</label>
                        <span className="text-primary font-bold">{audLookalikePercent}%</span>
                      </div>
                      <input 
                        type="range" 
                        min="1" max="10" 
                        value={audLookalikePercent}
                        onChange={e => setAudLookalikePercent(Number(e.target.value))}
                        className="w-full accent-primary h-2 bg-surface-variant rounded-lg appearance-none cursor-pointer"
                      />
                      <div className="flex justify-between text-xs font-bold text-on-surface-variant mt-2">
                        <span>1% (Giống nhất)</span>
                        <span>10% (Rộng nhất)</span>
                      </div>
                      <p className="text-xs text-on-surface-variant mt-3 bg-surface-container p-3 rounded-lg border border-outline-variant/50">
                        Số càng nhỏ thì càng giống tệp gốc nhưng ít người hơn
                      </p>
                    </div>
                  </div>
                )}

                {audType === 'interest' && (
                  <div>
                    <label className="block text-sm font-bold text-on-surface mb-2">Chủ đề quan tâm</label>
                    <div className="bg-surface-container-high border border-outline-variant rounded-xl p-2 min-h-[100px] flex flex-wrap gap-2 focus-within:border-primary transition-colors">
                      {audInterests.map((interest, idx) => (
                        <span key={idx} className="bg-primary/20 text-primary border border-primary/30 px-3 py-1 rounded-md text-sm font-medium flex items-center gap-1.5">
                          {interest}
                          <button onClick={() => handleRemoveInterest(idx)} className="hover:bg-primary/30 rounded-full w-4 h-4 flex items-center justify-center">
                            <span className="material-symbols-outlined text-[12px]">close</span>
                          </button>
                        </span>
                      ))}
                      <input 
                        type="text"
                        value={audNewInterest}
                        onChange={e => setAudNewInterest(e.target.value)}
                        onKeyDown={handleAddInterest}
                        placeholder={audInterests.length === 0 ? "Nhập sở thích và nhấn Enter..." : ""}
                        className="flex-1 min-w-[150px] bg-transparent outline-none text-sm text-on-surface p-1"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Block 4 */}
              <div className="bg-surface-container border border-outline-variant rounded-xl p-5 text-center">
                <h3 className="tieu-de-muc mb-2">ƯỚC TÍNH SỐ NGƯỜI</h3>
                <div className="text-3xl font-black text-primary">
                  {audType === 'custom' ? 'khoảng 45.000' : 
                   audType === 'lookalike' ? 'khoảng 850.000' : 'khoảng 320.000'} <span className="text-lg text-on-surface font-bold">người</span>
                </div>
              </div>

            </div>
        </HopThoai>
      )}

      <AITrainingModal kind="ads" isOpen={isTrainingOpen} onClose={() => setIsTrainingOpen(false)} aiName="AI Quảng Cáo" />

      {/* Sửa tệp đối tượng — thay cho nút mở sang Facebook trước đây */}
      {suaTepId && (
        <HopThoai
          co="vua"
          bieuTuong="edit"
          tieuDe="Đổi tên tệp đối tượng"
          phuDe="Quy tắc nhắm chọn của tệp là bất biến — nền tảng không cho sửa sau khi tạo. Muốn nhắm khác thì tạo tệp mới."
          onDong={() => setSuaTepId(null)}
          chan={
            <>
              <button type="button" onClick={() => setSuaTepId(null)} className={NUT_PHU}>
                Huỷ
              </button>
              <button type="button" onClick={luuTepDoiTuong} disabled={dangLuuTep} className={NUT_CHINH}>
                {dangLuuTep ? 'Đang lưu…' : 'Lưu'}
              </button>
            </>
          }
        >
          <label className="block">
            <span className={NHAN_O}>Tên tệp</span>
            <input
              value={suaTepTen}
              onChange={(e) => setSuaTepTen(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') luuTepDoiTuong(); }}
              className={O_NHAP}
            />
          </label>
        </HopThoai>
      )}

    </main>
  );
}

