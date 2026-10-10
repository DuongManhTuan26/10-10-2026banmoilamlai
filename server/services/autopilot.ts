/**
 * Bộ tự động viết và đăng bài theo lịch.
 *
 * Đây là phần làm cho thẻ "AI tự đăng luôn" nói đúng sự thật. Trước đó thẻ ấy
 * chỉ bỏ bước duyệt khi chủ shop TỰ mở ô soạn bài; không có gì tự chạy.
 *
 * Ba chốt chặn, theo thứ tự quan trọng:
 *
 *  1. MỖI Ô LỊCH CHỈ CHẠY MỘT LẦN. Worker quét 5 giây một lượt và có thể chạy
 *     nhiều bản song song. Trước khi gọi AI, hàm này giành chỗ bằng một dòng
 *     trong auto_pilot_runs có khoá duy nhất (trang_id, slot_key). Ai chèn được
 *     mới được làm; những lượt còn lại thấy xung đột và đi tiếp.
 *
 *  2. KHÔNG ĐĂNG BÙ. Máy chủ tắt qua đêm rồi bật lại lúc 11 giờ trưa thì bài
 *     của khung 8 giờ sáng KHÔNG được đăng — đăng một bài "chào buổi sáng" lúc
 *     trưa còn tệ hơn là không đăng. Chỉ nhận ô lịch vừa tới trong CUA_SO_MS.
 *
 *  3. KHÔNG VIẾT LẶP. Vài bài gần nhất được đưa vào lời nhắc để AI tránh viết
 *     na ná. Vừa vì người đọc, vừa vì Zernio chặn trùng nội dung trong 24 giờ
 *     và Facebook coi đăng lặp là dấu hiệu tài khoản máy.
 */

import { query, queryOne } from "../db.js";
import { generatePostContent } from "./content-ai.js";
import { publishPost } from "./publish.js";
import { layDanhSachModelAnh, taoAnhChoBai } from "./image-ai.js";
import { AppError } from "../http.js";
import {
  giaVideo,
  layDanhSachModel,
  lyDoKhongHop,
  taoVideo,
  vietLoiMoTaVideo,
  type HuongKichBan,
  type LuaChonVideo,
} from "./video-ai.js";
import { sendTelegramMessage, escapeHtml } from "./telegram.js";
import { gioiHanChatNhat } from "../../src/lib/gioi-han-kenh.js";
import { chayChoTrang } from "./ngu-canh-trang.js";

/** Toàn bộ lịch tính theo giờ Việt Nam: sản phẩm bán cho chủ shop Việt Nam. */
const VN_OFFSET_MS = 7 * 60 * 60 * 1_000;

/**
 * Bề rộng cửa sổ nhận một ô lịch: 20 phút.
 *
 * Đủ rộng để một lần khởi động lại hay một nhịp mạng chập không làm mất bài
 * của cả ngày, đủ hẹp để không bao giờ đăng bù một khung giờ đã trôi qua lâu.
 */
const CUA_SO_MS = 20 * 60_000;

export interface AutoPilotConfig {
  enabled: boolean;
  /** 0 = Chủ nhật … 6 = Thứ bảy. */
  days: number[];
  /** Các khung giờ trong ngày, dạng "HH:MM" giờ Việt Nam. */
  times: string[];
  topics: string[];
  goal: string;
  /** publish = đăng thẳng · notify = báo Telegram rồi đăng · approve = chờ duyệt. */
  guard: "publish" | "notify" | "approve";
  /** Số phút chờ trước khi tự đăng, chỉ dùng cho guard = "notify". */
  notifyMinutes: number;
  /** Kênh sẽ đăng. Rỗng nghĩa là mọi kênh đang kết nối. */
  accountIds: string[];
  /** Tự vẽ ảnh theo nội dung từng bài AI viết, đăng kèm bài (chủ dự án 03/10/2026). Tắt thì không có ảnh. */
  anh: AnhTuDong;
  /**
   * Tự tạo video theo nội dung bài, đăng kèm — cùng cơ chế công tắc như ảnh (chủ dự án 03/10/2026, đổi quyết
   * định trước "không cho video vào tự động"). Bật cả hai thì đăng cả ảnh và video; tắt cả hai thì chỉ chữ.
   * Có TRẦN TIỀN MỖI THÁNG do người dùng nhập; video lỗi / quá lâu / chạm trần → đăng kèm ẢNH THAY THẾ.
   */
  video: VideoTuDong;
}

export interface VideoTuDong {
  bat: boolean;
  /** Mô hình video người dùng chọn. Rỗng = chưa chọn → không tạo. */
  model: string;
  soGiay: number;
  doNet: string;
  khung: string;
  coTieng: boolean;
  /** Mục đích video (MUC_DICH_VIDEO) — để AI viết lời nhắc video từ bài. */
  mucDich: string;
  chuTrongVideo: "theo_noi_dung" | "khong";
  chanNhanHieuGia: boolean;
  chanNguoiThat: boolean;
  /** Trần tiền video tự động mỗi tháng (USD). 0 = chưa đặt → không bật được. */
  tranThangUsd: number;
}

