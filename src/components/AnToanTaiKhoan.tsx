import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { PLATFORM_RULES } from '../lib/pricing';

/** Mã lý do chặn của hàng rào -> câu chủ shop hiểu được. */
const LY_DO_CHAN: Record<string, string> = {
  ai_outside_24h: 'Quá 24 giờ kể từ tin cuối của khách — chỉ nhân viên được trả lời',
  window_expired_7d: 'Quá 7 ngày — nền tảng không cho gửi nữa, kể cả nhân viên',
  ai_paused: 'AI đang bị tạm dừng để bảo vệ tài khoản',
  rate_limited: 'Chạm hạn mức tốc độ gửi của nền tảng',
  ai_hourly_limit: 'Chạm giới hạn số tin AI gửi mỗi giờ do chủ shop đặt',
  no_account: 'Hội thoại chưa gắn với kênh nào',
  conversation_not_found: 'Không tìm thấy hội thoại',
};

/**
 * AN TOÀN TÀI KHOẢN + QUY ĐỊNH BẮT BUỘC CỦA FACEBOOK — số liệu và giới hạn gửi tin của KHỐI NÃO đang chọn (máy chủ lọc
 * theo trang). Thuộc ③ AI Bán hàng › Kết quả; trước đây nằm ở trang Gói dịch vụ (rà soát lượt 2, T11). Mã chuyển
 * nguyên từ Pricing.tsx, không đổi logic.
 */
