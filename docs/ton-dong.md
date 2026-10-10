# Sổ tồn đọng

Mọi thứ CHƯA xử lý xong đều phải nằm ở đây — không chỉ nói trong chat rồi quên.

Nguyên tắc (chủ dự án đặt 03/10/2026): đã làm thì phải xử lý triệt để, không để
tồn tại lỗi dù nhỏ nhất. Chỉ được để lại khi đã cố hết sức mà **thật sự không thể** —
khi đó ghi rõ nguyên nhân ở đây. Phải phân biệt rạch ròi:

- **LỖI**: sai so với yêu cầu / quy tắc đã đặt. Phải sửa.
- **LỰA CHỌN**: quyết định có chủ ý, có đánh đổi, chủ dự án biết và đồng ý. Không phải lỗi.
- **GIỚI HẠN**: đã thử hết cách mà không làm được — ghi đã thử gì, vì sao không được.
- **CHỜ CHỦ DỰ ÁN**: làm được, nhưng cần quyết định / tiền / quyền của chủ dự án.

Ràng buộc tiền do chủ dự án đặt KHÔNG phải "không thể" — ghi là CHỜ CHỦ DỰ ÁN kèm số tiền cần.

Mỗi mục: hiện tượng · căn cứ để gọi là lỗi · nguyên nhân gốc · đã làm gì · còn gì · trạng thái.

---

## TD-01 — Chữ AI vẽ trong video quảng cáo thử (dự án #9): "ORDER", "ORDEED", chữ li ti

- **Loại:** CHỜ CHỦ DỰ ÁN XÁC ĐỊNH — **chưa phải lỗi.**
- **Hiện tượng:** cảnh 5 (giây ≈33,4–38,9) bong bóng có chữ "Order"/"ORDER"; cảnh 7 "ORDEED";
  cảnh 2 chữ li ti trong bong bóng. Chữ do mô hình video tự vẽ.
- **Vì sao chưa được gọi là lỗi:** căn cứ em từng dùng ("không có chữ đọc được" trong ý tưởng video,
  luật cấm chữ `LUAT_VIDEO`) đều do EM tự đặt — không phải yêu cầu của chủ dự án. Chủ dự án
  (03/10/2026): chữ là do lập trình của hệ thống tạo ra; phải xác định rõ là lỗi và hỏi ý kiến
  trước khi sửa.
- **Đã làm sai rồi gỡ (03/10/2026):** em tự thêm luật màn hình cho đạo diễn AI và bước soi chữ ở
  mọi cảnh (tốn tiền mỗi cảnh, tự vẽ lại) khi chưa được duyệt; đã tự tiêu ≈0,05 USD để thử. Đã gỡ
  hết, mã về như trước; 896 phép kiểm đạt.
- **Cần chủ dự án quyết:** chữ do AI vẽ trong video có được chấp nhận không. Chưa có quyết định
  thì không làm gì thêm.

## TD-02 — Bộ kiểm định cảnh bỏ sót "mặt đổi dần thành người khác"

- **Loại:** GIỚI HẠN (tạm thời).
- **Hiện tượng:** trên 18 clip đã soi bằng mắt, bộ kiểm đúng 17/18; sót clip #8-5 (mặt đổi dần
  giữa clip, sáng lên +19/255).
- **Đã thử (02/10/2026):** 5 cách hỏi AI và 2 mô hình — hỏi chung (17→16/18, không ổn định),
  bắt chứng minh nguyên nhân + số đo (17/18 ổn định — đang dùng), thêm câu "cùng một người?"
  (16/18), Claude Sonnet 5 (15/18), chỉ 2 khung + code tự kết luận (14/18).
- **Còn có thể thử:** so khuôn mặt bằng mô hình nhận dạng mặt chuyên dụng thay vì hỏi AI chung.
- **Giảm thiểu đã làm:** ảnh mẫu nhân vật nền trơn — ở bản cuối dự án #9 không thấy đổi mặt.

## TD-03 — Vẽ ảnh qua API `/images` của OpenRouter — ĐÃ KIỂM BẰNG LẦN GỌI THẬT (03/10/2026)

- **Trạng thái:** XONG. Chủ dự án cho vẽ thử. Cùng một bài cà phê, đi đúng đường nút "Nhờ AI vẽ ảnh":
  GPT Image 1 Mini (thấp) 0,002628 USD · Seedream 5.0 Flash 0,018 · Nano Banana 2 Lite 0,03365 —
  giá thật khớp giá app báo trước; ảnh 1024×1024 lên kho đúng.
