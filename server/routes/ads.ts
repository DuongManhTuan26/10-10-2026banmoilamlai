import { Router } from "express";
import { query, queryOne } from "../db.js";
import { requireAuth } from "../auth.js";
import { naoCua } from "../khoi-nao.js";
import { AppError, requireString, route } from "../http.js";
import * as ads from "../services/ads.js";
import { chatJson, asRecord, optionalString } from "../services/ai.js";
import { loadKnowledge } from "../services/knowledge.js";
import { boMarkdown, DAN_KHONG_MARKDOWN } from "../services/text.js";
import { chanLamDungAI } from "../services/chong-lam-dung.js";
import { ghiThayDoiNgoai } from "../services/so-thay-doi.js";

export const adsRouter = Router();

adsRouter.use(requireAuth);

/**
 * Tìm tài khoản quảng cáo của người dùng.
 *
 * Trả về cả hai định danh vì Zernio cần accountId cho một số endpoint và
 * adAccountId cho phần lớn còn lại.
 */
/** Tài khoản quảng cáo của KHỐI NÃO (trang) — mỗi trang dùng kết nối quảng cáo của chính nó (docs/khoi-nao.md). */
async function resolveAdAccount(trangId: number): Promise<{
  accountId: string;
  adAccountId: string;
  account: ads.AdAccount;
  /** Mọi tài khoản quảng cáo kênh này vào được, để chủ shop chọn. */
  tatCa: ads.AdAccount[];
  /** Đang dùng tài khoản chủ shop chọn, hay hệ thống tự đoán. */
  doChuShopChon: boolean;
} | null> {
  const row = await queryOne<{ id: string; ad_account_ref: string | null }>(
    `SELECT id, ad_account_ref FROM social_accounts
      WHERE trang_id = $1 AND platform = 'metaads' AND connected = TRUE
      ORDER BY created_at LIMIT 1`,
    [trangId]
  );
  if (!row) return null;

  const accounts = await ads.listAdAccounts(row.id);

  /*
   * Tôn trọng lựa chọn của chủ shop trước, tự đoán chỉ là phương án cuối.
   *
   * Đo thật: một kênh Meta Ads trả về HAI tài khoản quảng cáo. Mã cũ lặng lẽ
   * lấy cái đầu đang hoạt động, nên chiến dịch nằm ở tài khoản kia là trang
   * quảng cáo trống trơn — mà không một dòng nào nói đang xem tài khoản nào,
   * chủ shop không có cách nào đoán ra.
   *
   * Tài khoản đã chọn biến mất (bị gỡ quyền) thì rơi về tự đoán chứ không
   * chết, nhưng giao diện vẫn liệt kê đủ để chọn lại.
   */
  const daChon = row.ad_account_ref
    ? accounts.find((a) => a.id === row.ad_account_ref)
    : undefined;
  const active = daChon ?? accounts.find((a) => a.accountStatus === 1) ?? accounts[0];
  if (!active) return null;

  return {
    accountId: row.id,
    adAccountId: active.id,
    account: active,
    tatCa: accounts,
    doChuShopChon: !!daChon,
  };
}

