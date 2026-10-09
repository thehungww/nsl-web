# Báo cáo kiểm thử toàn hệ thống — 10/10/2026

Phạm vi: web Cloudflare đang triển khai, web local và ứng dụng PC Qt trong workspace. Không tạo EXE mới. Các thao tác thêm/xóa API và thiết lập admin được kiểm tra trong cơ sở dữ liệu tách biệt; không thay đổi cấu hình thật của người dùng.

## Kết quả cuối

| Nhóm | Kết quả | Cách kiểm tra |
|---|---|---|
| PC/web local: quyền, dữ liệu, camera, giao diện Qt, mô hình, RAG và chatbot | **118/118 đạt** | Python unittest, dữ liệu tách biệt |
| Cloudflare API, bảo mật, phiên, tải đồng thời và xử lý lỗi | **56/56 đạt** | Node, SQL thật trên SQLite, API AI giả lập |
| Giao diện web local trên Edge | **23/23 bước đạt** | `web_acceptance_smoke.py` |
| Hồi quy chat theo ảnh web local | **Đạt** | `web_image_chat_smoke.py` |
| Giao diện Cloudflare trên Edge | **18/18 bước đạt** | `browser_smoke.py`, máy chủ tách biệt |
| Chatbot Gemini/RAG local với API thật | **12/12 tình huống đạt** | `chatbot_tester_live.py --live` |
| Web online: quyền, tài liệu, ảnh, 2 endpoint thật, chatbot, RAG và tải đọc trạng thái | **32/32 đạt** | `live_system.py --live`; [kết quả JSON](reports/system-live.json) |
| Web online qua Edge: chat, nguồn, PDF, quét, chat theo ảnh, tải PNG | **Đạt; không lỗi JavaScript** | `live_smoke.py --live` |
| Hai mô hình PC `exp-11.pt`, `exp-24.pt` | **2/2 suy luận thành công** | Ảnh trắng RGB 320×240; không phát hiện vùng |
| Qwen local qua Ollama + RAG | **Có phản hồi tiếng Việt và nguồn PDF tiếng Anh** | `rag_multilingual_smoke.py --chat` |
| Đóng gói và triển khai Worker | **Thành công** | Wrangler; phiên bản `d4c141a5-6543-42ea-a433-403fd6663252` |

## Testcase và kết quả mong đợi

Các nhóm dưới đây đều đạt trong bộ kiểm thử tương ứng ở trên. “API thật” được ghi riêng; các tình huống cố tình phá dữ liệu, vượt hạn mức và sửa admin chạy trên dữ liệu tách biệt.

