# Khối não AI — nguyên tắc cố định của hệ thống

Chủ dự án chốt ngày 10/10/2026. Đây là luật nền: mọi màn hình, bảng dữ liệu và đường xử lý đều phải theo.

## 1. Định nghĩa

**Trang bán hàng** = một Fanpage cộng các kênh đi kèm của cùng shop (Instagram, TikTok…). Bảng `trang`.

**Khối não** = 4 AI cố định, liền mạch, gắn 1–1 với một trang bán hàng:

| # | AI | Chức năng cố định | Dòng cài đặt (`ai_configs.kind`) |
|---|---|---|---|
| ① | AI Nội dung | Viết bài, ảnh/video, lên lịch, đăng bài | `content` |
| ② | AI Quảng cáo | Lên chiến lược, chạy quảng cáo, tối ưu ngân sách trong trần | `ads` |
| ③ | AI Bán hàng | Tư vấn, thuyết phục, đàm phán, chốt đơn, báo đơn qua Telegram | `sales` |
| ④ | AI Điều hành | Nhận số liệu năng suất/hiệu suất hằng ngày của ①②③, giữ & phát triển cái tốt, tìm nguyên nhân gốc cái chưa tốt, chỉ đạo sửa → vòng lặp tự hoàn thiện | `analytics` |

```
Chủ chuỗi ─┬─ Trang 1 ── Khối não 1
           ├─ Trang 2 ── Khối não 2
           └─ Trang N ── Khối não N

  ① Nội dung → ② Quảng cáo → ③ Bán hàng
        ↑                         │
        └──── ④ Điều hành ◄───────┘
```

## 2. Luật cứng

1. **Không tách rời.** Trang nào cũng có đủ 4 AI; không có AI nào đứng ngoài một trang. Không màn hình nào bày một AI ra
   khỏi khối não của nó.
2. **Độc lập tuyệt đối.** Dữ liệu nghiệp vụ (bài đăng, quảng cáo, hội thoại, tin nhắn, bình luận, khách, đơn, tiền AI,
   báo cáo, đề xuất, cài đặt từng AI, luật an toàn, luật nhường người, kịch bản bình luận) mang `trang_id`. Khối não chỉ
   đọc / ghi dữ liệu có `trang_id` của chính nó. `user_id` giữ lại = chủ tài khoản của trang (tiền, quyền).
3. **Một chỗ duy nhất xác định khối não của yêu cầu**: `server/khoi-nao.ts` (`req.nao`). Route khối não KHÔNG tự đoán
   trang, không lọc dữ liệu khối não bằng `req.user.id`.
4. **Thứ thay đổi được** chỉ là: trang / kênh, mục tiêu, sản phẩm, tài liệu, lời dặn từng AI, trần tiền. Chức năng 4 AI
   không đổi.

## 3. Giao diện

- Bộ chọn duy nhất: **Trang bán hàng** (đầu thanh menu). Chọn trang nào → toàn bộ màn hình là khối não trang đó.
- Menu khối não: Tổng quan khối não · ① AI Nội dung · ② AI Quảng cáo · ③ AI Bán hàng (gồm Hộp thư, Đơn hàng) ·
  ④ AI Điều hành (gồm thống kê, sức khoẻ, báo cáo chuỗi, đề xuất).
- Dữ liệu của trang: Mục tiêu & sản phẩm · Tài liệu · Kết nối kênh · Telegram.
- Quản lý (chủ chuỗi / quản trị): danh sách khối não, chi phí, gói dịch vụ.
- 4 màn hình AI dùng chung một khuôn 4 thẻ: **Hướng dẫn AI · Đang làm · Kết quả · Nhật ký**.

## 4. Quyền mở khối não

Người đăng nhập mở được khối não của trang khi: trang thuộc chính tài khoản mình; hoặc mình là chủ chuỗi và tài khoản
của trang là tài khoản con của mình; hoặc mình là quản trị tổng. Ngoài ba trường hợp đó → 404 (không xác nhận trang tồn
tại).