/** Tổng quan: tài khoản quảng cáo, chiến dịch và số liệu. */
adsRouter.get(
  "/overview",
  route(async (req, res) => {
    const resolved = await resolveAdAccount(naoCua(req).trangId);

    if (!resolved) {
      res.json({
        success: true,
        data: {
          connected: false,
          account: null,
          campaigns: [],
          insights: null,
          audiences: [],
        },
        message:
          "Chưa kết nối tài khoản quảng cáo. Tài khoản Meta Ads tự có khi bạn " +
          "kết nối Facebook với quyền quảng cáo — vào mục Kết Nối Đa Nền Tảng.",
      });
      return;
    }

    const datePreset =
      typeof req.query.range === "string" && req.query.range ? req.query.range : "last_7d";

    // Từng phần lấy độc lập: một phần lỗi không được làm trắng cả trang.
    const [campaigns, insights, audiences] = await Promise.all([
      ads
        .listCampaigns({ accountId: resolved.accountId, adAccountId: resolved.adAccountId })
        .catch((error) => {
          console.error("[quảng cáo] Không lấy được chiến dịch:", error.message);
          return { campaigns: [], total: 0 };
        }),
      ads
        .getInsights({
          accountId: resolved.accountId,
          objectId: resolved.adAccountId,
          datePreset,
        })
        .catch((error) => {
          console.error("[quảng cáo] Không lấy được số liệu:", error.message);
          return null;
        }),
      ads
        .listAudiences({
          accountId: resolved.accountId,
          adAccountId: resolved.adAccountId,
        })
        .catch((error) => {
          console.error("[quảng cáo] Không lấy được tệp đối tượng:", error.message);
          return [];
        }),
    ]);

    res.json({
      success: true,
      data: {
        connected: true,
        account: {
          accountId: resolved.accountId,
          adAccountId: resolved.adAccountId,
          name: resolved.account.name,
          currency: resolved.account.currency,
          status: resolved.account.accountStatus,
          timezone: resolved.account.timezoneName,
          minDailyBudget: resolved.account.minDailyBudget,
          amountSpent: resolved.account.amountSpent,
        },
        /*
         * Danh sách mọi tài khoản quảng cáo, kèm việc đang dùng cái nào và có
         * phải do chủ shop chọn hay không. Không gửi ra thì giao diện không có
         * cách nào cho chọn lại.
         */
        tatCaTaiKhoan: resolved.tatCa.map((a) => ({
          id: a.id,
          name: a.name,
          currency: a.currency,
          accountStatus: a.accountStatus,
        })),
        doChuShopChon: resolved.doChuShopChon,
        campaigns: campaigns.campaigns,
        insights,
        audiences,
      },
    });
  })
);

/**
 * Chọn tài khoản quảng cáo để chạy.
 *
 * Một kênh Meta Ads vào được nhiều tài khoản quảng cáo. Không cho chọn thì hệ
 * thống tự đoán, và đoán sai là trang quảng cáo trống trơn không rõ lý do.
 */
adsRouter.put(
  "/tai-khoan-quang-cao",
  route(async (req, res) => {
    const ma = typeof req.body?.adAccountId === "string" ? req.body.adAccountId.trim() : "";
    if (!ma) throw new AppError("Chưa chọn tài khoản quảng cáo");

    const kenh = await queryOne<{ id: string }>(
      `SELECT id FROM social_accounts
        WHERE trang_id = $1 AND platform = 'metaads' AND connected = TRUE
        ORDER BY created_at LIMIT 1`,
      [naoCua(req).trangId]
    );
    if (!kenh) throw new AppError("Chưa kết nối tài khoản quảng cáo nào", 404);

    /*
     * Chỉ nhận tài khoản mà kênh này THẬT SỰ vào được. Không kiểm thì người ta
     * gửi lên mã bất kỳ, và mọi lời gọi sau đó đều lỗi mà không rõ vì sao.
     */
    const vaoDuoc = await ads.listAdAccounts(kenh.id);
    if (!vaoDuoc.some((a) => a.id === ma)) {
      throw new AppError("Tài khoản quảng cáo này không thuộc kênh đang kết nối", 400);
    }

    await query(
      "UPDATE social_accounts SET ad_account_ref = $1, updated_at = now() WHERE id = $2",
      [ma, kenh.id]
    );
    res.json({ success: true, data: { adAccountId: ma } });
  })
);

/** Bài đã đăng có thể đem đi quảng cáo. */
adsRouter.get(
  "/boostable-posts",
  route(async (req, res) => {
    const rows = await query(
      `SELECT id, content, platform_post_ref, published_at, stats, platform_urls
         FROM posts
        WHERE trang_id = $1 AND status = 'published' AND platform_post_ref IS NOT NULL
        ORDER BY published_at DESC LIMIT 50`,
      [naoCua(req).trangId]
    );
    res.json({ success: true, data: rows.rows });
  })
);

