# Kiểm thử kho ảnh đóng góp trên web — 28/10/2026

## Kết quả

- 75/75 kiểm thử Node đạt, gồm 19 tình huống cho lưu ảnh trực tiếp, quyền riêng tư và kho admin.
- 18/18 bước hồi quy giao diện Cloudflare đạt.
- 14/14 bước giao diện kho ảnh đạt: từ chối/đồng ý, kiểm tra ảnh không đồng ý vắng mặt, xem ảnh lớn, JPEG hợp lệ, ZIP hợp lệ có metadata, xóa ảnh đã chọn, rút lại ở trình duyệt khác, giao diện di động và đóng kho khi đăng xuất.
- Wrangler dry-run thành công. Kiểm tra giao diện không có lỗi JavaScript.

Cơ sở dữ liệu kiểm thử là SQLite thật trong bộ nhớ, thực thi các migration và trigger của ứng dụng. Batch chạy nguyên tử với rollback; ảnh là JPEG tổng hợp màu trắng. Dịch vụ nhận diện và chatbot dùng phản hồi giả lập trong bộ trình duyệt. Không dùng ảnh người bệnh hoặc thay đổi tài khoản admin thật để thử quyền quản trị.

## Những hành vi được kiểm tra

| Tình huống | Kết quả |
|---|---|
| Không đồng ý hoặc từ chối | Ảnh vẫn dùng nhận diện, không vào kho đóng góp |
| Đồng ý sau khi đã thêm ảnh | Chỉ ảnh thêm tiếp theo được lưu; không thu ngược |
| Không có trường tuổi hoặc khóa lưu trữ ngoài | Đồng ý hợp lệ vẫn lưu được ảnh |
| Lưu trữ và dữ liệu công khai | Dữ liệu ảnh mã hóa; state/list không lộ ảnh gốc hoặc mã xóa |
| Khách hoặc chỉ có cookie admin | Không được list, tải ảnh, cấu hình hay xóa |
| Đăng nhập đúng token admin | Tải JPEG và xem kho được; đăng xuất chặn truy cập |
| Phiên duyệt hết hạn | Bản đóng góp vẫn tồn tại, admin mới đăng nhập vẫn thấy |
| Admin xóa ảnh rồi người gửi thử lại | Ảnh đã xóa không bị tạo lại |
| Rút lại bằng mã từ trình duyệt khác | Xóa đúng nhóm ảnh; không ảnh hưởng người khác |
| Xóa trong lúc ghi ảnh đang chờ | Không khôi phục ảnh sau khi rút lại |
| Lỗi cơ sở dữ liệu giữa giao dịch rút lại | Rollback cả trạng thái và ảnh, không báo xóa thành công giả |
| Ảnh hết hạn | Không tải được dù cron chưa chạy; cleanup xóa dữ liệu |
| Kho đầy | Giữ ảnh nhận diện, đánh dấu đóng góp chưa lưu; xóa để giải phóng rồi thử lại được |
| Nhiều lượt cùng đạt ngưỡng số ảnh | SQL nguyên tử không vượt 500 ảnh |
| Xóa nhiều ảnh hoặc tham số sai | Chỉ nhận tối đa 24 ID hợp lệ, chống chuỗi SQL giả |
| Địa chỉ ngoài hoặc trình duyệt khác | Không gọi dịch vụ lưu trữ ngoài; quyền ảnh theo token admin |

## Giới hạn đánh giá

Bộ thử không phải đánh giá độ chính xác mụn hoặc khả năng chịu tải AI. Chưa stress test kho 100 MB trên Cloudflare thật, chưa đo thời gian tải ZIP lớn trên điện thoại thật và chưa kiểm toán bảo mật độc lập. Giới hạn 100 MiB/500 ảnh là cấu hình an toàn của ứng dụng, không phải benchmark lưu trữ. Ảnh do admin tải về và bản sao lưu hạ tầng có vòng đời riêng; tác vụ xóa kiểm soát kho dữ liệu đang hoạt động.

App PC và web Python local không thay đổi tính năng thu ảnh. Web Cloudflare bỏ kết nối Google Drive; người gửi vẫn phải đồng ý rõ ràng theo thông tin lưu trên máy chủ web. Ảnh thu được cần kiểm tra, gán nhãn và huấn luyện/đánh giá riêng.
