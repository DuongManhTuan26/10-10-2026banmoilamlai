import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { XuongAi, type KeHoachDang } from '../components/XuongAi';
import { vndAnh } from '../components/ChonMoHinhAnh';
import { hoiNhap, hoiXacNhan } from '../components/HopHoi';

/** Giá video làm tròn 500đ — khớp đúng số hiện ở phần video của Xưởng AI. */
const vndVideo = (usd: number | null) =>
  usd === null ? 'chưa rõ giá' : `~${(Math.round((usd * 25_500) / 500) * 500).toLocaleString('vi-VN')}đ`;
import { clsx } from 'clsx';
import AITrainingModal from '../components/AITrainingModal';
import AutoPilotPanel from '../components/AutoPilotPanel';
import {
  api, ApiError, POST_STATUS_LABELS,
  type Post, type PostStatus, type MediaItem,
} from '../lib/api';
import { useActivePage } from '../lib/ActivePage';
import { gioiHanChatNhat, kenhMacDinh, tinhKenhSeDang, type CheDoKenh } from '../lib/gioi-han-kenh';
import ChonKenhDang from '../components/ChonKenhDang';
import HopThoai, { NUT_CANH_BAO, NUT_CHINH, NUT_PHU } from '../components/HopThoai';

/** Nhãn tab -> trạng thái trong database. */
const FILTER_TO_STATUS: Record<string, PostStatus> = {
  'Chờ duyệt': 'pending_approval',
  'Đã lên lịch': 'scheduled',
  'Đã đăng': 'published',
  'Bản nháp': 'draft',
};

/**
 * Hai trạng thái KHÔNG thuộc tab nào ở trên: 'publishing' (đang đăng, hoặc đã
 * gửi đi mà chưa rõ kết quả) và 'failed' (đăng lỗi).
 *
 * Trước đây bài rơi vào hai trạng thái này biến mất khỏi màn hình: không tab
 * nào chứa, chủ shop không thấy, không biết bài mình vừa bấm đăng đi đâu.
 * Gom vào một tab riêng chỉ hiện khi thật sự có bài như vậy.
 */
const CAN_XU_LY: PostStatus[] = ['publishing', 'failed'];

/**
 * `trongKhuon`: trang đang nằm trong thẻ "Đang làm" của khuôn khối não (KhuonAi) — đầu khuôn đã có tên AI, trang khối não
 * và thẻ "Hướng dẫn AI", nên ẩn tiêu đề và nút vai trò riêng của trang để không lặp hai lần.
 */