adsRouter.post(
  "/campaigns/status",
  route(async (req, res) => {
    const status = requireString(req.body, "status", "trạng thái");
    const allowed = new Set(["ACTIVE", "PAUSED", "ARCHIVED"]);
    if (!allowed.has(status)) throw new AppError(`Trạng thái không hợp lệ: ${status}`);

    const campaignIds = Array.isArray(req.body?.campaignIds)
      ? req.body.campaignIds.filter((id: unknown): id is string => typeof id === "string")
      : [];
    if (campaignIds.length === 0) throw new AppError("Chưa chọn chiến dịch nào");

    const resolved = await resolveAdAccount(naoCua(req).trangId);
    if (!resolved) throw new AppError("Chưa kết nối tài khoản quảng cáo", 409);

    const result = await ads.setCampaignStatus({
      accountId: resolved.accountId,
      adAccountId: resolved.adAccountId,
      campaignIds,
      status: status as "ACTIVE" | "PAUSED" | "ARCHIVED",
    });
    // Sổ thay đổi: quảng cáo đổi qua API nhà cung cấp, trigger không thấy — ghi tay SAU khi thành công.
    for (const id of campaignIds) {
      await ghiThayDoiNgoai({ userId: naoCua(req).chuId, trangId: naoCua(req).trangId, bang: "quang_cao_chien_dich", banGhi: id, hanhDong: "sua", sau: { trang_thai: status }, nguon: "nguoi_dung" });
    }

    res.json({ success: true, data: result });
  })
);

/**
 * Sửa ngân sách chiến dịch ngay trong app.
 *
 * Trước đây nút này mở Trình quản lý quảng cáo của Facebook. Mình trả tiền cho
 * Zernio đúng để khỏi phải đẩy chủ shop sang đó.
 */
adsRouter.patch(
  "/campaigns/:id/budget",
  route(async (req, res) => {
    const body = req.body ?? {};

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new AppError("Ngân sách phải là một số lớn hơn 0");
    }

    const budgetType = body.budgetType === "lifetime" ? "lifetime" : "daily";
    const platform = typeof body.platform === "string" ? body.platform : "facebook";

    const resolved = await resolveAdAccount(naoCua(req).trangId);
    if (!resolved) throw new AppError("Chưa kết nối tài khoản quảng cáo", 409);

    try {
      const result = await ads.updateCampaignBudget({
        campaignId: req.params.id,
        platform,
        amount,
        budgetType,
        accountId: resolved.accountId,
      });
      await ghiThayDoiNgoai({ userId: naoCua(req).chuId, trangId: naoCua(req).trangId, bang: "quang_cao_chien_dich", banGhi: req.params.id, hanhDong: "sua", sau: { ngan_sach: amount, loai_ngan_sach: budgetType }, nguon: "nguoi_dung" });
      res.json({ success: true, data: result });
    } catch (error) {
      /*
       * 409 nghĩa là chiến dịch đặt ngân sách ở tầng nhóm quảng cáo (ABO), nên
       * lệnh sửa ở tầng chiến dịch bị từ chối. Đây là cấu hình hợp lệ của Meta,
       * không phải hỏng — nói rõ ra thay vì ném lỗi kỹ thuật vào mặt chủ shop.
       */
      const status = (error as { status?: number })?.status;
      if (status === 409) {
        throw new AppError(
          "Chiến dịch này đặt ngân sách ở từng nhóm quảng cáo, không đặt chung " +
            "ở cấp chiến dịch. Vui lòng mở chiến dịch và sửa ngân sách của nhóm bên trong.",
          409
        );
      }
      throw error;
    }
  })
);

/**
 * Các nhóm quảng cáo bên trong một chiến dịch.
 *
 * Chiến dịch đặt ngân sách theo nhóm thì sửa ở cấp chiến dịch bị từ chối, và
 * máy chủ bảo chủ shop "mở chiến dịch và sửa ngân sách của nhóm bên trong" —
 * nhưng trước đây KHÔNG có đường nào để mở nhóm ra. Lời chỉ dẫn dẫn vào ngõ cụt.
 */