export function docVideoTuDong(raw: unknown): VideoTuDong {
  const o = (raw ?? {}) as Record<string, unknown>;
  const chuoi = (v: unknown) => (typeof v === "string" && /^[\w.:/-]{1,80}$/.test(v) ? v : undefined);
  const so = (v: unknown, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
  };
  return {
    bat: o.bat === true,
    model: chuoi(o.model) ?? "",
    soGiay: Math.round(so(o.soGiay, 2, 30) ?? 8),
    doNet: chuoi(o.doNet) ?? "720p",
    khung: typeof o.khung === "string" && /^\d{1,2}:\d{1,2}$/.test(o.khung) ? o.khung : "9:16",
    coTieng: o.coTieng === true,
    mucDich: chuoi(o.mucDich) ?? "khoe_san_pham",
    chuTrongVideo: o.chuTrongVideo === "khong" ? "khong" : "theo_noi_dung",
    chanNhanHieuGia: o.chanNhanHieuGia === true,
    chanNguoiThat: o.chanNguoiThat === true,
    tranThangUsd: Math.round((so(o.tranThangUsd, 0, 10_000) ?? 0) * 100) / 100,
  };
}

export interface AnhTuDong {
  bat: boolean;
  /** Mô hình và thông số người dùng chọn (model-anh.ts). Rỗng = chưa chọn → không vẽ. */
  model: string;
  doNet?: string;
  chatLuong?: string;
  khung?: string;
  chuTrongAnh: "theo_noi_dung" | "khong";
  chanNhanHieuGia: boolean;
  chanNguoiThat: boolean;
}

export function docAnhTuDong(raw: unknown): AnhTuDong {
  const o = (raw ?? {}) as Record<string, unknown>;
  const chuoi = (v: unknown) => (typeof v === "string" && /^[\w.:/-]{1,80}$/.test(v) ? v : undefined);
  return {
    bat: o.bat === true,
    model: chuoi(o.model) ?? "",
    doNet: chuoi(o.doNet),
    chatLuong: chuoi(o.chatLuong),
    khung: chuoi(o.khung),
    chuTrongAnh: o.chuTrongAnh === "khong" ? "khong" : "theo_noi_dung",
    chanNhanHieuGia: o.chanNhanHieuGia === true,
    chanNguoiThat: o.chanNguoiThat === true,
  };
}

export const MAC_DINH: AutoPilotConfig = {
  enabled: false,
  days: [1, 3, 5],
  times: ["08:00"],
  topics: [],
  goal: "sales",
  // Mặc định an toàn nhất: không có gì lên Fanpage khi chủ shop chưa xem.
  guard: "approve",
  notifyMinutes: 30,
  accountIds: [],
  anh: docAnhTuDong({}),
  video: docVideoTuDong({}),
};

/** Đọc cấu hình từ JSONB, bỏ qua mọi giá trị rác thay vì tin vào nó. */
export function docCauHinh(raw: unknown): AutoPilotConfig {
  const o = (raw ?? {}) as Record<string, unknown>;
  const soNguyen = (v: unknown, min: number, max: number, mac: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : mac;
  };

  /*
   * Không có trường days thì dùng mặc định; có nhưng RỖNG thì giữ nguyên rỗng.
   *
   * Trước đây rỗng cũng bị thay bằng mặc định, nghĩa là chủ shop bỏ hết ngày mà
   * hệ thống vẫn âm thầm đặt lại T2/T4/T6 — họ tưởng đã tắt, bài vẫn lên.
   * Rỗng phải giữ đúng nghĩa rỗng, rồi chặn ở chỗ lưu với lời giải thích.
   */
  const days = Array.isArray(o.days)
    ? [...new Set(o.days.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))]
    : MAC_DINH.days;

  const times = Array.isArray(o.times)
    ? [...new Set(o.times.filter((t): t is string => typeof t === "string" && /^\d{2}:\d{2}$/.test(t)))]
        .filter((t) => Number(t.slice(0, 2)) <= 23 && Number(t.slice(3)) <= 59)
        .sort()
    : MAC_DINH.times;

  const topics = Array.isArray(o.topics)
    ? o.topics
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim())
        .filter((t) => t !== "")
    : [];

  const guard =
    o.guard === "publish" || o.guard === "notify" || o.guard === "approve"
      ? o.guard
      : MAC_DINH.guard;

  return {
    enabled: o.enabled === true,
    days,
    times: times.length ? times : MAC_DINH.times,
    topics,
    goal:
      o.goal === "sales" || o.goal === "engagement" || o.goal === "announcement"
        ? o.goal
        : MAC_DINH.goal,
    guard,
    notifyMinutes: soNguyen(o.notifyMinutes, 5, 24 * 60, MAC_DINH.notifyMinutes),
    accountIds: Array.isArray(o.accountIds)
      ? o.accountIds.filter((v): v is string => typeof v === "string")
      : [],
    anh: docAnhTuDong(o.anh),
    video: docVideoTuDong(o.video),
  };
}

