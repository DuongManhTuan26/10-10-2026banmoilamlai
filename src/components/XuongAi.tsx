import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { api, ApiError, type LuaChonVeAnh, type MediaItem } from '../lib/api';
import { ChonMoHinhAnh, vndAnh } from './ChonMoHinhAnh';
import { LuatNoiDungChon, type LuatNoiDungGiaTri } from './LuatNoiDungChon';
import { ThuVienAnh } from './ThuVienAnh';
import VideoAiPanel from './VideoAiPanel';
import { MAU_PHONG_CACH } from '../lib/phong-cach-anh';
import { XuongContext, type HanhDongTao, type VideoTheoBai } from '../lib/xuong';
import { useActivePage } from '../lib/ActivePage';

/**
 * XƯỞNG AI — MỘT Ô SOẠN CHUNG cho ảnh và video, như Pippit / Dreamina (chủ dự án 03/10/2026:
 * "gộp cả tạo ảnh và video làm một cửa sổ rồi tự chọn riêng"; bản trước chỉ đặt hai khối cũ dưới
 * hai tab — mỗi bên một ô mô tả, một chỗ chọn ảnh — là SAI ý).
 *
 *   Hai công tắc trái/phải NẰM TRÊN thanh Ảnh | Video (chủ dự án 04/10/2026: chọn chế độ trước rồi mới tạo):
 *   "Ảnh tạo riêng" · "Video tạo riêng". Tắt (đèn tối) = đi theo bài: bên đó tối hẳn, ô prompt ĐÓNG, bấm Đăng bài
 *   là tự tạo từ nội dung bài rồi đăng cùng. Bật (đèn sáng) = bên đó sáng lên, tự được chọn, mở ô prompt riêng cho
 *   bên đó. Bật cả hai = bài chỉ đăng chữ; bên đang chọn sáng hẳn (tô đầy + phát sáng mạnh) kèm nút Tạo cùng màu.
 *   Ảnh màu xanh ngọc, video màu hồng tím.
 *   Bố cục (chủ dự án 04/10/2026): phần DÙNG CHUNG (ô prompt, ảnh tham chiếu) nằm giữa; phần RIÊNG chia đôi song
 *   song như hai công tắc — lựa chọn ảnh bên trái, lựa chọn video bên phải, LUÔN MỞ (nối với bài vẫn phải chọn mô
 *   hình, thông số cho lúc tự tạo). Tắt đèn chỉ đóng ô prompt.
 *   Ô soạn chung: MỘT ô mô tả, NÚT TẠO nằm ngay trong ô (như Pippit — chủ dự án 03/10/2026 "viết prompt xong
 *   thì dùng cái gì để bấm tạo"), MỘT dải ảnh tham chiếu. Nút đổi nhãn + giá theo chế độ / kỹ năng video đang mở.
 *   Phía dưới: mô hình, thông số, giá của chế độ đang chọn.
 *
 * Phần video đọc ô soạn chung qua XuongContext (src/lib/xuong.ts): VideoAiPanel, VideoDaiPanel, VideoSuaPanel.
 */

export const TOI_DA_ANH_THAM_CHIEU = 4;

/** Thứ Xưởng sẽ tự tạo khi bấm Đăng bài / Lên lịch (bên nào đang đi theo bài). */
export interface KeHoachDang {
  anh: { gia: number | null } | null;
  video: { gia: number | null; ten: string } | null;
  /** Có bên đi theo bài nhưng chưa tạo được (chưa chọn mô hình…) — chặn đăng, báo rõ. */
  loi: string | null;
  /** Vẽ ảnh theo bài ngay lúc đăng; trả về ảnh để gắn vào bài. */
  taoAnh: () => Promise<MediaItem>;
  /** Gửi việc tạo video theo bài cho bài đã lưu; máy chủ đăng bài khi video xong. */
  guiVideo: (postId: number) => Promise<void>;
}

/**
 * Đề bài gửi AI. Đi theo bài = CHỈ nội dung bài (ô prompt đóng — chủ dự án 04/10/2026: "vừa kết nối với bài vừa
 * kết nối với prompt thì đánh nhau"). Tạo riêng = CHỈ prompt bạn viết.
 */
export function ghepDeBai(theoBai: boolean, noiDungBai: string, moTa: string): string {
  return (theoBai ? (noiDungBai ?? '') : (moTa ?? '')).trim();
}