| ID | Tình huống | Kết quả mong đợi |
|---|---|---|
| TC01 | Khách thêm/xóa mô hình hoặc API chatbot | Bị từ chối 403; cấu hình dùng chung giữ nguyên |
| TC02 | Tạo admin không có mã của chủ web | Bị từ chối; không chiếm quyền admin |
| TC03 | Tạo admin lần hai | Không ghi đè tài khoản đã tạo |
| TC04 | Đăng nhập, đăng xuất, hết hạn hoặc thiếu token admin | Chỉ phiên có quyền hợp lệ được quản lý |
| TC05 | Đoán mật khẩu từ nhiều phiên cùng IP | Lượt thứ sáu trong cửa sổ hạn mức bị chặn |
| TC06 | Origin hoặc CSRF sai | Từ chối thao tác ghi |
| TC07 | Đọc state, lưu khóa/ảnh vào DB | Không lộ khóa; khóa và ảnh lưu có mã hóa |
| TC08 | Người khác đọc/xóa ảnh của phiên chủ ảnh | Không đọc được; không xóa được ảnh chủ ảnh |
| TC09 | Endpoint giả, HTTP, URL có thông tin đăng nhập, redirect | Từ chối; không chuyển tiếp API key qua redirect |
| TC10 | Chọn một trong nhiều mô hình; xóa một mô hình | Dùng đúng endpoint; mô hình còn lại vẫn dùng được |
| TC11 | Hai admin cùng thêm mô hình khi danh sách đã có 29 | Chỉ thêm một; không vượt 30 mô hình |
| TC12 | Hai admin cùng thêm tên mô hình trùng nhau | Một thành công; một báo lỗi 400 rõ ràng |
| TC13 | 80 lượt mở trang đồng thời | Nhận đúng 64 phiên, từ chối 16 phiên còn lại |
| TC14 | Phiên đã hết hạn | API trả 401; mở lại trang tạo phiên/CSRF mới |
| TC15 | Người dùng tiếp tục thao tác | Cookie và hạn phiên được gia hạn đồng bộ |
| TC16 | Hai thao tác cùng phiên trong lúc AI đang chạy | Thao tác thứ hai nhận 409; không mất dữ liệu |
| TC17 | Hai phiên khác nhau gọi AI đồng thời | Xử lý độc lập |
| TC18 | 35 phiên cùng chat hoặc quét | Nhận 30 lượt; các lượt vượt hạn mức nhận 429 |
| TC19 | Một phiên gửi quá sáu câu hoặc sáu lượt quét/phút | Lượt thứ bảy bị chặn trước khi gọi AI |
| TC20 | Một lượt quét có hai ảnh | Tính là một lượt; gọi nhận diện riêng cho hai ảnh |
| TC21 | Thêm nhiều ảnh, ảnh thứ 13, payload quá lớn/sai kiểu | Nhận tối đa 12 ảnh; từ chối dữ liệu sai/quá lớn |
| TC22 | Chọn thumbnail, xem lớn, chuyển ảnh gốc/kết quả | Hiển thị đúng ảnh và danh sách vùng tương ứng |
| TC23 | Một ảnh quét lỗi giữa batch; quét lại | Giữ kết quả ảnh thành công; lượt mới xóa lỗi cũ |
| TC24 | API trả sai lớp, kích thước, score/box hoặc JSON | Không tạo kết quả giả; báo lỗi phù hợp |
| TC25 | Đổi ngưỡng hoặc mô hình đã bị xóa | Không tư vấn bằng kết quả cũ |
| TC26 | GET trạng thái xen giữa upload khi mô hình bị xóa | Không ghi đè và làm mất ảnh vừa thêm |
| TC27 | Chat khi chưa có ảnh | Chat chung hoạt động; không bịa đã xem ảnh |
| TC28 | Chat theo một ảnh hoặc tất cả ảnh | Đúng phạm vi; không cộng trùng giữa các góc mặt |
| TC29 | Không phát hiện vùng trên ảnh trắng | Không kết luận chắc chắn da không có mụn |
| TC30 | Hỏi bệnh viện/địa chỉ sau phân tích ảnh | Trả lời câu mới; không lặp danh sách ảnh/bộ hỏi bệnh |
| TC31 | Yêu cầu phân tích lại | Vẫn dùng kết quả hiện tại để trả lời |
| TC32 | Hỏi tiếng Việt trên tài liệu tiếng Anh | Truy xuất nguồn tiếng Anh, trả lời tiếng Việt; kiểm tra API thật |
| TC33 | Không có đoạn phù hợp, nguồn sai hoặc score không hữu hạn | Phân biệt thông tin chung; bỏ nguồn sai/không hợp lệ |
| TC34 | Tài liệu chứa chỉ thị giả, hỏi ngoài da liễu, tự kê liều thuốc | Không làm theo chỉ thị tài liệu; giữ phạm vi và chặn liều bằng số đã kiểm tra |
| TC35 | PDF được gắn vào số vùng mụn trên ảnh | Bỏ trích nguồn khỏi câu đếm vùng; giữ nguồn kiến thức ở câu kế tiếp |
| TC36 | Mở nguồn, cả tám PDF hoặc đường dẫn ngoài kho | PDF hợp lệ mở được; đường dẫn ngoài kho bị từ chối |
| TC37 | API hết hạn mức, bị chặn an toàn hoặc mất kết nối | Có thông báo; không lưu câu trả lời rỗng; giải phóng khóa phiên |
| TC38 | Nhiều lượt chat, đoạn chat mới hoặc đổi phạm vi | Lịch sử giới hạn; chat chung và chat theo ảnh tách nhau |
| TC39 | Tải lại trang, camera và tải kết quả PNG | Khôi phục lựa chọn; camera giả lập thêm ảnh; PNG mở được |
| TC40 | 1366×768, 1024×700, 390×844 | Không tràn ngang; không lỗi JavaScript |
| TC41 | 5/10/20 phiên đọc trạng thái đồng thời trên web thật | Không lỗi HTTP; có số đo độ trễ |

## Các lỗi đã sửa

