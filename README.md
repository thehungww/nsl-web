# Ngô Sĩ Liên — Web nhận diện mụn trên Cloudflare

Bản web chạy bằng Cloudflare Workers, gọi Ultralytics để nhận diện và Gemini để tư vấn. Bản app PC và bản web local được giữ riêng.

## Chức năng

- Nhiều ảnh, chụp camera, ảnh thu nhỏ, quét theo mô hình API đang chọn và tải ảnh kết quả PNG.
- Chat riêng hoặc tư vấn theo một ảnh/tất cả ảnh; không cộng trùng các tổn thương giữa góc mặt.
- Admin thêm/xóa các kết nối Ultralytics và API key chatbot; khách dùng chung nhưng không đọc được key.
- RAG đa ngôn ngữ: 8 PDF, 189 đoạn đã làm sạch. Gemini Embedding 001 (768 chiều) + Cloudflare Vectorize; hỏi tiếng Việt trên PDF tiếng Anh và trả lời tiếng Việt, có đoạn trích và trang PDF.
- API key mã hóa AES-GCM bằng Cloudflare secret. Ảnh riêng theo cookie phiên, mã hóa trong D1, hết hạn sau 1 giờ không hoạt động; tác vụ mỗi giờ dọn dữ liệu hết hạn.

## Triển khai lần đầu

Node.js LTS cần được cài trên máy thao tác. Trong thư mục này:

Worker được đặt gần vùng Singapore (`gcp:asia-southeast1`) vì Gemini kiểm tra khu vực máy chủ gọi API. Giữ cấu hình placement này khi cập nhật; lỗi `User location is not supported` không phải lỗi API key. Xem [Placement Cloudflare](https://developers.cloudflare.com/workers/configuration/placement/) và [khu vực Gemini hỗ trợ](https://ai.google.dev/gemini-api/docs/available-regions).

```powershell
npm ci
npx wrangler login
npm run setup
npm run deploy
```

`setup` tạo D1 `nsl-web`, Vectorize `nsl-acne-gemini-768`, áp dụng schema, nạp vectors và tạo `APP_SECRET` / `ADMIN_SETUP_TOKEN`. `wrangler.jsonc` được cập nhật với ID D1 thật. Commit ID này trước khi kết nối GitHub Builds.

Mở web, bấm Đăng nhập admin. Lần đầu nhập mã riêng trong `setup-private.txt`, đặt mật khẩu mới. Sau đó đăng nhập và thêm API key chatbot / kết nối nhận diện. **Các key và mật khẩu local không được đưa lên GitHub.**

Không đổi `APP_SECRET` sau khi đã lưu key/ảnh: cần di chuyển dữ liệu khi xoay khóa. Sao lưu `bootstrap.secret.json` ở nơi riêng; tệp đã bị `.gitignore` loại khỏi Git.

## Cập nhật từ GitHub

Trong Worker `nsl` → Settings → Builds, kết nối kho GitHub `thehungww/nsl-web`, nhánh `main`, thư mục gốc `/`:

- Build command: `npm ci && npm test`
- Deploy command: `npm run deploy`

Không dùng chức năng tải HTML tĩnh để thay thế backend. Không đưa secret vào biến Build công khai hoặc source. Secrets được thiết lập riêng trên Worker.

## Kiểm tra

```powershell
npm test
npm run check
```

Các test API dùng SQLite cục bộ và phản hồi AI/nhận diện giả lập để kiểm tra quyền truy cập, phiên, lựa chọn ảnh và xử lý lỗi. Cần kiểm tra thực tế deployment sau khi cấp quyền Cloudflare; các test này không chứng minh độ chính xác y khoa.

Worker có giới hạn dùng miễn phí; Gemini và Ultralytics có hạn mức riêng. Hạn chế chat/quét theo phiên và toàn web đã được bật. Giao diện chỉ cập nhật nền mỗi phút khi đang mở, tránh polling liên tục.

Ảnh được nén JPEG tối đa 1600 pixel trước khi gửi để phù hợp lưu trữ D1. Việc nén có thể ảnh hưởng các tổn thương rất nhỏ; kết quả chỉ tham khảo, không phải chẩn đoán. Raw ảnh không gửi tới Gemini; chatbot nhận JSON kết quả mô hình.

Nguồn kỹ thuật: [Workers](https://developers.cloudflare.com/workers/), [D1](https://developers.cloudflare.com/d1/), [Vectorize](https://developers.cloudflare.com/vectorize/), [Gemini embeddings](https://ai.google.dev/gemini-api/docs/embeddings).