function nhoLocal<T extends string>(khoa: string, macDinh: T, hopLe: readonly T[]): T {
  try {
    const v = localStorage.getItem(khoa) as T | null;
    return v && hopLe.includes(v) ? v : macDinh;
  } catch {
    return macDinh;
  }
}
function luuLocal(khoa: string, v: string) {
  try {
    localStorage.setItem(khoa, v);
  } catch {
    /* không nhớ được thì lần sau về mặc định */
  }
}

type CheDoXuong = 'anh' | 'video';

export function XuongAi({
  noiDung,
  anhBai,
  videoBai,
  onGanVaoBai,
  onKeHoachDang,
}: {
  /** Nội dung bài đang soạn. */
  noiDung: string;
  /** Ảnh đang gắn vào bài — chọn được làm ảnh tham chiếu. */
  anhBai: string[];
  /** Video đang gắn vào bài — chọn được làm video nguồn khi sửa video. */
  videoBai: string[];
  onGanVaoBai: (item: MediaItem) => void;
  /** Báo lên ô soạn bài: đăng bài thì tự tạo gì, giá bao nhiêu. */
  onKeHoachDang?: (kh: KeHoachDang | null) => void;
}) {
  // --- Ô soạn chung -------------------------------------------------------
  const [cheDo, setCheDoState] = useState<CheDoXuong>(() => nhoLocal('xuongAiTab', 'anh', ['anh', 'video'] as const));
  const setCheDo = (v: CheDoXuong) => {
    setCheDoState(v);
    luuLocal('xuongAiTab', v);
  };
  // Mỗi bên một công tắc "tạo riêng". Lần đầu để BẬT (tạo riêng): không tự tốn tiền khi đăng bài cho tới khi
  // chủ shop chủ động gạt sang đi theo bài. Nhớ lựa chọn cho lần sau.
  const [anhRieng, setAnhRiengState] = useState<boolean>(() => nhoLocal('anhRieng', 'true', ['true', 'false'] as const) === 'true');
  const setAnhRieng = (v: boolean) => {
    setAnhRiengState(v);
    luuLocal('anhRieng', String(v));
    // Mở bên nào thì chọn luôn bên đó (tắt bên đang chọn thì bên còn mở tự được chọn — xem cheDoMo).
    if (v) setCheDo('anh');
  };
  const [videoRieng, setVideoRiengState] = useState<boolean>(() => nhoLocal('videoRieng', 'true', ['true', 'false'] as const) === 'true');
  const setVideoRieng = (v: boolean) => {
    setVideoRiengState(v);
    luuLocal('videoRieng', String(v));
    if (v) setCheDo('video');
  };
  const [moTa, setMoTa] = useState('');
  const [anhChon, setAnhChon] = useState<string[]>([]);
  const [anhThem, setAnhThem] = useState<string[]>([]);
  const [dangTaiAnh, setDangTaiAnh] = useState(false);
  const [loi, setLoi] = useState('');
  const oTep = useRef<HTMLInputElement>(null);

  // Việc chính của kỹ năng video đang mở (kỹ năng tự báo lên) và công tắc video — để vẽ ở ô soạn.
  const chayRef = useRef<Record<string, () => void>>({});
  const [hanhDong, setHanhDong] = useState<{ chu: string; h: HanhDongTao } | null>(null);
  const datHanhDong = useCallback((chu: string, h: HanhDongTao | null, chay?: () => void) => {
    if (h) {
      if (chay) chayRef.current[chu] = chay;
      setHanhDong((cu) =>
        cu && cu.chu === chu && cu.h.nhan === h.nhan && cu.h.khoa === h.khoa && cu.h.dangChay === h.dangChay ? cu : { chu, h }
      );
    } else {
      delete chayRef.current[chu];
      setHanhDong((cu) => (cu && cu.chu === chu ? null : cu));
    }
  }, []);
  const [videoTheoBai, setVideoTheoBai] = useState<VideoTheoBai | null>(null);
  const datVideoTheoBai = useCallback((v: VideoTheoBai | null) => {
    setVideoTheoBai((cu) => (JSON.stringify(cu) === JSON.stringify(v) ? cu : v));
  }, []);
  // Ảnh / video Xưởng đã tạo cho bài này: đã có (tạo thử rồi gắn vào bài) thì lúc đăng không tạo thêm.
  const daTao = useRef(new Set<string>());
  const ganVaoBai = (item: MediaItem) => {
    daTao.current.add(item.url);
    onGanVaoBai(item);
  };

  const deBaiAnh = ghepDeBai(!anhRieng, noiDung, moTa);
  const deBaiVideo = ghepDeBai(!videoRieng, noiDung, moTa);
  /** Ô prompt mở khi còn ít nhất một bên tạo riêng; nối với bài cả hai thì đóng. */
  const dangMo = anhRieng || videoRieng;
  /** Bên ô prompt đang làm cho: bên đã chọn nếu còn mở, không thì bên còn mở (bên nối với bài không chọn được). */
  const cheDoMo: CheDoXuong = (cheDo === 'anh' ? anhRieng : videoRieng) ? cheDo : anhRieng ? 'anh' : 'video';
  const anhCoTheChon = [...anhBai, ...anhThem.filter((u) => !anhBai.includes(u))];
  const doiChonAnh = (u: string) =>
    setAnhChon((cu) => (cu.includes(u) ? cu.filter((x) => x !== u) : [...cu, u].slice(0, TOI_DA_ANH_THAM_CHIEU)));
  const themAnh = (u: string) => {
    setAnhThem((cu) => (cu.includes(u) ? cu : [...cu, u]));
    setAnhChon((cu) => (cu.includes(u) ? cu : [...cu, u].slice(0, TOI_DA_ANH_THAM_CHIEU)));
  };
  const taiAnh = async (f: File) => {
    setDangTaiAnh(true);
    setLoi('');
    try {
      const item = await api.posts.uploadMedia(f);
      themAnh(item.url);
    } catch (error) {
      setLoi(error instanceof ApiError ? error.message : 'Không tải được ảnh lên');
    } finally {
      setDangTaiAnh(false);
    }
  };

  // --- Riêng chế độ ẢNH ---------------------------------------------------
  const [veAnh, setVeAnhState] = useState<LuaChonVeAnh>(() => {
    try {
      const luu = JSON.parse(localStorage.getItem('veAnh') ?? 'null');
      return luu && typeof luu.model === 'string' ? luu : { model: '' };
    } catch {
      return { model: '' };
    }
  });
  const setVeAnh = (moi: LuaChonVeAnh) => {
    setVeAnhState(moi);
    luuLocal('veAnh', JSON.stringify(moi));
  };
  const [giaVeAnh, setGiaVeAnh] = useState<number | null>(null);
  const [chuTrongAnh, setChuTrongAnh] = useState<'theo_noi_dung' | 'khong'>('theo_noi_dung');
  const [luatAnh, setLuatAnh] = useState<LuatNoiDungGiaTri>({ chanNhanHieuGia: false, chanNguoiThat: false });
  const [phongCachAnh, setPhongCachAnh] = useState('');
  const [phongCachDaLuu, setPhongCachDaLuu] = useState('');
  const [dangLuuPhongCach, setDangLuuPhongCach] = useState(false);
  const [dangTaoAnh, setDangTaoAnh] = useState(false);
  const [tienAnhCuoi, setTienAnhCuoi] = useState<number | null>(null);
  const [tienAnh, setTienAnh] = useState(0);
  const oPhongCachRef = useRef<HTMLTextAreaElement>(null);
  const laPhongCachRieng = !MAU_PHONG_CACH.some((m) => m.mota === phongCachAnh);

  // Phong cách vẽ ảnh đã lưu của Trang (cũng dùng cho ảnh lịch tự đăng). Đổi Trang thì nạp lại.
  const { activeAccountId, activeTrangId } = useActivePage();
  useEffect(() => {
    api.ai
      .imageStyle()
      .then(({ data }) => {
        setPhongCachAnh(data.phongCach);
        setPhongCachDaLuu(data.phongCach);
      })
      .catch(() => {
        /* Không nạp được thì để trống, máy chủ vẫn có phong cách mặc định. */
      });
  }, [activeAccountId, activeTrangId]);

  const luuPhongCachAnh = async () => {
    if (dangLuuPhongCach) return;
    setDangLuuPhongCach(true);
    setLoi('');
    try {
      await api.ai.saveImageStyle(phongCachAnh.trim());
      setPhongCachDaLuu(phongCachAnh.trim());
    } catch (error) {
      setLoi(error instanceof ApiError ? error.message : 'Không lưu được phong cách ảnh');
    } finally {
      setDangLuuPhongCach(false);
    }
  };

  // Ảnh đi theo bài chỉ vẽ từ nội dung bài — không lấy ảnh tham chiếu của ô prompt.
  const anhMau = anhRieng ? (anhChon[0] ?? '') : '';
  const coDeBai = Boolean(deBaiAnh.trim()) || Boolean(anhMau);

  /** Vẽ một ảnh theo lựa chọn đang chọn; trả về ảnh (chưa gắn vào bài). */
  const veAnhMoi = async (): Promise<MediaItem> => {
    const { data } = await api.ai.generateImage({
      // Theo bài: đề bài là nội dung bài (+ yêu cầu thêm). Tạo riêng: đúng mô tả riêng.
      content: !anhRieng ? deBaiAnh : '',
      prompt: anhRieng ? deBaiAnh || undefined : undefined,
      style: phongCachAnh.trim() || undefined,
      sample: anhMau || undefined,
      chuTrongAnh,
      ...luatAnh,
      ...veAnh,
    });
    setTienAnh((truoc) => truoc + (data.costUsd ?? 0));
    setTienAnhCuoi(data.costUsd ?? 0);
    daTao.current.add(data.url);
    return { url: data.url, type: data.type };
  };

  const taoAnh = async () => {
    if (dangTaoAnh) return;
    if (!coDeBai) {
      setLoi(!anhRieng ? 'Cần nội dung bài viết hoặc ảnh tham chiếu để AI biết vẽ gì.' : 'Viết mô tả ảnh bạn muốn, hoặc chọn ảnh tham chiếu.');
      return;
    }
    setLoi('');
    setDangTaoAnh(true);
    try {
      ganVaoBai(await veAnhMoi());
    } catch (error) {
      setLoi(error instanceof ApiError ? error.message : 'AI chưa tạo được ảnh');
    } finally {
      setDangTaoAnh(false);
    }
  };

  // --- Đăng bài thì tự tạo gì: báo lên ô soạn bài ------------------------------
  // Hàm gọi lúc đăng phải đọc lựa chọn MỚI NHẤT, nên đi qua ref (kế hoạch chỉ đổi khi giá / bên đổi).
  const moiNhat = useRef({ veAnhMoi, deBaiVideo, videoTheoBai });
  moiNhat.current = { veAnhMoi, deBaiVideo, videoTheoBai };
  const taoAnhKhiDang = useCallback(() => moiNhat.current.veAnhMoi(), []);
  const guiVideoKhiDang = useCallback(async (postId: number) => {
    const { deBaiVideo: deBai, videoTheoBai: v } = moiNhat.current;
    if (!v) throw new ApiError('Chưa chọn được mô hình video.', 400);
    await api.ai.videoTheoBai({ ...v.lc, ...v.huong, postId, model: v.model, noiDung: deBai, mucDich: v.mucDich });
  }, []);
  const anhTheoBaiCan = !anhRieng && !anhBai.some((u) => daTao.current.has(u));
  const videoTheoBaiCan = !videoRieng && !videoBai.some((u) => daTao.current.has(u));
  const loiKeHoach =
    anhTheoBaiCan && !veAnh.model
      ? 'Ảnh đang đi theo bài nhưng chưa chọn mô hình vẽ ảnh (Xưởng AI → Tạo ảnh).'
      : videoTheoBaiCan && !videoTheoBai
        ? 'Video đang đi theo bài nhưng chưa có mô hình video làm được lựa chọn này (Xưởng AI → Tạo video).'
        : null;
  const keHoach = useMemo<KeHoachDang>(
    () => ({
      anh: anhTheoBaiCan ? { gia: giaVeAnh } : null,
      video: videoTheoBaiCan && videoTheoBai ? { gia: videoTheoBai.gia, ten: videoTheoBai.ten } : null,
      loi: loiKeHoach,
      taoAnh: taoAnhKhiDang,
      guiVideo: guiVideoKhiDang,
    }),
    [anhTheoBaiCan, giaVeAnh, videoTheoBaiCan, videoTheoBai, loiKeHoach, taoAnhKhiDang, guiVideoKhiDang]
  );
  useEffect(() => {
    onKeHoachDang?.(keHoach);
  }, [keHoach, onKeHoachDang]);
  useEffect(() => () => onKeHoachDang?.(null), [onKeHoachDang]);

  const nut = (chon: boolean) =>
    clsx(
      'px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors',
      chon ? 'border-primary bg-primary/15 text-primary' : 'border-outline-variant bg-surface text-on-surface-variant hover:border-primary/50'
    );
  // Màu theo bên: ảnh = màu chính của miền (① Nội dung — tím), video hồng tím (secondary) — hai bên vẫn khác màu như
  // chủ dự án chọn 04/10/2026; màu ảnh theo màu miền (chủ dự án 10/10/2026: mọi chỗ thuộc miền nào dùng màu miền đó).
  // Bên đi theo bài: tối hẳn. Bên tạo riêng: viền màu; đang chọn thì tô đầy + phát sáng mạnh.
  const laAnh = cheDoMo === 'anh';
  const nutCheDo = (c: CheDoXuong) => {
    const mo = c === 'anh' ? anhRieng : videoRieng;
    const chon = cheDoMo === c;
    return clsx(
      'flex-1 px-4 py-2 rounded-lg text-sm font-bold border transition-all flex items-center justify-center gap-2',
      !mo
        ? 'border-outline-variant bg-surface-container-low text-on-surface-variant cursor-not-allowed'
        : c === 'anh'
          ? chon
            ? 'border-primary bg-primary text-on-primary shadow-[0_0_18px_var(--color-primary)]'
            : 'border-primary/60 bg-surface-container text-primary hover:bg-primary/10'
          : chon
            ? 'border-secondary bg-secondary text-on-secondary-fixed shadow-[0_0_18px_var(--color-secondary)]'
            : 'border-secondary/60 bg-surface-container text-secondary hover:bg-secondary/10'
    );
  };

  // Nút tạo trong ô prompt (chỉ có khi bên đang chọn tạo riêng): ảnh → vẽ ảnh; video → việc chính của kỹ năng đang mở.
  const nutTao: { nhan: string; khoa: boolean; dangChay: boolean; chay: () => void; goiY?: string } = laAnh
    ? {
        nhan: dangTaoAnh ? 'Đang vẽ ảnh…' : `Tạo ảnh${giaVeAnh !== null ? ` — ${vndAnh(giaVeAnh)}` : ''}`,
        khoa: dangTaoAnh || !veAnh.model || !coDeBai,
        dangChay: dangTaoAnh,
        chay: () => void taoAnh(),
        goiY: !coDeBai ? 'Cần mô tả ảnh hoặc ảnh tham chiếu' : undefined,
      }
    : hanhDong
      ? { ...hanhDong.h, chay: () => chayRef.current[hanhDong.chu]?.() }
      : { nhan: 'Tạo video', khoa: true, dangChay: false, chay: () => undefined, goiY: 'Chọn cách làm video bên dưới' };

  return (
    // @container: hai cột ảnh / video đứng song song theo bề rộng CỦA XƯỞNG (cửa sổ chia đôi thì Xưởng hẹp hơn màn hình).
    <div className="khung-muc mau-xam @container">
      <h3 className="tieu-de-muc dau-muc">XƯỞNG AI — ẢNH &amp; VIDEO</h3>
      {loi && <div className="mb-3 text-xs text-error bg-error/10 border border-error/30 rounded-lg px-3 py-2">{loi}</div>}

      {/* ===== Hai công tắc (chọn trước) NẰM TRÊN thanh Ảnh | Video, cân đối trái / phải ===== */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <CongTac
          ten="Ảnh tạo riêng"
          mau="anh"
          dangChon={laAnh}
          bat={anhRieng}
          onDoi={() => setAnhRieng(!anhRieng)}
        />
        <CongTac
          ten="Video tạo riêng"
          mau="video"
          dangChon={!laAnh}
          bat={videoRieng}
          onDoi={() => setVideoRieng(!videoRieng)}
        />
        <div className="flex gap-2 col-span-2" role="tablist">
          <button type="button" role="tab" aria-selected={laAnh} disabled={!anhRieng} onClick={() => setCheDo('anh')} className={nutCheDo('anh')}>
            <span className="material-symbols-outlined text-[18px]">image</span>
            {/* Nút CHỌN BÊN — nút tạo thật nằm trong ô prompt (bản cũ cùng chữ "Tạo ảnh" ở hai chỗ — rà soát lượt 2, T7). */}
            Ảnh
          </button>
          <button type="button" role="tab" aria-selected={!laAnh} disabled={!videoRieng} onClick={() => setCheDo('video')} className={nutCheDo('video')}>
            <span className="material-symbols-outlined text-[18px]">movie</span>
            Video
          </button>
        </div>
      </div>

      {anhRieng && videoRieng && (
        <p className="text-[11px] text-on-surface-variant mb-3 -mt-1">
          Cả hai đang tạo riêng — bài chỉ đăng chữ (cùng ảnh / video bạn tự tạo rồi gắn vào).
        </p>
      )}

      {/* Nối với bài cả hai: CHỈ ô prompt đóng — lựa chọn hai bên ở dưới vẫn mở để chọn cho lúc tự tạo. */}
      {!dangMo && (
        <div className="bg-surface-container rounded-xl px-4 py-3 border border-outline-variant mb-3 text-xs text-on-surface-variant leading-relaxed">
          <b className="text-on-surface">Ô prompt đóng — ảnh và video đang nối với bài đăng:</b> bấm Đăng bài / Lên lịch là AI tự tạo
          từ nội dung bài rồi đăng cùng (giá hiện trên nút Đăng bài). Chọn mô hình, thông số cho từng bên ở dưới.
        </div>
      )}

      {/* ===== Ô PROMPT — chỉ mở cho bên tạo riêng; nút tạo nằm ngay trong ô, cùng màu với bên đang chọn ===== */}
      <div hidden={!dangMo} className="bg-surface-container rounded-xl p-4 border border-outline-variant space-y-3 mb-3">
        <div
          className={clsx(
            'bg-surface-container-high rounded-lg border border-outline-variant focus-within:ring-1 transition-all',
            laAnh ? 'focus-within:border-primary focus-within:ring-primary' : 'focus-within:border-secondary focus-within:ring-secondary'
          )}
        >
          <textarea
            rows={3}
            value={moTa}
            onChange={(e) => setMoTa(e.target.value)}
            placeholder={
              laAnh
                  ? 'Mô tả ảnh bạn muốn, ví dụ: túi cà phê rang xay trên bàn gỗ cạnh phin cà phê, nắng sớm, nền quán mờ…'
                  : 'Mô tả video bạn muốn, ví dụ: tay rót cà phê phin vào ly đá, cận cảnh giọt cà phê, nắng sớm…'
            }
            className="block bg-transparent w-full p-3 text-sm text-on-surface leading-relaxed focus:outline-none resize-none"
          />
          {/* Hẹp quá thì gợi ý xuống dòng riêng phía trên nút, không bị cắt cụt. */}
          <div className="flex flex-wrap items-center justify-end gap-2 px-2 pb-2">
            {nutTao.goiY && <span className="flex-1 min-w-[180px] text-[11px] text-on-surface-variant leading-snug">{nutTao.goiY}</span>}
            <button
              type="button"
              onClick={nutTao.chay}
              disabled={nutTao.khoa}
              title={nutTao.goiY}
              className={clsx(
                'shrink-0 px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed',
                laAnh ? 'bg-primary text-on-primary' : 'bg-secondary text-on-secondary-fixed'
              )}
            >
              <span className={clsx('material-symbols-outlined text-[18px]', nutTao.dangChay && 'animate-spin')}>
                {nutTao.dangChay ? 'progress_activity' : laAnh ? 'auto_awesome' : 'movie'}
              </span>
              {nutTao.nhan}
            </button>
          </div>
        </div>
        <div className="space-y-2">
          <span className="block text-xs font-bold text-on-surface">
            Ảnh tham chiếu — sản phẩm, nhân vật, ảnh mẫu (tối đa {TOI_DA_ANH_THAM_CHIEU}, không bắt buộc, không đăng lên bài)
          </span>
          <input
            ref={oTep}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void taiAnh(f);
              e.target.value = '';
            }}
          />
          <div className="flex flex-wrap gap-2">
            {anhCoTheChon.map((u) => {
              const thuTu = anhChon.indexOf(u);
              return (
                <button key={u} type="button" onClick={() => doiChonAnh(u)} className="relative shrink-0" title={thuTu >= 0 ? 'Bỏ chọn' : 'Chọn làm ảnh tham chiếu'}>
                  <img
                    src={u}
                    alt=""
                    className={clsx('w-16 h-16 rounded-lg object-cover border-2', thuTu >= 0 ? 'border-primary' : 'border-transparent opacity-60 hover:opacity-100')}
                  />
                  {thuTu >= 0 && (
                    <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-primary text-on-primary text-[11px] font-bold leading-5">{thuTu + 1}</span>
                  )}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => oTep.current?.click()}
              disabled={dangTaiAnh || anhChon.length >= TOI_DA_ANH_THAM_CHIEU}
              className="w-16 h-16 rounded-lg border border-dashed border-outline-variant text-[11px] font-bold text-on-surface-variant hover:border-primary/50 disabled:opacity-50"
            >
              {dangTaiAnh ? 'Đang tải…' : '+ Ảnh'}
            </button>
          </div>
          <p className="text-[11px] text-on-surface-variant">
            Ảnh: ảnh số 1 là ảnh mẫu để AI vẽ lại. Video ngắn: ảnh số 1 là khung mở đầu. Video theo kịch bản: dùng cả {TOI_DA_ANH_THAM_CHIEU} ảnh để
            giữ đúng sản phẩm, nhân vật. Chỉ dùng ảnh người đã đồng ý xuất hiện trong quảng cáo của bạn.
          </p>
          <ThuVienAnh onDung={(url) => themAnh(url)} />
        </div>
      </div>

      {/* ===== Lựa chọn RIÊNG: ảnh bên trái, video bên phải — song song, luôn mở ===== */}
      <div className="grid @3xl:grid-cols-2 gap-3 items-start">
      <section className="rounded-xl border border-primary/30 p-3 space-y-3 min-w-0">
        <CotDau ten="Lựa chọn ảnh" mo={anhRieng} moTaMo="tạo riêng — bấm Tạo ảnh ở ô prompt" moTaTat="nối với bài — tự vẽ khi bấm Đăng bài" />
        <ChonMoHinhAnh giaTri={veAnh} onDoi={setVeAnh} coAnhMau={Boolean(anhMau)} onGia={setGiaVeAnh} />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-on-surface">Chữ trong ảnh:</span>
          {(
            [
              { id: 'theo_noi_dung', ten: 'Có chữ theo yêu cầu' },
              { id: 'khong', ten: 'Không có chữ' },
            ] as const
          ).map((c) => (
            <button key={c.id} type="button" onClick={() => setChuTrongAnh(c.id)} className={nut(chuTrongAnh === c.id)}>
              {c.ten}
            </button>
          ))}
        </div>
        <details className="bg-surface-container rounded-xl px-4 py-3 border border-outline-variant">
          <summary className="cursor-pointer text-xs font-bold text-on-surface">
            Tuỳ chỉnh thêm <span className="font-normal text-on-surface-variant">— phong cách ảnh, giới hạn nội dung</span>
          </summary>
          <div className="space-y-3 mt-3">
            <label className="block text-xs font-bold text-on-surface">Phong cách ảnh — bạn tự viết, AI vẽ đúng theo</label>
            <div className="flex flex-wrap gap-2">
              {MAU_PHONG_CACH.map((m) => (
                <button key={m.ten} type="button" onClick={() => setPhongCachAnh(m.mota)} className={nut(phongCachAnh === m.mota)}>
                  {m.ten}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setPhongCachAnh('');
                  oPhongCachRef.current?.focus();
                }}
                className={nut(laPhongCachRieng)}
              >
                Phong cách tuỳ chỉnh
              </button>
            </div>
            <textarea
              ref={oPhongCachRef}
              rows={3}
              value={phongCachAnh}
              onChange={(e) => setPhongCachAnh(e.target.value)}
              placeholder="Ví dụ: ảnh quảng cáo sang trọng, nền tối, ánh sáng viền, màu vàng đồng…"
              className="bg-surface-container-high w-full rounded-lg border border-outline-variant p-3 text-sm text-on-surface leading-relaxed focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-all resize-none"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-on-surface-variant leading-relaxed flex-1">Phong cách này dùng cho mọi ảnh. Đổi lúc nào cũng được.</p>
              <button
                type="button"
                onClick={luuPhongCachAnh}
                disabled={dangLuuPhongCach || phongCachAnh.trim() === phongCachDaLuu.trim()}
                className="shrink-0 px-3 py-1.5 rounded-lg border border-outline text-on-surface text-xs font-bold hover:border-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {dangLuuPhongCach ? 'Đang lưu…' : phongCachAnh.trim() === phongCachDaLuu.trim() ? 'Đã là mặc định' : 'Lưu làm mặc định'}
              </button>
            </div>
            <LuatNoiDungChon giaTri={luatAnh} onDoi={setLuatAnh} coAnhMau={Boolean(anhMau)} />
          </div>
        </details>
        <p className="text-xs text-on-surface-variant leading-relaxed">
          Ảnh AI vẽ xong tự gắn vào bài (xem ở góc ô Nội dung bài đăng).
          {tienAnhCuoi !== null && (
            <>
              {' '}Ảnh vừa vẽ: <b className="text-primary">{vndAnh(tienAnhCuoi)}</b> ({tienAnhCuoi.toFixed(4)} USD).
            </>
          )}
          {tienAnh > 0 && ` Cả bài: ${vndAnh(tienAnh)} (${tienAnh.toFixed(4)} USD).`}
        </p>
      </section>

      {/* vung-video: mọi "màu chính" bên trong thành hồng tím — cột video đồng nhất một màu. */}
      <section className="vung-video rounded-xl border border-primary/30 p-3 space-y-3 min-w-0">
        <CotDau ten="Lựa chọn video" mo={videoRieng} moTaMo="tạo riêng — bấm Tạo video ở ô prompt" moTaTat="nối với bài — tự tạo video ngắn khi bấm Đăng bài" />
        <XuongContext.Provider value={{ moTa, setMoTa, theoBai: !videoRieng, anhChon, deBai: deBaiVideo, datHanhDong, datVideoTheoBai }}>
          <VideoAiPanel nhung noiDung={deBaiVideo} anhCoSan={anhChon} videoCoSan={videoBai} onGanVaoBai={ganVaoBai} />
        </XuongContext.Provider>
      </section>
      </div>
    </div>
  );
}

/** Đầu mỗi cột lựa chọn: tên + bên đó đang tạo riêng hay nối với bài. Màu theo cột (vung-video đổi primary). */
function CotDau({ ten, mo, moTaMo, moTaTat }: { ten: string; mo: boolean; moTaMo: string; moTaTat: string }) {
  return (
    <p className="text-xs leading-snug">
      <b className="text-primary uppercase tracking-wide">{ten}</b>
      <span className="text-on-surface-variant"> · {mo ? moTaMo : moTaTat}</span>
    </p>
  );
}

/**
 * Công tắc "tạo riêng" của một bên. Bật (đèn sáng, màu của bên) = tạo riêng theo prompt, chỉ khi bấm Tạo.
 * Tắt (đèn tối) = đi theo bài: bấm Đăng bài là tự tạo từ nội dung bài rồi đăng cùng.
 * Bên đang chọn (Ảnh / Video bên dưới) có viền cùng màu để biết ô soạn đang làm cho bên nào.
 */
function CongTac({ ten, mau, dangChon, bat, onDoi }: { ten: string; mau: 'anh' | 'video'; dangChon: boolean; bat: boolean; onDoi: () => void }) {
  const laAnh = mau === 'anh';
  return (
    <div
      className={clsx(
        'flex items-center justify-between gap-2 rounded-lg border px-3 py-2 transition-colors',
        !bat
          ? 'border-outline-variant bg-surface-container'
          : laAnh
            ? dangChon
              ? 'border-primary bg-primary/15 shadow-[0_0_16px_var(--color-primary)]'
              : 'border-primary/50 bg-primary/5'
            : dangChon
              ? 'border-secondary bg-secondary/15 shadow-[0_0_16px_var(--color-secondary)]'
              : 'border-secondary/50 bg-secondary/5'
      )}
    >
      <span className="min-w-0">
        <span className={clsx('block text-xs font-bold', bat ? (laAnh ? 'text-primary' : 'text-secondary') : 'text-on-surface')}>{ten}</span>
        <span className="block text-[11px] text-on-surface-variant leading-snug">
          {bat ? 'Đang mở: tạo theo prompt của bạn' : 'Tắt: nối với bài, tự tạo khi Đăng bài'}
        </span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={bat}
        aria-label={ten}
        onClick={onDoi}
        className={clsx(
          'relative w-12 h-7 rounded-full transition-all shrink-0 border',
          bat
            ? laAnh
              ? 'bg-primary border-primary shadow-[0_0_14px_var(--color-primary)]'
              : 'bg-secondary border-secondary shadow-[0_0_14px_var(--color-secondary)]'
            : 'bg-surface-container-high border-outline-variant'
        )}
      >
        <span className={clsx('absolute top-0.5 w-5 h-5 rounded-full transition-all', bat ? 'left-6 bg-white' : 'left-0.5 bg-on-surface-variant/60')} />
      </button>
    </div>
  );
}
