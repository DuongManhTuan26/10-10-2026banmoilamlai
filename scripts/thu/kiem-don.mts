/** Kiểm đơn nhiều sản phẩm + đơn gần nhất (môi trường thử). */
import "dotenv/config";
if (process.env.CHE_DO_THU !== "bat") throw new Error("Chỉ chạy trong môi trường thử");
const { taoDon, donGanNhat } = await import("../../server/services/orders.js");
const { query } = await import("../../server/db.js");
let loi = 0;
const kiem = (ten: string, dung: boolean, ct = "") => { if (!dung) loi++; console.log(`${dung ? "✓" : "✗"} ${ten}${ct ? ` — ${ct}` : ""}`); };
const A = (await query<{ id: number }>("SELECT id::int FROM users WHERE email = 'shop-a@khoinao.test'")).rows[0].id;
const don = await taoDon({ userId: A, conversationId: "hc-k-t1-1", customerName: "Lan", phone: "0901", address: "HN",
  product: "x", quantity: 1, unitPrice: 0, note: null, closedBy: "ai",
  items: [{ ten: "Kem A", soLuong: 2, donGia: 150000 }, { ten: "Son B", soLuong: 1, donGia: 90000 }] });
kiem("đơn 2 dòng: tổng = 2×150k + 90k", Number(don.total) === 390000, String(don.total));
kiem("đơn 2 dòng: tên gộp, số lượng cộng, đơn giá 0", don.product === "Kem A x2; Son B" && Number(don.quantity) === 3 && Number(don.unit_price) === 0, `${don.product} | ${don.quantity} | ${don.unit_price}`);
kiem("đơn 2 dòng: lưu từng dòng", Array.isArray(don.items) && (don.items as unknown[]).length === 2);
kiem("đơn ghi đúng trang của hội thoại", Number(don.trang_id) === 1, String(don.trang_id));
const gn = await donGanNhat("hc-k-t1-1");
kiem("đơn gần nhất của hội thoại = đơn vừa tạo, 0 ngày", gn?.code === don.code && gn?.soNgay === 0, JSON.stringify(gn));
await query("UPDATE orders SET status = 'cancelled' WHERE id = $1", [don.id]);
kiem("đơn đã huỷ không tính là đơn đang mở", (await donGanNhat("hc-k-t1-1")) === null);
await query("DELETE FROM orders WHERE id = $1", [don.id]);
console.log(loi ? `${loi} SAI` : "Tất cả đều đạt");
process.exit(loi ? 1 : 0);
