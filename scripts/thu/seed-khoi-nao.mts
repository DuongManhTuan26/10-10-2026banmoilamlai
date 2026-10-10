/**
 * Dữ liệu THỬ cho môi trường thử riêng (CHE_DO_THU) — KHÔNG chạy trên database thật (tự chặn nếu thiếu cờ).
 * Chủ chuỗi C → tài khoản A (2 trang: T1, T2) và B (1 trang: TB). Mỗi trang có kênh, hội thoại, đơn, bài riêng.
 * Mật khẩu thử của mọi tài khoản: biến MAT_KHAU_THU dưới đây.
 */
import "dotenv/config";
import { query } from "../../server/db.js";
import { hashPassword } from "../../server/auth.js";

if (process.env.CHE_DO_THU !== "bat") throw new Error("Chỉ chạy trong môi trường thử (CHE_DO_THU=bat)");
const MAT_KHAU_THU = "thu-khoi-nao-123";
const h = await hashPassword(MAT_KHAU_THU);

await query("DELETE FROM users WHERE email LIKE '%@khoinao.test'");
const u = async (email: string, role: string, parent: number | null) =>
  (await query<{ id: number }>("INSERT INTO users (email, password_hash, name, role, parent_id) VALUES ($1,$2,$3,$4,$5) RETURNING id::int",
    [email, h, email.split("@")[0], role, parent])).rows[0].id;
const C = await u("chuoi@khoinao.test", "admin_con", null);
const A = await u("shop-a@khoinao.test", "shop", C);
const B = await u("shop-b@khoinao.test", "shop", C);
const t = async (user: number, ma: string, ten: string) =>
  (await query<{ id: number }>("INSERT INTO trang (user_id, profile_ref, ten, page_id) VALUES ($1,$2,$3,$4) RETURNING id::int",
    [user, `hs-${ma}`, ten, `fp-${ma}`])).rows[0].id;
const T1 = await t(A, "t1", "Shop A — Fanpage 1"), T2 = await t(A, "t2", "Shop A — Fanpage 2"), TB = await t(B, "tb", "Shop B");
for (const [id, user, trang] of [["k-t1", A, T1], ["k-t2", A, T2], ["k-tb", B, TB]] as const) {
  await query("INSERT INTO social_accounts (id, user_id, platform, connected, trang_id, display_name, page_id) VALUES ($1,$2,'facebook',true,$3,$1,$1)", [id, user, trang]);
}
let n = 0;
for (const [kenh, user, so] of [["k-t1", A, 3], ["k-t2", A, 2], ["k-tb", B, 1]] as const) {
  for (let i = 0; i < so; i++) {
    n++;
    const kh = (await query<{ id: number }>("INSERT INTO customers (user_id, social_account_id, platform, participant_id, name) VALUES ($1,$2,'facebook',$3,$4) RETURNING id::int", [user, kenh, `p${n}`, `Khách ${kenh}-${i}`])).rows[0].id;
    await query("INSERT INTO conversations (id, user_id, social_account_id, customer_id, platform, status, ai_enabled, last_message_at, last_customer_message_at) VALUES ($1,$2,$3,$4,'facebook','ai',true,now(),now())", [`hc-${kenh}-${i}`, user, kenh, kh]);
    await query("INSERT INTO messages (user_id, conversation_id, sender_type, content) VALUES ($1,$2,'customer','chào shop')", [user, `hc-${kenh}-${i}`]);
  }
  await query("INSERT INTO posts (user_id, content, target_account_ids, status) VALUES ($1,$2,ARRAY[$3],'draft')", [user, `Bài của ${kenh}`, kenh]);
}
console.log(JSON.stringify({ C, A, B, T1, T2, TB }));
process.exit(0);
