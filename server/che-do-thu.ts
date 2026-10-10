/**
 * CHẾ ĐỘ THỬ (CHE_DO_THU=bat) — chạy một bản riêng song song với bản thật mà không chạm được gì bên ngoài.
 *
 * Vì sao cần: có lúc hai bản cùng chạy trên một máy (bản đang phục vụ khách và bản đang làm lại). Bản thử mà dựng
 * đường hầm hay đăng ký webhook là giành mất tin nhắn của bản thật; chạy worker là tự đăng bài, tự trả lời khách thật.
 *
 * Bật chế độ này thì:
 *   - không dựng đường hầm, không đăng ký webhook, không chạy worker, không nhận lệnh Telegram (server.ts);
 *   - mọi lệnh GHI ra nhà cung cấp kênh và Telegram bị chặn ngay tại fetch — lớp chặn cuối, kể cả đường gọi viết sau.
 */
// Đọc .env TRƯỚC khi xét cờ: tệp này được nạp đầu tiên, trước cả env.ts.
import "dotenv/config";

const MAY_CHU_CAM_GHI = ["zernio.com", "api.telegram.org"];

export const laCheDoThu = (process.env.CHE_DO_THU ?? "").trim() === "bat";

export function caiChanCheDoThu(): void {
  if (!laCheDoThu) return;
  const fetchGoc = globalThis.fetch;
  globalThis.fetch = (async (vao: Parameters<typeof fetch>[0], tuyChon?: Parameters<typeof fetch>[1]) => {
    const url = new URL(typeof vao === "string" ? vao : vao instanceof URL ? vao.href : vao.url);
    const phuongThuc = (tuyChon?.method ?? (vao instanceof Request ? vao.method : "GET")).toUpperCase();
    const cam = MAY_CHU_CAM_GHI.some((m) => url.hostname === m || url.hostname.endsWith(`.${m}`));
    if (cam && (phuongThuc !== "GET" || url.hostname === "api.telegram.org")) {
      throw new Error(`[chế độ thử] Đã chặn ${phuongThuc} ${url.hostname}${url.pathname} — bản thử không được ghi ra ngoài`);
    }
    return fetchGoc(vao, tuyChon);
  }) as typeof fetch;
  console.warn("[chế độ thử] BẬT — không đường hầm, không webhook, không worker, không Telegram, chặn mọi lệnh ghi ra ngoài.");
}
