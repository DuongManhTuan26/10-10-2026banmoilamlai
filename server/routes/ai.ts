import { MODEL_GIONG_DOC_DUOC_CHON, MODEL_NHIEU_CANH, MODEL_NOI_DAI, MODEL_TIENG_VIET_GOC } from "../services/model-duoc-chon.js";
import { Router } from "express";
import { query, queryOne } from "../db.js";
import { requireAuth } from "../auth.js";
import { AppError, requireString, route } from "../http.js";
import { chat, chatJson, asRecord, stringArray, DEFAULT_MODELS } from "../services/ai.js";
import { extractOrderInfo, suggestReply } from "../services/sales-ai.js";
import { generatePostContent } from "../services/content-ai.js";
import { naoCua } from "../khoi-nao.js";

import { docCauHinh, MAC_DINH, taoVideoTheoBai, tienVideoTuDongThang } from "../services/autopilot.js";
import { docChuTuAnh, ANH_HOP_LE, GIOI_HAN_ANH } from "../services/vision.js";
import { docCacBuoc } from "../services/sales-stages.js";
import { docTuChu } from "../services/sales-autonomy.js";
import { boMarkdown, DAN_KHONG_MARKDOWN } from "../services/text.js";
import { taoAnhChoBai, docPhongCachDaLuu, giaKhungVideo, layDanhSachModelAnh, layModelAnh, PHONG_CACH_MAC_DINH, type LuaChonVeAnh } from "../services/image-ai.js";
import { giaAnh, NGUON_XEP_HANG_ANH, phanKhucAnh } from "../services/model-anh.js";
import { docAnhThuVien, docLoai, docTen, dsThuVien, dungAnh, themVaoThuVien, xoaThuVien } from "../services/thu-vien-anh.js";
import { anDiaChiKho } from "../services/media-proxy.js";
import { chanLamDungAI } from "../services/chong-lam-dung.js";
import {
  COT_VIEC,
  giaVideo,
  type HuongKichBan,
  type LuatNoiDung,
  phanKhucTheoGia,
  layDanhSachModel,
  lyDoKhongHop,
  MUC_DICH_VIDEO,
  taoVideo,
  vietLoiMoTaVideo,
  type LuaChonVideo,
  type ViecVideo,
} from "../services/video-ai.js";
import { baoGiaVideoDai, batDauDuAn, COT_DU_AN, docAmThanh, tiepTucDuAn, suaDuAn, taoDuAn, type DuAnVideo } from "../services/video-dai.js";
import { layModelSuaVideo, suaVideo } from "../services/video-sua.js";
import { phanTichTrend } from "../services/video-trend.js";

export const aiRouter = Router();

aiRouter.use(requireAuth);

const KINDS = new Set(["content", "ads", "sales", "analytics"]);

function assertKind(kind: string): string {
  if (!KINDS.has(kind)) {
    throw new AppError(
      `Loại AI không hợp lệ: ${kind}. Chỉ nhận: content, ads, sales, analytics.`
    );
  }
  return kind;
}

// ---------------------------------------------------------------------------
// Cấu hình và huấn luyện — mỗi loại AI có phần riêng
// ---------------------------------------------------------------------------

aiRouter.get(
  "/configs/:kind",
  route(async (req, res) => {
    const kind = assertKind(req.params.kind);

    const config = await queryOne(
      `SELECT kind, system_prompt, tone, settings, updated_at
         FROM ai_configs WHERE trang_id = $1 AND kind = $2`,
      [naoCua(req).trangId, kind]
    );

    const documents = await query(
      `SELECT id, filename, mime_type, size_bytes, created_at,
              extracted_text IS NOT NULL AS has_text
         FROM ai_documents WHERE trang_id = $1 AND kind = $2
         ORDER BY created_at DESC`,
      [naoCua(req).trangId, kind]
    );

    res.json({
      success: true,
      data: {
        config: config ?? { kind, system_prompt: "", tone: "friendly", settings: {} },
        documents: documents.rows,
        model: DEFAULT_MODELS[kind as keyof typeof DEFAULT_MODELS],
      },
    });
  })
);

aiRouter.put(
  "/configs/:kind",
  route(async (req, res) => {
    const kind = assertKind(req.params.kind);
    const body = req.body ?? {};

    /*
     * CHỈ ghi những trường màn hình thật sự gửi lên.
     *
     * Lỗi cũ, tái hiện được: hộp thoại Vai trò chỉ gửi systemPrompt, nhưng câu
     * lệnh lại ghi đè cả dòng — nên mỗi lần bấm "Lưu cấu hình AI" là tone tụt
     * về 'friendly' và settings bị thay bằng {}. Với AI viết bài, settings
     * chính là chỗ chứa TOÀN BỘ lịch tự đăng: ngày, khung giờ, danh sách chủ
     * đề, chốt chặn. Một cú bấm ở màn hình khác xoá sạch, không hỏi, không báo.
     *
     * Đo trước khi sửa:
     *   trước: tone=professional  settings={autoPilot:{…}, autoPublish:true}
     *   sau:   tone=friendly      settings={}
     *
     * NULL ở đây nghĩa là "màn hình không đụng tới trường này", khác hẳn với
     * "màn hình muốn xoá trắng nó".
     */
    const updated = await queryOne(
      `INSERT INTO ai_configs (user_id, trang_id, kind, system_prompt, tone, settings)
       VALUES ($6, $1, $2, COALESCE($3, ''), COALESCE($4, 'friendly'),
               COALESCE($5::jsonb, '{}'::jsonb))
       ON CONFLICT (trang_id, kind) DO UPDATE SET
         system_prompt = COALESCE($3, ai_configs.system_prompt),
         tone          = COALESCE($4, ai_configs.tone),
         settings      = COALESCE($5::jsonb, ai_configs.settings),
         updated_at    = now()
       RETURNING kind, system_prompt, tone, settings, updated_at`,
      [
        naoCua(req).trangId,
        kind,
        typeof body.systemPrompt === "string" ? body.systemPrompt : null,
        typeof body.tone === "string" ? body.tone : null,
        body.settings === undefined ? null : JSON.stringify(body.settings),
        naoCua(req).chuId,
      ]
    );

    res.json({ success: true, data: updated });
  })
);

