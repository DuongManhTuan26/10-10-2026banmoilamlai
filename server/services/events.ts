import { query, queryOne, transaction } from "../db.js";
import { handleIncomingMessage } from "./sales-ai.js";
import { docTepKhachGui } from "./vision.js";
import { docTuChu } from "./sales-autonomy.js";
import { handleCommentReceived } from "./comment-ai.js";
import { touchCustomerMessage } from "./outbound.js";
import { syncAccountsForUser } from "./accounts.js";
import { chuCuaHoSo } from "./trang.js";
import { xinSuatDocAnh } from "./chong-lam-dung.js";

/**
 * Chuyển sự kiện webhook thành dữ liệu nghiệp vụ.
 *
 * Mọi hàm ở đây phải chạy lại được nhiều lần mà kết quả không đổi
 * (idempotent). Chống trùng ở tầng nhận webhook là lớp phòng thủ thứ nhất,
 * nhưng một sự kiện có thể được xử lý lại sau khi thất bại giữa chừng,
 * nên tầng này phải tự bảo vệ bằng ON CONFLICT.
 */

export interface WebhookEvent {
  eventId: string;
  eventType: string;
  accountId: string | null;
  payload: Record<string, unknown>;
  /**
   * Lần thử thứ mấy, và tối đa bao nhiêu lần.
   *
   * Cần biết để phân biệt "AI hỏng tạm thời, còn cơ hội thử lại" với "đã hết
   * đường, buộc phải gọi người thật". Thiếu thông tin này thì một lỗi mạng
   * thoáng qua cũng bị coi là hỏng vĩnh viễn.
   */
  attempt?: number;
  maxAttempts?: number;
}

/** Cửa sổ nhắn tin của Meta: 24 giờ kể từ tin cuối cùng của khách. */
const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1_000;

export async function handleWebhookEvent(event: WebhookEvent): Promise<void> {
  switch (event.eventType) {
    case "message.received":
      await handleMessageReceived(event);
      break;
    case "message.sent":
      await handleMessageSent(event);
      break;
    case "comment.received":
      await handleCommentReceived({ accountId: event.accountId, payload: event.payload });
      break;
    case "account.connected":
    case "account.disconnected":
      await handleAccountChange(event);
      break;
    case "post.published":
    case "post.partial":
    case "post.failed":
      await handlePostResult(event);
      break;
    default:
      // Sự kiện đã lọt qua bộ lọc ở tầng nhận nhưng chưa có xử lý riêng.
      console.log(`[sự kiện] Bỏ qua ${event.eventType} (chưa có xử lý)`);
  }
}

// ---------------------------------------------------------------------------
// Tin nhắn đến
// ---------------------------------------------------------------------------

interface MessagePayload {
  id?: string;
  conversationId?: string;
  platform?: string;
  platformMessageId?: string;
  direction?: string;
  text?: string | null;
  attachments?: unknown[];
  sender?: {
    id?: string;
    name?: string;
    username?: string;
    picture?: string;
    phoneNumber?: string | null;
    /** Cờ do nền tảng gắn khi tin do chính trang gửi. */
    isFromPage?: boolean;
  };
  /**
   * Thời điểm THẬT tin được gửi trên nền tảng.
   *
   * Webhook đến ngay nên lấy now() cũng gần đúng, nhưng lưới rà soát có thể
   * mang về tin cũ hơn. Thiếu trường này thì tin cũ bị ghi với dấu thời gian
   * hôm nay, làm sai toàn bộ dòng thời gian hội thoại — và mọi phép tính dựa
   * trên "tin cuối của khách" (cửa sổ 24 giờ, chống lặp) đều lệch theo.
   */
  createdAt?: string;
}