export default function AnToanTaiKhoan() {
  const [guardrails, setGuardrails] = useState<Awaited<
    ReturnType<typeof api.settings.guardrails>
  >['data'] | null>(null);
  const [dangMo, setDangMo] = useState<string | null>(null);
  const [dangLuuHangRao, setDangLuuHangRao] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  /** Siết chặt hàng rào. Máy chủ kẹp lại theo trần chính sách nên không nới được. */
  const luuHangRao = async (payload: Parameters<typeof api.settings.saveGuardrails>[0]) => {
    setDangLuuHangRao(true);
    try {
      await api.settings.saveGuardrails(payload);
      const { data } = await api.settings.guardrails();
      setGuardrails(data);
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'Không lưu được cài đặt');
    } finally {
      setDangLuuHangRao(false);
    }
  };

  /** Bật lại AI cho một kênh đang bị hệ thống tự tạm dừng. */
  const moLaiAi = async (accountId: string) => {
    setDangMo(accountId);
    try {
      await api.settings.resumeAi(accountId);
      const { data } = await api.settings.guardrails();
      setGuardrails(data);
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'Không bật lại được AI');
    } finally {
      setDangMo(null);
    }
  };

  const [safety, setSafety] = useState<{
    status: 'safe' | 'warning' | 'danger';
    sendRatePerMinute: number;
    sendRateLimit: number;
    messagesSent30d: number;
    messagesFailed30d: number;
    failRate: number;
    handoffRate: number;
    avgAiResponseSeconds: number | null;
    blockRateNote: string;
  } | null>(null);

  useEffect(() => {
    api.settings.guardrails()
      .then(({ data }) => setGuardrails(data))
      .catch(() => { /* không chặn màn hình nếu phần này lỗi */ });
    api.settings.safety()
      .then(({ data }) => setSafety(data))
      .catch((error) => setErrorMessage(error instanceof ApiError ? error.message : 'Không tải được số liệu an toàn'));
  }, []);

  const safetyStatus = safety?.status ?? 'safe';
  /*
   * Lý do THẬT của trạng thái, đúng ngưỡng máy chủ dùng (server/routes/settings.ts: lỗi ≥3% / ≥10%, tốc độ ≥12 / ≥20
   * tin mỗi phút). Bản cũ ghi "tỷ lệ khách chặn đang tăng" — chỉ số Meta không cung cấp, hệ thống không đo được; và
   * "AI đã tự tạm dừng" ở mức nguy hiểm dù chưa chắc có kênh nào bị dừng (kênh bị dừng hiện riêng ngay bên dưới).
   */
  const lyDoAnToan = safety
    ? [
        safety.failRate >= 3 && `${safety.failRate}% tin gửi đi bị lỗi trong 30 ngày`,
        safety.sendRatePerMinute >= 12 && `AI đang gửi ${safety.sendRatePerMinute} tin mỗi phút (giới hạn ${safety.sendRateLimit})`,
      ].filter(Boolean).join(' · ')
    : '';
  const facebookRules = PLATFORM_RULES;

  return (
    <div>
      {errorMessage && (
        <div className="mb-md text-sm text-error bg-error/10 border border-error/30 rounded-xl px-4 py-3">{errorMessage}</div>
      )}
        {/* HÀNG 4 — thẻ lớn "An toàn tài khoản" */}
        <div className="khung-muc mau-lam mb-6">
          <div className="dau-muc flex flex-wrap items-center gap-3 justify-between">
            <h3 className="tieu-de-muc">An toàn tài khoản</h3>
            <span className="text-xs text-on-surface-variant">Kiểm tra tự động hằng ngày</span>
          </div>

          {/*
            * Ba dải trạng thái LOẠI TRỪ NHAU, mỗi lúc chỉ hiện một.
            *
            * Chú thích cũ ghi "Showing all 3 for demo" — sai và gây hiểu nhầm:
            * mã đã có điều kiện theo safetyStatus từ lâu, không hiện cùng lúc.
            */}
          <div className="flex flex-col gap-3 mb-md">
            {/* Ổn = ✓ chữ trắng (bảng màu B) — không dùng lục để khỏi lẫn với màu miền ③ Bán hàng. */}
            {safetyStatus === 'safe' && (
              <div className="border border-white/20 rounded-xl p-4 flex items-start md:items-center gap-3">
                <span className="material-symbols-outlined text-on-surface text-[24px]">check_circle</span>
                <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-3 flex-1">
                  <p className="font-bold text-on-surface">Tài khoản đang an toàn</p>
                  <p className="text-sm text-on-surface-variant">Không phát hiện rủi ro nào trong 30 ngày qua</p>
                </div>
              </div>
            )}

            {safetyStatus === 'warning' && (
              <div className="bg-canh-bao/10 border border-canh-bao/40 rounded-xl p-4 flex items-start md:items-center gap-3">
                <span className="material-symbols-outlined text-canh-bao text-[24px]">warning</span>
                <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-3 flex-1">
                  <p className="font-bold text-canh-bao">Cần chú ý</p>
                  {lyDoAnToan && <p className="font-body-md text-on-surface-variant">{lyDoAnToan}</p>}
                </div>
              </div>
            )}
            {safetyStatus === 'danger' && (
              <div className="bg-loi/10 border border-loi/40 rounded-xl p-4 flex items-start md:items-center gap-3">
                <span className="material-symbols-outlined text-loi text-[24px]">gpp_bad</span>
                <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-3 flex-1">
                  <p className="font-bold text-loi">Rủi ro cao cho tài khoản</p>
                  {lyDoAnToan && <p className="font-body-md text-on-surface-variant">{lyDoAnToan}</p>}
                </div>
              </div>
            )}
          </div>

          {safety?.blockRateNote && (
            <p className="text-xs text-on-surface-variant mb-4 flex items-start gap-1.5">
              <span className="material-symbols-outlined text-[14px] mt-0.5">info</span>
              <span>{safety.blockRateNote}</span>
            </p>
          )}

          {/*
            KÊNH ĐANG BỊ TẠM DỪNG.

            Trước đây hệ thống tự tắt AI khi tỷ lệ bị chặn cao — đúng, nhưng
            giao diện KHÔNG hề hiện kênh nào bị tắt, và cũng không có nút bật
            lại. Chủ shop chỉ thấy một dòng "AI đã tự tạm dừng" rồi bó tay.
          */}
          {guardrails && guardrails.pausedAccounts.length > 0 && (
            <div className="mb-md space-y-2">
              {guardrails.pausedAccounts.map((kenh) => (
                <div key={kenh.id} className="bg-red-500/10 border border-red-500/40 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <span className="material-symbols-outlined text-loi text-[22px] shrink-0">pause_circle</span>
                  <div className="flex-1">
                    <p className="font-body-md text-on-surface font-bold">{kenh.display_name}</p>
                    <p className="text-sm text-on-surface-variant mt-0.5">{kenh.ai_pause_reason}</p>
                    <p className="text-xs text-on-surface-variant mt-1">
                      Tự mở lại lúc {new Date(kenh.ai_paused_until).toLocaleString('vi-VN')}
                    </p>
                  </div>
                  <button
                    onClick={() => moLaiAi(kenh.id)}
                    disabled={dangMo === kenh.id}
                    className="shrink-0 px-4 py-2 bg-primary text-on-primary font-bold text-sm rounded-lg hover:brightness-110 transition-all disabled:opacity-60"
                  >
                    {dangMo === kenh.id ? 'Đang mở…' : 'Bật lại AI ngay'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Vì sao tin bị chặn — để chủ shop biết đường xử lý, không đoán mò. */}
          {guardrails && guardrails.blockedReasons.length > 0 && (
            <div className="mb-md bg-surface-container-high rounded-xl border border-outline-variant p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-body-md font-bold text-on-surface">Tin bị chặn trong 7 ngày qua</h4>
                <span className="font-label-sm text-on-surface-variant">
                  {guardrails.usage.blockedLastDay} tin trong 24 giờ
                </span>
              </div>
              <div className="space-y-2">
                {guardrails.blockedReasons.map((r) => (
                  <div key={r.block_reason} className="flex items-start justify-between gap-4 text-sm">
                    <span className="text-on-surface-variant leading-relaxed">
                      {LY_DO_CHAN[r.block_reason] ?? r.block_reason}
                    </span>
                    <span className="font-bold text-on-surface shrink-0">{r.n}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-on-surface-variant mt-3 pt-3 border-t border-outline-variant/50">
                Bị chặn là hệ thống đang bảo vệ Trang của bạn khỏi vi phạm chính sách,
                không phải lỗi. Hạn mức đang áp dụng: {guardrails.rateLimit.perMinute} tin/phút
                {guardrails.rateLimit.source === 'live' ? ' (đọc trực tiếp từ nền tảng)' : ''}.
              </p>
            </div>
          )}

          {/* Giới hạn đang áp dụng — sửa được phần tuỳ chọn, không sửa được trần chính sách */}
          {guardrails && (
            <div className="mb-md bg-surface-container-high rounded-xl border border-outline-variant p-4">
              <h4 className="font-body-md font-bold text-on-surface mb-1">Giới hạn đang áp dụng</h4>
              <p className="text-xs text-on-surface-variant mb-4 leading-relaxed">
                Trần tốc độ là quy định của nền tảng, hệ thống không cho vượt. Bạn chỉ
                có thể đặt chặt hơn nếu muốn thận trọng.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-surface-container rounded-lg border border-outline-variant p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-bold text-on-surface">Trần của nền tảng</span>
                    <span className="material-symbols-outlined text-[16px] text-on-surface-variant" title="Không sửa được">lock</span>
                  </div>
                  <p className="font-headline-sm text-xl font-bold text-primary">
                    {guardrails.rateLimit.perMinute} tin/phút
                  </p>
                  <p className="text-xs text-on-surface-variant mt-1">
                    {guardrails.rateLimit.source === 'live'
                      ? 'Đọc trực tiếp từ nền tảng'
                      : 'Theo bậc tài khoản hiện tại'}
                  </p>
                </div>

                <div className="bg-surface-container rounded-lg border border-outline-variant p-3">
                  <label className="text-sm font-bold text-on-surface block mb-1">
                    Giới hạn tin AI mỗi giờ
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" min={0}
                      defaultValue={Number(guardrails.config.max_ai_sends_per_hour ?? 0)}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v) && v !== Number(guardrails.config.max_ai_sends_per_hour ?? 0)) {
                          luuHangRao({ maxAiSendsPerHour: v });
                        }
                      }}
                      disabled={dangLuuHangRao}
                      className="bg-surface-container-high w-24 border border-outline-variant rounded-lg px-2 py-1.5 text-sm text-on-surface focus:border-primary focus:outline-none disabled:opacity-60"
                    />
                    <span className="text-xs text-on-surface-variant">0 = không giới hạn</span>
                  </div>
                  <p className="text-xs text-on-surface-variant mt-2 leading-relaxed">
                    Đây KHÔNG phải quy định nền tảng, chỉ là chốt an toàn của riêng bạn
                    để AI không phát tán hàng loạt khi có sự cố.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Tỷ lệ khách chặn */}
            <div className="bg-surface-container-high rounded-xl border border-outline-variant p-4 flex items-center gap-4">
               <div className="relative w-[80px] h-[80px] flex items-center justify-center shrink-0">
                  <svg className="w-[80px] h-[80px] transform -rotate-90">
                    <circle cx="40" cy="40" r="34" stroke="currentColor" strokeWidth="6" fill="transparent" className="text-surface-container-highest" />
                    <circle cx="40" cy="40" r="34" stroke="currentColor" strokeWidth="6" fill="transparent" strokeDasharray="213.6" strokeDashoffset={213.6 * (1 - (safety ? Math.min(1, safety.handoffRate / 100) : 0))} className="text-primary" strokeLinecap="round" />
                  </svg>
                  <span className="absolute font-label-sm text-on-surface font-bold text-[13px] whitespace-nowrap">{safety ? `${safety.handoffRate}%` : '—'}</span>
               </div>
               <div>
                 <p className="font-body-md text-on-surface font-bold">Tỷ lệ nhường quyền</p>
                 <p className="font-body-md text-on-surface-variant text-sm mt-0.5">Phần hội thoại AI phải chuyển cho người</p>
               </div>
            </div>

            {/* Tốc độ gửi tin */}
            <div className="bg-surface-container-high rounded-xl border border-outline-variant p-4 flex items-center gap-4">
               <div className="relative w-[80px] h-[80px] flex items-center justify-center shrink-0">
                  <svg className="w-[80px] h-[80px] transform -rotate-90">
                    <circle cx="40" cy="40" r="34" stroke="currentColor" strokeWidth="6" fill="transparent" className="text-surface-container-highest" />
                    <circle cx="40" cy="40" r="34" stroke="currentColor" strokeWidth="6" fill="transparent" strokeDasharray="213.6" strokeDashoffset={213.6 * (1 - (safety ? Math.min(1, safety.sendRatePerMinute / safety.sendRateLimit) : 0))} className="text-canh-bao" strokeLinecap="round" />
                  </svg>
                  <span className="absolute font-label-sm text-on-surface font-bold text-[13px] whitespace-nowrap">{safety ? `${safety.sendRatePerMinute}/phút` : '—'}</span>
               </div>
               <div>
                 <p className="font-body-md text-on-surface font-bold">Tốc độ gửi tin</p>
                 <p className="font-body-md text-on-surface-variant text-sm mt-0.5">Giới hạn {safety?.sendRateLimit ?? 20} tin mỗi phút</p>
               </div>
            </div>

            {/* Tin bị từ chối */}
            <div className="bg-surface-container-high rounded-xl border border-outline-variant p-4 flex items-center gap-4">
               <div className="relative w-[80px] h-[80px] flex items-center justify-center shrink-0">
                  <svg className="w-[80px] h-[80px] transform -rotate-90">
                    <circle cx="40" cy="40" r="34" stroke="currentColor" strokeWidth="6" fill="transparent" className="text-surface-container-highest" />
                    <circle cx="40" cy="40" r="34" stroke="currentColor" strokeWidth="6" fill="transparent" strokeDasharray="213.6" strokeDashoffset={213.6 * (1 - (safety ? Math.min(1, safety.failRate / 10) : 0))} className={safety && safety.failRate >= 3 ? "text-canh-bao" : "text-primary"} strokeLinecap="round" />
                  </svg>
                  <span className="absolute font-label-sm text-on-surface font-bold text-[13px] whitespace-nowrap">{safety ? `${safety.messagesFailed30d} tin` : '—'}</span>
               </div>
               <div>
                 <p className="font-body-md text-on-surface font-bold">Tin bị từ chối</p>
                 <p className="font-body-md text-on-surface-variant text-sm mt-0.5">
                   {safety ? `${safety.failRate}% trong 30 ngày qua` : 'Trong 30 ngày qua'}
                 </p>
               </div>
            </div>
          </div>

        </div>

        {/* HÀNG 5 — thẻ "Quy định bắt buộc của Facebook" */}
        <div className="khung-muc mau-cam">
          <h3 className="tieu-de-muc dau-muc">Quy định bắt buộc của Facebook</h3>
          <div className="mb-4">
            <p className="text-sm text-on-surface-variant">Những giới hạn này do Facebook đặt ra, không phải do phần mềm. Chúng tôi áp dụng cố định để bảo vệ tài khoản của bạn.</p>
          </div>

          <div className="flex flex-col gap-4">
            {facebookRules.map((rule, idx) => (
              <div key={idx} className="flex items-start gap-3 p-3 rounded-lg hover:bg-surface-container-high transition-colors">
                <span className="material-symbols-outlined text-canh-bao mt-0.5 text-[24px]">lock</span>
                <div>
                  <p className="font-body-md text-on-surface font-bold">{idx + 1}. {rule.title}</p>
                  <p className="font-body-md text-on-surface-variant mt-1">{rule.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
    </div>
  );
}