/**
 * Chế độ AI bán hàng tự chủ.
 *
 * Bật lên là AI tự chốt tiền, tự lên đơn, không ai duyệt. Vì vậy mặc định TẮT
 * và chỉ chủ shop bật được — hệ thống không tự quyết thay.
 */
aiRouter.get(
  "/sales-autonomy",
  route(async (req, res) => {
    const row = await queryOne<{ settings: Record<string, unknown> }>(
      "SELECT settings FROM ai_configs WHERE trang_id = $1 AND kind = 'sales'",
      [naoCua(req).trangId]
    );
    res.json({ success: true, data: { config: docTuChu(row?.settings?.tuChu) } });
  })
);

aiRouter.put(
  "/sales-autonomy",
  route(async (req, res) => {
    const sach = docTuChu(req.body?.config);

    const updated = await queryOne<{ settings: Record<string, unknown> }>(
      `INSERT INTO ai_configs (user_id, trang_id, kind, settings)
       VALUES ($3, $1, 'sales', $2::jsonb)
       ON CONFLICT (trang_id, kind) DO UPDATE SET
         settings   = ai_configs.settings || EXCLUDED.settings,
         updated_at = now()
       RETURNING settings`,
      [naoCua(req).trangId, JSON.stringify({ tuChu: sach }), naoCua(req).chuId]
    );

    /*
     * Bật tự chủ thì CỨU NGAY những hội thoại đang bị bỏ.
     *
     * Đã xảy ra thật: AI nhường quyền lúc 18:28 khi tự chủ còn tắt, chủ shop
     * bật tự chủ lúc 18:37, nhưng hội thoại vẫn nằm im vì cơ chế hồi sinh chỉ
     * chạy khi khách nhắn tin TIẾP. Khách không nhắn nữa là chết vĩnh viễn —
     * mà chủ shop nhìn công tắc thấy "đang chạy" nên tưởng mọi thứ đã ổn.
     *
     * KHÔNG đụng vào hội thoại status = 'human': ở đó chủ shop đang tự tay
     * trả lời, xen vào là hai bên cùng nhắn một khách.
     */
    let daCuu = 0;
    if (sach.bat) {
      const cuu = await query(
        `UPDATE conversations
            SET status = 'ai', ai_enabled = TRUE, handoff_reason = NULL,
                handoff_at = NULL, updated_at = now()
          WHERE trang_id = $1 AND status = 'waiting_human'
          RETURNING id`,
        [naoCua(req).trangId]
      );
      daCuu = cuu.rowCount ?? 0;
      if (daCuu > 0) {
        console.log(`[tự chủ] Bật tự chủ: đã trả ${daCuu} hội thoại lại cho AI.`);
      }
    }

    res.json({
      success: true,
      data: { config: docTuChu(updated?.settings?.tuChu), hoiThoaiDaCuu: daCuu },
    });
  })
);

/**
 * Các bước bán hàng qua Messenger.
 *
 * Đọc và ghi đều đi qua docCacBuoc nên luôn đủ 6 bước theo đúng thứ tự, dù
 * giao diện gửi lên thiếu hay thừa. Chủ shop chỉ được đổi hai thứ: bật/tắt và
 * lời dặn riêng — mục tiêu của từng bước là phần khung, không cho sửa, vì đó
 * là thứ giữ cho AI không nhảy thẳng vào xin số điện thoại.
 */
aiRouter.get(
  "/sales-stages",
  route(async (req, res) => {
    const row = await queryOne<{ settings: Record<string, unknown> }>(
      "SELECT settings FROM ai_configs WHERE trang_id = $1 AND kind = 'sales'",
      [naoCua(req).trangId]
    );
    res.json({ success: true, data: { stages: docCacBuoc(row?.settings?.stages) } });
  })
);

aiRouter.put(
  "/sales-stages",
  route(async (req, res) => {
    const sach = docCacBuoc(req.body?.stages);

    /*
     * Xoá hết bước thì AI không còn kịch bản nào để đi. Chặn ở đây thay vì âm
     * thầm nhét lại bộ mặc định — nhét lại nghĩa là chủ shop xoá mà không xoá
     * được, đó mới là thứ khó hiểu.
     */
    if (!Array.isArray(req.body?.stages) || req.body.stages.length === 0) {
      throw new AppError("Phải giữ lại ít nhất một bước bán hàng.", 400);
    }
    if (!sach.some((b) => b.enabled)) {
      throw new AppError(
        "Phải bật ít nhất một bước, nếu không AI không biết phải làm gì khi khách nhắn tới.",
        400
      );
    }
    if (sach.some((b) => !b.mucTieu.trim())) {
      throw new AppError(
        "Mỗi bước phải ghi rõ AI cần làm gì ở bước đó, không được để trống.",
        400
      );
    }

    const updated = await queryOne<{ settings: Record<string, unknown> }>(
      `INSERT INTO ai_configs (user_id, trang_id, kind, settings)
       VALUES ($3, $1, 'sales', $2::jsonb)
       ON CONFLICT (trang_id, kind) DO UPDATE SET
         settings   = ai_configs.settings || EXCLUDED.settings,
         updated_at = now()
       RETURNING settings`,
      [
        naoCua(req).trangId,
        JSON.stringify({
          stages: sach.map((b) => ({ id: b.id, ten: b.ten, mucTieu: b.mucTieu, enabled: b.enabled })),
        }),
        naoCua(req).chuId,
      ]
    );

    res.json({ success: true, data: { stages: docCacBuoc(updated?.settings?.stages) } });
  })
);

/**
 * Lịch tự viết và tự đăng bài.
 *
 * Đọc và ghi đi qua docCauHinh để mọi giá trị rác bị loại ngay tại cửa: giờ
 * sai định dạng, thứ ngoài 0-6, chủ đề rỗng, số phút chờ vô lý. Giao diện có
 * thể sai, nhưng thứ chạy lúc 8 giờ sáng thì không được phép sai.
 */