- **MAI-Image 2.6 / 2.6 Flash — ĐÃ BỎ (03/10/2026, chủ dự án giao "nghiên cứu rồi chọn phương án có cơ sở"):**
  đo thật 5 lượt qua đúng đường app: lời nhắc tiếng Việt bị chặn 3/3 ("DallEBlockList"), kể cả câu
  "Túi cà phê rang xay 500g trên bàn gỗ", ở cả hai bản; tiếng Anh vẽ được 1/1 (0,0198 USD). Ba mô
  hình khác vẽ được đúng bài tiếng Việt đó. App bán cho người Việt, lời nhắc ảnh là tiếng Việt → bỏ.
  Tốn cho việc thử: 0,0198 USD (lượt bị chặn không mất tiền).

## TD-04 — Khung mở đầu / ảnh mẫu nhân vật của video dài dùng một mô hình ảnh cố định — ĐÃ SỬA (03/10/2026)

- **Là lỗi** theo quy tắc của chủ dự án (không cố định mặc định ở bất kỳ phần nào).
- **Đã sửa:** chọn "Mô hình vẽ khung mở đầu cho cảnh cắt" ở video dài (ghép nhiều cảnh), xếp rẻ tới
  đắt; vẽ qua `/images`; ảnh mẫu không vượt sức mô hình; báo giá dự án tính tiền khung theo mô hình
  đã chọn. Dự án cũ chưa chọn → mô hình rẻ nhất nhận ảnh mẫu.

## TD-05 — Video "theo bài" khi bấm Đăng bài — ĐÃ CHẠY THẬT (04/10/2026)

- **Trạng thái:** XONG về luồng. Chủ dự án cho chạy 1 lượt, đăng thật lên Fanpage Tư Vấn Tài Chính:
  bài #48, Wan 3.0 · 2 giây · 480p · 9:16 · không chữ. Bấm Đăng bài 14:31:46 → hỏi lại kèm giá → bài chờ
  video → video xong 14:33:32 → máy chủ tự gắn video → lên Facebook 14:34:32 (~2 phút 46 giây). Sổ chi phí
  ghi đủ: viết lời nhắc 0,004726 USD + video 0,2125 USD.
- **Lộ ra 2 vấn đề** → TD-06 (giá Wan 3.0) và TD-07 (Wan 3.0 vẫn có tiếng khi đã tắt).

## TD-06 — Wan 3.0 tính 0,2125 USD cho video 2 giây 480p, app báo 0,10 — ĐÃ SỬA (04/10/2026)

- **Loại:** LỖI GIÁ BÁO TRƯỚC (chủ shop thấy ~2.500đ, bị trừ ~5.400đ).
- **Bằng chứng (2 lượt thật, chủ dự án cho thử):** #40 dài 2,02 giây và #41 dài 5,04 giây, cùng 480p, CÙNG bị trừ
  0,2125 USD (`usage.cost` của OpenRouter). = 5 giây × 0,05 × (1 − 15%). Mức giảm 15% là trường chính thức
  `endpoints[].pricing.discount` của OpenRouter; Alibaba không công bố mức tối thiểu 5 giây — chỉ đo được.
  Mô hình khác đã chạy thật (Veo 3.1 Lite 18 lượt, Hailuo 3 7 lượt) có discount 0 nên khớp 100%.
- **Đã sửa:** giá = max(số giây, số giây tối thiểu đã đo) × giá/giây × (1 − mức giảm đọc sống). Wan 3.0 ghi
  tối thiểu 5 giây + ghi chú cho khách. Không đọc được mức giảm thì coi như 0 (báo cao hơn, không thấp hơn).
- **Chưa đo thật:** HeyGen Video 1 đang giảm 50% → giá báo giảm một nửa theo dữ liệu chính thức; Wan 3.0 Prime
  (giảm 0%) chưa biết có mức tối thiểu hay không. Lần đầu chạy thật hai mô hình này nên so `usage.cost` với giá báo.

## TD-07 — Wan 3.0 trả video CÓ TIẾNG dù đã tắt "Có âm thanh do AI tạo" — CHỈ GHI CHÚ (04/10/2026)