adsRouter.get(
  "/campaigns/:id/ad-sets",
  route(async (req, res) => {
    const resolved = await resolveAdAccount(naoCua(req).trangId);
    if (!resolved) throw new AppError("Chưa kết nối tài khoản quảng cáo", 409);

    const platform = typeof req.query.platform === "string" ? req.query.platform : "facebook";
    const adSets = await ads.listAdSets({
      accountId: resolved.accountId,
      campaignId: req.params.id,
      platform,
    });
    res.json({ success: true, data: adSets });
  })
);

adsRouter.patch(
  "/ad-sets/:id/budget",
  route(async (req, res) => {
    const body = req.body ?? {};

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new AppError("Ngân sách phải là một số lớn hơn 0");
    }

    /*
     * Đối chiếu chủ sở hữu TRƯỚC khi đổi ngân sách.
     *
     * Đây là route duy nhất trong phần quảng cáo không ràng buộc gì theo shop:
     * nó nhận thẳng adSetId từ đường dẫn rồi gửi cho Zernio. Mà bản PUT của
     * Zernio không nhận accountId, còn khoá API thì dùng chung cho cả nền tảng
     * — nghĩa là không có gì ngăn shop A đổi ngân sách của shop B.
     *
     * Bản GET thì CÓ nhận accountId, nên đọc trước bằng tài khoản của shop
     * đang đăng nhập: đọc được thì đúng là của họ, không đọc được thì thôi.
     */
    const resolved = await resolveAdAccount(naoCua(req).trangId);
    if (!resolved) throw new AppError("Chưa kết nối tài khoản quảng cáo", 409);

    let adSet: Record<string, unknown>;
    try {
      adSet = await ads.getAdSet({ adSetId: req.params.id, accountId: resolved.accountId });
    } catch {
      throw new AppError("Không tìm thấy nhóm quảng cáo này trong tài khoản của bạn", 404);
    }

    const result = await ads.updateAdSetBudget({
      adSetId: req.params.id,
      amount,
      budgetType: body.budgetType === "lifetime" ? "lifetime" : "daily",
      platform:
        typeof body.platform === "string"
          ? body.platform
          : typeof adSet.platform === "string"
            ? adSet.platform
            : "facebook",
    });
    await ghiThayDoiNgoai({ userId: naoCua(req).chuId, trangId: naoCua(req).trangId, bang: "quang_cao_nhom", banGhi: req.params.id, hanhDong: "sua", sau: { ngan_sach: amount, loai_ngan_sach: body.budgetType === "lifetime" ? "lifetime" : "daily" }, nguon: "nguoi_dung" });
    res.json({ success: true, data: result });
  })
);

adsRouter.post(
  "/campaigns/:id/duplicate",
  route(async (req, res) => {
    const resolved = await resolveAdAccount(naoCua(req).trangId);
    if (!resolved) throw new AppError("Chưa kết nối tài khoản quảng cáo", 409);

    const result = await ads.duplicateCampaign({
      campaignId: req.params.id,
      accountId: resolved.accountId,
      adAccountId: resolved.adAccountId,
    });
    await ghiThayDoiNgoai({ userId: naoCua(req).chuId, trangId: naoCua(req).trangId, bang: "quang_cao_chien_dich", banGhi: req.params.id, hanhDong: "them", sau: { nhan_ban_tu: req.params.id }, nguon: "nguoi_dung" });
    res.json({ success: true, data: result });
  })
);

adsRouter.get(
  "/campaigns/:id/analytics",
  route(async (req, res) => {
    const resolved = await resolveAdAccount(naoCua(req).trangId);
    if (!resolved) throw new AppError("Chưa kết nối tài khoản quảng cáo", 409);

    const data = await ads.getCampaignAnalytics({
      campaignId: req.params.id,
      accountId: resolved.accountId,
      datePreset: typeof req.query.range === "string" ? req.query.range : undefined,
    });
    res.json({ success: true, data });
  })
);

