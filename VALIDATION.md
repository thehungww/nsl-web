# Kiểm tra bản Cloudflare

Kiểm tra trước triển khai ngày 10/10/2026:

- 26/26 bài kiểm tra Node: quyền admin, mã thiết lập chủ web, Origin/CSRF, mã hóa API key/ảnh, phiên riêng, hết hạn và xóa dữ liệu, tên lớp mụn, ngưỡng tin cậy, chat theo ảnh, mô hình bị xóa, RAG, mã nguồn, chặn liều thuốc bằng số và không chuyển tiếp key qua redirect.
- 18/18 bước trình duyệt Edge: tạo admin, thêm API, chat khi chưa có ảnh, tải nhiều ảnh, quét, chọn một ảnh/tất cả ảnh, PNG kết quả, nguồn/PDF, tải lại trang, camera giả lập, phiên khác, không tràn ngang ở 1366×768/1024×700/390×844.
- Wrangler kiểm tra đóng gói Worker thành công, có D1/Vectorize/Assets.
- 189 đoạn từ 8 PDF đã được tạo vector bằng Gemini Embedding 001, 768 chiều. Các vector E5 local không được trộn với vector Gemini.
- 3 truy vấn tiếng Việt thật truy xuất được đoạn PDF tiếng Anh bằng Gemini embeddings.
- Sau triển khai: giao diện online, 2 mô hình dùng chung, Gemini trả lời có nguồn RAG, PDF gốc, API Ultralytics thật trên ảnh trắng tổng hợp, chat theo kết quả ảnh và tải PNG đều hoạt động. Ảnh kiểm thử đã được xóa khỏi phiên.
- Đã sửa hai vấn đề chỉ xuất hiện trên Workers: `redirect: error` không được runtime hỗ trợ (đổi sang `manual`, từ chối redirect); Gemini từ chối khu vực gọi API (đặt Worker gần Singapore).

Các bài kiểm tra tự động Node/Edge dùng phản hồi giả lập và ảnh tổng hợp. Bài kiểm tra online gọi API thật nhưng chỉ gửi ảnh trắng tổng hợp, không dùng ảnh cá nhân và không chứng minh độ chính xác chẩn đoán.

Chạy lại: `npm test`, `npm run check`. Kiểm tra trình duyệt bổ sung: chạy `node tests/browser-server.mjs` và `python tests/browser_smoke.py` (cần Playwright, Edge, Pillow).

Kiểm tra online tự nguyện: `python tests/live_smoke.py --live` (sử dụng quota Gemini/Ultralytics). Không chạy bài này mặc định trong CI.