- **Loại:** GIỚI HẠN của mô hình. App gửi `generate_audio: false`; video #40 vẫn có tiếng thật (−16,6 dB).
  Tài liệu Alibaba: tiếng luôn được tạo, cờ chỉ quyết định có trả về không; bật/tắt không đổi giá.
- **Chủ dự án chọn:** để nguyên, chỉ ghi chú. Wan 3.0 và Wan 3.0 Prime hiện dòng cam "Luôn có tiếng do AI tạo"
  dưới ô chọn mô hình (Xưởng AI và lịch tự đăng). Không gỡ tiếng (tránh mất dấu hiệu nội dung AI trong tệp).


## TD-08 — Tiền theo từng trang — ĐÃ XỬ LÝ (04–05/10/2026)

- **Bối cảnh:** chủ dự án tự thiết kế màn hình quản lý tách Tổng quan / Chi tiết (cây Chuỗi → Tài khoản → Trang),
  tiền mỗi trang theo từng loại, tiền kênh "khớp tuyệt đối 100%" với nhà cung cấp kênh.
- **Đã làm:** tiền kênh đọc thẳng `GET /v1/usage?groupBy=account` (tổng các kênh = hoá đơn, đo kỳ 09/2026:
  4,71 = 4,71) rồi cộng về trang; sổ AI ghi trang cho từng lượt (cột `ai_usage.trang_id`, ngữ cảnh ở mọi
  điểm vào); Fanpage Tư Vấn Tài Chính đã chuyển sang hồ sơ riêng (1 trang = 1 hồ sơ), đồng bộ hỏi mọi hồ sơ.