/** Đẩy ngân sách cho một bài đã đăng. */
adsRouter.post(
  "/boost",
  route(async (req, res) => {
    const body = req.body ?? {};
    const postId = Number(body.postId);
    const dailyBudget = Number(body.dailyBudget);
    const durationDays = Number(body.durationDays);

    if (!Number.isFinite(dailyBudget) || dailyBudget <= 0) {
      throw new AppError("Ngân sách mỗi ngày phải lớn hơn 0");
    }
    if (!Number.isFinite(durationDays) || durationDays < 1) {
      throw new AppError("Số ngày chạy phải từ 1 trở lên");
    }

    const post = await queryOne<{ platform_post_ref: string | null }>(
      "SELECT platform_post_ref FROM posts WHERE id = $1 AND trang_id = $2",
      [postId, naoCua(req).trangId]
    );
    if (!post) throw new AppError("Không tìm thấy bài viết", 404);
    if (!post.platform_post_ref) {
      throw new AppError("Bài này chưa được đăng nên chưa thể quảng cáo", 409);
    }

    const resolved = await resolveAdAccount(naoCua(req).trangId);
    if (!resolved) throw new AppError("Chưa kết nối tài khoản quảng cáo", 409);

    // Meta yêu cầu ngân sách tối thiểu theo từng tài khoản và loại tiền.
    const minBudget = Number(resolved.account.minDailyBudget ?? 0);
    if (minBudget > 0 && dailyBudget < minBudget) {
      throw new AppError(
        `Ngân sách mỗi ngày phải từ ${minBudget.toLocaleString("vi-VN")} ` +
          `${resolved.account.currency} trở lên theo quy định của Meta.`
      );
    }

    const result = await ads.boostPost({
      accountId: resolved.accountId,
      adAccountId: resolved.adAccountId,
      postId: post.platform_post_ref,
      dailyBudget,
      durationDays,
      objective: typeof body.objective === "string" ? body.objective : undefined,
      targeting: body.targeting,
    });
    await ghiThayDoiNgoai({ userId: naoCua(req).chuId, trangId: naoCua(req).trangId, bang: "quang_cao_day_bai", banGhi: String(postId), hanhDong: "them", sau: { bai: postId, ngan_sach_ngay: dailyBudget, so_ngay: durationDays, doi_tuong: body.targeting ?? null }, nguon: "nguoi_dung" });

    res.status(201).json({ success: true, data: result });
  })
);

adsRouter.post(
  "/audiences",
  route(async (req, res) => {
    const name = requireString(req.body, "name", "tên tệp đối tượng");
    const subtype = requireString(req.body, "subtype", "loại tệp");

    const resolved = await resolveAdAccount(naoCua(req).trangId);
    if (!resolved) throw new AppError("Chưa kết nối tài khoản quảng cáo", 409);

    const result = await ads.createAudience({
      accountId: resolved.accountId,
      adAccountId: resolved.adAccountId,
      name,
      subtype,
      description: typeof req.body?.description === "string" ? req.body.description : undefined,
      extra: req.body?.extra,
    });
    await ghiThayDoiNgoai({ userId: naoCua(req).chuId, trangId: naoCua(req).trangId, bang: "quang_cao_doi_tuong", banGhi: null, hanhDong: "them", sau: { ten: name, loai: subtype }, nguon: "nguoi_dung" });

    res.status(201).json({ success: true, data: result });
  })
);

adsRouter.put(
  "/audiences/:id",
  route(async (req, res) => {
    const resolved = await resolveAdAccount(naoCua(req).trangId);
    if (!resolved) throw new AppError("Chưa kết nối tài khoản quảng cáo", 409);

    const name = typeof req.body?.name === "string" ? req.body.name.trim() : undefined;
    const description =
      typeof req.body?.description === "string" ? req.body.description.trim() : undefined;

    if (name === undefined && description === undefined) {
      throw new AppError("Không có thông tin nào để sửa.", 400);
    }
    if (name !== undefined && name === "") {
      throw new AppError("Tên tệp đối tượng không được để trống.", 400);
    }

    const result = await ads.updateAudience({
      accountId: resolved.accountId,
      audienceId: req.params.id,
      name,
      description,
    });
    await ghiThayDoiNgoai({ userId: naoCua(req).chuId, trangId: naoCua(req).trangId, bang: "quang_cao_doi_tuong", banGhi: req.params.id, hanhDong: "sua", sau: { ten: name ?? null, mo_ta: description ?? null }, nguon: "nguoi_dung" });

    res.json({ success: true, data: result });
  })
);