aiRouter.get(
  "/auto-pilot",
  route(async (req, res) => {
    const trangGet = naoCua(req).trangId;
    const row = await queryOne<{ settings: Record<string, unknown> }>(
      "SELECT settings FROM ai_configs WHERE trang_id = $1 AND kind = 'content'",
      [trangGet]
    );

    const runs = await query(
      `SELECT slot_key, status, topic, post_id, note, created_at
         FROM auto_pilot_runs WHERE trang_id = $1
        ORDER BY id DESC LIMIT 20`,
      [trangGet]
    );

    res.json({
      success: true,
      data: {
        config: row?.settings?.autoPilot ? docCauHinh(row.settings.autoPilot) : MAC_DINH,
        runs: runs.rows,
        // Tiền video tự động đã dùng tháng này — để so với trần người dùng đặt.
        tienVideoThang: trangGet ? await tienVideoTuDongThang(trangGet) : 0,
      },
    });
  })
);

aiRouter.put(
  "/auto-pilot",
  route(async (req, res) => {
    const sach = docCauHinh(req.body?.config);

    // Bật lịch mà không có chủ đề nào thì mỗi sáng sẽ chỉ ghi một dòng "bỏ
    // lượt" vào nhật ký. Nói ngay tại đây thay vì để chủ shop chờ mấy ngày.
    if (sach.enabled && sach.topics.length === 0) {
      throw new AppError(
        "Vui lòng nhập ít nhất một chủ đề trước khi bật lịch, nếu không AI sẽ không có nội dung để viết.",
        400
      );
    }

    if (sach.enabled && sach.days.length === 0) {
      throw new AppError(
        "Vui lòng chọn ít nhất một ngày trong tuần, nếu không lịch sẽ không chạy.",
        400
      );
    }

    // Bật tự tạo video: chọn mô hình làm được đúng thông số, và đặt trần tiền tháng.
    if (sach.video.bat) {
      if (!sach.video.model) throw new AppError("Chọn mô hình video trước khi bật tự tạo video theo bài.", 400);
      const mv = (await layDanhSachModel()).find((m) => m.id === sach.video.model);
      if (!mv) throw new AppError("Mô hình video đã chọn không còn. Chọn mô hình khác.", 400);
      const lyDoV = lyDoKhongHop(mv, { ...sach.video, coAnhMoDau: sach.anh.bat });
      if (lyDoV) throw new AppError(`Mô hình video này ${lyDoV}.`, 400);
      if (!(sach.video.tranThangUsd > 0)) {
        throw new AppError("Đặt trần tiền video mỗi tháng trước khi bật — chạm trần thì lịch tự đăng kèm ảnh thay video.", 400);
      }
    }

    // Bật tự vẽ ảnh thì phải chọn mô hình có thật; thông số chuẩn theo đúng khả năng mô hình.
    if (sach.anh.bat) {
      if (!sach.anh.model) throw new AppError("Chọn mô hình vẽ ảnh trước khi bật tự tạo ảnh theo bài.", 400);
      const { lc } = await layModelAnh(sach.anh);
      sach.anh = { ...sach.anh, doNet: lc.doNet, chatLuong: lc.chatLuong, khung: lc.khung };
    }

    const updated = await queryOne(
      `INSERT INTO ai_configs (user_id, trang_id, kind, settings)
       VALUES ($3, $1, 'content', $2::jsonb)
       ON CONFLICT (trang_id, kind) DO UPDATE SET
         settings   = ai_configs.settings || EXCLUDED.settings,
         updated_at = now()
       RETURNING settings`,
      [naoCua(req).trangId, JSON.stringify({ autoPilot: sach }), naoCua(req).chuId]
    );

    res.json({ success: true, data: { config: sach, saved: !!updated } });
  })
);

/**
 * Sửa một vài khoá trong `settings` mà không đụng tới phần còn lại.
 *
 * PUT ở trên ghi đè cả bản ghi: ai gọi nó chỉ để lưu một lựa chọn nhỏ sẽ xoá
 * sạch lời huấn luyện chủ shop đã nhập ở màn hình Huấn luyện AI. Route này gộp
 * bằng toán tử `||` của JSONB nên mỗi màn hình chỉ ghi đúng phần của mình.
 */
aiRouter.patch(
  "/configs/:kind/settings",
  route(async (req, res) => {
    const kind = assertKind(req.params.kind);
    const body = req.body ?? {};
    const patch = body.settings;

    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
      throw new AppError("Thiếu phần cài đặt cần lưu.", 400);
    }

    const updated = await queryOne(
      `INSERT INTO ai_configs (user_id, trang_id, kind, settings)
       VALUES ($4, $1, $2, $3::jsonb)
       ON CONFLICT (trang_id, kind) DO UPDATE SET
         settings   = ai_configs.settings || EXCLUDED.settings,
         updated_at = now()
       RETURNING kind, system_prompt, tone, settings, updated_at`,
      [naoCua(req).trangId, kind, JSON.stringify(patch), naoCua(req).chuId]
    );

    res.json({ success: true, data: updated });
  })
);

/**
 * Nạp tài liệu huấn luyện.
 *
 * Nhận hai dạng: chữ đã trích sẵn (tệp .txt, .csv…), hoặc ảnh gửi kèm dưới
 * dạng data URL. Ảnh được đọc thành chữ NGAY tại đây rồi lưu vào cùng một cột
 * extracted_text — từ đó trở đi nó không khác gì một tệp .txt, nên cả bốn AI
 * dùng được mà không phải sửa gì thêm.
 *
 * Video thì chưa: muốn học được cần bóc lời thoại, mà hệ thống chưa có dịch vụ
 * chuyển giọng nói thành chữ. Nói thẳng là chưa hỗ trợ, không nhận rồi bỏ đi.
 */
