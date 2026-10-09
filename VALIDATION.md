# Kiểm tra bản Cloudflare

Kiểm tra trước triển khai ngày 10/10/2026:

- 26/26 bài kiểm tra Node: quyền admin, mã thiết lập chủ web, Origin/CSRF, mã hóa API key/ảnh, phiên riêng, hết hạn và xóa dữ liệu, tên lớp mụn, ngưỡng tin cậy, chat theo ảnh, mô hình bị xóa, RAG, mã nguồn, chặn liều thuốc bằng số và không chuyển tiếp key qua redirect.
- 18/18 bước trình duyệt Edge: tạo admin, thêm API, chat khi chưa có ảnh, tải nhiều ảnh, quét, chọn một ảnh/tất cả ảnh, PNG kết quả, nguồn/PDF, tải lại trang, camera giả lập, phiên khác, không tràn ngang ở 1366×768/1024×700/390×844.
- Wrangler kiểm tra đóng gói Worker thành công, có D1/Vectorize/Assets.
- 189 đoạn từ 8 PDF đã được tạo vector bằng Gemini Embedding 001, 768 chiều. Các vector E5 local không được trộn với vector Gemini.

Kiểm tra nhận diện và trao đổi trong test tự động dùng dữ liệu giả lập/synthetic. Không dùng ảnh cá nhân và không chứng minh độ chính xác chẩn đoán. Kiểm tra deployment và API thực tế được thực hiện riêng sau triển khai.

Chạy lại: `npm test`, `npm run check`. Kiểm tra trình duyệt bổ sung: chạy `node tests/browser-server.mjs` và `python tests/browser_smoke.py` (cần Playwright, Edge, Pillow).
