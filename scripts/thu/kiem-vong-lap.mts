/** Kiểm vòng lặp điều hành (môi trường thử, không gọi AI): chỉ đạo → gắn vào lời dặn → đo lại → báo cáo ngày. */
import "dotenv/config";
if (process.env.CHE_DO_THU !== "bat") throw new Error("Chỉ chạy trong môi trường thử");
const GOC = "http://localhost:3100";
let loi = 0;
const kiem = (ten: string, dung: boolean, ct = "") => { if (!dung) loi++; console.log(`${dung ? "✓" : "✗"} ${ten}${ct ? ` — ${ct}` : ""}`); };
const r = await fetch(`${GOC}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "shop-a@khoinao.test", password: "thu-khoi-nao-123" }) });
const c = r.headers.get("set-cookie")!.split(";")[0];
const goi = async (duong: string, trang: number, tuyChon: RequestInit = {}) => {
  const x = await fetch(`${GOC}/api${duong}`, { ...tuyChon, headers: { Cookie: c, "Content-Type": "application/json", "X-Trang": String(trang) } });
  return { ma: x.status, du: await x.json().catch(() => null) as any };
};
const { query } = await import("../../server/db.js");
const { chiDaoChoAi, danhGiaChiDaoDenHan, soVoiMoc } = await import("../../server/services/chi-dao.js");
const { runDueDieuHanhNgay } = await import("../../server/services/dieu-hanh-ngay.js");
await query("DELETE FROM chi_dao_ai WHERE trang_id IN (1,2)");
await query("DELETE FROM ai_reports WHERE kind = 'dieu_hanh_ngay'");

let x = await goi("/khoi-nao/chi-dao", 1, { method: "POST", body: JSON.stringify({ ai: "sales", noiDung: "Báo phí ship đúng: miễn phí đơn từ 300.000đ." }) });
kiem("thêm chỉ đạo cho AI bán hàng ở T1", x.ma === 201, `${x.ma}`);
x = await goi("/khoi-nao/chi-dao", 1, { method: "POST", body: JSON.stringify({ ai: "analytics", noiDung: "abcdefgh" }) });
kiem("không chỉ đạo AI điều hành", x.ma === 400, `${x.ma}`);
const loiDan1 = await chiDaoChoAi(1, "sales"), loiDan2 = await chiDaoChoAi(2, "sales"), loiDanNd = await chiDaoChoAi(1, "content");
kiem("chỉ đạo vào lời dặn AI bán hàng của T1", loiDan1.includes("miễn phí đơn từ 300.000đ"));
kiem("không lọt sang T2, không lọt sang AI nội dung", loiDan2 === "" && loiDanNd === "");
x = await goi("/khoi-nao/chi-dao", 2, {});
kiem("sổ chỉ đạo của T2 không thấy chỉ đạo T1", x.ma === 200 && x.du.data.length === 0, `${x.du?.data?.length}`);
x = await goi("/khoi-nao/nhat-ky/sales", 1, {});
kiem("nhật ký AI bán hàng ghi việc thêm chỉ đạo", x.du.data.thayDoi.some((d: any) => d.bang === "chi_dao_ai"));

// So với mốc — hàm thuần.
const moc = [{ ma: "ti_le_chot", ten: "Chốt", muc: "on", gan: 0.2 }, { ma: "ti_le_nhuong", ten: "Nhường", muc: "on", gan: 0.1 }] as any;
kiem("so mốc: có chỉ số mới tụt → xấu đi", soVoiMoc(moc, [{ ...moc[0], muc: "tut" }, moc[1]]).ketQua === "xau_di");
kiem("so mốc: mạnh lên, không tụt → tốt lên", soVoiMoc(moc, [{ ...moc[0], muc: "dang_manh" }, moc[1]]).ketQua === "tot_len");
kiem("so mốc: vốn đã tụt từ trước thì không tính là xấu đi do chỉ đạo", soVoiMoc([{ ...moc[0], muc: "tut" }], [{ ...moc[0], muc: "tut" }]).ketQua === "giu_nguyen");

// Đủ 7 ngày → đo lại.
await query("UPDATE chi_dao_ai SET luc_bat_dau = now() - interval '8 days' WHERE trang_id = 1");
await query("UPDATE chi_dao_ai SET moc_chi_so = '[{\"ma\":\"ti_le_chot\",\"ten\":\"Chốt\",\"muc\":\"on\",\"gan\":0.2}]'::jsonb WHERE trang_id = 1");
const soDo = await danhGiaChiDaoDenHan();
const sau = (await query<{ ket_qua: string; trang_thai: string }>("SELECT ket_qua, trang_thai FROM chi_dao_ai WHERE trang_id = 1")).rows[0];
kiem("đo lại chỉ đạo đủ 7 ngày", soDo === 1 && sau.ket_qua !== "chua_do", JSON.stringify(sau));

// Báo cáo ngày.
const truaNay = new Date(); truaNay.setUTCHours(5, 0, 0, 0); // 12:00 giờ VN — đã qua 07:30
const daChay = await runDueDieuHanhNgay(truaNay);
const bc = (await query<{ trang_id: number; findings: string }>("SELECT trang_id, findings FROM ai_reports WHERE kind = 'dieu_hanh_ngay' ORDER BY trang_id")).rows;
kiem("nhịp ngày lập báo cáo cho mỗi khối não có kênh", daChay === 3 && bc.length === 3, `${daChay} / ${bc.length}`);
kiem("báo cáo có chỉ số cuối và tên trang", bc[0].findings.includes("BÁO CÁO NGÀY") && bc[0].findings.includes("Tiền mỗi đơn"));
kiem("chạy lại cùng ngày không lập trùng", (await runDueDieuHanhNgay(truaNay)) === 0);

// Lịch: bật tự chẩn đoán mà chưa đặt trần → 400.
x = await goi("/khoi-nao/lich-dieu-hanh", 1, { method: "PUT", body: JSON.stringify({ lich: { baoCaoNgay: true, gio: "07:30", tuChanDoan: true, tranThangUsd: 0 } }) });
kiem("bật tự chẩn đoán không trần → từ chối", x.ma === 400, `${x.ma}`);
x = await goi("/khoi-nao/lich-dieu-hanh", 1, { method: "PUT", body: JSON.stringify({ lich: { baoCaoNgay: true, gio: "08:15", tuChanDoan: false, tranThangUsd: 2 } }) });
const docLai = await goi("/khoi-nao/lich-dieu-hanh", 1, {});
kiem("lưu lịch theo trang", docLai.du.data.lich.gio === "08:15" && (await goi("/khoi-nao/lich-dieu-hanh", 2, {})).du.data.lich.gio === "07:30");

await query("DELETE FROM chi_dao_ai WHERE trang_id IN (1,2)");
console.log(loi ? `${loi} SAI` : "Tất cả đều đạt");
process.exit(loi ? 1 : 0);