aiRouter.post(
  "/configs/:kind/documents",
  chanLamDungAI,
  route(async (req, res) => {
    const kind = assertKind(req.params.kind);
    const body = req.body ?? {};

    const filename = requireString(body, "filename", "tên tệp");
    const mimeType = typeof body.mimeType === "string" ? body.mimeType : "";
    const sizeBytes = Number(body.sizeBytes ?? 0);
    let text = typeof body.text === "string" ? body.text : null;

    const anh = typeof body.imageDataUrl === "string" ? body.imageDataUrl : null;
    if (anh) {
      if (!ANH_HOP_LE.test(anh)) {
        throw new AppError("Chỉ nhận ảnh PNG, JPG, WEBP hoặc GIF.", 400);
      }
      if (anh.length > GIOI_HAN_ANH) {
        throw new AppError(
          "Ảnh quá lớn. Vui lòng chụp lại với kích thước nhỏ hơn, hoặc cắt bớt phần thừa.",
          400
        );
      }

      const doc = await docChuTuAnh({ dataUrl: anh, filename, userId: naoCua(req).chuId });
      if (!doc.text) {
        throw new AppError(
          "Không đọc được chữ nào trong ảnh này. Vui lòng chụp rõ hơn, hoặc gõ lại " +
            "nội dung ra tệp .txt rồi tải lên.",
          422
        );
      }
      text = doc.text;
    }

    const MAX_TEXT = 200_000;
    if (text && text.length > MAX_TEXT) {
      throw new AppError(
        `Tài liệu quá dài (${text.length} ký tự). Giới hạn ${MAX_TEXT} ký tự cho mỗi tệp.`
      );
    }

    const inserted = await queryOne(
      `INSERT INTO ai_documents
         (user_id, trang_id, kind, filename, mime_type, size_bytes, storage_path, extracted_text)
       VALUES ($1, $2, $3, $4, $5, $6, '', $7)
       RETURNING id, filename, mime_type, size_bytes, created_at,
                 extracted_text IS NOT NULL AS has_text`,
      [naoCua(req).chuId, naoCua(req).trangId, kind, filename, mimeType, sizeBytes || (text?.length ?? 0), text]
    );

    res.status(201).json({ success: true, data: inserted });
  })
);

aiRouter.delete(
  "/configs/:kind/documents/:id",
  route(async (req, res) => {
    const kind = assertKind(req.params.kind);
    const result = await query(
      "DELETE FROM ai_documents WHERE id = $1 AND trang_id = $2 AND kind = $3",
      [req.params.id, naoCua(req).trangId, kind]
    );
    if (!result.rowCount) throw new AppError("Không tìm thấy tài liệu", 404);
    res.json({ success: true });
  })
);

// ---------------------------------------------------------------------------
// Sinh nội dung
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AI tạo video
// ---------------------------------------------------------------------------

/** Đọc lựa chọn video từ query hoặc body, có giá trị mặc định hợp lý. */
function docLuaChonVideo(nguon: Record<string, unknown>): LuaChonVideo {
  const soGiay = Number(nguon.soGiay);
  return {
    soGiay: Number.isInteger(soGiay) && soGiay > 0 && soGiay <= 60 ? soGiay : 8,
    doNet: typeof nguon.doNet === "string" && /^[0-9a-zA-Z]{2,6}$/.test(nguon.doNet) ? nguon.doNet : "720p",
    khung: typeof nguon.khung === "string" && /^\d{1,2}:\d{1,2}$/.test(nguon.khung) ? nguon.khung : "9:16",
    coTieng: nguon.coTieng === true || nguon.coTieng === "true",
    coAnhMoDau: nguon.coAnhMoDau === true || nguon.coAnhMoDau === "true",
    chuTrongVideo: nguon.chuTrongVideo === "khong" ? "khong" : "theo_noi_dung",
    ...docLuatNoiDung(nguon),
  };
}

const bat = (v: unknown) => v === true || v === "true";

/** Luật nội dung người dùng bật/tắt — không gài cứng (chủ dự án 03/10/2026). */
function docLuatNoiDung(nguon: Record<string, unknown>): LuatNoiDung {
  return { chanNhanHieuGia: bat(nguon.chanNhanHieuGia), chanNguoiThat: bat(nguon.chanNguoiThat), xoaWatermark: bat(nguon.xoaWatermark) };
}

/** Hướng kịch bản người dùng bật/tắt — không gài cứng (chủ dự án 03/10/2026). */
function docHuongKichBan(nguon: Record<string, unknown>): HuongKichBan {
  return { cauTrucQuangCao: bat(nguon.cauTrucQuangCao), giuSuThat: bat(nguon.giuSuThat), boiCanhVietNam: bat(nguon.boiCanhVietNam) };
}

/**
 * Mọi model video kèm giá cho ĐÚNG lựa chọn đang chọn, xếp rẻ tới đắt.
 *
 * Model không làm được lựa chọn này vẫn trả về (xếp cuối, kèm lý do) để chủ
 * shop biết vì sao không chọn được, thay vì tự dưng biến mất.
 */
