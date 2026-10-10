import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { HuongDanChonMoHinh } from './HuongDanChonMoHinh';
import { LuatNoiDungChon, type LuatNoiDungGiaTri } from './LuatNoiDungChon';
import { HUONG_TAT, HuongKichBanChon, type HuongKichBanGiaTri } from './HuongKichBanChon';
import { api, ApiError, type ChuTrongVideo, type LuaChonVideo, type MediaItem, type ModelVideo, type ViecVideo } from '../lib/api';
import VideoDaiPanel from './VideoDaiPanel';
import VideoSuaPanel from './VideoSuaPanel';
import VideoTrendPanel from './VideoTrendPanel';
import { ThuVienAnh } from './ThuVienAnh';
import { useDangKyHanhDong, useXuong } from '../lib/xuong';
import { hoiXacNhan } from './HopHoi';

/**
 * Khối "AI tạo video" trong khung soạn bài.
 *
 * Video đắt hơn ảnh nhiều lần và tiền trừ vào tài khoản AI của hệ thống, nên luôn hiện giá và hỏi lại
 * trước khi tạo, danh sách model xếp rẻ tới đắt (chủ dự án 04/10/2026 bỏ công tắc "Bật tạo video AI").
 * Tạo video mất từ 30 giây tới vài phút — máy chủ tự theo dõi, đóng trang giữa
 * chừng cũng không mất video.
 */

/** Tỷ giá chỉ để chủ shop hình dung, số tiền thật tính bằng USD. */
const TY_GIA = 25_500;

const KHUNG: { id: string; ten: string }[] = [
  { id: '9:16', ten: 'Dọc 9:16 (Reels)' },
  { id: '16:9', ten: 'Ngang 16:9' },
  { id: '1:1', ten: 'Vuông 1:1' },
];
// Đủ từ bình dân tới cao cấp nhất mà các mô hình làm được (danh mục nhà cung cấp): H3 2K; Veo 3.1, Seedance 2.0 4K.
const DO_NET = ['480p', '720p', '1080p', '2K', '4K'];

const CHU: { id: ChuTrongVideo; ten: string }[] = [
  { id: 'theo_noi_dung', ten: 'Có chữ theo lời mô tả' },
  { id: 'khong', ten: 'Không có chữ' },
];
const GIAY_NHANH = [5, 8, 10, 15, 30];

/**
 * Kỹ năng video — sắp theo VIỆC người bán cần (chủ dự án 03/10/2026), không theo kỹ thuật.
 * "Từ ảnh tham chiếu" đã gộp vào "Theo kịch bản": ảnh sản phẩm / nhân vật dùng được ở mọi kỹ năng.
 */
type CheDo = 'mot_canh' | 'kich_ban' | 'sua_video' | 'trend';
const CHE_DO: { id: CheDo; ten: string; moTa: string }[] = [
  {
    id: 'mot_canh',
    ten: 'Video ngắn',
    moTa: 'Một lần tạo, rẻ và nhanh: tối đa 30 giây (Wan 3.0, Seedance 2.5), mô hình khác 8–20 giây. Hợp Reels 15–30 giây.',
  },
  {
    id: 'kich_ban',
    ten: 'Theo kịch bản',
    moTa: 'Nhiều cảnh, tới 5 phút: chọn kiểu (quảng cáo, người thật review, phim ngắn), AI viết kịch bản và báo giá trước.',
  },
  { id: 'trend', ten: 'Làm theo video mẫu', moTa: 'AI học công thức của một video đang hot rồi làm video mới cho sản phẩm của bạn' },
  { id: 'sua_video', ten: 'Sửa video có sẵn', moTa: 'Đổi bối cảnh, thêm bớt đồ vật, đổi phong cách cho video bạn đã có' },
];

function tien(usd: number | null): string {
  if (usd === null) return 'chưa rõ giá';
  const vnd = Math.round((usd * TY_GIA) / 500) * 500;
  return `~${vnd.toLocaleString('vi-VN')}đ (${usd.toFixed(2)} USD)`;
}

