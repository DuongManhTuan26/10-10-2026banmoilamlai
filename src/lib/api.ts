/**
 * Client gọi API của hệ thống.
 *
 * Thay thế hoàn toàn cho src/data/mockApi.ts. Mọi dữ liệu hiển thị trên giao
 * diện đều đi qua đây và đến từ database thật hoặc từ Zernio, không còn bất
 * kỳ dữ liệu dựng sẵn nào.
 */

export interface TuChuConfig {
  bat: boolean;
  tuLenDon: boolean;
  chinhSachGiamGia: string;
  chinhSachVanChuyen: string;
  chinhSachKhieuNai: string;
  chinhSachGapNguoi: string;
  toiDaLuot: number;
  baoChuShop: boolean;
  nhacLai: boolean;
  nhacSauPhut: number;
  nhacToiDa: number;
}

export interface SalesStage {
  id: string;
  /** Tên bước — sửa được. */
  ten: string;
  /** AI phải làm gì ở bước này — sửa được. */
  mucTieu: string;
  enabled: boolean;
}

export interface AutoPilotConfig {
  enabled: boolean;
  /** 0 = Chủ nhật … 6 = Thứ bảy. */
  days: number[];
  /** "HH:MM" theo giờ Việt Nam. */
  times: string[];
  topics: string[];
  goal: string;
  guard: "publish" | "notify" | "approve";
  notifyMinutes: number;
  accountIds: string[];
  /** Tự vẽ ảnh theo nội dung từng bài, đăng kèm. */
  anh: AnhTuDong;
  /** Tự tạo video theo nội dung từng bài, đăng kèm — có trần tiền mỗi tháng. */
  video: VideoTuDong;
}

export interface VideoTuDong {
  bat: boolean;
  model: string;
  soGiay: number;
  doNet: string;
  khung: string;
  coTieng: boolean;
  mucDich: string;
  chuTrongVideo: 'theo_noi_dung' | 'khong';
  chanNhanHieuGia: boolean;
  chanNguoiThat: boolean;
  /** Trần tiền video tự động mỗi tháng (USD). 0 = chưa đặt. */
  tranThangUsd: number;
}

/** Mô hình và thông số vẽ ảnh do người dùng chọn. */
export interface LuaChonVeAnh {
  model: string;
  doNet?: string;
  chatLuong?: string;
  khung?: string;
}

export interface AnhTuDong extends LuaChonVeAnh {
  bat: boolean;
  chuTrongAnh: 'theo_noi_dung' | 'khong';
  chanNhanHieuGia: boolean;
  chanNguoiThat: boolean;
}

/** Một mô hình vẽ ảnh kèm giá một ảnh (USD) theo từng mức "độNét|chấtLượng". */
export interface ModelAnh {
  id: string;
  ten: string;
  xepHang: string;
  phanKhuc: string | null;
  doNet: string[];
  chatLuong: string[];
  khung: string[];
  soAnhThamChieu: number;
  lyDo: string | null;
  gia: number | null;
  giaTheoMuc: Record<string, number | null>;
}

export interface AutoPilotRun {
  slot_key: string;
  status: "running" | "ok" | "failed" | "skipped";
  topic: string | null;
  post_id: number | null;
  note: string | null;
  created_at: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Phiên đăng nhập đã hết hạn — giao diện cần đưa về màn hình đăng nhập. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** Không gọi được tới máy chủ (máy chủ tắt, mất mạng). Không phải lỗi dữ liệu. */
  get isOffline(): boolean {
    return this.status === 0;
  }
}

/**
 * KHỐI NÃO đang chọn (docs/khoi-nao.md) — khoá localStorage giữ mã TRANG đang chọn ở bộ chọn duy nhất đầu thanh menu.
 *
 * ActivePage.tsx ghi, chỗ này đọc. Một chỗ khai báo duy nhất: hai nơi lệch một chữ là khối não lặng lẽ đọc nhầm trang.
 */
export const KHOA_TRANG_DANG_CHON = "zn_khoi_nao";

/**
 * Đính khối não đang chọn vào MỌI yêu cầu (đầu X-Trang). Đọc thẳng localStorage chứ không giữ bản sao trong bộ nhớ: effect
 * của màn hình con chạy TRƯỚC effect của provider, bản sao cập nhật muộn sẽ khiến lần gọi đầu sau khi đổi trang mang mã cũ.
 *
 * Máy chủ không tin con số này: nó kiểm người đăng nhập có quyền mở trang đó không (server/khoi-nao.ts), không có thì 404.
 */
function trangDangChon(): string | null {
  try {
    return localStorage.getItem(KHOA_TRANG_DANG_CHON);
  } catch {
    // Trình duyệt chặn localStorage — coi như chưa chọn; máy chủ dùng trang mặc định của tài khoản.
    return null;
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {}
): Promise<T> {
  const { method = "GET", body, signal } = options;

  /*
   * Máy chủ không chạy, mất mạng, hoặc tunnel chết thì fetch ném TypeError
   * chứ không phải ApiError. Mọi màn hình đều bắt theo `instanceof ApiError`
   * nên trường hợp này rơi xuống câu chữ chung chung kiểu "Không tải được
   * danh sách kênh" — chủ shop đọc xong vẫn không biết chuyện gì xảy ra và
   * cũng không biết phải làm gì.
   *
   * Đổi thành ApiError mã 0 kèm câu nói rõ nguyên nhân, dùng chung cho mọi
   * màn hình. Riêng lệnh bị huỷ chủ động (AbortSignal) phải giữ nguyên lỗi
   * gốc, vì đó không phải sự cố.
   */
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(trangDangChon() ? { "X-Trang": trangDangChon()! } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      // Cookie phiên phải được gửi kèm, nếu không mọi request đều là 401.
      credentials: "same-origin",
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(
      "Không kết nối được tới máy chủ. Kiểm tra mạng rồi bấm Thử lại.",
      0
    );
  }

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError("Máy chủ trả về dữ liệu không đọc được", response.status);
    }
  }

  if (!response.ok) {
    const message =
      (data as { error?: string } | null)?.error ??
      `Yêu cầu thất bại (mã ${response.status})`;

    /*
     * Phiên chết giữa chừng thì phải đưa về màn hình đăng nhập NGAY.
     *
     * Trước đây App chỉ kiểm tra phiên đúng một lần lúc mở trang. Phiên mất sau
     * đó (cookie bị xoá, hết hạn, đổi máy) thì giao diện vẫn vẽ đủ mọi màn hình
     * như bình thường, còn mọi nút bấm đều lặng lẽ thất bại với dòng "Bạn cần
     * đăng nhập". Nhìn từ phía chủ shop thì đó là "bấm không được gì" — không
     * ai đoán ra là phải đăng nhập lại.
     *
     * Bắn một sự kiện để App đưa về trang đăng nhập. Không gọi thẳng vào React
     * ở đây để lớp gọi API không phụ thuộc vào giao diện.
     */
    if (response.status === 401 && !path.startsWith("/auth/")) {
      window.dispatchEvent(new CustomEvent("phien-het-han"));
    }

    throw new ApiError(message, response.status);
  }

  return data as T;
}

const get = <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal });
const post = <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body });
const patch = <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body });
const put = <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body });
const del = <T>(path: string) => request<T>(path, { method: "DELETE" });

// ---------------------------------------------------------------------------
// Kiểu dữ liệu
// ---------------------------------------------------------------------------

export interface User {
  id: number;
  email: string;
  name: string;
  plan: string;
  /**
   * Máy chủ tự kiểm lại vai trò mỗi request; chỗ này chỉ để vẽ giao diện.
   *
   * 'admin'     — quản trị tổng.
   * 'admin_con' — chủ chuỗi, quản lý các tài khoản trang mình lập ra.
   * 'shop'      — một tài khoản một trang.
   */
  role: 'admin' | 'admin_con' | 'shop';
  profileRef: string | null;
  /** Khác null nghĩa là đang XEM THAY một trang, không phải tài khoản của mình. */
  moBoi?: number | null;
  /** Người đang xem thay, để hiện dải băng và nút quay lại. */
  nguoiMo?: { id: number; name: string } | null;
}

/** Một tài khoản shop nhìn từ trang quản trị, kèm số liệu vận hành. */
export interface TaiKhoanQuanTri {
  id: number;
  email: string;
  name: string;
  plan: string;
  role: 'admin' | 'admin_con' | 'shop';
  is_active: boolean;
  created_at: string;
  kenh: number;
  hoi_thoai: number;
  cho_nguoi: number;
  don: number;
  bai: number;
  tai_lieu: number;
  hoat_dong_cuoi: string | null;
  tu_chu: string | null;
  telegram: boolean | null;
  /** Dòng của chính người đang xem. */
  la_toi: boolean;
}

/**
 * MỘT dòng tài khoản ở màn hình QUẢN LÝ dùng chung (quản trị tổng và admin con) — cùng một bộ cột ở cả hai
 * (server/services/quan-ly-chung.ts). Chủ dự án 04/10/2026: hai màn hình phải giống 100%, chỉ khác phạm vi.
 */
export interface TaiKhoanQuanLy extends TrangVanHanh {
  role: 'admin' | 'admin_con' | 'shop';
  /** Admin con đứng trên tài khoản trang này; null nếu đứng riêng. */
  parent_id: number | null;
  /** Dòng của chính người đang xem. */
  la_toi: boolean;
  tai_lieu: number;
  hoi_thoai: number;
  bai: number;
  don: number;
  telegram: boolean | null;
}

export interface NhatKyQuanTri {
  id: number;
  action: string;
  target_id: number | null;
  target_email: string;
  detail: Record<string, unknown>;
  created_at: string;
  admin_email: string | null;
}

export interface PlatformPermission {
  icon: string;
  name: string;
  desc: string;
}