aiRouter.get(
  "/video/models",
  route(async (req, res) => {
    const q = req.query as Record<string, unknown>;
    const lc = docLuaChonVideo(q);
    const ds = await layDanhSachModel();
    // Video dài: báo giá trọn video theo đúng lựa chọn (độ dài, cách làm, giọng, nhạc, tự kiểm).
    const tongGiay = Number(q.tongGiay);
    const duAn = Number.isFinite(tongGiay) && tongGiay > 0
      ? {
          tongGiay,
          cheDo: (q.cheDo === "noi_dai" ? "noi_dai" : "ghep_canh") as "noi_dai" | "ghep_canh",
          amThanh: docAmThanh({ giongDoc: bat(q.giongDoc), giongGoc: bat(q.giongGoc), nhac: bat(q.nhac), modelGiong: q.modelGiong }),
          soThamChieu: Math.min(4, Math.max(0, Math.round(Number(q.soThamChieu)) || 0)),
          tuKiem: q.tuKiem !== "false",
          // Giá khung mở đầu theo mô hình vẽ ảnh người dùng chọn (ghép cảnh có cảnh cắt mới vẽ).
          giaKhung: await giaKhungVideo(
            typeof q.khungModel === "string" && q.khungModel
              ? { model: q.khungModel, doNet: typeof q.khungDoNet === "string" ? q.khungDoNet : undefined, chatLuong: typeof q.khungChatLuong === "string" ? q.khungChatLuong : undefined }
              : undefined
          ),
        }
      : null;
    const models = ds
      .map((m) => {
        const gia = giaVideo(m, lc);
        const lyDo = lyDoKhongHop(m, lc);
        return {
          id: m.id,
          ten: m.ten,
          soGiay: m.soGiay,
          doNet: m.doNet,
          khung: m.khung,
          coTieng: m.coTieng,
          anhMoDau: m.anhMoDau,
          giaUocTinh: gia === null ? null : Math.round(gia * 10_000) / 10_000,
          lyDo,
          phanKhuc: gia === null || lyDo ? (m.phanKhuc ?? null) : phanKhucTheoGia(gia / lc.soGiay),
          xepHang: m.xepHang ?? null,
          ghiChu: m.ghiChu ?? null,
          // Thế mạnh riêng theo tài liệu chính thức của hãng (model-duoc-chon.ts) — để hướng dẫn người dùng chọn.
          noiDai: Boolean(MODEL_NOI_DAI[m.id]),
          nhieuCanh: MODEL_NHIEU_CANH.has(m.id),
          tiengVietGoc: MODEL_TIENG_VIET_GOC.has(m.id),
          giayToiDa: m.soGiay[m.soGiay.length - 1] ?? null,
          // Giọng gốc chỉ ở mô hình nói tiếng Việt; mô hình khác thì giao diện tự về giọng AI (Flash-Lite).
          giaCaVideo: duAn
            ? baoGiaVideoDai(m, lc, duAn.amThanh.giongGoc && !MODEL_TIENG_VIET_GOC.has(m.id)
              ? { ...duAn, amThanh: { ...duAn.amThanh, giongGoc: false, giongDoc: true, modelGiong: MODEL_GIONG_DOC_DUOC_CHON[0].id } }
              : duAn)
            : null,
        };
      })
      .sort((a, b) => {
        if (!a.lyDo !== !b.lyDo) return a.lyDo ? 1 : -1;
        return (a.giaUocTinh ?? Infinity) - (b.giaUocTinh ?? Infinity);
      });
    res.json({
      success: true,
      data: { luaChon: lc, models, mucDich: MUC_DICH_VIDEO },
    });
  })
);

/** AI viết lời mô tả video từ bài viết. Tốn một lượt AI chữ nên qua chốt. */
aiRouter.post(
  "/video/loi-mo-ta",
  chanLamDungAI,
  route(async (req, res) => {
    naoCua(req); // Phải đang ở một khối não (trang).
    const lc = docLuaChonVideo(req.body ?? {});
    const kq = await vietLoiMoTaVideo({
      userId: naoCua(req).chuId,
      noiDung: typeof req.body?.noiDung === "string" ? req.body.noiDung : "",
      mucDich: typeof req.body?.mucDich === "string" ? req.body.mucDich : "khoe_san_pham",
      soGiay: lc.soGiay,
      coAnhMoDau: lc.coAnhMoDau,
      chuTrongVideo: lc.chuTrongVideo,
      huong: docHuongKichBan(req.body ?? {}),
      luat: docLuatNoiDung(req.body ?? {}),
    });
    res.json({ success: true, data: kq });
  })
);

function viecRaNgoai(v: ViecVideo) {
  return { ...v, url: v.url ? anDiaChiKho(v.url) : null };
}

/** Gửi việc tạo video. Trả về ngay; worker tự theo dõi tới khi xong. */
aiRouter.post(
  "/video",
  chanLamDungAI,
  route(async (req, res) => {
    const trangId = naoCua(req).trangId;
    const viec = await taoVideo({
      userId: naoCua(req).chuId,
      trangId,
      model: typeof req.body?.model === "string" ? req.body.model : "",
      loiMoTa: typeof req.body?.loiMoTa === "string" ? req.body.loiMoTa : "",
      lc: docLuaChonVideo(req.body ?? {}),
      anhMoDau: typeof req.body?.anhMoDau === "string" && req.body.anhMoDau ? req.body.anhMoDau : undefined,
    });
    res.status(202).json({ success: true, data: viecRaNgoai(viec) });
  })
);

/**
 * Video "theo bài" của bài soạn tay: AI viết lời nhắc từ nội dung bài, gửi việc tạo video, bài chờ video xong rồi tự
 * đăng (hoặc giao lịch nếu đã hẹn giờ). Chủ shop đã thấy giá và bấm đồng ý lúc bấm Đăng bài.
 */
aiRouter.post(
  "/video/theo-bai",
  chanLamDungAI,
  route(async (req, res) => {
    const trangId = naoCua(req).trangId;
    const b = req.body ?? {};
    const kq = await taoVideoTheoBai({
      userId: naoCua(req).chuId,
      trangId,
      postId: Number(b.postId),
      noiDung: typeof b.noiDung === "string" ? b.noiDung : "",
      model: typeof b.model === "string" ? b.model : "",
      lc: docLuaChonVideo(b),
      mucDich: typeof b.mucDich === "string" ? b.mucDich : "khoe_san_pham",
      huong: docHuongKichBan(b),
    });
    res.status(202).json({ success: true, data: kq });
  })
);

/** Các video của trang đang chọn, mới nhất trước. */
aiRouter.get(
  "/video/viec",
  route(async (req, res) => {
    const trangId = naoCua(req).trangId;
    const ds = trangId
      ? await query<ViecVideo>(
          `SELECT ${COT_VIEC} FROM video_ai WHERE trang_id = $1 AND du_an_id IS NULL ORDER BY created_at DESC LIMIT 20`,
          [trangId]
        )
      : { rows: [] as ViecVideo[] };
    res.json({ success: true, data: ds.rows.map(viecRaNgoai) });
  })
);

// ---------------------------------------------------------------------------
// Video dài nhiều cảnh
// ---------------------------------------------------------------------------

function duAnRaNgoai(d: DuAnVideo & { canh_xong?: number }) {
  return {
    ...d,
    url: d.url ? anDiaChiKho(d.url) : null,
    anh_tham_chieu: (d.anh_tham_chieu ?? []).map((u) => anDiaChiKho(u)),
  };
}

function maDuAn(v: unknown): number {
  const so = Number(v);
  if (!Number.isInteger(so) || so <= 0) throw new AppError("Không tìm thấy dự án video", 404);
  return so;
}