export default function Content({ trongKhuon = false }: { trongKhuon?: boolean } = {}) {
  const { accounts, activeAccountId, activeTrangId } = useActivePage();

  const [activeFilter, setActiveFilter] = useState('Chờ duyệt (0)');
  const [postMode, setPostMode] = useState<'manual' | 'auto'>('manual');
  const [showAutoConfirm, setShowAutoConfirm] = useState(false);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [isTrainingOpen, setIsTrainingOpen] = useState(false);

  // Trạng thái ô soạn bài
  const [composerTopic, setComposerTopic] = useState('');
  const [composerGoal, setComposerGoal] = useState<'sales' | 'engagement' | 'announcement'>('sales');
  const [composerContent, setComposerContent] = useState('');
  /*
   * Chọn kênh NGAY TRONG hộp soạn bài, và chọn trước khi viết.
   *
   * Trước đây kênh đích lấy ngầm theo ô chọn trang ở thanh trên — chủ shop
   * không hề biết bài sẽ bay đi đâu. Bài 40 và 41 vì thế gửi sang TikTok trong
   * khi chủ shop tưởng đang đăng lên Fanpage.
   */
  /*
   * Phong cách vẽ ảnh do chủ shop điều khiển, đổi lúc nào cũng được.
   *
   * Bản trước tôi ép sẵn "ảnh chụp đời thường, bối cảnh Việt Nam" trong mã, và
   * ảnh ra phẳng lì không hút mắt. Phong cách là việc của người bán, không
   * phải của người viết mã.
   */
  // Chữ trong ảnh do người dùng chọn — không cố định (chủ dự án 03/10/2026).
  /** Ảnh mẫu: AI vẽ lại chính ảnh đó theo phong cách mới, giữ nguyên chủ thể. */
  const [cheDoKenh, setCheDoKenh] = useState<CheDoKenh>('tu-chon');
  const [kenhTuChon, setKenhTuChon] = useState<string[]>([]);
  const [composerMode, setComposerMode] = useState<'now' | 'schedule'>('now');
  /*
   * Ngày và giờ hẹn đăng.
   *
   * Hai ô này trước đây KHÔNG nối vào đâu cả — gõ gì cũng không ai đọc, còn mã
   * thì hẹn cứng "sau 24 giờ". Chủ shop chọn 8 giờ sáng mai mà bài lại hẹn vào
   * đúng giờ này ngày mai.
   */
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [aiOptions, setAiOptions] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [editingPostId, setEditingPostId] = useState<number | null>(null);
  /*
   * Giữ cả bài đang sửa, không chỉ mã bài.
   *
   * Bài ĐÃ ĐĂNG sửa khác hẳn bài chưa đăng: nền tảng chỉ cho đổi phần chữ,
   * không cho đổi ảnh. Phải biết trạng thái mới hiện đúng nút và đúng lời nhắc.
   */
  const [baiDangSua, setBaiDangSua] = useState<Post | null>(null);
  const [dangGoBai, setDangGoBai] = useState(false);
  const [composerMedia, setComposerMedia] = useState<MediaItem[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  /*
   * Khoá nút trong lúc đang gửi.
   *
   * Thiếu chốt này đã gây hậu quả thật: đăng bài mất vài giây gọi sang Zernio,
   * màn hình KHÔNG báo gì, chủ shop tưởng nút kẹt nên bấm liên tục — mỗi lần
   * bấm tạo một bài mới. Kết quả: 18 bài trong hai giây, 17 bài lỗi.
   */
  const [dangGuiBai, setDangGuiBai] = useState(false);
  // Xưởng AI báo: đăng bài thì tự tạo ảnh / video theo bài (bên nào đang đi theo bài) và giá.
  const [keHoachXuong, setKeHoachXuong] = useState<KeHoachDang | null>(null);
  const [buocDang, setBuocDang] = useState('');
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [dbPosts, setDbPosts] = useState<Post[]>([]);
  const [busyPostId, setBusyPostId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const fetchPosts = useCallback(async () => {
    try {
      const { data } = await api.posts.list();
      setDbPosts(data);
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'Không tải được danh sách bài');
    }
  }, []);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);


  /**
   * Chế độ đăng bài được lưu vào cấu hình AI, không giữ trong bộ nhớ trang.
   * Nếu chỉ giữ tại đây thì tải lại trang là mất, và tiến trình nền không
   * biết chủ shop có cho phép AI tự đăng hay không.
   */
  useEffect(() => {
    api.ai.config('content')
      .then(({ data }) => {
        if (data.config.settings?.autoPublish === true) setPostMode('auto');
      })
      .catch(() => { /* chưa có cấu hình thì dùng mặc định an toàn */ });
  /*
   * Phụ thuộc activeAccountId dù thân hàm không nhắc tới nó: bộ não AI gắn
   * theo Trang, và lớp gọi API tự đính Trang đang chọn vào từng lệnh. Đổi
   * Trang mà không nạp lại thì màn hình vẫn vẽ não của Trang cũ, chủ shop gõ
   * tiếp lên đó là ghi nhầm sang Trang khác.
   *
   * Kèm cả activeTrangId vì đổi Fanpage cho một kênh thì mã kênh GIỮ NGUYÊN,
   * chỉ trang_id đổi — trông mỗi activeAccountId là không thấy gì thay đổi.
   */
  }, [activeAccountId, activeTrangId]);

  const savePostMode = async (mode: 'manual' | 'auto') => {
    const truoc = postMode;
    setPostMode(mode);
    try {
      /*
       * Ghi thẳng một khoá, không đọc-rồi-ghi-đè cả bản ghi.
       *
       * Cách cũ tải cấu hình về rồi PUT lại toàn bộ: nếu chủ shop đang lưu lời
       * vai trò ở màn hình Vai trò AI cùng lúc thì bên nào ghi sau sẽ xoá
       * công của bên kia.
       */
      await api.ai.patchSettings('content', { autoPublish: mode === 'auto' });
    } catch (error) {
      // Không lưu được thì trả thẻ về đúng sự thật, đừng để nó sáng giả.
      setPostMode(truoc);
      setErrorMessage(error instanceof ApiError ? error.message : 'Không lưu được chế độ đăng bài');
    }
  };

  /** Kênh sẽ đăng: trang đang chọn, hoặc mọi kênh đăng được nếu đang xem tất cả. */
  const targetAccountIds = activeAccountId
    ? [activeAccountId]
    : accounts.filter((a) => a.connected).map((a) => a.id);

  /* Kênh đăng được: chỉ những kênh đang thật sự kết nối. */
  const kenhKetNoi = accounts.filter((a) => a.connected);

  /** Đang gõ phong cách của riêng mình, không phải một mẫu dựng sẵn. */

  /* Kênh mà bài trong hộp soạn sẽ thật sự lên — do chính hộp soạn quyết định. */
  const kenhSeDang = tinhKenhSeDang(kenhKetNoi, cheDoKenh, kenhTuChon);
  const targetAccountIdsSoanBai = kenhSeDang.map((a) => a.id);
  const daChonKenh = kenhSeDang.length > 0;
  // Xưởng AI chỉ có ở bài chưa đăng, sau khi đã chọn kênh (bài đã đăng chỉ sửa được chữ).
  const coXuong = daChonKenh && baiDangSua?.status !== 'published';

  /*
   * Giới hạn lấy theo kênh KHÓ TÍNH NHẤT trong số đang chọn.
   *
   * Hệ thống gửi một lệnh chung cho mọi kênh: một kênh từ chối là cả lệnh
   * hỏng, các kênh còn lại cũng không nhận được gì.
   */
  const gioiHan = gioiHanChatNhat(kenhSeDang.map((a) => a.platform));
  const soKyTu = composerContent.trim().length;
  const vuotGioiHan = gioiHan !== null && soKyTu > gioiHan.soKyTu;

  const runAction = async (id: number, action: () => Promise<unknown>) => {
    setBusyPostId(id);
    setErrorMessage('');
    try {
      await action();
      await fetchPosts();
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'Thao tác thất bại');
    } finally {
      setBusyPostId(null);
    }
  };

  /** Duyệt rồi đăng thật lên nền tảng. */
  const handleApprove = (id: number) =>
    runAction(id, async () => {
      if (targetAccountIds.length === 0) {
        throw new ApiError('Chưa có kênh nào được kết nối để đăng bài.', 409);
      }
      await api.posts.update(id, { targetAccountIds });
      await api.posts.publish(id);
    });

  const handleSchedule = async (id: number, current?: string | null) => {
    // Gợi ý theo GIỜ MÁY (bản cũ dùng toISOString → giờ UTC, lệch 7 tiếng so với câu hỏi "theo giờ trên máy bạn").
    const goc = current ? new Date(current) : new Date(Date.now() + 3600000);
    const suggestion = new Date(goc.getTime() - goc.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const input = await hoiNhap({
      tieuDe: 'Hẹn giờ đăng bài',
      noiDung: 'Nhập thời gian đăng theo dạng NĂM-THÁNG-NGÀYTGIỜ:PHÚT, theo giờ trên máy bạn.',
      nhan: 'Thời gian đăng',
      macDinh: suggestion,
      nutDongY: 'Hẹn giờ',
      bieuTuong: 'schedule',
      kiemTra: (v) => {
        const t = new Date(v.trim());
        if (Number.isNaN(t.getTime())) return 'Thời gian không hợp lệ (vd. 2026-10-05T09:30).';
        return t.getTime() <= Date.now() ? 'Thời gian hẹn đăng phải ở tương lai.' : null;
      },
    });
    if (!input) return;
    const when = new Date(input);
    if (Number.isNaN(when.getTime())) {
      setErrorMessage('Thời gian không hợp lệ.');
      return;
    }
    if (when.getTime() <= Date.now()) {
      setErrorMessage('Thời gian hẹn đăng phải ở tương lai.');
      return;
    }
    return runAction(id, () =>
      api.posts.update(id, {
        status: 'scheduled',
        scheduledFor: when.toISOString(),
        targetAccountIds,
      })
    );
  };

  /** Huỷ lịch: đưa bài về chờ duyệt và xoá thời gian hẹn. */
  const handleCancelSchedule = (id: number) =>
    runAction(id, () =>
      api.posts.update(id, { status: 'pending_approval', scheduledFor: null })
    );

  const handleDelete = async (id: number) => {
    if (!(await hoiXacNhan({ tieuDe: 'Xoá bài này?', nutDongY: 'Xoá', nguyHiem: true }))) return;
    return runAction(id, () => api.posts.remove(id));
  };

  /*
   * Gieo lựa chọn kênh khi mở hộp soạn.
   *
   * Đang đứng ở một trang cụ thể thì mặc định đúng trang đó, đang ở "Tất cả
   * trang" thì mặc định mọi kênh. Chủ shop vẫn đổi lại được ngay trong hộp.
   */
  const gieoChonKenh = () => {
    setCheDoKenh('tu-chon');
    // Đang đứng ở một trang cụ thể thì đúng trang đó; ngược lại lấy kênh chính
    // (Fanpage và Instagram) — nơi khách nhắn tin và ra đơn.
    setKenhTuChon(activeAccountId ? [activeAccountId] : kenhMacDinh(kenhKetNoi));
  };

  const moHopSoanBai = () => {
    gieoChonKenh();
    setIsComposerOpen(true);
  };

  const doiChonKenh = (id: string) => {
    setKenhTuChon((truoc) =>
      truoc.includes(id) ? truoc.filter((x) => x !== id) : [...truoc, id]
    );
  };

  const handleEditPost = (post: Post) => {
    setEditingPostId(post.id);
    setBaiDangSua(post);
    gieoChonKenh();
    setComposerContent(post.content);
    setComposerTopic(post.ai_prompt ?? '');
    setComposerMedia(Array.isArray(post.media) ? post.media : []);
    setAiOptions([]);
    setIsComposerOpen(true);
  };

  /** Mở bài đã đăng trên chính nền tảng. */
  const handleOpenOnPlatform = (post: Post) => {
    const url = Object.values(post.platform_urls ?? {}).find(
      (value) => typeof value === 'string' && value.startsWith('http')
    );
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
    else setErrorMessage('Chưa có đường dẫn bài viết trên nền tảng.');
  };

  /**
   * Tải ảnh/video lên Zernio.
   *
   * Tải từng tệp một chứ không song song: chủ shop chọn nhiều ảnh từ điện thoại
   * là chuyện thường, và mỗi lần tải là một lượt gọi Zernio — bắn cùng lúc sẽ
   * ăn vào hạn mức tốc độ dùng chung với việc trả lời khách.
   */
  const handleFilesChosen = async (files: FileList | File[]) => {
    const chosen = Array.from(files);
    if (chosen.length === 0) return;

    setErrorMessage('');
    setUploadingCount(chosen.length);

    try {
      for (const file of chosen) {
        const item = await api.posts.uploadMedia(file);
        setComposerMedia((current) => [...current, item]);
        setUploadingCount((count) => count - 1);
      }
    } catch (error) {
      setErrorMessage(
        error instanceof ApiError ? error.message : 'Không tải được ảnh lên',
      );
    } finally {
      setUploadingCount(0);
    }
  };

  /**
   * Hỏi lại nền tảng về một bài đang treo.
   *
   * KHÔNG phải nút đăng lại. Bài treo là bài "chưa rõ kết quả" — có thể đã lên
   * Fanpage rồi mà mình chưa biết. Bấm đăng lại ở trạng thái đó là cách chắc
   * chắn nhất để có hai bài giống hệt nhau.
   */
  const handleRecheck = (id: number) =>
    runAction(id, async () => {
      const { data } = await api.posts.recheck(id);
      if (!data.found) {
        setErrorMessage(data.message ?? 'Bài chưa lên nền tảng, bạn có thể đăng lại.');
      }
    });

  /**
   * Thời điểm hẹn đăng, lấy từ ĐÚNG hai ô chủ shop chọn.
   *
   * Trả về null nếu chọn "đăng ngay". Ném lỗi nếu chọn hẹn giờ mà thiếu hoặc
   * chọn vào quá khứ — thà báo rõ còn hơn âm thầm hẹn sai giờ.
   */
  const layThoiDiemHen = (): string | null => {
    if (composerMode !== 'schedule') return null;
    if (!scheduleDate || !scheduleTime) {
      throw new ApiError('Vui lòng chọn cả ngày và giờ đăng.', 400);
    }
    const khi = new Date(`${scheduleDate}T${scheduleTime}`);
    if (Number.isNaN(khi.getTime())) {
      throw new ApiError('Ngày giờ không hợp lệ.', 400);
    }
    if (khi.getTime() <= Date.now()) {
      throw new ApiError('Thời gian hẹn đăng phải ở tương lai.', 400);
    }
    return khi.toISOString();
  };

  /**
   * Lưu bài từ ô soạn.
   *
   * Trước đây hai nút "Lưu nháp" và "Đăng bài" cùng chỉ gọi
   * setIsComposerOpen(false) — tức là ĐÓNG HỘP THOẠI và vứt hết. Chủ shop bấm
   * "Đăng bài", hộp đóng lại, Fanpage không có gì, database cũng không có gì.
   *
   * "Đăng bài" chính là sự đồng ý của chủ shop, nên nó đăng thật (hoặc giao
   * lịch cho Zernio), không đưa vào hàng chờ duyệt — hàng chờ duyệt là để cho
   * bài do AI tự viết ở chế độ tự động.
   */
  const luuBaiTuOSoan = async (dang: boolean) => {
    // Chặn lần bấm thứ hai khi lần đầu chưa xong.
    if (dangGuiBai) return;

    const noiDung = composerContent.trim();
    if (!noiDung) {
      setErrorMessage('Chưa có nội dung bài viết. Vui lòng dùng AI để viết, hoặc tự nhập nội dung.');
      return;
    }

    setErrorMessage('');
    setDangGuiBai(true);
    try {
      /*
       * Bài ĐÃ ĐĂNG: cập nhật thẳng phần chữ ra nền tảng.
       *
       * Không đi qua đường tạo bài mới, nếu không Fanpage sẽ có hai bài trùng.
       * Ảnh thì nền tảng không cho đổi — muốn đổi ảnh phải gỡ bài rồi đăng lại.
       */
      if (baiDangSua?.status === 'published' && editingPostId) {
        await api.posts.updateOnPlatform(editingPostId, noiDung);
        setIsComposerOpen(false);
        setEditingPostId(null);
        setBaiDangSua(null);
        setComposerContent('');
        setComposerMedia([]);
        await fetchPosts();
        return;
      }

      const scheduledFor = dang ? layThoiDiemHen() : null;

      if (dang && targetAccountIdsSoanBai.length === 0) {
        setErrorMessage('Vui lòng chọn ít nhất một kênh để đăng bài.');
        return;
      }

      // Vượt giới hạn của kênh khó tính nhất thì nền tảng sẽ từ chối CẢ LỆNH,
      // không kênh nào nhận được bài. Chặn ngay ở đây thay vì để hỏng rồi mới báo.
      if (dang && vuotGioiHan && gioiHan) {
        setErrorMessage(
          `Nội dung dài ${soKyTu.toLocaleString('vi-VN')} ký tự, vượt giới hạn ` +
            `${gioiHan.soKyTu.toLocaleString('vi-VN')} ký tự của ${gioiHan.ten}. ${gioiHan.lyDo} ` +
            `Vui lòng rút ngắn nội dung, hoặc bỏ chọn ${gioiHan.ten} ở Bước 1.`
        );
        return;
      }

      /*
       * Xưởng AI: bên nào đang đi theo bài thì tạo ngay lúc đăng (chủ dự án 04/10/2026).
       * Ảnh vẽ xong trong vài giây → gắn vào bài rồi đăng. Video mất 1–5 phút → bài lưu lại, máy chủ chờ video
       * xong rồi tự đăng (giữ giờ hẹn). Video tốn tiền nên hỏi lại kèm giá trước khi làm bất cứ gì.
       */
      const kh = dang ? keHoachXuong : null;
      if (kh?.loi) {
        setErrorMessage(kh.loi);
        return;
      }
      if (
        kh?.video &&
        !(await hoiXacNhan({
          tieuDe: `Đăng bài kèm video AI (${kh.video.ten}) — ${vndVideo(kh.video.gia)}${kh.anh ? ` và ảnh AI ${vndAnh(kh.anh.gia)}` : ''}?`,
          noiDung:
            `AI tạo video từ nội dung bài, mất khoảng 1–5 phút. Bài tự đăng ngay khi video xong` +
            `${scheduledFor ? ' (vẫn theo giờ đã hẹn)' : ''}. Video lỗi thì bài đăng kèm ảnh thay thế.\n` +
            `Tiền bị trừ kể cả khi bạn không dùng video.`,
          nutDongY: 'Đăng bài kèm video',
          bieuTuong: 'movie',
        }))
      ) {
        return;
      }
      let media = composerMedia;
      if (kh?.anh) {
        setBuocDang('AI đang vẽ ảnh theo bài…');
        const anh = await kh.taoAnh();
        media = [...media, anh];
        setComposerMedia(media);
      }

      const { data: post } = editingPostId
        ? await api.posts.update(editingPostId, {
            content: noiDung,
            targetAccountIds: targetAccountIdsSoanBai,
            media,
            scheduledFor,
            status: kh?.video ? 'draft' : dang ? (scheduledFor ? 'scheduled' : 'pending_approval') : 'draft',
          })
        : await api.posts.create({
            content: noiDung,
            status: kh?.video ? 'draft' : dang ? (scheduledFor ? 'scheduled' : 'pending_approval') : 'draft',
            scheduledFor,
            targetAccountIds: targetAccountIdsSoanBai,
            media,
            aiGenerated: aiOptions.includes(noiDung),
            aiPrompt: composerTopic.trim() || undefined,
          });

      if (kh?.video) {
        // Bài đã lưu (bản nháp) — gửi video không được thì giữ hộp soạn mở, bấm lại sẽ sửa đúng bài này.
        setBuocDang('Đang gửi yêu cầu tạo video…');
        try {
          await kh.guiVideo(post.id);
        } catch (error) {
          setEditingPostId(post.id);
          setBaiDangSua(post);
          setErrorMessage(
            `Đã lưu bài vào Bản nháp nhưng chưa gửi được video: ${error instanceof ApiError ? error.message : 'lỗi không rõ'}`
          );
          return;
        }
      } else if (dang) {
        // Gửi sang Zernio: đăng ngay, hoặc giao lịch cho Zernio tự đăng đúng giờ.
        await api.posts.publish(post.id);
      }

      setIsComposerOpen(false);
      setAiOptions([]);
      setComposerTopic('');
      setComposerContent('');
      setComposerMedia([]);
      setScheduleDate('');
      setScheduleTime('');
      setEditingPostId(null);
      setBaiDangSua(null);
      await fetchPosts();
    } catch (error) {
      setErrorMessage(
        error instanceof ApiError ? error.message : 'Không lưu được bài viết'
      );
    } finally {
      setDangGuiBai(false);
      setBuocDang('');
    }
  };


  /*
   * Gỡ bài khỏi nền tảng để sửa lại rồi đăng mới.
   *
   * Đây là cách DUY NHẤT để thay ảnh của bài đã đăng, vì nền tảng không cho
   * đổi ảnh. Gỡ rồi mất hết lượt thích và bình luận đã có, nên phải hỏi trước.
   */
  const goBaiVeNhap = async (post: Post) => {
    if (dangGoBai) return;
    if (
      !(await hoiXacNhan({
        tieuDe: 'Gỡ bài này khỏi nền tảng để sửa lại?',
        noiDung:
          'Bài sẽ biến mất khỏi trang, mất hết lượt thích và bình luận đã có. ' +
          'Nội dung và ảnh vẫn giữ lại trong ứng dụng để bạn sửa rồi đăng mới.',
        nutDongY: 'Gỡ bài',
        nguyHiem: true,
      }))
    ) {
      return;
    }
    setDangGoBai(true);
    setErrorMessage('');
    try {
      const { data } = await api.posts.unpublish(post.id);
      await fetchPosts();
      handleEditPost(data);
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'Không gỡ được bài trên nền tảng');
    } finally {
      setDangGoBai(false);
    }
  };



  const handleGenerate = async () => {
    if (!composerTopic.trim()) {
      setErrorMessage('Vui lòng nhập chủ đề để AI viết bài.');
      return;
    }
    setIsGenerating(true);
    setErrorMessage('');
    try {
      // Một bài hiệu quả nhất, đổ thẳng vào ô nội dung (chủ dự án 03/10/2026). Ô đang có chữ thì hỏi trước.
      const { options } = await api.ai.generatePost(composerTopic.trim(), composerGoal, 1);
      const bai = options[0]?.trim();
      if (!bai) throw new ApiError('AI chưa viết được bài, thử lại.', 502);
      if (composerContent.trim() && composerContent.trim() !== bai && !(await hoiXacNhan({ tieuDe: 'Thay nội dung đang có bằng bài AI vừa viết?', nutDongY: 'Thay nội dung' }))) return;
      setComposerContent(bai);
      // Giữ để đánh dấu "bài do AI viết" khi lưu.
      setAiOptions([bai]);
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'AI chưa viết được bài');
    } finally {
      setIsGenerating(false);
    }
  };

  /**
   * Lưu bài.
   *
   * "Đăng ngay" phải gọi Zernio thật rồi mới đánh dấu đã đăng. Bản cũ chỉ đổi
   * trạng thái sang "Đã đăng" mà không hề đăng, nên giao diện báo thành công
   * trong khi Fanpage không có bài nào.
   */
  const handleAcceptAiOption = async (optionContent: string) => {
    setErrorMessage('');
    try {
      // Dùng đúng giờ chủ shop chọn. Bản trước hẹn cứng "sau 24 giờ" bất kể
      // họ chọn gì, nên bài luôn lên sai thời điểm.
      const scheduledFor = layThoiDiemHen();

      let post: Post;
      if (editingPostId) {
        const result = await api.posts.update(editingPostId, {
          content: optionContent,
          targetAccountIds,
          media: composerMedia,
        });
        post = result.data;
      } else {
        const result = await api.posts.create({
          content: optionContent,
          status: composerMode === 'schedule' ? 'scheduled' : 'pending_approval',
          scheduledFor,
          targetAccountIds,
          media: composerMedia,
          aiGenerated: aiOptions.includes(optionContent),
          aiPrompt: composerTopic.trim() || undefined,
        });
        post = result.data;
      }

      // Đăng ngay: chỉ tự đăng khi chủ shop đã bật chế độ AI tự đăng.
      // Chế độ chờ duyệt thì bài nằm ở mục chờ duyệt, đúng như mô tả trên thẻ.
      if (composerMode === 'now' && postMode === 'auto') {
        if (targetAccountIds.length === 0) {
          throw new ApiError('Chưa có kênh nào được kết nối để đăng bài.', 409);
        }
        await api.posts.publish(post.id);
      }

      setIsComposerOpen(false);
      setAiOptions([]);
      setComposerTopic('');
      setComposerContent('');
      setComposerMedia([]);
      setEditingPostId(null);
      setBaiDangSua(null);
      await fetchPosts();
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'Không lưu được bài');
    }
  };

  const activeCounts = {
    pending: dbPosts.filter((p) => p.status === 'pending_approval').length,
    scheduled: dbPosts.filter((p) => p.status === 'scheduled').length,
    published: dbPosts.filter((p) => p.status === 'published').length,
    drafts: dbPosts.filter((p) => p.status === 'draft').length,
    canXuLy: dbPosts.filter((p) => CAN_XU_LY.includes(p.status)).length,
  };

  /** Bài đã đăng trong 7 ngày gần nhất. */
  const publishedThisWeek = dbPosts.filter(
    (p) => p.status === 'published' && p.published_at &&
      Date.now() - new Date(p.published_at).getTime() < 7 * 86400000
  ).length;

  /** Tương tác trung bình mỗi bài, tính từ số liệu thật của các bài đã đăng. */
  const avgEngagement = (() => {
    const withStats = dbPosts.filter((p) => p.status === 'published' && p.stats);
    if (withStats.length === 0) return 0;
    const total = withStats.reduce(
      (sum, p) => sum + (p.stats.likes ?? 0) + (p.stats.comments ?? 0) + (p.stats.shares ?? 0),
      0
    );
    return Math.round(total / withStats.length);
  })();

  const FILTERS = [
    `Chờ duyệt (${activeCounts.pending})`,
    `Đã lên lịch (${activeCounts.scheduled})`,
    'Đã đăng',
    'Bản nháp',
    // Chỉ hiện khi có bài đang treo hoặc lỗi, để không thêm tab thừa lúc mọi
    // thứ bình thường.
    ...(activeCounts.canXuLy > 0 ? [`Cần xử lý (${activeCounts.canXuLy})`] : []),
  ];

  const filteredPosts = useMemo(() => {
    if (activeFilter.startsWith('Cần xử lý')) {
      return dbPosts.filter((post) => CAN_XU_LY.includes(post.status));
    }
    const key = Object.keys(FILTER_TO_STATUS).find((label) => activeFilter.startsWith(label));
    const status = key ? FILTER_TO_STATUS[key] : 'draft';
    return dbPosts.filter((post) => post.status === status);
  }, [activeFilter, dbPosts]);

  const getStatusColor = (status: PostStatus) => {
    switch (status) {
      case 'pending_approval': return 'text-yellow-500 bg-yellow-500/20 border-yellow-500/30';
      case 'scheduled': return 'text-blue-500 bg-blue-500/20 border-blue-500/30';
      case 'published': return 'text-green-500 bg-green-500/20 border-green-500/30';
      case 'publishing': return 'text-primary bg-primary/20 border-primary/30';
      case 'failed': return 'text-error bg-error/20 border-error/30';
      default: return 'text-gray-400 bg-gray-500/20 border-gray-500/30';
    }
  };

  const handleAutoModeSelect = () => {
    if (postMode === 'manual') {
      setShowAutoConfirm(true);
    }
  };

  /*
   * Bấm đồng ý trong hộp xác nhận thì phải LƯU, không chỉ đổi màu thẻ.
   *
   * Bản cũ chỉ gọi setPostMode('auto'): thẻ sáng lên "ĐANG ĐƯỢC CHỌN" nhưng
   * không có gì xuống máy chủ, nên tải lại trang là mất, và phía máy chủ vẫn
   * đinh ninh chủ shop đang ở chế độ chờ duyệt. Nhánh "Chờ tôi duyệt" thì lại
   * lưu đúng — chỉ mỗi nhánh này bị bỏ quên.
   */
  const confirmAutoMode = () => {
    setShowAutoConfirm(false);
    void savePostMode('auto');
  };


  return (
    <main className={trongKhuon ? "w-full relative" : "flex-1  p-6 md:p-8 max-w-7xl mx-auto w-full relative"}>

      {/* Lỗi của các thao tác ngoài hộp soạn bài: đăng lại, xoá, duyệt, tải danh sách. */}
      {errorMessage && !isComposerOpen && (
        <div className="mb-6 flex items-start gap-2 text-sm text-error bg-error/10 border border-error/30 rounded-xl px-4 py-3">
          <span className="material-symbols-outlined text-[18px] mt-0.5 shrink-0">error</span>
          <span className="leading-relaxed flex-1">{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage('')}
            className="text-error/70 hover:text-error shrink-0"
            aria-label="Đóng thông báo lỗi"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            {!trongKhuon && <h1 className="font-headline-sm text-3xl font-bold text-on-surface tracking-tight">AI Viết - Đăng Bài</h1>}
            <span className="font-mono text-xs font-bold tracking-wider text-primary bg-primary/10 border border-primary/20 px-2.5 py-1 rounded-full uppercase">
              {activeCounts.pending} BÀI CHỜ DUYỆT
            </span>
          </div>
          <p className="text-on-surface-variant text-sm">AI tự viết bài, bạn duyệt hoặc để AI đăng tự động</p>
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
          <button 
            onClick={moHopSoanBai}
            className="shrink-0 px-4 py-2 bg-primary text-on-primary font-bold rounded-lg hover:scale-105 transition-transform flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            Tạo bài mới
          </button>
        </div>
      </div>

      {/*
        Chế độ đăng cho BÀI BẠN TỰ SOẠN — một dòng, ghi rõ phạm vi. Bài AI tự viết theo lịch cài riêng ở khung bên dưới
        (AutoPilotPanel). Bản cũ là thẻ to không ghi phạm vi nên trông như hai chỗ cài cùng một việc (rà soát lượt 2, T5).
      */}
      <div className="mb-6 flex flex-col md:flex-row md:items-center gap-3 rounded-xl border border-outline-variant bg-surface-container px-4 py-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-on-surface">Bài bạn tự soạn</p>
          <p className="text-xs text-on-surface-variant">
            {postMode === 'manual' ? 'Bấm "Đăng ngay" thì bài vào mục Chờ duyệt, chỉ lên sóng khi bạn duyệt.' : 'Bấm "Đăng ngay" là bài lên sóng luôn, không qua bước duyệt.'}
          </p>
        </div>
        <div className="flex rounded-lg border border-outline-variant overflow-hidden shrink-0" role="radiogroup" aria-label="Chế độ đăng bài tự soạn">
          {([['manual', 'Chờ tôi duyệt'], ['auto', 'Đăng luôn']] as const).map(([ma, ten]) => (
            <button
              key={ma}
              role="radio"
              aria-checked={postMode === ma}
              onClick={() => (ma === 'manual' ? savePostMode('manual') : handleAutoModeSelect())}
              className={clsx('px-4 py-2 text-sm font-bold transition-colors',
                postMode === ma ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-on-surface')}
            >
              {ten}
            </button>
          ))}
        </div>
      </div>

      {/* Lịch AI tự viết và tự đăng — bài AI tự làm theo lịch cài ở đây (khác dòng "Bài bạn tự soạn" ở trên). */}
      <AutoPilotPanel onSaved={fetchPosts} />

      {/* Row 2: Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-surface-container border border-outline-variant rounded-2xl p-5 relative overflow-hidden flex flex-col justify-between group hover:border-primary/50 transition-colors">
          <div>
            <h3 className="tieu-de-muc mb-1">CHỜ DUYỆT</h3>
            <div className="flex items-baseline gap-2">
              <span className="font-headline-sm text-3xl font-bold text-on-surface">{activeCounts.pending}</span>
            </div>
            <p className="text-xs text-on-surface-variant mt-1 font-medium">Cần bạn xem qua</p>
          </div>
        </div>

        <div className="bg-surface-container border border-outline-variant rounded-2xl p-5 relative overflow-hidden flex flex-col justify-between group hover:border-primary/50 transition-colors">
          <div>
            <h3 className="tieu-de-muc mb-1">ĐÃ LÊN LỊCH</h3>
            <div className="flex items-baseline gap-2">
              <span className="font-headline-sm text-3xl font-bold text-on-surface">{activeCounts.scheduled}</span>
            </div>
            <p className="text-xs text-on-surface-variant mt-1 font-medium">Sẽ tự đăng đúng giờ</p>
          </div>
        </div>

        <div className="bg-surface-container border border-outline-variant rounded-2xl p-5 relative overflow-hidden flex flex-col justify-between group hover:border-primary/50 transition-colors">
          <div>
            <h3 className="tieu-de-muc mb-1">ĐÃ ĐĂNG TUẦN NÀY</h3>
            <div className="flex items-baseline gap-2">
              <span className="font-headline-sm text-3xl font-bold text-on-surface">{publishedThisWeek}</span>
            </div>
          </div>
          {activeCounts.published > publishedThisWeek && (
            <div className="flex items-center gap-1.5 text-xs font-bold text-green-400 bg-green-400/10 self-start px-2 py-1 rounded-md mt-auto">
              <span className="material-symbols-outlined text-[14px]">trending_up</span>
              {activeCounts.published} bài tổng cộng
            </div>
          )}
        </div>

        <div className="bg-surface-container border border-outline-variant rounded-2xl p-5 relative overflow-hidden flex flex-col justify-between group hover:border-primary/50 transition-colors">
          <div>
            <h3 className="tieu-de-muc mb-1">TƯƠNG TÁC TRUNG BÌNH</h3>
            <div className="flex items-baseline gap-2">
              <span className="font-headline-sm text-3xl font-bold text-on-surface">{avgEngagement}</span>
            </div>
            <p className="text-xs text-on-surface-variant mt-1 font-medium">
              {activeCounts.published > 0 ? 'Lượt trên mỗi bài' : 'Chưa có bài nào được đăng'}
            </p>
          </div>
        </div>
      </div>

      {/* Row 3: Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {FILTERS.map(filter => {
          const isActive = activeFilter === filter;
          return (
            <button 
              key={filter}
              onClick={() => setActiveFilter(filter)}
              className={clsx(
                "px-4 py-2 rounded-full text-sm font-medium transition-colors border",
                isActive 
                  ? "bg-primary text-on-primary border-primary" 
                  : "bg-surface-container text-on-surface-variant border-outline-variant hover:bg-surface-container hover:text-on-surface"
              )}
            >
              {filter}
            </button>
          );
        })}
      </div>

      {/* Row 4: Posts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {filteredPosts.map(post => (
          <div key={post.id} className="bg-surface-container border border-outline-variant rounded-2xl overflow-hidden flex flex-col group hover:border-primary/30 transition-colors shadow-sm h-full">
            {/* Top Bar */}
            <div className="p-4 flex items-center justify-between border-b border-outline-variant/50">
              <span className={clsx("px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wider border", getStatusColor(post.status))}>
                {/* Bài chờ video AI xong rồi máy chủ tự đăng — duyệt tay lúc này sẽ đăng thiếu video nên ẩn nút duyệt. */}
                {post.cho_video_id ? 'ĐANG TẠO VIDEO AI · XONG TỰ ĐĂNG' : POST_STATUS_LABELS[post.status].toUpperCase()}
              </span>
              {/* Nút thao tác chỉ ở chân thẻ — bản cũ có thêm bộ ✓ ⏱ 🗑 ở đầu thẻ làm đúng việc đó (rà soát lượt 2, T4). */}
            </div>

            {/*
              Ảnh / video THẬT của bài (post.media). Bản cũ đọc `post.platforms === 'has_image'` — trường không tồn tại,
              nên không bài nào hiện ảnh. Liên kết tệp của kho tạm hết hạn sau 7 ngày (api.ts MediaItem): tải hỏng thì ẩn
              khung, không để ô ảnh vỡ.
            */}
            {(() => {
              const m = (Array.isArray(post.media) ? post.media : []).find((x) => x.type === 'image' || x.type === 'gif' || x.type === 'video');
              if (!m) return null;
              const an = (e: React.SyntheticEvent<HTMLElement>) => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; };
              return (
                <div className="h-[180px] flex-none w-full relative overflow-hidden bg-surface-variant">
                  {m.type === 'video'
                    ? <video src={m.url} muted preload="metadata" className="w-full h-full object-cover" onError={an} />
                    : <img src={m.url} alt="" loading="lazy" className="w-full h-full object-cover" onError={an} />}
                  {post.media.length > 1 && (
                    <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-black/60 text-white text-[11px] font-bold">
                      +{post.media.length - 1}
                    </span>
                  )}
                </div>
              );
            })()}

            {/* Content */}
            <div className="p-5 flex-1 flex flex-col">
              <p className="text-sm text-on-surface leading-relaxed line-clamp-4 mb-4">
                {post.content}
              </p>
              
              <div className="space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-medium text-on-surface-variant">
                  <span className="material-symbols-outlined text-[14px] text-primary/80">{post.ai_generated ? 'auto_awesome' : 'edit'}</span>
                  {/* Ai viết theo cờ thật của bài (posts.ai_generated) — bản cũ ghi "AI viết" cho mọi bài, kể cả bài người viết. */}
                  {`${post.ai_generated ? 'AI viết' : 'Bạn viết'} lúc ${new Date(post.created_at).toLocaleTimeString('vi-VN')} ngày ${new Date(post.created_at).toLocaleDateString('vi-VN')}`}
                </div>
                
                <div className="flex items-center gap-1.5 text-xs font-bold text-on-surface">
                  <span className="material-symbols-outlined text-[14px]">schedule</span>
                  {(post.scheduled_for ? `Đăng lúc: ${new Date(post.scheduled_for).toLocaleTimeString('vi-VN')} ${new Date(post.scheduled_for).toLocaleDateString('vi-VN')}` : 'Chưa đặt lịch')}
                </div>

                {post.status === 'published' && post.stats && (
                  <div className="flex items-center gap-4 text-xs font-bold text-on-surface pt-3 border-t border-outline-variant/50">
                    <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[16px] text-primary">thumb_up</span> {post.stats.likes ?? 0}</span>
                    <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[16px] text-primary">chat_bubble</span> {post.stats.comments ?? 0}</span>
                    <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[16px] text-primary">share</span> {post.stats.shares ?? 0}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="p-4 bg-surface-container border-t border-outline-variant/50 flex gap-2 shrink-0 mt-auto">
              {post.status === 'pending_approval' && (
                <>
                  {/* Bài chờ video AI xong rồi máy chủ tự đăng — duyệt tay lúc này sẽ đăng thiếu video nên ẩn nút duyệt. */}
                  {!post.cho_video_id && <button onClick={() => handleApprove(post.id)} disabled={busyPostId === post.id} className="flex-1 py-2 bg-primary text-on-primary font-bold text-xs rounded-lg hover:brightness-110 transition-all shadow-sm disabled:opacity-60">{busyPostId === post.id ? 'Đang đăng…' : 'Duyệt và đăng'}</button>}
                  <button onClick={() => handleEditPost(post)} className="flex-1 py-2 bg-surface-variant text-on-surface font-bold text-xs rounded-lg hover:bg-outline-variant transition-colors border border-outline-variant/50">Sửa</button>
                  <button onClick={() => handleSchedule(post.id)} title="Lên lịch" className="w-9 shrink-0 flex items-center justify-center bg-surface-variant text-on-surface rounded-lg hover:bg-outline-variant transition-colors border border-outline-variant/50">
                    <span className="material-symbols-outlined text-[16px]">schedule</span>
                  </button>
                  <button onClick={() => handleDelete(post.id)} title="Xoá bài" className="w-9 shrink-0 flex items-center justify-center bg-error/10 text-error rounded-lg hover:bg-error/20 transition-colors border border-error/20">
                    <span className="material-symbols-outlined text-[16px]">delete</span>
                  </button>
                </>
              )}
              {post.status === 'scheduled' && (
                <>
                  <button onClick={() => handleSchedule(post.id, post.scheduled_for)} className="flex-1 py-2 bg-surface-variant text-on-surface font-bold text-xs rounded-lg hover:bg-outline-variant transition-colors border border-outline-variant/50">Đổi lịch</button>
                  <button onClick={() => handleCancelSchedule(post.id)} className="flex-1 py-2 bg-surface-variant text-on-surface font-bold text-xs rounded-lg hover:bg-outline-variant transition-colors border border-outline-variant/50">Hủy lịch</button>
                  <button onClick={() => handleEditPost(post)} className="flex-1 py-2 bg-surface-variant text-on-surface font-bold text-xs rounded-lg hover:bg-outline-variant transition-colors border border-outline-variant/50">Sửa</button>
                  <button onClick={() => handleDelete(post.id)} title="Xoá bài" className="w-9 shrink-0 flex items-center justify-center bg-error/10 text-error rounded-lg hover:bg-error/20 transition-colors border border-error/20">
                    <span className="material-symbols-outlined text-[16px]">delete</span>
                  </button>
                </>
              )}
              {post.status === 'published' && (
                <div className="flex flex-col gap-2 w-full">
                  <div className="flex gap-2">
                    {/* Một nút — "Xem bình luận" cũ mở đúng trang này (T4). */}
                    <button onClick={() => handleOpenOnPlatform(post)} className="flex-1 py-2 bg-surface-variant text-on-surface font-bold text-xs rounded-lg hover:bg-outline-variant transition-colors border border-outline-variant/50">Xem bài và bình luận trên nền tảng</button>
                  <button onClick={() => handleDelete(post.id)} title="Xoá bài" className="w-9 shrink-0 flex items-center justify-center bg-error/10 text-error rounded-lg hover:bg-error/20 transition-colors border border-error/20">
                    <span className="material-symbols-outlined text-[16px]">delete</span>
                  </button>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleEditPost(post)} className="flex-1 py-2 bg-primary/10 text-primary font-bold text-xs rounded-lg hover:bg-primary/20 transition-colors border border-primary/30">Sửa chữ</button>
                    <button
                      onClick={() => goBaiVeNhap(post)}
                      disabled={dangGoBai}
                      title="Nền tảng không cho đổi ảnh của bài đã đăng. Gỡ bài rồi đăng lại là cách duy nhất."
                      className="flex-1 py-2 bg-surface-variant text-on-surface font-bold text-xs rounded-lg hover:bg-outline-variant transition-colors border border-outline-variant/50 disabled:opacity-60"
                    >
                      {dangGoBai ? 'Đang gỡ…' : 'Gỡ để sửa ảnh'}
                    </button>
                  </div>
                </div>
              )}

              {/* Bản nháp trước đây không có một nút nào — mở ra rồi bỏ đó. */}
              {post.status === 'draft' && (
                <>
                  <button onClick={() => handleApprove(post.id)} disabled={busyPostId === post.id} className="flex-1 py-2 bg-primary text-on-primary font-bold text-xs rounded-lg hover:brightness-110 transition-all disabled:opacity-60">{busyPostId === post.id ? 'Đang đăng…' : 'Đăng ngay'}</button>
                  <button onClick={() => handleEditPost(post)} className="flex-1 py-2 bg-surface-variant text-on-surface font-bold text-xs rounded-lg hover:bg-outline-variant transition-colors border border-outline-variant/50">Sửa</button>
                  <button onClick={() => handleDelete(post.id)} className="w-9 shrink-0 flex items-center justify-center bg-error/10 text-error rounded-lg hover:bg-error/20 transition-colors border border-error/20">
                    <span className="material-symbols-outlined text-[16px]">delete</span>
                  </button>
                </>
              )}
              {/*
                Bài đang treo: CHỈ cho kiểm tra lại, tuyệt đối không có nút đăng
                lại — bài có thể đã lên Fanpage rồi mà mình chưa biết.
              */}
              {post.status === 'publishing' && (
                <button onClick={() => handleRecheck(post.id)} disabled={busyPostId === post.id} className="flex-1 py-2 bg-primary text-on-primary font-bold text-xs rounded-lg hover:brightness-110 transition-all disabled:opacity-60">
                  {busyPostId === post.id ? 'Đang kiểm tra…' : 'Kiểm tra kết quả thật'}
                </button>
              )}
              {post.status === 'failed' && (
                <>
                  <button onClick={() => handleRecheck(post.id)} disabled={busyPostId === post.id} className="flex-1 py-2 bg-surface-variant text-on-surface font-bold text-xs rounded-lg hover:bg-outline-variant transition-colors border border-outline-variant/50">Kiểm tra lại</button>
                  <button onClick={() => handleApprove(post.id)} disabled={busyPostId === post.id} className="flex-1 py-2 bg-primary text-on-primary font-bold text-xs rounded-lg hover:brightness-110 transition-all disabled:opacity-60">Đăng lại</button>
                  <button onClick={() => handleEditPost(post)} className="flex-1 py-2 bg-surface-variant text-on-surface font-bold text-xs rounded-lg hover:bg-outline-variant transition-colors border border-outline-variant/50">Sửa</button>
                  <button onClick={() => handleDelete(post.id)} className="w-9 shrink-0 flex items-center justify-center bg-error/10 text-error rounded-lg hover:bg-error/20 transition-colors border border-error/20">
                    <span className="material-symbols-outlined text-[16px]">delete</span>
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {filteredPosts.length === 0 && (
        <div className="py-20 text-center flex flex-col items-center border border-dashed border-outline-variant rounded-2xl bg-surface-container">
          <span className="material-symbols-outlined text-4xl text-on-surface-variant mb-3 opacity-50">article</span>
          <p className="text-on-surface-variant font-medium">Không có bài đăng nào trong mục này</p>
        </div>
      )}

      {/* Centered Composer Panel */}
      {isComposerOpen && (
        <HopThoai
          bieuTuong="edit_note"
          tieuDe={baiDangSua?.status === 'published' ? 'Sửa bài đã đăng' : 'Soạn bài đăng'}
          onDong={() => { setIsComposerOpen(false); setAiOptions([]); }}
          dongKhiBamNgoai={false}
          chan={
            <div className="w-full flex flex-col gap-3">
            {/* Footer */}
            {/*
              Báo lỗi phải nằm SÁT hai cái nút.

              Trước đây setErrorMessage được gọi ở 19 chỗ trong trang này mà
              không có một chỗ nào hiển thị ra. Chủ shop bấm "Đăng bài", nền
              tảng từ chối, bài ghi 'failed' trong database — còn màn hình thì
              không đổi gì cả, trông y như nút không ăn. Đã xảy ra thật với bài
              40 và 41: TikTok từ chối vì nội dung 648 ký tự quá mức 90.
            */}
            {errorMessage && (
              <div className="w-full">
                <div className="flex items-start gap-2 text-sm text-error bg-error/10 border border-error/30 rounded-xl px-4 py-3">
                  <span className="material-symbols-outlined text-[18px] mt-0.5 shrink-0">error</span>
                  <span className="leading-relaxed">{errorMessage}</span>
                </div>
              </div>
            )}
            <div className="flex justify-end gap-3">
              {/*
                Bài đã đăng thì không có khái niệm lưu nháp.

                Đừng dùng thuộc tính hidden: lớp flex-1 đặt display:flex và ghi
                đè luôn hidden, nút vẫn hiện ra như thường.
              */}
              {baiDangSua?.status !== 'published' && (
              <button
                onClick={() => luuBaiTuOSoan(false)}
                disabled={dangGuiBai}
                className={clsx(NUT_PHU, 'shrink-0 whitespace-nowrap')}
              >
                Lưu nháp
              </button>
              )}
              <button 
                onClick={() => luuBaiTuOSoan(true)}
                // Khoá khi chưa chọn kênh hoặc nội dung vượt giới hạn của kênh
                // khó tính nhất — gửi đi cũng chỉ hỏng cả lệnh.
                disabled={
                  dangGuiBai ||
                  (baiDangSua?.status !== 'published' && (!daChonKenh || vuotGioiHan))
                }
                title={
                  !daChonKenh
                    ? 'Chọn kênh ở Bước 1 trước khi đăng'
                    : vuotGioiHan && gioiHan
                      ? `Nội dung vượt giới hạn ${gioiHan.soKyTu.toLocaleString('vi-VN')} ký tự của ${gioiHan.ten}`
                      : undefined
                }
                // Điện thoại: nút Đăng bài co lại lấp chỗ còn lại (không ép 220px — làm nút Lưu nháp bị đẩy ra ngoài khung).
                className={clsx(NUT_CHINH.replace('h-12 px-8 ', ''), 'min-h-12 py-1.5 px-3 sm:px-8 min-w-0 flex-1 sm:flex-none sm:min-w-[220px] text-center')}
              >
                {/* Điện thoại: bỏ biểu tượng cho chữ đủ chỗ (lớp của bộ biểu tượng tự đặt display nên phải ẩn ở khung bọc). */}
                <span className="hidden sm:inline-flex">
                  <span className={clsx("material-symbols-outlined text-[20px]", dangGuiBai && "animate-spin")}>
                  {dangGuiBai ? 'progress_activity' : 'send'}
                </span>
                </span>
                {/* Giá ảnh / video tự tạo ở dòng nhỏ bên dưới — điện thoại không bị tràn chữ khỏi nút. */}
                <span className="flex flex-col items-center leading-tight">
                  <span>
                    {dangGuiBai
                      ? buocDang || 'Đang gửi lên Fanpage…'
                      : baiDangSua?.status === 'published'
                        ? 'Cập nhật bài đã đăng'
                        : composerMode === 'schedule' ? 'Hẹn giờ đăng' : 'Đăng bài'}
                  </span>
                  {!dangGuiBai && baiDangSua?.status !== 'published' && (keHoachXuong?.anh || keHoachXuong?.video) && (
                    <span className="text-xs font-semibold">
                      {[
                        keHoachXuong?.anh && `+ ảnh ${vndAnh(keHoachXuong.anh.gia)}`,
                        keHoachXuong?.video && `+ video ${vndVideo(keHoachXuong.video.gia)}`,
                      ].filter(Boolean).join(' ')}
                    </span>
                  )}
                </span>
              </button>
            </div>
            </div>
          }
        >
            {/*
              Màn hình rộng (≥1280px): chia đôi — trái là BÀI ĐĂNG (kênh, nhờ AI viết, nội dung, giờ đăng), phải là XƯỞNG AI —
              nhìn được cả bài lẫn ảnh/video, không phải cuộn qua lại (chủ dự án 04/10/2026: cửa sổ dài 5,3 màn hình).
              Hẹp hơn (điện thoại, máy tính bảng): một cột dọc, bài đăng trước, Xưởng sau.
            */}
            <div className={clsx('space-y-8', coXuong && 'xl:space-y-0 xl:grid xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] xl:gap-8 xl:items-start')}>
            <div className="space-y-8 min-w-0">
              
              {/*
                Bài đã đăng thì không chọn lại kênh được nữa, và nền tảng chỉ
                cho sửa phần chữ. Nói rõ ngay từ đầu thay vì để chủ shop sửa ảnh
                xong mới phát hiện không lưu được.
              */}
              {baiDangSua?.status === 'published' ? (
                <div className="bg-surface-container rounded-xl p-4 border border-primary/40">
                  <p className="text-sm font-bold text-on-surface flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px] text-primary">edit_note</span>
                    Đang sửa bài đã lên sóng
                  </p>
                  <p className="text-xs text-on-surface-variant mt-1.5 leading-relaxed">
                    Nền tảng chỉ cho sửa phần chữ của bài đã đăng, không cho đổi ảnh và không cho
                    đổi kênh. Muốn thay ảnh, quay ra bấm <b className="text-on-surface">Gỡ để sửa ảnh</b>,
                    bài sẽ về bản nháp để bạn sửa rồi đăng lại.
                  </p>
                </div>
              ) : (
              <>
              {/*
                BƯỚC 1 — CHỌN KÊNH ĐĂNG.

                Dùng chung đúng một component với lịch AI tự đăng, để hai nơi
                hành xử y hệt nhau thay vì mỗi nơi một kiểu.
              */}
              <ChonKenhDang
                nhan="BƯỚC 1 · CHỌN KÊNH ĐĂNG"
                kenhKetNoi={kenhKetNoi}
                cheDo={cheDoKenh}
                onDoiCheDo={setCheDoKenh}
                kenhTuChon={kenhTuChon}
                onDoiKenh={doiChonKenh}
                kenhSeDang={kenhSeDang}
                gioiHan={gioiHan}
              />

              {/* Phần viết bài chỉ mở ra sau khi đã chọn kênh. */}
              {!daChonKenh && (
                <p className="text-sm text-on-surface-variant flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px]">lock</span>
                  Chọn kênh ở Bước 1 để bắt đầu viết bài.
                </p>
              )}

              </>
              )}

              {/* Bài đã đăng vẫn phải sửa được chữ; bài mới thì phải chọn kênh trước. */}
              {(baiDangSua?.status === 'published' || daChonKenh) && (
              <>
              {/* Block 1: NHỜ AI VIẾT */}
              <div className="khung-muc mau-tim">
                <h3 className="tieu-de-muc dau-muc">NHỜ AI VIẾT</h3>
                <div className="bg-surface-container rounded-xl p-4 border border-outline-variant space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-on-surface-variant mb-2">Bạn muốn viết về gì?</label>
                    <input 
                      type="text" 
                      value={composerTopic}
                      onChange={(e) => setComposerTopic(e.target.value)}
                      placeholder="Ví dụ: giới thiệu sản phẩm mới, thông báo khuyến mãi cuối tuần..."
                      className="bg-surface-container-high w-full border border-outline-variant rounded-lg p-3 text-sm text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-all"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button 
                      onClick={() => setComposerGoal('sales')}
                      className={clsx("px-3 py-1.5 rounded-full text-xs font-bold transition-colors border", composerGoal === 'sales' ? "bg-primary/20 text-primary border-primary/40" : "bg-surface-variant text-on-surface-variant border-outline-variant hover:bg-surface-container-high")}
                    >Bán hàng</button>
                    <button 
                      onClick={() => setComposerGoal('engagement')}
                      className={clsx("px-3 py-1.5 rounded-full text-xs font-bold transition-colors border", composerGoal === 'engagement' ? "bg-primary/20 text-primary border-primary/40" : "bg-surface-variant text-on-surface-variant border-outline-variant hover:bg-surface-container-high")}
                    >Tăng tương tác</button>
                    <button 
                      onClick={() => setComposerGoal('announcement')}
                      className={clsx("px-3 py-1.5 rounded-full text-xs font-bold transition-colors border", composerGoal === 'announcement' ? "bg-primary/20 text-primary border-primary/40" : "bg-surface-variant text-on-surface-variant border-outline-variant hover:bg-surface-container-high")}
                    >Thông báo</button>
                  </div>
                  <button 
                    onClick={handleGenerate}
                    disabled={isGenerating}
                    className="w-full py-2.5 bg-primary/10 text-primary border border-primary/30 rounded-lg font-bold text-sm hover:bg-primary/20 transition-colors flex items-center justify-center gap-2"
                  >
                    {isGenerating ? (
                      <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></span>
                    ) : (
                      <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
                    )}
                    Nhờ AI viết
                  </button>
                  <p className="text-[11px] text-on-surface-variant">AI viết một bài hiệu quả nhất, hiện ngay ở ô Nội dung bài đăng bên dưới.</p>

                </div>
              </div>

              {/* Block 2: NỘI DUNG BÀI ĐĂNG */}
              <div className="khung-muc mau-lam">
                <h3 className="tieu-de-muc dau-muc">NỘI DUNG BÀI ĐĂNG</h3>
                {/*
                  Ảnh / video đăng kèm bài: thu gọn thành một nút ở góc ô nội dung (chủ dự án 03/10/2026) —
                  đỡ chiếm chỗ, không lẫn với Xưởng AI bên dưới. Kéo thả tệp vào ô nội dung cũng được.
                */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm,application/pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) handleFilesChosen(e.target.files);
                    // Xoá giá trị để chọn lại đúng tệp đó lần nữa vẫn kích hoạt.
                    e.target.value = '';
                  }}
                />
                <div
                  className="relative"
                  onDragOver={(e) => {
                    if (baiDangSua?.status !== 'published' && e.dataTransfer.types.includes('Files')) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    if (baiDangSua?.status === 'published' || e.dataTransfer.files.length === 0) return;
                    e.preventDefault();
                    handleFilesChosen(e.dataTransfer.files);
                  }}
                >
                  <textarea 
                    rows={10}
                    value={composerContent}
                    onChange={(e) => setComposerContent(e.target.value)}
                    placeholder="Nội dung bài viết sẽ hiển thị trên Fanpage..."
                    className="bg-surface-container-high w-full rounded-xl border border-outline-variant p-4 pb-12 text-sm text-on-surface leading-relaxed focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-all resize-none"
                  ></textarea>
                  {/* Bài đã đăng: nền tảng không cho đổi ảnh, nên không có nút thêm ảnh. */}
                  {baiDangSua?.status !== 'published' && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      title="Thêm ảnh / video đăng kèm bài — hoặc kéo thả tệp vào ô này"
                      className="absolute bottom-3 left-4 flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-outline-variant bg-surface-container text-xs font-bold text-on-surface-variant hover:border-primary/50 hover:text-on-surface transition-colors"
                    >
                      <span className={clsx('material-symbols-outlined text-[16px]', uploadingCount > 0 && 'animate-spin')}>
                        {uploadingCount > 0 ? 'progress_activity' : 'attach_file'}
                      </span>
                      {uploadingCount > 0
                        ? `Đang tải… còn ${uploadingCount}`
                        : composerMedia.length > 0
                          ? `Ảnh/video kèm bài (${composerMedia.length})`
                          : 'Thêm ảnh/video'}
                    </button>
                  )}
                  <span
                    className={`absolute bottom-3 right-4 text-xs font-mono ${
                      vuotGioiHan ? 'text-error font-bold' : 'text-on-surface-variant'
                    }`}
                  >
                    {soKyTu.toLocaleString('vi-VN')}
                    {gioiHan ? ` / ${gioiHan.soKyTu.toLocaleString('vi-VN')}` : ''} ký tự
                  </span>
                </div>
                {composerMedia.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {composerMedia.map((item, index) => (
                      <div key={item.url} className="relative group w-14 h-14 rounded-lg overflow-hidden border border-outline-variant bg-surface-container">
                        {item.type === 'image' || item.type === 'gif' ? (
                          <img src={item.url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center">
                            <span className="material-symbols-outlined text-[18px] text-on-surface-variant">
                              {item.type === 'video' ? 'movie' : 'description'}
                            </span>
                          </div>
                        )}
                        {baiDangSua?.status !== 'published' && (
                          <button
                            onClick={() => setComposerMedia((current) => current.filter((_, i) => i !== index))}
                            className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-noi border border-outline-variant flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:border-error hover:text-error"
                            title="Bỏ tệp này"
                          >
                            <span className="material-symbols-outlined text-[12px]">close</span>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {vuotGioiHan && gioiHan && (
                  <p className="text-xs text-error mt-2 leading-relaxed">
                    Nội dung vượt {(soKyTu - gioiHan.soKyTu).toLocaleString('vi-VN')} ký tự so với
                    {' '}giới hạn {gioiHan.soKyTu.toLocaleString('vi-VN')} ký tự của {gioiHan.ten}.
                    {' '}Vui lòng rút ngắn nội dung, hoặc bỏ chọn {gioiHan.ten} ở Bước 1.
                  </p>
                )}
              </div>

              {/* Block 4: ĐĂNG BÀI NÀY LÚC NÀO */}
              {baiDangSua?.status !== 'published' && (
              <div className="khung-muc mau-luc">
                {/*
                  Chỉ cho BÀI ĐANG SOẠN (đăng ngay / hẹn một lần) — khác lịch "Tự động hoá" (AI tự viết bài mới theo
                  lịch lặp hằng tuần). Chủ dự án 03/10/2026 thấy hai chỗ cùng tên tưởng là trùng → đặt tên rõ.
                */}
                <h3 className="tieu-de-muc dau-muc">ĐĂNG BÀI NÀY LÚC NÀO</h3>
                <p className="text-xs text-on-surface-variant mb-3 leading-relaxed">
                  Chỉ cho bài bạn đang soạn. Bài AI tự viết theo lịch hằng tuần cài ở mục "Tự động hoá" ngoài trang.
                </p>
                <div className="bg-surface-container rounded-xl p-4 border border-outline-variant space-y-4">
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <div className="relative flex items-center justify-center w-5 h-5">
                      <input 
                        type="radio" 
                        name="schedule" 
                        className="peer appearance-none w-5 h-5 border-2 border-outline-variant rounded-full checked:border-primary cursor-pointer transition-colors"
                        checked={composerMode === 'now'}
                        onChange={() => setComposerMode('now')}
                      />
                      <div className="absolute w-2.5 h-2.5 rounded-full bg-primary opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none"></div>
                    </div>
                    <span className="text-sm font-bold text-on-surface group-hover:text-primary transition-colors">Đăng ngay</span>
                  </label>
                  
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <div className="relative flex items-center justify-center w-5 h-5">
                      <input 
                        type="radio" 
                        name="schedule" 
                        className="peer appearance-none w-5 h-5 border-2 border-outline-variant rounded-full checked:border-primary cursor-pointer transition-colors"
                        checked={composerMode === 'schedule'}
                        onChange={() => setComposerMode('schedule')}
                      />
                      <div className="absolute w-2.5 h-2.5 rounded-full bg-primary opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none"></div>
                    </div>
                    <span className="text-sm font-bold text-on-surface group-hover:text-primary transition-colors">Hẹn giờ</span>
                  </label>

                  {composerMode === 'schedule' && (
                    <div className="pl-8 flex gap-3">
                      <input
                        type="date"
                        value={scheduleDate}
                        min={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => setScheduleDate(e.target.value)}
                        className="bg-surface-container-high border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-none"
                      />
                      <input
                        type="time"
                        value={scheduleTime}
                        onChange={(e) => setScheduleTime(e.target.value)}
                        className="bg-surface-container-high border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-none"
                      />
                    </div>
                  )}
                </div>
              </div>
              )}
              </>
              )}
            </div>
            {coXuong && (
              <div className="min-w-0">
                {/* Block 3B: XƯỞNG AI — một ô soạn chung cho ảnh và video; không có gì ở đây tự lên nền tảng */}
                <XuongAi
                  noiDung={composerContent}
                  anhBai={composerMedia.filter((m) => m.type === 'image').map((m) => m.url)}
                  videoBai={composerMedia.filter((m) => m.type === 'video').map((m) => m.url)}
                  onGanVaoBai={(item) => setComposerMedia((truoc) => [...truoc, item])}
                  onKeHoachDang={setKeHoachXuong}
                />
              </div>
            )}
            </div>
        </HopThoai>
      )}

      {/* Auto Mode Confirmation Dialog */}
      {showAutoConfirm && (
        <HopThoai
          co="vua"
          bieuTuong="warning"
          tieuDe="Bật chế độ AI tự đăng?"
          onDong={() => setShowAutoConfirm(false)}
          chan={
            <>
              <button type="button" onClick={() => setShowAutoConfirm(false)} className={NUT_PHU}>
                Huỷ
              </button>
              {/* Việc có rủi ro → nút chính màu vàng cảnh báo, không lẫn với nút thường. */}
              <button type="button" onClick={confirmAutoMode} className={NUT_CANH_BAO}>
                Tôi hiểu, bật chế độ này
              </button>
            </>
          }
        >
          <p className="text-base text-on-surface leading-relaxed">
            AI sẽ tự viết và đăng bài lên Fanpage của bạn mà <b>không cần bạn duyệt trước</b>. Bạn vẫn xem lại và xoá bài sau khi đã đăng.
          </p>
        </HopThoai>
      )}

      <AITrainingModal kind="content" isOpen={isTrainingOpen} onClose={() => setIsTrainingOpen(false)} aiName="AI Viết - Đăng Bài" />
    </main>
  );
}