const hai = (n: number) => String(n).padStart(2, "0");

function ngayVN(luc: Date): { khoaNgay: string; thu: number } {
  const t = new Date(luc.getTime() + VN_OFFSET_MS);
  return {
    khoaNgay: `${t.getUTCFullYear()}-${hai(t.getUTCMonth() + 1)}-${hai(t.getUTCDate())}`,
    thu: t.getUTCDay(),
  };
}

/** Thời điểm thật (UTC) của một khung giờ Việt Nam trong một ngày Việt Nam. */
function mocCuaKhung(khoaNgay: string, gio: string): Date {
  return new Date(Date.parse(`${khoaNgay}T${gio}:00.000Z`) - VN_OFFSET_MS);
}

/**
 * Các ô lịch đang tới hạn ngay lúc này.
 *
 * Xét cả hôm nay và hôm qua theo giờ Việt Nam, vì một khung giờ sát nửa đêm có
 * thể vẫn nằm trong cửa sổ khi ngày đã sang hôm sau.
 */
export function oLichToiHan(cau: AutoPilotConfig, bayGio: Date): Array<{ khoa: string; gio: string }> {
  const ra: Array<{ khoa: string; gio: string }> = [];

  for (const lui of [0, 1]) {
    const { khoaNgay, thu } = ngayVN(new Date(bayGio.getTime() - lui * 86_400_000));
    if (!cau.days.includes(thu)) continue;

    for (const gio of cau.times) {
      const moc = mocCuaKhung(khoaNgay, gio).getTime();
      const cach = bayGio.getTime() - moc;
      if (cach >= 0 && cach <= CUA_SO_MS) {
        ra.push({ khoa: `${khoaNgay} ${gio}`, gio });
      }
    }
  }
  return ra;
}

interface DongCauHinh {
  user_id: number;
  /** Trang mà lịch đăng này thuộc về. Mỗi Trang một lịch, một văn phong. */
  trang_id: number | null;
  settings: Record<string, unknown>;
}

/**
 * Quét mọi shop đã bật tự động và làm những ô lịch tới hạn.
 *
 * Trả về số bài đã dựng để worker ghi nhật ký.
 */
export async function runDueAutoPilot(bayGio = new Date()): Promise<number> {
  /*
   * Quét theo TRANG, không theo tài khoản.
   *
   * Mỗi Trang có lịch đăng và văn phong riêng. Gom theo tài khoản thì tài
   * khoản nhiều Trang chỉ chạy được lịch của một Trang.
   */
  const shops = await query<DongCauHinh>(
    `SELECT user_id, trang_id, settings FROM ai_configs
      WHERE kind = 'content' AND trang_id IS NOT NULL AND settings->'autoPilot'->>'enabled' = 'true'`
  );

  let daLam = 0;
  for (const shop of shops.rows) {
    const cau = docCauHinh(shop.settings.autoPilot);
    if (!cau.enabled) continue;

    for (const o of oLichToiHan(cau, bayGio)) {
      /*
       * Giành chỗ TRƯỚC khi gọi AI.
       *
       * Gọi AI rồi mới ghi thì hai lượt quét song song sẽ cùng viết bài và
       * Fanpage có hai bài. Ghi trước thì lượt thua cuộc dừng ngay tại đây.
       */
      const cho = await queryOne<{ id: number }>(
        `INSERT INTO auto_pilot_runs (user_id, trang_id, slot_key, status)
         VALUES ($1, $3, $2, 'running')
         ON CONFLICT (trang_id, slot_key) DO NOTHING
         RETURNING id`,
        [shop.user_id, o.khoa, shop.trang_id]
      );
      if (!cho) continue;

      try {
        const trangId = shop.trang_id!;
        const xong = await chayChoTrang(trangId, () => lamMotO(shop.user_id, trangId, cau, cho.id, o.khoa));
        if (xong) daLam += 1;
      } catch (error) {
        const loi = error instanceof Error ? error.message : String(error);
        await query(
          `UPDATE auto_pilot_runs SET status = 'failed', note = $2 WHERE id = $1`,
          [cho.id, loi.slice(0, 1_000)]
        );
        console.error(`[tự động] Shop ${shop.user_id}, ô ${o.khoa}: ${loi}`);
      }
    }
  }
  return daLam;
}

