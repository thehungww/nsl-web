# AcneCheck — Web nhận diện mụn trên Cloudflare

## Kho ảnh đóng góp trên web

Ảnh đóng góp lưu trực tiếp, mã hóa trong cơ sở dữ liệu của website; không cần kết nối Google Drive hoặc cấu hình khóa lưu trữ. Bảng thông tin tự mở khi vào hoặc tải lại trang. Chỉ ảnh mới sau khi người dùng chủ động đồng ý và xác nhận ảnh của mình mới được lưu. Từ chối vẫn nhận diện và chat bình thường.

Admin đăng nhập rồi chọn **Kho ảnh đóng góp** trên thanh đầu trang để xem ảnh lớn, tải từng JPEG, tải ZIP của một trang kèm metadata, hoặc xóa ảnh đã chọn. Người thường không được xem kho. Tải ảnh yêu cầu cả cookie phiên và token admin; chỉ cookie không đủ. Đăng xuất đóng kho và thu hồi các URL xem trước.

Kho có giới hạn 100 MiB dữ liệu ảnh đã mã hóa và tối đa 500 ảnh, mỗi trang 24 ảnh. Kho đầy không chặn ảnh dùng cho nhận diện; bản đóng góp báo chưa lưu để thử lại sau khi admin giải phóng dung lượng. Ảnh lưu tối đa 90 ngày, được dọn hằng giờ và khi admin mở kho. Đây là giới hạn ứng dụng, không phải cam kết dung lượng của gói Cloudflare.

Người gửi được cấp mã rút lại/xóa, dùng được sau khi phiên duyệt hết hạn. Xóa ảnh trong kho không làm ảnh phiên nhận diện biến mất; admin không thể dùng thao tác thử lại để khôi phục ảnh đã xóa. Các bản đã tải về và bản sao lưu hạ tầng cần quản lý theo vòng đời riêng. Việc thu ảnh không tự huấn luyện mô hình.

Áp dụng migration `0003_web_photo_library.sql` trước khi triển khai. Mặc định cho phép mời đóng góp nhưng không lưu nếu chưa có đồng ý. Admin có thể tắt nhận ảnh mới tại **Quản lý thu ảnh**. Thông tin đơn vị/liên hệ có thể chỉnh khi chưa có đồng ý hiệu lực. App PC và web Python local không tự thu ảnh. Frontend Cloudflare trong `public/` được giữ riêng khi chạy script xuất tài nguyên từ Python.

Xem [hướng dẫn kho ảnh](PHOTO_LIBRARY.md) và [báo cáo kiểm thử](PHOTO_COLLECTION_TEST_REPORT.md).

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
