import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import { Readable } from "node:stream";
import { env, missingOptionalConfig } from "./env.js";
import { attachUser } from "./auth.js";
import { errorHandler } from "./http.js";
import { authRouter } from "./routes/auth.js";
import { connectionsRouter, connectionsPublicRouter } from "./routes/connections.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { inboxRouter } from "./routes/inbox.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { ordersRouter } from "./routes/orders.js";
import { aiRouter } from "./routes/ai.js";
import { postsRouter } from "./routes/posts.js";
import { settingsRouter } from "./routes/settings.js";
import { adsRouter } from "./routes/ads.js";
import { analyticsRouter } from "./routes/analytics.js";
import { hoanDiaChiKho, laDiaChiKho } from "./services/media-proxy.js";
import { adminRouter } from "./routes/admin.js";
import { quanLyRouter } from "./routes/quan-ly.js";
import { chayChoTrang } from "./services/ngu-canh-trang.js";
import { ganKhoiNao } from "./khoi-nao.js";

export async function createApp() {
  const app = express();

  app.disable("x-powered-by");

  // Webhook cần thân request ở dạng thô để kiểm tra chữ ký HMAC. Phải đăng ký
  // trước express.json(), nếu không thân request đã bị đọc mất.
  app.use("/api/webhooks", express.raw({ type: "application/json", limit: "2mb" }));

  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  /*
   * Tin header proxy để lấy đúng IP của khách — nhưng CHỈ tin đúng số proxy.
   *
   * Chạy sau Cloudflare, Render hay Nginx thì req.ip là IP của proxy chứ không
   * phải của người gọi. Không đặt cái này là bộ chặn dò mật khẩu đếm nhầm mọi
   * người vào chung một IP — chặn oan cả hệ thống, mà kẻ dò thì vẫn thoải mái.
   *
   * Bản trước đặt `true` — tin MỌI mắt xích trong X-Forwarded-For, kể cả phần
   * do chính khách tự viết. Đã tái hiện: gửi X-Forwarded-For 9.9.9.9, 8.8.4.4,
   * 1.2.3.4 thì bảng login_attempts ghi đúng ba IP giả đó. Kẻ dò mật khẩu đổi
   * IP giả mỗi lần là né sạch chốt "sai 20 lần mỗi IP", thử một mật khẩu phổ
   * biến lên mọi tài khoản không giới hạn.
   *
   * Proxy thật NỐI IP khách vào CUỐI chuỗi. Tin đúng N mắt xích cuối thì phần
   * khách tự khai ở đầu chuỗi bị bỏ qua. Số proxy đặt qua TRUST_PROXY_HOPS,
   * mặc định 1 — đúng với hầu hết nơi triển khai có một lớp proxy phía trước.
   */
  const soProxy = Number(process.env.TRUST_PROXY_HOPS ?? "1");
  app.set("trust proxy", Number.isInteger(soProxy) && soProxy >= 0 ? soProxy : 1);

  /*
   * Tiêu đề bảo mật. Đã đo: trước đây lời đáp KHÔNG có tiêu đề nào cả.
   *
   * Viết tay mấy dòng thay vì thêm thư viện, vì chỉ cần đúng mấy tiêu đề này.
   *
   * Chặn nhúng khung CHỈ bật ở production: bolt hiện bản xem trước trong một
   * khung của trang khác, chặn luôn ở đó thì bản xem trước thành trang trắng
   * và trông như app hỏng. Rủi ro khi chưa chặn là thấp — cookie phiên là
   * SameSite=Lax nên trang bị nhúng vào khung lạ ở trạng thái chưa đăng nhập,
   * không lừa bấm được nút nào có quyền.
   *
   * Không đặt Content-Security-Policy đầy đủ: một chính sách chặt chưa kiểm
   * trên mọi màn hình rất dễ chặn nhầm ảnh Facebook, phông chữ, bản vá nóng
   * lúc phát triển. Chỉ đặt đúng phần frame-ancestors.
   */
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    if (env.isProduction) {
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
      // Chỉ có nghĩa khi chạy HTTPS — ở production thì luôn là HTTPS.
      res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    }
    next();
  });

  app.use(attachUser);

  /*
   * KHỐI NÃO của mỗi yêu cầu (docs/khoi-nao.md): một chỗ duy nhất xác định trang — server/khoi-nao.ts. Tiền AI phát
   * sinh trong yêu cầu ghi đúng trang đó (ngu-canh-trang.ts).
   */
  app.use("/api", ganKhoiNao);
  app.use("/api", (req, _res, next) => {
    const trangId = req.nao?.trangId ?? null;
    chayChoTrang(trangId, next);
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", env: env.nodeEnv, time: new Date().toISOString() });
  });

  /*
   * Tải hộ ảnh từ kho của nhà cung cấp.
   *
   * Trình duyệt chỉ thấy /media/<mã>, không thấy tên kho. Phải đứng trước mọi
   * router có requireAuth vì thẻ <img> không gửi kèm gì để xác thực, và ảnh
   * bài đăng vốn đã công khai trên Fanpage rồi.
   */
  app.get("/media/:ma", async (req, res) => {
    const that = hoanDiaChiKho(`/media/${req.params.ma}`);
    if (!laDiaChiKho(that)) {
      res.status(400).json({ error: "Địa chỉ ảnh không hợp lệ" });
      return;
    }
    /*
     * Chuyển tiếp yêu cầu TUA (Range) và gửi dạng dòng chảy.
     *
     * Đã đo: gửi Range 0-99 cho một video thì nhận 200 kèm cả tệp 2,2MB, không
     * có Accept-Ranges. Safari bắt buộc máy chủ hỗ trợ tua mới chịu phát video,
     * nên video AI và video chủ shop tải lên không xem trước được trên Mac và
     * iPhone. Bản cũ còn đọc cả tệp vào bộ nhớ rồi mới gửi — video vài chục MB
     * là vài chục MB RAM cho mỗi người đang xem.
     *
     * Hẹn giờ chỉ tính tới lúc kho trả lời đầu tiên: dòng dữ liệu video chạy
     * lâu hơn 30 giây là chuyện bình thường, không được cắt ngang.
     */
    const ngat = new AbortController();
    const hen = setTimeout(() => ngat.abort(), 30_000);
    try {
      const tua = typeof req.headers.range === "string" ? req.headers.range : undefined;
      const nguon = await fetch(that, {
        headers: tua ? { Range: tua } : {},
        signal: ngat.signal,
      });
      clearTimeout(hen);
      if ((!nguon.ok && nguon.status !== 206) || !nguon.body) {
        res.status(nguon.status === 404 ? 404 : nguon.status === 416 ? 416 : 502).end();
        return;
      }
      res.status(nguon.status === 206 ? 206 : 200);
      res.setHeader("Content-Type", nguon.headers.get("content-type") ?? "application/octet-stream");
      for (const ten of ["content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
        const v = nguon.headers.get(ten);
        if (v) res.setHeader(ten, v);
      }
      res.setHeader("Cache-Control", "private, max-age=3600");
      const dong = Readable.fromWeb(nguon.body as import("node:stream/web").ReadableStream);
      // Người xem đóng trang giữa chừng thì ngắt luôn dòng tải từ kho.
      res.on("close", () => dong.destroy());
      dong.on("error", () => res.destroy());
      dong.pipe(res);
    } catch {
      clearTimeout(hen);
      if (!res.headersSent) res.status(502).end();
    }
  });

  // Webhook không dùng cookie phiên — xác thực bằng chữ ký HMAC.
  app.use("/api/webhooks", webhooksRouter);

  app.use("/api/auth", authRouter);
  /*
   * Đường quay về của luồng cấp quyền phải đứng TRƯỚC router có requireAuth:
   * đây là điều hướng từ facebook.com quay lại, không được phụ thuộc cookie.
   */
  app.use("/api/connections", connectionsPublicRouter);
  app.use("/api/connections", connectionsRouter);
  app.use("/api/inbox", inboxRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/orders", ordersRouter);
  app.use("/api/ai", aiRouter);
  app.use("/api/posts", postsRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/ads", adsRouter);
  app.use("/api/analytics", analyticsRouter);
  // Quản trị hệ thống. Tự chặn người không phải quản trị ngay trong router.
  app.use("/api/admin", adminRouter);
  app.use("/api/quan-ly", quanLyRouter);

  // Bất kỳ đường dẫn /api nào không khớp đều trả JSON, không trả trang HTML.
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Không tìm thấy endpoint này" });
  });

  if (env.isProduction) {
    /*
     * CHỈ phục vụ dist/client. Không bao giờ trỏ vào dist/ vì trong đó còn
     * server.mjs, server.mjs.map và migrations/*.sql — tải về được hết.
     */
    const distPath = path.join(process.cwd(), "dist", "client");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      /*
       * Cổng làm mới giao diện (HMR) đặt được qua HMR_PORT — hai bản chạy cùng máy mà dùng chung cổng mặc định 24678 thì
       * bản sau không mở được, và trình duyệt của bản này có thể nghe nhầm thay đổi của bản kia.
       */
      server: { middlewareMode: true, ...(process.env.HMR_PORT ? { hmr: { port: Number(process.env.HMR_PORT) } } : {}) },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  // Phải đứng cuối cùng để bắt được lỗi từ mọi middleware phía trên.
  app.use(errorHandler);

  return app;
}

export function logStartupWarnings(): void {
  for (const warning of missingOptionalConfig()) {
    console.warn(`[cấu hình] ${warning}`);
  }
}
