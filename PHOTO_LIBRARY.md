# Kho ảnh đóng góp trực tiếp trên web

Ảnh nằm trong kho riêng của máy chủ web, không lưu trên Google Drive và không cần người dùng đăng nhập Google. Bản PC và web Python local giữ nguyên.

## Sử dụng

1. Người dùng mở web, đọc bảng thông tin và chọn đồng ý nếu muốn đóng góp. Hai ô xác nhận ảnh của mình và đồng ý sử dụng đều không tích sẵn. Đóng hoặc từ chối vẫn dùng web bình thường.
2. Chỉ ảnh **thêm sau khi đồng ý** mới được sao lưu vào kho. Không thu ngược ảnh có sẵn hoặc tự coi ảnh tải lên là đồng ý.
3. Admin đăng nhập, chọn **Kho ảnh đóng góp** ở thanh trên để xem ảnh thu nhỏ, bấm mở lớn, **Tải ảnh** hoặc **Tải trang này (.zip)**.
4. Đánh dấu ảnh và chọn **Xóa ảnh đã chọn**, hoặc xóa từng ảnh. ZIP gồm JPEG trên trang hiện tại và `thong-tin-anh.json` ghi mã ảnh, kích thước, ngày lưu và hạn lưu.
5. **Quản lý thu ảnh** ở chân trang cho phép tắt/bật nhận ảnh mới. Tắt vẫn giữ quyền tải/xóa của admin và quyền rút lại của người gửi.

## Lưu trữ và quyền truy cập

- Ảnh mã hóa AES-GCM trong D1, tách khỏi bảng ảnh tạm của phiên. Phiên hết hạn hoặc máy người dùng đóng trình duyệt không làm mất bản đóng góp.
- Chỉ admin có token đăng nhập hợp lệ được xem danh sách, tải JPEG hoặc xóa. Cookie admin không kèm token bị từ chối. URL ảnh không công khai; phản hồi ảnh dùng `Cache-Control: no-store`.
- Khi đóng kho hoặc đăng xuất, trình duyệt hủy tải đang chờ, xóa các phần tử ảnh và thu hồi URL xem trước. Dữ liệu đã tải xuống là bản sao do admin tự quản lý.
- Kho lưu 100 MiB dữ liệu ảnh đã mã hóa, tối đa 500 ảnh. Đây là mức giới hạn được lập trình để tránh chiếm hết cơ sở dữ liệu dùng chung. Không tự đăng ký gói lưu trữ trả phí.
- Kho đầy không làm thao tác tải ảnh nhận diện thất bại; giao diện ghi bản đóng góp chưa lưu. Admin tải/xóa ảnh để giải phóng chỗ rồi người dùng có thể thử gửi lại các ảnh hợp lệ.
- Kiểm tra dung lượng và quyền đồng ý thực hiện trong cùng câu SQL ghi ảnh. Các lượt tải đồng thời không được vượt giới hạn hoặc tạo lại ảnh sau khi rút lại.

## Đồng ý, xóa và hạn lưu

Không lưu chat, IP hay tên tệp gốc trong kho đóng góp. Các khối APP/COM thông thường như EXIF bị loại khỏi JPEG lưu trong kho; khuôn mặt vẫn có thể nhận diện, nên đây không phải dữ liệu ẩn danh.

Mỗi lần đồng ý có mã xóa riêng. Người gửi giữ mã để rút lại ở trình duyệt khác hoặc sau khi phiên hết hạn; có thể rút lại không cần nhập mã nếu vẫn ở đúng phiên đã đồng ý. Việc rút lại cập nhật trạng thái và xóa ảnh bằng một giao dịch cơ sở dữ liệu. Chỉ xóa nhóm ảnh thuộc mã đó. Không xóa ảnh của người khác hoặc ảnh tạm dùng cho phiên nhận diện.

Ảnh hết hạn sau 90 ngày tính từ lúc đồng ý. Máy chủ dọn theo lịch hằng giờ và khi mở kho; đường dẫn tải từ chối ảnh hết hạn ngay cả trước lượt dọn. Bản ghi bằng chứng đã xóa được dọn sau hạn lưu cộng 30 ngày. Ảnh admin đã xóa không được tạo lại bằng nút thử gửi lại. Ảnh nguồn trong kho được xóa khỏi dữ liệu hoạt động; các bản sao lưu hạ tầng theo vòng đời của dịch vụ, không được hiển thị hoặc dùng tiếp trong kho.

Admin cần theo dõi hạn lưu của các bản đã xuất và xử lý các bản sao khi người gửi rút lại. Việc xóa ảnh không tự hoàn tác trọng số mô hình đã huấn luyện. Ảnh dự đoán chưa phải nhãn chuẩn; cần kiểm tra, gán nhãn và kiểm định trước khi dùng huấn luyện.

## Triển khai

Áp dụng các migration theo thứ tự 0001, 0002, 0003. Các cột cũ được giữ để không phá dữ liệu; kết nối Drive không còn được gọi. Đồng ý cũ không được dùng cho phương thức lưu trữ mới, vì phiên bản thông tin đã thay đổi. Kho dùng cơ sở dữ liệu hiện có, không cần thêm tài khoản hoặc kết nối lưu trữ ngoài.

Tài liệu hạ tầng: [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