/** AI chia ý tưởng thành cảnh và báo giá. Chưa tạo video, chưa tốn tiền video. */
aiRouter.post(
  "/video/du-an",
  chanLamDungAI,
  route(async (req, res) => {
    const trangId = naoCua(req).trangId;
    const b = req.body ?? {};
    const loai = b.loai === "tham_chieu" || b.loai === "trend" ? b.loai : "kich_ban";
    const lc = docLuaChonVideo(b);
    const duAn = await taoDuAn({
      userId: naoCua(req).chuId,
      trangId,
      loai,
      yTuong: typeof b.yTuong === "string" ? b.yTuong : "",
      tongGiay: Number(b.tongGiay),
      model: typeof b.model === "string" ? b.model : "",
      lc: { doNet: lc.doNet, khung: lc.khung, coTieng: lc.coTieng },
      anhThamChieu: Array.isArray(b.anhThamChieu) ? b.anhThamChieu.filter((x: unknown): x is string => typeof x === "string") : [],
      congThucTrend: typeof b.congThucTrend === "string" ? b.congThucTrend.slice(0, 4_000) : undefined,
      amThanh: b.amThanh,
      tuKiem: b.tuKiem !== false,
      cheDo: b.cheDo === "noi_dai" ? "noi_dai" : "ghep_canh",
    });
    res.status(201).json({ success: true, data: duAnRaNgoai(duAn) });
  })
);

/** Sửa phân cảnh khi còn là nháp; giá tính lại theo cảnh đã sửa. */
aiRouter.put(
  "/video/du-an/:id",
  route(async (req, res) => {
    const trangId = naoCua(req).trangId;
    const duAn = await suaDuAn({
      trangId,
      id: maDuAn(req.params.id),
      nhatQuan: typeof req.body?.nhatQuan === "string" ? req.body.nhatQuan : "",
      phanCanh: req.body?.phanCanh,
      amThanh: req.body?.amThanh,
    });
    res.json({ success: true, data: duAnRaNgoai(duAn) });
  })
);

/** Chủ shop duyệt phân cảnh và giá → bắt đầu tạo. Từ đây mới tốn tiền video. */
aiRouter.post(
  "/video/du-an/:id/bat-dau",
  chanLamDungAI,
  route(async (req, res) => {
    const trangId = naoCua(req).trangId;
    const duAn = await batDauDuAn(trangId, maDuAn(req.params.id));
    res.status(202).json({ success: true, data: duAnRaNgoai(duAn) });
  })
);

/** Dự án bị lỗi: làm tiếp, giữ các cảnh đã tạo (đủ cảnh thì chỉ ghép lại). */
aiRouter.post(
  "/video/du-an/:id/tiep-tuc",
  chanLamDungAI,
  route(async (req, res) => {
    const trangId = naoCua(req).trangId;
    const duAn = await tiepTucDuAn(trangId, maDuAn(req.params.id));
    res.status(202).json({ success: true, data: duAnRaNgoai(duAn) });
  })
);

/** Các dự án video dài của trang, kèm số cảnh đã xong. */
aiRouter.get(
  "/video/du-an",
  route(async (req, res) => {
    const trangId = naoCua(req).trangId;
    const ds = trangId
      ? await query<DuAnVideo & { canh_xong: number }>(
          `SELECT ${COT_DU_AN},
                  (SELECT count(*)::int FROM video_ai v WHERE v.du_an_id = d.id AND v.trang_thai = 'xong' AND NOT v.bo_qua) AS canh_xong,
                  -- Tiền đã tiêu TỚI LÚC NÀY (cảnh đã tạo + khung, giọng, nhạc) — dự án lỗi giữa chừng
                  -- cũng phải hiện, đã thấy dự án #9 tiêu ~1,8 USD mà "đã tốn" để trống.
                  -- Cảnh bị loại: tiền đã chuyển vào chi_phi_them, nên chỉ cộng cảnh còn dùng (không tính hai lần).
                  (COALESCE((SELECT sum(v.gia_thuc) FROM video_ai v WHERE v.du_an_id = d.id AND NOT v.bo_qua), 0) + d.chi_phi_them)::float AS da_ton,
                  -- Cảnh vẫn còn lỗi (hết lượt vẽ lại) hoặc chưa kiểm được — báo cho chủ shop biết.
                  (SELECT coalesce(json_agg(json_build_object('canh', v.thu_tu + 1, 'ghiChu', v.kiem_dinh) ORDER BY v.thu_tu), '[]'::json)
                     FROM video_ai v WHERE v.du_an_id = d.id AND NOT v.bo_qua
                      AND (v.kiem_dinh LIKE 'loi:%' OR v.kiem_dinh LIKE 'khong_kiem_duoc:%')) AS canh_bao_kiem_dinh
             FROM du_an_video d WHERE trang_id = $1 ORDER BY created_at DESC LIMIT 20`,
          [trangId]
        )
      : { rows: [] as (DuAnVideo & { canh_xong: number })[] };
    res.json({ success: true, data: ds.rows.map(duAnRaNgoai) });
  })
);

// ---------------------------------------------------------------------------
// Video → video và trend → video
// ---------------------------------------------------------------------------

/** Model sửa video, xếp rẻ tới đắt, giá theo giây đầu ra. */
aiRouter.get(
  "/video/sua/models",
  route(async (_req, res) => {
    res.json({ success: true, data: await layModelSuaVideo() });
  })
);

/** Sửa video có sẵn. Đo độ dài video nguồn để báo giá, rồi gửi việc. */
aiRouter.post(
  "/video/sua",
  chanLamDungAI,
  route(async (req, res) => {
    const trangId = naoCua(req).trangId;
    const viec = await suaVideo({
      userId: naoCua(req).chuId,
      trangId,
      model: typeof req.body?.model === "string" ? req.body.model : "",
      videoNguon: typeof req.body?.videoNguon === "string" ? req.body.videoNguon : "",
      yeuCau: typeof req.body?.yeuCau === "string" ? req.body.yeuCau : "",
      luat: docLuatNoiDung(req.body ?? {}),
    });
    res.status(202).json({ success: true, data: viecRaNgoai(viec) });
  })
);

