/**
 * Kiểm KHỐI NÃO qua API thật của bản thử (cổng 3100): mỗi trang chỉ thấy dữ liệu của mình; không mở được trang ngoài
 * phạm vi. Chạy sau seed-khoi-nao.mts. Chỉ dùng trong môi trường thử.
 */
const GOC = process.env.GOC ?? "http://localhost:3100";
const MK = "thu-khoi-nao-123";
let loi = 0;
const kiem = (ten: string, dung: boolean, chiTiet = "") => { if (!dung) loi++; console.log(`${dung ? "✓" : "✗"} ${ten}${chiTiet ? ` — ${chiTiet}` : ""}`); };

async function dangNhap(email: string) {
  const r = await fetch(`${GOC}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: MK }) });
  const c = r.headers.get("set-cookie")?.split(";")[0];
  if (!c) throw new Error(`Không đăng nhập được ${email}: ${r.status} ${await r.text()}`);
  return (duong: string, trang?: number, tuyChon: RequestInit = {}) =>
    fetch(`${GOC}/api${duong}`, { ...tuyChon, headers: { Cookie: c, "Content-Type": "application/json", ...(trang ? { "X-Trang": String(trang) } : {}), ...(tuyChon.headers ?? {}) } });
}
const json = async (r: Response) => ({ ma: r.status, du: await r.json().catch(() => null) as any });

const A = await dangNhap("shop-a@khoinao.test");
const B = await dangNhap("shop-b@khoinao.test");
const C = await dangNhap("chuoi@khoinao.test");
const [T1, T2, TB] = [1, 2, 3];

const hoiThoai = async (g: typeof A, t?: number) => json(await g("/inbox/conversations", t));
let r = await hoiThoai(A, T1); kiem("A mở T1 → 3 hội thoại của T1", r.ma === 200 && r.du.data.length === 3 && r.du.data.every((x: any) => x.social_account_id === "k-t1"), `${r.ma} ${r.du?.data?.length}`);
r = await hoiThoai(A, T2); kiem("A mở T2 → 2 hội thoại của T2", r.ma === 200 && r.du.data.length === 2 && r.du.data.every((x: any) => x.social_account_id === "k-t2"), `${r.ma} ${r.du?.data?.length}`);
r = await hoiThoai(A, TB); kiem("A mở TB (trang của B) → 404", r.ma === 404, `${r.ma}`);
r = await hoiThoai(B, T1); kiem("B mở T1 (trang của A) → 404", r.ma === 404, `${r.ma}`);
r = await hoiThoai(B); kiem("B không chọn trang → trang duy nhất TB, 1 hội thoại", r.ma === 200 && r.du.data.length === 1, `${r.ma} ${r.du?.data?.length}`);
r = await hoiThoai(C, TB); kiem("Chủ chuỗi C mở TB (tài khoản con) → 1 hội thoại", r.ma === 200 && r.du.data.length === 1, `${r.ma} ${r.du?.data?.length}`);
r = await hoiThoai(C, T2); kiem("Chủ chuỗi C mở T2 → 2 hội thoại", r.ma === 200 && r.du.data.length === 2, `${r.ma}`);
r = await hoiThoai(C); kiem("Chủ chuỗi C chưa chọn trang → 409 'chưa chọn trang'", r.ma === 409, `${r.ma}`);

// Chi tiết hội thoại của trang khác → 404 dù cùng tài khoản.
r = await json(await A("/inbox/conversations/hc-k-t2-0", T1)); kiem("A ở T1 đọc hội thoại của T2 → 404", r.ma === 404, `${r.ma}`);
r = await json(await A("/inbox/conversations/hc-k-t2-0", T2)); kiem("A ở T2 đọc hội thoại của T2 → 200", r.ma === 200, `${r.ma}`);

// Bài đăng theo trang.
r = await json(await A("/posts", T1)); kiem("Bài của T1 chỉ có bài T1", r.ma === 200 && r.du.data.length === 1 && r.du.data[0].content === "Bài của k-t1", `${r.du?.data?.map((x: any) => x.content)}`);
r = await json(await A("/posts", T2, { method: "POST", body: JSON.stringify({ content: "Bài mới T2", targetAccountIds: ["k-t1"] }) }));
kiem("Tạo bài ở T2 nhắm kênh của T1 → 400", r.ma === 400, `${r.ma} ${r.du?.error}`);
r = await json(await A("/posts", T2, { method: "POST", body: JSON.stringify({ content: "Bài mới T2", targetAccountIds: ["k-t2"] }) }));
kiem("Tạo bài ở T2 nhắm kênh T2 → 201, gắn trang T2", r.ma === 201 && Number(r.du.data.trang_id) === T2, `${r.ma} trang=${r.du?.data?.trang_id}`);

// Cài đặt AI theo trang: sửa lời dặn T1 không đụng T2.
await A("/ai/configs/sales", T1, { method: "PUT", body: JSON.stringify({ systemPrompt: "Lời dặn riêng T1" }) });
const p1 = await json(await A("/ai/configs/sales", T1)), p2 = await json(await A("/ai/configs/sales", T2));
kiem("Lời dặn AI bán hàng: T1 đổi, T2 giữ nguyên", p1.du?.data?.config?.system_prompt === "Lời dặn riêng T1" && p2.du?.data?.config?.system_prompt === "", `${p1.du?.data?.config?.system_prompt} | ${p2.du?.data?.config?.system_prompt}`);

// Luật nhường người theo trang.
await A("/ai/handoff-rules/discount", T2, { method: "PATCH", body: JSON.stringify({ enabled: false }) });
const h1 = await json(await A("/ai/handoff-rules", T1)), h2 = await json(await A("/ai/handoff-rules", T2));
const bat = (d: any) => d.du?.data?.find((x: any) => x.rule_key === "discount")?.enabled;
kiem("Luật 'mặc cả': tắt ở T2, T1 vẫn bật", bat(h1) === true && bat(h2) === false, `${bat(h1)} | ${bat(h2)}`);
kiem("Mỗi trang đủ 7 luật nhường người", h1.du?.data?.length === 7 && h2.du?.data?.length === 7, `${h1.du?.data?.length} | ${h2.du?.data?.length}`);

// Đơn tạo tay thuộc trang đang chọn.
r = await json(await A("/orders", T2, { method: "POST", body: JSON.stringify({ product: "SP", quantity: 1, unitPrice: 100000 }) }));
kiem("Đơn tạo tay ở T2 → trang T2", r.ma === 201 && Number(r.du.data.trang_id) === T2, `${r.ma} ${r.du?.data?.trang_id}`);
r = await json(await A("/orders", T1)); kiem("Danh sách đơn T1 không có đơn của T2", r.ma === 200 && r.du.data.length === 0, `${r.du?.data?.length}`);
r = await json(await A("/orders", T2, { method: "POST", body: JSON.stringify({ product: "SP", conversationId: "hc-k-t1-0" }) }));
kiem("Lên đơn ở T2 vào hội thoại của T1 → 404", r.ma === 404, `${r.ma}`);

console.log(loi ? `\n${loi} phép kiểm SAI` : "\nTất cả đều đạt");
process.exit(loi ? 1 : 0);