async function lamMotO(
  userId: number,
  trangId: number,
  cau: AutoPilotConfig,
  runId: number,
  khoa: string
): Promise<boolean> {
  const ghiBo = async (note: string) => {
    await query(`UPDATE auto_pilot_runs SET status = 'skipped', note = $2 WHERE id = $1`, [
      runId,
      note,
    ]);
  };

  if (cau.topics.length === 0) {
    await ghiBo("Chưa có chủ đề nào trong danh sách, nên không có gì để viết.");
    return false;
  }

  // Kênh đăng phải có thật, nếu không thì viết bài ra cũng không đăng được đi đâu.
  const kenh = await query<{ id: string; platform: string }>(
    cau.accountIds.length
      ? `SELECT id, platform FROM social_accounts
           WHERE trang_id = $1 AND connected = TRUE AND platform <> 'metaads'
             AND id = ANY($2::text[])`
      : `SELECT id, platform FROM social_accounts
           WHERE trang_id = $1 AND connected = TRUE AND platform <> 'metaads'`,
    cau.accountIds.length ? [trangId, cau.accountIds] : [trangId]
  );
  if (kenh.rows.length === 0) {
    await ghiBo("Không có kênh nào đang kết nối để đăng.");
    return false;
  }

  // Xoay vòng chủ đề theo số lượt đã chạy, để không lặp lại chủ đề đầu mãi.
  const daChay = await queryOne<{ n: string }>(
    `SELECT count(*)::text AS n FROM auto_pilot_runs
      WHERE trang_id = $1 AND status IN ('ok', 'failed') AND id < $2`,
    [trangId, runId]
  );
  const chuDe = cau.topics[Number(daChay?.n ?? 0) % cau.topics.length];

  const ganDay = await query<{ content: string }>(
    `SELECT content FROM posts WHERE trang_id = $1
       AND status IN ('published', 'scheduled', 'publishing', 'pending_approval')
     ORDER BY created_at DESC LIMIT 3`,
    [userId]
  );

  /*
   * Giới hạn lấy theo kênh khó tính nhất, y như hộp soạn bài tay.
   *
   * Hệ thống gửi MỘT lệnh đăng cho mọi kênh, nên một kênh từ chối là cả lệnh
   * hỏng. Nói trước cho AI biết trần độ dài thì nó viết vừa ngay từ đầu.
   */
  const gioiHan = gioiHanChatNhat(kenh.rows.map((k) => k.platform));

  const viet = await generatePostContent({
    userId,
    trangId,
    topic: chuDe,
    goal: cau.goal,
    count: 1,
    viec: "viet_bai_tu_dong",
    tranhLap: ganDay.rows.map((r) => r.content),
    gioiHanKyTu: gioiHan?.soKyTu,
  });

  const noiDung = viet.options[0]?.trim();
  if (!noiDung) {
    await query(`UPDATE auto_pilot_runs SET status = 'failed', topic = $2, note = $3 WHERE id = $1`, [
      runId,
      chuDe,
      "AI không trả về nội dung nào.",
    ]);
    return false;
  }

  /*
   * AI vẫn viết quá dài thì DỪNG, không gửi đi.
   *
   * Gửi đi cũng chỉ nhận về lỗi từ nền tảng và không kênh nào có bài. Báo rõ
   * kênh nào chặn để chủ shop bỏ kênh đó ra khỏi lịch nếu muốn viết dài.
   */
  if (gioiHan && noiDung.length > gioiHan.soKyTu) {
    await ghiBo(
      `Nội dung AI tạo dài ${noiDung.length} ký tự, vượt giới hạn ${gioiHan.soKyTu} ký tự ` +
        `của ${gioiHan.ten}. ${gioiHan.lyDo} Bỏ chọn ${gioiHan.ten} trong cài đặt lịch nếu cần ` +
        `nội dung dài hơn.`
    );
    return false;
  }

  /*
   * Ảnh theo nội dung bài — chỉ khi chủ shop bật và đã chọn mô hình.
   *
   * Vẽ ảnh hỏng (hết tiền AI, nhà cung cấp lỗi) thì bài KHÔNG tự lên sóng mà chuyển sang chờ
   * duyệt: chủ shop đã chọn "có ảnh", đăng trơn chữ là trái ý họ, và kênh bắt buộc có ảnh
   * (Instagram) sẽ làm hỏng cả lệnh đăng chung.
   */
  let media: { url: string; type: "image" | "video" }[] = [];
  let loiAnh: string | null = null;
  let tienAnh = 0;
  if (cau.anh.bat && cau.anh.model) {
    try {
      const anh = await taoAnhChoBai({
        userId,
        trangId,
        noiDung,
        chuTrongAnh: cau.anh.chuTrongAnh,
        luat: { chanNhanHieuGia: cau.anh.chanNhanHieuGia, chanNguoiThat: cau.anh.chanNguoiThat },
        veAnh: { model: cau.anh.model, doNet: cau.anh.doNet, chatLuong: cau.anh.chatLuong, khung: cau.anh.khung },
        viec: "tao_anh_tu_dong",
      });
      media = [{ url: anh.url, type: "image" }];
      tienAnh = anh.costUsd;
    } catch (error) {
      loiAnh = error instanceof Error ? error.message : String(error);
    }
  }
  const guard: AutoPilotConfig["guard"] = loiAnh ? "approve" : cau.guard;
  const ghiChuAnh = loiAnh
    ? ` Không vẽ được ảnh (${loiAnh.slice(0, 200)}), nên bài chờ bạn duyệt.`
    : media.length
      ? ` Có ảnh AI vẽ (${tienAnh.toFixed(4)} USD).`
      : "";

  /*
   * Video theo nội dung bài — chỉ khi bật, đã chọn mô hình và còn trong trần tiền tháng.
   * Video mất 1–5 phút nên bài nằm chờ (cho_video_id); runDueVideoTuDong gắn video rồi mới đăng.
   * Không làm được video (tắt tạo video, chạm trần, lỗi) → đăng kèm ẢNH THAY THẾ (chủ dự án chọn).
   */
  let choVideo: { id: number; gia: number } | null = null;
  let ghiChuVideo = "";
  if (cau.video.bat && cau.video.model && trangId) {
    try {
      choVideo = await batDauVideoTuDong({ userId, trangId, noiDung, v: cau.video, anhMoDau: media[0]?.url });
    } catch (error) {
      const lyDo = error instanceof Error ? error.message : String(error);
      ghiChuVideo = ` Không làm được video (${lyDo.slice(0, 200)})`;
      if (!media.length) {
        try {
          const thay = await anhThayThe({ userId, trangId, noiDung, anh: cau.anh });
          media = [{ url: thay.url, type: "image" }];
          ghiChuVideo += `, đã đăng kèm ảnh thay thế (${thay.costUsd.toFixed(4)} USD).`;
        } catch (e) {
          ghiChuVideo += `; ảnh thay thế cũng hỏng (${(e instanceof Error ? e.message : String(e)).slice(0, 120)}).`;
        }
      } else {
        ghiChuVideo += ", bài đăng kèm ảnh.";
      }
    }
  }

  if (choVideo) {
    // Chờ video: chưa đăng, chưa hẹn giờ. Chế độ đăng đã chọn giữ lại để áp khi video xong.
    const baiCho = await queryOne<{ id: number }>(
      `INSERT INTO posts (user_id, trang_id, content, media, target_account_ids, status,
                          ai_generated, ai_prompt, auto_publish_at, cho_video_id, cho_video_guard)
       VALUES ($1, $8, $2, $3::jsonb, $4::text[], 'pending_approval', TRUE, $5, NULL, $6, $7)
       RETURNING id`,
      [userId, noiDung, JSON.stringify(media), kenh.rows.map((k) => k.id), chuDe, choVideo.id, guard, trangId]
    );
    if (!baiCho) throw new Error("Không lưu được bài vừa viết.");
    await query(`UPDATE auto_pilot_runs SET status = 'ok', topic = $2, post_id = $3, note = $4 WHERE id = $1`, [
      runId,
      chuDe,
      baiCho.id,
      `Đã viết, đang tạo video (~${choVideo.gia.toFixed(3)} USD) — xong thì đăng kèm.` + ghiChuAnh,
    ]);
    return true;
  }

  const tuDangLuc =
    guard === "notify" ? new Date(Date.now() + cau.notifyMinutes * 60_000) : null;

  const bai = await queryOne<{ id: number }>(
    `INSERT INTO posts (user_id, trang_id, content, media, target_account_ids, status,
                        ai_generated, ai_prompt, auto_publish_at)
     VALUES ($1, $8, $2, $3::jsonb, $4::text[], $5, TRUE, $6, $7)
     RETURNING id`,
    [
      userId,
      noiDung,
      JSON.stringify(media),
      kenh.rows.map((k) => k.id),
      guard === "publish" ? "draft" : "pending_approval",
      chuDe,
      tuDangLuc,
      trangId,
    ]
  );
  if (!bai) throw new Error("Không lưu được bài vừa viết.");

  await query(`UPDATE auto_pilot_runs SET topic = $2, post_id = $3 WHERE id = $1`, [
    runId,
    chuDe,
    bai.id,
  ]);

  if (guard === "publish") {
    await publishPost(trangId, bai.id);
    await query(`UPDATE auto_pilot_runs SET status = 'ok', note = $2 WHERE id = $1`, [
      runId,
      "Đã viết và gửi đăng." + ghiChuAnh + ghiChuVideo,
    ]);
    await baoTelegram(
      userId,
      `🤖 <b>AI vừa đăng một bài</b>\nChủ đề: ${escapeHtml(chuDe)}\n\n${escapeHtml(noiDung.slice(0, 600))}`
    );
    return true;
  }

  if (guard === "notify") {
    await query(`UPDATE auto_pilot_runs SET status = 'ok', note = $2 WHERE id = $1`, [
      runId,
      `Đã viết, sẽ tự đăng sau ${cau.notifyMinutes} phút nếu không bị huỷ.` + ghiChuAnh + ghiChuVideo,
    ]);
    await baoTelegram(
      userId,
      `🤖 <b>AI vừa viết một bài</b>\nChủ đề: ${escapeHtml(chuDe)}\n\n${escapeHtml(noiDung.slice(0, 600))}\n\n` +
        `⏳ Sẽ tự đăng sau ${cau.notifyMinutes} phút. Không muốn đăng thì vào app ` +
        `mục "Chờ duyệt" xoá bài này.`
    );
    return true;
  }

  await query(`UPDATE auto_pilot_runs SET status = 'ok', note = $2 WHERE id = $1`, [
    runId,
    "Đã viết, đang chờ chủ shop duyệt." + ghiChuAnh + ghiChuVideo,
  ]);
  await baoTelegram(
    userId,
    `🤖 <b>AI vừa viết một bài, đang chờ bạn duyệt</b>\nChủ đề: ${escapeHtml(chuDe)}\n\n${escapeHtml(noiDung.slice(0, 600))}` +
      (loiAnh ? `\n\n⚠️ ${escapeHtml(ghiChuAnh.trim())}` : "")
  );
  return true;
}