adsRouter.post(
  "/reach-estimate",
  route(async (req, res) => {
    const resolved = await resolveAdAccount(naoCua(req).trangId);
    if (!resolved) throw new AppError("Chưa kết nối tài khoản quảng cáo", 409);

    const data = await ads.estimateReach({
      accountId: resolved.accountId,
      adAccountId: resolved.adAccountId,
      targeting: req.body?.targeting ?? {},
      optimizationGoal:
        typeof req.body?.optimizationGoal === "string" ? req.body.optimizationGoal : undefined,
    });
    res.json({ success: true, data });
  })
);

/**
 * AI phân tích hiệu quả quảng cáo.
 *
 * Chỉ phân tích số liệu thật đang có. Không có chiến dịch nào thì nói rõ
 * là chưa có gì để phân tích, thay vì để AI bịa ra nhận định.
 */
adsRouter.post(
  "/analyze",
  chanLamDungAI,
  route(async (req, res) => {
    const resolved = await resolveAdAccount(naoCua(req).trangId);
    if (!resolved) throw new AppError("Chưa kết nối tài khoản quảng cáo", 409);

    const [campaigns, insights] = await Promise.all([
      ads
        .listCampaigns({ accountId: resolved.accountId, adAccountId: resolved.adAccountId })
        .catch(() => ({ campaigns: [], total: 0 })),
      ads
        .getInsights({
          accountId: resolved.accountId,
          objectId: resolved.adAccountId,
          datePreset: "last_30d",
        })
        .catch(() => null),
    ]);

    if (campaigns.campaigns.length === 0) {
      res.json({
        success: true,
        data: {
          hasData: false,
          findings:
            "Tài khoản quảng cáo đã kết nối nhưng chưa có chiến dịch nào đang chạy.",
          recommendation:
            "Vui lòng chọn một bài đã đăng có tương tác tốt và bấm quảng cáo cho bài đó. " +
            "AI sẽ phân tích hiệu quả ngay khi có số liệu chi tiêu đầu tiên.",
          actions: [],
        },
      });
      return;
    }

    const config = await queryOne<{ system_prompt: string }>(
      "SELECT system_prompt FROM ai_configs WHERE trang_id = $1 AND kind = 'ads'",
      [naoCua(req).trangId]
    );

    // Tài liệu chủ shop đã dạy riêng cho AI quảng cáo.
    const knowledge = await loadKnowledge(
      naoCua(req).trangId,
      "ads"
    );

    const result = await chatJson({
      task: "ads",
      viec: "phan_tich_qc",
      userId: naoCua(req).chuId,
      messages: [
        {
          role: "system",
          content:
            (config?.system_prompt ??
              "Bạn là chuyên gia quảng cáo Facebook, phân tích bằng tiếng Việt.") +
            knowledge +
            "\n\nChỉ dựa vào số liệu được cung cấp, tuyệt đối không bịa số. " +
            DAN_KHONG_MARKDOWN +
            ' Trả JSON: {"findings": string, "recommendation": string, "actions": string[]}',
        },
        {
          role: "user",
          content:
            `Tiền tệ: ${resolved.account.currency}\n` +
            `Chiến dịch: ${JSON.stringify(campaigns.campaigns).slice(0, 4_000)}\n` +
            `Số liệu 30 ngày: ${JSON.stringify(insights).slice(0, 4_000)}`,
        },
      ],
      validate: (value) => {
        const object = asRecord(value);
        return {
          hasData: true,
          findings: boMarkdown(optionalString(object.findings) ?? "Chưa đủ dữ liệu để kết luận."),
          recommendation: boMarkdown(optionalString(object.recommendation) ?? ""),
          actions: Array.isArray(object.actions)
            ? object.actions
                .filter((a): a is string => typeof a === "string")
                .map(boMarkdown)
            : [],
        };
      },
    });

    res.json({ success: true, data: result.output, usage: result.usage });
  })
);