async function handleMessageReceived(event: WebhookEvent): Promise<void> {
  const message = event.payload.message as MessagePayload | undefined;

  if (!message?.conversationId || !message.id) {
    throw new Error("Sự kiện message.received thiếu conversationId hoặc id");
  }

  const accountId = event.accountId;
  if (!accountId) {
    throw new Error("Sự kiện message.received thiếu accountId");
  }

  /*
   * LỚP CHẶN VÒNG LẶP 1 — hướng tin nhắn.
   *
   * Zernio có thể đẩy về cả tin do chính Fanpage gửi. Không kiểm tra chỗ này
   * thì tin của shop bị coi là tin khách, AI trả lời, tin trả lời lại quay về,
   * và Fanpage tự nói chuyện với chính nó tới khi hết hạn mức API.
   */
  if (message.direction === "outgoing") {
    console.log(
      `[sự kiện] Bỏ qua tin do chính trang gửi (direction=outgoing) ` +
        `trong hội thoại ${message.conversationId}`
    );
    return;
  }

  // Tài khoản này thuộc shop nào. Đây là mấu chốt phân tách đa người thuê:
  // không tra được chủ sở hữu thì tuyệt đối không xử lý tiếp.
  const account = await queryOne<{
    user_id: number;
    platform: string;
    raw: Record<string, unknown>;
  }>("SELECT user_id, platform, raw FROM social_accounts WHERE id = $1", [accountId]);

  if (!account) {
    // Không phải lỗi hệ thống: tài khoản có thể đã bị gỡ, hoặc thuộc một
    // hệ thống khác dùng chung khóa Zernio. Bỏ qua chứ không thử lại.
    console.warn(
      `[sự kiện] Bỏ qua tin nhắn của tài khoản chưa biết ${accountId}. ` +
        `Chạy đồng bộ kết nối nếu đây là tài khoản hợp lệ.`
    );
    return;
  }

  const platform = message.platform ?? account.platform;
  const senderId = message.sender?.id;
  if (!senderId) {
    throw new Error("Sự kiện message.received thiếu sender.id");
  }

  /*
   * LỚP CHẶN VÒNG LẶP 2 — danh tính người gửi.
   *
   * Lớp 1 dựa vào trường direction do Zernio gán. Lớp này không tin vào đó:
   * so trực tiếp id người gửi với id của chính trang trên nền tảng. Nếu trùng
   * thì đây là tin của shop, dù direction ghi gì.
   */
  const pagePlatformUserId = account.raw?.platformUserId;
  if (typeof pagePlatformUserId === "string" && pagePlatformUserId.length > 0) {
    // platformUserId của Facebook có dạng "1624325025923679:page:686754604528250",
    // nên so cả chuỗi đầy đủ và từng phần tách bởi dấu hai chấm.
    const parts = new Set([pagePlatformUserId, ...pagePlatformUserId.split(":")]);
    if (parts.has(senderId)) {
      console.log(
        `[sự kiện] Bỏ qua tin do chính trang gửi (sender trùng id trang) ` +
          `trong hội thoại ${message.conversationId}`
      );
      return;
    }
  }

  if (message.sender?.isFromPage === true) {
    console.log(`[sự kiện] Bỏ qua tin có cờ isFromPage trong ${message.conversationId}`);
    return;
  }

  const text = typeof message.text === "string" ? message.text : "";
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];

  // Ưu tiên thời điểm thật của nền tảng; không có thì mới lấy hiện tại.
  const luc = message.createdAt ? new Date(message.createdAt) : null;
  const now = luc && !Number.isNaN(luc.getTime()) ? luc : new Date();

  /*
   * NGUỒN của hội thoại — nối quảng cáo / bài đăng → hội thoại → đơn bằng MÃ THẬT (chủ dự án duyệt 05/10/2026).
   *
   * Meta gửi `referral` ở tin ĐẦU TIÊN sau cú bấm (tài liệu nhà cung cấp kênh: metadata.referral trên message.received):
   * `ad_id` = khách bấm quảng cáo nhắn tin; chỉ `ref` = link m.me có ref. Không có thì xem khách có đang trả lời tin
   * nhắn riêng AI gửi từ bình luận của họ không — mã người bình luận trùng mã khách trên cùng Fanpage (đã đo 2/2 ca
   * thật). Không có tín hiệu nào → 'tu_nhan'. KHÔNG đoán theo tên hay theo thời gian.
   */
  const thamChieu = ((event.payload.metadata as { referral?: Record<string, unknown> } | null | undefined)?.referral ?? null);
  const chu = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const maQuangCao = chu(thamChieu?.ad_id);
  const maLienKet = chu(thamChieu?.ref);
  const baiQuangCao = chu((thamChieu?.ads_context_data as { post_id?: unknown } | undefined)?.post_id);
  const loaiCham: "quang_cao" | "lien_ket" | null = maQuangCao ? "quang_cao" : maLienKet ? "lien_ket" : null;
  const tuBinhLuan = await queryOne<{ platform_post_id: string | null; private_replied_at: Date }>(
    `SELECT platform_post_id, private_replied_at FROM comments
      WHERE user_id = $1 AND social_account_id = $2 AND author_id = $3
        AND private_replied_at IS NOT NULL AND private_replied_at > $4::timestamptz - interval '7 days'
        AND private_replied_at <= $4::timestamptz
      ORDER BY private_replied_at DESC LIMIT 1`,
    [account.user_id, accountId, senderId, now]
  );
  const nguon = loaiCham ?? (tuBinhLuan ? "binh_luan" : "tu_nhan");

  await transaction(async (client) => {
    // 1. Khách hàng — tạo mới nếu lần đầu nhắn, cập nhật nếu đã có.
    const customer = await client.query<{ id: number }>(
      `INSERT INTO customers
         (user_id, social_account_id, platform, participant_id, name, avatar_url,
          phone, first_seen_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
       ON CONFLICT (trang_id, platform, participant_id) DO UPDATE SET
         last_seen_at = now(),
         -- Chỉ ghi đè khi bản ghi đang trống, để không xoá thông tin
         -- nhân viên đã sửa tay trước đó.
         name       = COALESCE(NULLIF(customers.name, ''), EXCLUDED.name),
         avatar_url = COALESCE(customers.avatar_url, EXCLUDED.avatar_url),
         phone      = COALESCE(customers.phone, EXCLUDED.phone),
         updated_at = now()
       RETURNING id`,
      [
        account.user_id,
        accountId,
        platform,
        senderId,
        message.sender?.name ?? message.sender?.username ?? "",
        message.sender?.picture ?? null,
        message.sender?.phoneNumber ?? null,
      ]
    );
    const customerId = customer.rows[0].id;

    // 2. Hội thoại — mở mới hoặc dời hạn cửa sổ 24 giờ.
    // Nguồn chỉ ghi khi hội thoại MỚI (lần chạm đầu); các lần chạm sau ghi vào hoi_thoai_cham.
    await client.query(
      `INSERT INTO conversations
         (id, user_id, social_account_id, customer_id, platform, origin, status,
          last_message_at, window_expires_at, unread_count,
          origin_ad_id, origin_ref, origin_post_id, origin_at)
       VALUES ($1, $2, $3, $4, $5, $8, 'ai', $6, $7, 1, $9, $10, $11, $6)
       ON CONFLICT (id) DO UPDATE SET
         last_message_at   = EXCLUDED.last_message_at,
         window_expires_at = EXCLUDED.window_expires_at,
         unread_count      = conversations.unread_count + 1,
         -- Khách nhắn lại sau khi đã đóng thì mở lại hội thoại.
         -- Nếu đang chờ người thật xử lý thì giữ nguyên, không trả về cho AI.
         status = CASE
                    WHEN conversations.status = 'done' THEN 'ai'
                    ELSE conversations.status
                  END,
         updated_at = now()`,
      [
        message.conversationId,
        account.user_id,
        accountId,
        customerId,
        platform,
        now,
        new Date(now.getTime() + MESSAGING_WINDOW_MS),
        nguon,
        maQuangCao,
        maLienKet,
        baiQuangCao ?? (nguon === "binh_luan" ? tuBinhLuan?.platform_post_id ?? null : null),
      ]
    );

    // Mỗi lần chạm có mã (quảng cáo / link / bình luận) — kể cả khách cũ quay lại qua quảng cáo khác.
    if (loaiCham) {
      await client.query(
        `INSERT INTO hoi_thoai_cham (conversation_id, user_id, loai, ad_id, ref, post_id, luc)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
        [message.conversationId, account.user_id, loaiCham, maQuangCao, maLienKet, baiQuangCao, now]
      );
    }
    if (tuBinhLuan) {
      await client.query(
        `INSERT INTO hoi_thoai_cham (conversation_id, user_id, loai, post_id, luc)
         VALUES ($1, $2, 'binh_luan', $3, $4) ON CONFLICT DO NOTHING`,
        [message.conversationId, account.user_id, tuBinhLuan.platform_post_id, tuBinhLuan.private_replied_at]
      );
    }

    // 3. Tin nhắn — khoá duy nhất trên (conversation_id, external_id)
    //    đảm bảo giao lặp không tạo bản ghi thừa.
    await client.query(
      // Chỉ mục duy nhất có điều kiện WHERE external_id IS NOT NULL, nên
      // ON CONFLICT phải khai báo lại đúng điều kiện đó thì Postgres mới khớp được.
      `INSERT INTO messages
         (user_id, conversation_id, external_id, sender_type, content, attachments, sent_at)
       VALUES ($1, $2, $3, 'customer', $4, $5, $6)
       ON CONFLICT (conversation_id, external_id) WHERE external_id IS NOT NULL
       DO NOTHING`,
      [
        account.user_id,
        message.conversationId,
        message.platformMessageId ?? message.id,
        text,
        JSON.stringify(attachments),
        now,
      ]
    );
  });

  /*
   * Đọc ảnh khách gửi NGAY BÂY GIỜ.
   *
   * Không để dành: tài liệu Zernio ghi rõ link ảnh của Facebook/Instagram là
   * link CDN "expires on the platform's own schedule". Đọc muộn vài giờ là link
   * chết và ảnh mất vĩnh viễn — lúc đó AI chỉ còn biết xin lỗi là không xem được.
   *
   * Phải đọc TRƯỚC khi gọi AI bán hàng ở dưới, nếu không lượt trả lời này vẫn
   * mù. Đọc hỏng thì bỏ qua, AI vẫn biết là có ảnh nhờ cột attachments.
   */
  if (attachments.length > 0) {
    const moTa: string[] = [];
    for (const t of attachments.slice(0, 3)) {
      const o = (t ?? {}) as Record<string, unknown>;
      if (typeof o.url !== "string" || typeof o.type !== "string") continue;
      if (!xinSuatDocAnh(message.conversationId, accountId)) {
        console.warn(
          `[sự kiện] Bỏ qua đọc ảnh trong ${message.conversationId}: vượt trần đọc ảnh mỗi giờ`
        );
        break;
      }
      try {
        const doc = await docTepKhachGui({ url: o.url, type: o.type, userId: account.user_id });
        if (doc) moTa.push(doc);
      } catch (error) {
        console.error(
          `[sự kiện] Không đọc được tệp khách gửi trong ${message.conversationId}:`,
          error instanceof Error ? error.message : error
        );
      }
    }
    if (moTa.length > 0) {
      await query(
        `UPDATE messages SET attachment_text = $3
          WHERE conversation_id = $1 AND external_id = $2`,
        [message.conversationId, message.platformMessageId ?? message.id, moTa.join("\n")]
      );
    }
  }

  // Mốc tính cửa sổ 24 giờ và 7 ngày. Chỉ cập nhật khi KHÁCH gửi tin.
  await touchCustomerMessage(message.conversationId, now);

  // Khách vừa nhắn thì bộ đếm nhắc lại về 0: họ đang nói chuyện, không cần đuổi.
  await query(
    "UPDATE conversations SET nhac_lai_count = 0, nhac_lai_at = NULL WHERE id = $1",
    [message.conversationId]
  );

  console.log(
    `[sự kiện] Tin nhắn mới trong hội thoại ${message.conversationId} ` +
      `(${platform}): "${text.slice(0, 60)}"`
  );

  // Để AI đọc và trả lời. Lỗi ở bước này không được làm sự kiện thất bại:
  // tin nhắn đã lưu an toàn rồi, thử lại sẽ gửi trùng cho khách.
  try {
    await handleIncomingMessage(message.conversationId);
  } catch (error) {
    const loi = error instanceof Error ? error.message : String(error);
    console.error(
      `[sự kiện] AI không xử lý được hội thoại ${message.conversationId}:`,
      loi
    );

    /*
     * LỖI TẠM THỜI KHÔNG ĐƯỢC COI LÀ NHƯỜNG QUYỀN.
     *
     * Bản trước hễ AI ném lỗi là lập tức đặt ai_enabled = FALSE vĩnh viễn. Hậu
     * quả thật: nhà cung cấp AI quá tải một nhịp, hay mạng chập chờn một giây,
     * là khách đó MẤT AI MÃI MÃI — kể cả hôm sau hỏi đúng thứ shop bán.
     *
     * Hàng đợi sự kiện vốn đã có sẵn cơ chế thử lại kèm giãn cách. Ném lỗi lên
     * để nó thử lại; chỉ khi hết sạch lượt mới gọi người thật, vì lúc đó mới
     * thật sự là không tự xử lý được.
     */
    const lanThu = event.attempt ?? 1;
    const toiDa = event.maxAttempts ?? 1;

    if (lanThu < toiDa) {
      console.log(
        `[sự kiện] Sẽ thử lại hội thoại ${message.conversationId} ` +
          `(lần ${lanThu}/${toiDa}) — chưa nhường quyền`
      );
      throw error;
    }

    /*
     * Chế độ tự chủ thì KHÔNG tắt AI, kể cả khi hết sạch lượt thử.
     *
     * Không có nhân viên nào để chuyển sang. Tắt đi nghĩa là hội thoại đó chết
     * cho tới khi khách tình cờ nhắn lại — mà lỗi ở đây thường chỉ là nhà cung
     * cấp AI quá tải một nhịp. Ghi nhật ký rồi để yên, lượt tin sau chạy lại
     * bình thường.
     */
    const cauHinh = await queryOne<{ settings: Record<string, unknown> }>(
      /*
       * Nối qua KÊNH để ra đúng Trang.
       *
       * Bản cũ nối ai_configs với conversations bằng user_id, tức là lấy cấu
       * hình của tài khoản. Tài khoản nhiều Trang thì đó là cấu hình của Trang
       * nào cũng được — sai ngay khi có Trang thứ hai.
       */
      `SELECT a.settings FROM ai_configs a
         JOIN social_accounts s ON s.trang_id = a.trang_id
         JOIN conversations c ON c.social_account_id = s.id
        WHERE c.id = $1 AND a.kind = 'sales'`,
      [message.conversationId]
    ).catch(() => null);

    if (docTuChu(cauHinh?.settings?.tuChu).bat) {
      console.warn(
        `[sự kiện] Hết ${toiDa} lượt thử với hội thoại ${message.conversationId}, ` +
          `nhưng đang ở chế độ tự chủ nên KHÔNG tắt AI`
      );
      return;
    }

    console.warn(
      `[sự kiện] Hết ${toiDa} lượt thử với hội thoại ${message.conversationId}, ` +
        `chuyển cho nhân viên`
    );
    await query(
      `UPDATE conversations
          SET status = 'waiting_human', ai_enabled = FALSE,
              handoff_reason = COALESCE(handoff_reason, 'AI gặp lỗi, cần người xử lý'),
              handoff_at = COALESCE(handoff_at, now()), updated_at = now()
        WHERE id = $1 AND status = 'ai'`,
      [message.conversationId]
    ).catch(() => {});
  }
}

/**
 * Tin do shop gửi đi — cả tin AI vừa gửi, tin nhân viên gửi từ ứng dụng khác,
 * và tin trả lời tự động do chính Facebook đặt trong cài đặt Trang.
 *
 * Điểm quan trọng: khi AI gửi tin, hệ thống đã ghi một dòng sender_type='ai'
 * NGAY LÚC GỬI, nhưng lúc đó chưa biết id tin nhắn phía nền tảng. Vài giây sau
 * webhook message.sent mang id thật về. Nếu chèn thẳng thành 'human' thì mỗi
 * câu AI nói bị lưu hai lần — một lần 'ai', một lần 'human'.
 *
 * Hậu quả đã quan sát được trên dữ liệu thật ngày 17/08/2026: lịch sử chat hiện
 * đôi mọi câu AI, chỉ số "AI đã phản hồi" đếm thiếu, và số tin do người gửi bị
 * thổi phồng. Nên ở đây phải khớp lại dòng đã có thay vì chèn dòng mới.
 */
async function handleMessageSent(event: WebhookEvent): Promise<void> {
  const message = event.payload.message as MessagePayload | undefined;
  if (!message?.conversationId || !message.id) return;

  const conversation = await queryOne<{ user_id: number }>(
    "SELECT user_id FROM conversations WHERE id = $1",
    [message.conversationId]
  );
  if (!conversation) return;

  const externalId = message.platformMessageId ?? message.id;
  const text = typeof message.text === "string" ? message.text : "";

  // Tìm dòng hệ thống vừa ghi cho chính tin này: cùng hội thoại, cùng nội dung,
  // do phía shop gửi, chưa có id nền tảng, và trong vòng 5 phút.
  const existing = await queryOne<{ id: number }>(
    `SELECT id FROM messages
      WHERE conversation_id = $1
        AND sender_type IN ('ai', 'human')
        AND external_id IS NULL
        AND content = $2
        AND sent_at > now() - interval '5 minutes'
      ORDER BY created_at DESC LIMIT 1`,
    [message.conversationId, text]
  );

  if (existing) {
    // Bổ sung id nền tảng vào đúng dòng đã có, giữ nguyên sender_type.
    // Từ giờ dòng này có id nên webhook giao lặp sẽ bị khoá duy nhất chặn lại.
    await query("UPDATE messages SET external_id = $2 WHERE id = $1", [
      existing.id,
      externalId,
    ]);
    return;
  }

  // Không khớp dòng nào: đây là tin gửi từ nơi khác — nhân viên trả lời trực
  // tiếp trên Facebook, hoặc tin trả lời tự động của Trang. Ghi là 'human'.
  await query(
    `INSERT INTO messages
       (user_id, conversation_id, external_id, sender_type, content, sent_at)
     VALUES ($1, $2, $3, 'human', $4, now())
     ON CONFLICT (conversation_id, external_id) WHERE external_id IS NOT NULL
     DO NOTHING`,
    [conversation.user_id, message.conversationId, externalId, text]
  );
}

// ---------------------------------------------------------------------------
// Tài khoản và bài đăng
// ---------------------------------------------------------------------------

async function handleAccountChange(event: WebhookEvent): Promise<void> {
  if (!event.accountId) return;

  const connected = event.eventType === "account.connected";
  const result = await query(
    `UPDATE social_accounts
        SET connected = $2, needs_reconnection = $3, updated_at = now()
      WHERE id = $1`,
    [event.accountId, connected, !connected]
  );

  /*
   * KÊNH MỚI TINH: lệnh UPDATE ở trên khớp 0 dòng.
   *
   * Đây từng là một lỗ thủng thật. Khách kết nối Fanpage xong, Zernio gửi
   * account.connected, hệ thống nhận đủ, đánh dấu đã xử lý — nhưng vì chỉ có
   * UPDATE nên KHÔNG có dòng nào được tạo. Kênh coi như không tồn tại, màn hình
   * kết nối quay mãi, và chủ shop không hiểu vì sao.
   *
   * Không dựng bản ghi từ nội dung webhook (thiếu ảnh đại diện, số người theo
   * dõi, hạn token) mà kéo nguyên hồ sơ từ Zernio về — đúng một nguồn dữ liệu
   * với lúc bấm đồng bộ tay.
   */
  if (result.rowCount === 0 && connected) {
    const account = event.payload.account as { profileId?: string } | undefined;
    const profileId = account?.profileId;

    if (!profileId) {
      console.warn(
        `[sự kiện] Kênh mới ${event.accountId} nhưng gói tin thiếu profileId, không biết của gian hàng nào`
      );
      return;
    }

    // Hồ sơ có thể là hồ sơ riêng của một Trang, không chỉ hồ sơ mặc định.
    const chuId = await chuCuaHoSo(profileId);
    const owner = chuId === null ? null : { id: chuId };

    if (!owner) {
      console.warn(
        `[sự kiện] Kênh mới ${event.accountId} thuộc hồ sơ ${profileId} chưa gắn với gian hàng nào`
      );
      return;
    }

    const count = await syncAccountsForUser(owner.id, profileId);
    console.log(
      `[sự kiện] Kênh mới ${event.accountId} — đã kéo ${count} kênh về cho gian hàng ${owner.id}`
    );
    return;
  }

  console.log(
    `[sự kiện] Tài khoản ${event.accountId} ${connected ? "đã kết nối" : "mất kết nối"}`
  );
}

async function handlePostResult(event: WebhookEvent): Promise<void> {
  const post = event.payload.post as
    | {
        id?: string;
        url?: string;
        error?: string;
        platforms?: Array<{
          platform?: string;
          status?: string;
          publishedUrl?: string;
          platformPostUrl?: string;
          error?: string;
        }>;
      }
    | undefined;
  if (!post?.id) return;

  /*
   * Liên kết bài nằm trong platforms[], KHÔNG nằm ở post.url.
   *
   * Bản trước đọc post.url — một trường không có trong gói tin thật, nên
   * platform_urls luôn rỗng và nút "Xem trên nền tảng" bấm vào không đi đâu cả.
   * Kiểm chứng bằng gói tin thật: mỗi kênh có publishedUrl riêng.
   *
   * Gom theo TÊN NỀN TẢNG chứ không theo accountId, vì giao diện tra cứu theo
   * 'facebook', 'instagram'… và một bài có thể lên nhiều kênh cùng lúc.
   */
  const lienKet: Record<string, string> = {};
  for (const kenh of post.platforms ?? []) {
    const url = kenh.publishedUrl ?? kenh.platformPostUrl;
    if (url && kenh.platform) lienKet[kenh.platform] = url;
  }
  if (post.url && Object.keys(lienKet).length === 0) {
    lienKet[event.accountId ?? "unknown"] = post.url;
  }

  // partial = đăng được một số kênh, thất bại số còn lại. Coi là đã đăng
  // nhưng giữ lại thông báo để chủ shop biết kênh nào chưa lên.
  const published =
    event.eventType === "post.published" || event.eventType === "post.partial";

  await query(
    `UPDATE posts
        SET status       = $2,
            published_at = CASE WHEN $3 THEN now() ELSE published_at END,
            platform_urls = platform_urls || $4::jsonb,
            last_error   = $5,
            updated_at   = now()
      WHERE platform_post_ref = $1`,
    [
      post.id,
      published ? "published" : "failed",
      published,
      JSON.stringify(lienKet),
      event.eventType === "post.published"
        ? null
        : (post.error ??
           (event.eventType === "post.partial"
             ? "Một số kênh đăng chưa thành công"
             : "Đăng bài thất bại")),
    ]
  );
}
