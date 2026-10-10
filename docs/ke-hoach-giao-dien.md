# Kế hoạch tối ưu giao diện — rà soát LƯỢT 2 (10/10/2026)

Lượt 1 chỉ xem các trang bên ngoài. Lượt 2 đọc TOÀN BỘ phần hiển thị: 13 trang, 15 hộp thoại, các phần thu gọn / menu ⋯ /
thẻ con bên trong, cộng 2 phép quét tự động trên mã nguồn (nút chết; đếm màu). Ràng buộc: không làm hỏng chức năng hiện có —
sau mỗi giai đoạn chạy bộ kiểm (1096 điểm) + kiểm thử API khối não + xem trên trình duyệt.

## 0. Số đo chung

- Màu xanh ngọc (primary) xuất hiện **~1.000 lần**; mọi màu khác cộng lại chỉ vài trăm lần → nút chính, nút phụ, chip, tiêu
  đề, số liệu, đường viền… đều cùng một màu (đúng như chủ dự án thấy).
- Mỗi trang một hệ cỡ chữ riêng (Gói dịch vụ dùng `font-display-lg/p-md`, các trang khác `text-3xl/p-6`…).

## 1. LỖI THẬT (sai dữ liệu / nút chết) — phải sửa trước, không phải chuyện thẩm mỹ

| # | Chỗ | Lỗi |
|---|---|---|
| L1 | Đơn hàng › menu ⋯ | "Mở đoạn chat", "Đổi trạng thái", "Hủy đơn" **bấm không làm gì** (chỉ đóng menu). |
| L2 | Đơn hàng | Ô "30 ngày qua" có hình nút bấm nhưng **không bấm được**. |
| L3 | Đơn hàng › chi tiết | "Mở đoạn chat gốc" chỉ sang Hộp thư, **không mở đúng hội thoại**; bảng sản phẩm chưa hiện đơn nhiều dòng hàng. |
| L4 | Telegram | 5/6 công tắc thông báo (sắp hết 24 giờ, tổng kết ngày, tổng kết tuần, khách mới bình luận, chi tiêu quảng cáo) **máy chủ không hề gửi**; công tắc "Bài đăng đã lên sóng" thì gửi bất kể bật/tắt. |
| L5 | Telegram | Tin mẫu khác tin thật; câu "bấm liên kết trong tin mở thẳng đơn" — tin thật **không có liên kết**. "Tổng kết cuối ngày" trùng báo cáo ngày của AI điều hành. |
| L6 | Quảng cáo | Biểu đồ "Đơn chốt" thật ra vẽ **số loại hành động** của Meta, không phải số đơn. |
| L7 | Quảng cáo | Ô "Đơn chốt từ quảng cáo: Chưa đo được" — **đã lỗi thời** (hệ thống đã ghi nguồn đơn theo quảng cáo). |
| L8 | Quảng cáo | 3 nút "Tạo quảng cáo" / "Đẩy bài đã đăng" / "Tạo chiến dịch mới" mở **cùng một luồng đẩy bài** — "tạo chiến dịch mới" không tồn tại. Thành công → "Xem chiến dịch" chỉ đóng hộp. |
| L9 | Tạo quảng cáo › bước 1 | Chưa có bài đăng nào thì **trống trơn** (ảnh chủ dự án gửi), không nói vì sao, không chỉ đường. |
| L10 | Nội dung › thẻ bài | Bài nào cũng ghi "**AI viết lúc…**" kể cả bài người viết; bài có ảnh chỉ hiện ô xám, **không hiện ảnh thật**. |
| L11 | Kết nối kênh | Chữ cứng "Gói hiện tại còn 1 lượt kết nối" — **số bịa**. |
| L12 | Hộp thư | Dải "Hôm nay" cố định cho mọi tin; "Tiến độ x/5" nhưng chỉ có 3 thông tin. |
| L13 | Gói dịch vụ | Dải cảnh báo "tỷ lệ khách chặn đang tăng" — chỉ số này không đo được (Meta không cung cấp). |

**Trạng thái Giai đoạn 1 (11/10/2026): ĐÃ SỬA L1–L13, chờ chủ dự án duyệt.** Trong lúc sửa tìm thêm và đã sửa:

| # | Chỗ | Lỗi |
|---|---|---|
| L14 | Đăng nhập | Trình duyệt nhớ trang của tài khoản trước → đăng nhập tài khoản khác bị 404 cả đường đăng nhập, **không vào được ứng dụng**. |
| L3b | Đơn hàng › chi tiết | Hộp chi tiết đọc `items` / `timeline` không tồn tại → bấm vào đơn là vỡ trang. Nay dựng từ dữ liệu thật. |
| L3c | Đơn hàng › chi tiết | Câu "bấm vào đơn để điền giá" nhưng không có chỗ điền → thêm nút **Điền giá** (đơn một sản phẩm). |
| L4b | Telegram | "Mất kết nối Fanpage" ghi "luôn gửi" nhưng không gửi; ô giờ tổng kết không lưu; "Gửi lại" thật ra gửi tin thử; nhật ký hiện thẻ HTML. |
| L13b | Gói dịch vụ | Mức nguy hiểm ghi "AI đã tự tạm dừng" dù chưa chắc có kênh bị dừng. |