| ID | Lỗi tái hiện | Thay đổi |
|---|---|---|
| B01 | COUNT rồi INSERT nhận cả 80 phiên dù giới hạn 64 | Nhận phiên bằng một câu SQL có điều kiện |
| B02 | Cookie hết hạn sau một giờ dù DB đã gia hạn khi thao tác | Gia hạn cookie khi lưu thao tác |
| B03 | `/api/state` âm thầm tạo phiên mới nhưng trang giữ CSRF cũ | Chỉ trang gốc tạo phiên; API hết hạn trả 401 |
| B04 | GET trạng thái cũ ghi đè ảnh mới khi xử lý mô hình đã xóa | Cập nhật có điều kiện trên dữ liệu cũ và khóa; đọc lại khi dữ liệu đã đổi |
| B05 | RAG nhận score NaN/thiếu score như tài liệu phù hợp | Chỉ nhận điểm hữu hạn đạt ngưỡng |
| B06 | API Google trả JSON hỏng nhưng được báo như lỗi nội bộ 500 | Phân loại phản hồi upstream không hợp lệ thành 502 |
| B07 | Chatbot gắn trích PDF vào số vùng do detector phát hiện | Bỏ trích nguồn khỏi các câu đếm vùng đã kiểm tra; giữ nguồn kiến thức |
| B08 | Hai phiên admin cùng thêm làm danh sách vượt 30 | Ghi danh sách mô hình bằng SQL có điều kiện nguyên tử |
| B09 | Hai phiên admin thêm cùng tên gây lỗi 500 | Kiểm tra trùng trong câu SQL; trả 400 rõ ràng |

Lượt chấm đầu còn có lỗi trong testcase: chỉ chấp nhận “Ảnh 1”, “không có”, “không phát hiện” mà bỏ sót “Ảnh số 1”, “không ghi nhận”, “chưa phát hiện”. Đã đối chiếu câu trả lời thật và sửa điều kiện chấm. Một lượt kiểm thử online bị gián đoạn do DNS trên máy kiểm thử; đã chạy lại. Các kết quả cuối ở trên thuộc lượt hoàn tất, không suy ra từ lượt bị gián đoạn.

## Tải online đã đo

Mỗi mức chạy ba đợt đọc `/api/state` qua HTTPS, dùng các cookie phiên độc lập. Không gọi AI trong đợt đo tải.

| Phiên đồng thời | Yêu cầu | Lỗi HTTP | Trung vị | P95 | Lâu nhất |
|---|---:|---:|---:|---:|---:|
| 5 | 15 | 0 | 357 ms | 407 ms | 407 ms |
| 10 | 30 | 0 | 388 ms | 423 ms | 460 ms |
| 20 | 60 | 0 | 498 ms | 553 ms | 557 ms |

Tổng 105 yêu cầu, không lỗi HTTP. Những lượt đo trước có P95 ở mức 20 phiên khoảng 1,1 giây; độ trễ thay đổi theo mạng và trạng thái dịch vụ. Chưa đo tải chat/quét ảnh thật với 20 người đồng thời, tải kéo dài hoặc điểm bão hòa. Các giới hạn 64 phiên, 30 chat/phút và 30 batch quét/phút là cấu hình ứng dụng, không phải chứng nhận sức chịu tải.

## Chạy lại

Trong thư mục `cloudflare`, với Node 24 trong PATH:

```powershell
npm test
npm run check
node tests/browser-server.mjs
# Trong terminal khác, dùng Python có Playwright, Edge và Pillow:
python tests/browser_smoke.py
# Hai lệnh sau dùng quota API thật:
python tests/live_smoke.py --live
python tests/live_system.py --live
```

Trong thư mục PC chứa `app.py` và `.venv`:

```powershell
$env:PYTHONUTF8='1'
$env:PYTHONPATH=(Get-Location).Path
& '.\.venv\Scripts\python.exe' -B -m unittest discover -s tests -p 'test_*.py'
& '.\.venv\Scripts\python.exe' -B tests/web_image_chat_smoke.py
& '.\.venv\Scripts\python.exe' -B tests/web_acceptance_smoke.py
& '.\.venv\Scripts\python.exe' -B tests/chatbot_tester_live.py --live
& '.\.venv\Scripts\python.exe' -B tests/local_inference_smoke.py --live
& '.\.venv\Scripts\python.exe' -B tests/rag_multilingual_smoke.py --chat
```

## Giới hạn đánh giá

- Không có bộ ảnh có nhãn chuẩn để đánh giá precision/recall/mAP hoặc độ đúng lâm sàng. Ảnh suy luận thật là ảnh trắng tổng hợp; các kết quả có nhiều tổn thương trong kiểm thử chức năng được giả lập.
- Camera dùng thiết bị giả lập Edge; chưa xác minh mọi webcam vật lý, Safari hoặc điện thoại thật.
- Các câu trả lời Gemini/Qwen được kiểm tra hành vi và nguồn, không được chứng nhận y khoa. Đầu ra AI có thể thay đổi giữa các lượt; bộ chặn trích nguồn/liều thuốc chỉ bảo đảm các kiểu biểu đạt đã kiểm tra.
- Không xác minh địa chỉ/lịch khám của bệnh viện bằng nguồn hiện hành trong lượt này.
- Bản EXE cũ không được cập nhật hoặc kiểm định như bản mới. Không có build EXE mới.
- Không thay đổi mật khẩu, danh sách mô hình hoặc API key thật để chạy các kiểm thử admin.