/** AI xem video trend, rút ra công thức để làm video mới theo công thức đó. */
aiRouter.post(
  "/video/trend/phan-tich",
  chanLamDungAI,
  route(async (req, res) => {
    const trangId = naoCua(req).trangId;
    const kq = await phanTichTrend({
      userId: naoCua(req).chuId,
      trangId,
      videoNguon: typeof req.body?.videoNguon === "string" ? req.body.videoNguon : "",
    });
    res.json({ success: true, data: kq });
  })
);

/** Phong cách vẽ ảnh chủ shop đang đặt. Đổi lúc nào cũng được. */
aiRouter.get(
  "/image-style",
  route(async (req, res) => {
    res.json({
      success: true,
      data: {
        phongCach: await docPhongCachDaLuu(naoCua(req).trangId),
        macDinh: PHONG_CACH_MAC_DINH,
      },
    });
  })
);

/** Lựa chọn vẽ ảnh từ body/query — chuỗi ngắn; khớp với khả năng mô hình được kiểm ở layModelAnh. */
export function docLuaChonVeAnh(nguon: Record<string, unknown>): LuaChonVeAnh {
  const chuoi = (v: unknown) => (typeof v === "string" && /^[\w.:/-]{1,80}$/.test(v) ? v : undefined);
  const model = chuoi(nguon.model);
  if (!model) throw new AppError("Chưa chọn mô hình vẽ ảnh.", 400);
  return { model, doNet: chuoi(nguon.doNet), chatLuong: chuoi(nguon.chatLuong), khung: chuoi(nguon.khung) };
}

/**
 * Mô hình vẽ ảnh kèm GIÁ MỘT ẢNH theo đúng lựa chọn, xếp rẻ tới đắt (chủ dự án 03/10/2026:
 * "có các mô hình từ rẻ lên đắt để lựa chọn và biết giá tiền khi tạo xong 1 ảnh").
 * Mỗi mô hình kèm các độ nét / chất lượng / khung nó làm được và giá của từng mức.
 */
aiRouter.get(
  "/image/models",
  route(async (req, res) => {
    const q = req.query as Record<string, unknown>;
    const coAnhMau = q.coAnhMau === "true";
    const lam = (x: number | null) => (x === null ? null : Math.round(x * 10_000) / 10_000);
    const models = (await layDanhSachModelAnh())
      .map((m) => {
        const gia = giaAnh(m, { soAnhVao: coAnhMau ? 1 : 0 });
        return {
          id: m.id,
          ten: m.ten,
          xepHang: m.xepHang,
          phanKhuc: gia === null ? null : phanKhucAnh(gia),
          doNet: m.doNet,
          chatLuong: m.chatLuong,
          khung: m.khung,
          soAnhThamChieu: m.soAnhThamChieu,
          lyDo: coAnhMau && m.soAnhThamChieu < 1 ? "không nhận ảnh mẫu" : null,
          // Giá thấp nhất (mức mặc định đầu tiên) để xếp; giá từng mức để giao diện báo đúng lựa chọn.
          gia: lam(gia),
          giaTheoMuc: Object.fromEntries(
            (m.doNet.length ? m.doNet : [""]).flatMap((d) =>
              (m.chatLuong.length ? m.chatLuong : [""]).map((c) => [
                `${d}|${c}`,
                lam(giaAnh(m, { doNet: d || undefined, chatLuong: c || undefined, soAnhVao: coAnhMau ? 1 : 0 })),
              ])
            )
          ),
        };
      })
      .sort((a, b) => (!a.lyDo !== !b.lyDo ? (a.lyDo ? 1 : -1) : (a.gia ?? Infinity) - (b.gia ?? Infinity)));
    res.json({ success: true, data: { models, nguon: NGUON_XEP_HANG_ANH } });
  })
);

// ---------------------------------------------------------------------------
// Thư viện ảnh sản phẩm / nhân vật (dùng lại cho ảnh và video AI)
// ---------------------------------------------------------------------------

function maThuVien(v: unknown): number {
  const so = Number(v);
  if (!Number.isInteger(so) || so <= 0) throw new AppError("Không tìm thấy ảnh trong thư viện.", 404);
  return so;
}

aiRouter.get(
  "/thu-vien",
  route(async (req, res) => {
    res.json({ success: true, data: await dsThuVien(naoCua(req).trangId) });
  })
);

aiRouter.post(
  "/thu-vien",
  route(async (req, res) => {
    const trangId = naoCua(req).trangId;
    const muc = await themVaoThuVien({
      userId: naoCua(req).chuId,
      trangId,
      loai: docLoai(req.body?.loai),
      ten: docTen(req.body?.ten),
      url: typeof req.body?.url === "string" ? req.body.url : "",
    });
    res.status(201).json({ success: true, data: muc });
  })
);

/** Tệp ảnh để thẻ <img> hiện — theo chủ tài khoản (thẻ ảnh không gửi kèm kênh đang chọn). */
aiRouter.get(
  "/thu-vien/:id/anh",
  route(async (req, res) => {
    const anh = await docAnhThuVien(naoCua(req).trangId, maThuVien(req.params.id));
    res.setHeader("Content-Type", anh.kieu);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.send(anh.du_lieu);
  })
);

/** Đưa ảnh thư viện lên kho để dùng làm ảnh mẫu / ảnh tham chiếu — trả địa chỉ đã che. */
aiRouter.post(
  "/thu-vien/:id/dung",
  route(async (req, res) => {
    const url = await dungAnh(naoCua(req).trangId, maThuVien(req.params.id));
    res.json({ success: true, data: { url: anDiaChiKho(url) } });
  })
);

aiRouter.delete(
  "/thu-vien/:id",
  route(async (req, res) => {
    await xoaThuVien(naoCua(req).trangId, maThuVien(req.params.id));
    res.json({ success: true });
  })
);

/**
 * AI tạo ảnh minh hoạ cho bài đăng.
 *
 * Mỗi lượt tốn tiền thật nên KHÔNG có đường nào gọi ngầm: chỉ chạy khi chủ
 * shop bấm, hoặc khi bật rõ trong lịch tự đăng.
 */