export interface Platform {
  id: string;
  name: string;
  icon: string;
  /** Định danh gửi cho Zernio; null nghĩa là chưa kết nối được qua hệ thống. */
  platformKey: string | null;
  canPost: boolean;
  /** Có tin nhắn riêng — điều kiện để AI chạy trọn vòng bán hàng và chốt đơn. */
  canDm: boolean;
  canComment: boolean;
  capabilityNote?: string;
  connectionType: string;
  selectionLabel?: string;
  publishOnly?: boolean;
  warnings?: string[];
  instructions?: string[];
  requestedPermissions?: PlatformPermission[];
  /** Trạng thái thật của người dùng đang đăng nhập. */
  connectable: boolean;
  connected: boolean;
  needsReconnection: boolean;
  accountCount: number;
  accounts: Array<{
    id: string;
    name: string;
    connected: boolean;
    needsReconnection: boolean;
  }>;
}

export interface PlatformCatalog {
  social: Platform[];
  ads: Platform[];
  communication: Platform[];
}

/**
 * Tình trạng vận hành của một trang, nhìn từ bảng điều hành của chủ chuỗi.
 *
 * Đủ để trả lời trên MỘT màn hình: trang này có đang nối được không, AI đã
 * được dạy chưa, tuần qua có chạy không, có khách nào đang chờ người, bán được
 * bao nhiêu. Không phải bấm vào từng trang mới biết.
 */
export interface TrangVanHanh extends TrangCon {
  /** 1 nếu vai trò AI bán hàng đã có chữ, 0 nếu vẫn để trống. */
  da_day_vai_tro: number;
  so_tai_lieu: number;
  /** AI tự chốt đơn, không chờ chủ shop duyệt. */
  ai_tu_chu: boolean;
  kich_ban_bat: number;
  tin_7_ngay: number;
  ai_tra_loi_7_ngay: number;
  /** null nghĩa là trang này chưa từng có tin nhắn nào. */
  hoat_dong_cuoi: string | null;
  don_thang: number;
  /**
   * Tiền AI trang này tiêu trong tháng, đơn vị USD.
   *
   * Chuỗi vì Postgres trả NUMERIC dưới dạng chuỗi — ép sang number ở tầng này
   * là chỗ dễ mất số lẻ nhất, mà một lượt trả lời chỉ tốn vài phần nghìn đô.
   */
  tien_ai_thang: string;
}

/**
 * Báo cáo chi tiết của một trang, xem từ tài khoản quản lý mà KHÔNG phải vào
 * trong trang đó. Cùng cách tính với bảng điều khiển và trang thống kê của
 * chính trang ấy, chỉ khác là chỉ đọc.
 *
 * Số tiền và số đếm để dạng chuỗi vì Postgres trả bigint/numeric dưới dạng
 * chuỗi — ép sang number ở tầng này là chỗ dễ mất số nhất.
 */
export interface BaoCaoTrang {
  trang: { id: number; name: string };
  ngay: number;
  so: Record<string, string>;
  truoc: Record<string, string>;
  donGanDay: Array<{
    code: string; customer_name: string | null; product: string;
    quantity: number; total: string; status: string; closed_by: string;
    created_at: string;
  }>;
  canGap: Array<{
    id: string; handoff_reason: string | null; last_message_at: string | null;
    platform: string; customer_name: string | null;
  }>;
}

/** Một trang trong chuỗi, nhìn từ bảng tổng quan của chủ chuỗi. */
export interface TrangCon {
  id: number;
  /** Tên đăng nhập nội bộ do hệ thống sinh, KHÔNG phải email của ai. */
  email: string;
  name: string;
  is_active: boolean;
  plan: string;
  created_at: string;
  kenh_noi: number;
  kenh_can_noi_lai: number;
  don_hom_nay: number;
  /** Chuỗi vì Postgres trả bigint dưới dạng chuỗi, đừng ép sang number rồi mất số. */
  doanh_thu_thang: string;
  cho_nguoi: number;
  ten_fanpage: string | null;
}

export interface SocialAccount {
  id: string;
  platform: string;
  username: string;
  display_name: string;
  profile_picture: string | null;
  profile_url: string | null;
  followers_count: number | null;
  connected: boolean;
  needs_reconnection: boolean;
  token_expires_at: string | null;
  last_synced_at: string | null;
  /**
   * Trang (bộ não) mà kênh này thuộc về.
   *
   * Nhiều kênh chung một Trang là chuyện bình thường: Fanpage, Instagram và
   * TikTok của cùng một shop đứng chung một hồ sơ Zernio nên dùng chung vai
   * trò, kịch bản và tài liệu. Vì vậy muốn biết "có bao nhiêu bộ não" thì
   * phải đếm trang_id khác nhau, không được đếm số kênh.
   */
  trang_id: number | null;
}

export type ConversationStatus = "ai" | "waiting_human" | "human" | "done";
export type WindowState = "open" | "closing" | "expired";

export interface Conversation {
  id: string;
  status: ConversationStatus;
  platform: string;
  unread_count: number;
  handoff_reason: string | null;
  last_message_at: string;
  window_expires_at: string | null;
  window_state: WindowState;
  social_account_id: string | null;
  customer_id: number | null;
  customer_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  account_name: string | null;
  last_message: string | null;
  external_url: string | null;
}

export interface Message {
  id: number;
  sender_type: "customer" | "ai" | "human" | "system";
  content: string;
  attachments: unknown[];
  is_handoff: boolean;
  sent_at: string;
}

export interface ConversationDetail extends Conversation {
  address: string | null;
  tags: string[];
  note: string | null;
  messages: Message[];
}

export interface Order {
  id: number;
  code: string;
  customer_name: string | null;
  phone: string | null;
  address: string | null;
  product: string;
  quantity: number;
  unit_price: number;
  total: number;
  status: "pending" | "confirmed" | "shipping" | "completed" | "cancelled";
  closed_by: "ai" | "human";
  note: string | null;
  telegram_sent_at: string | null;
  created_at: string;
  updated_at: string;
  /** Hội thoại đã lên đơn này (null = đơn nhập tay). */
  conversation_id: string | null;
  /** Các dòng hàng của đơn nhiều sản phẩm; null với đơn một sản phẩm / đơn tạo trước 10/10/2026. */
  items: { ten: string; so_luong: number; don_gia: number }[] | null;
  /** Nguồn của lần chạm gần nhất trước khi chốt: 'quang_cao' | 'lien_ket' | 'binh_luan' | 'tu_nhan' | null. */
  origin: string | null;
}

/**
 * Ảnh/video kèm bài, đúng dạng Zernio nhận trong `mediaItems`.
 *
 * `url` là publicUrl do Zernio trả về sau khi tải lên. Kho tạm giữ tệp 7 ngày,
 * nên bài hẹn lịch xa hơn thế cần tải lại ảnh gần ngày đăng.
 */
export interface NguongCanhBao {
  soDuToiThieuUsd: number;
  soNgayToiThieu: number;
  heSoTieuQua: number;
}

export interface SaoKeChiPhi {
  luc: string;
  ai: {
    ok: boolean; loi?: string; daNapUsd?: number; daTieuUsd?: number; conLaiUsd?: number;
    homNayUsd?: number; tuanNayUsd?: number; thangNayUsd?: number; khoaDaTieuUsd?: number;
  };
  kenh: {
    ok: boolean; loi?: string; goi?: string; conHoatDong?: boolean; tieuKyNayUsd?: number; tinDungConUsd?: number;
    tamDungLuc?: string | null; lyDoTamDung?: string | null; canTraUsd?: number | null; linkHoaDon?: string | null;
    lyDoTuChoiThe?: string | null; lanThuTienTiepTheo?: string | null;
    /** Phạm vi chuỗi: tiền kênh chia theo tỉ lệ số kênh đang nối (nhà cung cấp chỉ báo tổng cả hệ thống). */
    uocTinh?: { kenhChuoi: number; kenhTatCa: number };
  };
  /** null ở phạm vi chuỗi (ngưỡng cảnh báo là việc của quản trị tổng). */
  nguong: NguongCanhBao | null;
  /** tomTat: một dòng ngắn cho dòng chính; noiDung: câu đầy đủ. */
  canhBao: { ma: string; mucDo: 'nguy_cap' | 'can_lam' | 'luu_y'; noiDung: string; tomTat: string; link?: string }[];
  so: {
    soNgay: number;
    /** Nhóm việc (Chatbot bán hàng, Marketing...), mỗi nhóm kèm từng việc cụ thể. */
    theoNhom: {
      nhom: string; ten: string; lan: number; usd: number;
      viec: { viec: string | null; ten: string; lan: number; usd: number }[];
    }[];
    /** Mỗi tài khoản một dòng, tiền của RIÊNG tài khoản đó (không cộng con). */
    theoTaiKhoan: {
      userId: number | null; ten: string; email: string | null; vaiTro: string | null;
      chaId: number | null; chaTen: string | null; lan: number; usd: number;
    }[];
    tongTuTruocUsd: number;
  };
  /** Đối chiếu tổng với nhà cung cấp; null khi chưa đọc được nhà cung cấp. */
  doiChieu: {
    trangThai: 'khop' | 'dang_cho' | 'lech';
    nhaCungCapUsd: number;
    soAppUsd: number;
    ngoaiSoTruocMocUsd: number;
    mocLuc: string;
    /** lechUsd: phần lệch thật, đã trừ các lượt đang chờ nhà cung cấp chốt. */
    sauMoc: { nhaCungCapUsd: number; soDaChotUsd: number; soChoUsd: number; soLuotCho: number; chenhUsd: number; lechUsd: number };
  } | null;
  /** null ở phạm vi chuỗi (nạp tiền là việc của quản trị tổng). */
  linkNap: { openrouter: string; kenh: string; database: string } | null;
  phamVi?: 'chuoi';
}

