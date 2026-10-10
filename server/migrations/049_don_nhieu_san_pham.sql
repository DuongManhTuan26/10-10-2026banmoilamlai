-- ĐƠN NHIỀU SẢN PHẨM (rà soát 10/10/2026): trước bản này một đơn chỉ chứa được MỘT sản phẩm, một đơn giá — khách mua hai
-- loại thì AI ghi sai hoặc để giá 0 cho chủ shop điền tay. `items` giữ từng dòng hàng; product / quantity / unit_price /
-- total vẫn giữ để mọi màn hình và báo cáo cũ đọc đúng (product = tên các dòng gộp lại, total = tổng các dòng).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS items JSONB;
COMMENT ON COLUMN orders.items IS 'Các dòng hàng [{ten, so_luong, don_gia}] — null với đơn một sản phẩm tạo trước 10/10/2026';