/** Một nút lựa chọn nhỏ (chip) — cùng kiểu cột ảnh. */
const chip = (chon: boolean) =>
  clsx(
    'px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors',
    chon ? 'border-primary bg-primary/15 text-primary' : 'border-outline-variant bg-surface text-on-surface-variant hover:border-primary/50'
  );

/** Một dòng lựa chọn: nhãn đầu dòng, lựa chọn bên phải (như "Chất lượng:" bên cột ảnh). */
function HangChon({ nhan, goiY, children }: { nhan: string; goiY?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" title={goiY}>
      {/* Cột hẹp (điện thoại): nhãn một dòng riêng phía trên; đủ rộng thì nhãn đứng đầu dòng. */}
      <span className="text-xs text-on-surface-variant w-full @sm:w-20 shrink-0">{nhan}</span>
      {children}
    </div>
  );
}

export default function VideoAiPanel({
  noiDung,
  anhCoSan,
  videoCoSan,
  onGanVaoBai,
  nhung = false,
}: {
  /** Nằm trong Xưởng AI: bỏ khung viền và tiêu đề riêng. */
  nhung?: boolean;
  noiDung: string;
  /** Ảnh đang có trong bài, để chọn làm khung hình mở đầu. */
  anhCoSan: string[];
  /** Video đang có trong bài, để chọn làm video nguồn khi sửa video. */
  videoCoSan: string[];
  onGanVaoBai: (item: MediaItem) => void;
}) {
  const [cheDo, setCheDo] = useState<CheDo>('mot_canh');
  const [mucDichDs, setMucDichDs] = useState<Record<string, string>>({});
  const [mucDich, setMucDich] = useState('khoe_san_pham');
  const [soGiay, setSoGiay] = useState(8);
  const [doNet, setDoNet] = useState('720p');
  const [khung, setKhung] = useState('9:16');
  const [coTieng, setCoTieng] = useState(false);
  // Chữ trong video do người dùng chọn (không cố định) — chủ dự án 03/10/2026.
  const [chuTrongVideo, setChuTrongVideo] = useState<ChuTrongVideo>('theo_noi_dung');
  // Hai luật nội dung người dùng tự bật — ban đầu tắt: không gài gì, lời mô tả quyết định.
  const [luatNoiDung, setLuatNoiDung] = useState<LuatNoiDungGiaTri>({ chanNhanHieuGia: false, chanNguoiThat: false });
  // Trong Xưởng AI: khung mở đầu = ảnh tham chiếu số 1 của ô soạn chung (không có ô chọn ảnh riêng).
  const xuong = useXuong();
  const [anhMoDauRieng, setAnhMoDau] = useState('');
  // Video đi theo bài: chỉ từ nội dung bài, không lấy ảnh tham chiếu của ô prompt (chủ dự án 04/10/2026).
  const anhMoDau = xuong ? (xuong.theoBai ? '' : (xuong.anhChon[0] ?? '')) : anhMoDauRieng;
  // Ảnh lấy từ thư viện để làm khung mở đầu (ngoài ảnh đang có trong bài).
  const [anhThuVien, setAnhThuVien] = useState<string[]>([]);
  const [loiMoTa, setLoiMoTa] = useState('');
  const [huong, setHuong] = useState<HuongKichBanGiaTri>(HUONG_TAT);
  const [tomTat, setTomTat] = useState('');
  const [dangViet, setDangViet] = useState(false);
  const [models, setModels] = useState<ModelVideo[]>([]);
  const [dangTaiModel, setDangTaiModel] = useState(false);
  const [modelChon, setModelChon] = useState('');
  const [dangGui, setDangGui] = useState(false);
  const [viec, setViec] = useState<ViecVideo[]>([]);
  const [loi, setLoi] = useState('');
  const daGan = useRef(new Set<number>());
  // Video tạo trong lần mở này — hiện sẵn; video tạo từ trước gập lại cho cột gọn.
  const vuaTao = useRef(new Set<number>());

  const lc: LuaChonVideo = useMemo(
    () => ({ soGiay, doNet, khung, coTieng, coAnhMoDau: Boolean(anhMoDau), chuTrongVideo, ...luatNoiDung }),
    [soGiay, doNet, khung, coTieng, anhMoDau, chuTrongVideo, luatNoiDung]
  );

  // Danh sách model và giá theo đúng lựa chọn đang chọn.
  useEffect(() => {
    let huy = false;
    const hen = setTimeout(async () => {
      setDangTaiModel(true);
      try {
        const { data } = await api.ai.videoModels(lc);
        if (huy) return;
        setMucDichDs(data.mucDich);
        setModels(data.models);
        // Giữ model đang chọn nếu vẫn làm được; không thì chọn cái rẻ nhất.
        setModelChon((cu) => {
          const conHop = data.models.find((m) => m.id === cu && !m.lyDo);
          return conHop ? cu : (data.models.find((m) => !m.lyDo)?.id ?? '');
        });
      } catch (error) {
        if (!huy) setLoi(error instanceof ApiError ? error.message : 'Chưa tải được danh sách model video');
      } finally {
        if (!huy) setDangTaiModel(false);
      }
    }, 300);
    return () => {
      huy = true;
      clearTimeout(hen);
    };
  }, [lc]);

  // Theo dõi video đang tạo.
  const conDangTao = viec.some((v) => v.trang_thai === 'dang_tao');
  useEffect(() => {
    let huy = false;
    const tai = async () => {
      try {
        const { data } = await api.ai.videoViec();
        if (!huy) setViec(data.filter((v) => !v.la_sua_video));
      } catch {
        /* Lượt sau thử lại. */
      }
    };
    void tai();
    if (!conDangTao) return () => { huy = true; };
    const nhip = setInterval(tai, 10_000);
    return () => {
      huy = true;
      clearInterval(nhip);
    };
  }, [conDangTao]);

  const nhoAiViet = async () => {
    if (dangViet) return;
    if (!noiDung.trim()) {
      setLoi('Viết nội dung bài trước để AI biết video nói về gì.');
      return;
    }
    setLoi('');
    setDangViet(true);
    try {
      const { data } = await api.ai.videoLoiMoTa({
        noiDung,
        mucDich,
        soGiay,
        coAnhMoDau: Boolean(anhMoDau),
        chuTrongVideo,
        chanNhanHieuGia: luatNoiDung.chanNhanHieuGia,
        ...huong,
      });
      setLoiMoTa(data.loiMoTa);
      setTomTat(data.tomTat);
    } catch (error) {
      setLoi(error instanceof ApiError ? error.message : 'AI chưa viết được lời mô tả');
    } finally {
      setDangViet(false);
    }
  };

  const model = models.find((m) => m.id === modelChon);

  const taoVideo = async () => {
    if (dangGui || !model || model.lyDo) return;
    // Trong Xưởng AI: dùng lời nhắc AI đã viết nếu có, không thì dùng thẳng đề bài của ô soạn chung.
    const loiNhac = loiMoTa.trim() || (xuong ? xuong.deBai.trim() : '');
    if (!loiNhac) {
      setLoi(xuong ? 'Viết mô tả ở ô soạn phía trên (hoặc bật "Theo nội dung bài đăng").' : 'Cần lời mô tả video. Bấm "AI viết lời mô tả" hoặc tự viết.');
      return;
    }
    if (
      !(await hoiXacNhan({
        tieuDe: `Tạo video ${soGiay} giây bằng ${model.ten}?`,
        noiDung: `Chi phí ước tính: ${tien(model.giaUocTinh)}.\nTiền bị trừ kể cả khi bạn không dùng video.`,
        nutDongY: 'Tạo video',
        bieuTuong: 'movie',
      }))
    ) {
      return;
    }
    setLoi('');
    setDangGui(true);
    try {
      const { data } = await api.ai.taoVideo({ ...lc, model: model.id, loiMoTa: loiNhac, anhMoDau: anhMoDau || undefined });
      vuaTao.current.add(data.id);
      setViec((truoc) => [data, ...truoc]);
    } catch (error) {
      setLoi(error instanceof ApiError ? error.message : 'Chưa gửi được yêu cầu tạo video');
    } finally {
      setDangGui(false);
    }
  };

  // Trong Xưởng AI nút "Tạo video" nằm ở ô soạn chung — báo lên đó. Video đi theo bài thì ô soạn đóng, không tạo tay.
  const theoBai = Boolean(xuong?.theoBai);
  const khoaTao = dangGui || !model || Boolean(model?.lyDo) || !(loiMoTa.trim() || (xuong && xuong.deBai.trim()));
  const nhanTao = dangGui
    ? 'Đang gửi…'
    : model
      ? `Tạo video — ${tien(model.giaUocTinh)}`
      : 'Chọn model để tạo video';
  useDangKyHanhDong('ngan', cheDo === 'mot_canh' ? { nhan: nhanTao, khoa: khoaTao, dangChay: dangGui } : null, () => void taoVideo());

  // Video theo bài chỉ làm được "Video ngắn" (kịch bản, video mẫu, sửa video cần bạn duyệt từng bước).
  useEffect(() => {
    if (theoBai && cheDo !== 'mot_canh') setCheDo('mot_canh');
  }, [theoBai, cheDo]);
  // Báo thông số video ngắn đang chọn lên Xưởng để nút Đăng bài biết giá và tự tạo đúng như vậy.
  const datTheoBai = xuong?.datVideoTheoBai;
  useEffect(() => {
    datTheoBai?.(
      model && !model.lyDo
        ? { model: model.id, ten: model.ten, gia: model.giaUocTinh, lc, mucDich, huong }
        : null
    );
  });

  const ganVaoBai = (v: ViecVideo) => {
    if (!v.url || daGan.current.has(v.id)) return;
    daGan.current.add(v.id);
    onGanVaoBai({ url: v.url, type: 'video' });
  };

  const viecHien = viec.filter((v) => v.trang_thai === 'dang_tao' || vuaTao.current.has(v.id));
  const viecCu = viec.filter((v) => !viecHien.includes(v));
  const theVideo = (v: ViecVideo) => (
                <div key={v.id} className="bg-surface-container rounded-xl p-3 border border-outline-variant space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-on-surface-variant truncate">
                      {v.model.split('/').pop()} · {v.so_giay}s · {v.do_net} · {v.khung}
                    </span>
                    <span
                      className={clsx(
                        'shrink-0 font-bold',
                        v.trang_thai === 'xong' ? 'text-primary' : v.trang_thai === 'loi' ? 'text-error' : 'text-on-surface'
                      )}
                    >
                      {v.trang_thai === 'xong' ? 'Xong' : v.trang_thai === 'loi' ? 'Lỗi' : 'Đang tạo… (30 giây – vài phút)'}
                    </span>
                  </div>
                  {v.trang_thai === 'xong' && v.url && (
                    <>
                      <video src={v.url} controls playsInline className="w-full max-h-56 rounded-lg bg-black" />
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => ganVaoBai(v)}
                          className="px-3 py-1.5 rounded-lg border border-primary/50 bg-primary/10 text-primary text-xs font-bold hover:bg-primary/20 transition-colors"
                        >
                          Gắn vào bài
                        </button>
                        <a
                          href={v.url}
                          download={`video-ai-${v.id}.mp4`}
                          className="px-3 py-1.5 rounded-lg border border-outline text-on-surface text-xs font-bold hover:border-primary transition-colors"
                        >
                          Tải về máy
                        </a>
                        {v.gia_thuc !== null && (
                          <span className="text-[11px] text-on-surface-variant">
                            Đã tốn {tien(Number(v.gia_thuc))}
                          </span>
                        )}
                      </div>
                    </>
                  )}
                  {v.trang_thai === 'loi' && <p className="text-xs text-error">{v.loi}</p>}
                </div>
  );

  return (
    <div className={nhung ? '' : 'khung-muc mau-tim'}>
      {!nhung && (
        <div className="flex items-center justify-between gap-3 dau-muc">
          <h3 className="tieu-de-muc">AI TẠO VIDEO</h3>
        </div>
      )}

      {loi && (
        <div className="mb-3 text-xs text-error bg-error/10 border border-error/30 rounded-lg px-3 py-2">{loi}</div>
      )}

      {(
        <div className="space-y-3">
          {/* Chế độ — video theo bài chỉ làm "Video ngắn" */}
          {/* Video theo bài: Xưởng đã báo ở trên (chỉ làm Video ngắn) — không lặp lại ở đây. */}
          {theoBai ? null : (<>
          <div className="flex flex-wrap gap-2">
            {CHE_DO.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCheDo(c.id)}
                title={c.moTa}
                className={clsx(
                  'px-3 py-2 rounded-lg text-xs font-bold border transition-colors',
                  cheDo === c.id
                    ? 'border-secondary bg-secondary text-on-secondary-fixed'
                    : 'border-outline-variant bg-surface-container text-on-surface-variant hover:border-secondary/50'
                )}
              >
                {c.ten}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-on-surface-variant">{CHE_DO.find((c) => c.id === cheDo)?.moTa}</p>
          </>)}
          <HuongDanChonMoHinh models={models} />

          {/* Thông số — gọn như cột ảnh: nhãn đầu dòng, lựa chọn bên phải (chủ dự án 04/10/2026: cột video dài gấp 6 cột ảnh).
              Sửa video giữ nguyên khung và độ nét của video nguồn. */}
          {cheDo !== 'sua_video' && (
          <div className="bg-surface-container rounded-xl p-3 border border-outline-variant space-y-2.5">
            {cheDo === 'mot_canh' && (
              <>
                <div>
                  <label className="block text-xs font-bold text-on-surface mb-1.5">
                    Mô hình video — xếp rẻ tới đắt
                    {dangTaiModel && <span className="text-on-surface-variant font-normal"> (đang tính giá…)</span>}
                  </label>
                  <select
                    value={modelChon}
                    onChange={(e) => setModelChon(e.target.value)}
                    aria-label="Mô hình video"
                    className="bg-surface-container-high w-full rounded-lg border border-outline-variant px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-none"
                  >
                    {models.map((m) => (
                      <option key={m.id} value={m.id} disabled={Boolean(m.lyDo)}>
                        {m.ten}
                        {m.phanKhuc ? ` (${m.phanKhuc} · ${m.xepHang})` : ''} — {m.lyDo ? `không chọn được: ${m.lyDo}` : tien(m.giaUocTinh)}
                      </option>
                    ))}
                  </select>
                </div>
                <HangChon nhan="Để làm gì:">
                  <select
                    value={mucDich}
                    onChange={(e) => setMucDich(e.target.value)}
                    aria-label="Video để làm gì"
                    title={mucDichDs[mucDich]}
                    className="bg-surface-container-high rounded-lg border border-outline-variant px-2 py-1.5 text-xs font-bold text-on-surface focus:border-primary focus:outline-none"
                  >
                    {(Object.entries(mucDichDs) as [string, string][]).map(([id, moTa]) => (
                      <option key={id} value={id}>
                        {moTa.split(':')[0].replace(/^./, (c) => c.toUpperCase())}
                      </option>
                    ))}
                  </select>
                </HangChon>
                <HangChon nhan="Độ dài:" goiY='Mỗi mô hình có số giây tối đa riêng — xem "Hướng dẫn chọn kỹ năng và mô hình".'>
                  {GIAY_NHANH.map((g) => (
                    <button key={g} type="button" onClick={() => setSoGiay(g)} className={chip(soGiay === g)}>
                      {g}s
                    </button>
                  ))}
                  <input
                    type="number"
                    min={2}
                    max={30}
                    value={soGiay}
                    onChange={(e) => {
                      const n = Math.round(Number(e.target.value));
                      if (Number.isFinite(n)) setSoGiay(Math.min(30, Math.max(2, n)));
                    }}
                    className="bg-surface-container-high w-16 rounded-lg border border-outline-variant px-2 py-1 text-xs text-on-surface focus:border-primary focus:outline-none"
                    aria-label="Số giây tuỳ chọn"
                  />
                </HangChon>
              </>
            )}
            <HangChon nhan="Độ nét:">
              {DO_NET.map((d) => (
                <button key={d} type="button" onClick={() => setDoNet(d)} className={chip(doNet === d)}>
                  {d}
                </button>
              ))}
            </HangChon>
            <HangChon nhan="Khung:">
              {KHUNG.map((k) => (
                <button key={k.id} type="button" onClick={() => setKhung(k.id)} className={chip(khung === k.id)}>
                  {k.ten}
                </button>
              ))}
            </HangChon>
            <label className="flex items-center gap-2 text-xs text-on-surface cursor-pointer">
              <input type="checkbox" checked={coTieng} onChange={(e) => setCoTieng(e.target.checked)} />
              Có âm thanh do AI tạo (thường đắt hơn; tắt đi rồi ghép nhạc khi đăng sẽ rẻ hơn)
            </label>
            {/* Cảnh báo màu cam: điều đã đo thật / tài liệu hãng ghi (vd. Wan 3.0 luôn có tiếng). */}
            {cheDo === 'mot_canh' && model?.ghiChu && <p className="text-[11px] text-orange-400">{model.ten}: {model.ghiChu}</p>}
            {cheDo === 'mot_canh' && model && !model.lyDo && (
              <p className="text-xs text-on-surface-variant">
                Giá mỗi video: <b className="text-primary">{tien(model.giaUocTinh)}</b>
              </p>
            )}
            {/* Video theo kịch bản / video mẫu có chữ và giới hạn nội dung riêng trong "Tuỳ chỉnh thêm" của chúng. */}
            {cheDo === 'mot_canh' && (
              <details className="rounded-lg border border-outline-variant px-3 py-2">
                <summary className="cursor-pointer text-xs font-bold text-on-surface">
                  Tuỳ chỉnh thêm{' '}
                  <span className="font-normal text-on-surface-variant">
                    — {CHU.find((c) => c.id === chuTrongVideo)?.ten.toLowerCase()}, giới hạn nội dung{theoBai ? ', hướng video' : ''}
                  </span>
                </summary>
                <div className="space-y-3 mt-3">
                  <HangChon nhan="Chữ trong video:">
                    {CHU.map((c) => (
                      <button key={c.id} type="button" onClick={() => setChuTrongVideo(c.id)} className={chip(chuTrongVideo === c.id)}>
                        {c.ten}
                      </button>
                    ))}
                  </HangChon>
                  <LuatNoiDungChon giaTri={luatNoiDung} onDoi={setLuatNoiDung} />
                  {/* Theo bài không có lời nhắc tay — hướng video (không bắt buộc) nằm ở đây. */}
                  {theoBai && <HuongKichBanChon giaTri={huong} onDoi={setHuong} />}
                </div>
              </details>
            )}
          </div>

          )}

          {cheDo === 'sua_video' && <VideoSuaPanel videoCoSan={videoCoSan} onGanVaoBai={onGanVaoBai} />}
          {cheDo === 'trend' && (
            <VideoTrendPanel
              noiDung={noiDung}
              anhCoSan={anhCoSan}
              doNet={doNet}
              khung={khung}
              coTieng={coTieng}
              onGanVaoBai={onGanVaoBai}
            />
          )}

          {cheDo === 'kich_ban' && (
            <div key={cheDo}>
            <VideoDaiPanel
              loai={cheDo}
              noiDung={noiDung}
              anhCoSan={anhCoSan}
              doNet={doNet}
              khung={khung}
              coTieng={coTieng}
              onGanVaoBai={onGanVaoBai}
            />
            </div>
          )}

          {cheDo === 'mot_canh' && (<>
          {/* Ảnh mở đầu — trong Xưởng AI thì lấy ảnh tham chiếu số 1 của ô soạn chung, không có ô riêng */}
          {xuong ? (
            !theoBai && <p className="text-[11px] text-on-surface-variant px-1">
              {anhMoDau
                ? 'Khung mở đầu: ảnh tham chiếu số 1 ở ô soạn phía trên — video sẽ bám đúng sản phẩm thật. Ảnh vuông thì nhiều mô hình ra video vuông.'
                : 'Chưa chọn ảnh tham chiếu: AI tự vẽ cảnh từ mô tả. Chọn ảnh sản phẩm ở ô soạn phía trên để video bám đúng hàng thật.'}
            </p>
          ) : (
          <div className="bg-surface-container rounded-xl p-4 border border-outline-variant space-y-2">
            <label className="block text-xs font-bold text-on-surface">
              Ảnh sản phẩm làm khung mở đầu — video sẽ bám đúng sản phẩm thật
            </label>
            {/*
              Đã đo: ảnh mở đầu vuông + chọn khung 9:16 → Seedance trả video vuông
              640×640. Model giữ tỷ lệ của ảnh, nên phải nói trước với chủ shop.
            */}
            <p className="text-[11px] text-on-surface-variant leading-relaxed">
              Nhiều model giữ đúng tỷ lệ của ảnh mở đầu: ảnh vuông ra video vuông. Muốn video dọc cho
              Reels thì chọn ảnh dọc.
            </p>
            {anhCoSan.length + anhThuVien.length === 0 ? (
              <p className="text-xs text-on-surface-variant">
                Chưa có ảnh trong bài. Thêm ảnh sản phẩm ở phần ảnh phía trên, hoặc lấy từ thư viện bên dưới.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setAnhMoDau('')}
                  className={clsx(
                    'w-16 h-16 rounded-lg border-2 text-[11px] font-bold',
                    !anhMoDau ? 'border-primary text-primary' : 'border-outline-variant text-on-surface-variant'
                  )}
                >
                  Không dùng
                </button>
                {[...anhCoSan, ...anhThuVien.filter((u) => !anhCoSan.includes(u))].map((u) => (
                  <button key={u} type="button" onClick={() => setAnhMoDau(u)} className="shrink-0">
                    <img
                      src={u}
                      alt=""
                      className={clsx(
                        'w-16 h-16 rounded-lg object-cover border-2',
                        anhMoDau === u ? 'border-primary' : 'border-transparent opacity-70 hover:opacity-100'
                      )}
                    />
                  </button>
                ))}
              </div>
            )}
            <ThuVienAnh
              onDung={(url) => {
                setAnhThuVien((cu) => [...cu, url]);
                setAnhMoDau(url);
              }}
            />
          </div>
          )}

          {/* Lời mô tả — trong Xưởng AI: đề bài là ô soạn chung; AI chỉ viết lại thành lời nhắc video (tuỳ chọn).
              Video đi theo bài: không có lời nhắc tay (tránh vừa theo bài vừa theo prompt) — chỉ còn hướng video. */}
          {/* Trong Xưởng: lời nhắc là phần thêm, không bắt buộc → gập lại (mở sẵn khi đã có lời nhắc). */}
          {theoBai ? null : (
          <details
            open={!xuong || Boolean(loiMoTa) || undefined}
            className="bg-surface-container rounded-xl px-3 py-2.5 border border-outline-variant"
          >
            <summary className="cursor-pointer text-xs font-bold text-on-surface">
              {xuong ? (
                <>
                  Lời nhắc &amp; hướng video <span className="font-normal text-on-surface-variant">— không bắt buộc, AI viết lại cho chuẩn</span>
                </>
              ) : (
                'Lời mô tả video'
              )}
            </summary>
            <div className="space-y-2 mt-2.5">
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={nhoAiViet}
                disabled={dangViet || !noiDung.trim()}
                title={!noiDung.trim() ? 'Cần nội dung bài viết' : undefined}
                className="shrink-0 px-3 py-1.5 rounded-lg border border-primary/50 bg-primary/10 text-primary text-xs font-bold flex items-center gap-1.5 hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className={clsx('material-symbols-outlined text-[16px]', dangViet && 'animate-spin')}>
                  {dangViet ? 'progress_activity' : 'edit_note'}
                </span>
                {dangViet ? 'Đang viết…' : xuong ? 'AI viết lại thành lời nhắc video' : 'AI viết lời mô tả'}
              </button>
            </div>
            <HuongKichBanChon giaTri={huong} onDoi={setHuong} />
            {tomTat && <p className="text-xs text-primary leading-relaxed">Video sẽ là: {tomTat}</p>}
            {xuong && !loiMoTa ? (
              <p className="text-[11px] text-on-surface-variant leading-relaxed">
                Bỏ qua bước này thì video tạo thẳng từ ô soạn phía trên. Bấm "AI viết lại" để AI chuyển đề bài thành lời nhắc
                video chuẩn (tiếng Anh, tả cảnh, máy quay, ánh sáng) — xem và sửa được trước khi tạo.
              </p>
            ) : (
              <>
                <textarea
                  rows={4}
                  value={loiMoTa}
                  onChange={(e) => setLoiMoTa(e.target.value)}
                  placeholder="Bấm 'AI viết lời mô tả' để AI viết từ nội dung bài, hoặc tự mô tả cảnh bạn muốn…"
                  className="bg-surface-container-high w-full rounded-lg border border-outline-variant p-3 text-sm text-on-surface leading-relaxed focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-all resize-none"
                />
                <p className="text-[11px] text-on-surface-variant leading-relaxed">
                  AI viết bằng tiếng Anh vì các model video hiểu tiếng Anh chính xác nhất.
                  {xuong && (
                    <>
                      {' '}
                      <button type="button" onClick={() => setLoiMoTa('')} className="underline hover:text-on-surface">
                        Bỏ lời nhắc này, tạo thẳng từ ô soạn
                      </button>
                    </>
                  )}
                </p>
              </>
            )}
            </div>
          </details>
          )}

          {/* Trong Xưởng nút tạo nằm trong ô prompt — không lặp ở cuối cột. */}
          {!xuong && <button
            type="button"
            onClick={taoVideo}
            disabled={khoaTao}
            className="w-full py-3 rounded-lg bg-primary text-on-primary text-sm font-bold flex items-center justify-center gap-2 hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className={clsx('material-symbols-outlined text-[18px]', dangGui && 'animate-spin')}>
              {dangGui ? 'progress_activity' : 'movie'}
            </span>
            {nhanTao}
          </button>}

          {/* Video đã tạo: đang tạo / vừa tạo trong lần này hiện sẵn; video tạo từ trước gập vào "Video đã tạo trước đây". */}
          {viec.length > 0 && (
            <div className="space-y-2">
              {viecHien.length > 0 && <label className="block text-xs font-bold text-on-surface">Video vừa tạo</label>}
              {/*
                Meta tự nhận ra video AI qua dấu hiệu nhúng trong tệp và gắn nhãn
                "Thông tin AI". Máy chủ giữ nguyên tệp gốc, không nén lại, nên dấu
                hiệu đó còn nguyên — đúng quy định minh bạch của nền tảng.
              */}
              <p className="text-[11px] text-on-surface-variant leading-relaxed">
                Facebook có thể tự gắn nhãn "Thông tin AI" cho video AI — nhãn chỉ để minh bạch, không
                làm giảm tiếp cận. Đừng dùng video AI để giả người thật hay đánh lừa khách.
              </p>
              {viecHien.map(theVideo)}
              {viecCu.length > 0 && (
                <details className="rounded-lg border border-outline-variant px-3 py-2">
                  <summary className="cursor-pointer text-xs font-bold text-on-surface">Video đã tạo trước đây ({viecCu.length})</summary>
                  <div className="space-y-2 mt-2">{viecCu.map(theVideo)}</div>
                </details>
              )}
            </div>
          )}
          </>)}
        </div>
      )}
    </div>
  );
}