- **Chủ dự án duyệt 05/10/2026 — ĐÃ LÀM:**
  0. **Mốc tính theo trang = 05/10/2026 00:00 giờ VN.** Trước mốc bỏ khỏi Tổng quan / Chi tiết ("những cái gì đã qua
     rồi không thể tính chính xác được hãy bỏ qua"); khối Chi phí vẫn giữ hoá đơn thật. Mỗi số có nhãn ĐÃ CHỐT /
     TẠM TÍNH: AI chốt khi mọi lượt đã đối chiếu; kênh chốt khi hết kỳ; quảng cáo chốt sau 28 ngày (Meta: insights
     "do not change after 28 days").
  1. **Đơn hàng ghi trang + kênh lúc tạo** (`orders.trang_id`, `social_account_id`): có hội thoại → kênh hội thoại;
     tạo tay không hội thoại → trang duy nhất, hoặc bắt buộc chọn khi có từ 2 trang. Đo: đơn tạo tay → trang 245;
     chỉ định trang của tài khoản khác → để trống.
  2. **Đổi Fanpage giữa tháng:** sổ `kenh_trang_ngay` (ngày UTC, ghi trạng thái đầu ngày + ngay trước khi đổi);
     tiền kênh chia theo số ngày ở từng trang. Luật "1 Fanpage mỗi tài khoản" giữ nguyên → Fanpage mới luôn có hồ sơ
     riêng (tài khoản mới), không cần đổi luồng nối kênh.
  3. **Tiền quảng cáo:** đọc qua kết nối Facebook sẵn có (không nối Meta Ads riêng → không thêm phí kênh),
     `GET /v1/ads?pageId=` theo Fanpage của trang, giữ VND, ngày theo múi giờ tài khoản quảng cáo; phần cùng tài
     khoản chi cho Fanpage khác chỉ ghi để biết. Đo: 2 tài khoản quảng cáo (VND, UTC+7), năm 2026 chưa có quảng cáo
     → 0 ₫ thật.

## TD-09 — AI nhân viên chỉ thấy 5 tài liệu mới nhất mỗi loại, mỗi tài liệu 4.000 ký tự đầu

- **Loại:** CHỜ CHỦ DỰ ÁN — **chưa gọi là lỗi** (chưa có yêu cầu của chủ dự án về việc này).
- **Hiện tượng (đọc mã `knowledge.ts`, mức "có cơ sở"):** `LIMIT 5` + cắt 4.000 ký tự mỗi tài liệu. Bảng giá ở tài liệu
  thứ 6, hoặc sau ký tự 4.000, thì AI bán hàng không thấy — có thể trả lời "shop chưa có thông tin" hoặc đoán.
- **Đã làm (09/10/2026):** đưa hai giới hạn thành hằng số dùng chung; sổ bằng chứng đánh dấu đúng phần AI nhân viên
  không thấy. KHÔNG đổi hành vi của AI nhân viên.
- **Cần chủ dự án quyết:** có nới / đổi cách đưa tài liệu (vd. chọn đoạn liên quan) không — dính chi phí mỗi lượt AI.

## TD-10 — Số quảng cáo của Meta chốt sau bao lâu: chưa xác minh

- **Loại:** GIỚI HẠN (tạm thời).
- **Hiện tượng:** tài liệu chính thức tìm được (09/10/2026) chỉ nói về cửa sổ quy công, không nói số hiển thị / nhấp /
  tiền chi chốt sau bao lâu. Sổ bằng chứng tạm xếp số quảng cáo hạng C ("chưa xác minh độ chốt") — không chặn đề xuất,
  chỉ hạ mức chắc.
- **Cách xác minh (không tốn tiền):** chụp số của cùng một ngày qua nhiều ngày liền, so độ lệch → biết sau bao lâu thì
  không đổi nữa; khi đó nâng hạng cho số đã qua mốc.

## TD-11 — Cột "tiền AI tháng" của bảng điều hành: API có trả, không màn hình nào hiển thị

- **Loại:** CHỜ CHỦ DỰ ÁN — chưa phải lỗi (không sai số; chỉ là trường không ai đọc).
- **Hiện tượng (10/10/2026):** kiểm ngược toàn bộ thấy lỗ "bảng điều hành bỏ tiền AI" lọt — phép kiểm cũ đã mất, và
  `tien_ai_thang` (`quan-ly-chung.ts`) chỉ còn trong kiểu dữ liệu `api.ts`, không màn hình nào dùng (Tổng quan đã chuyển
  sang `tong-quan.ts`).
- **Đã làm:** khôi phục phép kiểm công thức (đúng cách sao kê). KHÔNG xoá cột.
- **Cần quyết:** giữ (để dùng sau) hay bỏ cột thừa.

## TD-12 — Khối não (10/10/2026): việc còn lại sau đợt thiết kế lại

- **Bước 5 — AI quảng cáo tự tối ưu ngân sách: CHƯA LÀM.** Đụng tiền thật; bản thử dùng khoá giả nên chưa đọc được
  cấu trúc API quảng cáo thật (liên kết quảng cáo → chiến dịch, số chi theo chiến dịch). Hướng đã định: chế độ đề xuất
  mặc định; tự động chỉ khi chủ dự án bật, trong trần ngân sách, mỗi lần đổi tối đa ±20%, không tạo chiến dịch mới.
- **CHỜ CHỦ DỰ ÁN:** cách siết phép đối chiếu giá (một con số bất kỳ trong tài liệu đều được nhận); hiệu chỉnh khi kiểm
  nhiều chỉ số cùng lúc ở bảng sức khoẻ.
- **Chưa đưa vào khối não:** báo cáo chuỗi 4 khâu (BaoCaoChuoi) vẫn chỉ ở màn Quản lý — cần dữ liệu tiền của một trang.
- **Chưa chạy trên dữ liệu thật:** mọi kiểm thử chạy trên cơ sở dữ liệu thử; migration 047–050 cần sao lưu trước khi áp
  lên cơ sở dữ liệu thật.

## TD-13 — Telegram: ba thông báo đã gỡ khỏi giao diện (chủ dự án quyết 11/10/2026)

- **Hiện tượng (rà soát giao diện lượt 2, L4):** 6/8 công tắc trên trang Cảnh báo Telegram không có đường gửi nào phía
  máy chủ. Chủ dự án chọn làm thật **Sắp hết 24 giờ** và **Kênh mất kết nối** (`services/canh-bao-telegram.ts`);
  "Tổng kết cuối ngày" gộp vào báo cáo ngày của ④ AI Điều hành.
- **Đã gỡ, chưa làm:**
  - **Tổng kết tuần** — báo cáo ngày của AI điều hành đã gửi mỗi ngày; làm khi cần so sánh tuần.
  - **Bình luận mới** — AI tự xử lý bình luận; báo từng cái rất phiền.
  - **Cảnh báo chi tiêu quảng cáo** — làm cùng Bước 5 "AI quảng cáo tự tối ưu ngân sách" (TD-12), khi đọc được số chi
    theo chiến dịch thật.
- **Dữ liệu cũ:** khoá `weekly_summary`, `new_comment`, `ads_budget`, `daily_summary`, `dailySummaryTime` có thể còn
  trong `telegram_configs.events` của shop cũ — vô hại, không còn ai đọc.
