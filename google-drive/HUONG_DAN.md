# Kết nối kho ảnh đóng góp Google Drive

Tính năng dành cho **web Cloudflare**. App PC và web Python local không tự thu ảnh.
Chưa kết nối thì thu ảnh tắt; không có ảnh người dùng nào được gửi thử vào Drive.

## 1. Tạo bộ nhận ảnh bằng tài khoản Google của chủ web

1. Mở https://script.google.com/home/start và tạo **Dự án mới**.
2. Mở `Code.gs` trong gói này, sao chép toàn bộ vào tệp `Code.gs` trên Apps Script.
3. Trong **Dịch vụ / Services**, bấm **+**, chọn **Drive API**, bấm **Thêm**. Bước này bật Drive API cho việc xóa vĩnh viễn ảnh; không chia sẻ Drive cho người dùng web.
4. Vào **Cài đặt dự án**, bật hiển thị tệp manifest `appsscript.json`. Thay nội dung manifest bằng tệp `appsscript.json` trong gói. Script dùng quyền Drive của tài khoản thực thi; mã chỉ xử lý thư mục riêng do chính bộ thiết lập tạo.
5. Chọn hàm **setupCollection**, bấm **Chạy** và cấp quyền bằng đúng tài khoản Google bạn muốn lưu ảnh. Hàm tự tạo thư mục riêng tư, mã kết nối và lịch dọn ảnh mỗi giờ. Không cần tạo thư mục trước.
6. Trong **Nhật ký thực thi**, lưu đường dẫn thư mục và **Connection code**. Chỉ dán mã này vào phần admin của web; không gửi trong chat, đưa lên Git hoặc chia sẻ cho khách.
7. Bấm **Triển khai → Bản triển khai mới → Ứng dụng web**. Chọn **Thực thi với tư cách: Tôi** và **Ai có quyền truy cập: Bất kỳ ai**. Bấm triển khai, sao chép URL kết thúc bằng `/exec`.

“Bất kỳ ai” ở đây cho phép máy chủ gọi script; yêu cầu vẫn phải có mã bí mật. Nó **không** làm thư mục Drive công khai. Giữ thư mục ở chế độ Hạn chế, không thêm người xem/người chỉnh sửa nếu muốn bộ kiểm tra riêng tư tiếp tục chấp nhận.

## 2. Bật trên web

1. Mở web và **Đăng nhập admin**.
2. Chọn **Quản lý thu ảnh** ở chân trang.
3. Điền tên người/đơn vị chịu trách nhiệm, email/kênh liên hệ, URL `/exec` và mã kết nối vừa tạo.
4. Tích **Bật mời đóng góp ảnh tự nguyện**, rồi **Kiểm tra và lưu**.

Máy chủ kiểm tra kết nối, chế độ riêng tư và lịch dọn ảnh trước khi bật. Nếu chưa thiết lập được, để tắt; nhận diện và chatbot vẫn dùng bình thường. Khi cập nhật mã Apps Script, tạo phiên bản triển khai mới cho deployment đang dùng; URL `/dev` không dùng cho kết nối này.

## 3. Những gì hệ thống làm

- Bảng thông tin tự xuất hiện mỗi lần mở hoặc tải lại trang, kể cả khi chưa kết nối Drive. Các ô xác nhận không tích sẵn. Đóng bảng không thay đổi lựa chọn đã lưu; người chưa đồng ý hoặc đã từ chối vẫn dùng web và không đóng góp. Mở bảng không tự bật thu ảnh; nút đồng ý chỉ khả dụng sau khi admin bật kết nối hợp lệ.
- Chỉ nhận sau xác nhận chủ động rằng ảnh là của chính người gửi và đồng ý sử dụng ảnh theo thông tin đã hiển thị. Đây là tự xác nhận về quyền sử dụng ảnh, không phải kiểm định danh tính.
- Chỉ ảnh thêm sau đồng ý được gửi; ảnh cũ không bị thu ngược. Trình duyệt chuyển ảnh sang JPEG; máy chủ bỏ các khối metadata APP/COM thông thường trước khi đóng góp. Khuôn mặt vẫn có thể nhận diện được, nên không gọi đây là ảnh ẩn danh.
- Drive lưu JPEG dưới tên ngẫu nhiên, kèm thông tin đồng ý và hạn sử dụng. Không lưu đoạn chat, tên tệp gốc, địa chỉ IP hay tên người dùng trong kho ảnh đóng góp.
- Ảnh gốc trong phiên nhận diện vẫn giữ cơ chế hết hạn riêng. Bỏ ảnh khỏi phiên không thay thế yêu cầu xóa bản đóng góp; dùng mã xóa để rút lại.
- Mỗi lần đồng ý có một mã xóa. Người dùng tải mã để yêu cầu xóa từ máy khác hoặc sau khi phiên web hết hạn. Nếu mất cả mã lẫn phiên, cần liên hệ người quản lý; hệ thống không tự đoán ảnh nào thuộc người đó.
- Khi rút lại, máy chủ dừng thu thêm trước; chỉ báo đã xóa khi Drive xác nhận. Lỗi xóa được thử lại theo lịch. Các ảnh được xóa vĩnh viễn bằng Drive API, không chỉ chuyển ảnh vào Thùng rác.
- Hạn lưu 90 ngày tính từ lần đồng ý, dọn mỗi giờ. Quota/lỗi dịch vụ có thể làm chậm dọn; quản trị viên phải theo dõi lịch thực thi và xử lý lỗi. Thư mục rỗng có trạng thái rút lại được giữ đến hết hạn để chặn yêu cầu cũ đến chậm.
- Bằng chứng đồng ý trong D1 chỉ chứa mã băm và thông tin cần thiết; mã kết nối mã hóa. Phiên không công khai mã xóa hay API key. Bản ghi đã xóa được dọn sau hạn lưu cộng 30 ngày.

## 4. Dùng ảnh để cải thiện mô hình

Thu thập ảnh chưa làm mô hình tốt hơn ngay. Cần kiểm tra chất lượng, gán nhãn có chuyên môn, chia train/validation/test theo người, huấn luyện lại và đo precision/recall/mAP. Không xem nhãn detector dự đoán là nhãn chuẩn.

Giữ liên kết mã đóng góp và hạn lưu khi chuẩn bị tập huấn luyện. Tác vụ xóa tự động chỉ kiểm soát thư mục riêng của script; chủ ứng dụng phải xóa các bản sao, bản xuất và ảnh đã chuyển đi. Không công khai tập ảnh khuôn mặt. Việc xóa ảnh nguồn không tự hoàn tác trọng số mô hình đã huấn luyện. Thông tin này đã được ghi trong bảng xin phép.

## Kiểm tra trước khi nhận ảnh thật

Chạy thử bằng **ảnh tổng hợp**: từ chối không có ảnh trong Drive; đồng ý có đúng ảnh mới; mã xóa xóa được ảnh thật trên Drive; lịch cleanup hoạt động; tắt thu ảnh vẫn cho yêu cầu xóa. Chưa có kết nối Google của chủ web thì chưa được coi là đã kiểm thử Drive thật. Các kiểm thử tự động trong repository dùng dữ liệu và Drive giả lập.

Tài liệu nền tảng: [Apps Script Web Apps](https://developers.google.com/apps-script/guides/web), [Drive Folder](https://developers.google.com/apps-script/reference/drive/folder), [Drive files.delete](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/delete), [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas).