/** Báo Telegram là việc phụ: chưa cấu hình hoặc lỗi thì vẫn phải chạy tiếp. */
async function baoTelegram(userId: number, text: string): Promise<void> {
  try {
    await sendTelegramMessage(userId, text, "content");
  } catch {
    /* im lặng có chủ đích: không để tin nhắn hỏng làm hỏng việc đăng bài */
  }
}

/**
 * Đăng những bài đã hết giờ chờ ở chế độ "báo trước rồi đăng".
 *
 * Bài nào chủ shop đã xoá hoặc đã tự đăng thì không còn ở pending_approval nên
 * tự khắc rơi khỏi truy vấn này — huỷ chỉ đơn giản là xoá bài.
 */
export async function runDueAutoPublishes(): Promise<number> {
  const toiHan = await query<{ id: number; trang_id: number }>(
    `SELECT id, trang_id FROM posts
      WHERE status = 'pending_approval'
        AND auto_publish_at IS NOT NULL
        AND auto_publish_at <= now()
      ORDER BY auto_publish_at LIMIT 10`
  );

  let dem = 0;
  for (const bai of toiHan.rows) {
    /*
     * Gỡ mốc tự đăng TRƯỚC khi gọi Zernio.
     *
     * Nếu để nguyên mà lệnh đăng lỗi giữa chừng, lượt quét sau lại thấy bài
     * này tới hạn và đăng tiếp — cứ 5 giây một lần. Gỡ trước thì hỏng là
     * hỏng một lần, bài nằm lại mục chờ duyệt cho chủ shop tự xử lý.
     */
    await query(`UPDATE posts SET auto_publish_at = NULL WHERE id = $1`, [bai.id]);
    try {
      await publishPost(bai.trang_id, bai.id);
      dem += 1;
    } catch (error) {
      console.error(
        `[tự động] Không đăng được bài ${bai.id}:`,
        error instanceof Error ? error.message : error
      );
    }
  }
  return dem;
}

