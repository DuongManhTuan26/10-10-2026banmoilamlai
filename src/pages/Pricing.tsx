import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { PRICING_PLANS, goiHienTai, type PricingPlan } from '../lib/pricing';

/**
 * Kênh hỗ trợ của mình. Dùng chung một nguồn với nút Trợ giúp ở thanh bên, để
 * đổi một chỗ là đổi cả hệ thống.
 */
const SUPPORT_URL = import.meta.env.VITE_SUPPORT_URL || '/pricing';
const IS_EXTERNAL_SUPPORT = /^https?:|^mailto:/.test(SUPPORT_URL);

export default function Pricing() {
  const navigate = useNavigate();

  const [plan, setPlan] = useState('trial');
  const [usage, setUsage] = useState({
    connected_accounts: 0, ai_messages_month: 0, tokens_month: 0,
    orders_month: 0, posts_month: 0,
  });
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    api.settings.usage()
      .then((u) => {
        setPlan(u.data.plan);
        setUsage(u.data.usage);
      })
      .catch((error) => {
        setErrorMessage(error instanceof ApiError ? error.message : 'Không tải được thông tin gói');
      });
  }, []);

  /** Gói đang dùng, đối chiếu với gói lưu trong database. */
  const plans: PricingPlan[] = PRICING_PLANS.map((p) => ({
    ...p,
    isCurrent: p.id === plan,
    buttonText: p.id === plan ? 'Gói hiện tại' : p.buttonText,
  }));

  /*
   * Gói đang dùng lấy đúng theo mã gói trong database. Không được mượn tạm gói
   * đầu danh sách: shop đang dùng thử từng bị ghi là đang dùng gói Khởi đầu
   * 390.000 đ/tháng.
   */
  const currentPlan = goiHienTai(plan);
  const maxChannels = currentPlan.maxChannels;
  const usedChannels = usage.connected_accounts;
  const coHanMuc = maxChannels > 0;
  const channelPercent = coHanMuc
    ? Math.min(100, Math.round((usedChannels / maxChannels) * 100))
    : 0;

  /* Số lượt còn lại phải tính ra, trước đây là chữ cứng "Còn 1 lượt kết nối". */
  const conLaiKenh = maxChannels - usedChannels;
  const chuThichKenh = !coHanMuc
    ? 'Chưa đặt hạn mức trong thời gian dùng thử'
    : conLaiKenh > 0
      ? `Còn ${conLaiKenh} lượt kết nối`
      : conLaiKenh === 0
        ? 'Đã dùng hết số kênh của gói'
        : `Đang vượt ${-conLaiKenh} kênh so với gói`;

  /**
   * Nâng cấp gói và xem hoá đơn đều cần cổng thanh toán, chưa nối vào hệ thống.
   * Báo rõ thay vì để nút bấm không phản ứng gì.
   */
  const handleUpgrade = (planId?: string) => {
    setErrorMessage(
      planId && planId !== plan
        ? `Đổi sang gói "${plans.find((p) => p.id === planId)?.name}" cần cổng thanh toán, phần này chưa được nối. Vui lòng liên hệ để được đổi gói thủ công.`
        : 'Cổng thanh toán chưa được nối vào hệ thống.'
    );
  };

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto w-full relative">
      {errorMessage && (
        <div className="mb-md text-sm text-error bg-error/10 border border-error/30 rounded-xl px-4 py-3 max-w-5xl mx-auto">
          {errorMessage}
        </div>
      )}

      {/* Header */}
      <div className="mb-lg">
        <span className="font-mono text-xs font-bold tracking-wider text-primary bg-primary/10 border border-primary/20 px-2.5 py-1 rounded-full uppercase mb-3 inline-block">{currentPlan.name.toUpperCase()}</span>
        <p className="text-base text-on-surface-variant max-w-2xl mt-1">Gói đang dùng, mức dùng trong tháng và các gói có thể đổi. An toàn tài khoản nằm ở ③ AI Bán hàng › Kết quả.</p>
      </div>

      <div className="max-w-5xl mx-auto pb-xl">
        {/* HÀNG 1 — thẻ ngang rộng hết chiều ngang, viền phát sáng */}
        <div className="bg-surface-container border border-outline-variant rounded-xl p-md grid grid-cols-1 md:grid-cols-10 gap-md items-start mb-md">
          {/* Left */}
          <div className="flex flex-col md:col-span-4">
            <span className="font-label-sm text-primary tracking-widest uppercase mb-1">GÓI ĐANG DÙNG</span>
            <h3 className="text-3xl font-bold text-on-surface">{currentPlan.name}</h3>
            <p className="text-base text-primary font-bold">{currentPlan.price.replace('/tháng', ' mỗi tháng')}</p>
            <p className="font-body-md text-on-surface-variant mt-2">{plan === 'trial' ? 'Đang dùng thử' : 'Gia hạn tự động hằng tháng'}</p>
          </div>
          {/* Middle */}
          <div className="flex flex-col min-w-[220px] md:col-span-3">
            <span className="font-label-sm text-on-surface-variant tracking-widest uppercase mb-2 whitespace-nowrap">SỐ KÊNH ĐÃ KẾT NỐI</span>
            <div className="flex items-baseline gap-2 whitespace-nowrap">
              <span className="text-3xl font-bold text-primary">{usedChannels}</span>
              {coHanMuc && (
                <>
                  <span className="text-3xl font-bold text-on-surface-variant">/</span>
                  <span className="text-3xl font-bold text-on-surface-variant">{maxChannels}</span>
                </>
              )}
            </div>
            {coHanMuc && (
              <div className="w-full h-2 bg-surface-container rounded-full mt-3 overflow-hidden">
                <div className="h-full bg-primary" style={{ width: `${channelPercent}%` }}></div>
              </div>
            )}
            <p className="font-body-md text-on-surface-variant mt-2">{chuThichKenh}</p>
          </div>
          {/* Right */}
          <div className="flex flex-col gap-sm md:col-span-3 w-full">
            <button className="w-full py-3 bg-gradient-to-r from-primary to-primary-container text-on-primary font-label-sm rounded-lg hover:brightness-110 transition-all font-bold" onClick={() => handleUpgrade()}>Nâng cấp gói</button>
            <button className="w-full py-3 bg-surface-container text-on-surface font-label-sm rounded-lg border border-outline hover:border-primary transition-colors font-bold" onClick={() => handleUpgrade()}>Xem hóa đơn</button>
          </div>
        </div>

        {/* HÀNG 2 — dải giải thích cách tính tiền, nền sáng hơn nền chung, có biểu tượng thông tin */}
        <div className="bg-surface-container-high rounded-xl p-4 flex items-start gap-3 mb-lg">
          <span className="material-symbols-outlined text-primary mt-0.5">info</span>
          <div>
            <p className="font-body-md text-on-surface font-bold">Bạn chỉ trả tiền theo số kênh kết nối</p>
            <p className="font-body-md text-on-surface-variant">Tin nhắn, bình luận và bài đăng không giới hạn. Một bài viral thu về nghìn bình luận cũng không tốn thêm đồng nào.</p>
          </div>
        </div>

        {/*
          HÀNG 2B — mức dùng thật trong tháng.

          Máy chủ vẫn luôn tính mấy con số này nhưng trước đây không hiển thị ở
          đâu cả. Đặt ngay dưới câu "không giới hạn" để chủ shop thấy bằng số
          thật là dùng bao nhiêu cũng không phát sinh thêm tiền.
        */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-md mb-lg">
          {[
            { nhan: 'TIN AI ĐÃ TRẢ LỜI', so: usage.ai_messages_month },
            { nhan: 'ĐƠN CHỐT ĐƯỢC', so: usage.orders_month },
            { nhan: 'BÀI ĐÃ ĐĂNG', so: usage.posts_month },
          ].map((o) => (
            <div key={o.nhan} className="glass-card rounded-xl p-md">
              <span className="font-label-sm text-on-surface-variant tracking-widest uppercase">{o.nhan}</span>
              <p className="text-3xl font-bold text-on-surface mt-1">{o.so.toLocaleString('vi-VN')}</p>
              <p className="font-body-md text-on-surface-variant">trong tháng này, không tính thêm tiền</p>
            </div>
          ))}
        </div>

        {/* HÀNG 3 — ba thẻ gói nằm ngang, thẻ giữa có viền sáng nổi bật và nhãn góc "ĐANG DÙNG" */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-md mb-md">
          {plans.map((plan, idx) => (
            <div 
              key={plan.id} 
              className={`rounded-xl p-md flex flex-col relative overflow-hidden border ${
                plan.isCurrent 
                  ? 'border-primary bg-surface-container z-10' 
                  : 'bg-surface-container border-outline-variant transition-transform hover:-translate-y-1 duration-300'
              }`}
            >
              {plan.isCurrent && (
                <div className="absolute top-0 right-0 bg-primary text-on-primary font-label-sm text-[10px] px-3 py-1 rounded-bl-lg font-bold">ĐANG DÙNG</div>
              )}
              <h4 className="text-xl font-bold text-on-surface">{plan.name}</h4>
              <p className="text-base text-primary font-bold mt-1">{plan.price}</p>
              <div className="flex flex-col gap-3 mt-md mb-lg flex-1">
                {plan.features.map((feature, fidx) => (
                  <div key={fidx} className={`flex items-start gap-2 ${!feature.included ? 'opacity-40' : ''}`}>
                    <span className={`material-symbols-outlined ${feature.included ? 'text-primary' : 'text-on-surface-variant'} text-[20px]`}>
                      {feature.included ? 'check' : 'close'}
                    </span>
                    <span className={`font-body-md ${feature.included ? 'text-on-surface' : 'text-on-surface-variant line-through'}`}>
                      {feature.name}
                    </span>
                  </div>
                ))}
              </div>
              <button 
                className={`w-full py-3 font-label-sm rounded-lg font-bold mt-auto transition-all ${
                  plan.isCurrent 
                    ? 'bg-surface-container-highest text-on-surface-variant cursor-not-allowed border border-outline-variant'
                    : plan.id === 'enterprise'
                      ? 'bg-gradient-to-r from-primary to-primary-container text-on-primary hover:brightness-110'
                      : 'bg-surface-container-high text-on-surface border border-outline hover:border-primary'
                }`}
                disabled={plan.isCurrent}
                onClick={() => handleUpgrade(plan.id)}
              >
                {plan.buttonText}
              </button>
            </div>
          ))}
        </div>
        <p className="text-center font-body-md text-on-surface-variant mb-xl">Cần nhiều hơn 10 kênh? <a href={SUPPORT_URL} {...(IS_EXTERNAL_SUPPORT ? { target: '_blank', rel: 'noreferrer' } : {})} className="text-primary hover:underline">Liên hệ để có báo giá riêng.</a></p>

        {/*
          "An toàn tài khoản" và "Quy định bắt buộc của Facebook" đã chuyển sang ③ AI Bán hàng › Kết quả
          (components/AnToanTaiKhoan.tsx): đó là số liệu và giới hạn gửi tin của từng khối não, không thuộc gói dịch vụ
          (rà soát lượt 2, T11).
        */}
      </div>
    </div>
  );
}