/** Một lượt AI bị tính tiền trong sổ. */
/** Màn hình Tổng quan quản lý (server/services/tong-quan.ts) — cùng dạng cho cả hai tầng. */
export type KyTongQuan = 'thang_nay' | 'thang_truoc';
export interface TienAiTongQuan {
  tongUsd: number;
  theoNhom: Partial<Record<'ban_hang' | 'marketing' | 'phan_tich' | 'anh' | 'video' | 'day_ai' | 'chua_phan_loai', number>>;
}
export interface TrangTongQuan {
  id: number;
  ten: string;
  hoatDong: boolean;
  kenh: { id: string; nenTang: string; ten: string; dangNoi: boolean; canNoiLai: boolean; tienUsd: number | null }[];
  tienAi: TienAiTongQuan;
  tienKenhUsd: number | null;
  /** Tiền quảng cáo của đúng Fanpage của trang, theo từng tài khoản quảng cáo; ngoaiTrang chỉ để biết, không cộng. */
  quangCao: { ten: string; tienTe: string; soTien: number | null; ngoaiTrang: number | null; lechMuiGio?: string; loi?: string }[];
  coFanpage: boolean;
  donHang: { so: number; doanhThu: number };
}
export interface TaiKhoanTongQuan {
  id: number;
  ten: string;
  email: string;
  role: 'admin' | 'admin_con' | 'shop';
  parentId: number | null;
  hoatDong: boolean;
  laToi: boolean;
  trang: TrangTongQuan[];
  tienAiKhongTrang: TienAiTongQuan;
}
export interface TongQuanQuanLy {
  ky: KyTongQuan;
  phamVi: 'tong' | 'chuoi';
  /** Kỳ đã kẹp từ mốc bắt đầu tính theo trang. truocMoc = cả kỳ nằm trước mốc (không có số). */
  kyTinh: { tu: string; den: string; keoTuMoc: boolean; truocMoc: boolean; moc: string };
  /** Đã chốt hay còn tạm tính, theo cách từng nguồn chốt sổ. */
  chot: { ai: boolean; kenh: boolean; quangCao: boolean };
  tong: {
    taiKhoan: number;
    taiKhoanHoatDong: number;
    trang: number;
    trangHoatDong: number;
    tienAiUsd: number;
    tienAiTaiKhoanDaXoaUsd: number;
    tienQuangCao: { tienTe: string; soTien: number }[];
    coFanpage: boolean;
    donHang: number;
    doanhThu: number;
  };
  nguonKenh: { ok: true; tu: string; den: string; khongGanUsd: number; tongUsd: number } | { ok: false; loi: string };
  taiKhoan: TaiKhoanTongQuan[];
}

/** Báo cáo chuỗi 4 khâu của một trang (server/services/bao-cao-chuoi.ts). */
export interface BaoCaoChuoi {
  kyTinh: { tu: string; den: string; truocMoc: boolean };
  noiDung: {
    baiDang: number; baiAi: number; baiLoi: number; tienAiUsd: number;
    hienThi: number; tiepCan: number; tuongTac: number; binhLuan: number;
    hoiThoaiTuBai: number; donTuBai: number; doanhThuTuBai: number;
  };
  quangCao: {
    coFanpage: boolean; loi: string | null;
    theoTienTe: { tienTe: string; chiTieu: number; hienThi: number; nhap: number; troChuyen: number | null }[];
    soQuangCao: number; quangCaoLoi: { ten: string; trangThai: string }[];
    hoiThoaiTuQuangCao: number; donTuQuangCao: number; doanhThuTuQuangCao: number;
  };
  banHang: {
    hoiThoaiMoi: number;
    theoNguon: { quangCao: number; binhLuan: number; lienKet: number; tuNhan: number; chuaGhiNguon: number };
    tinAiTraLoi: number; traLoiTrungViGiay: number | null; soLanTraLoi: number;
    nhuongNguoi: { ly_do: string; so: number }[];
    soDon: number; donHuy: number; doanhThu: number; giaTriDonTB: number | null; tiLeChot: number | null; tienAiUsd: number;
  };
}

/** Sức khoẻ từng khâu của một trang (server/services/suc-khoe.ts). */
export type MucSucKhoe = 'dang_manh' | 'on' | 'tut' | 'chua_du';
export interface ChiSoSucKhoe {
  khau: 'noi_dung' | 'quang_cao' | 'ban_hang';
  ma: string;
  ten: string;
  huong: 'cao_tot' | 'thap_tot';
  donVi: 'ti_le' | 'moi_ngay' | 'moi_bai' | 'moi_100k';
  gan: { giaTri: number | null; tuSo: number; mauSo: number };
  nen: { giaTri: number | null; tuSo: number; mauSo: number };
  muc: MucSucKhoe;
  lech: number | null;
  p: number | null;
  thieu?: string;
  anhHuongTuan: number | null;
}
/** AI điều hành (chạy thử) — sổ bằng chứng do code gom, hạng do code chấm. */
export interface SoDieuHanh {
  bangChung: { ma: string; nguon: string; noiDung: string; hang: 'A' | 'B' | 'C' | 'D'; lyDoHang: string[]; gioiHan: string[] }[];
  khoangTrong: string[];
  vanDeTuDong: string | null;
  soDo: { so: number; duyet: number; bac: number; cho: number; dung_chu_shop: number; tien_tb: number | null; giay_tb: number | null; loi_xac_nhan: number } | null;
}

export interface DeXuatDieuHanh {
  id: number;
  luc: string;
  van_de: string;
  ket_qua: string;
  ly_do: string;
  ket_luan: string;
  trang_thai: 'cho_duyet' | 'da_duyet' | 'bac';
  ly_do_chu_shop: string | null;
  so_luot_ai: number;
  tien_usd: number;
  thoi_gian_ms: number;
  noi_dung: string | null;
  /** Nhân viên các việc đề xuất nhắm tới (noi_dung | quang_cao | ban_hang | chu_shop | he_thong). */
  nhan_vien?: string[];
}

/** Một chỉ đạo của AI điều hành xuống AI nhân viên (server/services/chi-dao.ts). */
export interface ChiDao {
  id: number;
  de_xuat_id: number | null;
  ai: 'content' | 'ads' | 'sales';
  noi_dung: string;
  trang_thai: 'dang_ap_dung' | 'da_go' | 'hoan_tac';
  luc_bat_dau: string;
  luc_ket_thuc: string | null;
  ket_qua: 'chua_do' | 'tot_len' | 'giu_nguyen' | 'xau_di';
  ket_qua_chi_tiet: { xauDi?: string[]; totLen?: string[] } | null;
  luc_do: string | null;
  ly_do_go: string | null;
  luc_se_do: string;
}
export interface LichDieuHanh { baoCaoNgay: boolean; gio: string; tuChanDoan: boolean; tranThangUsd: number }

export interface ThanhPhanTien { don: number; doanhThu: number; tienAiVnd: number; tienQcVnd: number | null }
/** Chỉ số cuối của khối não (server/services/suc-khoe.ts — ChiSoCuoi): để theo dõi, không chấm tốt / tụt. */
export interface ChiSoCuoi {
  ma: 'tien_moi_don' | 'doanh_thu_tren_chi_phi';
  ten: string;
  donVi: 'vnd' | 'lan';
  huong: 'cao_tot' | 'thap_tot';
  gan: number | null;
  nen: number | null;
  chiTiet: { gan: ThanhPhanTien; nen: ThanhPhanTien };
  ghiChu: string[];
}

export interface SucKhoeTrang {
  luc: string;
  cuaSo: { gan: string[]; nen: string[] };
  chiSo: ChiSoSucKhoe[];
  chiSoCuoi: ChiSoCuoi[];
  suCo: { khau: string; ten: string; chiTiet: string }[];
  uuTien: string[];
  baoVe: string[];
}

export interface LuotChiPhi {
  id: number;
  luc: string;
  userId: number | null;
  taiKhoan: string;
  viec: string | null;
  tenViec: string;
  nhom: string;
  model: string;
  tokenVao: number;
  tokenRa: number;
  usd: number;
  usdLucGoi: number;
  usdNhaCungCap: number | null;
  doiChieu: 'khop' | 'lech' | 'cho' | 'khong_ma';
  loi: string | null;
}

export interface LocLuot {
  ngay?: number;
  /** Mã tài khoản, hoặc 'chung' cho việc không thuộc tài khoản nào. */
  tk?: number | 'chung';
  kemCon?: boolean;
  nhom?: string;
  viec?: string;
  trang?: number;
}

export interface MediaItem {
  url: string;
  type: 'image' | 'video' | 'gif' | 'document';
}

/** Lựa chọn khi tạo video AI. */
export interface LuaChonVideo {
  soGiay: number;
  doNet: string;
  khung: string;
  coTieng: boolean;
  coAnhMoDau: boolean;
  /** Chữ trong video: theo lời mô tả, hoặc không có chữ. */
  chuTrongVideo?: ChuTrongVideo;
  /** Người dùng bật/tắt — không bịa nhãn hiệu/huy hiệu; không vẽ người thật. */
  chanNhanHieuGia?: boolean;
  chanNguoiThat?: boolean;
}

/** Một model video kèm giá ước tính cho lựa chọn đang chọn. */
export interface ModelVideo {
  id: string;
  ten: string;
  soGiay: number[];
  doNet: string[];
  khung: string[];
  coTieng: boolean;
  anhMoDau: boolean;
  /** USD cho cả video; null nếu bảng giá không có mục khớp. */
  giaUocTinh: number | null;
  /** Vì sao model không làm được lựa chọn này; null nếu làm được. */
  lyDo: string | null;
  /** Phân khúc giá và thứ hạng — vì sao mô hình này được chọn. */
  phanKhuc: string | null;
  xepHang: string | null;
  /** Điều cần biết trước khi chọn (vd. Wan 3.0 luôn có tiếng). */
  ghiChu?: string | null;
  /** Nối dài gốc của hãng (đoạn sau làm tiếp đoạn trước). */
  noiDai?: boolean;
  /** Nhiều cảnh trong một lần tạo. */
  nhieuCanh?: boolean;
  /** Nói tiếng Việt gốc trong video. */
  tiengVietGoc?: boolean;
  /** Số giây tối đa một lần tạo. */
  giayToiDa?: number | null;
  /** Video dài: giá TRỌN video (USD) theo đúng lựa chọn — uocTinh thường gặp, toiDa khi phải vẽ khung/vẽ lại. */
  giaCaVideo?: { uocTinh: number; toiDa: number } | null;
}