// ---------------------------------------------------------------------------
// Video tự động theo lịch (migration 039)
// ---------------------------------------------------------------------------

/** Bài chờ video quá lâu thì thôi chờ, đăng kèm ảnh thay thế. */
export const CHO_VIDEO_TOI_DA_PHUT = 25;

/** Tiền video tự động đã dùng trong tháng này (theo giờ Việt Nam) của một Trang. */
export async function tienVideoTuDongThang(trangId: number): Promise<number> {
  const r = await queryOne<{ tong: string | null }>(
    `SELECT sum(coalesce(gia_thuc, gia_uoc_tinh))::text AS tong FROM video_ai
      WHERE trang_id = $1 AND tu_dong
        AND created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh')`,
    [trangId]
  );
  return Number(r?.tong ?? 0) || 0;
}

/** AI viết lời nhắc video từ bài rồi gửi việc tạo video — chặn trước nếu vượt trần tiền tháng. */
async function batDauVideoTuDong(p: {
  userId: number;
  trangId: number;
  noiDung: string;
  v: VideoTuDong;
  anhMoDau?: string;
}): Promise<{ id: number; gia: number }> {
  const model = (await layDanhSachModel()).find((m) => m.id === p.v.model);
  if (!model) throw new Error("mô hình video đã chọn không còn");
  const lc = {
    soGiay: p.v.soGiay,
    doNet: p.v.doNet,
    khung: p.v.khung,
    coTieng: p.v.coTieng,
    coAnhMoDau: Boolean(p.anhMoDau),
    chuTrongVideo: p.v.chuTrongVideo,
    chanNhanHieuGia: p.v.chanNhanHieuGia,
    chanNguoiThat: p.v.chanNguoiThat,
  };
  const gia = giaVideo(model, lc);
  if (gia === null) throw new Error("chưa tính được giá video");
  const daDung = await tienVideoTuDongThang(p.trangId);
  if (!(p.v.tranThangUsd > 0) || daDung + gia > p.v.tranThangUsd) {
    throw new Error(`chạm trần tiền video tháng này (đã dùng ${daDung.toFixed(2)} / ${p.v.tranThangUsd} USD)`);
  }
  const viec = await vietVaGuiVideo({ userId: p.userId, trangId: p.trangId, noiDung: p.noiDung, model: model.id, lc, mucDich: p.v.mucDich, anhMoDau: p.anhMoDau });
  await query("UPDATE video_ai SET tu_dong = TRUE WHERE id = $1", [viec.id]);
  return { id: viec.id, gia };
}