aiRouter.post(
  "/generate-image",
  chanLamDungAI,
  route(async (req, res) => {
    const noiDung = typeof req.body?.content === "string" ? req.body.content : "";
    const yeuCau = typeof req.body?.prompt === "string" ? req.body.prompt : undefined;
    const phongCach = typeof req.body?.style === "string" ? req.body.style : undefined;
    const anhMau = typeof req.body?.sample === "string" ? req.body.sample : undefined;

    const anh = await taoAnhChoBai({
      userId: naoCua(req).chuId,
      trangId: naoCua(req).trangId,
      noiDung,
      yeuCau,
      phongCach,
      anhMau,
      chuTrongAnh: req.body?.chuTrongAnh === "khong" ? "khong" : "theo_noi_dung",
      luat: docLuatNoiDung(req.body ?? {}),
      veAnh: docLuaChonVeAnh(req.body ?? {}),
    });
    // Che địa chỉ kho: trình duyệt chỉ cần vẽ được ảnh, không cần biết kho ở đâu.
    res.json({ success: true, data: { ...anh, url: anDiaChiKho(anh.url) } });
  })
);

aiRouter.post(
  "/generate-post",
  chanLamDungAI,
  route(async (req, res) => {
    const topic = requireString(req.body, "topic", "chủ đề bài viết");

    // Viết bài nằm ở services/content-ai.ts để bộ tự động trong worker gọi
    // được cùng một hàm — worker không có req/res để mượn.
    const result = await generatePostContent({
      userId: naoCua(req).chuId,
      trangId: naoCua(req).trangId,
      topic,
      goal: typeof req.body?.goal === "string" ? req.body.goal : "sales",
      count: Number(req.body?.count ?? 3),
      viec: "viet_bai",
    });

    res.json({ success: true, options: result.options, usage: result.usage });
  })
);

// ---------------------------------------------------------------------------
// Trợ giúp hội thoại
// ---------------------------------------------------------------------------

aiRouter.post(
  "/conversations/:id/extract",
  chanLamDungAI,
  route(async (req, res) => {
    const conversation = await queryOne(
      "SELECT id FROM conversations WHERE id = $1 AND trang_id = $2",
      [req.params.id, naoCua(req).trangId]
    );
    if (!conversation) throw new AppError("Không tìm thấy hội thoại", 404);

    const extracted = await extractOrderInfo(req.params.id);
    res.json({ success: true, data: extracted });
  })
);

aiRouter.post(
  "/conversations/:id/suggest",
  chanLamDungAI,
  route(async (req, res) => {
    const conversation = await queryOne(
      "SELECT id FROM conversations WHERE id = $1 AND trang_id = $2",
      [req.params.id, naoCua(req).trangId]
    );
    if (!conversation) throw new AppError("Không tìm thấy hội thoại", 404);

    const suggestion = await suggestReply(req.params.id);
    res.json({ success: true, data: { reply: suggestion } });
  })
);

// ---------------------------------------------------------------------------
// Quy tắc nhường quyền
// ---------------------------------------------------------------------------

aiRouter.get(
  "/handoff-rules",
  route(async (req, res) => {
    const rows = await query(
      "SELECT rule_key, enabled, config FROM handoff_rules WHERE trang_id = $1 ORDER BY rule_key",
      [naoCua(req).trangId]
    );
    res.json({ success: true, data: rows.rows });
  })
);

aiRouter.patch(
  "/handoff-rules/:key",
  route(async (req, res) => {
    const enabled = req.body?.enabled === true;
    const config = req.body?.config ?? {};

    const updated = await queryOne(
      `INSERT INTO handoff_rules (user_id, trang_id, rule_key, enabled, config)
       VALUES ($1, $5, $2, $3, $4)
       ON CONFLICT (trang_id, rule_key) DO UPDATE SET
         enabled = EXCLUDED.enabled, config = EXCLUDED.config, updated_at = now()
       RETURNING rule_key, enabled, config`,
      [naoCua(req).chuId, req.params.key, enabled, JSON.stringify(config), naoCua(req).trangId]
    );

    res.json({ success: true, data: updated });
  })
);

// ---------------------------------------------------------------------------
// Thử nghiệm AI trước khi cho chạy thật
// ---------------------------------------------------------------------------

aiRouter.post(
  "/test",
  chanLamDungAI,
  route(async (req, res) => {
    const kind = assertKind(
      typeof req.body?.kind === "string" ? req.body.kind : "sales"
    );
    const message = requireString(req.body, "message", "câu hỏi thử");

    const config = await queryOne<{ system_prompt: string }>(
      "SELECT system_prompt FROM ai_configs WHERE trang_id = $1 AND kind = $2",
      [naoCua(req).trangId, kind]
    );

    const documents = await query<{ filename: string; extracted_text: string | null }>(
      `SELECT filename, extracted_text FROM ai_documents
        WHERE trang_id = $1 AND kind = $2 AND extracted_text IS NOT NULL
        ORDER BY created_at DESC LIMIT 5`,
      [naoCua(req).trangId, kind]
    );

    const knowledge = documents.rows.length
      ? "\n\nKIẾN THỨC ĐƯỢC PHÉP DÙNG:\n" +
        documents.rows
          .map((doc) => `# ${doc.filename}\n${(doc.extracted_text ?? "").slice(0, 3_000)}`)
          .join("\n\n")
      : "";

    const result = await chat({
      task: kind === "sales" ? "sales" : "content",
      viec: "thu_ai",
      userId: naoCua(req).chuId,
      messages: [
        {
          role: "system",
          content:
            (config?.system_prompt ?? "Bạn là trợ lý của shop.") +
            knowledge +
            "\n\n" +
            DAN_KHONG_MARKDOWN,
        },
        { role: "user", content: message },
      ],
      temperature: 0.5,
      maxTokens: 800,
    });

    res.json({
      success: true,
      // Gỡ markdown để ô thử hiện ĐÚNG thứ khách sẽ đọc trên Messenger.
      data: { reply: boMarkdown(result.output), model: result.model, usage: result.usage },
    });
  })
);