/** Lựa chọn của video dài để máy chủ báo giá trọn video. */
export interface LuaChonBaoGiaDai {
  tongGiay: number;
  cheDo: CheDoVideoDai;
  giongDoc: boolean;
  giongGoc: boolean;
  modelGiong: string;
  nhac: boolean;
  tuKiem: boolean;
  soThamChieu: number;
  /** Mô hình vẽ khung mở đầu đã chọn — để báo giá đúng tiền khung. */
  khungModel?: string;
  khungDoNet?: string;
  khungChatLuong?: string;
}

export interface CanhVideo {
  soGiay: number;
  moTa: string;
  tomTat: string;
  /** true: quay tiếp cảnh trước như một cú máy liền; false: cắt sang cảnh mới. Cảnh 1 luôn false. */
  noiTiep: boolean;
  /** Lời đọc tiếng Việt — đọc bằng giọng AI và hiện thành phụ đề. */
  loiDoc: string;
}

/** Giọng đọc, nhạc nền, phụ đề của video dài. */
export type ChuTrongVideo = 'theo_noi_dung' | 'khong';
export type CheDoVideoDai = 'ghep_canh' | 'noi_dai';

export interface AmThanhVideo {
  /** Chữ trong video: theo lời mô tả, hoặc không có chữ. */
  chuTrongVideo: ChuTrongVideo;
  /** Lời dẫn do chính mô hình video nói tiếng Việt (chỉ mô hình tiengVietGoc). */
  giongGoc: boolean;
  /** Người dùng bật/tắt — không bịa nhãn hiệu/huy hiệu; không vẽ người thật. */
  chanNhanHieuGia?: boolean;
  chanNguoiThat?: boolean;
  /** Hướng kịch bản người dùng bật/tắt cho AI đạo diễn. */
  cauTrucQuangCao?: boolean;
  giuSuThat?: boolean;
  boiCanhVietNam?: boolean;
  /** Mô hình giọng đọc AI riêng (khi giongDoc). */
  modelGiong?: string;
  giongDoc: boolean;
  nhac: boolean;
  phuDe: boolean;
  moTaNhac?: string;
  /** Mô hình vẽ khung mở đầu cho cảnh cắt (ghép nhiều cảnh). */
  veAnh?: LuaChonVeAnh;
  /** Kiểu kịch bản: tự do / quảng cáo bán hàng / người thật review (UGC) / phim ngắn có sản phẩm. */
  kieuKichBan?: KieuKichBan;
}

export type KieuKichBan = 'tu_do' | 'quang_cao' | 'ugc' | 'phim_ngan';

export type LoaiThuVien = 'san_pham' | 'nhan_vat';
export interface MucThuVien {
  id: number;
  loai: LoaiThuVien;
  ten: string;
  created_at: string;
}

export interface DuAnVideo {
  id: number;
  loai: 'kich_ban' | 'tham_chieu' | 'trend';
  y_tuong: string;
  anh_tham_chieu: string[];
  nhat_quan: string;
  phan_canh: CanhVideo[];
  model: string;
  do_net: string;
  khung: string;
  co_tieng: boolean;
  trang_thai: 'nhap' | 'dang_tao' | 'dang_ghep' | 'xong' | 'loi';
  gia_uoc_tinh: string | null;
  gia_thuc: string | null;
  url: string | null;
  loi: string | null;
  created_at: string;
  canh_xong?: number;
  che_do?: CheDoVideoDai;
  /** Tiền đã tiêu tới lúc này (cảnh đã tạo + khung, giọng, nhạc), USD. */
  da_ton?: number;
  /** Tự kiểm định và vẽ lại cảnh lỗi. */
  tu_kiem?: boolean;
  /** Đã tự vẽ lại mấy cảnh lỗi. */
  so_lan_ve_lai?: number;
  /** Cảnh vẫn còn lỗi (hết lượt vẽ lại) hoặc chưa kiểm được. */
  canh_bao_kiem_dinh?: { canh: number; ghiChu: string }[];
  am_thanh?: Partial<AmThanhVideo>;
}

export interface ModelSuaVideo {
  id: string;
  ten: string;
  moTa: string;
  /** USD mỗi giây đầu ra. */
  giaMoiGiay: number;
  /** USD tối thiểu mỗi lượt. */
  toiThieu: number;
  /** Số giây tối thiểu bị tính (video ngắn hơn vẫn tính chừng này). */
  giayToiThieu: number;
  phanKhuc?: string;
  xepHang?: string;
}

export interface ViecVideo {
  id: number;
  model: string;
  loi_mo_ta: string;
  so_giay: number;
  do_net: string;
  khung: string;
  co_tieng: boolean;
  trang_thai: 'dang_tao' | 'xong' | 'loi';
  gia_uoc_tinh: string | null;
  gia_thuc: string | null;
  url: string | null;
  loi: string | null;
  created_at: string;
  xong_at: string | null;
  /** true nếu là video → video (sửa video có sẵn). */
  la_sua_video: boolean;
}

export type PostStatus =
  | 'draft'
  | 'pending_approval'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed';

export interface Post {
  id: number;
  platform_post_ref: string | null;
  content: string;
  media: MediaItem[];
  target_account_ids: string[];
  status: PostStatus;
  scheduled_for: string | null;
  published_at: string | null;
  platform_urls: Record<string, string>;
  ai_generated: boolean;
  ai_prompt: string | null;
  stats: { likes?: number; comments?: number; shares?: number };
  last_error: string | null;
  created_at: string;
  /** Đang chờ video AI xong rồi mới đăng. */
  cho_video_id?: number | null;
}

/** Nhãn tiếng Việt cho từng trạng thái bài đăng, dùng trên giao diện. */
export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  draft: 'Bản nháp',
  pending_approval: 'Chờ duyệt',
  scheduled: 'Đã lên lịch',
  publishing: 'Đang đăng',
  published: 'Đã đăng',
  failed: 'Đăng lỗi',
};

export interface AiConfig {
  kind: string;
  system_prompt: string;
  tone: string;
  settings: Record<string, unknown>;
}

export interface AiDocument {
  id: number;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  has_text: boolean;
}

export interface DashboardStats {
  orders_count: number;
  revenue: number;
  new_customers: number;
  open_conversations: number;
  waiting_human: number;
  connected_accounts: number;
  ai_messages: number;
  ai_closed_orders: number;
}

// ---------------------------------------------------------------------------
// Nhóm hàm theo từng khu vực
// ---------------------------------------------------------------------------

/** Một khối não (trang bán hàng) người đăng nhập được mở. */
export interface KhoiNaoInfo {
  trang_id: number;
  ten: string;
  chu_id: number;
  chu_ten: string;
  chu_email: string;
  la_cua_toi: boolean;
  kenh: { id: string; platform: string; ten: string; connected: boolean; anh: string | null }[];
}
export type MaAi = "content" | "ads" | "sales" | "analytics";
export interface NhatKyAi {
  thayDoi: { luc: string; bang: string; hanh_dong: "them" | "sua" | "xoa"; truoc: Record<string, unknown> | null; sau: Record<string, unknown> | null; nguon: string | null }[];
  viec: { luc: string; noi_dung: string; trang_thai: string }[];
}