/** AI viết lời nhắc video từ nội dung bài rồi gửi việc tạo video. */
async function vietVaGuiVideo(p: {
  userId: number;
  trangId: number;
  noiDung: string;
  model: string;
  lc: LuaChonVideo;
  mucDich: string;
  huong?: HuongKichBan;
  anhMoDau?: string;
}) {
  const { loiMoTa } = await vietLoiMoTaVideo({
    userId: p.userId,
    noiDung: p.noiDung,
    mucDich: p.mucDich,
    soGiay: p.lc.soGiay,
    coAnhMoDau: Boolean(p.anhMoDau),
    chuTrongVideo: p.lc.chuTrongVideo,
    huong: p.huong,
    luat: { chanNhanHieuGia: p.lc.chanNhanHieuGia, chanNguoiThat: p.lc.chanNguoiThat },
  });
  return taoVideo({ userId: p.userId, trangId: p.trangId, model: p.model, loiMoTa, lc: p.lc, anhMoDau: p.anhMoDau });
}

/** Bài còn sửa được (chưa gửi lên nền tảng) mới gắn video theo bài được. */
const TRANG_THAI_CHO_VIDEO = ["draft", "pending_approval", "scheduled", "failed"];

/**
 * Bài soạn tay, video "theo bài" (chủ dự án 04/10/2026: bấm Đăng bài / Lên lịch thì tự tạo video từ nội dung bài
 * rồi đăng cùng). Video mất 1–5 phút nên bài nằm chờ như bài của lịch tự đăng: runDueVideoTuDong gắn video
 * rồi đăng (giờ hẹn vẫn giữ — publishPost tự đọc scheduled_for). Không có trần tiền tháng: chủ shop đã thấy giá
 * và bấm đồng ý ngay lúc đăng. Chỉ từ nội dung bài: không prompt tay, không ảnh tham chiếu (ô prompt đóng khi đi theo bài).
 */
export async function taoVideoTheoBai(p: {
  userId: number;
  trangId: number;
  postId: number;
  noiDung: string;
  model: string;
  lc: LuaChonVideo;
  mucDich: string;
  huong?: HuongKichBan;
}): Promise<{ videoId: number; gia: number }> {
  if (!Number.isInteger(p.postId) || p.postId <= 0) throw new AppError("Thiếu bài viết để gắn video.", 400);
  const bai = await queryOne<{ status: string; content: string }>(
    "SELECT status, content FROM posts WHERE id = $1 AND trang_id = $2",
    [p.postId, p.trangId]
  );
  if (!bai) throw new AppError("Không tìm thấy bài viết", 404);
  if (!TRANG_THAI_CHO_VIDEO.includes(bai.status)) throw new AppError("Bài đã gửi đăng, không gắn thêm video được.", 409);
  const model = (await layDanhSachModel()).find((m) => m.id === p.model);
  if (!model) throw new AppError("Mô hình video đã chọn không còn. Chọn mô hình khác.", 400);
  const lyDo = lyDoKhongHop(model, p.lc);
  if (lyDo) throw new AppError(`Mô hình video này ${lyDo}.`, 400);
  const gia = giaVideo(model, p.lc);
  if (gia === null) throw new AppError("Chưa tính được giá video này.", 400);
  const viec = await vietVaGuiVideo({ ...p, noiDung: p.noiDung.trim() || bai.content });
  const gan = await queryOne<{ id: number }>(
    `UPDATE posts SET status = 'pending_approval', cho_video_id = $3, cho_video_guard = 'publish', updated_at = now()
      WHERE id = $1 AND trang_id = $2 AND status = ANY($4::text[]) RETURNING id`,
    [p.postId, p.trangId, viec.id, TRANG_THAI_CHO_VIDEO]
  );
  if (!gan) throw new AppError("Bài vừa được đăng hoặc xoá trong lúc gửi video. Video vẫn đang tạo, xem ở Xưởng AI.", 409);
  return { videoId: viec.id, gia };
}

/** Ảnh thay cho video: mô hình ảnh đã chọn cho lịch, chưa chọn thì mô hình rẻ nhất. */
async function anhThayThe(p: { userId: number; trangId: number | null; noiDung: string; anh: AnhTuDong }) {
  const model = p.anh.model || (await layDanhSachModelAnh())[0]?.id;
  if (!model) throw new Error("không có mô hình vẽ ảnh nào");
  return taoAnhChoBai({
    userId: p.userId,
    trangId: p.trangId,
    noiDung: p.noiDung,
    chuTrongAnh: p.anh.chuTrongAnh,
    luat: { chanNhanHieuGia: p.anh.chanNhanHieuGia, chanNguoiThat: p.anh.chanNguoiThat },
    veAnh: p.anh.model
      ? { model: p.anh.model, doNet: p.anh.doNet, chatLuong: p.anh.chatLuong, khung: p.anh.khung }
      : { model },
    viec: "tao_anh_tu_dong",
  });
}