Khoá chống tái phát: nhóm "giao diện lượt 2" trong `npm run kiem-tra` (đã thử ngược trên mã cũ — bắt được cả 9 lỗi).
Chưa kiểm trực tiếp được ở chế độ thử (cần Meta thật): nút "Xem chiến dịch" sau khi tạo quảng cáo, biểu đồ quảng cáo có số.

## 2. TRÙNG LẶP

| # | Chỗ | Trùng |
|---|---|---|
| T1 | Thanh menu | Ô "Trang bán hàng" trùng Kết nối kênh; danh sách không chịu nổi hàng trăm trang. |
| T2 | Đầu mỗi AI | Dải 1→2→3→4 trùng thanh menu; đầu trang ~250px. |
| T3 | Hộp thư | Thanh "Trang:" (bộ chọn kênh thứ 3); "Dừng AI" = "Người chat"; 2 nút "AI đọc thông tin khách"; 2 nút "Xem trên nền tảng". |
| T4 | Nội dung › thẻ bài | 2 bộ nút (đầu thẻ ✓ ⏱ 🗑 và chân thẻ Duyệt/Sửa/🗑); "Xem trên nền tảng" = "Xem bình luận". |
| T5 | Nội dung | "Chế độ đăng bài" và "Lịch tự đăng" — 2 chỗ cài cùng chuyện "có duyệt trước không". |
| T6 | Kết nối kênh | Lưới 20 thẻ "Các kênh có thể kết nối" trùng hộp "Bạn muốn kết nối nền tảng nào?". |
| T7 | Soạn bài › Xưởng AI | Hàng nút "Tạo ảnh / Tạo video" to + nút "Tạo ảnh" thứ hai trong ô mô tả. |
| T8 | AI Bán hàng › Hướng dẫn AI | Trong thẻ lại lồng thêm hàng thẻ con (Trả lời bình luận / Tin nhắn Messenger); 4 nút lưu rời (lời dặn, tự chủ, các bước, công tắc tự lưu). |
| T9 | Quản lý › chi tiết trang | Lặp lại Sức khoẻ, AI điều hành, Chuỗi 4 khâu — đã có trong ④ AI Điều hành. |
| T10 | Thanh trên cùng | Nhãn "TỰ ĐỘNG HÓA THỜI GIAN THỰC" trang trí; chấm xanh "đang trực tuyến" ở ảnh đại diện không đo gì. |
| T11 | Gói dịch vụ | Chứa "An toàn tài khoản" + "Giới hạn gửi tin" — thuộc ③ AI Bán hàng của từng khối não. |

## 3. KÍCH THƯỚC & MẬT ĐỘ

Thẻ kênh có thể kết nối ~120px × 20; thẻ tài khoản đã kết nối ~520px mỗi kênh; ô "Kết nối thêm" 300px; thẻ số liệu cao cố
định 140px với quầng sáng trang trí ngẫu nhiên (xanh/tím/cam không mang nghĩa); khung "Giới hạn bài viết 63.206 ký tự" 6 dòng
chữ cho một con số; thẻ bài đăng 3 cột chiếm cả màn hình cho vài bài.

## 4. BẢNG MÀU — đề xuất (theo quy tắc chủ dự án)

**A. Màu theo MIỀN — đồng nhất xuyên suốt** (mọi chỗ thuộc miền nào dùng màu miền đó: menu, đầu trang, nút chính, viền
khung, chip, biểu đồ, hộp thoại của miền đó):

| Miền | Màu | Áp vào |
|---|---|---|
| ④ AI Điều hành + Tổng quan khối não | **Xanh ngọc** `#22d3ee` (màu thương hiệu) | Điều hành, sức khoẻ, chỉ đạo, báo cáo ngày |
| ② AI Quảng cáo | **Vàng** `#facc15` | Quảng cáo, hộp "Tạo quảng cáo", tệp đối tượng, tiền quảng cáo |
| ③ AI Bán hàng | **Xanh lục** `#34d399` | Hộp thư, Đơn hàng, kịch bản, tự chủ, hộp "Tạo kịch bản", "Tạo đơn" |
| ① AI Nội dung | **Tím** `#a78bfa` | Bài đăng, hộp "Soạn bài", lịch tự đăng, Xưởng AI |
| Hệ thống chung (Kết nối kênh, Telegram, Gói, Quản lý) | **Trắng / xám sáng** (trung tính) | Không tranh màu với 4 AI |

**B. Màu theo MỨC QUAN TRỌNG — cho thứ độc lập, không thuộc miền nào:**