export const api = {
  khoiNao: {
    danhSach: () => get<{ data: { bonAi: { so: number; ma: MaAi; khau: string; ten: string }[]; ds: KhoiNaoInfo[] } }>("/khoi-nao"),
    nhatKy: (ai: MaAi) => get<{ data: NhatKyAi }>(`/khoi-nao/nhat-ky/${ai}`),
    chiDao: () => get<{ data: ChiDao[] }>("/khoi-nao/chi-dao"),
    themChiDao: (ai: string, noiDung: string) => post<{ data: { id: number } }>("/khoi-nao/chi-dao", { ai, noiDung }),
    goChiDao: (id: number, lyDo?: string) => post<{ success: true }>(`/khoi-nao/chi-dao/${id}/go`, { lyDo }),
    lich: () => get<{ data: { lich: LichDieuHanh; daDungThangUsd: number } }>("/khoi-nao/lich-dieu-hanh"),
    luuLich: (lich: LichDieuHanh) => put<{ data: { lich: LichDieuHanh } }>("/khoi-nao/lich-dieu-hanh", { lich }),
    xemTruocBaoCao: () => get<{ data: { noiDung: string } }>("/khoi-nao/bao-cao-ngay/xem-truoc"),
    baoCaoNgay: () => get<{ data: { report_date: string; findings: string; created_at: string }[] }>("/khoi-nao/bao-cao-ngay"),
  },
  /** Quản trị hệ thống. Máy chủ chặn người không phải quản trị, đây chỉ là lớp gọi. */
  admin: {
    /** Sao kê chi phí trả cho các bên thứ ba: đọc sống + sổ của app. */
    chiPhi: (ngay = 30) => get<{ data: SaoKeChiPhi }>(`/admin/chi-phi?ngay=${ngay}`),
    luotChiPhi: (loc: LocLuot) => {
      const q = new URLSearchParams({ ngay: String(loc.ngay ?? 0), trang: String(loc.trang ?? 1) });
      if (loc.tk !== undefined) q.set('tk', String(loc.tk));
      if (loc.kemCon) q.set('kemCon', '1');
      if (loc.nhom) q.set('nhom', loc.nhom);
      if (loc.viec) q.set('viec', loc.viec);
      return get<{ data: { luot: LuotChiPhi[]; tongLan: number; tongUsd: number; trang: number; soTrang: number } }>(
        `/admin/chi-phi/luot?${q}`
      );
    },
    luuNguongChiPhi: (nguong: NguongCanhBao) =>
      request<{ data: NguongCanhBao }>('/admin/chi-phi/nguong', { method: 'PUT', body: nguong }),
    /** Gửi thử một cảnh báo tới Telegram của chính quản trị đang bấm. */
    thuCanhBaoChiPhi: () => post<{ success: boolean }>('/admin/chi-phi/thu-canh-bao'),
    accounts: () => get<{ data: TaiKhoanQuanLy[] }>('/admin/accounts'),
    audit: () => get<{ data: NhatKyQuanTri[] }>('/admin/audit'),
    /**
     * Tạo tài khoản hộ. Vai trò phải gửi lên rõ ràng — máy chủ coi giá trị lạ
     * là 'shop', nên thiếu trường này là lặng lẽ tạo ra tài khoản đứng riêng.
     */
    /** matKhau: quản trị tự đặt (≥8 ký tự); bỏ trống thì hệ thống sinh. */
    create: (payload: { email: string; name?: string; role: 'admin_con' | 'shop'; matKhau?: string }) =>
      post<{ data: { id: number; email: string; name: string; matKhauTam: string } }>(
        '/admin/accounts',
        payload
      ),
    update: (id: number, payload: { name?: string; email?: string; plan?: string }) =>
      patch<{ data: TaiKhoanQuanTri }>(`/admin/accounts/${id}`, payload),
    setLocked: (id: number, locked: boolean) =>
      post<{ data: { id: number; is_active: boolean } }>(`/admin/accounts/${id}/lock`, { locked }),
    /** matKhau: quản trị tự đặt (≥8 ký tự); bỏ trống thì hệ thống sinh. */
    resetPassword: (id: number, matKhau?: string) =>
      post<{ data: { matKhauTam: string } }>(`/admin/accounts/${id}/reset-password`, matKhau ? { matKhau } : {}),
    /**
     * Chuyển một tài khoản đứng riêng thành tài khoản quản lý chuỗi.
     *
     * Dành cho tài khoản lập trước khi có luật "đăng ký là ra chủ chuỗi", hoặc
     * lập trúng lúc máy chủ đang chạy bản cũ. Máy chủ từ chối nếu tài khoản đã
     * có kênh, hội thoại, đơn hàng hay vai trò AI đã nhập.
     */
    thanhChuChuoi: (id: number) =>
      post<{ data: { id: number; email: string; hoSoDaDon: string | null; loiDonHoSo: string | null } }>(
        `/admin/accounts/${id}/thanh-chu-chuoi`
      ),
    remove: (id: number, confirmEmail: string) =>
      request<{ success: boolean }>(`/admin/accounts/${id}`, {
        method: 'DELETE',
        body: { confirmEmail },
      }),
  },

  auth: {
    me: () => get<{ user: User }>("/auth/me"),
    /**
     * Khi chạy thật, mật khẩu đúng chưa cấp phiên mà trả canMa + vé: mã 6 số
     * đã gửi vào email, gọi xacThuc(ve, ma) để vào.
     */
    login: (email: string, password: string) =>
      post<{ user?: User; canMa?: boolean; ve?: string; guiToi?: string }>("/auth/login", { email, password }),
    register: (email: string, password: string, name: string) =>
      post<{ user?: User; canMa?: boolean; ve?: string; guiToi?: string }>("/auth/register", { email, password, name }),
    /** Bước 2: gõ mã 6 số đã gửi vào email. */
    xacThuc: (ve: string, ma: string) => post<{ user: User }>("/auth/xac-thuc", { ve, ma }),
    logout: () => post<{ success: boolean }>("/auth/logout"),
    /** Đổi mật khẩu. Mọi phiên đăng nhập khác sẽ bị đăng xuất. */
    changePassword: (currentPassword: string, newPassword: string) =>
      post<{ success: boolean; message: string }>("/auth/change-password", {
        currentPassword,
        newPassword,
      }),
  },

  connections: {
    platforms: () => get<{ data: PlatformCatalog }>("/connections/platforms"),
    accounts: () => get<{ data: SocialAccount[] }>("/connections/accounts"),
    /**
     * Danh sách Trang chờ khách chọn, sau khi cấp quyền xong.
     * waiting = true nghĩa là chưa cấp quyền xong, cứ chờ tiếp.
     */
    pendingSelection: () =>
      get<{
        data: {
          waiting: boolean;
          platform?: string;
          step?: string;
          pages: Array<{
            id: string;
            name: string;
            username: string | null;
            category: string | null;
          }>;
        };
      }>("/connections/pending-selection"),
    /** Chốt các Trang đã chọn — đây là bước thật sự tạo kênh. */
    /** Các Trang một kênh Facebook vào được, kèm Trang đang gắn. */
    accountPages: (accountId: string) =>
      get<{
        data: {
          pages: Array<{ id: string; name: string; category?: string; fan_count?: number }>;
          selectedPageId: string | null;
        };
      }>(`/connections/accounts/${accountId}/pages`),
    /**
     * Đổi Trang đang gắn. Đây là ĐỔI chứ không phải thêm: Trang cũ sẽ ngừng
     * nhận tin nhắn và bình luận.
     */
    switchPage: (accountId: string, pageId: string) =>
      request<{ data: { selectedPage: { id: string; name: string } | null }; message?: string }>(
        `/connections/accounts/${accountId}/page`,
        { method: "PUT", body: { pageId } }
      ),
    selectPages: (pageIds: string[]) =>
      post<{ data: { connected: string[]; failed: Array<{ pageId: string; error: string }> } }>(
        "/connections/select-pages",
        { pageIds }
      ),
    sync: () => post<{ synced: number; data: SocialAccount[] }>("/connections/sync"),
    connectUrl: (platform: string) =>
      post<{ url: string }>("/connections/connect-url", { platform }),
    disconnect: (accountId: string) =>
      del<{ success: boolean }>(`/connections/accounts/${encodeURIComponent(accountId)}`),
    /*
     * availableProfiles / adoptProfile CỐ Ý KHÔNG có ở đây.
     *
     * Hai đường dẫn đó cho phép "nhận" một hồ sơ Zernio có sẵn. Đưa lên giao
     * diện là bắt khách phải biết Zernio tồn tại, đúng thứ phải tránh: khách
     * trả tiền cho mình mà nhìn thấy nhà cung cấp hạ tầng thì họ mua thẳng bên
     * đó. Giữ ở tầng máy chủ như công cụ nội bộ.
     */
  },

  inbox: {
    /**
     * Danh sách hội thoại, có phân trang.
     *
     * phanTrang.conNua cho biết còn hội thoại cũ hơn nữa hay đã hết — trước
     * đây câu lệnh cắt cứng ở 100 và không có đường xem tiếp, shop quá 100
     * hội thoại là mất phần cũ mà không dấu hiệu nào báo.
     */
    conversations: (
      params: {
        accountId?: string; status?: string; search?: string;
        boQua?: number; soDong?: number;
      } = {}
    ) => {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
      }
      const suffix = query.toString() ? `?${query}` : "";
      return get<{
        data: Conversation[];
        phanTrang: { boQua: number; soDong: number; conNua: boolean };
      }>(`/inbox/conversations${suffix}`);
    },
    counts: () => get<{ data: Record<string, number> }>("/inbox/counts"),
    detail: (id: string) =>
      get<{ data: ConversationDetail }>(`/inbox/conversations/${encodeURIComponent(id)}`),
    send: (id: string, text: string) =>
      post<{ data: Message }>(
        `/inbox/conversations/${encodeURIComponent(id)}/messages`,
        { text }
      ),
    setStatus: (id: string, status: ConversationStatus) =>
      patch<{ data: Conversation }>(
        `/inbox/conversations/${encodeURIComponent(id)}/status`,
        { status }
      ),
    sync: () => post<{ imported: number }>("/inbox/sync"),
  },

  dashboard: {
    stats: (range: "1d" | "7d" | "30d" = "7d") =>
      get<{
        stats: DashboardStats;
        recentOrders: Order[];
        urgentTasks: Array<{
          id: string;
          customer_name: string | null;
          handoff_reason: string | null;
          platform: string;
          last_message_at: string;
        }>;
        aiReport: { findings: string; recommendation: string } | null;
      }>(`/dashboard/stats?range=${range}`),
    /*
     * dashboard/chart CỐ Ý KHÔNG dùng: nó trả về đúng dữ liệu mà
     * analytics/overview đã trả (đơn và doanh thu theo ngày), và màn hình
     * Thống Kê đang vẽ từ nguồn đó. Hai nguồn cho cùng một biểu đồ là cách
     * chắc chắn để hai chỗ hiện hai con số khác nhau.
     */
    sparklines: () =>
      get<{ data: Array<{ id: number; label: string; value: string; data: number[] }> }>(
        "/dashboard/sparklines"
      ),
    activity: () =>
      get<{ data: Array<{ id: number; time: string; content: string; color: string }> }>(
        "/dashboard/activity"
      ),
  },

  orders: {
    list: (params: { status?: string; search?: string; soNgay?: string } = {}) => {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value) query.set(key, value);
      }
      const suffix = query.toString() ? `?${query}` : "";
      return get<{
        data: Order[];
        summary: {
          total: number;
          pending: number;
          shipping: number;
          completed: number;
          revenue: number;
        };
      }>(`/orders${suffix}`);
    },
    create: (payload: {
      conversationId?: string;
      customerName?: string;
      phone?: string;
      address?: string;
      product: string;
      quantity: number;
      unitPrice: number;
      note?: string;
      closedBy?: "ai" | "human";
    }) => post<{ data: Order }>("/orders", payload),
    update: (id: number, payload: Partial<Order> & { unitPrice?: number }) =>
      patch<{ data: Order }>(`/orders/${id}`, payload),
  },

  posts: {
    list: (status?: string) =>
      get<{
        data: Post[];
        summary: {
          pending_approval: number;
          scheduled: number;
          published: number;
          draft: number;
          failed: number;
        };
      }>(`/posts${status && status !== "all" ? `?status=${status}` : ""}`),
    create: (payload: {
      content: string;
      status?: PostStatus;
      scheduledFor?: string | null;
      targetAccountIds?: string[];
      media?: MediaItem[];
      aiGenerated?: boolean;
      aiPrompt?: string;
    }) => post<{ data: Post }>("/posts", payload),
    update: (
      id: number,
      payload: {
        content?: string;
        status?: PostStatus;
        scheduledFor?: string | null;
        targetAccountIds?: string[];
        media?: MediaItem[];
      }
    ) => patch<{ data: Post }>(`/posts/${id}`, payload),
    /**
     * Tải ảnh/video lên kho của Zernio.
     *
     * Server chỉ xin địa chỉ tải lên; chính trình duyệt gửi tệp thẳng tới kho,
     * nên video lớn không phải đi xuyên qua server.
     */
    uploadMedia: async (file: File): Promise<MediaItem> => {
      const { data } = await post<{
        data: { uploadUrl: string; publicUrl: string; type: MediaItem['type'] };
      }>("/posts/media/presign", {
        filename: file.name,
        contentType: file.type,
        size: file.size,
      });

      const uploaded = await fetch(data.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });

      if (!uploaded.ok) {
        throw new ApiError(
          `Tải tệp lên thất bại (HTTP ${uploaded.status}). Vui lòng thử lại.`,
          uploaded.status
        );
      }

      return { url: data.publicUrl, type: data.type };
    },
    /** Đăng thật lên các kênh đã chọn qua Zernio. */
    publish: (id: number) => post<{ data: Post }>(`/posts/${id}/publish`),
    /** Sửa phần chữ của bài ĐÃ ĐĂNG, ngay trên nền tảng. Không đổi được ảnh. */
    updateOnPlatform: (id: number, content: string) =>
      put<{ data: Post }>(`/posts/${id}/platform-content`, { content }),
    /** Gỡ bài khỏi nền tảng, đưa về bản nháp để sửa rồi đăng lại. */
    unpublish: (id: number) => post<{ data: Post }>(`/posts/${id}/unpublish`),
    /**
     * Hỏi lại nền tảng xem bài đang treo thật sự đã lên hay chưa.
     * Chỉ đọc — không đăng lại, nên bấm bao nhiêu lần cũng không tạo bài trùng.
     */
    recheck: (id: number) =>
      post<{ data: { found: boolean; message?: string; post?: Post } }>(
        `/posts/${id}/recheck`
      ),
    remove: (id: number) => del<{ success: boolean }>(`/posts/${id}`),
  },

  settings: {
    autoScripts: () => get<{ data: any[] }>("/settings/auto-scripts"),
    /** Bốn con số thật trên đầu màn hình Comment sang tin nhắn. */
    autoScriptStats: () =>
      get<{
        data: {
          activeScripts: number;
          postsCovered: number;
          firstDmSent: number;
          customersReplied: number;
          replyRate: number | null;
          ordersClosed: number;
          ordersDelta: number;
        };
      }>("/settings/auto-scripts/stats"),
    createAutoScript: (payload: Record<string, unknown>) =>
      post<{ data: any }>("/settings/auto-scripts", payload),
    updateAutoScript: (id: number, payload: Record<string, unknown>) =>
      patch<{ data: any }>(`/settings/auto-scripts/${id}`, payload),
    removeAutoScript: (id: number) =>
      del<{ success: boolean }>(`/settings/auto-scripts/${id}`),

    telegram: () =>
      get<{
        data: {
          hasToken: boolean;
          chatId: string;
          enabled: boolean;
          events: Record<string, boolean>;
          verifiedAt: string | null;
          usesPlatformBot: boolean;
          linkedAccountName: string | null;
          linkedAt: string | null;
          platformBotUsername: string | null;
          connected: boolean;
          logs: Array<{
            id: number;
            kind: string;
            content: string;
            status: string;
            error: string | null;
            created_at: string;
          }>;
        };
      }>("/settings/telegram"),
    /** Tạo liên kết một lần bấm; khách mở liên kết rồi bấm Start là xong. */
    linkTelegram: () =>
      post<{ data: { url: string; botUsername: string; code: string } }>("/settings/telegram/link"),
    unlinkTelegram: () => post<{ message: string }>("/settings/telegram/unlink"),
    saveTelegram: (payload: {
      botToken?: string;
      chatId?: string;
      enabled: boolean;
      events?: Record<string, boolean>;
    }) => request<{ data: unknown }>("/settings/telegram", { method: "PUT", body: payload }),
    testTelegram: () => post<{ message: string }>("/settings/telegram/test"),

    /**
     * Trạng thái hàng rào an toàn: hạn mức thật, mức đang dùng, kênh bị AI tự
     * tạm dừng, và lý do các tin bị chặn.
     */
    guardrails: () =>
      get<{
        data: {
          config: Record<string, number | boolean>;
          rateLimit: { perMinute: number; source: string; remaining: number | null; resetAt: string | null };
          usage: {
            sentLastMinute: number; aiSentLastHour: number;
            failureRateLastHour: number; totalLastHour: number; blockedLastDay: number;
          };
          pausedAccounts: Array<{
            id: string; display_name: string;
            ai_paused_until: string; ai_pause_reason: string;
          }>;
          blockedReasons: Array<{ block_reason: string; n: number }>;
        };
      }>("/settings/guardrails"),
    /**
     * Siết chặt hàng rào an toàn.
     *
     * Máy chủ tự kẹp mọi giá trị trong trần CHÍNH SÁCH của nền tảng — chủ shop
     * chỉ có thể làm chặt hơn, không bao giờ nới lỏng vượt mức cho phép.
     */
    saveGuardrails: (payload: {
      maxSendsPerMinute?: number;
      maxAiSendsPerHour?: number;
      failureRateThreshold?: number;
      autoPauseMinutes?: number;
      autoPauseEnabled?: boolean;
    }) => request<{ data: unknown }>("/settings/guardrails", { method: "PUT", body: payload }),
    /** Bật lại AI cho một kênh đang bị tạm dừng. */
    resumeAi: (accountId: string) =>
      post<{ success: boolean; message?: string }>(`/settings/guardrails/resume/${accountId}`),
    safety: () =>
      get<{
        data: {
          status: 'safe' | 'warning' | 'danger';
          sendRatePerMinute: number;
          sendRateLimit: number;
          messagesSent30d: number;
          messagesFailed30d: number;
          failRate: number;
          handoffRate: number;
          avgAiResponseSeconds: number | null;
          blockRate: null;
          blockRateNote: string;
        };
      }>("/settings/safety"),

    usage: () =>
      get<{
        data: {
          plan: string;
          usage: {
            connected_accounts: number;
            ai_messages_month: number;
            tokens_month: number;
            orders_month: number;
            posts_month: number;
          };
        };
      }>("/settings/usage"),
  },

  ads: {
    overview: (range = "last_7d") =>
      get<{
        data: {
          connected: boolean;
          account: {
            accountId: string;
            adAccountId: string;
            name: string;
            currency: string;
            status: number;
            timezone?: string;
            minDailyBudget?: number;
            amountSpent?: string | number;
          } | null;
          campaigns: Array<Record<string, unknown>>;
          insights: Record<string, unknown> | null;
          audiences: Array<Record<string, unknown>>;
          /** Mọi tài khoản quảng cáo kênh này vào được, để chủ shop chọn. */
          tatCaTaiKhoan?: Array<{
            id: string; name: string; currency: string; accountStatus: number;
          }>;
          /** Đang dùng tài khoản chủ shop chọn, hay hệ thống tự đoán. */
          doChuShopChon?: boolean;
        };
        message?: string;
      }>(`/ads/overview?range=${range}`),
    /**
     * Chọn tài khoản quảng cáo để chạy.
     *
     * Một kênh Meta Ads vào được nhiều tài khoản. Không chọn thì hệ thống tự
     * đoán, và đoán sai là trang quảng cáo trống trơn không rõ lý do.
     */
    chonTaiKhoanQuangCao: (adAccountId: string) =>
      put<{ data: { adAccountId: string } }>("/ads/tai-khoan-quang-cao", { adAccountId }),
    boostablePosts: () =>
      get<{ data: Post[] }>("/ads/boostable-posts"),
    setCampaignStatus: (campaignIds: string[], status: "ACTIVE" | "PAUSED" | "ARCHIVED") =>
      post<{ data: unknown }>("/ads/campaigns/status", { campaignIds, status }),
    /**
     * Sửa ngân sách ngay trong app, đi qua Zernio.
     *
     * Chiến dịch đặt ngân sách theo từng nhóm quảng cáo sẽ trả lỗi 409 kèm lời
     * giải thích, không phải lỗi kỹ thuật.
     */
    updateCampaignBudget: (
      id: string,
      payload: { amount: number; budgetType?: "daily" | "lifetime"; platform?: string },
    ) => patch<{ data: unknown }>(`/ads/campaigns/${id}/budget`, payload),
    /**
     * Các nhóm quảng cáo bên trong một chiến dịch.
     *
     * Chiến dịch đặt ngân sách theo nhóm thì sửa ở cấp chiến dịch bị từ chối,
     * và máy chủ bảo "mở chiến dịch và sửa ngân sách của nhóm bên trong" —
     * nhưng trước đây không có đường nào để mở nhóm ra. Lời chỉ dẫn dẫn vào
     * ngõ cụt.
     */
    adSets: (campaignId: string, platform = 'facebook') =>
      get<{ data: Array<Record<string, unknown>> }>(
        `/ads/campaigns/${encodeURIComponent(campaignId)}/ad-sets?platform=${platform}`
      ),
    updateAdSetBudget: (
      id: string,
      payload: { amount: number; budgetType?: 'daily' | 'lifetime'; platform?: string },
    ) => patch<{ data: unknown }>(`/ads/ad-sets/${encodeURIComponent(id)}/budget`, payload),
    updateAudience: (id: string, payload: { name?: string; description?: string }) =>
      request<{ data: unknown }>(`/ads/audiences/${id}`, { method: "PUT", body: payload }),
    duplicateCampaign: (id: string) =>
      post<{ data: unknown }>(`/ads/campaigns/${encodeURIComponent(id)}/duplicate`),
    campaignAnalytics: (id: string, range = "last_7d") =>
      get<{ data: Record<string, unknown> }>(
        `/ads/campaigns/${encodeURIComponent(id)}/analytics?range=${range}`
      ),
    boost: (payload: {
      postId: number;
      dailyBudget: number;
      durationDays: number;
      objective?: string;
      targeting?: Record<string, unknown>;
    }) => post<{ data: unknown }>("/ads/boost", payload),
    createAudience: (payload: {
      name: string;
      subtype: string;
      description?: string;
      extra?: Record<string, unknown>;
    }) => post<{ data: unknown }>("/ads/audiences", payload),
    reachEstimate: (targeting: Record<string, unknown>) =>
      post<{ data: Record<string, unknown> }>("/ads/reach-estimate", { targeting }),
    analyze: () =>
      post<{
        data: {
          hasData: boolean;
          findings: string;
          recommendation: string;
          actions: string[];
        };
      }>("/ads/analyze"),
  },

  analytics: {
    overview: (range = "7days") =>
      get<{
        days: number;
        stats: {
          revenue: number; ordersCount: number; conversationsCount: number;
          closeRate: number; aiMessages: number; aiClosed: number;
          handoffs: number; newCustomers: number; leadsWithPhone: number;
        };
        trends: Record<string, number | null>;
        series: Array<{ name: string; revenue: number; orders: number; aiInteractions: number }>;
        sources: Array<{ name: string; value: number; count: number }>;
      }>(`/analytics/overview?range=${range}`),
    analyze: (range = "7days") =>
      post<{
        data: { hasData: boolean; findings: string; recommendation: string; actions: string[] };
      }>("/analytics/analyze", { range }),
    reports: () =>
      get<{ data: Array<{ report_date: string; findings: string; recommendation: string }> }>(
        "/analytics/reports"
      ),
  },

  /**
   * Quản lý chuỗi trang — chỉ tài khoản 'admin_con' dùng tới.
   *
   * Mỗi trang là một TÀI KHOẢN RIÊNG, độc lập hoàn toàn. Không có lệnh nào ở
   * đây đọc hay ghi dữ liệu bên trong một trang; muốn làm việc trong trang thì
   * bấm "mở" để bước hẳn vào tài khoản đó.
   */
  quanLy: {
    /** Tổng quan tài sản: tài khoản → trang → tiền từng loại. Cùng một đường cho cả hai tầng. */
    tongQuan: (ky: KyTongQuan) => get<{ data: TongQuanQuanLy }>(`/quan-ly/tong-quan?ky=${ky}`),
    /** Sức khoẻ từng khâu của một trang (thống kê, không AI). */
    sucKhoe: (trangId: number) => get<{ data: SucKhoeTrang }>(`/quan-ly/suc-khoe?trangId=${trangId}`),
    /** AI điều hành (chạy thử): sổ bằng chứng — chỉ đọc, không tốn tiền. */
    dieuHanhSo: (trangId: number) => get<{ data: SoDieuHanh }>(`/quan-ly/dieu-hanh/so?trangId=${trangId}`),
    /** Chạy thử MỘT lần (tốn tiền AI). vanDe rỗng = hệ thống tự chọn vấn đề từ bảng sức khoẻ. */
    dieuHanhChay: (trangId: number, vanDe: string) =>
      post<{ data: { id: number; ketQua: string; soLuotAi: number; tienUsd: number; giay: number } }>("/quan-ly/dieu-hanh/chay", { trangId, vanDe }),
    dieuHanhDeXuat: (trangId: number) => get<{ data: DeXuatDieuHanh[] }>(`/quan-ly/dieu-hanh/de-xuat?trangId=${trangId}`),
    dieuHanhQuyet: (id: number, duyet: boolean, lyDo?: string, chiDao?: { ai: string; noiDung: string }[]) =>
      post<{ success: true }>(`/quan-ly/dieu-hanh/de-xuat/${id}/quyet`, { duyet, lyDo, chiDao }),
    /** Báo cáo chuỗi 4 khâu của một trang. */
    baoCaoChuoi: (trangId: number, ky: KyTongQuan) =>
      get<{ data: BaoCaoChuoi }>(`/quan-ly/bao-cao-chuoi?trangId=${trangId}&ky=${ky}`),
    /** Sao kê từng lượt AI của một trang. */
    saoKeTrang: (trangId: number, ky: KyTongQuan, trang: number) =>
      get<{ data: { luot: LuotChiPhi[]; tongLan: number; tongUsd: number; trang: number; soTrang: number } }>(
        `/quan-ly/sao-ke-trang?trangId=${trangId}&ky=${ky}&trang=${trang}`
      ),
    trang: () => get<{ data: TrangCon[] }>("/quan-ly/trang"),
    /** Màn hình quản lý dùng chung: chính mình + các trang — cùng bộ cột với quản trị tổng. */
    danhSach: () => get<{ data: TaiKhoanQuanLy[] }>("/quan-ly/danh-sach"),
    nhatKy: () => get<{ data: NhatKyQuanTri[] }>("/quan-ly/nhat-ky"),
    /** Chi phí tháng này của chuỗi — cùng dạng với chi phí hệ thống. */
    chiPhi: (ngay = 0) => get<{ data: SaoKeChiPhi }>(`/quan-ly/chi-phi?ngay=${ngay}`),
    luotChiPhi: (loc: LocLuot) => {
      const q = new URLSearchParams({ ngay: String(loc.ngay ?? 0), trang: String(loc.trang ?? 1) });
      if (loc.tk !== undefined) q.set('tk', String(loc.tk));
      if (loc.kemCon) q.set('kemCon', '1');
      if (loc.nhom) q.set('nhom', loc.nhom);
      if (loc.viec) q.set('viec', loc.viec);
      return get<{ data: { luot: LuotChiPhi[]; tongLan: number; tongUsd: number; trang: number; soTrang: number } }>(
        `/quan-ly/chi-phi/luot?${q}`
      );
    },
    /** Báo cáo chi tiết một trang, xem ngay tại tài khoản quản lý. */
    baoCao: (id: number, ngay: number) =>
      get<{ data: BaoCaoTrang }>(`/quan-ly/trang/${id}/bao-cao?ngay=${ngay}`),
    /** matKhau: tự đặt (≥8 ký tự); bỏ trống thì hệ thống sinh. */
    lapTrang: (ten: string, matKhau?: string) =>
      post<{ data: { id: number; tenDangNhap: string; name: string; matKhauTam: string } }>(
        "/quan-ly/trang",
        matKhau ? { ten, matKhau } : { ten }
      ),
    doiTen: (id: number, ten: string) =>
      patch<{ data: { id: number; name: string } }>(`/quan-ly/trang/${id}`, { ten }),
    khoa: (id: number, khoa: boolean) =>
      post<{ data: { id: number; is_active: boolean } }>(`/quan-ly/trang/${id}/khoa`, { khoa }),
    /** Bỏ trống matKhau thì hệ thống sinh ngẫu nhiên. */
    capLaiMatKhau: (id: number, matKhau?: string) =>
      post<{ data: { id: number; matKhauTam: string } }>(
        `/quan-ly/trang/${id}/mat-khau`,
        matKhau ? { matKhau } : {}
      ),
    doiTenDangNhap: (id: number, ten: string) =>
      patch<{ data: { id: number; tenDangNhap: string } }>(
        `/quan-ly/trang/${id}/ten-dang-nhap`,
        { ten }
      ),
    /** Xoá hẳn một trang. Phải gõ đúng tên trang để xác nhận. */
    xoaTrang: (id: number, xacNhanTen: string) =>
      request<{ data: { loiXoaHoSo: string | null } }>(`/quan-ly/trang/${id}`, {
        method: 'DELETE',
        body: { xacNhanTen },
      }),
    moTrang: (id: number) =>
      post<{ data: { id: number; name: string } }>(`/quan-ly/trang/${id}/mo`),
    quayLai: () => post<{ data: { id: number; name: string } }>("/quan-ly/quay-lai"),
  },

  ai: {
    config: (kind: string) =>
      get<{ data: { config: AiConfig; documents: AiDocument[]; model: string } }>(
        `/ai/configs/${kind}`
      ),
    saveConfig: (
      kind: string,
      payload: { systemPrompt: string; tone?: string; settings?: Record<string, unknown> }
    ) => request<{ data: AiConfig }>(`/ai/configs/${kind}`, { method: "PUT", body: payload }),
    salesAutonomy: () => get<{ data: { config: TuChuConfig } }>("/ai/sales-autonomy"),
    saveSalesAutonomy: (config: TuChuConfig) =>
      request<{ data: { config: TuChuConfig; hoiThoaiDaCuu?: number } }>("/ai/sales-autonomy", {
        method: "PUT",
        body: { config },
      }),
    salesStages: () => get<{ data: { stages: SalesStage[] } }>("/ai/sales-stages"),
    saveSalesStages: (stages: SalesStage[]) =>
      request<{ data: { stages: SalesStage[] } }>("/ai/sales-stages", {
        method: "PUT",
        body: { stages },
      }),
    autoPilot: () =>
      get<{ data: { config: AutoPilotConfig; runs: AutoPilotRun[]; tienVideoThang: number } }>("/ai/auto-pilot"),
    saveAutoPilot: (config: AutoPilotConfig) =>
      request<{ data: { config: AutoPilotConfig } }>("/ai/auto-pilot", {
        method: "PUT",
        body: { config },
      }),
    /** Lưu vài khoá trong settings mà không đè phần vai trò đã nhập. */
    patchSettings: (kind: string, settings: Record<string, unknown>) =>
      patch<{ data: AiConfig }>(`/ai/configs/${kind}/settings`, { settings }),
    addDocument: (
      kind: string,
      payload: {
        filename: string;
        mimeType?: string;
        text?: string;
        sizeBytes?: number;
        /** Ảnh dạng data URL. Máy chủ đọc chữ trong ảnh rồi lưu phần chữ đó. */
        imageDataUrl?: string;
      }
    ) => post<{ data: AiDocument }>(`/ai/configs/${kind}/documents`, payload),
    removeDocument: (kind: string, id: number) =>
      del<{ success: boolean }>(`/ai/configs/${kind}/documents/${id}`),
    generatePost: (topic: string, goal: string, count = 1) =>
      post<{ options: string[]; usage: { costUsd: number } }>("/ai/generate-post", {
        topic,
        goal,
        count,
      }),
    /** AI tạo ảnh minh hoạ cho bài. Mỗi lượt tốn tiền nên chỉ gọi khi chủ shop bấm. */
    generateImage: (payload: {
      /** Chữ trong ảnh: theo yêu cầu, hoặc không có chữ. */
      chuTrongAnh?: ChuTrongVideo;
      chanNhanHieuGia?: boolean;
      chanNguoiThat?: boolean;
      /** Vẽ lại từ ảnh mẫu: xoá watermark và chữ chèn thêm. */
      xoaWatermark?: boolean;
      /** Mô hình và thông số người dùng chọn. */
      model: string;
      doNet?: string;
      chatLuong?: string;
      khung?: string;
      content: string;
      /** Mô tả riêng cho ảnh này. Bỏ trống thì AI dựa vào nội dung bài. */
      prompt?: string;
      style?: string;
      /** Ảnh mẫu để AI vẽ lại theo phong cách mới, giữ nguyên chủ thể. */
      sample?: string;
    }) =>
      post<{
        data: {
          url: string; type: 'image'; model: string; costUsd: number;
          moTa: string; phongCach: string; tuAnhMau: boolean;
        };
      }>('/ai/generate-image', payload),
    /** Thư viện ảnh sản phẩm / nhân vật của Trang. */
    thuVien: () => get<{ data: MucThuVien[] }>('/ai/thu-vien'),
    themThuVien: (payload: { loai: LoaiThuVien; ten: string; url: string }) =>
      post<{ data: MucThuVien }>('/ai/thu-vien', payload),
    /** Đưa ảnh thư viện lên kho, trả địa chỉ dùng được làm ảnh mẫu / ảnh tham chiếu. */
    dungThuVien: (id: number) => post<{ data: { url: string } }>(`/ai/thu-vien/${id}/dung`),
    xoaThuVien: (id: number) => del<{ success: boolean }>(`/ai/thu-vien/${id}`),
    /** Mô hình vẽ ảnh kèm giá một ảnh, xếp rẻ tới đắt. */
    imageModels: (coAnhMau = false) =>
      get<{ data: { models: ModelAnh[]; nguon: string } }>(`/ai/image/models?coAnhMau=${coAnhMau}`),
    /** Phong cách vẽ ảnh đang đặt. */
    imageStyle: () => get<{ data: { phongCach: string; macDinh: string } }>('/ai/image-style'),
    /** Lưu phong cách vẽ ảnh làm mặc định cho lần sau và cho lịch tự đăng. */
    saveImageStyle: (phongCach: string) =>
      patch<{ success: boolean }>('/ai/configs/content/settings', {
        settings: { anhPhongCach: phongCach },
      }),
    /** Model video kèm giá cho đúng lựa chọn, xếp rẻ tới đắt. */
    videoModels: (lc: LuaChonVideo, duAn?: LuaChonBaoGiaDai) => {
      const q = new URLSearchParams({
        soGiay: String(lc.soGiay),
        doNet: lc.doNet,
        khung: lc.khung,
        coTieng: String(lc.coTieng),
        coAnhMoDau: String(lc.coAnhMoDau),
        ...(duAn ? Object.fromEntries(Object.entries(duAn).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])) : {}),
      });
      return get<{
        data: { luaChon: LuaChonVideo; models: ModelVideo[]; mucDich: Record<string, string> };
      }>(`/ai/video/models?${q}`);
    },
    /** AI viết lời mô tả video từ nội dung bài. */
    videoLoiMoTa: (payload: {
      noiDung: string;
      mucDich: string;
      soGiay: number;
      coAnhMoDau: boolean;
      chuTrongVideo?: ChuTrongVideo;
      chanNhanHieuGia?: boolean;
      cauTrucQuangCao?: boolean;
      giuSuThat?: boolean;
      boiCanhVietNam?: boolean;
    }) =>
      post<{ data: { loiMoTa: string; tomTat: string } }>('/ai/video/loi-mo-ta', payload),
    /** Gửi việc tạo video; trả về ngay, video xong sau vài phút. */
    taoVideo: (payload: LuaChonVideo & { model: string; loiMoTa: string; anhMoDau?: string }) =>
      post<{ data: ViecVideo }>('/ai/video', payload),
    /** Video "theo bài": bài chờ video xong rồi tự đăng (hoặc giao lịch nếu đã hẹn giờ). */
    videoTheoBai: (
      payload: LuaChonVideo & { postId: number; model: string; noiDung: string; mucDich: string } & Record<string, unknown>
    ) => post<{ data: { videoId: number; gia: number } }>('/ai/video/theo-bai', payload),
    /** Các video của trang đang chọn, mới nhất trước. */
    videoViec: () => get<{ data: ViecVideo[] }>('/ai/video/viec'),
    /** AI chia ý tưởng thành cảnh và báo giá — chưa tạo video. */
    taoDuAnVideo: (payload: {
      loai: DuAnVideo['loai'];
      yTuong: string;
      tongGiay: number;
      model: string;
      doNet: string;
      khung: string;
      coTieng: boolean;
      anhThamChieu?: string[];
      congThucTrend?: string;
      amThanh?: AmThanhVideo;
      tuKiem?: boolean;
      cheDo?: CheDoVideoDai;
    }) => post<{ data: DuAnVideo }>('/ai/video/du-an', payload),
    /** Sửa phân cảnh khi còn là nháp. */
    suaDuAnVideo: (id: number, payload: { nhatQuan: string; phanCanh: CanhVideo[]; amThanh?: AmThanhVideo }) =>
      request<{ data: DuAnVideo }>(`/ai/video/du-an/${id}`, { method: 'PUT', body: payload }),
    /** Duyệt phân cảnh và bắt đầu tạo — từ đây mới tốn tiền video. */
    batDauDuAnVideo: (id: number) => post<{ data: DuAnVideo }>(`/ai/video/du-an/${id}/bat-dau`),
    /** Dự án bị lỗi: làm tiếp, giữ các cảnh đã tạo (đủ cảnh thì chỉ ghép lại). */
    tiepTucDuAnVideo: (id: number) => post<{ data: DuAnVideo }>(`/ai/video/du-an/${id}/tiep-tuc`),
    /** Các dự án video dài của trang. */
    duAnVideo: () => get<{ data: DuAnVideo[] }>('/ai/video/du-an'),
    /** Model sửa video (video → video), xếp rẻ tới đắt. */
    modelSuaVideo: () => get<{ data: ModelSuaVideo[] }>('/ai/video/sua/models'),
    /** Sửa một video có sẵn theo yêu cầu. */
    suaVideo: (payload: { model: string; videoNguon: string; yeuCau: string; chanNhanHieuGia?: boolean; chanNguoiThat?: boolean }) =>
      post<{ data: ViecVideo }>('/ai/video/sua', payload),
    /** AI xem video trend và rút ra công thức. */
    phanTichTrend: (videoNguon: string) =>
      post<{ data: { congThuc: string; tomTat: string[] } }>('/ai/video/trend/phan-tich', { videoNguon }),
    test: (kind: string, message: string) =>
      post<{ data: { reply: string; model: string; usage: { costUsd: number } } }>("/ai/test", {
        kind,
        message,
      }),
    handoffRules: () =>
      get<{ data: Array<{ rule_key: string; enabled: boolean; config: Record<string, unknown> }> }>(
        "/ai/handoff-rules"
      ),
    setHandoffRule: (key: string, enabled: boolean, config?: Record<string, unknown>) =>
      patch<{ data: { rule_key: string; enabled: boolean } }>(`/ai/handoff-rules/${key}`, {
        enabled,
        config: config ?? {},
      }),
    extract: (conversationId: string) =>
      post<{
        data: {
          name: string | null;
          phone: string | null;
          address: string | null;
          product: string | null;
          quantity: string | null;
        };
      }>(`/ai/conversations/${encodeURIComponent(conversationId)}/extract`),
    suggest: (conversationId: string) =>
      post<{ data: { reply: string } }>(
        `/ai/conversations/${encodeURIComponent(conversationId)}/suggest`
      ),
  },
};