/**
 * Bài đang chờ video: video xong → gắn vào bài; video lỗi hoặc chờ quá CHO_VIDEO_TOI_DA_PHUT phút → đăng kèm ảnh
 * thay thế. Sau đó áp đúng chế độ đăng đã chọn lúc tạo bài (đăng thẳng / báo trước / chờ duyệt).
 * Chủ shop tự đăng hay xoá bài trong lúc chờ thì bài không còn ở pending_approval → bỏ qua.
 */
export async function runDueVideoTuDong(): Promise<number> {
  const ds = await query<{
    id: number; user_id: number; content: string; media: unknown; cho_video_id: number; cho_video_guard: string | null;
    trang_thai: string; url: string | null; trang_id: number; qua_lau: boolean;
  }>(
    `SELECT p.id, p.user_id, p.content, p.media, p.cho_video_id, p.cho_video_guard,
            v.trang_thai, v.url, p.trang_id,
            v.created_at < now() - ($1 || ' minutes')::interval AS qua_lau
       FROM posts p JOIN video_ai v ON v.id = p.cho_video_id
      WHERE p.cho_video_id IS NOT NULL AND p.status = 'pending_approval'
        AND (v.trang_thai IN ('xong', 'loi') OR v.created_at < now() - ($1 || ' minutes')::interval)
      ORDER BY p.id LIMIT 10`,
    [String(CHO_VIDEO_TOI_DA_PHUT)]
  );

  let dem = 0;
  for (const b of ds.rows) {
    // Giành bài trước (gỡ cờ chờ) để hai lượt quét không xử lý trùng.
    const gianh = await queryOne<{ id: number }>(
      "UPDATE posts SET cho_video_id = NULL WHERE id = $1 AND cho_video_id = $2 RETURNING id",
      [b.id, b.cho_video_id]
    );
    if (!gianh) continue;

    const cau = docCauHinh(
      (await queryOne<{ settings: Record<string, unknown> | null }>(
        "SELECT settings FROM ai_configs WHERE trang_id = $1 AND kind = 'content'",
        [b.trang_id]
      ))?.settings?.autoPilot
    );
    let media = Array.isArray(b.media) ? (b.media as { url: string; type: string }[]) : [];
    let ghiChu: string;
    if (b.trang_thai === "xong" && b.url) {
      media = [...media, { url: b.url, type: "video" }];
      ghiChu = "Video AI đã xong, đã gắn vào bài.";
    } else {
      ghiChu = b.trang_thai === "loi" ? "Video AI bị lỗi" : `Video AI quá ${CHO_VIDEO_TOI_DA_PHUT} phút chưa xong`;
      if (!media.some((m) => m.type === "image")) {
        try {
          const thay = await chayChoTrang(b.trang_id, () => anhThayThe({ userId: b.user_id, trangId: b.trang_id, noiDung: b.content, anh: cau.anh }));
          media = [...media, { url: thay.url, type: "image" }];
          ghiChu += ", đã đăng kèm ảnh thay thế.";
        } catch (e) {
          ghiChu += `; ảnh thay thế cũng hỏng (${(e instanceof Error ? e.message : String(e)).slice(0, 120)}), bài chờ bạn duyệt.`;
          await query("UPDATE posts SET media = $2::jsonb WHERE id = $1", [b.id, JSON.stringify(media)]);
          await baoTelegram(b.user_id, `🤖 <b>Bài tự động đang chờ bạn duyệt</b>\n${escapeHtml(ghiChu)}`);
          continue;
        }
      } else {
        ghiChu += ", bài đăng kèm ảnh.";
      }
    }
    await query("UPDATE posts SET media = $2::jsonb WHERE id = $1", [b.id, JSON.stringify(media)]);

    const guard = b.cho_video_guard === "publish" || b.cho_video_guard === "notify" ? b.cho_video_guard : "approve";
    if (guard === "publish") {
      await query("UPDATE posts SET status = 'draft' WHERE id = $1", [b.id]);
      await publishPost(b.trang_id, b.id);
    } else if (guard === "notify") {
      await query("UPDATE posts SET auto_publish_at = now() + ($2 || ' minutes')::interval WHERE id = $1", [b.id, String(cau.notifyMinutes)]);
    }
    await baoTelegram(
      b.user_id,
      `🤖 <b>${guard === "publish" ? "AI vừa đăng một bài" : guard === "notify" ? `Bài sẽ tự đăng sau ${cau.notifyMinutes} phút` : "Bài mới đang chờ bạn duyệt"}</b>\n${escapeHtml(ghiChu)}\n\n${escapeHtml(b.content.slice(0, 400))}`
    );
    dem += 1;
  }
  return dem;
}
