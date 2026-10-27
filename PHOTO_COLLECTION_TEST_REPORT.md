# Kiểm thử đóng góp ảnh tự nguyện — 27/10/2026

## Kết quả đã xác nhận

- 71/71 kiểm thử Node, gồm 15 tình huống mới cho thu ảnh, Google Apps Script và quyền riêng tư.
- 18/18 bước giao diện Cloudflare cũ đạt sau thay đổi.
- 12/12 bước giao diện mới đạt: mặc định tắt, admin cấu hình, bảng xin phép, không tích sẵn, từ chối vẫn thêm ảnh, chỉ thu ảnh mới, tải mã xóa, rút lại ở trình duyệt khác và bố cục di động.
- Đóng gói Worker bằng Wrangler dry-run thành công. Ảnh thử là ảnh trắng tổng hợp; Drive và AI trong máy chủ thử được giả lập.

## Các trường hợp quan trọng

| Trường hợp | Kết quả mong đợi / kết quả đã kiểm tra |
|---|---|
| Chưa cấu hình, chưa đồng ý hoặc đã từ chối | Không gọi Drive khi thêm ảnh; chức năng nhận diện vẫn nhận ảnh |
| Người thường hoặc thiếu token admin thay kết nối | Từ chối 403 |
| Thiếu xác nhận tuổi/quyền ảnh/chính sách hiện tại | Không tạo đồng ý |
| Ảnh được thêm trước đồng ý | Không thu ngược, không cho retry để vượt điều kiện |
| Ảnh thêm sau đồng ý | Có bản ghi thời gian, chính sách, hạn 90 ngày và tên ngẫu nhiên |
| Metadata EXIF/APP thông thường | Loại khỏi bản đóng góp; không gửi tên gốc/chat |
| Drive lỗi lúc gửi | Giữ ảnh trong phiên nhận diện, báo chưa xác nhận lưu |
| Thử lại cùng ảnh | Dùng cùng mã, không tạo thêm bản sau khi đã gửi thành công |
| Phiên khác thao tác ảnh riêng | Từ chối; không kế thừa đồng ý |
| Mã xóa sau khi phiên hết hạn | Vẫn yêu cầu xóa được qua bản ghi đồng ý độc lập |
| Xóa gặp lỗi | Dừng thu thêm trước, chỉ báo xóa thành công sau khi xác nhận; cron thử lại |
| Yêu cầu cũ đến sau khi rút lại | Script giữ dấu rút lại, không nhận lại ảnh |
| Hết hạn lưu | Ngừng gửi; tác vụ dọn xóa ảnh bằng Drive API |
| URL/redirect ngoài Google được phép | Từ chối, không chuyển tiếp khóa/ảnh |

Mã Apps Script thật trong `google-drive/Code.gs` được thực thi bằng Node VM với các dịch vụ Google giả lập để kiểm tra logic chống trùng, xác thực, xóa vĩnh viễn và từ chối ảnh đến muộn. Đây không phải thử trên Google Drive thật.

## Phần cần chủ tài khoản Google hoàn tất

Chưa có thư mục, Apps Script deployment hoặc quyền Google của chủ web. Không thu ảnh thật và chưa kiểm thử đường truyền, cấp quyền OAuth, quota Google, lịch kích hoạt hoặc xóa thực tế. Làm theo `google-drive/HUONG_DAN.md`, chạy thử lưu/xóa bằng ảnh tổng hợp trước khi bật mời người dùng đóng góp. Tính năng trên web mặc định tắt cho đến khi admin kiểm tra và lưu kết nối hợp lệ.

Việc thu ảnh không tự huấn luyện mô hình và chưa chứng minh tăng độ chính xác. Chủ hệ thống phải kiểm tra nhãn, xử lý các bản sao dữ liệu bên ngoài thư mục do script quản lý và theo dõi lỗi lịch dọn ảnh. App PC và web Python local không bị bật thu ảnh.