// ---------------------------------------------------------------------------
// Tiện ích hiển thị
// ---------------------------------------------------------------------------

const currency = new Intl.NumberFormat("vi-VN");

export function formatCurrency(value: number | string | null | undefined): string {
  const amount = Number(value ?? 0);
  return `${currency.format(Number.isFinite(amount) ? amount : 0)} đ`;
}

/** Khoảng thời gian dạng "5 phút trước", dùng cho danh sách hội thoại. */
export function timeAgo(value: string | Date | null | undefined): string {
  if (!value) return "";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";

  const seconds = Math.floor((Date.now() - then) / 1_000);
  if (seconds < 60) return "vừa xong";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} phút trước`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} giờ trước`;
  if (seconds < 2_592_000) return `${Math.floor(seconds / 86_400)} ngày trước`;
  return new Date(value).toLocaleDateString("vi-VN");
}

/** Thời gian còn lại của cửa sổ nhắn tin 24 giờ. */
export function windowRemaining(expiresAt: string | null): string {
  if (!expiresAt) return "";
  const remaining = new Date(expiresAt).getTime() - Date.now();
  if (remaining <= 0) return "Đã quá 24 giờ";
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  return hours > 0 ? `Còn ${hours} giờ ${minutes} phút` : `Còn ${minutes} phút`;
}

export const ORDER_STATUS_LABELS: Record<Order["status"], string> = {
  pending: "Chờ xác nhận",
  confirmed: "Đã xác nhận",
  shipping: "Đang giao",
  completed: "Hoàn tất",
  cancelled: "Đã huỷ",
};

export const CONVERSATION_STATUS_LABELS: Record<ConversationStatus, string> = {
  ai: "AI đang tư vấn",
  waiting_human: "Chờ nhân viên",
  human: "Nhân viên đang xử lý",
  done: "Đã xong",
};