| Mức | Màu | Dùng cho |
|---|---|---|
| Nguy hiểm / lỗi / xoá | **Đỏ** `#f87171` | Mất kết nối, lỗi gửi, xoá, ngắt kết nối |
| Cần làm ngay | **Hồng** `#f472b6` | Chờ duyệt, khách chờ người, đơn chờ xác nhận, việc AI điều hành yêu cầu |
| Cảnh báo | **Cam** `#fb923c` | Sắp hết hạn, thiếu giá, gần chạm trần tiền |
| Thông tin / phụ | **Xanh lam** `#60a5fa` | Ghi chú, hướng dẫn, liên kết phụ |
| Trung tính | Xám | Trạng thái bình thường, đã tắt |

Thành công (đã lưu, đã kết nối) dùng dấu ✓ + chữ trắng — không dùng lục để khỏi lẫn với ③ Bán hàng.

**C. Thứ bậc nút** (mọi trang, mọi hộp thoại): mỗi vùng **một** nút chính tô đặc màu miền · nút phụ viền · nút thứ ba chỉ chữ ·
nút nguy hiểm viền đỏ (tô đỏ khi xác nhận xoá). 4 bước Hướng dẫn AI · Đang làm · Kết quả · Nhật ký: mỗi bước một màu riêng
lấy từ bảng B (lam · hồng · cam · xám) + số thứ tự, bước đang mở tô đặc.

## 5. KẾ HOẠCH

| Giai đoạn | Việc | Mục sửa |
|---|---|---|
| **1 — Sửa lỗi thật** | L1–L13: nút chết, dữ liệu sai, chữ bịa, công tắc không tác dụng (nối thật hoặc gỡ + nói rõ) | L1–L13 |
| **2 — Hệ màu & thứ bậc** | Đưa bảng màu A/B/C thành biến dùng chung; áp cho menu, 4 khuôn AI, 15 hộp thoại, mọi nút / chip / thẻ số / biểu đồ | §0, §4 |
| **3 — Bỏ trùng lặp, gọn đầu trang** | T1–T11; Trang & kênh dạng bảng một dòng mỗi trang (tìm, lọc, phân trang); đầu mỗi AI còn một hàng | T1–T11, §3 |
| **4 — Mật độ & nhất quán** | Một bộ cỡ chữ / khoảng cách / bo góc; thẻ số liệu gọn; thẻ bài đăng dạng danh sách gọn có ảnh thật; kiểm điện thoại 375px và màn 1440px | §3 |

## 6. TRẠNG THÁI (11/10/2026) — đã làm xong cả 4 giai đoạn

| Giai đoạn | Đã làm |
|---|---|
| 1 | L1–L14 (xem §1). |
| 2 | Màu theo miền (index.css `.mien-*`, đặt theo đường dẫn ở App.tsx; nguồn src/lib/bon-ai.ts): ④ + Tổng quan xanh ngọc · ② vàng · ③ lục · ① tím · hệ thống trung tính. Màu mức quan trọng: `loi` đỏ · `gap` hồng · `canh-bao` cam · `thong-tin` lam; ổn = ✓ trắng. Gỡ quầng sáng xanh ngọc ghi cứng. 4 bước có số, mô tả, màu lam · hồng · cam · xám, bước mở tô đặc. Khung con: màu miền chỉ cho AI của nó (vd. "Chỉ đạo từ ④" xanh ngọc ở mọi trang). Trạng thái đơn / bài / hội thoại theo bảng màu. |
| 3 | T1 bỏ ô chọn trang ở menu → mục "Trang & kênh" ngay dưới logo + bảng trang (tìm, lọc, gom tài khoản, 25 dòng/trang), thanh trên hiện "Khối não: ‹trang›". T2 đầu AI một hàng. T3 Hộp thư: lọc kênh chỉ khi ≥2 kênh (mặc định tất cả), một nút "Tôi tiếp quản / Trả cho AI", bỏ nút trùng. T4 thẻ bài một bộ nút. T5 giữ hai cài đặt (khác phạm vi) nhưng ghi rõ "Bài bạn tự soạn". T6 bỏ lưới 20 thẻ kênh, kênh dạng dòng bấm mở quyền + thao tác. T7 nút chọn bên đổi "Ảnh / Video". T8 thẻ con thành ô chọn hai mục (mỗi mục lưu riêng). T9 Quản lý: thay Sức khoẻ + AI điều hành bằng nút mở ④ (giữ Chuỗi 4 khâu — chưa có trong khối não). T10 bỏ nhãn trang trí + chấm trực tuyến giả. T11 An toàn tài khoản + Quy định Facebook chuyển sang ③ › Kết quả. |
| 4 | Một mẫu trang (lề, bề rộng, không lặp tiêu đề thứ hai); thẻ số gọn (24px, bỏ cao cố định 140px); bài đăng dạng danh sách có ảnh thật; giới hạn ký tự một dòng (bấm mở chi tiết). Đo tự động 18 màn × 1440px / 375px: không tràn ngang; 21 màn mở không đổ. |

Khoá chống lùi: nhóm "giao diện lượt 2" trong `npm run kiem-tra` (1128 điểm, đã thử ngược trên mã cũ).
Chưa xem bằng mắt được (cần Meta thật): biểu đồ quảng cáo có số, sau khi tạo quảng cáo.

